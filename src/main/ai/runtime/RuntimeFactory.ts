/**
 * 运行时工厂
 *
 * 根据配置创建并缓存 Agent / Team 运行时实例。
 * 所有配置通过参数传入，工厂本身不加载配置。
 */

import { AgentRuntime } from './AgentRuntime'
import { TeamRuntime } from './TeamRuntime'
import type { AgentRuntimeOptions } from './types'
import type { TeamRuntimeOptions } from './TeamRuntime'
import type { IExecutable } from './types'

/**
 * 运行时创建选项
 */
export type RuntimeCreateOptions =
  | { type: 'agent'; options: AgentRuntimeOptions }
  | { type: 'team'; options: TeamRuntimeOptions }

/**
 * 运行时工厂
 */
export class RuntimeFactory {
  private runtimes = new Map<string, IExecutable>()

  /**
   * 创建运行时实例
   */
  async createRuntime(createOptions: RuntimeCreateOptions): Promise<IExecutable> {
    let runtime: IExecutable

    if (createOptions.type === 'agent') {
      runtime = new AgentRuntime(createOptions.options)
    } else if (createOptions.type === 'team') {
      runtime = new TeamRuntime(createOptions.options)
    } else {
      throw new Error(`Unknown runtime type: ${(createOptions as { type: string }).type}`)
    }

    // 初始化
    await runtime.initialize()

    // 缓存
    const key = `${runtime.type}-${runtime.id}`
    this.runtimes.set(key, runtime)

    return runtime
  }

  /**
   * 获取已创建的运行时实例
   */
  getRuntime(id: string): IExecutable | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.id === id) return runtime
    }
    return null
  }

  /**
   * 销毁运行时实例
   */
  async destroyRuntime(id: string): Promise<void> {
    for (const [key, runtime] of this.runtimes.entries()) {
      if (runtime.id === id) {
        await runtime.destroy()
        this.runtimes.delete(key)
        return
      }
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

  /**
   * 获取所有运行时实例
   */
  getAllRuntimes(): IExecutable[] {
    return Array.from(this.runtimes.values())
  }
}

/**
 * 全局运行时工厂实例
 */
export const runtimeFactory = new RuntimeFactory()
