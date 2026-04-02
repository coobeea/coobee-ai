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
import { QualityLoopRuntime } from '@main/ai/quality-loop/QualityLoopRuntime';
import { SkillManager } from '@main/ai/skills';

/** Chat 模式禁用的工具名称列表 */
const CHAT_MODE_BLOCKED_TOOLS = new Set(['exec']);

/** 默认 Chat 模式指令（有文件工具，但无脚本执行） */
const CHAT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你可以读写文件来辅助回答问题，但不能执行脚本命令。请用中文回答用户的问题。';

/** 默认 Agent 模式指令（完整，有工具能力） */
const AGENT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你拥有文件操作、命令执行、记忆管理等工具。请用中文回答用户的问题，必要时使用工具完成任务。';

// ==================== 工具合并 ====================

/**
 * 合并 builtin + Extension 工具（Extension 可覆盖同名 builtin）
 */
function mergeTools(): Map<string, (typeof builtinTools)[number]> {
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of ToolRegistry.getInstance().getAll()) {
    toolMap.set(ext.name, ext);
  }
  return toolMap;
}

/**
 * 根据模式过滤工具：chat 模式排除 exec 等危险工具
 */
function filterToolsByMode(
  toolMap: Map<string, (typeof builtinTools)[number]>,
  agentMode: AgentMode,
  excludeList?: string[]
): (typeof builtinTools)[number][] {
  const excludeSet = new Set(excludeList || []);
  let candidates = Array.from(toolMap.values()).filter((t) => !excludeSet.has(t.name));

  if (agentMode === 'chat') {
    candidates = candidates.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name));
  }
  return candidates;
}

// ==================== Builder 工厂 ====================

/**
 * 创建默认 Builder（根据模式决定工具集合和指令）
 */
function createBuilder(agentMode: AgentMode): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(agentMode === 'chat' ? 'chat-assistant' : 'chat-agent')
    .mode(agentMode)
    .sessionMode('file');

  const tools = filterToolsByMode(mergeTools(), agentMode);
  const instructions = agentMode === 'agent' ? AGENT_INSTRUCTIONS : CHAT_INSTRUCTIONS;
  builder.instructions(instructions).tools(tools);

  return builder;
}

/**
 * 从 AgentDefinition 创建 Builder
 *
 * 用 Agent 定义中的 instructions/tools/skills/model/thinkingLevel 覆盖默认配置。
 */
function createBuilderFromDefinition(
  def: AgentDefinition,
  agentMode: AgentMode
): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(def.name || def.id)
    .agentId(def.id)
    .mode(agentMode)
    .sessionMode('file')
    .instructions(def.instructions);

  const tools = filterToolsByMode(mergeTools(), agentMode, def.excludeTools);
  builder.tools(tools);

  if (def.skills?.length) {
    try {
      const skillDefs = loadSkillDefinitions(def.skills);
      if (skillDefs.length > 0) {
        builder.skills(skillDefs);
        log.info(`[chat] Loaded ${skillDefs.length} skills for agent ${def.id}`);
      } else {
        log.warn(`[chat] No skills found for: ${def.skills.join(', ')}`);
      }
    } catch (err) {
      log.error(`[chat] Failed to load skills:`, err);
    }
  }

  if (def.model) {
    agentExecutor.applyProviderConfig(builder, { modelOverride: def.model, agentId: def.id });
  }
  if (def.thinkingLevel) {
    builder.thinkingLevel(def.thinkingLevel);
  }

  return builder;
}

/**
 * 按名称加载 Skill 定义（同步扫描）
 */
function loadSkillDefinitions(skillNames: string[]): SkillDefinition[] {
  try {
    const searchPaths = [Env.paths.builtinSkillsDir, Env.paths.userSkillsDir];
    const manager = new SkillManager();
    const allSkills = manager.scanSkills(searchPaths, Env.paths.secretsDir);
    const skillMap = new Map(allSkills.map((s) => [s.name, s]));

    return skillNames
      .map((name) => {
        const skill = skillMap.get(name);
        if (!skill) log.warn(`[chat] Skill not found: ${name}`);
        return skill;
      })
      .filter((s): s is SkillDefinition => !!s);
  } catch (err) {
    log.error(`[chat] Failed to load skills:`, err);
    return [];
  }
}

// ==================== 多智能体运行时工厂 ====================

async function createMultiAgentRuntime(
  mode: 'orchestrator' | 'swarm' | 'quality-loop',
  sid: string
): Promise<OrchestratorRuntime | SwarmRuntime | QualityLoopRuntime> {
  if (mode === 'quality-loop') {
    // agentExecutor 满足 AgentExecutorLike 接口但类型系统无法自动推断
    const rt = new QualityLoopRuntime({
      sessionId: sid,
      agentExecutor: agentExecutor as never
    });
    await rt.initialize();
    return rt;
  }

  if (mode === 'orchestrator') {
    const rt = new OrchestratorRuntime({
      name: 'User Orchestrator',
      sessionId: sid,
      orchestratorConfig: { parentSessionId: sid },
      agentExecutor
    });
    await rt.initialize();
    return rt;
  }

  const name = 'User Swarm';
  const rt = new SwarmRuntime(sid, sid, {
    config: { parentSessionId: sid, name },
    agentExecutor
  });
  await rt.initialize();
  return rt;
}

// 注册 Builder 工厂，供 Pipeline executor 使用
agentExecutor.setBuilderFactory((mode) => createBuilder(mode));

// ==================== 轻量级意图识别 ====================

/**
 * 判断消息是否过于简单，不需要多智能体编排
 *
 * 简单规则：
 * - 打招呼、感谢、确认等社交对话
 * - 非常短的消息（< 10 字符）
 * - 简单查询（时间、天气等单一问题）
 */
function isSimpleMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  const length = trimmed.length;

  // 1. 打招呼、感谢、确认等社交对话
  const greetings = [
    '你好',
    'hi',
    'hello',
    '嗨',
    '您好',
    '早',
    '早上好',
    '下午好',
    '晚上好',
    '晚安',
    '谢谢',
    '感谢',
    '多谢',
    'thanks',
    'thank you',
    '好的',
    '好',
    '行',
    '可以',
    'ok',
    'okay',
    '再见',
    'bye',
    'goodbye',
    '拜拜',
    '在吗',
    '在不在',
    '有人吗'
  ];

  for (const greeting of greetings) {
    if (
      trimmed === greeting ||
      trimmed === greeting + '！' ||
      trimmed === greeting + '!' ||
      trimmed === greeting + '？' ||
      trimmed === greeting + '?'
    ) {
      return true;
    }
  }

  // 2. 非常短的消息（可能是简单对话）
  if (length <= 8 && !hasComplexIndicators(trimmed)) {
    return true;
  }

  // 3. 简单查询模式（单一问题）
  const simpleQueryPatterns = [
    /^(现在|今天|明天)?(几点|时间|日期)/,
    /^(今天|明天|后天)?(天气|温度)/,
    /^什么是.{1,15}$/,
    /^(怎么|如何).{1,15}$/
  ];

  if (simpleQueryPatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  // 默认：不简单，需要编排
  return false;
}

/**
 * 检查消息是否包含复杂任务指标
 */
function hasComplexIndicators(message: string): boolean {
  const complexKeywords = [
    '开发',
    '创建',
    '实现',
    '设计',
    '构建',
    '搭建',
    '编写',
    '制作',
    '系统',
    '项目',
    '平台',
    '应用',
    '网站',
    '程序',
    '架构',
    '框架',
    '模块',
    '组件',
    '前端',
    '后端',
    '全栈',
    '数据库',
    '并且',
    '同时',
    '以及',
    '还有'
  ];

  return complexKeywords.some((keyword) => message.includes(keyword));
}

export const chatMethods: MethodGroup = {
  namespace: 'chat',
  methods: {
    send: async (params) => {
      const {
        message,
        sessionId,
        mode = 'agent',
        agentId,
        skillRef,
        projectDir
      } = params as {
        message?: string;
        sessionId?: string;
        mode?: AgentMode;
        agentId?: string;
        skillRef?: string;
        projectDir?: string;
      };

      if (!message) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required');
      }

      // 校验 mode 参数
      const validModes = ['chat', 'agent', 'orchestrator', 'swarm', 'quality-loop'];
      if (!validModes.includes(mode)) {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          `Invalid mode "${mode}". Must be one of: ${validModes.join(', ')}.`
        );
      }

      // 自动创建 Thread
      let sid = sessionId;
      let resolvedProjectDir = projectDir;
      if (!sid) {
        const threadStore = await ThreadStore.getInstance();
        const multiAgentModes: AgentMode[] = ['orchestrator', 'swarm', 'quality-loop'];
        const isMultiAgent = multiAgentModes.includes(mode);
        const agentType = isMultiAgent ? (mode as 'orchestrator' | 'swarm' | 'quality-loop') : 'agent';
        const agentMode = isMultiAgent ? ('agent' as AgentMode) : mode;
        const thread = await threadStore.create({
          title: message.slice(0, 50),
          agentId: agentId || 'default',
          agentMode,
          agentType
        });
        sid = thread.id;
        log.info(`[chat.send] Auto-created thread: ${sid}`);
      } else if (!resolvedProjectDir) {
        try {
          const threadStore = await ThreadStore.getInstance();
          const thread = await threadStore.get(sid);
          if (thread?.projectDir) {
            resolvedProjectDir = thread.projectDir;
          }
        } catch {
          // 读取失败不影响主流程
        }
      }

      log.info(`[chat.send] sessionId=${sid}, mode=${mode}${agentId ? `, agentId=${agentId}` : ''}`);

      try {
        // ========== 多智能体模式（Orchestrator / Swarm / Quality-Loop） ==========
        if (mode === 'orchestrator' || mode === 'swarm' || mode === 'quality-loop') {
          // 🆕 提前进行轻量级意图识别，避免简单对话进入复杂的编排流程
          const shouldDowngrade = isSimpleMessage(message);

          if (shouldDowngrade) {
            log.info(`[chat.send] Message is too simple for ${mode} mode, downgrading to agent mode`);

            // 降级到普通 agent 模式，自然对话
            const pipelineResult = await agentExecutor.submitViaPipeline(sid, message, 'agent');
            if (pipelineResult) {
              return {
                sessionId: sid,
                status: pipelineResult.status,
                mode: 'agent', // 降级后的模式
                queuePosition: pipelineResult.queuePosition
              };
            }
            return {};
          }

          // 复杂任务：继续使用多智能体模式
          const runtime = await createMultiAgentRuntime(mode, sid);
          const result = agentExecutor.submit({ sessionId: sid, message, runtime });

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

        if (resolvedProjectDir) {
          builder.projectDir(resolvedProjectDir);
        }

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
