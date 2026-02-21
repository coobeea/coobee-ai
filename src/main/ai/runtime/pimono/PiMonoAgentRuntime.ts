/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 的 AgentRuntime 实现。
 *
 * 核心能力：
 * - 单智能体模式：createAgentSession() 创建 AgentSession
 * - 四层事件体系：agent > turn > message > tool，SDK 直接提供 turn 边界
 * - 独立思考流：thinking_delta 独立于 text_delta，无需解析 <think> 标签
 * - 工具执行进度：tool_execution_update 提供实时进度
 * - 内置压缩/重试：SDK 自动管理
 * - 单通道事件分发：onChunk → yield → AgentExecutor.forward() 统一广播
 *
 * API 格式：
 * - 统一使用 OpenAI Chat Completions 格式（openai-completions）
 * - 通过 baseURL 指向不同的 OpenAI 兼容服务端点
 * - 不依赖 Anthropic SDK，不使用 ANTHROPIC_AUTH_TOKEN
 *
 * 与 OpenAI 实现的关键差异：
 * - Turn 边界由 SDK 直接给出（无需从 response_started 推断）
 * - 思考内容通过 thinking_delta 独立传递（无需解析 <think> 标签）
 * - 工具执行有进度事件（tool_execution_update）
 * - 会话/压缩/重试全部由 SDK 内置管理
 *
 * 模块拆分：
 * - PiMonoToolConverter.ts  — 工具转换（ToolDefinition → PiToolDefinition）
 * - PiMonoStreamAdapter.ts  — 流式事件适配（AgentSessionEvent → StreamChunk）
 * - ChunkQueue.ts           — 推送→拉取桥接器
 * - PiMonoBuilder.ts        — 构建器
 * - types.ts                — 类型定义
 */

import path from 'node:path';
import {
  createAgentSession,
  createExtensionRuntime,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from '@mariozechner/pi-coding-agent';
import type { AgentSession, ToolDefinition as PiToolDefinition } from '@mariozechner/pi-coding-agent';
import type { Model } from '@mariozechner/pi-ai';
import { AbstractAgentRuntime } from '../AbstractAgentRuntime';
import { ChunkQueue } from './ChunkQueue';
import { convertTools } from './PiMonoToolConverter';
import { setupEventSubscription } from './PiMonoStreamAdapter';
import type { ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../types';
import type { PiMonoAgentRuntimeOptions } from './types';

/** 默认最大执行轮次（TODO: 接入 maxTurns 配置后启用） */
// const DEFAULT_MAX_TURNS = 25

/** 默认模型 */
const DEFAULT_MODEL = 'MiniMax-M2.1';

/** 默认 Base URL（MiniMax OpenAI 兼容端点） */
const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1';

/**
 * 自定义 Provider 名称
 *
 * 因为我们构造自定义 Model 对象，使用一个固定的 provider 名称
 * 来注册 API key 到 AuthStorage 中。
 */
const CUSTOM_PROVIDER = 'openai-compat';

// ========== Logger ==========

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

const createRuntimeLogger = (): RuntimeLogger => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger');
    return createLogger('pimono-runtime') as RuntimeLogger;
  } catch {
    const prefix = '[PiMonoAgentRuntime]';
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    };
  }
};

const log = createRuntimeLogger();

/**
 * 构造 OpenAI Chat Completions 兼容的 Model 对象
 *
 * 不使用 SDK 内置的 getModel() 来获取 anthropic-messages 类型的模型，
 * 而是手动构造一个 openai-completions 类型的 Model 对象，
 * 指向 OpenAI 兼容的后端 API（MiniMax、DeepSeek、DashScope 等）。
 *
 * modelMeta 由 coobee.json5 中的模型配置透传，包含 reasoning、contextWindow 等。
 * 当 reasoning=true 时启用 supportsReasoningEffort，使 SDK 正确解析 reasoning_content。
 */
function createOpenAICompatModel(
  modelName: string,
  baseURL: string,
  modelMeta?: PiMonoAgentRuntimeOptions['modelMeta']
): Model<'openai-completions'> {
  const reasoning = modelMeta?.reasoning ?? true;
  const contextWindow = modelMeta?.contextWindow ?? 204800;
  const maxTokens = modelMeta?.maxOutputTokens ?? 131072;

  return {
    id: modelName,
    name: modelName,
    api: 'openai-completions',
    provider: CUSTOM_PROVIDER,
    baseUrl: baseURL,
    reasoning,
    input: ['text'],
    cost: {
      input: 0.3,
      output: 1.2,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow,
    maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: reasoning,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  };
}

/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 构造 OpenAI 兼容的 Model 对象（openai-completions API）
 * 2. 通过 createAgentSession() 创建 SDK AgentSession
 * 3. 通过 session.subscribe() 订阅事件，映射为 StreamChunk
 * 4. 通过 StreamEmitter 广播事件到 EventBus
 * 5. 管理会话生命周期
 */
export class PiMonoAgentRuntime extends AbstractAgentRuntime {
  readonly type = 'agent' as const;
  readonly id: string;
  readonly options: PiMonoAgentRuntimeOptions;

  // pi-SDK 会话（initialize 后可用）
  private piSession!: AgentSession;

  // 会话
  private readonly sessionId: string;
  private createdAt: number;

  // 中断状态（pi-SDK 通过 Extension 处理，此处始终为 false）
  private _interrupted = false;

  constructor(options: PiMonoAgentRuntimeOptions) {
    super();
    this.options = options;
    this.id = `pi-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessionId = options.sessionId || `pi-session-${Date.now()}`;
    this.createdAt = Date.now();
  }

  get name(): string {
    return this.options.name;
  }

  get interrupted(): boolean {
    return this._interrupted;
  }

  get supportsHITL(): boolean {
    return false;
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    const modelName = this.options.model || DEFAULT_MODEL;
    const baseURL = this.options.baseURL || DEFAULT_BASE_URL;
    const thinkingLevel = this.options.thinkingLevel || 'medium';

    // 1. 构造 OpenAI 兼容的 Model 对象（从 coobee.json5 模型配置透传元数据）
    const model = createOpenAICompatModel(modelName, baseURL, this.options.modelMeta);

    // 2. 认证配置
    //    通过 AuthStorage 注入 API key，使用自定义 provider 名称
    //    新版本使用静态工厂方法 AuthStorage.inMemory() 创建实例
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(CUSTOM_PROVIDER, this.options.apiKey);
    const modelRegistry = new ModelRegistry(authStorage);

    // 3. Session 管理
    //    file 模式：用 sessionId 隔离目录，支持外部管理和恢复会话
    //    memory 模式：内存存储，sessionId 仅作标识
    // 🆕 将 : 替换为 __ 以兼容 Windows 文件系统
    const cwd = this.options.cwd || process.cwd();
    const safeSessionId = this.sessionId.replace(/:/g, '__');
    const sessionDir = this.options.sessionDir
      ? path.join(this.options.sessionDir, safeSessionId)
      : path.join(cwd, '.coobee-ai', 'sessions', safeSessionId);
    const sessionManager =
      this.options.sessionMode === 'file'
        ? SessionManager.continueRecent(cwd, sessionDir)
        : SessionManager.inMemory(cwd);

    // 4. Settings（压缩/重试配置）
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: this.options.compaction?.enabled ?? false },
      retry: {
        enabled: this.options.retry?.enabled ?? true,
        maxRetries: this.options.retry?.maxRetries ?? 3,
        baseDelayMs: this.options.retry?.baseDelayMs ?? 1000
      }
    });

    // 5. 自定义 ResourceLoader（不发现文件系统资源，通过选项注入）
    //    - getSystemPrompt: 返回基础 instructions
    //    - getAppendSystemPrompt: 返回追加指令片段
    //    - getSkills: 返回 SkillDefinition → pi-SDK Skill 的转换结果
    const stubRuntime = createExtensionRuntime();
    const piSkills = (this.options.skills || []).map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath || '',
      baseDir: '',
      source: 'runtime-options',
      disableModelInvocation: false
    }));
    // 如果有 skills，将内容拼接到 appendInstructions 中
    // 因为 pi-SDK 的 Skill 只有 name/description（用于提示词标注），
    // 实际内容需要通过 appendSystemPrompt 注入
    const skillContentParts = (this.options.skills || []).map((s) => {
      const pathInfo = s.filePath ? `\nPath: ${s.filePath}` : '';
      return `<skill name="${s.name}"${pathInfo ? ` path="${s.filePath}"` : ''}>\n${s.content}\n</skill>`;
    });
    const allAppendParts = [...skillContentParts, ...(this.options.appendInstructions || [])];

    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: stubRuntime }),
      getSkills: () => ({ skills: piSkills, diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] as Array<{ path: string; content: string }> }),
      getSystemPrompt: () => this.options.instructions,
      getAppendSystemPrompt: () => allAppendParts,
      getPathMetadata: () => new Map(),
      extendResources: () => {},
      reload: async () => {}
    };

    // 6. 合并工具：sdkTools（SDK 原生）+ tools（统一 ToolDefinition 转换后）
    // 优先使用注入的工具执行上下文，否则降级为最小上下文
    const { createFallbackToolContext } = await import('../shared/ToolExecutionPipeline');
    const sandboxContext =
      this.options.sandboxContext ||
      createFallbackToolContext({
        workspaceRoot: (this.options.cwd as string) || this.options.workspaceRoot || process.cwd(),
        sessionId: this.sessionId
      });
    const allSdkTools: PiToolDefinition[] = [
      ...((this.options.sdkTools as PiToolDefinition[]) || []),
      ...convertTools(this.options.tools || [], { sandboxContext, log })
    ];

    // 7. 创建 AgentSession
    //    有工具时：tools: [] 禁用内置 codingTools，通过 customTools 传入自定义工具
    //    无工具时：完全不传 tools/customTools，避免 API 收到空 tools 数组报 400
    const sessionConfig: Record<string, unknown> = {
      cwd: this.options.cwd || process.cwd(),
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader
    };

    if (allSdkTools.length > 0) {
      sessionConfig.customTools = allSdkTools;
      sessionConfig.tools = []; // 禁用内置 codingTools，仅使用 customTools
    }

    const { session } = await createAgentSession(sessionConfig as Parameters<typeof createAgentSession>[0]);

    this.piSession = session;

    log.info(
      `Initialized: ${this.name} ` +
        `(api: openai-completions, model: ${modelName}, ` +
        `baseURL: ${baseURL}, ` +
        `thinking: ${thinkingLevel}, ` +
        `reasoning: ${model.reasoning}, ` +
        `reasoningEffort: ${model.compat?.supportsReasoningEffort ?? false}, ` +
        `tools: ${allSdkTools.length}, ` +
        `skills: ${piSkills.length}, ` +
        `session: ${this.sessionId})`
    );
  }

  async destroy(): Promise<void> {
    if (this.piSession) {
      this.piSession.dispose();
    }
    this._interrupted = false;
    log.info(`Destroyed: ${this.name}`);
  }

  // ========== 执行方法 ==========

  // run() 由基类 AbstractAgentRuntime 提供（消费 stream()，自动继承快照功能）

  /**
   * 流式执行 Agent（核心实现 — 由基类 stream() 模板方法包装）
   *
   * 通过 session.subscribe() 订阅 pi-SDK 事件，
   * 使用 ChunkQueue 桥接回调式推送到 AsyncGenerator 拉取。
   *
   * 双通道分发：
   *   1. yield chunk — 拉取模式（供 SSE / 直接迭代）
   *   2. StreamEmitter EventBus — 推送模式（广播到 WebSocket）
   *
   * 事件时序：
   *   run:start → turn:start → llm:start → { reasoning:*, text:*, tool:* } → llm:done → turn:done → run:done
   */
  protected async *doStream(
    input: string,
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now();
    const queue = new ChunkQueue<StreamChunk>();

    log.info(`[PiMonoRuntime] Running stream: ${this.name}`);

    try {
      // 1. run:start
      queue.push({ type: 'run:start', content: '' });

      // 2. 设置事件订阅 → push 到 queue
      let fullOutput = '';
      let apiError: string | null = null;
      const toolCalls: ExecutionResult['toolCalls'] = [];

      const unsubscribe = setupEventSubscription(
        this.piSession,
        {
          onChunk: (chunk) => queue.push(chunk),
          onTextDelta: (text) => {
            fullOutput += text;
          },
          toolCalls,
          onApiError: (errorMessage) => {
            apiError = errorMessage;
          }
        },
        log
      );

      // 3. SDK 执行，完成后结束 queue
      this.piSession
        .prompt(input)
        .then(async () => {
          unsubscribe();
          // 等待一个微任务周期，确保 SDK 已排队的事件回调有机会执行完毕
          // （pi-SDK 内部可能通过 Promise/microtask 分发最后的 delta 事件）
          await Promise.resolve();

          if (apiError) {
            // API 返回了错误（如 usage limit exceeded）但 SDK 没有 throw
            queue.push({
              type: 'run:error',
              content: apiError,
              data: { message: apiError }
            });
          } else {
            queue.push({ type: 'run:done', content: '' });
          }
          queue.end();
        })
        .catch(async (err: unknown) => {
          unsubscribe();
          await Promise.resolve();
          queue.push({
            type: 'run:error',
            content: err instanceof Error ? err.message : String(err),
            data: { message: err instanceof Error ? err.message : String(err) }
          });
          queue.end();
        });

      // 4. 逐个 yield 队列中的 chunk
      for await (const chunk of queue) {
        yield chunk;
      }

      return {
        output: fullOutput,
        ...(apiError ? { error: apiError } : {}),
        toolCalls,
        duration: Date.now() - startTime,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      };
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      };
      log.error(`Stream execution failed:`, error);
      throw error;
    }
  }

  // runStream() 由基类 AbstractAgentRuntime 提供
  // HITL 方法（approveToolCall, rejectToolCall, resumeStream）由基类提供默认 throw 实现

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    const messages = this.piSession.messages || [];
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: messages.length,
      metadata: {
        agentId: this.id,
        agentName: this.name,
        piSessionId: this.piSession.sessionId
      }
    };
  }

  async clearSession(): Promise<void> {
    log.info(`Clearing session: ${this.sessionId}`);
    // pi-SDK 的 SessionManager.inMemory() 在 dispose 后重建即可
    // 对于 file 模式，需要重新创建会话
  }

  // ========== 可观测性（Observability） ==========

  /**
   * 获取 session 文件路径（仅 file 模式有值）
   */
  getSessionFilePath(): string | undefined {
    return this.piSession?.sessionFile;
  }

  /**
   * 获取 pi-SDK 的 session 上下文
   *
   * 返回 buildSessionContext() 的结果——即发送给 LLM 的完整消息列表。
   * 含压缩摘要、用户消息、助手消息、工具结果等。
   */
  getSessionContext(): { messages: unknown[]; thinkingLevel: string; model: unknown } | null {
    try {
      return this.piSession?.sessionManager?.buildSessionContext() ?? null;
    } catch (e) {
      log.warn('Failed to get session context:', e);
      return null;
    }
  }

  /**
   * 获取所有原始消息
   */
  getRawMessages(): unknown[] {
    return this.piSession?.messages ?? [];
  }

  /**
   * 获取 session 管理器（高级用法，供测试/调试使用）
   */
  getSessionManager(): unknown {
    return this.piSession?.sessionManager ?? null;
  }
}
