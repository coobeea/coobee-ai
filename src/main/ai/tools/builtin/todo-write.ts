/**
 * todo_write — 会话级 TODO 管理工具
 *
 * 让 Agent 在当前会话中创建和管理 TODO 列表，用于：
 *   - 规划多步骤任务的执行顺序
 *   - 追踪已完成/进行中/待办的步骤
 *   - 向用户展示当前进度
 *
 * 与 task_plan 的区别：
 *   - todo_write: 会话级、轻量、in-memory + 可选持久化，用于单 Agent 自我管理
 *   - task_plan: 持久化到磁盘、面向多 Agent 委托的结构化计划
 *
 * 存储策略：
 *   - 主要存储在内存中（sessionTodos Map），会话结束自动清理
 *   - 可选持久化到 {workspace}/.todos/{sessionId}.json（用于断点恢复）
 *
 * 分类：Observability | 风险：低（只管理自己的 TODO）
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';

// ==================== 类型 ====================

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
}

interface TodoList {
  sessionId: string;
  items: TodoItem[];
  updatedAt: string;
}

// ==================== 会话级存储 ====================

/** 内存中的 TODO 列表（按 sessionId 隔离） */
const sessionTodos = new Map<string, TodoList>();

/** 获取或创建 session 的 TODO 列表 */
function getOrCreateList(sessionId: string): TodoList {
  let list = sessionTodos.get(sessionId);
  if (!list) {
    list = { sessionId, items: [], updatedAt: new Date().toISOString() };
    sessionTodos.set(sessionId, list);
  }
  return list;
}

// ==================== 参数 Schema ====================

const todoItemSchema = z.object({
  id: z.string().describe('Unique identifier for the TODO item'),
  content: z.string().describe('Description of the TODO item'),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status of the TODO item')
});

const paramsSchema = z.object({
  todos: z
    .array(todoItemSchema)
    .min(1)
    .describe(
      'Array of TODO items to create or update. ' +
        'Each item needs id, content, and status. ' +
        'When merge=true, only specified fields are updated for existing items.'
    ),
  merge: z
    .boolean()
    .default(false)
    .describe(
      'If true, merge with existing TODOs (update matched IDs, keep unmatched). ' +
        'If false, replace all TODOs with the provided list.'
    ),
  sessionId: z
    .string()
    .optional()
    .describe('Session ID to scope the TODO list. Auto-detected from execution context if omitted.')
});

// ==================== 工具定义 ====================

export const todoWriteTool: ToolDefinition = {
  name: 'todo_write',
  description:
    'Create and manage a TODO list for the current session. ' +
    'Use this to plan multi-step tasks, track progress, and show the user what you are doing. ' +
    'Each TODO has id, content, and status (pending/in_progress/completed/cancelled). ' +
    'Use merge=false to set the full list, merge=true to update specific items. ' +
    'Best practice: create TODOs at the start of complex tasks, update as you progress. ' +
    'Only one item should be in_progress at a time.',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: paramsSchema,

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const todos = params.todos as Array<{ id: string; content: string; status: TodoStatus }>;
    const merge = (params.merge as boolean) ?? false;
    const sessionId = (params.sessionId as string) || context?.sessionId || `session-${Date.now()}`;

    if (!todos || todos.length === 0) {
      return {
        success: false,
        error: { code: 'MISSING_PARAM', message: 'todos array is required and must not be empty' }
      };
    }

    const list = getOrCreateList(sessionId);
    const now = new Date().toISOString();

    if (merge) {
      // 合并模式：更新已有项，保留未提及的项
      for (const todo of todos) {
        const existing = list.items.find((item) => item.id === todo.id);
        if (existing) {
          if (todo.content !== undefined) existing.content = todo.content;
          if (todo.status !== undefined) existing.status = todo.status;
          existing.updatedAt = now;
        } else {
          list.items.push({
            id: todo.id,
            content: todo.content,
            status: todo.status,
            createdAt: now,
            updatedAt: now
          });
        }
      }
    } else {
      // 替换模式：用新列表完全替换
      list.items = todos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
        createdAt: now,
        updatedAt: now
      }));
    }

    list.updatedAt = now;

    // 可选持久化
    persistTodos(list, context?.workspaceRoot);

    // 构建输出
    const statusEmoji: Record<TodoStatus, string> = {
      pending: '○',
      in_progress: '◉',
      completed: '✓',
      cancelled: '✗'
    };

    const lines = list.items.map((item) => `${statusEmoji[item.status]} [${item.status}] ${item.content}`);

    const stats = {
      total: list.items.length,
      completed: list.items.filter((i) => i.status === 'completed').length,
      in_progress: list.items.filter((i) => i.status === 'in_progress').length,
      pending: list.items.filter((i) => i.status === 'pending').length,
      cancelled: list.items.filter((i) => i.status === 'cancelled').length
    };

    const summary = `TODO list updated (${stats.completed}/${stats.total} done)`;
    const detail = lines.join('\n');

    yield { type: 'output', content: `${summary}\n\n${detail}` };

    return {
      success: true,
      llmContent:
        `${summary}.\n\nCurrent TODOs:\n${detail}\n\n` +
        `Stats: ${stats.pending} pending, ${stats.in_progress} in progress, ` +
        `${stats.completed} completed, ${stats.cancelled} cancelled.`,
      userContent: `**${summary}**\n\n${detail}`
    };
  }
};

// ==================== 持久化（可选） ====================

/** 持久化 TODO 列表到 workspace（用于断点恢复） */
function persistTodos(list: TodoList, workspaceRoot?: string): void {
  if (!workspaceRoot) return;

  try {
    const todosDir = path.join(workspaceRoot, '.todos');
    if (!fs.existsSync(todosDir)) {
      fs.mkdirSync(todosDir, { recursive: true });
    }
    const filePath = path.join(todosDir, `${list.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    // 持久化失败不影响主流程
  }
}

// ==================== 公开 API（供其他模块查询） ====================

/** 获取指定 session 的 TODO 列表（只读） */
export function getSessionTodos(sessionId: string): TodoItem[] | null {
  const list = sessionTodos.get(sessionId);
  return list ? [...list.items] : null;
}

/** 清除指定 session 的 TODO 列表（会话结束时调用） */
export function clearSessionTodos(sessionId: string): void {
  sessionTodos.delete(sessionId);
}
