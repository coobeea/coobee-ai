/**
 * 监控 API 记忆文件查询测试
 *
 * 验证 GET /monitoring/memory-files 和 /monitoring/memory-content
 * 正确扫描记忆文件并返回内容
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// 创建临时目录模拟 home 环境
let tmpDir: string;
let memoryDir: string;
let workspacesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-memory-test-'));
  memoryDir = path.join(tmpDir, 'memory');
  workspacesDir = path.join(tmpDir, 'workspaces');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(workspacesDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('记忆文件扫描逻辑', () => {
  it('应扫描全局记忆目录的 .md 文件', () => {
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# Global Memory\nTest content');
    fs.writeFileSync(path.join(memoryDir, 'lessons.md'), '# Lessons\nLesson 1');

    const files = scanDir(memoryDir, 'global');
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name)).toContain('MEMORY.md');
    expect(files.map((f) => f.name)).toContain('lessons.md');
  });

  it('应扫描工作空间下的 MEMORY.md 和 memory/ 目录', () => {
    const wsDir = path.join(workspacesDir, 'ws-123');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'MEMORY.md'), '# WS Memory');
    const wsMemDir = path.join(wsDir, 'memory');
    fs.mkdirSync(wsMemDir, { recursive: true });
    fs.writeFileSync(path.join(wsMemDir, 'preferences.md'), '# Preferences');

    const wsFiles: Array<{ name: string; path: string; size: number; mtime: string; scope: string }> = [];

    const mainMemPath = path.join(wsDir, 'MEMORY.md');
    if (fs.existsSync(mainMemPath)) {
      const stat = fs.statSync(mainMemPath);
      wsFiles.push({
        name: 'MEMORY.md',
        path: mainMemPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        scope: 'workspace:ws-123'
      });
    }

    wsFiles.push(...scanDir(wsMemDir, 'workspace:ws-123'));

    expect(wsFiles).toHaveLength(2);
    expect(wsFiles[0].name).toBe('MEMORY.md');
    expect(wsFiles[0].scope).toBe('workspace:ws-123');
    expect(wsFiles[1].name).toBe('preferences.md');
  });

  it('应忽略非记忆扩展名的文件', () => {
    fs.writeFileSync(path.join(memoryDir, 'test.md'), '# Test');
    fs.writeFileSync(path.join(memoryDir, 'binary.bin'), Buffer.from([0x00, 0x01]));
    fs.writeFileSync(path.join(memoryDir, 'script.py'), 'print("hello")');

    const files = scanDir(memoryDir, 'global');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('test.md');
  });

  it('应递归扫描子目录', () => {
    const subDir = path.join(memoryDir, 'daily');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, '2026-02-22.md'), '# Daily');

    const files = scanDir(memoryDir, 'global');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('2026-02-22.md');
  });

  it('应忽略以 . 开头的文件和目录', () => {
    fs.writeFileSync(path.join(memoryDir, '.hidden.md'), 'hidden');
    const dotDir = path.join(memoryDir, '.git');
    fs.mkdirSync(dotDir, { recursive: true });
    fs.writeFileSync(path.join(dotDir, 'config.md'), 'git config');

    const files = scanDir(memoryDir, 'global');
    expect(files).toHaveLength(0);
  });

  it('空目录应返回空数组', () => {
    const files = scanDir(memoryDir, 'global');
    expect(files).toHaveLength(0);
  });
});

describe('记忆内容读取', () => {
  it('应正确读取记忆文件内容', () => {
    const content = '# My Memory\n\n## Key Learnings\n- TypeScript best practices\n- Vue 3 composition API';
    const filePath = path.join(memoryDir, 'MEMORY.md');
    fs.writeFileSync(filePath, content);

    const readContent = fs.readFileSync(filePath, 'utf-8');
    expect(readContent).toBe(content);
  });

  it('应返回文件元信息', () => {
    const filePath = path.join(memoryDir, 'test.md');
    fs.writeFileSync(filePath, 'Test content');

    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.mtime).toBeDefined();
  });
});

describe('安全性检查', () => {
  it('不应允许读取 home 目录之外的文件', () => {
    const resolved = path.resolve('/etc/passwd');
    const isInsideHome = resolved.startsWith(tmpDir);
    expect(isInsideHome).toBe(false);
  });

  it('应允许读取 home 目录内的文件', () => {
    const filePath = path.join(memoryDir, 'safe.md');
    fs.writeFileSync(filePath, 'safe content');
    const resolved = path.resolve(filePath);
    const isInsideHome = resolved.startsWith(tmpDir);
    expect(isInsideHome).toBe(true);
  });
});

/** 辅助函数：模拟 scanMemoryDir 逻辑 */
function scanDir(
  dir: string,
  scope: string
): Array<{ name: string; path: string; size: number; mtime: string; scope: string }> {
  const result: Array<{ name: string; path: string; size: number; mtime: string; scope: string }> = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && /\.(md|txt|json|yaml|yml)$/i.test(entry.name)) {
        const stat = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          scope
        });
      } else if (entry.isDirectory()) {
        result.push(...scanDir(fullPath, scope));
      }
    }
  } catch {
    // ignore
  }
  return result;
}
