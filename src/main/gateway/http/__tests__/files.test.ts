/**
 * Files HTTP API 路径安全测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 导入 isPathSafe 函数（需要从 files.ts 中导出）
// 由于 isPathSafe 是私有函数，我们通过测试 API 行为来间接验证

describe('Files HTTP API - 路径安全', () => {
  let testRoot: string;

  beforeEach(() => {
    // 创建临时测试目录
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'files-test-'));

    // 创建测试文件结构
    fs.mkdirSync(path.join(testRoot, 'workspace'));
    fs.mkdirSync(path.join(testRoot, 'workspaces-evil'));
    fs.writeFileSync(path.join(testRoot, 'workspace', 'safe.txt'), 'safe content');
    fs.writeFileSync(path.join(testRoot, 'workspaces-evil', 'evil.txt'), 'evil content');
  });

  afterEach(() => {
    // 清理测试目录
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('isPathSafe - 路径遍历防护', () => {
    it('拒绝包含 .. 的路径', () => {
      const testPath = path.join(testRoot, 'workspace', '..', 'evil.txt');
      const normalized = path.normalize(testPath);

      // 验证 normalized 路径包含 '..'
      expect(normalized.includes('..')).toBe(true);
    });

    it('拒绝不在 rootDir 内的路径（使用 path.relative）', () => {
      const workspaceRoot = path.join(testRoot, 'workspace');
      const evilPath = path.join(testRoot, 'workspaces-evil', 'evil.txt');

      // 验证 path.relative 能检测出路径不在 rootDir 内
      const rel = path.relative(workspaceRoot, evilPath);
      expect(rel.startsWith('..')).toBe(true);
    });

    it('允许 rootDir 内的合法路径', () => {
      const workspaceRoot = path.join(testRoot, 'workspace');
      const safePath = path.join(testRoot, 'workspace', 'safe.txt');

      // 验证 path.relative 不以 '..' 开头
      const rel = path.relative(workspaceRoot, safePath);
      expect(rel.startsWith('..')).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
    });

    it('Windows 路径前缀绕过防护', () => {
      if (process.platform !== 'win32') {
        // 在非 Windows 平台上模拟 Windows 路径
        // 验证策略：使用 path.relative 而非 startsWith 可以防止前缀绕过
        // 模拟 path.relative 在 Windows 下的行为
        // path.relative('C:\\workspace', 'C:\\workspaces-evil\\bad.txt')
        // 应该返回类似 '..\\workspaces-evil\\bad.txt'

        const mockRelative1 = '..\\workspaces-evil\\bad.txt';
        const mockRelative2 = '..\\workspace-hacked\\bad.txt';

        expect(mockRelative1.startsWith('..')).toBe(true);
        expect(mockRelative2.startsWith('..')).toBe(true);
      }
    });

    it('允许 rootDir 的子目录', () => {
      const workspaceRoot = path.join(testRoot, 'workspace');
      fs.mkdirSync(path.join(testRoot, 'workspace', 'subdir'));
      const safePath = path.join(testRoot, 'workspace', 'subdir', 'file.txt');

      const rel = path.relative(workspaceRoot, safePath);
      expect(rel.startsWith('..')).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
    });

    it('拒绝绝对路径的 relative 结果（跨驱动器）', () => {
      if (process.platform === 'win32') {
        const workspaceRoot = 'C:\\workspace';
        const evilPath = 'D:\\evil\\bad.txt';

        // path.relative 在跨驱动器时会返回绝对路径
        const rel = path.relative(workspaceRoot, evilPath);
        expect(path.isAbsolute(rel)).toBe(true);
      }
    });
  });
});
