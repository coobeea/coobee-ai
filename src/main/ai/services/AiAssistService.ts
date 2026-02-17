/**
 * AI 辅助服务 — 通用轻量 LLM 任务框架
 *
 * 提供一个 task-based 的 AI 辅助调用入口，所有任务统一走 AgentExecutor chat 模式。
 * 适用于标题生成、表单填充、内容摘要等轻量级 AI 任务。
 *
 * 设计：
 *   - 每个 task type 是一个独立的 handler（prompt 模板 + 参数校验 + 结果解析）
 *   - 统一走 AgentExecutor.stream()，复用 Provider 系统和 Runtime
 *   - 硬编码 chat 模式（前端无需决定）
 *   - 通过 SSE 推送进度和结果
 *
 * 与主对话的区别：
 *   - 主对话走 WebSocket（长连接、多轮、完整 Agent 模式）
 *   - AI 辅助走 SSE（短连接、一次性、chat 模式）
 */

import { createLogger } from '@main/common/logger';
import { agentExecutor } from '@main/ai/AgentExecutor';
import { builtinTools } from '@main/ai/tools';
import { ToolRegistry } from '@main/ai/tools/registry';
import { resolveApiKey } from '@main/ai/provider/ApiKeyResolver';
import { configStoreInstance } from '@main/common/config/ConfigStore';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import type { StreamChunk } from '@main/ai/runtime/types';

const log = createLogger('ai-assist');

// ==================== 类型定义 ====================

/** Task Handler 定义 */
export interface TaskHandler {
  /** 任务名称（用于日志和路由） */
  name: string;
  /** 构建系统指令（根据参数动态生成） */
  buildInstructions: (params: Record<string, unknown>) => string;
  /** 构建用户消息（将参数转换为发给 LLM 的消息） */
  buildMessage: (params: Record<string, unknown>) => string;
  /** 参数校验（返回 null 表示通过，否则返回错误信息） */
  validate?: (params: Record<string, unknown>) => string | null;
  /** 从 LLM 原始输出中解析结构化结果（可选，默认返回原始文本） */
  parseResult?: (output: string) => unknown;
  /** 是否需要工具（默认 false，chat 模式下的纯对话不需要工具） */
  needsTools?: boolean;
}

/** 执行进度事件 */
export interface AssistProgress {
  step: 'starting' | 'processing' | 'done' | 'error';
  message: string;
  detail?: string;
}

/** 进度回调 */
export type AssistProgressCallback = (progress: AssistProgress) => void;

/** 执行结果 */
export interface AssistResult {
  /** 任务类型 */
  task: string;
  /** 是否成功 */
  ok: boolean;
  /** 结构化结果（parseResult 的返回值） */
  data?: unknown;
  /** 原始 LLM 输出文本 */
  rawOutput?: string;
  /** 错误信息 */
  error?: string;
}

// ==================== Chat 模式禁用工具 ====================

const CHAT_BLOCKED_TOOLS = new Set(['exec']);

// ==================== Task 注册表 ====================

const taskHandlers = new Map<string, TaskHandler>();

/** 注册 Task Handler */
export function registerTask(handler: TaskHandler): void {
  taskHandlers.set(handler.name, handler);
  log.info(`[AiAssist] Registered task: ${handler.name}`);
}

/** 获取已注册的 Task 列表 */
export function getRegisteredTasks(): string[] {
  return Array.from(taskHandlers.keys());
}

// ==================== Builder 创建 ====================

/**
 * 创建 chat 模式的 Builder
 *
 * 复用 chat.ts 中的 Provider 配置逻辑，但指令由 task handler 提供。
 */
function createAssistBuilder(instructions: string, needsTools: boolean): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name('ai-assist')
    .mode('chat')
    .sessionMode('memory')
    .instructions(instructions);

  // 工具：按需加载（chat 模式，排除 exec）
  if (needsTools) {
    const extensionTools = ToolRegistry.getInstance().getAll();
    const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
    for (const ext of extensionTools) {
      toolMap.set(ext.name, ext);
    }
    const chatTools = Array.from(toolMap.values()).filter((t) => !CHAT_BLOCKED_TOOLS.has(t.name));
    builder.tools(chatTools);
  }

  // Provider 配置
  try {
    const providerSystem = agentExecutor.getProviderSystem?.();
    if (providerSystem) {
      const { selector, registry } = providerSystem;
      const ref = selector.resolve();
      const provider = registry.get(ref.provider);
      if (provider) {
        const apiKey = resolveApiKey(provider.apiKey, provider.id);
        if (apiKey) {
          builder.fromProviderConfig(provider, ref.model);
        }
      }
    }
  } catch {
    // Provider 系统未就绪，静默回退
  }

  // 思维链级别：轻量任务用 low
  try {
    const config = configStoreInstance?.getAll?.();
    const level = config?.models?.defaults?.thinkingLevel;
    builder.thinkingLevel(level ?? 'low');
  } catch {
    builder.thinkingLevel('low');
  }

  return builder;
}

// ==================== 核心执行 ====================

/**
 * 执行 AI 辅助任务
 *
 * @param taskName 任务类型名称
 * @param params 任务参数
 * @param onProgress 进度回调（SSE 推送用）
 * @returns 执行结果
 */
export async function executeAssistTask(
  taskName: string,
  params: Record<string, unknown>,
  onProgress?: AssistProgressCallback
): Promise<AssistResult> {
  const emit = onProgress ?? (() => {});

  // 1. 查找 handler
  const handler = taskHandlers.get(taskName);
  if (!handler) {
    emit({ step: 'error', message: `未知的任务类型: ${taskName}` });
    return { task: taskName, ok: false, error: `Unknown task: ${taskName}` };
  }

  // 2. 参数校验
  if (handler.validate) {
    const error = handler.validate(params);
    if (error) {
      emit({ step: 'error', message: error });
      return { task: taskName, ok: false, error };
    }
  }

  log.info(`[AiAssist] Executing task: ${taskName}`);
  emit({ step: 'starting', message: '正在准备...' });

  try {
    // 3. 构建 Builder
    const instructions = handler.buildInstructions(params);
    const message = handler.buildMessage(params);
    const builder = createAssistBuilder(instructions, handler.needsTools ?? false);

    // 4. 通过 AgentExecutor.stream() 执行（走完整的 chat 模式流程）
    const sessionId = `assist-${generateSnowflakeId()}`;
    emit({ step: 'processing', message: '正在处理...' });

    let output = '';
    const gen = agentExecutor.stream({ sessionId, message, builder });

    let r = await gen.next();
    while (!r.done) {
      const chunk: StreamChunk = r.value;
      // 收集文本输出（text:delta = 流式增量文本）
      if (chunk.type === 'text:delta' && chunk.content) {
        output += chunk.content;
      }
      r = await gen.next();
    }

    // 5. 解析结果
    const trimmedOutput = output.trim();
    const data = handler.parseResult ? handler.parseResult(trimmedOutput) : trimmedOutput;

    emit({ step: 'done', message: '完成' });
    log.info(`[AiAssist] Task completed: ${taskName}, output=${trimmedOutput.slice(0, 100)}`);

    return {
      task: taskName,
      ok: true,
      data,
      rawOutput: trimmedOutput
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`[AiAssist] Task failed: ${taskName}`, error);
    emit({ step: 'error', message: msg });
    return { task: taskName, ok: false, error: msg };
  }
}
