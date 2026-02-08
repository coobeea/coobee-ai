/**
 * 运行时工厂
 * 根据配置创建 Agent 或 Team 运行时实例
 */

import { AgentRuntime } from './AgentRuntime'
import { TeamRuntime } from './TeamRuntime'
import { agentConfigStore } from '../storage/AgentConfigStore'
import { teamConfigStore } from '../storage/TeamConfigStore'
import type { IExecutable } from './types'

/**
 * 运行时类型
 */
export type RuntimeType = 'agent' | 'team'

/**
 * 运行时创建选项
 */
export interface RuntimeCreateOptions {
  /** 运行时类型 */
  type: RuntimeType
  /** Agent ID 或 Team ID */
  id: string
  /** 会话 ID（可选，自动生成） */
  sessionId?: string
}

/**
 * 运行时工厂
 */
export class RuntimeFactory {
  private runtimes = new Map<string, IExecutable>()

  /**
   * 创建运行时实例
   */
  async createRuntime(options: RuntimeCreateOptions): Promise<IExecutable> {
    const { type, id, sessionId } = options
    const key = `${type}-${id}-${sessionId || 'default'}`

    // 检查是否已存在
    if (this.runtimes.has(key)) {
      return this.runtimes.get(key)!
    }

    // 创建新的运行时实例
    let runtime: IExecutable

    if (type === 'agent') {
      runtime = new AgentRuntime(id, sessionId)
    } else if (type === 'team') {
      runtime = new TeamRuntime(id, sessionId)
    } else {
      throw new Error(`Unknown runtime type: ${type}`)
    }

    // 初始化
    await runtime.initialize()

    // 缓存
    this.runtimes.set(key, runtime)

    return runtime
  }

  /**
   * 自动检测类型并创建运行时实例
   * 先尝试 Agent，再尝试 Team
   */
  async createRuntimeAuto(id: string, sessionId?: string): Promise<IExecutable> {
    // 1. 尝试作为 Agent
    const agentConfig = await agentConfigStore.getConfig(id)
    if (agentConfig) {
      return await this.createRuntime({ type: 'agent', id, sessionId })
    }

    // 2. 尝试作为 Team
    const teamConfig = await teamConfigStore.getTeam(id)
    if (teamConfig) {
      return await this.createRuntime({ type: 'team', id, sessionId })
    }

    throw new Error(`Runtime not found: ${id}`)
  }

  /**
   * 获取已创建的运行时实例
   */
  getRuntime(type: RuntimeType, id: string, sessionId?: string): IExecutable | null {
    const key = `${type}-${id}-${sessionId || 'default'}`
    return this.runtimes.get(key) || null
  }

  /**
   * 销毁运行时实例
   */
  async destroyRuntime(type: RuntimeType, id: string, sessionId?: string): Promise<void> {
    const key = `${type}-${id}-${sessionId || 'default'}`
    const runtime = this.runtimes.get(key)

    if (runtime) {
      await runtime.destroy()
      this.runtimes.delete(key)
    }
  }

  /**
   * 销毁所有运行时实例
   */
  async destroyAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await runtime.destroy()
    }
    this.runtimes.clear()
  }
}

/**
 * 全局运行时工厂实例
 */
export const runtimeFactory = new RuntimeFactory()
