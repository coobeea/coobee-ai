/**
 * 规划者（Planner）
 * 负责将高层任务分解为可执行的子任务
 * 基于 @openai/agents SDK 实现
 *
 * SDK 合规改进：
 * - 使用 outputType (Zod schema) 替代手动 JSON 解析，获得类型安全的结构化输出
 * - 使用 maxTurns 防止无限工具调用循环
 */

import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import type { Task, SubTask, ExecutionPlan, ExecutionStage, SubTaskStatus } from './types'

// ========== 结构化输出 Schema ==========

/**
 * 子任务输出 Schema（Zod 定义）
 * SDK 通过 outputType 自动验证和解析 Agent 输出
 */
const SubTaskSchema = z.object({
  id: z.string().describe('子任务唯一标识，如 "subtask-1"'),
  objective: z.string().describe('子任务目标'),
  description: z.string().optional().describe('子任务详细描述'),
  dependencies: z.array(z.string()).default([]).describe('依赖的子任务 ID 列表'),
  assignedWorker: z
    .enum(['code', 'research', 'chat'])
    .default('chat')
    .describe('分配的 Worker 类型')
})

const StageSchema = z.object({
  stageId: z.string().describe('阶段唯一标识'),
  name: z.string().describe('阶段名称'),
  subTaskIds: z.array(z.string()).default([]).describe('包含的子任务 ID 列表'),
  parallelizable: z.boolean().default(false).describe('是否可并行执行')
})

/**
 * 规划输出 Schema
 * Agent 输出将被 SDK 自动解析为此结构
 */
const PlanOutputSchema = z.object({
  subTasks: z.array(SubTaskSchema).describe('子任务列表'),
  stages: z.array(StageSchema).describe('执行阶段列表')
})

/** 规划输出类型 */
type PlanOutput = z.infer<typeof PlanOutputSchema>

/** Planner Agent 默认 maxTurns（防止无限循环） */
const PLANNER_MAX_TURNS = 5

/**
 * 规划者接口
 */
export interface IPlanner {
  /**
   * 规划任务
   * @param task 任务定义
   */
  plan(task: Task): Promise<ExecutionPlan>

  /**
   * 重新规划（当任务失败时）
   * @param task 原始任务
   * @param failureInfo 失败信息
   */
  replan(
    task: Task,
    failureInfo: { failedSubTaskId: string; reason: string }
  ): Promise<ExecutionPlan>
}

/**
 * 规划者实现
 * 使用专门的 Planner Agent（基于 @openai/agents）
 *
 * SDK 特性：
 * - outputType: 使用 Zod schema 定义结构化输出，SDK 自动验证和解析
 * - maxTurns: 限制 Agent 执行循环次数
 */
export class Planner implements IPlanner {
  private plannerAgent: Agent<undefined, typeof PlanOutputSchema>

  constructor() {
    // 创建专门的规划 Agent，配置 outputType 结构化输出
    this.plannerAgent = new Agent({
      name: 'Planner',
      instructions: `You are a task planning expert. Your job is to decompose high-level tasks into executable subtasks.

Guidelines:
- Break down the task into clear, actionable subtasks
- Identify dependencies between subtasks
- Suggest which type of agent should handle each subtask (code/research/chat)
- Group subtasks into stages (parallelizable or sequential)
- Keep subtasks focused and manageable`,
      model: 'gpt-4o',
      // SDK outputType: 结构化输出，自动验证和解析为 PlanOutput 类型
      outputType: PlanOutputSchema
    })
  }

  /**
   * 规划任务
   *
   * SDK 改进：使用 outputType 后，result.finalOutput 直接是类型安全的 PlanOutput 对象
   * 无需手动 JSON 解析和正则提取
   */
  async plan(task: Task): Promise<ExecutionPlan> {
    // 构建规划请求
    const planningPrompt = this.buildPlanningPrompt(task)

    // 调用 Planner Agent（带 maxTurns 循环保护）
    const result = await run(this.plannerAgent, planningPrompt, {
      maxTurns: PLANNER_MAX_TURNS
    })

    // SDK outputType 自动解析：finalOutput 已是 PlanOutput 类型
    const planData = this.convertPlanOutput(result.finalOutput)

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    }
  }

  /**
   * 重新规划
   */
  async replan(
    task: Task,
    failureInfo: { failedSubTaskId: string; reason: string }
  ): Promise<ExecutionPlan> {
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
`

    const result = await run(this.plannerAgent, replanPrompt, {
      maxTurns: PLANNER_MAX_TURNS
    })

    const planData = this.convertPlanOutput(result.finalOutput)

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    }
  }

  /**
   * 构建规划提示词
   */
  private buildPlanningPrompt(task: Task): string {
    let prompt = `Please plan how to execute the following task:\n\n`
    prompt += `**Objective**: ${task.objective}\n`

    if (task.description) {
      prompt += `**Description**: ${task.description}\n`
    }

    if (task.context) {
      prompt += `**Context**:\n${JSON.stringify(task.context, null, 2)}\n`
    }

    prompt += `\n**Available Worker Types**:\n`
    prompt += `- "code": Code generation, debugging, technical implementation\n`
    prompt += `- "research": Information gathering, web search, analysis\n`
    prompt += `- "chat": General conversation, explanation, guidance\n`

    prompt += `\nPlease provide a detailed execution plan.`

    return prompt
  }

  /**
   * 将 SDK outputType 输出转换为内部类型
   *
   * SDK outputType 保证 finalOutput 已通过 Zod schema 验证
   * 这里只需进行类型映射，无需 JSON 解析或错误处理
   */
  private convertPlanOutput(output: PlanOutput | undefined): {
    subTasks: SubTask[]
    stages: ExecutionStage[]
  } {
    // 如果 outputType 解析失败（例如模型未返回合法输出），使用默认计划
    if (!output) {
      console.warn('[Planner] No structured output from agent, using default plan')
      return this.getDefaultPlan()
    }

    const subTasks: SubTask[] = output.subTasks.map(
      (st): SubTask => ({
        id: st.id,
        taskId: '', // 将在外部设置
        name: st.objective,
        description: st.description || st.objective,
        dependencies: st.dependencies,
        assignedWorker: st.assignedWorker,
        status: 'pending' as SubTaskStatus
      })
    )

    const stages: ExecutionStage[] = output.stages.map((stage, index) => {
      const stageTasks = subTasks.filter((st) => stage.subTaskIds.includes(st.id))
      return {
        id: stage.stageId,
        name: stage.name,
        tasks: stageTasks,
        order: index,
        parallel: stage.parallelizable
      }
    })

    return { subTasks, stages }
  }

  /**
   * 默认计划（降级方案）
   */
  private getDefaultPlan(): { subTasks: SubTask[]; stages: ExecutionStage[] } {
    const defaultSubTask: SubTask = {
      id: 'subtask-1',
      taskId: '',
      name: 'Complete the task',
      description: 'Execute the task as a single unit',
      dependencies: [],
      assignedWorker: 'chat',
      status: 'pending' as SubTaskStatus
    }

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
    }
  }
}

// 导出 Schema 供外部使用（如测试）
export { PlanOutputSchema, type PlanOutput }
