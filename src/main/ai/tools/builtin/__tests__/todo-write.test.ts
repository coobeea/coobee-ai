/**
 * todo_write 工具测试
 *
 * 覆盖：
 *   - 创建 TODO 列表（替换模式）
 *   - 合并模式更新
 *   - 空参数拒绝
 *   - 状态统计
 *   - 持久化到文件系统
 *   - 清除 session TODOs
 *   - 工具元数据
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ===== Mock Electron =====
vi.mock('electron', () => {
  const base = path.join(process.cwd(), 'test-results');
  return {
    app: {
      getPath: (name: string) => path.join(base, name),
      getAppPath: () => base,
      getName: () => 'coobee-test',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  };
});

import { todoWriteTool, getSessionTodos, clearSessionTodos } from '../todo-write';
import type { ToolResult, ToolStreamUpdate, ToolExecutionContext } from '../../types';

// ===== 辅助函数 =====

/** 创建最小化的 ToolExecutionContext */
function makeContext(workspaceRoot: string): ToolExecutionContext {
  return {
    mode: 'path-only',
    workspaceRoot,
    toolPolicy: { allow: [], deny: [] }
  };
}

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

// ===== 测试 =====

describe('todo_write tool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
    // 清理内存中的 TODO（通过一个已知 sessionId）
    clearSessionTodos('test-session');
  });

  afterEach(() => {
    clearSessionTodos('test-session');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---- 工具元数据 ----

  it('should have correct metadata', () => {
    expect(todoWriteTool.name).toBe('todo_write');
    expect(todoWriteTool.category).toBe('observability');
    expect(todoWriteTool.needUserConfirm).toBe(false);
  });

  // ---- 替换模式 ----

  it('should create TODO list in replace mode', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Step 1: Read code', status: 'in_progress' },
          { id: 't2', content: 'Step 2: Make changes', status: 'pending' },
          { id: 't3', content: 'Step 3: Test', status: 'pending' }
        ],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );

    const { result } = await consumeGenerator(gen);
    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('1 in progress');
    expect(result.llmContent).toContain('2 pending');
    expect(result.llmContent).toContain('0/3 done');

    // 验证内存存储
    const items = getSessionTodos('test-session');
    expect(items).toHaveLength(3);
    expect(items![0].status).toBe('in_progress');
    expect(items![1].status).toBe('pending');
  });

  it('should replace all TODOs when merge=false', async () => {
    // 先创建
    const gen1 = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Old item 1', status: 'pending' },
          { id: 't2', content: 'Old item 2', status: 'pending' }
        ],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen1);

    // 再替换
    const gen2 = todoWriteTool.execute(
      {
        todos: [{ id: 'new1', content: 'New item', status: 'in_progress' }],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    const { result } = await consumeGenerator(gen2);

    expect(result.success).toBe(true);
    const items = getSessionTodos('test-session');
    expect(items).toHaveLength(1);
    expect(items![0].id).toBe('new1');
  });

  // ---- 合并模式 ----

  it('should merge TODOs when merge=true', async () => {
    // 先创建
    const gen1 = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Read code', status: 'in_progress' },
          { id: 't2', content: 'Make changes', status: 'pending' },
          { id: 't3', content: 'Test', status: 'pending' }
        ],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen1);

    // 合并更新：t1 完成，t2 开始
    const gen2 = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Read code', status: 'completed' },
          { id: 't2', content: 'Make changes', status: 'in_progress' }
        ],
        merge: true,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    const { result } = await consumeGenerator(gen2);

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('1/3 done');

    const items = getSessionTodos('test-session');
    expect(items).toHaveLength(3);
    expect(items!.find((i) => i.id === 't1')!.status).toBe('completed');
    expect(items!.find((i) => i.id === 't2')!.status).toBe('in_progress');
    expect(items!.find((i) => i.id === 't3')!.status).toBe('pending'); // 未修改
  });

  it('should add new items when merge=true and id not found', async () => {
    // 先创建
    const gen1 = todoWriteTool.execute(
      {
        todos: [{ id: 't1', content: 'Existing', status: 'completed' }],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen1);

    // 合并：添加新项
    const gen2 = todoWriteTool.execute(
      {
        todos: [{ id: 't2', content: 'New follow-up', status: 'pending' }],
        merge: true,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen2);

    const items = getSessionTodos('test-session');
    expect(items).toHaveLength(2);
    expect(items!.find((i) => i.id === 't2')!.content).toBe('New follow-up');
  });

  // ---- 错误处理 ----

  it('should reject empty todos array', async () => {
    const gen = todoWriteTool.execute(
      { todos: [], merge: false, sessionId: 'test-session' },
      undefined,
      makeContext(tempDir)
    );
    const { result } = await consumeGenerator(gen);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_PARAM');
  });

  // ---- 持久化 ----

  it('should persist TODOs to workspace when workspaceRoot provided', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [{ id: 't1', content: 'Persistent item', status: 'pending' }],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen);

    const persistFile = path.join(tempDir, '.todos', 'test-session.json');
    expect(fs.existsSync(persistFile)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(persistFile, 'utf-8'));
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0].content).toBe('Persistent item');
  });

  it('should not fail when workspaceRoot is not provided', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [{ id: 't1', content: 'No workspace', status: 'pending' }],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      undefined // 无 context
    );
    const { result } = await consumeGenerator(gen);
    expect(result.success).toBe(true);
  });

  // ---- 清除 ----

  it('should clear session TODOs', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [{ id: 't1', content: 'Item', status: 'pending' }],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );
    await consumeGenerator(gen);

    expect(getSessionTodos('test-session')).toHaveLength(1);

    clearSessionTodos('test-session');
    expect(getSessionTodos('test-session')).toBeNull();
  });

  // ---- 流式输出 ----

  it('should emit output stream update', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Done item', status: 'completed' },
          { id: 't2', content: 'In progress', status: 'in_progress' }
        ],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );

    const { updates, result } = await consumeGenerator(gen);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].type).toBe('output');
    expect(updates[0].content).toContain('1/2 done');
    expect(result.success).toBe(true);
  });

  // ---- 状态展示 ----

  it('should display correct status symbols', async () => {
    const gen = todoWriteTool.execute(
      {
        todos: [
          { id: 't1', content: 'Completed', status: 'completed' },
          { id: 't2', content: 'In progress', status: 'in_progress' },
          { id: 't3', content: 'Pending', status: 'pending' },
          { id: 't4', content: 'Cancelled', status: 'cancelled' }
        ],
        merge: false,
        sessionId: 'test-session'
      },
      undefined,
      makeContext(tempDir)
    );

    const { result } = await consumeGenerator(gen);
    expect(result.userContent).toContain('✓');
    expect(result.userContent).toContain('◉');
    expect(result.userContent).toContain('○');
    expect(result.userContent).toContain('✗');
  });
});
