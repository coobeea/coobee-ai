/**
 * memory 工具单元测试
 *
 * 测试 memory 工具（持久化记忆管理）：
 *   - list, get, write, search
 *   - scope (user/agent)
 *   - 路径穿越检查、参数校验
 *
 * Mock Env 使用临时目录，beforeEach 创建、afterEach 清理。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';
import { memoryTool } from '../builtin/memory';
import type { ToolExecutionContext } from '../types';
import { createFallbackToolContext } from '../../runtime/shared/ToolExecutionPipeline';

function makeContext(workspaceRoot: string): ToolExecutionContext {
  return createFallbackToolContext({ workspaceRoot });
}

vi.mock('@main/common/logger', () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  return { log, createLogger: vi.fn(() => log) };
});

// 使用唯一临时目录，避免并行测试冲突
const TEST_BASE = path.join(os.tmpdir(), `memory-test-coobee-${process.pid}`);

vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userMemoryDir: path.join(TEST_BASE, 'user'),
      agentMemoryDir: path.join(TEST_BASE, 'agent')
    }
  }
}));

/**
 * 消费 AsyncGenerator，收集 yield 的更新和最终结果
 */
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

function ensureTestDirs(): void {
  fs.mkdirSync(path.join(TEST_BASE, 'user'), { recursive: true });
  fs.mkdirSync(path.join(TEST_BASE, 'agent'), { recursive: true });
}

function cleanupTestDirs(): void {
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true });
  }
}

describe('memoryTool', () => {
  beforeEach(() => {
    ensureTestDirs();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  // ==================== action=list ====================

  describe('action=list', () => {
    it('空目录时返回 No memory files', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('No memory files');
      expect(result.llmContent).toContain('user');
    });

    it('有文件时列出记忆文件', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'notes.md'), '# Notes\ncontent');
      fs.writeFileSync(path.join(userDir, 'data.json'), '{}');

      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Memory files');
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('data.json');
      expect(result.llmContent).toContain('2 files');
    });

    it('支持嵌套目录', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.mkdirSync(path.join(userDir, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(userDir, 'subdir', 'nested.md'), 'nested');

      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('subdir/nested.md');
    });

    it('list 跳过隐藏目录', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.mkdirSync(path.join(userDir, '.hidden'), { recursive: true });
      fs.writeFileSync(path.join(userDir, '.hidden', 'secret.md'), 'secret');

      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).not.toContain('.hidden');
      expect(result.llmContent).not.toContain('secret.md');
    });

    it('list 只列出支持的扩展名', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'notes.md'), '# Notes');
      fs.writeFileSync(path.join(userDir, 'data.json'), '{}');
      fs.writeFileSync(path.join(userDir, 'binary.exe'), 'binary');
      fs.writeFileSync(path.join(userDir, 'image.png'), 'png');

      const { result } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('data.json');
      expect(result.llmContent).not.toContain('binary.exe');
      expect(result.llmContent).not.toContain('image.png');
    });
  });

  // ==================== action=get ====================

  describe('action=get', () => {
    it('正常读取文件内容', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      const content = '# My Notes\n\nSome content here.';
      fs.writeFileSync(path.join(userDir, 'notes.md'), content);

      const { result } = await consumeGenerator(memoryTool.execute({ action: 'get', scope: 'user', file: 'notes.md' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[user/notes.md]');
      expect(result.llmContent).toContain('# My Notes');
      expect(result.llmContent).toContain('Some content here.');
    });

    it('文件不存在时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'get',
          scope: 'user',
          file: 'nonexistent.md'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.llmContent).toContain('not found');
    });

    it('路径穿越检查：拒绝 ../ 逃逸', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'get',
          scope: 'user',
          file: '../../../etc/passwd'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
      expect(result.llmContent).toContain('path escapes');
    });

    it('路径穿越检查：拒绝子目录 ../ 逃逸', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.mkdirSync(path.join(userDir, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(userDir, 'subdir', 'ok.md'), 'ok');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'get',
          scope: 'user',
          file: 'subdir/../../etc/passwd'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });

    it('get 文件过大 (TOO_LARGE)', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      const largeContent = 'x'.repeat(101 * 1024); // > 100KB
      fs.writeFileSync(path.join(userDir, 'large.md'), largeContent);

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'get',
          scope: 'user',
          file: 'large.md'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOO_LARGE');
      expect(result.llmContent?.toLowerCase()).toMatch(/too large|max/);
    });

    it('get 支持子目录文件', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.mkdirSync(path.join(userDir, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(userDir, 'subdir', 'note.md'), '# Subdir Note\ncontent');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'get',
          scope: 'user',
          file: 'subdir/note.md'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('[user/subdir/note.md]');
      expect(result.llmContent).toContain('# Subdir Note');
      expect(result.llmContent).toContain('content');
    });
  });

  // ==================== action=write ====================

  describe('action=write', () => {
    it('创建新文件', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'new-note.md',
          content: '# New Note\n\nHello world.'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toMatch(/created|updated/);
      expect(result.llmContent).toContain('user/new-note.md');

      const filePath = path.join(TEST_BASE, 'user', 'new-note.md');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toContain('# New Note');
    });

    it('更新已有文件', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'existing.md'), 'old content');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'existing.md',
          content: 'new content'
        })
      );

      expect(result.success).toBe(true);
      const filePath = path.join(userDir, 'existing.md');
      expect(fs.readFileSync(filePath, 'utf-8')).toContain('new content');
    });

    it('Markdown 文件自动添加 frontmatter（无 --- 时）', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'note.md',
          content: '# Title\n\nBody text.'
        })
      );

      expect(result.success).toBe(true);
      const filePath = path.join(TEST_BASE, 'user', 'note.md');
      const written = fs.readFileSync(filePath, 'utf-8');
      expect(written).toMatch(/^---\s*\nupdated:/);
      expect(written).toContain('# Title');
      expect(written).toContain('Body text.');
    });

    it('Markdown 文件已有 frontmatter 时不重复添加', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'with-frontmatter.md',
          content: '---\ntitle: Test\n---\n\n# Body'
        })
      );

      expect(result.success).toBe(true);
      const filePath = path.join(TEST_BASE, 'user', 'with-frontmatter.md');
      const written = fs.readFileSync(filePath, 'utf-8');
      expect(written).toMatch(/^---\s*\ntitle: Test\s*\n---/);
      expect(written).not.toMatch(/updated:.*\n---\s*\n---/);
    });

    it('创建嵌套目录下的文件', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'deep/nested/file.md',
          content: 'nested'
        })
      );

      expect(result.success).toBe(true);
      const filePath = path.join(TEST_BASE, 'user', 'deep', 'nested', 'file.md');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('write 路径穿越：拒绝 ../ 逃逸', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: '../../../etc/passwd',
          content: 'hack'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });

    it('write 路径穿越：拒绝绝对路径', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: '/etc/passwd',
          content: 'hack'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PATH');
    });

    it('write 非 Markdown 文件不添加 frontmatter', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'data.json',
          content: '{"key": "value"}'
        })
      );

      expect(result.success).toBe(true);
      const filePath = path.join(TEST_BASE, 'user', 'data.json');
      const written = fs.readFileSync(filePath, 'utf-8');
      expect(written).not.toMatch(/---\s*\nupdated:/);
      expect(written).toBe('{"key": "value"}');
    });
  });

  // ==================== action=search ====================

  describe('action=search', () => {
    it('找到匹配时返回结果', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'notes.md'), 'line1\nkeyword here\nline3\nanother keyword');
      fs.writeFileSync(path.join(userDir, 'other.txt'), 'no match');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'keyword'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Search results');
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('keyword');
      // 新的搜索格式使用 > L2: 标记匹配行
      expect(result.llmContent).toContain('L2:');
      expect(result.llmContent).toContain('L4:');
    });

    it('无匹配时返回 No matches', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'notes.md'), 'some content');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'nonexistentkeyword'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('No matches found');
    });

    it('搜索大小写不敏感', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'notes.md'), 'KEYWORD in uppercase');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'keyword'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('KEYWORD');
    });

    it('search 读取失败跳过', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'ok.md'), 'test keyword');
      fs.writeFileSync(path.join(userDir, 'read-fail.txt'), 'keyword');

      const readFileSyncOriginal = fs.readFileSync.bind(fs);
      vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
        if (String(filePath).includes('read-fail.txt')) {
          throw new Error('Permission denied');
        }
        return readFileSyncOriginal(filePath as fs.PathOrFileDescriptor, ...args);
      });

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'keyword'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('ok.md');
      expect(result.llmContent).not.toContain('read-fail.txt');
    });
  });

  // ==================== scope 参数 ====================

  describe('scope 参数', () => {
    it('scope=user 使用 user 目录', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'user-note.md',
          content: 'user content'
        })
      );

      expect(result.success).toBe(true);
      const userPath = path.join(TEST_BASE, 'user', 'user-note.md');
      expect(fs.existsSync(userPath)).toBe(true);
    });

    it('scope=agent 使用 agent 目录', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'agent',
          file: 'agent-note.md',
          content: 'agent content'
        })
      );

      expect(result.success).toBe(true);
      const agentPath = path.join(TEST_BASE, 'agent', 'agent-note.md');
      expect(fs.existsSync(agentPath)).toBe(true);
    });

    it('默认 scope 为 agent（fallback 到 agentMemoryDir）', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          file: 'default-scope.md',
          content: 'test'
        })
      );

      expect(result.success).toBe(true);
      const agentPath = path.join(TEST_BASE, 'agent', 'default-scope.md');
      expect(fs.existsSync(agentPath)).toBe(true);
    });
  });

  // ==================== 参数校验 ====================

  describe('参数校验', () => {
    it('get 缺少 file 时返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'get', scope: 'user' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
      expect(result.llmContent).toContain('file is required');
    });

    it('write 缺少 file 时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          content: 'content'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
    });

    it('write 缺少 content 时返回错误', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'note.md'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
      expect(result.llmContent).toContain('content is required');
    });

    it('search 缺少 query 时返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'search', scope: 'user' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAM');
      expect(result.llmContent).toContain('query is required');
    });

    it('未知 action 返回错误', async () => {
      const { result } = await consumeGenerator(memoryTool.execute({ action: 'invalid_action', scope: 'user' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ACTION');
      expect(result.llmContent).toContain('Unknown action');
      expect(result.llmContent).toContain('invalid_action');
    });
  });

  // ==================== 流式输出 ====================

  describe('流式输出', () => {
    it('list 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(memoryTool.execute({ action: 'list', scope: 'user' }));

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
      expect(updates.some((u) => u.content?.includes('Listing'))).toBe(true);
    });

    it('write 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'p.md',
          content: 'x'
        })
      );

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
    });

    it('search 有 progress 更新', async () => {
      const { updates } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'test'
        })
      );

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
    });
  });

  // ==================== MEMORY.md 主记忆文件 ====================

  describe('MEMORY.md 主记忆文件', () => {
    it('agent scope 有 workspaceRoot 时支持 MEMORY.md', async () => {
      const workspace = path.join(TEST_BASE, 'workspace');
      fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

      // 写入 MEMORY.md
      const { result: writeResult } = await consumeGenerator(
        memoryTool.execute(
          {
            action: 'write',
            scope: 'agent',
            file: 'MEMORY.md',
            content: '# Core Knowledge\n\nUser prefers Chinese responses.'
          },
          undefined,
          makeContext(workspace)
        )
      );
      expect(writeResult.success).toBe(true);
      expect(fs.existsSync(path.join(workspace, 'MEMORY.md'))).toBe(true);

      // 读取 MEMORY.md
      const { result: getResult } = await consumeGenerator(
        memoryTool.execute({ action: 'get', scope: 'agent', file: 'MEMORY.md' }, undefined, makeContext(workspace))
      );
      expect(getResult.success).toBe(true);
      expect(getResult.llmContent).toContain('Core Knowledge');
    });

    it('list 中 MEMORY.md 标记为主记忆文件并置顶', async () => {
      const workspace = path.join(TEST_BASE, 'workspace');
      fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Core');
      fs.writeFileSync(path.join(workspace, 'memory', 'lessons.md'), '# Lessons');

      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'list', scope: 'agent' }, undefined, makeContext(workspace))
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('MEMORY.md');
      expect(result.llmContent).toContain('★');
      expect(result.llmContent).toContain('memory/lessons.md');
    });

    it('MEMORY.md 不添加 frontmatter', async () => {
      const workspace = path.join(TEST_BASE, 'workspace');
      fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

      await consumeGenerator(
        memoryTool.execute(
          {
            action: 'write',
            scope: 'agent',
            file: 'MEMORY.md',
            content: '# My Memory'
          },
          undefined,
          makeContext(workspace)
        )
      );

      const content = fs.readFileSync(path.join(workspace, 'MEMORY.md'), 'utf-8');
      expect(content).toBe('# My Memory');
      expect(content).not.toContain('---');
    });
  });

  // ==================== append 模式 ====================

  describe('append 模式', () => {
    it('append=true 追加而非覆盖', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(path.join(userDir, 'log.md'), 'Line 1\n');

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'log.md',
          content: 'Line 2',
          append: true
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('appended');
      const content = fs.readFileSync(path.join(userDir, 'log.md'), 'utf-8');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });

    it('append=true 文件不存在时降级为创建', async () => {
      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'write',
          scope: 'user',
          file: 'new-append.md',
          content: 'First entry',
          append: true
        })
      );

      // append 目标不存在时 → 按普通 write 处理（因为 exists 为 false）
      expect(result.success).toBe(true);
    });
  });

  // ==================== 增强搜索 ====================

  describe('增强搜索', () => {
    it('多关键字搜索', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(
        path.join(userDir, 'notes.md'),
        '# TypeScript Config\n\nUse strict mode with TypeScript.\nPrefer Tailwind CSS.'
      );

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'TypeScript strict'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('notes.md');
      expect(result.llmContent).toContain('relevance:');
    });

    it('搜索返回 section 信息', async () => {
      const userDir = path.join(TEST_BASE, 'user');
      fs.writeFileSync(
        path.join(userDir, 'knowledge.md'),
        '# Project Info\n\n## Tech Stack\n\nElectron + Vue 3 + TypeScript\n\n## Build\n\npnpm build'
      );

      const { result } = await consumeGenerator(
        memoryTool.execute({
          action: 'search',
          scope: 'user',
          query: 'Electron'
        })
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Tech Stack');
    });

    it('搜索中 MEMORY.md 评分加权', async () => {
      const workspace = path.join(TEST_BASE, 'workspace');
      fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'MEMORY.md'), 'important keyword here');
      fs.writeFileSync(path.join(workspace, 'memory', 'other.md'), 'important keyword here');

      const { result } = await consumeGenerator(
        memoryTool.execute({ action: 'search', scope: 'agent', query: 'keyword' }, undefined, makeContext(workspace))
      );

      expect(result.success).toBe(true);
      // MEMORY.md 应排在前面（加权）
      const content = result.llmContent || '';
      const memoryIdx = content.indexOf('MEMORY.md');
      const otherIdx = content.indexOf('other.md');
      expect(memoryIdx).toBeLessThan(otherIdx);
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
