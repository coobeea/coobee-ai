/**
 * 规划者（Planner）
 * 负责将高层任务分解为可执行的子任务
 *
 * 基于 AgentRuntime 实现 — SDK 无关。
 * 通过 AgentExecutor 的 PiMonoBuilder 创建内部 Planner Agent，
 * 由 LLM 完成任务分解，输出结构化的 ExecutionPlan。
 */

import { z } from 'zod';
import { createLogger } from '@main/common/logger';
import type { Task, SubTask, ExecutionPlan, ExecutionStage, SubTaskStatus } from './types';

const log = createLogger('orchestration:planner');

// ========== 结构化输出 Schema ==========

/**
 * 子任务输出 Schema
 */
const SubTaskSchema = z.object({
  id: z.string().describe('子任务唯一标识，如 "subtask-1"'),
  objective: z.string().describe('子任务目标'),
  description: z.string().optional().describe('子任务详细描述'),
  dependencies: z.array(z.string()).default([]).describe('依赖的子任务 ID 列表'),
  assignedWorker: z.string().default('general').describe('分配的 Worker 类型或 Agent ID')
});

const StageSchema = z.object({
  stageId: z.string().describe('阶段唯一标识'),
  name: z.string().describe('阶段名称'),
  subTaskIds: z.array(z.string()).default([]).describe('包含的子任务 ID 列表'),
  parallelizable: z.boolean().default(false).describe('是否可并行执行')
});

/**
 * 规划输出 Schema
 */
const PlanOutputSchema = z.object({
  subTasks: z.array(SubTaskSchema).describe('子任务列表'),
  stages: z.array(StageSchema).describe('执行阶段列表')
});

/** 规划输出类型 */
type PlanOutput = z.infer<typeof PlanOutputSchema>;

/**
 * 规划者接口
 */
export interface IPlanner {
  /**
   * 规划任务
   * @param task 任务定义
   */
  plan(task: Task): Promise<ExecutionPlan>;

  /**
   * 重新规划（当任务失败时）
   * @param task 原始任务
   * @param failureInfo 失败信息
   */
  replan(task: Task, failureInfo: { failedSubTaskId: string; reason: string }): Promise<ExecutionPlan>;
}

/**
 * 规划者实现
 *
 * 通过 AgentRuntime (PiMonoBuilder) 创建一个临时的 Planner Agent，
 * 让 LLM 分析任务并输出结构化的执行计划。
 *
 * 与旧实现的区别：
 *   - 不依赖 @openai/agents SDK
 *   - 使用项目统一的 AgentExecutor + PiMonoBuilder
 *   - 使用配置的模型（而非硬编码 gpt-4o）
 *   - 支持 AbortSignal
 */
export class Planner implements IPlanner {
  constructor(
    private readonly options?: {
      /** 父 sessionId（= threadId），用于子 sessionId 命名 */
      parentSessionId?: string;
      /** 自定义模型（不传则使用配置默认值） */
      model?: string;
      /** 中止信号 */
      signal?: AbortSignal;
    }
  ) {}

  /**
   * 规划任务
   *
   * 构建规划提示词 → 调用 LLM → 解析结构化输出 → 返回 ExecutionPlan
   */
  async plan(task: Task): Promise<ExecutionPlan> {
    const prompt = this.buildPlanningPrompt(task);
    const output = await this.callPlannerAgent(prompt);
    const planData = this.convertPlanOutput(output, task.id);

    log.info(`[Planner] Plan created: ${planData.subTasks.length} subtasks, ${planData.stages.length} stages`);

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    };
  }

  /**
   * 重新规划
   */
  async replan(task: Task, failureInfo: { failedSubTaskId: string; reason: string }): Promise<ExecutionPlan> {
    const replanPrompt = `
Original Task: ${task.objective}

Failed Subtask: ${failureInfo.failedSubTaskId}
Failure Reason: ${failureInfo.reason}

Please create a new execution plan that addresses this failure.
Consider:
- Why did this subtask fail?
- What alternative approach can we use?
- Should we split this subtask further?
- Are there missing prerequisites?
`;

    const output = await this.callPlannerAgent(replanPrompt);
    const planData = this.convertPlanOutput(output, task.id);

    log.info(`[Planner] Replan created: ${planData.subTasks.length} subtasks, ${planData.stages.length} stages`);

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    };
  }

  // ========== 内部方法 ==========

  /**
   * 调用 Planner Agent
   *
   * 通过 AgentExecutor 创建临时的 PiMono Runtime 执行规划请求。
   * Runtime 用完即销毁（无状态）。
   */
  private async callPlannerAgent(prompt: string): Promise<PlanOutput | null> {
    const { agentExecutor } = await import('../AgentExecutor');
    const { WorkspaceManager } = await import('../storage/WorkspaceManager');
    const path = await import('node:path');

    const prefix = this.options?.parentSessionId || `planner-${Date.now()}`;
    const sessionId = this.options?.parentSessionId ? `${prefix}:planner` : prefix;

    // 🆕 创建嵌套 workspace
    let subAgentWorkspace: string | undefined;
    if (this.options?.parentSessionId) {
      const { Env } = await import('@main/common/env');
      const mainWorkspace = await Env.getAgentWorkspaceDir(this.options.parentSessionId);
      subAgentWorkspace = WorkspaceManager.getOrCreateSubAgentWorkspace({
        agentName: 'planner',
        sessionId,
        type: 'planner',
        threadWorkspace: mainWorkspace,
        enableSkills: true,
        enableExtensions: true
      });
    }

    const builder = agentExecutor
      .piMono()
      .name('Orchestration Planner')
      .mode('chat')
      .sessionMode('file')
      .instructions(PLANNER_INSTRUCTIONS)
      .sessionId(sessionId);

    if (this.options?.model) {
      builder.model(this.options.model);
    }

    // 🆕 如果有嵌套 workspace，手动设置
    if (subAgentWorkspace) {
      builder
        .sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions'))
        .workspaceRoot(subAgentWorkspace)
        .contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
    }

    let runtime: import('../runtime/AgentRuntime').AgentRuntime | null = null;

    try {
      runtime = await builder.build();

      // 同步执行（Planner 不需要流式）
      const result = await runtime.run(prompt);

      // 尝试从 LLM 输出中提取结构化计划
      return this.parseOutput(result.output);
    } catch (error) {
      log.error('[Planner] Agent execution failed:', error);
      return null;
    } finally {
      if (runtime) {
        try {
          await runtime.destroy();
        } catch {
          // 静默
        }
      }
    }
  }

  /**
   * 解析 LLM 输出为结构化 PlanOutput
   *
   * 尝试多种解析策略：
   * 1. 直接 JSON 解析
   * 2. 从 markdown 代码块中提取 JSON
   * 3. 使用 Zod schema 验证
   */
  private parseOutput(rawOutput: string): PlanOutput | null {
    if (!rawOutput) return null;

    // 策略 1：直接 JSON 解析
    try {
      const parsed = JSON.parse(rawOutput);
      const validated = PlanOutputSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // 不是纯 JSON，继续尝试
    }

    // 策略 2：从 markdown 代码块提取
    const jsonMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const validated = PlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // 解析失败，继续
      }
    }

    // 策略 3：尝试查找 JSON 对象（从第一个 { 到最后一个 }）
    const firstBrace = rawOutput.indexOf('{');
    const lastBrace = rawOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const jsonStr = rawOutput.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        const validated = PlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // 解析失败
      }
    }

    log.warn('[Planner] Failed to parse structured output, using default plan');
    return null;
  }

  /**
   * 构建规划提示词
   */
  private buildPlanningPrompt(task: Task): string {
    let prompt = `Please plan how to execute the following task:\n\n`;
    prompt += `**Objective**: ${task.objective}\n`;

    if (task.description) {
      prompt += `**Description**: ${task.description}\n`;
    }

    if (task.requirements?.length) {
      prompt += `**Requirements**:\n${task.requirements.map((r) => `- ${r}`).join('\n')}\n`;
    }

    if (task.constraints?.length) {
      prompt += `**Constraints**:\n${task.constraints.map((c) => `- ${c}`).join('\n')}\n`;
    }

    if (task.context) {
      prompt += `**Context**:\n${JSON.stringify(task.context, null, 2)}\n`;
    }

    prompt += `\nPlease provide an execution plan as a JSON object with the following structure:\n`;
    prompt += '```json\n';
    prompt += `{
  "subTasks": [
    {
      "id": "subtask-1",
      "objective": "What to accomplish",
      "description": "Detailed description",
      "dependencies": [],
      "assignedWorker": "general"
    }
  ],
  "stages": [
    {
      "stageId": "stage-1",
      "name": "Stage name",
      "subTaskIds": ["subtask-1"],
      "parallelizable": false
    }
  ]
}\n`;
    prompt += '```\n';
    prompt += `\nIMPORTANT: Return ONLY the JSON object, no other text.`;

    return prompt;
  }

  /**
   * 将 PlanOutput 转换为内部类型
   */
  private convertPlanOutput(
    output: PlanOutput | null,
    taskId: string
  ): {
    subTasks: SubTask[];
    stages: ExecutionStage[];
  } {
    if (!output) {
      log.warn('[Planner] No structured output, using default plan');
      return this.getDefaultPlan(taskId);
    }

    const subTasks: SubTask[] = output.subTasks.map(
      (st): SubTask => ({
        id: st.id,
        taskId,
        name: st.objective,
        description: st.description || st.objective,
        dependencies: st.dependencies,
        assignedWorker: st.assignedWorker,
        status: 'pending' as SubTaskStatus
      })
    );

    const stages: ExecutionStage[] = output.stages.map((stage, index) => {
      const stageTasks = subTasks.filter((st) => stage.subTaskIds.includes(st.id));
      return {
        id: stage.stageId,
        name: stage.name,
        tasks: stageTasks,
        order: index,
        parallel: stage.parallelizable
      };
    });

    return { subTasks, stages };
  }

  /**
   * 默认计划（降级方案）
   */
  private getDefaultPlan(taskId: string): { subTasks: SubTask[]; stages: ExecutionStage[] } {
    const defaultSubTask: SubTask = {
      id: 'subtask-1',
      taskId,
      name: 'Complete the task',
      description: 'Execute the task as a single unit',
      dependencies: [],
      assignedWorker: 'general',
      status: 'pending' as SubTaskStatus
    };

    return {
      subTasks: [defaultSubTask],
      stages: [
        {
          id: 'stage-1',
          name: 'Main Stage',
          tasks: [defaultSubTask],
          order: 0,
          parallel: false
        }
      ]
    };
  }
}

// ========== Planner Agent 指令 ==========

const PLANNER_INSTRUCTIONS = `You are a task planning expert. Your job is to decompose high-level tasks into executable subtasks.

Guidelines:
- Break down the task into clear, actionable subtasks
- Identify dependencies between subtasks (a subtask can only start after its dependencies are completed)
- Assign each subtask to an appropriate worker type:
  - "general": General-purpose agent for most tasks
  - Or a specific agent ID if the task requires a specialized agent
- Group subtasks into stages:
  - Tasks in the same stage with parallelizable=true can run concurrently
  - Stages execute sequentially (stage N completes before stage N+1 starts)
- Keep subtasks focused and manageable (each should be completable independently)

Output Format:
- Return ONLY a valid JSON object (no markdown, no explanation)
- The JSON must conform to the schema described in the prompt`;

// 导出 Schema 供外部使用（如测试）
export { PlanOutputSchema, type PlanOutput };
