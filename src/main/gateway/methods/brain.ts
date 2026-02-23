/**
 * Gateway Brain 方法组
 *
 * 为前端 UI 提供智库数据访问接口。
 * 转发请求到 Brain Worker，确保索引一致性。
 *
 * Brain Worker (localhost:42043) 是给 Agent 用的，Agent 通过 Skill 主动调用。
 * Gateway brain.* 方法是给前端 UI 用的，通过 HTTP 转发到 Worker API。
 *
 * 方法：
 *   brain.stats  — 获取统计信息
 *   brain.list   — 列出经验包
 *   brain.get    — 获取经验包详情
 *   brain.delete — 删除经验包
 */

import { createLogger } from '@main/common/logger';
import { WorkerManager } from '@main/common/worker';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

const log = createLogger('gateway-brain');

// ==================== HTTP 转发到 Brain Worker ====================

/**
 * 转发请求到 Brain Worker
 */
async function forwardToBrainWorker<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const workerManager = WorkerManager.getInstance();
  const worker = workerManager.getWorkerInfo('brain');

  if (!worker || worker.status !== 'ready') {
    throw new GatewayMethodError(
      GatewayErrorCode.INTERNAL_ERROR,
      'Brain Worker not ready. Please start it in Settings > Built-in Services.'
    );
  }

  const url = `http://127.0.0.1:${worker.port}${endpoint}`;
  log.debug(`[brain] Forwarding request to: ${url}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!res.ok) {
    const errorText = await res.text();
    log.error(`[brain] Worker API error (${res.status}):`, errorText);
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, errorText);
  }

  const data = (await res.json()) as { success: boolean; data?: T; error?: { code: string; message: string } };

  // Worker API 返回 { success: true, data: {...} } 格式
  if (data.success === false) {
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, data.error?.message || 'Worker API error');
  }

  return data.data as T;
}

// ==================== Gateway 方法组 ====================

export const brainMethods: MethodGroup = {
  namespace: 'brain',
  methods: {
    /**
     * 获取统计信息
     */
    stats: async () => {
      log.info('[brain.stats] 获取智库统计信息');

      try {
        const stats = await forwardToBrainWorker('/api/brain/stats');
        return { data: stats };
      } catch (error) {
        log.error('[brain.stats] 获取统计信息失败:', error);
        throw error;
      }
    },

    /**
     * 列出经验包
     *
     * 参数：
     *   - limit: 限制数量
     *   - offset: 偏移量
     *   - category: 按类别筛选
     *   - status: 按状态筛选
     *   - signals: 按信号筛选
     */
    list: async (params) => {
      const {
        limit = 20,
        offset = 0,
        category,
        status,
        signals
      } = params as {
        limit?: number;
        offset?: number;
        category?: string;
        status?: string;
        signals?: string[];
      };

      log.info('[brain.list] 查询经验包列表', {
        limit,
        offset,
        category,
        status,
        signals: signals?.length
      });

      try {
        // 构建 query params
        const query = new URLSearchParams();
        query.set('limit', String(limit));
        query.set('offset', String(offset));
        if (category) query.set('category', category);
        if (status) query.set('status', status);
        if (signals && signals.length > 0) {
          signals.forEach((s) => query.append('signals', s));
        }

        const data = await forwardToBrainWorker(`/api/brain/packages?${query}`);
        return { data };
      } catch (error) {
        log.error('[brain.list] 查询经验包列表失败:', error);
        throw error;
      }
    },

    /**
     * 获取经验包详情
     *
     * 参数：
     *   - packageId: 经验包 ID
     */
    get: async (params) => {
      const { packageId } = params as { packageId?: string };

      if (!packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'packageId is required');
      }

      log.info(`[brain.get] 获取经验包详情: ${packageId}`);

      try {
        const data = await forwardToBrainWorker(`/api/brain/packages/${packageId}`);
        return { data };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;
        log.error(`[brain.get] 获取经验包详情失败: ${packageId}`, error);
        throw error;
      }
    },

    /**
     * 删除经验包
     *
     * 参数：
     *   - packageId: 经验包 ID
     */
    delete: async (params) => {
      const { packageId } = params as { packageId?: string };

      if (!packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'packageId is required');
      }

      log.info(`[brain.delete] 删除经验包: ${packageId}`);

      try {
        await forwardToBrainWorker(`/api/brain/packages/${packageId}`, {
          method: 'DELETE'
        });

        return { ok: true, packageId };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;
        log.error(`[brain.delete] 删除经验包失败: ${packageId}`, error);
        throw error;
      }
    }
  }
};
