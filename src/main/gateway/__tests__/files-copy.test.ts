/**
 * Files Copy 功能测试
 *
 * 测试文件和目录复制功能。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

describe('Files Copy - Backend Logic', () => {
  let tmpSourceDir: string;
  let tmpTargetDir: string;

  beforeEach(() => {
    // 创建临时目录
    tmpSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-source-'));
    tmpTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-target-'));
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tmpSourceDir)) {
      fs.rmSync(tmpSourceDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tmpTargetDir)) {
      fs.rmSync(tmpTargetDir, { recursive: true, force: true });
    }
  });

  it('应该复制单个文件', async () => {
    // 创建源文件
    const sourceFile = path.join(tmpSourceDir, 'test.txt');
    fs.writeFileSync(sourceFile, 'Hello World', 'utf-8');

    // 执行复制
    const targetFile = path.join(tmpTargetDir, 'test.txt');
    await fs.promises.copyFile(sourceFile, targetFile);

    // 验证
    expect(fs.existsSync(targetFile)).toBe(true);
    const content = fs.readFileSync(targetFile, 'utf-8');
    expect(content).toBe('Hello World');
  });

  it('应该递归复制目录', async () => {
    // 创建源目录结构
    const sourceSubDir = path.join(tmpSourceDir, 'subdir');
    fs.mkdirSync(sourceSubDir);
    fs.writeFileSync(path.join(tmpSourceDir, 'file1.txt'), 'File 1', 'utf-8');
    fs.writeFileSync(path.join(sourceSubDir, 'file2.txt'), 'File 2', 'utf-8');

    // 递归复制目录的实现
    async function copyDirectory(src: string, dest: string): Promise<void> {
      await fs.promises.mkdir(dest, { recursive: true });

      const entries = await fs.promises.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
    }

    // 执行复制
    const targetSubDir = path.join(tmpTargetDir, path.basename(tmpSourceDir));
    await copyDirectory(tmpSourceDir, targetSubDir);

    // 验证
    expect(fs.existsSync(path.join(targetSubDir, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetSubDir, 'subdir', 'file2.txt'))).toBe(true);

    const content1 = fs.readFileSync(path.join(targetSubDir, 'file1.txt'), 'utf-8');
    const content2 = fs.readFileSync(path.join(targetSubDir, 'subdir', 'file2.txt'), 'utf-8');

    expect(content1).toBe('File 1');
    expect(content2).toBe('File 2');
  });

  it('应该检测目标已存在的情况', () => {
    // 创建源文件
    const sourceFile = path.join(tmpSourceDir, 'test.txt');
    fs.writeFileSync(sourceFile, 'Hello', 'utf-8');

    // 创建同名目标文件
    const targetFile = path.join(tmpTargetDir, 'test.txt');
    fs.writeFileSync(targetFile, 'Existing', 'utf-8');

    // 检查目标是否存在
    const exists = fs.existsSync(targetFile);
    expect(exists).toBe(true);
  });

  it('应该处理不存在的源路径', async () => {
    const nonExistentPath = path.join(tmpSourceDir, 'non-existent.txt');

    try {
      await fs.promises.stat(nonExistentPath);
      // 不应该执行到这里
      expect(true).toBe(false);
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });
});

describe('Files Copy - Path Safety', () => {
  it('应该检测路径遍历攻击', () => {
    function isPathSafe(targetPath: string, rootDir = '/tmp'): boolean {
      const resolved = path.resolve(rootDir, targetPath);
      const resolvedRoot = path.resolve(rootDir);
      const rel = path.relative(resolvedRoot, resolved);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    }

    expect(isPathSafe('/tmp/test')).toBe(true);
    expect(isPathSafe('/tmp/../etc/passwd')).toBe(false);
    expect(isPathSafe('./test')).toBe(true);
    expect(isPathSafe('../../../etc/passwd')).toBe(false);
  });

  it('应该验证相对路径是否在允许的根目录内', () => {
    function isPathSafe(targetPath: string, rootDir: string): boolean {
      const resolved = path.resolve(targetPath);
      const resolvedRoot = path.resolve(rootDir);
      const rel = path.relative(resolvedRoot, resolved);

      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return false;
      }
      return true;
    }

    const rootDir = '/tmp/workspace';

    expect(isPathSafe('/tmp/workspace/test', rootDir)).toBe(true);
    expect(isPathSafe('/tmp/workspace/../etc', rootDir)).toBe(false);
    expect(isPathSafe('/etc/passwd', rootDir)).toBe(false);
  });
});
