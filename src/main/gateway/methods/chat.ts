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
import { AgentStore } from '@main/ai/agents/AgentStore';
import type { AgentDefinition } from '@main/ai/agents/types';
import { ThreadStore } from '@main/ai/threads/ThreadStore';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';
import type { AgentMode, SkillDefinition } from '@main/ai/runtime/types';
import { OrchestratorRuntime } from '@main/ai/orchestration/OrchestratorRuntime';
import { SwarmRuntime } from '@main/ai/swarm/SwarmRuntime';
import { SkillManager } from '@main/ai/skills';

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

  return builder;
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

  // 解析工具集 — 始终加载所有可用工具（不受 def.tools 限制）
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }
  const allTools = Array.from(toolMap.values());

  // 根据模式过滤工具
  if (agentMode === 'chat') {
    builder.tools(allTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name)));
  } else {
    builder.tools(allTools);
  }

  // 加载 Skills：从 def.skills 读取 skill names，扫描并加载 SKILL.md 内容
  if (def.skills && def.skills.length > 0) {
    try {
      const skillDefs = loadSkillDefinitions(def.skills);
      if (skillDefs.length > 0) {
        builder.skills(skillDefs);
        log.info(
          `[createBuilderFromDefinition] Loaded ${skillDefs.length} skills: ${skillDefs.map((s) => s.name).join(', ')}`
        );
      }
    } catch (err) {
      log.warn(`[createBuilderFromDefinition] Failed to load skills:`, err);
    }
  }

  // piMono() 已自动注入 Provider 配置 + thinkingLevel
  // Agent 定义中的显式配置优先覆盖
  if (def.model) {
    builder.model(def.model);
  }
  if (def.thinkingLevel) {
    builder.thinkingLevel(def.thinkingLevel);
  }

  return builder;
}

/**
 * 加载 Skills 定义
 *
 * @param skillNames Skill 名称数组（来自 Agent 配置）
 * @returns SkillDefinition 数组
 */
function loadSkillDefinitions(skillNames: string[]): SkillDefinition[] {
  try {
    // 动态导入 Env（避免顶层加载）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Env } = require('@main/common/env');

    // 获取搜索路径
    const searchPaths = Env.getSkillSearchPaths();
    const configDir = Env.paths.configDir;

    // 扫描所有可用 Skills
    const manager = new SkillManager();
    const allSkills = manager.scanSkills(searchPaths, configDir);

    // 根据名称过滤
    const skillMap = new Map(allSkills.map((s) => [s.name, s]));
    const result: SkillDefinition[] = [];

    for (const name of skillNames) {
      const skill = skillMap.get(name);
      if (skill) {
        result.push(skill);
      } else {
        log.warn(`[loadSkillDefinitions] Skill not found: ${name}`);
      }
    }

    return result;
  } catch (err) {
    log.error(`[loadSkillDefinitions] Failed to load skills:`, err);
    return [];
  }
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
