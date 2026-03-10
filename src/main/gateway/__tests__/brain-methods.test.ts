/**
 * Gateway brain 方法测试
 *
 * 测试 Gateway 转发到 Brain Worker 的逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
const mockWorkerManager = {
  getInstance: vi.fn(() => ({
    getWorkerInfo: vi.fn((name: string) => {
      if (name === 'brain') {
        return {
          status: 'ready',
          port: 42043
        };
      }
      return undefined;
    })
  }))
};

// Mock WorkerManager
vi.mock('@main/common/worker', () => ({
  WorkerManager: mockWorkerManager
}));

// Mock logger 模块
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })
}));

// Mock global fetch
global.fetch = mockFetch;

// 在 mock 之后再导入
const { brainMethods } = await import('../methods/brain');
import type { MethodContext } from '../protocol';

describe('Gateway brain methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('brain.stats', () => {
    it('应该返回统计信息', async () => {
      // Mock fetch 返回统计数据
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            total: 2,
            byCategory: { repair: 1, optimize: 1 },
            byStatus: { promoted: 1, validated: 1 },
            recentPackages: []
          }
        })
      });

      const result = await brainMethods.methods.stats({}, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const stats = (result as { data: Record<string, unknown> }).data;

      expect(stats).toHaveProperty('total');
      expect(stats.total).toBe(2);
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('byStatus');

      // 验证调用了正确的 API
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:42043/api/brain/stats',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('按类别统计应该正确', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            total: 2,
            byCategory: { repair: 1, optimize: 1 },
            byStatus: { promoted: 1, validated: 1 },
            recentPackages: []
          }
        })
      });

      const result = await brainMethods.methods.stats({}, {} as MethodContext);
      const stats = (result as { data: Record<string, unknown> }).data;
      const byCategory = stats.byCategory as Record<string, number>;

      expect(byCategory['repair']).toBe(1);
      expect(byCategory['optimize']).toBe(1);
    });
  });

  describe('brain.list', () => {
    it('应该返回经验包列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            packages: [{ package_id: 'pkg1' }, { package_id: 'pkg2' }],
            total: 2,
            limit: 20,
            offset: 0
          }
        })
      });

      const result = await brainMethods.methods.list({}, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const data = (result as { data: Record<string, unknown> }).data;

      expect(data).toHaveProperty('packages');
      expect(data).toHaveProperty('total');
      expect(data.total).toBe(2);
    });

    it('应该支持按类别筛选', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            packages: [{ pattern: { category: 'repair' } }],
            total: 1,
            limit: 20,
            offset: 0
          }
        })
      });

      const result = await brainMethods.methods.list({ category: 'repair' }, {} as MethodContext);

      const data = (result as { data: Record<string, unknown> }).data;
      const packages = data.packages as Array<{ pattern: { category: string } }>;

      expect(packages).toHaveLength(1);
      expect(packages[0].pattern.category).toBe('repair');

      // 验证 query 参数
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('category=repair'), expect.any(Object));
    });

    it('应该支持分页', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            packages: [{ package_id: 'pkg1' }],
            total: 2,
            limit: 1,
            offset: 0
          }
        })
      });

      const result = await brainMethods.methods.list({ limit: 1, offset: 0 }, {} as MethodContext);

      const data = (result as { data: Record<string, unknown> }).data;
      const packages = data.packages as unknown[];

      expect(packages).toHaveLength(1);
      expect(data.total).toBe(2);

      // 验证 query 参数
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=1'), expect.any(Object));
    });
  });

  describe('brain.get', () => {
    it('应该返回经验包详情', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            package_id: 'test_pkg_001',
            pattern: { name: 'Test Pattern' },
            practice: { name: 'Test Practice' }
          }
        })
      });

      const result = await brainMethods.methods.get({ packageId: 'test_pkg_001' }, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const pkg = (result as { data: Record<string, unknown> }).data;

      expect(pkg.package_id).toBe('test_pkg_001');
      expect(pkg).toHaveProperty('pattern');
      expect(pkg).toHaveProperty('practice');

      // 验证调用了正确的 endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:42043/api/brain/packages/test_pkg_001',
        expect.any(Object)
      );
    });

    it('不存在的经验包应该抛出错误', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found'
      });

      await expect(brainMethods.methods.get({ packageId: 'pkg_999' }, {} as MethodContext)).rejects.toThrow();
    });
  });

  describe('brain.delete', () => {
    it('应该删除经验包', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            package_id: 'test_pkg_temp',
            message: '经验包已删除'
          }
        })
      });

      const result = await brainMethods.methods.delete({ packageId: 'test_pkg_temp' }, {} as MethodContext);

      expect(result).toHaveProperty('ok');
      expect((result as { ok: boolean }).ok).toBe(true);

      // 验证调用了正确的 API
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:42043/api/brain/packages/test_pkg_temp',
        expect.objectContaining({
          method: 'DELETE'
        })
      );
    });

    it('Worker 未启动应该抛出错误', async () => {
      // Mock WorkerManager 返回 undefined
      mockWorkerManager.getInstance = vi.fn(() => ({
        getWorkerInfo: vi.fn(() => undefined)
      }));

      await expect(brainMethods.methods.delete({ packageId: 'pkg_001' }, {} as MethodContext)).rejects.toThrow(
        'Brain Worker not ready'
      );
    });
  });
});
