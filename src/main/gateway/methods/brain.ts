/**
 * Gateway Brain 方法组
 *
 * 为前端 UI 提供智库数据访问接口。
 * 直接从文件系统读取，无需启动 Brain Worker。
 *
 * Brain Worker (localhost:42043) 是给 Agent 用的，Agent 通过 Skill 主动调用。
 * Gateway brain.* 方法是给前端 UI 用的，直接操作文件系统。
 *
 * 方法：
 *   brain.stats  — 获取统计信息
 *   brain.list   — 列出经验包
 *   brain.get    — 获取经验包详情
 *   brain.delete — 删除经验包
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

const log = createLogger('gateway-brain');

// ==================== 类型定义 ====================

interface Pattern {
  name: string;
  summary: string;
  category: string;
  signals: string[];
  strategy: string;
}

interface Practice {
  name: string;
  summary: string;
  content: string;
  confidence: number;
  outcome: string;
}

interface Evolution {
  attempts: Array<{
    approach: string;
    outcome: string;
    success: boolean;
  }>;
  outcome: string;
}

interface Package {
  package_id: string;
  pattern: Pattern;
  practice: Practice;
  evolution?: Evolution;
  status: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

// ==================== 文件系统访问 ====================

function getBrainDir(): string {
  return path.join(Env.paths.userHome, 'brain');
}

function getPackagesDir(): string {
  return path.join(getBrainDir(), 'packages');
}

function getIndexDir(): string {
  return path.join(getBrainDir(), 'index');
}

// ==================== 经验包操作 ====================

function loadPackage(packageId: string): Package | null {
  const pkgPath = path.join(getPackagesDir(), packageId, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content) as Package;
  } catch (err) {
    log.error(`Failed to load package ${packageId}:`, err);
    return null;
  }
}

function listPackages(): Package[] {
  const packagesDir = getPackagesDir();

  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    const packages: Package[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pkg = loadPackage(entry.name);
      if (pkg) {
        packages.push(pkg);
      }
    }

    return packages;
  } catch (err) {
    log.error('Failed to list packages:', err);
    return [];
  }
}

function deletePackage(packageId: string): boolean {
  const pkgDir = path.join(getPackagesDir(), packageId);

  if (!fs.existsSync(pkgDir)) {
    return false;
  }

  try {
    fs.rmSync(pkgDir, { recursive: true, force: true });
    log.info(`[brain.delete] Deleted package: ${packageId}`);

    // 从索引中移除（简单实现：重建索引）
    rebuildIndexes();

    return true;
  } catch (err) {
    log.error(`Failed to delete package ${packageId}:`, err);
    return false;
  }
}

function rebuildIndexes(): void {
  // 简化实现：清空索引文件
  // Agent 下次发布时会重建索引
  const indexDir = getIndexDir();
  if (!fs.existsSync(indexDir)) return;

  try {
    const indexFiles = ['by-signal.jsonl', 'by-category.jsonl', 'by-status.jsonl'];
    for (const file of indexFiles) {
      const filePath = path.join(indexDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    log.error('Failed to rebuild indexes:', err);
  }
}

// ==================== 统计信息 ====================

function getStats(): {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  recentPackages: Array<{ package_id: string; pattern_name: string; created_at: string }>;
} {
  const packages = listPackages();

  const stats = {
    total: packages.length,
    byCategory: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    recentPackages: [] as Array<{ package_id: string; pattern_name: string; created_at: string }>
  };

  // 按类别统计
  for (const pkg of packages) {
    const category = pkg.pattern.category;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
  }

  // 按状态统计
  for (const pkg of packages) {
    const status = pkg.status;
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
  }

  // 最近的包（按创建时间排序，取前 5 个）
  const sorted = packages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  stats.recentPackages = sorted.slice(0, 5).map((pkg) => ({
    package_id: pkg.package_id,
    pattern_name: pkg.pattern.name,
    created_at: pkg.created_at
  }));

  return stats;
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
        const stats = getStats();
        return { data: stats };
      } catch (error) {
        log.error('[brain.stats] 获取统计信息失败:', error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, '获取统计信息失败');
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
        let packages = listPackages();

        // 按类别筛选
        if (category) {
          packages = packages.filter((pkg) => pkg.pattern.category === category);
        }

        // 按状态筛选
        if (status) {
          packages = packages.filter((pkg) => pkg.status === status);
        }

        // 按信号筛选
        if (signals && signals.length > 0) {
          packages = packages.filter((pkg) => signals.some((signal) => pkg.pattern.signals.includes(signal)));
        }

        // 按创建时间倒序排序
        packages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // 分页
        const total = packages.length;
        const paged = packages.slice(offset, offset + limit);

        return {
          data: {
            packages: paged,
            total,
            limit,
            offset
          }
        };
      } catch (error) {
        log.error('[brain.list] 查询经验包列表失败:', error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, '查询经验包列表失败');
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
        const pkg = loadPackage(packageId);

        if (!pkg) {
          throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, '经验包不存在');
        }

        return { data: pkg };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;

        log.error(`[brain.get] 获取经验包详情失败: ${packageId}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, '获取经验包详情失败');
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
        const success = deletePackage(packageId);

        if (!success) {
          throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, '经验包不存在');
        }

        return { ok: true, packageId };
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error;

        log.error(`[brain.delete] 删除经验包失败: ${packageId}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, '删除经验包失败');
      }
    }
  }
};
