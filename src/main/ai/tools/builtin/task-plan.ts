/**
 * task_plan — 任务计划管理工具
 *
 * 让 Agent 创建和管理结构化的任务计划，用于多 Agent 委托场景。
 * 计划文件持久化到 {workspace}/tasks/{taskId}/，用户可直接查看。
 *
 * 文件结构：
 *   {workspace}/tasks/{taskId}/
 *   ├── plan.md         — 自然语言计划（LLM 生成）
 *   ├── status.json     — 机器可读状态（步骤、进度）
 *   ├── agents/          — 子 Agent 工作目录（delegate_to_agent 创建）
 *   ├── results/         — 子 Agent 结果汇总
 *   └── experiences/     — 共享经验
 *
 * 支持操作：
 *   - create       — 创建新任务计划
 *   - update_step  — 更新某一步的状态
 *   - get          — 读取当前计划及状态
 *   - list         — 列出当前 workspace 下所有任务
 *   - complete     — 标记任务完成，写入总结
 *
 * 分类：Configuration | 风险：低
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';

// ==================== 类型 ====================

interface TaskStep {
  id: number;
  description: string;
  agentId?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface TaskStatus {
  taskId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'planning' | 'running' | 'done' | 'failed';
  summary?: string;
  steps: TaskStep[];
}

// ==================== 参数 Schema ====================

const stepSchema = z.object({
  description: z.string().describe('Step description'),
  agentId: z.string().optional().describe('Agent ID to delegate this step to (optional)')
});

const paramsSchema = z.object({
  action: z.enum(['create', 'update_step', 'get', 'list', 'complete']).describe('Operation to perform'),

  // create 参数
  taskId: z
    .string()
    .optional()
    .describe('Task ID (kebab-case). Auto-generated for create if omitted. Required for update_step/get/complete.'),
  title: z.string().optional().describe('Task title (required for create)'),
  goal: z.string().optional().describe('Task goal description (required for create)'),
  steps: z.array(stepSchema).optional().describe('Task steps (required for create)'),

  // update_step 参数
  stepId: z.number().optional().describe('Step ID to update (1-based, required for update_step)'),
  stepStatus: z.enum(['pending', 'running', 'done', 'failed']).optional().describe('New status for the step'),
  stepError: z.string().optional().describe('Error message (when stepStatus is "failed")'),

  // complete 参数
  summary: z.string().optional().describe('Task completion summary (for complete action)')
});

// ==================== 工具定义 ====================

export const taskPlanTool: ToolDefinition = {
  name: 'task_plan',
  description:
    'Create and manage structured task plans for multi-agent delegation. ' +
    'Plans are persisted to tasks/{taskId}/ directory with plan.md (human-readable) and status.json (machine-readable). ' +
    'Use "create" to start a plan with steps, "update_step" to track progress, "get" to check status, ' +
    '"list" to see all tasks, "complete" to finalize. ' +
    'Pass the taskId to delegate_to_agent to group related delegations under the same task.',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  parameters: paramsSchema,

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    execContext?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string;
    const workspace = execContext?.workspaceRoot;

    if (!workspace) {
      return {
        success: false,
        error: { code: 'NO_WORKSPACE', message: 'Workspace not available' }
      };
    }

    const tasksRoot = path.join(workspace, 'tasks');

    try {
      switch (action) {
        case 'create':
          return yield* handleCreate(tasksRoot, params);
        case 'update_step':
          return yield* handleUpdateStep(tasksRoot, params);
        case 'get':
          return yield* handleGet(tasksRoot, params);
        case 'list':
          return yield* handleList(tasksRoot);
        case 'complete':
          return yield* handleComplete(tasksRoot, params);
        default:
          return {
            success: false,
            error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` }
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: { code: 'TASK_PLAN_ERROR', message: msg } };
    }
  }
};

// ==================== 操作处理 ====================

async function* handleCreate(
  tasksRoot: string,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const title = params.title as string | undefined;
  const goal = params.goal as string | undefined;
  const steps = params.steps as Array<{ description: string; agentId?: string }> | undefined;

  if (!title || !goal || !steps || steps.length === 0) {
    return {
      success: false,
      error: {
        code: 'MISSING_PARAM',
        message: 'title, goal, and steps (non-empty array) are required for create'
      }
    };
  }

  const taskId =
    (params.taskId as string) || `${slugify(title)}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  const taskDir = path.join(tasksRoot, taskId);

  // 创建目录结构
  const dirs = [
    taskDir,
    path.join(taskDir, 'agents'),
    path.join(taskDir, 'results'),
    path.join(taskDir, 'experiences')
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  yield { type: 'progress', content: `Creating task plan "${title}" (${taskId})...` };

  // 构建 status.json
  const now = new Date().toISOString();
  const taskSteps: TaskStep[] = steps.map((s, i) => ({
    id: i + 1,
    description: s.description,
    agentId: s.agentId,
    status: 'pending' as const
  }));

  const status: TaskStatus = {
    taskId,
    title,
    createdAt: now,
    updatedAt: now,
    status: 'planning',
    steps: taskSteps
  };

  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(status, null, 2), 'utf-8');

  // 构建 plan.md
  const stepLines = taskSteps.map(
    (s) => `${s.id}. [ ] ${s.description}${s.agentId ? ` → delegate to \`${s.agentId}\`` : ''}`
  );

  const planMd = [
    `# Task: ${title}`,
    '',
    `> TaskId: \`${taskId}\``,
    `> Created: ${now}`,
    '',
    '## Goal',
    '',
    goal,
    '',
    '## Steps',
    '',
    ...stepLines,
    ''
  ].join('\n');

  fs.writeFileSync(path.join(taskDir, 'plan.md'), planMd, 'utf-8');

  return {
    success: true,
    llmContent: `Task plan created: taskId="${taskId}", ${taskSteps.length} steps.\n\nUse this taskId when calling delegate_to_agent to group related delegations.\nUse task_plan(update_step) to track progress.`,
    userContent: `已创建任务计划: **${title}** (${taskId}), ${taskSteps.length} 个步骤`
  };
}

// eslint-disable-next-line require-yield
async function* handleUpdateStep(
  tasksRoot: string,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const taskId = params.taskId as string | undefined;
  const stepId = params.stepId as number | undefined;
  const stepStatus = params.stepStatus as TaskStep['status'] | undefined;

  if (!taskId || stepId == null || !stepStatus) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'taskId, stepId, and stepStatus are required' }
    };
  }

  const statusFile = path.join(tasksRoot, taskId, 'status.json');
  if (!fs.existsSync(statusFile)) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Task "${taskId}" not found` }
    };
  }

  const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as TaskStatus;
  const step = status.steps.find((s) => s.id === stepId);
  if (!step) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Step ${stepId} not found in task "${taskId}"` }
    };
  }

  const now = new Date().toISOString();
  step.status = stepStatus;
  if (stepStatus === 'running') {
    step.startedAt = now;
  } else if (stepStatus === 'done' || stepStatus === 'failed') {
    step.completedAt = now;
  }
  if (stepStatus === 'failed' && params.stepError) {
    step.error = params.stepError as string;
  }

  // 更新任务整体状态
  const hasRunning = status.steps.some((s) => s.status === 'running');
  const allDone = status.steps.every((s) => s.status === 'done');
  const hasFailed = status.steps.some((s) => s.status === 'failed');

  if (allDone) {
    status.status = 'done';
  } else if (hasFailed && !hasRunning) {
    status.status = 'failed';
  } else if (hasRunning) {
    status.status = 'running';
  }

  status.updatedAt = now;
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');

  // 同步更新 plan.md 中的 checkbox
  updatePlanCheckboxes(path.join(tasksRoot, taskId, 'plan.md'), status.steps);

  return {
    success: true,
    llmContent: `Step ${stepId} updated to "${stepStatus}" in task "${taskId}". Overall: ${status.status}.`,
    userContent: `步骤 ${stepId} → ${stepStatus}`
  };
}

// eslint-disable-next-line require-yield
async function* handleGet(
  tasksRoot: string,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const taskId = params.taskId as string | undefined;
  if (!taskId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'taskId is required for get' }
    };
  }

  const statusFile = path.join(tasksRoot, taskId, 'status.json');
  if (!fs.existsSync(statusFile)) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Task "${taskId}" not found` }
    };
  }

  const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as TaskStatus;

  const stepLines = status.steps.map(
    (s) =>
      `  ${s.id}. [${s.status}] ${s.description}${s.agentId ? ` (→ ${s.agentId})` : ''}${s.error ? ` — ERROR: ${s.error}` : ''}`
  );

  const content = [
    `Task: ${status.title} (${status.taskId})`,
    `Status: ${status.status}`,
    `Created: ${status.createdAt}`,
    `Updated: ${status.updatedAt}`,
    status.summary ? `Summary: ${status.summary}` : '',
    '',
    'Steps:',
    ...stepLines
  ]
    .filter(Boolean)
    .join('\n');

  return {
    success: true,
    llmContent: content,
    userContent: content
  };
}

// eslint-disable-next-line require-yield
async function* handleList(tasksRoot: string): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  if (!fs.existsSync(tasksRoot)) {
    return {
      success: true,
      llmContent: 'No tasks found.',
      userContent: '暂无任务'
    };
  }

  const entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  const tasks: Array<{ taskId: string; title: string; status: string; steps: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statusFile = path.join(tasksRoot, entry.name, 'status.json');
    if (!fs.existsSync(statusFile)) continue;

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as TaskStatus;
      tasks.push({
        taskId: status.taskId,
        title: status.title,
        status: status.status,
        steps: status.steps.length
      });
    } catch {
      // 读取失败跳过
    }
  }

  if (tasks.length === 0) {
    return {
      success: true,
      llmContent: 'No tasks found.',
      userContent: '暂无任务'
    };
  }

  const lines = tasks.map((t) => `- **${t.title}** (\`${t.taskId}\`) — ${t.status}, ${t.steps} steps`);

  return {
    success: true,
    llmContent: `Tasks (${tasks.length}):\n${lines.join('\n')}`,
    userContent: `任务 (${tasks.length}):\n${lines.join('\n')}`
  };
}

// eslint-disable-next-line require-yield
async function* handleComplete(
  tasksRoot: string,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const taskId = params.taskId as string | undefined;
  const summary = params.summary as string | undefined;

  if (!taskId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'taskId is required for complete' }
    };
  }

  const statusFile = path.join(tasksRoot, taskId, 'status.json');
  if (!fs.existsSync(statusFile)) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Task "${taskId}" not found` }
    };
  }

  const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as TaskStatus;
  const now = new Date().toISOString();

  status.status = 'done';
  status.updatedAt = now;
  if (summary) {
    status.summary = summary;
  }

  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');

  // 追加总结到 plan.md
  if (summary) {
    const planFile = path.join(tasksRoot, taskId, 'plan.md');
    if (fs.existsSync(planFile)) {
      const existing = fs.readFileSync(planFile, 'utf-8');
      const updated = existing + '\n## Summary\n\n' + summary + '\n';
      fs.writeFileSync(planFile, updated, 'utf-8');
    }
  }

  return {
    success: true,
    llmContent: `Task "${taskId}" marked as completed.${summary ? ` Summary: ${summary}` : ''}`,
    userContent: `任务 **${status.title}** 已完成`
  };
}

// ==================== 辅助函数 ====================

/** 简单的 slugify（中文保留，空格/特殊字符替换为连字符） */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** 更新 plan.md 中的步骤 checkbox */
function updatePlanCheckboxes(planFile: string, steps: TaskStep[]): void {
  if (!fs.existsSync(planFile)) return;

  try {
    let content = fs.readFileSync(planFile, 'utf-8');

    for (const step of steps) {
      const checkbox =
        step.status === 'done' ? '[x]' : step.status === 'running' ? '[~]' : step.status === 'failed' ? '[!]' : '[ ]';

      // 替换对应步骤的 checkbox（匹配行首的 步骤号. [任意状态]）
      const pattern = new RegExp(`^(${step.id}\\.)\\s*\\[.\\]`, 'm');
      content = content.replace(pattern, `$1 ${checkbox}`);
    }

    fs.writeFileSync(planFile, content, 'utf-8');
  } catch {
    // 更新失败不影响主流程
  }
}
