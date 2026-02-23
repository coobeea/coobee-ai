/**
 * Gateway brain 方法测试
 *
 * 使用临时目录进行测试，避免依赖 Electron 模块
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 创建临时目录
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));

// Mock Env 模块
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userHome: testDir
    },
    main: {
      logLevel: 'info'
    }
  }
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

// 在 mock 之后再导入
const { brainMethods } = await import('../methods/brain');
import type { MethodContext } from '../protocol';

describe('Gateway brain methods', () => {
  const brainDir = path.join(testDir, 'brain');
  const packagesDir = path.join(brainDir, 'packages');

  beforeAll(() => {
    // 创建测试数据
    fs.mkdirSync(packagesDir, { recursive: true });

    // 创建测试经验包
    const pkg1 = {
      package_id: 'test_pkg_001',
      pattern: {
        name: '测试方案 1',
        summary: '这是测试方案',
        category: 'repair',
        signals: ['TimeoutError', 'ConnectionError'],
        strategy: '使用重试机制'
      },
      practice: {
        name: '测试实践 1',
        summary: '实践案例',
        content: '实现代码...',
        confidence: 0.85,
        outcome: '成功率 85%'
      },
      status: 'promoted',
      usage_count: 10,
      created_at: '2026-02-23T10:00:00Z',
      updated_at: '2026-02-23T10:00:00Z'
    };

    const pkg2 = {
      package_id: 'test_pkg_002',
      pattern: {
        name: '测试方案 2',
        summary: '优化方案',
        category: 'optimize',
        signals: ['SlowQuery'],
        strategy: '使用缓存'
      },
      practice: {
        name: '测试实践 2',
        summary: '缓存实践',
        content: '缓存实现...',
        confidence: 0.9,
        outcome: '性能提升 50%'
      },
      status: 'validated',
      usage_count: 5,
      created_at: '2026-02-23T11:00:00Z',
      updated_at: '2026-02-23T11:00:00Z'
    };

    // 写入经验包
    const pkg1Dir = path.join(packagesDir, 'test_pkg_001');
    const pkg2Dir = path.join(packagesDir, 'test_pkg_002');

    fs.mkdirSync(pkg1Dir, { recursive: true });
    fs.mkdirSync(pkg2Dir, { recursive: true });

    fs.writeFileSync(path.join(pkg1Dir, 'package.json'), JSON.stringify(pkg1, null, 2));
    fs.writeFileSync(path.join(pkg2Dir, 'package.json'), JSON.stringify(pkg2, null, 2));
  });

  afterAll(() => {
    // 清理测试数据
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('brain.stats', () => {
    it('应该返回统计信息', async () => {
      const result = await brainMethods.methods.stats({}, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const stats = (result as { data: Record<string, unknown> }).data;

      expect(stats).toHaveProperty('total');
      expect(stats.total).toBe(2);
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('recentPackages');
    });

    it('按类别统计应该正确', async () => {
      const result = await brainMethods.methods.stats({}, {} as MethodContext);
      const stats = (result as { data: Record<string, unknown> }).data;
      const byCategory = stats.byCategory as Record<string, number>;

      expect(byCategory['repair']).toBe(1);
      expect(byCategory['optimize']).toBe(1);
    });
  });

  describe('brain.list', () => {
    it('应该返回经验包列表', async () => {
      const result = await brainMethods.methods.list({}, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const data = (result as { data: Record<string, unknown> }).data;

      expect(data).toHaveProperty('packages');
      expect(data).toHaveProperty('total');
      expect(data.total).toBe(2);
    });

    it('应该支持按类别筛选', async () => {
      const result = await brainMethods.methods.list({ category: 'repair' }, {} as MethodContext);

      const data = (result as { data: Record<string, unknown> }).data;
      const packages = data.packages as Array<{ pattern: { category: string } }>;

      expect(packages).toHaveLength(1);
      expect(packages[0].pattern.category).toBe('repair');
    });

    it('应该支持分页', async () => {
      const result = await brainMethods.methods.list({ limit: 1, offset: 0 }, {} as MethodContext);

      const data = (result as { data: Record<string, unknown> }).data;
      const packages = data.packages as unknown[];

      expect(packages).toHaveLength(1);
      expect(data.total).toBe(2);
    });
  });

  describe('brain.get', () => {
    it('应该返回经验包详情', async () => {
      const result = await brainMethods.methods.get({ packageId: 'test_pkg_001' }, {} as MethodContext);

      expect(result).toHaveProperty('data');
      const pkg = (result as { data: Record<string, unknown> }).data;

      expect(pkg.package_id).toBe('test_pkg_001');
      expect(pkg).toHaveProperty('pattern');
      expect(pkg).toHaveProperty('practice');
    });

    it('不存在的经验包应该抛出错误', async () => {
      await expect(brainMethods.methods.get({ packageId: 'pkg_999' }, {} as MethodContext)).rejects.toThrow(
        '经验包不存在'
      );
    });
  });

  describe('brain.delete', () => {
    it('应该删除经验包', async () => {
      // 先创建一个临时包用于删除
      const tempPkgId = 'test_pkg_temp';
      const tempPkg = {
        package_id: tempPkgId,
        pattern: {
          name: '临时包',
          summary: '用于删除测试',
          category: 'repair',
          signals: [],
          strategy: 'test'
        },
        practice: {
          name: '临时实践',
          summary: 'test',
          content: 'test',
          confidence: 0.8,
          outcome: 'test'
        },
        status: 'candidate',
        usage_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const tempPkgDir = path.join(packagesDir, tempPkgId);
      fs.mkdirSync(tempPkgDir, { recursive: true });
      fs.writeFileSync(path.join(tempPkgDir, 'package.json'), JSON.stringify(tempPkg, null, 2));

      // 删除
      const result = await brainMethods.methods.delete({ packageId: tempPkgId }, {} as MethodContext);

      expect(result).toHaveProperty('ok');
      expect((result as { ok: boolean }).ok).toBe(true);

      // 验证文件已删除
      expect(fs.existsSync(tempPkgDir)).toBe(false);
    });
  });
});
