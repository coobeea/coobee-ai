/**
 * memory 工具单元测试
 *
 * 测试 memory 工具（双层记忆管理）：
 *   - scope: agent / session / 默认(双层)
 *   - list, get, write, search
 *   - 路径穿越检查、参数校验
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { memoryTool } from '../builtin/memory';

vi.mock('@main/common/logger', () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  return { log, createLogger: vi.fn(() => log) };
});

const TEST_BASE = path.join(os.tmpdir(), `memory-test-coobee-${process.pid}`);

vi.mock('@main/common/env', () => ({
  Env: { paths: {} }
}));

async function consumeGenerator(
  gen: AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>
): Promise<{ updates: ToolStreamUpdate[]; result: ToolResult }> {
  const updates: ToolStreamUpdate[] = [];
  let next = await gen.next();
  while (!next.done) {
    updates.push(next.value);
    next = await gen.next();
  }
  return { updates, result: next.value };
}

function makeSessionContext(workspaceRoot: string, agentId?: string): ToolExecutionContext {
  return {
    workspaceRoot,
    agentId,
    userHome: TEST_BASE,
    mode: 'path-only',
    toolPolicy: { allow: [], deny: [], confirm: [] },
    sessionId: 'test-session',
    threadId: 'test-session',
    cwd: workspaceRoot,
    tasksDir: path.join(workspaceRoot, 'tasks'),
    sessionsDir: path.join(workspaceRoot, '.runtime', 'sessions'),
    contextsDir: path.join(workspaceRoot, '.runtime', 'contexts'),
    eventsDir: path.join(workspaceRoot, '.runtime', 'events'),
    configDir: path.join(TEST_BASE, 'config'),
    tempDir: os.tmpdir(),
    agentName: 'test-agent',
    agentMode: 'agent'
  } as ToolExecutionContext;
}

let workspace: string;
let sessionMemDir: string;
let agentMemDir: string;

function setup(): void {
  workspace = path.join(TEST_BASE, 'workspace');
  sessionMemDir = path.join(workspace, 'memory');
  agentMemDir = path.join(TEST_BASE, 'homes', 'test-bot', 'memory');
  fs.mkdirSync(sessionMemDir, { recursive: true });
  fs.mkdirSync(agentMemDir, { recursive: true });
}

function cleanup(): void {
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true });
  }
}

describe('memoryTool', () => {
  beforeEach(setup);
  afterEach(cleanup);

  const ctx = (): ToolExecutionContext => makeSessionContext(workspace, 'test-bot');

  // ==================== list ====================

  describe('action=list', () => {
    it('空目录时返回 No memory files', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list' }, undefined, ctx()));
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('No memory files');
    });

    it('列出 session 级记忆文件', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), '# Notes');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'list', scope: 'session' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[session]');
      expect(result.llmContent).toContain('notes.md');
    });

    it('列出 agent 级记忆文件', async () => {
      fs.mkdirSync(path.join(agentMemDir, 'entries', 'preference'), { recursive: true });
      fs.writeFileSync(path.join(agentMemDir, 'entries', 'preference', '2026-03.md'), '# Pref');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'list', scope: 'agent' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[agent]');
      expect(result.llmContent).toContain('2026-03.md');
    });

    it('默认同时列出两层', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'session-note.md'), '# Session');
      fs.writeFileSync(path.join(agentMemDir, 'agent-note.md'), '# Agent');
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list' }, undefined, ctx()));
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[session]');
      expect(result.llmContent).toContain('[agent]');
      expect(result.llmContent).toContain('2 files');
    });

    it('list 跳过隐藏目录', async () => {
      fs.mkdirSync(path.join(sessionMemDir, '.hidden'), { recursive: true });
      fs.writeFileSync(path.join(sessionMemDir, '.hidden', 'secret.md'), 'secret');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'list', scope: 'session' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).not.toContain('.hidden');
    });

    it('list 只列出支持的扩展名', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), '# Notes');
      fs.writeFileSync(path.join(sessionMemDir, 'binary.exe'), 'binary');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'list', scope: 'session' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).not.toContain('binary.exe');
    });
  });

  // ==================== get ====================

  describe('action=get', () => {
    it('读取 session 级文件', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), '# My Notes\n\nContent.');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'get', file: 'notes.md' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('# My Notes');
    });

    it('读取 agent 级文件', async () => {
      fs.mkdirSync(path.join(agentMemDir, 'index'), { recursive: true });
      fs.writeFileSync(path.join(agentMemDir, 'index', 'preference.md'), '# Preferences\n\nDark mode');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'get', scope: 'agent', file: 'index/preference.md' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Dark mode');
    });

    it('文件不存在时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'get', file: 'nonexistent.md' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('路径穿越检查：拒绝 ../ 逃逸', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'get', file: '../../../etc/passwd' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });

    it('get 文件过大 (TOO_LARGE)', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'large.md'), 'x'.repeat(101 * 1024));
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'get', file: 'large.md' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOO_LARGE');
    });
  });

  // ==================== write ====================

  describe('action=write', () => {
    it('创建 session 级新文件', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'new-note.md', content: '# New Note' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toMatch(/created/);
      const filePath = path.join(sessionMemDir, 'new-note.md');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toContain('# New Note');
    });

    it('scope=agent 写入时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', scope: 'agent', file: 'hack.md', content: 'nope' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('READONLY_SCOPE');
    });

    it('更新已有文件', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'existing.md'), 'old content');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'existing.md', content: 'new content' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(sessionMemDir, 'existing.md'), 'utf-8')).toContain('new content');
    });

    it('Markdown 文件自动添加 frontmatter', async () => {
      await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'note.md', content: '# Title' }, undefined, ctx())
      );
      const written = fs.readFileSync(path.join(sessionMemDir, 'note.md'), 'utf-8');
      expect(written).toMatch(/^---\s*\nupdated:/);
    });

    it('非 Markdown 文件不添加 frontmatter', async () => {
      await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'data.json', content: '{"key": "value"}' }, undefined, ctx())
      );
      const written = fs.readFileSync(path.join(sessionMemDir, 'data.json'), 'utf-8');
      expect(written).toBe('{"key": "value"}');
    });

    it('创建嵌套目录下的文件', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'deep/nested/file.md', content: 'nested' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(sessionMemDir, 'deep', 'nested', 'file.md'))).toBe(true);
    });

    it('write 路径穿越：拒绝 ../ 逃逸', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: '../../../etc/passwd', content: 'hack' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });

    it('write 路径穿越：拒绝绝对路径', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: '/etc/passwd', content: 'hack' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });
  });

  // ==================== search ====================

  describe('action=search', () => {
    it('搜索 session 级记忆', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), 'line1\nkeyword here\nline3');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', scope: 'session', query: 'keyword' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[session]');
      expect(result.llmContent).toContain('keyword');
    });

    it('搜索 agent 级记忆', async () => {
      fs.mkdirSync(path.join(agentMemDir, 'entries', 'preference'), { recursive: true });
      fs.writeFileSync(
        path.join(agentMemDir, 'entries', 'preference', '2026-03.md'),
        '# Preference\n\nUser prefers dark mode'
      );
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', scope: 'agent', query: 'dark mode' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[agent]');
      expect(result.llmContent).toContain('dark mode');
    });

    it('默认搜索两层', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'session.md'), 'session keyword data');
      fs.writeFileSync(path.join(agentMemDir, 'agent.md'), 'agent keyword data');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'keyword' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[session]');
      expect(result.llmContent).toContain('[agent]');
      expect(result.llmContent).toContain('2 matches');
    });

    it('无匹配时返回 No matches', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), 'some content');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'nonexistentkeyword' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('No matches found');
    });

    it('搜索大小写不敏感', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), 'KEYWORD in uppercase');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'keyword' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('KEYWORD');
    });

    it('多关键字搜索', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'notes.md'), '# TypeScript Config\n\nUse strict mode.');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'TypeScript strict' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('relevance:');
    });

    it('搜索返回 section 信息', async () => {
      fs.writeFileSync(
        path.join(sessionMemDir, 'knowledge.md'),
        '# Project\n\n## Tech Stack\n\nElectron + Vue 3\n\n## Build\n\npnpm build'
      );
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'Electron' }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Tech Stack');
    });
  });

  // ==================== append 模式 ====================

  describe('append 模式', () => {
    it('append=true 追加而非覆盖', async () => {
      fs.writeFileSync(path.join(sessionMemDir, 'log.md'), 'Line 1\n');
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'log.md', content: 'Line 2', append: true }, undefined, ctx())
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('appended');
      const content = fs.readFileSync(path.join(sessionMemDir, 'log.md'), 'utf-8');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });

    it('append=true 文件不存在时降级为创建', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute(
          { action: 'write', file: 'new-append.md', content: 'First entry', append: true },
          undefined,
          ctx()
        )
      );
      expect(result.success).toBe(true);
    });
  });

  // ==================== 参数校验 ====================

  describe('参数校验', () => {
    it('get 缺少 file 时返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'get' }, undefined, ctx()));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
    });

    it('write 缺少 file 时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', content: 'content' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
    });

    it('write 缺少 content 时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'note.md' }, undefined, ctx())
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
    });

    it('search 缺少 query 时返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'search' }, undefined, ctx()));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
    });

    it('未知 action 返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'invalid_action' }, undefined, ctx()));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ACTION');
    });

    it('无 context 时返回初始化错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list' }));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_INITIALIZED');
    });
  });

  // ==================== 流式输出 ====================

  describe('流式输出', () => {
    it('list 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(memoryTool.execute({ action: 'list' }, undefined, ctx()));
      expect(updates.some((u) => u.type === 'progress')).toBe(true);
    });

    it('write 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(
        memoryTool.execute({ action: 'write', file: 'p.md', content: 'x' }, undefined, ctx())
      );
      expect(updates.some((u) => u.type === 'progress')).toBe(true);
    });

    it('search 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(
        memoryTool.execute({ action: 'search', query: 'test' }, undefined, ctx())
      );
      expect(updates.some((u) => u.type === 'progress')).toBe(true);
    });
  });

  // ==================== 元数据 ====================

  describe('元数据', () => {
    it('工具名称为 memory，分类为 Memory', () => {
      expect(memoryTool.name).toBe('memory');
      expect(memoryTool.category).toBe(ToolCategory.Memory);
    });

    it('needUserConfirm 为 false', () => {
      expect(memoryTool.needUserConfirm).toBe(false);
    });
  });
});
