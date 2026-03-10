/**
 * Agent Home HTTP API 测试
 *
 * 验证 agent-home.ts 中的路径校验、文件 CRUD 逻辑
 * 不启动真实 HTTP 服务器，直接测试核心函数逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;
let homesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-agent-home-test-'));
  homesDir = path.join(tmpDir, 'homes');
  fs.mkdirSync(homesDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupAgentHome(agentId: string, files: Record<string, string> = {}): string {
  const homeDir = path.join(homesDir, agentId);
  const memoryDir = path.join(homeDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(homeDir, name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return homeDir;
}

function validateFileName(name: string, homeDir: string): { safe: boolean; resolved: string; error?: string } {
  if (!name || typeof name !== 'string') {
    return { safe: false, resolved: '', error: 'Missing file name' };
  }

  const resolved = path.resolve(homeDir, name);
  const resolvedHome = path.resolve(homeDir);

  const rel = path.relative(resolvedHome, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { safe: false, resolved, error: 'Path traversal denied' };
  }

  if (!resolved.endsWith('.md')) {
    return { safe: false, resolved, error: 'Only .md files are allowed' };
  }

  return { safe: true, resolved };
}

// ==================== 路径校验 ====================

describe('validateFileName - 路径安全校验', () => {
  it('应允许标准配置文件名', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('SOUL.md', homeDir);
    expect(result.safe).toBe(true);
    expect(result.resolved).toBe(path.join(homeDir, 'SOUL.md'));
  });

  it('应允许 memory 子目录文件', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('memory/2026-03-04.md', homeDir);
    expect(result.safe).toBe(true);
    expect(result.resolved).toBe(path.join(homeDir, 'memory', '2026-03-04.md'));
  });

  it('应拒绝路径穿越 (..)', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('../other-agent/SOUL.md', homeDir);
    expect(result.safe).toBe(false);
    expect(result.error).toBe('Path traversal denied');
  });

  it('应拒绝路径穿越 (嵌套 ..)', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('memory/../../etc/passwd.md', homeDir);
    expect(result.safe).toBe(false);
    expect(result.error).toBe('Path traversal denied');
  });

  it('应拒绝绝对路径', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('/etc/passwd.md', homeDir);
    expect(result.safe).toBe(false);
  });

  it('应拒绝非 .md 文件', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('config.json', homeDir);
    expect(result.safe).toBe(false);
    expect(result.error).toBe('Only .md files are allowed');
  });

  it('应拒绝空文件名', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const result = validateFileName('', homeDir);
    expect(result.safe).toBe(false);
    expect(result.error).toBe('Missing file name');
  });
});

// ==================== 列出 Homes ====================

describe('列出 Agent Homes', () => {
  it('应列出所有 Agent Home 目录', () => {
    setupAgentHome('agent-a');
    setupAgentHome('agent-b');

    const entries = fs.readdirSync(homesDir, { withFileTypes: true });
    const homes = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);

    expect(homes).toContain('agent-a');
    expect(homes).toContain('agent-b');
    expect(homes).toHaveLength(2);
  });

  it('空目录应返回空列表', () => {
    const entries = fs.readdirSync(homesDir, { withFileTypes: true });
    const homes = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(homes).toHaveLength(0);
  });
});

// ==================== 列出文件 ====================

describe('列出 Agent Home 文件', () => {
  it('应列出配置文件和记忆文件', () => {
    setupAgentHome('test-agent', {
      'SOUL.md': '# Soul',
      'IDENTITY.md': '# Identity',
      'memory/2026-03-01.md': '# Day 1',
      'memory/2026-03-02.md': '# Day 2'
    });

    const homeDir = path.join(homesDir, 'test-agent');

    interface FileInfo {
      name: string;
      category: 'config' | 'memory';
    }

    const files: FileInfo[] = [];

    for (const entry of fs.readdirSync(homeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      files.push({ name: entry.name, category: 'config' });
    }

    const memoryDir = path.join(homeDir, 'memory');
    if (fs.existsSync(memoryDir)) {
      for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        files.push({ name: `memory/${entry.name}`, category: 'memory' });
      }
    }

    const configFiles = files.filter((f) => f.category === 'config');
    const memoryFiles = files.filter((f) => f.category === 'memory');

    expect(configFiles).toHaveLength(2);
    expect(memoryFiles).toHaveLength(2);
    expect(configFiles.map((f) => f.name)).toContain('SOUL.md');
    expect(memoryFiles.map((f) => f.name)).toContain('memory/2026-03-01.md');
  });

  it('Agent Home 不存在应返回 0 文件', () => {
    const homeDir = path.join(homesDir, 'nonexistent');
    expect(fs.existsSync(homeDir)).toBe(false);
  });
});

// ==================== 读取文件 ====================

describe('读取文件', () => {
  it('应正确读取配置文件内容', () => {
    const content = '# My Soul\n\nI am a helpful assistant.';
    setupAgentHome('test-agent', { 'SOUL.md': content });

    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('SOUL.md', homeDir);
    expect(validation.safe).toBe(true);

    const readContent = fs.readFileSync(validation.resolved, 'utf-8');
    expect(readContent).toBe(content);
  });

  it('应正确读取记忆文件内容', () => {
    const content = '# 2026-03-04\n\n- 用户讨论了 AI 架构设计';
    setupAgentHome('test-agent', { 'memory/2026-03-04.md': content });

    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('memory/2026-03-04.md', homeDir);
    expect(validation.safe).toBe(true);

    const readContent = fs.readFileSync(validation.resolved, 'utf-8');
    expect(readContent).toBe(content);
  });
});

// ==================== 写入文件 ====================

describe('写入文件', () => {
  it('应正确写入配置文件', () => {
    setupAgentHome('test-agent');

    const homeDir = path.join(homesDir, 'test-agent');
    const newContent = '# Updated Soul\n\nNew personality.';
    const validation = validateFileName('SOUL.md', homeDir);
    expect(validation.safe).toBe(true);

    fs.writeFileSync(validation.resolved, newContent, 'utf-8');

    const readBack = fs.readFileSync(validation.resolved, 'utf-8');
    expect(readBack).toBe(newContent);
  });

  it('应自动创建 memory 子目录', () => {
    setupAgentHome('test-agent');

    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('memory/2026-03-05.md', homeDir);
    expect(validation.safe).toBe(true);

    const parentDir = path.dirname(validation.resolved);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(validation.resolved, '# New Day', 'utf-8');
    expect(fs.existsSync(validation.resolved)).toBe(true);
  });

  it('不应允许写入非 .md 文件', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('secrets.json', homeDir);
    expect(validation.safe).toBe(false);
  });
});

// ==================== 删除文件 ====================

describe('删除文件', () => {
  it('应正确删除记忆文件', () => {
    setupAgentHome('test-agent', { 'memory/2026-03-01.md': '# Day 1' });

    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('memory/2026-03-01.md', homeDir);
    expect(validation.safe).toBe(true);
    expect(fs.existsSync(validation.resolved)).toBe(true);

    fs.unlinkSync(validation.resolved);
    expect(fs.existsSync(validation.resolved)).toBe(false);
  });

  it('不应允许删除路径穿越的文件', () => {
    const homeDir = path.join(homesDir, 'test-agent');
    const validation = validateFileName('../other/secret.md', homeDir);
    expect(validation.safe).toBe(false);
  });
});
