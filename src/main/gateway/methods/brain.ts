/**
 * Gateway Brain 方法组
 *
 * 用于前端管理系统查看智库（Brain）的统计信息和内容。
 *
 * 架构说明：
 *   - Brain Worker 的 API (localhost:42043) → 供 AI Agent 使用（通过 exec/curl）
 *   - Gateway 的 brain.* 方法 → 供前端管理系统使用
 *   - Gateway 方法会转发请求到 Brain Worker
 *
 * 方法：
 *   brain.stats     — 获取智库统计信息（总数、分类统计等）
 *   brain.list      — 列出所有经验包（带分页和筛选）
 *   brain.get       — 获取单个经验包详情
 *   brain.delete    — 删除指定经验包
 */

import { log } from '@main/common/logger';
import { WorkerManager } from '@main/common/worker';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

const BRAIN_WORKER_NAME = 'brain';
const BRAIN_WORKER_PORT = 42043;

/**
 * 检查 Brain Worker 是否就绪
 */
function checkBrainWorkerReady(): void {
  const manager = WorkerManager.getInstance();
  if (!manager.isReady(BRAIN_WORKER_NAME)) {
    throw new GatewayMethodError(
      GatewayErrorCode.INTERNAL_ERROR,
      'Brain Worker 未启动或未就绪。请先启动 Brain Worker。'
    );
  }
}

/**
 * 转发请求到 Brain Worker
 */
async function forwardToBrainWorker<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `http://127.0.0.1:${BRAIN_WORKER_PORT}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`[brain] Worker request failed: ${response.status} ${errorText}`);
      throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `Brain Worker 请求失败: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof GatewayMethodError) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    log.error(`[brain] Request to worker failed:`, error);
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `无法连接到 Brain Worker: ${msg}`);
  }
}

export const brainMethods: MethodGroup = {
  namespace: 'brain',
  methods: {
    /**
     * 获取智库统计信息
     *
     * 返回：
     *   - total: 总经验包数
     *   - byCategory: 按类别统计（repair/optimize/innovate）
     *   - byStatus: 按状态统计（candidate/validated/promoted）
     *   - recentPackages: 最近添加的经验包（最多 10 个）
     */
    stats: async () => {
      checkBrainWorkerReady();
      log.info('[brain.stats] 获取智库统计信息');

      try {
        const response = await forwardToBrainWorker<{ data?: unknown }>('/api/brain/stats', {
          method: 'GET'
        });

        return response.data || response;
      } catch (error) {
        log.error('[brain.stats] 失败:', error);
        throw error;
      }
    },

    /**
     * 列出所有经验包
     *
     * 参数：
     *   - limit: 每页数量（默认 20）
     *   - offset: 偏移量（默认 0）
     *   - category: 类别筛选（repair/optimize/innovate）
     *   - status: 状态筛选（candidate/validated/promoted）
     *   - signals: 按触发信号筛选（数组）
     *
     * 返回：
     *   - packages: 经验包列表（摘要信息）
     *   - total: 总数
     *   - limit: 每页数量
     *   - offset: 偏移量
     */
    list: async (params) => {
      checkBrainWorkerReady();

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

      log.info(`[brain.list] 列出经验包 (limit=${limit}, offset=${offset})`);

      try {
        const response = await forwardToBrainWorker<{ data?: unknown }>('/api/brain/packages', {
          method: 'POST',
          body: JSON.stringify({
            limit,
            offset,
            category,
            status,
            signals
          })
        });

        return response.data || response;
      } catch (error) {
        log.error('[brain.list] 失败:', error);
        throw error;
      }
    },

    /**
     * 获取单个经验包详情
     *
     * 参数：
     *   - packageId: 经验包 ID（必需）
     *
     * 返回：
     *   - package: 完整的经验包（包含 pattern, practice, evolution）
     */
    get: async (params) => {
      checkBrainWorkerReady();

      const { packageId } = params as { packageId?: string };
      if (!packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, '缺少参数: packageId');
      }

      log.info(`[brain.get] 获取经验包: ${packageId}`);

      try {
        const response = await forwardToBrainWorker<{ data?: unknown }>('/api/brain/fetch', {
          method: 'POST',
          body: JSON.stringify({
            message_id: `gateway_${Date.now()}`,
            timestamp: new Date().toISOString(),
            payload: { package_id: packageId }
          })
        });

        return response.data || response;
      } catch (error) {
        log.error(`[brain.get] 获取经验包失败: ${packageId}`, error);
        throw error;
      }
    },

    /**
     * 删除指定经验包
     *
     * 参数：
     *   - packageId: 经验包 ID（必需）
     *
     * 返回：
     *   - ok: true
     *   - packageId: 已删除的经验包 ID
     */
    delete: async (params) => {
      checkBrainWorkerReady();

      const { packageId } = params as { packageId?: string };
      if (!packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, '缺少参数: packageId');
      }

      log.info(`[brain.delete] 删除经验包: ${packageId}`);

      try {
        const response = await forwardToBrainWorker<{ data?: Record<string, unknown> }>(
          `/api/brain/packages/${packageId}`,
          {
            method: 'DELETE'
          }
        );

        const responseData = response.data || {};
        return { ok: true, packageId, ...responseData };
      } catch (error) {
        log.error(`[brain.delete] 删除经验包失败: ${packageId}`, error);
        throw error;
      }
    }
  }
};
