/**
 * 规划者（Planner）
 * 负责将高层任务分解为可执行的子任务
 * 基于 @openai/agents SDK 实现
 */

import { Agent, run } from '@openai/agents'
import type { Task, SubTask, ExecutionPlan, ExecutionStage } from './types'

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
 */
export class Planner implements IPlanner {
  private plannerAgent: Agent

  constructor() {
    // 创建专门的规划 Agent
    this.plannerAgent = new Agent({
      name: 'Planner',
      instructions: `You are a task planning expert. Your job is to decompose high-level tasks into executable subtasks.

Guidelines:
- Break down the task into clear, actionable subtasks
- Identify dependencies between subtasks
- Suggest which type of agent should handle each subtask (code/research/chat)
- Group subtasks into stages (parallelizable or sequential)
- Keep subtasks focused and manageable

Output format (JSON):
{
  "subTasks": [
    {
      "id": "subtask-1",
      "objective": "Clear goal",
      "description": "Detailed description",
      "dependencies": [],
      "assignedWorker": "code"  // code/research/chat
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
}`,
      model: 'gpt-4o'
    })
  }

  /**
   * 规划任务
   */
  async plan(task: Task): Promise<ExecutionPlan> {
    // 构建规划请求
    const planningPrompt = this.buildPlanningPrompt(task)

    // 调用 Planner Agent
    const result = await run(this.plannerAgent, planningPrompt)

    // 解析规划结果
    const planData = this.parsePlanningResult(result.finalOutput || '')

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

    const result = await run(this.plannerAgent, replanPrompt)
    const planData = this.parsePlanningResult(result.finalOutput || '')

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
   * 解析规划结果
   */
  private parsePlanningResult(output: string): { subTasks: SubTask[]; stages: ExecutionStage[] } {
    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in planning result')
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        subTasks?: Array<{
          id: string
          objective: string
          description?: string
          dependencies?: string[]
          assignedWorker?: string
        }>
        stages?: Array<{
          stageId: string
          name: string
          subTaskIds?: string[]
          parallelizable?: boolean
        }>
      }

      // 转换为标准格式
      const subTasks: SubTask[] = (parsed.subTasks || []).map((st) => ({
        id: st.id,
        taskId: '', // 将在外部设置
        name: st.objective || 'Unnamed Subtask',
        objective: st.objective,
        description: st.description || st.objective || '',
        dependencies: st.dependencies || [],
        workerId: st.assignedWorker || 'chat',
        assignedWorker: st.assignedWorker || 'chat',
        status: 'pending' as const
      }))

      const stages: ExecutionStage[] = (parsed.stages || []).map((stage, index) => ({
        id: stage.stageId,
        name: stage.name,
        subTaskIds: stage.subTaskIds || [],
        order: index,
        parallel: stage.parallelizable ?? false,
        parallelizable: stage.parallelizable ?? false
      }))

      return { subTasks, stages }
    } catch (error) {
      console.error('[Planner] Failed to parse planning result:', error)

      // 返回默认计划（单个子任务）
      return {
        subTasks: [
          {
            id: 'subtask-1',
            taskId: '',
            name: 'Complete the task',
            objective: 'Complete the task',
            description: 'Execute the task as a single unit',
            dependencies: [],
            workerId: 'chat',
            assignedWorker: 'chat',
            status: 'pending'
          }
        ],
        stages: [
          {
            id: 'stage-1',
            name: 'Main Stage',
            subTaskIds: ['subtask-1'],
            order: 0,
            parallel: false,
            parallelizable: false
          }
        ]
      }
    }
  }
}
