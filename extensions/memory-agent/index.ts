/**
 * memory-agent 扩展
 *
 * LLM 驱动的 Agent 级记忆系统：
 * - 自动分类（LLM 判断）
 * - 倒排索引（快速召回）
 * - 文件存储（按月归档）
 * - LLM 自主检索（通过 Skill 引导）
 * - Agent 级隔离（每个 Agent 独立记忆）
 */

import type { ExtensionApi } from '../../src/main/common/extension';
import { IndexManager } from './storage/IndexManager';
import { EntryStore } from './storage/EntryStore';
import { classifyMemory } from './pipeline/classify';
import { DEFAULT_CONFIG } from './types/config';
import type { MemoryEntry } from './types/models';

export default {
  id: 'memory-agent',
  name: 'Memory Agent',

  async register(api: ExtensionApi) {
    const config = { ...DEFAULT_CONFIG };

    api.logger.info('[memory-agent] ===== Extension 正在注册 =====', { config });
    console.log('[memory-agent] Extension register() called - config:', config);

    /**
     * agent_end 钩子：捕获并分类记忆（按 Agent 隔离）
     *
     * 🔥 性能优化：立即返回，后台异步处理，避免阻塞主流程
     */
    api.on('agent_end', async (event) => {
      api.logger.info('[memory-agent] agent_end 事件触发', {
        sessionId: event.sessionId,
        agentId: event.agentId,
        success: event.success,
        outputLength: event.output?.length || 0
      });

      if (!config.autoCapture) {
        api.logger.debug('[memory-agent] autoCapture 已关闭，跳过');
        return;
      }

      // 🆕 过滤临时 runtime ID（只保存真实 Agent 的记忆）
      if (isTemporaryRuntimeId(event.agentId)) {
        api.logger.debug('[memory-agent] 临时 runtime ID，跳过记忆存储', {
          agentId: event.agentId
        });
        return;
      }

      const agentOutput = (event.output || '').trim();

      if (agentOutput.length < config.captureMinChars) {
        api.logger.debug('[memory-agent] 内容太短，跳过', {
          agentId: event.agentId,
          length: agentOutput.length,
          min: config.captureMinChars
        });
        return;
      }

      // 🔥 立即返回，后台异步处理（避免阻塞 agent_end hook）
      processMemoryInBackground(api, event.agentId, agentOutput, config).catch((err) => {
        api.logger.error('[memory-agent] 后台处理失败', {
          agentId: event.agentId,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    });
  },

  async unregister() {
    // 清理资源（如需要）
  }
};

/**
 * 后台异步处理记忆（不阻塞主流程）
 */
async function processMemoryInBackground(
  api: ExtensionApi,
  agentId: string,
  agentOutput: string,
  _config: typeof DEFAULT_CONFIG
): Promise<void> {
  try {
    // 获取当前 Agent 的 Home 目录，记忆存储在 Agent Home 下
    const agentHome = await api.services.paths.getAgentHome(agentId);
    const memoryRoot = `${agentHome}/memory`;

    api.logger.debug('[memory-agent] 初始化存储', { memoryRoot });

    // 初始化存储组件（每次动态创建）
    const agentIndexManager = new IndexManager(memoryRoot);
    const agentEntryStore = new EntryStore(memoryRoot);

    await agentIndexManager.initialize();
    await agentEntryStore.initialize();

    api.logger.info('[memory-agent] 开始 LLM 分类', {
      agentId: agentId,
      contentLength: agentOutput.length,
      contentPreview: agentOutput.substring(0, 100)
    });
    console.log(`[memory-agent] 🤖 调用 LLM 分类 (长度: ${agentOutput.length})`);

    // LLM 分类
    const classification = await classifyMemory(api, agentOutput);

    api.logger.info('[memory-agent] LLM 分类完成', {
      agentId: agentId,
      shouldRemember: classification.shouldRemember,
      category: classification.category,
      importance: classification.importance,
      reason: classification.reason
    });
    console.log(
      `[memory-agent] LLM 分类结果: shouldRemember=${classification.shouldRemember}, category=${classification.category}, reason=${classification.reason}`
    );

    if (!classification.shouldRemember) {
      api.logger.info('[memory-agent] ⚠️ 内容不值得记忆，跳过', {
        agentId: agentId,
        reason: classification.reason,
        contentPreview: agentOutput.substring(0, 200)
      });
      console.log(`[memory-agent] LLM 判断不值得记忆: ${classification.reason}`);
      console.log(`[memory-agent] 内容预览: ${agentOutput.substring(0, 200)}`);
      return;
    }

    // 生成记忆条目
    const entry: MemoryEntry = {
      id: generateMemoryId(),
      timestamp: new Date().toISOString(),
      summary: classification.summary,
      importance: classification.importance,
      category: classification.category,
      keywords: classification.keywords,
      content: agentOutput,
      memory: classification.memory
    };

    // 存储到内容文件
    const contentPath = await agentEntryStore.appendEntry(entry);

    // 追加索引
    await agentIndexManager.appendIndex(classification.category, {
      id: entry.id,
      date: entry.timestamp.substring(0, 10), // YYYY-MM-DD
      summary: entry.summary,
      importance: entry.importance,
      keywords: entry.keywords,
      description: entry.memory,
      contentPath
    });

    api.logger.info('[memory-agent] ✅ 记忆已保存', {
      agentId: agentId,
      id: entry.id,
      category: entry.category,
      importance: entry.importance,
      summary: entry.summary
    });
    console.log(`[memory-agent] ✅ 记忆已保存: ${entry.summary} (ID: ${entry.id})`);
  } catch (err) {
    api.logger.error('[memory-agent] 记忆捕获失败', {
      agentId: agentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * 生成记忆 ID
 */
function generateMemoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 判断是否为临时 runtime ID
 *
 * 临时 runtime ID 的特征：
 * - pi-agent-{timestamp}-{random}   （PiMono Runtime）
 * - orch-{timestamp}                （Orchestrator）
 * - {threadId}:planner              （Orchestrator Planner）
 * - {threadId}:worker:{subtaskId}   （Orchestrator Worker）
 * - {threadId}:triage               （Swarm Triage）
 * - {threadId}:swarm-role-{roleId}  （Swarm Role Agent）
 *
 * 真实 Agent ID 特征：
 * - kebab-case（如 "code-reviewer", "app-copilot"）
 * - 不含时间戳和随机后缀
 */
function isTemporaryRuntimeId(agentId: string): boolean {
  // PiMono 临时 runtime
  if (/^pi-agent-\d+-[a-z0-9]+$/i.test(agentId)) return true;

  // Orchestrator 相关
  if (/^orch-\d+$/.test(agentId)) return true;
  if (agentId.includes(':planner')) return true;
  if (agentId.includes(':worker:')) return true;

  // Swarm 相关
  if (agentId.includes(':triage')) return true;
  if (agentId.includes(':swarm-role-')) return true;

  // Worker 临时 ID（如 "worker-general-1"）
  if (/^worker-[a-z]+-\d+$/i.test(agentId)) return true;

  // 默认：认为是真实 Agent ID
  return false;
}
