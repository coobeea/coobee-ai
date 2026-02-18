/**
 * Gateway Chat 方法组
 *
 * 支持两种运行模式：
 *   - chat: 对话 + 文件操作 — 禁用 exec（脚本执行），保留文件读写等工具
 *   - agent: 完整 Agent — 全部工具 + 执行协议 + Skill + HITL
 *
 * 支持 agentId 参数：
 *   - 指定 agentId 时从 AgentStore 加载 Agent 定义，用自定义 instructions/tools/skills/model 构建 Builder
 *   - 不指定时使用默认 Agent（行为不变）
 *
 * 方法：
 *   chat.send  — 发送消息并启动流式处理（支持 mode / agentId 参数）
 *   chat.abort — 中止当前会话（预留）
 */

import { log } from '@main/common/logger';
import { agentExecutor } from '@main/ai/AgentExecutor';
import { builtinTools } from '@main/ai/tools';
import { ToolRegistry } from '@main/ai/tools/registry';
import { resolveApiKey } from '@main/ai/provider/ApiKeyResolver';
import { configStoreInstance } from '@main/common/config/ConfigStore';
import { AgentStore } from '@main/ai/agents/AgentStore';
import type { AgentDefinition } from '@main/ai/agents/types';
import { ThreadStore } from '@main/ai/threads/ThreadStore';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';
import type { AgentMode } from '@main/ai/runtime/types';
import { OrchestratorRuntime } from '@main/ai/orchestration/OrchestratorRuntime';
import { SwarmRuntime } from '@main/ai/swarm/SwarmRuntime';

/** Chat 模式禁用的工具名称列表 */
const CHAT_MODE_BLOCKED_TOOLS = new Set(['exec']);

/** 默认 Chat 模式指令（有文件工具，但无脚本执行） */
const CHAT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你可以读写文件来辅助回答问题，但不能执行脚本命令。请用中文回答用户的问题。';

/** 默认 Agent 模式指令（完整，有工具能力） */
const AGENT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你拥有文件操作、命令执行、记忆管理等工具。请用中文回答用户的问题，必要时使用工具完成任务。';

/**
 * 创建 Builder（根据模式决定工具集合）
 *
 * 模型解析优先级：
 * 1. ModelSelector（如果配置系统已初始化）
 * 2. ProviderRegistry（如果有匹配的 Provider）
 * 3. 环境变量 / coobee.json5 默认值（兜底）
 */
function createBuilder(agentMode: AgentMode): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(agentMode === 'chat' ? 'chat-assistant' : 'chat-agent')
    .mode(agentMode)
    .sessionMode('file');

  // 合并 builtin + Extension 工具（Extension 可覆盖同名 builtin）
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }
  const allTools = Array.from(toolMap.values());

  if (agentMode === 'agent') {
    builder.instructions(AGENT_INSTRUCTIONS).tools(allTools);
  } else {
    // Chat 模式：加载工具但排除 exec（脚本执行）
    const chatTools = allTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name));
    builder.instructions(CHAT_INSTRUCTIONS).tools(chatTools);
  }

  // 尝试从 Provider 系统获取模型配置
  applyProviderConfig(builder);

  // 从配置或默认值设置思维链级别
  applyThinkingLevel(builder);

  return builder;
}

/**
 * 尝试从 Provider 系统注入模型配置
 *
 * 如果 Provider 系统未初始化或无可用配置，则不做任何操作（使用 coobee.json5 / 环境变量兜底）。
 */
function applyProviderConfig(builder: ReturnType<typeof agentExecutor.piMono>): void {
  try {
    const providerSystem = agentExecutor.getProviderSystem?.();
    if (!providerSystem) return;

    const { selector, registry } = providerSystem;
    const ref = selector.resolve();
    const provider = registry.get(ref.provider);
    if (!provider) return;

    // 解析 API Key
    const apiKey = resolveApiKey(provider.apiKey, provider.id);
    if (!apiKey) return;

    builder.fromProviderConfig(provider, ref.model);
  } catch {
    // Provider 系统未就绪，静默回退到默认配置
  }
}

/**
 * 从 coobee.json5 配置注入思维链级别
 *
 * 读取 models.defaults.thinkingLevel 配置项，默认 'medium'。
 */
function applyThinkingLevel(builder: ReturnType<typeof agentExecutor.piMono>): void {
  try {
    const config = configStoreInstance?.getAll?.();
    const level = config?.models?.defaults?.thinkingLevel;
    if (level) {
      builder.thinkingLevel(level);
      return;
    }
  } catch {
    // 静默回退
  }
  builder.thinkingLevel('medium');
}

/**
 * 从 AgentDefinition 创建 Builder
 *
 * 用 Agent 定义中的 instructions/tools/skills/model/thinkingLevel 覆盖默认配置。
 * 未在定义中指定的字段使用全局默认值。
 */
function createBuilderFromDefinition(
  def: AgentDefinition,
  agentMode: AgentMode
): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(def.name || def.id)
    .mode(agentMode)
    .sessionMode('file')
    .instructions(def.instructions);

  // 解析工具集
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }

  if (def.tools && def.tools.length > 0) {
    // Agent 定义中指定了工具列表 → 只加载指定的工具
    const selectedTools = def.tools
      .map((name) => toolMap.get(name))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    builder.tools(selectedTools);
  } else {
    // 未指定工具 → 继承全部工具（与默认 Agent 相同）
    const allTools = Array.from(toolMap.values());
    if (agentMode === 'chat') {
      builder.tools(allTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name)));
    } else {
      builder.tools(allTools);
    }
  }

  // 模型：Agent 定义优先，否则走 Provider 系统
  if (def.model) {
    builder.model(def.model);
  } else {
    applyProviderConfig(builder);
  }

  // 思维链：Agent 定义优先，否则走全局配置
  if (def.thinkingLevel) {
    builder.thinkingLevel(def.thinkingLevel);
  } else {
    applyThinkingLevel(builder);
  }

  return builder;
}

// 注册 Builder 工厂，供 Pipeline executor 使用
agentExecutor.setBuilderFactory((mode) => createBuilder(mode));

export const chatMethods: MethodGroup = {
  namespace: 'chat',
  methods: {
    send: async (params) => {
      const {
        message,
        sessionId,
        mode = 'agent',
        agentId
      } = params as {
        message?: string;
        sessionId?: string;
        mode?: AgentMode;
        agentId?: string;
      };

      if (!message) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required');
      }

      // 校验 mode 参数
      const validModes = ['chat', 'agent', 'orchestrator', 'swarm'];
      if (!validModes.includes(mode)) {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          `Invalid mode "${mode}". Must be one of: ${validModes.join(', ')}.`
        );
      }

      // 自动创建 Thread
      let sid = sessionId;
      if (!sid) {
        const threadStore = await ThreadStore.getInstance();
        const agentType = mode === 'orchestrator' ? 'orchestrator' : mode === 'swarm' ? 'swarm' : 'agent';
        const agentMode = mode === 'orchestrator' || mode === 'swarm' ? 'agent' : mode;
        const thread = await threadStore.create({
          title: message.slice(0, 50),
          agentId: agentId || 'default',
          agentMode,
          agentType
        });
        sid = thread.id;
        log.info(`[chat.send] Auto-created thread: ${sid}`);
      }

      log.info(`[chat.send] sessionId=${sid}, mode=${mode}${agentId ? `, agentId=${agentId}` : ''}`);

      try {
        // ========== Orchestrator 模式 ==========
        if (mode === 'orchestrator') {
          const orchestrator = new OrchestratorRuntime({
            name: 'User Orchestrator',
            sessionId: sid,
            orchestratorConfig: { parentSessionId: sid }
          });
          await orchestrator.initialize();

          const result = agentExecutor.submit({
            sessionId: sid,
            message,
            runtime: orchestrator
          });

          if (result.status === 'busy') {
            throw new GatewayMethodError(GatewayErrorCode.SESSION_BUSY, '当前会话正在处理中');
          }

          return { sessionId: sid, status: 'streaming', mode };
        }

        // ========== Swarm 模式 ==========
        if (mode === 'swarm') {
          const swarm = new SwarmRuntime(sid, sid, {
            config: { parentSessionId: sid, name: 'User Swarm' }
          });
          await swarm.initialize();

          const result = agentExecutor.submit({
            sessionId: sid,
            message,
            runtime: swarm
          });

          if (result.status === 'busy') {
            throw new GatewayMethodError(GatewayErrorCode.SESSION_BUSY, '当前会话正在处理中');
          }

          return { sessionId: sid, status: 'streaming', mode };
        }

        // ========== Agent / Chat 模式 ==========
        let agentDef: AgentDefinition | null = null;
        if (agentId) {
          const store = await AgentStore.getInstance();
          agentDef = await store.get(agentId);
          if (!agentDef) {
            throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Agent "${agentId}" not found`);
          }
        }

        if (!agentDef) {
          const pipelineResult = agentExecutor.submitViaPipeline(sid, message, mode);
          if (pipelineResult) {
            return {
              sessionId: sid,
              status: pipelineResult.status,
              mode,
              queuePosition: pipelineResult.queuePosition
            };
          }
        }

        const builder = agentDef ? createBuilderFromDefinition(agentDef, mode) : createBuilder(mode);

        const result = agentExecutor.submit({
          sessionId: sid,
          message,
          builder
        });

        if (result.status === 'busy') {
          throw new GatewayMethodError(GatewayErrorCode.SESSION_BUSY, '当前会话正在处理中');
        }

        return {
          sessionId: sid,
          status: 'streaming',
          mode,
          ...(agentId ? { agentId } : {})
        };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[chat.send] Failed: sessionId=${sid}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg);
      }
    },

    abort: async (params) => {
      const { sessionId } = params as { sessionId?: string };

      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }

      log.info(`[chat.abort] sessionId=${sessionId}`);
      const aborted = agentExecutor.abort(sessionId);

      return { sessionId, aborted };
    }
  }
};
