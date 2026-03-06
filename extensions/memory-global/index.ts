/**
 * memory-global — 全局长期记忆扩展
 *
 * 核心能力：
 *   1. before_agent_start: 语义检索历史记忆并注入上下文
 *   2. agent_end: 自动捕获有价值的信息并存储到 LanceDB
 *
 * 技术栈：
 *   - LanceDB: 嵌入式向量数据库
 *   - Embedding: 通过 ExtensionApi.services.llm.embed() 调用
 *
 * 设计原则：
 *   - 完全独立，不依赖主进程核心模块（除 ExtensionApi）
 *   - 使用 api.services 访问系统能力
 *   - 数据存储在 ~/.coobee-ai/extensions/memory-global/data/lancedb/
 */

import { randomUUID } from 'node:crypto';
import type { ExtensionApi } from '../../src/main/common/extension';
import { LanceDBStorage } from './storage/lancedb';
import { shouldCapture, detectCategory, calculateImportance } from './pipeline/capture';
import { formatRecallContext } from './pipeline/retrieve';
import { DEFAULT_CONFIG, type MemoryGlobalConfig } from './types/config';
import type { MemoryEntry } from './types/models';

let storage: LanceDBStorage | null = null;
const config: MemoryGlobalConfig = DEFAULT_CONFIG;

export default {
  id: 'memory-global',
  name: 'Memory Global',

  async register(api: ExtensionApi) {
    // ========== 初始化 LanceDB 存储 ==========
    try {
      const dataDir = await api.services.paths.getDataDir('memory-global');
      const path = await import('node:path');
      const dbPath = path.default.join(dataDir, 'lancedb');

      storage = new LanceDBStorage(dbPath);
      await storage.initialize();

      const stats = await storage.getStats();
      api.logger.info(`[memory-global] Initialized — ${stats.total} memories loaded`);
    } catch (err) {
      api.logger.error('[memory-global] Failed to initialize LanceDB:', err);
      return;
    }

    // ========== before_agent_start: 自动召回记忆 ==========
    api.on(
      'before_agent_start',
      async (event) => {
        if (!config.autoRecall || !storage) return;

        try {
          // 1. 生成 query embedding（使用系统配置的默认 embedding 模型）
          const embeddings = await api.services.llm.embed([event.prompt]);
          const queryVector = embeddings[0];

          // 2. 向量检索
          const results = await storage.search(queryVector, config.recallTopK, config.recallMinScore);

          if (results.length === 0) return;

          // 3. 格式化并注入上下文
          const context = formatRecallContext(results);
          api.logger.info(`[memory-global] Recalled ${results.length} memories for agent start`);

          return {
            prependContext: context
          };
        } catch (err) {
          api.logger.warn('[memory-global] Recall failed:', err);
          return;
        }
      },
      { priority: 20 }
    );

    // ========== agent_end: 自动捕获记忆 ==========
    api.on(
      'agent_end',
      async (event) => {
        if (!config.autoCapture || !storage) return;

        const output = (event.output || '').trim();

        // 1. 判断是否值得捕获
        if (!shouldCapture(output, { minChars: config.captureMinChars, maxChars: config.captureMaxChars })) {
          return;
        }

        try {
          // 2. 生成 embedding（使用系统配置的默认 embedding 模型）
          const embeddings = await api.services.llm.embed([output]);
          const vector = embeddings[0];

          // 3. 检测分类和重要度
          const category = detectCategory(output);
          const importance = calculateImportance(output);

          // 4. 构建记忆条目
          const entry: MemoryEntry = {
            id: randomUUID(),
            text: output,
            vector,
            importance,
            category,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            accessCount: 0
          };

          // 5. 存储到 LanceDB
          await storage.add(entry);

          api.logger.info(`[memory-global] Captured memory: [${category}] importance=${importance}`);
        } catch (err) {
          api.logger.warn('[memory-global] Capture failed:', err);
        }
      },
      { priority: 60 }
    );

    api.logger.info('[memory-global] Registered lifecycle hooks');
  },

  async unregister() {
    if (storage) {
      await storage.close();
      storage = null;
    }
  }
};
