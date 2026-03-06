/**
 * memory-smart 扩展
 *
 * LLM 驱动的智能记忆系统：
 * - 自动分类（LLM 判断）
 * - 倒排索引（快速召回）
 * - 文件存储（按月归档）
 * - LLM 自主检索（通过 Skill 引导）
 */

import type { ExtensionApi } from '../../src/main/common/extension';
import { IndexManager } from './storage/IndexManager';
import { EntryStore } from './storage/EntryStore';
import { classifyMemory } from './pipeline/classify';
import { DEFAULT_CONFIG } from './types/config';
import type { MemoryEntry } from './types/models';

let indexManager: IndexManager;
let entryStore: EntryStore;

export default {
  id: 'memory-smart',
  name: 'Memory Smart',

  async register(api: ExtensionApi) {
    const config = { ...DEFAULT_CONFIG };

    // 获取记忆存储根目录
    const userHome = await api.services.paths.getUserHome();
    const memoryRoot = `${userHome}/memory`;

    // 初始化存储组件
    indexManager = new IndexManager(memoryRoot);
    entryStore = new EntryStore(memoryRoot);

    await indexManager.initialize();
    await entryStore.initialize();

    api.logger.info('[memory-smart] 记忆系统初始化成功', { memoryRoot, config });

    /**
     * agent_end 钩子：捕获并分类记忆
     */
    api.on('agent_end', async (event) => {
      if (!config.autoCapture) return;

      const agentOutput = (event.output || '').trim();

      // 校验内容长度
      if (agentOutput.length < config.captureMinChars || agentOutput.length > config.captureMaxChars) {
        return;
      }

      try {
        // LLM 分类
        const classification = await classifyMemory(api, agentOutput);

        if (!classification.shouldRemember) {
          api.logger.debug('[memory-smart] 内容不值得记忆，跳过', {
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
        const contentPath = await entryStore.appendEntry(entry);

        // 追加索引
        await indexManager.appendIndex(classification.category, {
          id: entry.id,
          date: entry.timestamp.substring(0, 10), // YYYY-MM-DD
          summary: entry.summary,
          importance: entry.importance,
          keywords: entry.keywords,
          description: entry.memory,
          contentPath
        });

        api.logger.info('[memory-smart] 记忆已保存', {
          id: entry.id,
          category: entry.category,
          importance: entry.importance
        });
      } catch (err) {
        api.logger.error('[memory-smart] 记忆捕获失败', {
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
