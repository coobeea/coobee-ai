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
import { Env } from '@main/common/env';
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

  // 合并 builtin + Extension 工具
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }

  // 工具过滤逻辑（两层过滤）
  let candidateTools;
  if (def.tools && def.tools.length > 0) {
    // 1. Agent 定义中明确指定了工具列表 → 按配置加载
    candidateTools = def.tools
      .map((name) => toolMap.get(name))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
  } else {
    // 2. 未配置工具 → 加载所有可用工具（向后兼容）
    candidateTools = Array.from(toolMap.values());
  }

  // 3. 根据模式进行二次过滤（chat 模式强制排除危险工具）
  const finalTools =
    agentMode === 'chat' ? candidateTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name)) : candidateTools;

  builder.tools(finalTools);

  // 加载 Skills：从 def.skills 读取 skill names，扫描并加载 SKILL.md 内容
  if (def.skills && def.skills.length > 0) {
    try {
      log.info(`[createBuilderFromDefinition] Loading skills for agent ${def.id}: ${def.skills.join(', ')}`);
      const skillDefs = loadSkillDefinitions(def.skills);
      log.info(`[createBuilderFromDefinition] Found ${skillDefs.length} skill definitions`);
      if (skillDefs.length > 0) {
        for (const skill of skillDefs) {
          log.info(`[createBuilderFromDefinition] - ${skill.name}: content length = ${skill.content.length}`);
        }
        builder.skills(skillDefs);
        log.info(
          `[createBuilderFromDefinition] Successfully loaded ${skillDefs.length} skills: ${skillDefs.map((s) => s.name).join(', ')}`
        );
      } else {
        log.warn(`[createBuilderFromDefinition] No skills found for: ${def.skills.join(', ')}`);
      }
    } catch (err) {
      log.error(`[createBuilderFromDefinition] Failed to load skills:`, err);
    }
  } else {
    log.info(`[createBuilderFromDefinition] Agent ${def.id} has no skills configured`);
  }

  // piMono() 已自动注入 Provider 配置 + thinkingLevel
  // Agent 定义中的 model 支持三种格式：单模型、@group、auto
  if (def.model) {
    agentExecutor.applyProviderConfig(builder, { modelOverride: def.model, agentId: def.id });
  }
  if (def.thinkingLevel) {
    builder.thinkingLevel(def.thinkingLevel);
  }

  return builder;
}

/**
 * 加载 Skills 定义（同步版本）
 *
 * @param skillNames Skill 名称数组（来自 Agent 配置）
 * @returns SkillDefinition 数组
 */
function loadSkillDefinitions(skillNames: string[]): SkillDefinition[] {
  try {
    // 直接使用 Env（顶层 import）
    const searchPaths = [
      Env.paths.builtinSkillsDir,
      Env.paths.userSkillsDir
      // 注意：workspace-specific skills 需要 workspace 路径，这里暂不支持
      // 因为 createBuilderFromDefinition 调用时 workspace 还未创建
    ];

    log.info(`[loadSkillDefinitions] Searching in paths: ${searchPaths.join(', ')}`);

    // 扫描所有可用 Skills
    const manager = new SkillManager();
    const secretsDir = Env.paths.secretsDir;
    const allSkills = manager.scanSkills(searchPaths, secretsDir);

    log.info(
      `[loadSkillDefinitions] Scanned ${allSkills.length} total skills: ${allSkills.map((s) => s.name).join(', ')}`
    );

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
        agentId,
        skillRef
      } = params as {
        message?: string;
        sessionId?: string;
        mode?: AgentMode;
        agentId?: string;
        skillRef?: string;
      };

      if (!message) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required');
      }

      // 校验 mode 参数
      const validModes = ['chat', 'agent', 'orchestrator', 'swarm', 'discussion'];
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
        const agentType =
          mode === 'orchestrator'
            ? 'orchestrator'
            : mode === 'swarm'
              ? 'swarm'
              : mode === 'discussion'
                ? 'discussion'
                : 'agent';
        const agentMode = mode === 'orchestrator' || mode === 'swarm' || mode === 'discussion' ? 'agent' : mode;
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
            orchestratorConfig: { parentSessionId: sid },
            agentExecutor
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
            config: { parentSessionId: sid, name: 'User Swarm' },
            agentExecutor
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

        // ========== Discussion 讨论模式 ==========
        if (mode === 'discussion') {
          const swarm = new SwarmRuntime(sid, sid, {
            config: { parentSessionId: sid, name: 'Discussion' },
            agentExecutor
          });
          await swarm.initialize();

          const result = agentExecutor.submit({
            sessionId: sid,
            message,
            runtime: swarm,
            executionConfig: { executionMode: 'discussion' }
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
          const pipelineResult = await agentExecutor.submitViaPipeline(sid, message, mode);
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

        // skillRef: 显式 Skill 注入 — 将 Skill 全文作为强制指令追加到 system prompt
        if (skillRef) {
          try {
            const skillDefs = loadSkillDefinitions([skillRef]);
            if (skillDefs.length > 0) {
              const skill = skillDefs[0];
              const skillInstruction =
                `<active_skill name="${skill.name}">\n` +
                `You MUST strictly follow the instructions in this Skill. Do NOT skip any steps.\n\n` +
                `${skill.content}\n` +
                `</active_skill>`;
              builder.appendInstructions(skillInstruction);
              log.info(`[chat.send] Injected skillRef="${skillRef}" (${skill.content.length} chars)`);
            } else {
              log.warn(`[chat.send] skillRef="${skillRef}" not found, skipping injection`);
            }
          } catch (err) {
            log.warn(`[chat.send] Failed to load skillRef="${skillRef}":`, err);
          }
        }

        const modelSourceRef =
          agentDef?.model && (agentDef.model.startsWith('@') || agentDef.model === 'auto') ? agentDef.model : undefined;

        const result = agentExecutor.submit({
          sessionId: sid,
          message,
          builder,
          modelSourceRef
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
