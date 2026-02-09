/**
 * Worker 协调器
 * 管理 Worker（Agent）池，分配和执行子任务
 */

import { run } from '@openai/agents'
import { agentFactory } from '../agents/AgentFactory'
import type { SubTask, WorkerInfo } from './types'

/**
 * Worker 协调器接口
 */
export interface IWorkerCoordinator {
  /**
   * 获取或创建 Worker
   * @param workerType Worker 类型（code/research/chat）
   */
  getOrCreateWorker(workerType: string): Promise<WorkerInfo>

  /**
   * 执行子任务
   * @param subTask 子任务
   * @param worker Worker 信息
   */
  executeSubTask(subTask: SubTask, worker: WorkerInfo): Promise<unknown>

  /**
   * 获取 Worker 状态
   * @param workerId Worker ID
   */
  getWorkerStatus(workerId: string): WorkerInfo | null

  /**
   * 清理所有 Workers
   */
  clear(): void
}

/**
 * Worker 协调器实现
 */
export class WorkerCoordinator implements IWorkerCoordinator {
  // Worker 池：workerId -> WorkerInfo
  private workers = new Map<string, WorkerInfo>()

  // Worker 计数器（用于生成唯一 ID）
  private workerCounter = 0

  /**
   * 获取或创建 Worker
   */
  async getOrCreateWorker(workerType: string): Promise<WorkerInfo> {
    // 查找空闲的 Worker
    for (const worker of this.workers.values()) {
      if (worker.type === workerType && worker.status === 'idle') {
        return worker
      }
    }

    // 创建新的 Worker
    const workerId = `worker-${workerType}-${++this.workerCounter}`

    // 使用 AgentFactory 创建 Agent
    const agent = await agentFactory.createAgent(workerId, {
      preset: this.mapWorkerTypeToPreset(workerType)
    })

    const workerInfo: WorkerInfo = {
      id: workerId,
      name: workerType,
      type: workerType,
      agent,
      status: 'idle'
    }

    this.workers.set(workerId, workerInfo)

    return workerInfo
  }

  /**
   * 执行子任务
   */
  async executeSubTask(subTask: SubTask, worker: WorkerInfo): Promise<unknown> {
    try {
      // 更新 Worker 状态
      worker.status = 'busy'
      worker.currentTaskId = subTask.id

      // 构建子任务提示词
      const prompt = this.buildSubTaskPrompt(subTask)

      // 使用 @openai/agents SDK 的 run() 函数执行（带 maxTurns 循环保护）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await run(worker.agent as any, prompt, {
        maxTurns: 25
      })

      // 恢复状态
      worker.status = 'idle'
      worker.currentTaskId = undefined

      return result.finalOutput
    } catch (error: unknown) {
      worker.status = 'error'
      throw error
    }
  }

  /**
   * 获取 Worker 状态
   */
  getWorkerStatus(workerId: string): WorkerInfo | null {
    return this.workers.get(workerId) || null
  }

  /**
   * 清理所有 Workers
   */
  clear(): void {
    this.workers.clear()
    this.workerCounter = 0
  }

  /**
   * 将 Worker 类型映射到 Agent 预设
   */
  private mapWorkerTypeToPreset(workerType: string): 'chat' | 'code' | 'research' {
    switch (workerType.toLowerCase()) {
      case 'code':
        return 'code'
      case 'research':
        return 'research'
      case 'chat':
      default:
        return 'chat'
    }
  }

  /**
   * 构建子任务提示词
   */
  private buildSubTaskPrompt(subTask: SubTask): string {
    let prompt = `**Your Task**: ${subTask.name}\n\n`

    if (subTask.description) {
      prompt += `**Details**: ${subTask.description}\n\n`
    }

    if (subTask.dependencies && subTask.dependencies.length > 0) {
      prompt += `**Note**: This task depends on: ${subTask.dependencies.join(', ')}\n\n`
    }

    prompt += `Please complete this task thoroughly and provide your result.`

    return prompt
  }
}
