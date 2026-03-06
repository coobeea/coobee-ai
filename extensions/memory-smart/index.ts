/**
 * memory-smart 扩展
 *
 * LLM 驱动的智能记忆系统：
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
  id: 'memory-smart',
  name: 'Memory Smart',

  async register(api: ExtensionApi) {
    const config = { ...DEFAULT_CONFIG };

    api.logger.info('[memory-smart] ===== Extension 正在注册 =====', { config });
    console.log('[memory-smart] Extension register() called - config:', config);

    /**
     * agent_end 钩子：捕获并分类记忆（按 Agent 隔离）
     */
    api.on('agent_end', async (event) => {
      api.logger.info('[memory-smart] agent_end 事件触发', {
        sessionId: event.sessionId,
        agentId: event.agentId,
        success: event.success,
        outputLength: event.output?.length || 0
      });

      if (!config.autoCapture) {
        api.logger.debug('[memory-smart] autoCapture 已关闭，跳过');
        return;
      }

      const agentOutput = (event.output || '').trim();

      // 校验内容长度
      if (agentOutput.length < config.captureMinChars || agentOutput.length > config.captureMaxChars) {
        api.logger.debug('[memory-smart] 内容长度不符合要求，跳过', {
          agentId: event.agentId,
          length: agentOutput.length,
          min: config.captureMinChars,
          max: config.captureMaxChars
        });
        return;
      }

      try {
        // 获取当前 Agent 的记忆存储目录
        const userHome = await api.services.paths.getUserHome();
        const memoryRoot = `${userHome}/memory/agent/${event.agentId}`;

        api.logger.debug('[memory-smart] 初始化存储', { memoryRoot });

        // 初始化存储组件（每次动态创建）
        const agentIndexManager = new IndexManager(memoryRoot);
        const agentEntryStore = new EntryStore(memoryRoot);

        await agentIndexManager.initialize();
        await agentEntryStore.initialize();

        api.logger.debug('[memory-smart] 开始 LLM 分类', {
          agentId: event.agentId,
          contentPreview: agentOutput.substring(0, 100)
        });

        // LLM 分类
        const classification = await classifyMemory(api, agentOutput);

        api.logger.debug('[memory-smart] LLM 分类完成', {
          agentId: event.agentId,
          shouldRemember: classification.shouldRemember,
          category: classification.category,
          reason: classification.reason
        });

        if (!classification.shouldRemember) {
          api.logger.debug('[memory-smart] 内容不值得记忆，跳过', {
            agentId: event.agentId,
            reason: classification.reason
          });
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

        api.logger.info('[memory-smart] 记忆已保存', {
          agentId: event.agentId,
          id: entry.id,
          category: entry.category,
          importance: entry.importance
        });
      } catch (err) {
        api.logger.error('[memory-smart] 记忆捕获失败', {
          agentId: event.agentId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  },

  async unregister() {
    // 清理资源（如需要）
  }
};

/**
 * 生成记忆 ID
 */
function generateMemoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
