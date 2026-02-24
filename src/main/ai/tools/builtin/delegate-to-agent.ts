/**
 * delegate_to_agent — Agent 委托工具
 *
 * 让主 Agent 将子任务委托给专业 Agent 执行。
 *
 * 实现原理：
 *   1. 从 AgentStore 加载目标 Agent 定义
 *   2. 在父 workspace 的 tasks/{taskId}/agents/{agentId}/ 下创建子工作空间
 *   3. 收集已有执行经验，作为 context 传递给子 Agent
 *   4. 创建临时 PiMonoBuilder + 运行时，发送 task + context
 *   5. 等待执行完成，将结果写入 tasks/{taskId}/results/{agentId}.md
 *   6. 返回结果给调用方（主 Agent）
 *
 * 工作空间嵌套：
 *   子 Agent 不创建顶级 workspace，而是嵌套在父 workspace 下：
 *     {parentWorkspace}/tasks/{taskId}/agents/{agentId}/
 *   这样用户在父 workspace 下即可查看所有子 Agent 的数据。
 *
 * 经验共享：
 *   子 Agent 可将执行经验写入 tasks/{taskId}/experiences/
 *   后续委托的子 Agent 会自动获得已有经验作为 context。
 *
 * 关键：这是同步工具调用，不是控制权转移。
 * 主 Agent 全程保持控制权，子 Agent 的结果作为工具返回值。
 *
 * 分类：Execute | 风险：中（启动子 Agent）
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { AgentStore } from '../../agents/AgentStore';
import type { AgentDefinition } from '../../agents/types';
import { WorkspaceManager } from '../../storage/WorkspaceManager';

// ==================== 常量 ====================

/** 子 Agent 默认最大轮次 */
const DEFAULT_MAX_TURNS = 20;

/** 子 Agent 默认超时（5 分钟） */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 子 Agent 禁用的工具集（防止递归嵌套）
 *
 * 只支持一层委托：主 Agent → 子 Agent。
 * 子 Agent 不能再委托给其他 Agent，也不能创建/修改 Agent 定义。
 */
const SUB_AGENT_BLOCKED_TOOLS = new Set([
  'delegate_to_agent', // 禁止递归委托
  'task_plan' // 计划管理由主 Agent 负责
]);

// ==================== 参数 Schema ====================

const paramsSchema = z.object({
  agentId: z.string().describe('Target agent ID to delegate the task to'),

  task: z.string().describe('Task description for the agent to execute'),

  taskId: z
    .string()
    .optional()
    .describe(
      'Task ID for grouping related delegations under the same task directory. ' +
        'If using task_plan, pass the taskId from the plan. ' +
        'If omitted, a temporary taskId is auto-generated.'
    ),

  context: z
    .string()
    .optional()
    .describe('Additional context: file paths, prior results, constraints. ' + 'Will be appended to the task message.'),

  maxTurns: z.number().optional().describe(`Max LLM turns for the sub-agent (default: ${DEFAULT_MAX_TURNS})`)
});

// ==================== 工具定义 ====================

export const delegateToAgentTool: ToolDefinition = {
  name: 'delegate_to_agent',
  description:
    'Delegate a sub-task to a specialized Agent. The agent runs in a sub-workspace under the current task directory. ' +
    'Check the registered agents listed in <agent_discovery> to find a suitable agent. ' +
    'Pass taskId to group related delegations; the tool automatically shares execution experiences between sub-agents. ' +
    'Results are written to tasks/{taskId}/results/{agentId}.md and returned as a string.',
  category: ToolCategory.Execute,
  needUserConfirm: true,
  parameters: paramsSchema,

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    execContext?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const agentId = params.agentId as string;
    const task = params.task as string;
    const taskId = (params.taskId as string) || `task-${Date.now()}`;
    const context = params.context as string | undefined;
    const maxTurns = (params.maxTurns as number) || DEFAULT_MAX_TURNS;

    if (!agentId || !task) {
      return {
        success: false,
        error: { code: 'MISSING_PARAM', message: 'agentId and task are required' }
      };
    }

    // 获取父 workspace 路径
    const parentWorkspace = execContext?.workspaceRoot;
    if (!parentWorkspace) {
      return {
        success: false,
        error: {
          code: 'NO_WORKSPACE',
          message: 'Cannot determine parent workspace. ToolExecutionContext.workspaceRoot is missing.'
        }
      };
    }

    // 1. 加载 Agent 定义
    const store = await AgentStore.getInstance();
    const agentDef = await store.get(agentId);
    if (!agentDef) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` }
      };
    }

    yield {
      type: 'progress',
      content: `Delegating to "${agentDef.name}" (${agentId}), taskId=${taskId}...`
    };

    // 2. 创建任务和 Agent 目录结构 (实体与协作解耦)
    const taskDir = path.join(parentWorkspace, 'tasks', taskId);
    const resultsDir = path.join(taskDir, 'results');
    const experiencesDir = path.join(taskDir, 'experiences');

    ensureDirs([taskDir, resultsDir, experiencesDir]);

    // 使用统一的 WorkspaceManager 获取/创建子 Agent 独立工作空间
    const parentSessionId = execContext?.sessionId || 'unknown';
    const subSessionId = `${parentSessionId}:delegate:${agentDef.id}`;

    const subAgentWorkspace = WorkspaceManager.getOrCreateSubAgentWorkspace({
      agentName: `delegate-${agentId}`,
      sessionId: subSessionId,
      type: 'delegate',
      threadWorkspace: parentWorkspace,
      enableSkills: true,
      enableExtensions: true
    });

    // 3. 收集已有执行经验
    const priorExperiences = collectExperiences(experiencesDir);

    // 4. 组装消息（task + user context + 自动经验传递）
    const messageParts = [task];
    if (context) {
      messageParts.push(`\n--- Context ---\n${context}`);
    }
    if (priorExperiences) {
      messageParts.push(
        `\n--- Prior Experiences from Other Agents ---\n${priorExperiences}\n---\nPlease consider these experiences when executing your task.`
      );
    }
    const message = messageParts.join('\n');

    // 5. 创建临时运行时并执行
    const startTime = Date.now();
    try {
      const result = await runSubAgent(
        agentDef,
        message,
        maxTurns,
        subAgentWorkspace,
        experiencesDir,
        parentSessionId,
        signal
      );
      const duration = Date.now() - startTime;

      yield {
        type: 'progress',
        content: `Agent "${agentDef.name}" completed in ${Math.round(duration / 1000)}s`
      };

      // 6. 写入结果文件
      const resultFile = path.join(resultsDir, `${agentId}.md`);
      const resultContent = [
        `# Result: ${agentDef.name} (${agentId})`,
        '',
        `- Task: ${task}`,
        `- Duration: ${Math.round(duration / 1000)}s`,
        `- Tool calls: ${result.toolCalls?.length ?? 0}`,
        `- Status: ${result.output ? 'completed' : 'no output'}`,
        '',
        '## Output',
        '',
        result.output || '(no output)'
      ].join('\n');
      fs.writeFileSync(resultFile, resultContent, 'utf-8');

      const toolCallCount = result.toolCalls?.length ?? 0;

      return {
        success: true,
        llmContent: [
          `[delegate_to_agent result from "${agentDef.name}" (${agentId})]`,
          `TaskId: ${taskId} | Duration: ${Math.round(duration / 1000)}s | Tool calls: ${toolCallCount}`,
          `Result file: tasks/${taskId}/results/${agentId}.md`,
          '',
          result.output || '(no output)'
        ].join('\n'),
        userContent: `**${agentDef.name}** 完成委托任务 (${Math.round(duration / 1000)}s)`,
        metadata: {
          agentId,
          agentName: agentDef.name,
          taskId,
          duration,
          toolCalls: toolCallCount,
          resultFile
        }
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);

      // 即使失败也写入结果文件（记录失败信息）
      const resultFile = path.join(resultsDir, `${agentId}.md`);
      const failContent = [
        `# Result: ${agentDef.name} (${agentId}) — FAILED`,
        '',
        `- Task: ${task}`,
        `- Duration: ${Math.round(duration / 1000)}s`,
        `- Error: ${msg}`,
        '',
        '## Failure Details',
        '',
        msg
      ].join('\n');
      try {
        fs.writeFileSync(resultFile, failContent, 'utf-8');
      } catch {
        // 写文件失败不影响主流程
      }

      return {
        success: false,
        error: { code: 'DELEGATE_FAILED', message: `Agent "${agentId}" failed: ${msg}` },
        metadata: { agentId, taskId, duration }
      };
    }
  }
};

// ==================== 子 Agent 执行 ====================

/**
 * 创建临时运行时并执行子 Agent
 *
 * 子 Agent 的 workspace 嵌套在父 workspace 下：
 *   {parentWorkspace}/tasks/{taskId}/agents/{agentId}/
 *
 * 使用动态 import 避免循环依赖（tools → AgentExecutor → tools）。
 */
async function runSubAgent(
  agentDef: AgentDefinition,
  message: string,
  maxTurns: number,
  subAgentWorkspace: string,
  experiencesDir: string,
  parentSessionId: string,
  signal?: AbortSignal
): Promise<{ output: string; toolCalls?: Array<{ toolName: string }> }> {
  // 动态导入，避免循环依赖
  const { agentExecutor } = await import('../../AgentExecutor');
  const { builtinTools } = await import('../builtin');
  const { ToolRegistry } = await import('../registry');

  // 经验共享指令（追加到 Agent 的 instructions 后面）
  const experienceInstruction = [
    '',
    '<sub_agent_context>',
    '你正在一个多 Agent 协作任务中执行子任务。',
    '- 如果遇到工具执行失败、环境问题、或其他有价值的经验，请将经验写入经验目录',
    `- 使用 write 工具，路径：${experiencesDir}/{简要描述}.md`,
    '- 经验内容应包括：问题描述、原因分析、解决方案（如有）',
    '- 你的输出文件请放在当前工作目录的 output/ 子目录下',
    '</sub_agent_context>'
  ].join('\n');

  const fullInstructions = agentDef.instructions + experienceInstruction;

  // 创建 Builder
  const builder = agentExecutor
    .piMono()
    .name(agentDef.name || agentDef.id)
    .mode('agent')
    .sessionMode('file')
    .instructions(fullInstructions)
    .maxTurns(maxTurns)
    // 手动设置子 Agent 的工作目录，不走 injectEnv 的顶级 workspace 创建
    .sessionDir(path.join(subAgentWorkspace, 'sessions'))
    .workspaceRoot(subAgentWorkspace)
    .contextDir(path.join(subAgentWorkspace, 'contexts'));

  // 工具集（过滤掉子 Agent 禁用的工具，防止递归嵌套）
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }

  if (agentDef.tools && agentDef.tools.length > 0) {
    const selectedTools = agentDef.tools
      .filter((name) => !SUB_AGENT_BLOCKED_TOOLS.has(name))
      .map((name) => toolMap.get(name))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    builder.tools(selectedTools);
  } else {
    const allTools = Array.from(toolMap.values()).filter((t) => !SUB_AGENT_BLOCKED_TOOLS.has(t.name));
    builder.tools(allTools);
  }

  // piMono() 已自动注入 Provider 配置 + thinkingLevel
  // Agent 定义中的显式配置优先覆盖
  if (agentDef.model) {
    builder.model(agentDef.model);
  }
  if (agentDef.thinkingLevel) {
    builder.thinkingLevel(agentDef.thinkingLevel);
  }

  // 子 Agent sessionId：以父 sessionId(= threadId) 为前缀，保证可追溯
  const subSessionId = `${parentSessionId}:delegate:${agentDef.id}`;

  // 使用 submitAndWait 同步执行
  const result = await withTimeout(
    agentExecutor.submitAndWait({
      sessionId: subSessionId,
      message,
      builder,
      signal
    }),
    DEFAULT_TIMEOUT_MS
  );

  return {
    output: result.output,
    toolCalls: result.toolCalls?.map((tc) => ({ toolName: tc.toolName }))
  };
}

// ==================== 经验收集 ====================

/**
 * 收集 experiences/ 目录下的所有经验文件
 *
 * @returns 合并后的经验文本，或 null（无经验）
 */
function collectExperiences(experiencesDir: string): string | null {
  if (!fs.existsSync(experiencesDir)) return null;

  const files = fs.readdirSync(experiencesDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return null;

  const parts: string[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(experiencesDir, file), 'utf-8');
      parts.push(`### ${file}\n${content}`);
    } catch {
      // 读取失败跳过
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

// ==================== 辅助函数 ====================

/** 确保多个目录存在 */
function ensureDirs(dirs: string[]): void {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
