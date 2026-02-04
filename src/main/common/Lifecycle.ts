/**
 * 生命周期管理器 - 简化版
 *
 * 功能：
 * - 管理应用生命周期的三个阶段：初始化、就绪、退出前
 * - 支持注册和执行生命周期 Hook
 * - 按优先级顺序执行 Hook
 * - 支持关键/非关键 Hook 的错误处理
 */

import { app } from 'electron'

import { log } from './logger'
import {
  LifecyclePhase,
  LifecycleHook,
  LifecycleContext,
  LifecycleHookExecutionResult
} from './types'

export class LifecycleManager {
  private currentPhase: LifecyclePhase | null = null
  private hooks: Map<LifecyclePhase, Array<{ id: string; hook: LifecycleHook }>> = new Map()
  private hookIdCounter = 0
  private isShuttingDown = false
  private context: LifecycleContext

  constructor() {
    // 初始化各阶段的 Hook 数组
    Object.values(LifecyclePhase).forEach((phase) => {
      this.hooks.set(phase, [])
    })

    // 初始化上下文
    this.context = {
      phase: LifecyclePhase.INIT,
      manager: this,
      data: {}
    }

    // 设置退出拦截
    this.setupShutdownInterception()
  }

  /**
   * 启动生命周期管理
   */
  async start(): Promise<void> {
    if (this.currentPhase !== null) {
      throw new Error('LifecycleManager 已经启动过了')
    }

    log.info('[LifecycleManager] 启动生命周期管理')

    try {
      // 依次执行各个阶段
      await this.executePhase(LifecyclePhase.INIT)
      await this.executePhase(LifecyclePhase.READY)

      log.info('[LifecycleManager] 启动完成')
    } catch (error) {
      log.error('[LifecycleManager] 启动失败:', error)
      throw error
    }
  }

  /**
   * 注册生命周期 Hook
   */
  registerHook(hook: LifecycleHook): string {
    const hookId = `hook_${++this.hookIdCounter}_${Date.now()}`
    const phaseHooks = this.hooks.get(hook.phase)

    if (!phaseHooks) {
      throw new Error(`无效的生命周期阶段: ${hook.phase}`)
    }

    // 按优先级插入 (数字越小越靠前)
    const insertIndex = phaseHooks.findIndex((h) => h.hook.priority > hook.priority)

    if (insertIndex === -1) {
      phaseHooks.push({ id: hookId, hook })
    } else {
      phaseHooks.splice(insertIndex, 0, { id: hookId, hook })
    }

    log.info(
      `[LifecycleManager] 注册 Hook: ${hook.name} (阶段: ${hook.phase}, 优先级: ${hook.priority})`
    )

    return hookId
  }

  /**
   * 请求关闭应用
   */
  async requestShutdown(): Promise<boolean> {
    log.info('[LifecycleManager] 请求关闭应用')

    try {
      // 执行退出前阶段的 Hook
      const canShutdown = await this.executeShutdownPhase(LifecyclePhase.BEFORE_QUIT)

      if (canShutdown) {
        log.info('[LifecycleManager] 允许关闭应用')
      } else {
        log.info('[LifecycleManager] 关闭被阻止')
      }

      return canShutdown
    } catch (error) {
      log.error('[LifecycleManager] 关闭过程出错:', error)
      return false
    }
  }

  /**
   * 执行生命周期阶段
   */
  private async executePhase(phase: LifecyclePhase): Promise<void> {
    this.currentPhase = phase
    this.context.phase = phase

    const phaseHooks = this.hooks.get(phase) || []
    log.info(`[LifecycleManager] 执行阶段: ${phase} (${phaseHooks.length} 个 Hook)`)

    // 按优先级分组
    const priorityGroups = this.groupHooksByPriority(phaseHooks)

    // 依次执行每个优先级组
    for (const priority of priorityGroups.keys()) {
      const groupHooks = priorityGroups.get(priority)!
      log.info(`[LifecycleManager] 执行优先级组: ${priority} (${groupHooks.length} 个 Hook)`)

      // 并行执行同优先级的 Hook
      const results = await Promise.allSettled(
        groupHooks.map(({ id, hook }) => this.executeHook(id, hook, this.context))
      )

      // 处理执行结果
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const hookResult = result.value
          if (!hookResult.success && hookResult.hook.critical) {
            throw hookResult.error || new Error(`关键 Hook '${hookResult.hook.name}' 执行失败`)
          }
        }
      }
    }

    log.info(`[LifecycleManager] 阶段完成: ${phase}`)
  }

  /**
   * 执行关闭阶段 (可被拦截)
   */
  private async executeShutdownPhase(phase: LifecyclePhase): Promise<boolean> {
    this.currentPhase = phase
    this.context.phase = phase

    const phaseHooks = this.hooks.get(phase) || []
    log.info(`[LifecycleManager] 执行关闭阶段: ${phase} (${phaseHooks.length} 个 Hook)`)

    // 按优先级分组
    const priorityGroups = this.groupHooksByPriority(phaseHooks)

    // 依次执行每个优先级组
    for (const priority of priorityGroups.keys()) {
      const groupHooks = priorityGroups.get(priority)!

      // 并行执行同优先级的 Hook
      const results = await Promise.allSettled(
        groupHooks.map(({ id, hook }) => this.executeHook(id, hook, this.context))
      )

      // 处理执行结果
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const hookResult = result.value

          // Hook 返回 false 表示阻止关闭
          if (hookResult.success && hookResult.result === false) {
            log.info(`[LifecycleManager] Hook '${hookResult.hook.name}' 阻止了关闭`)
            return false
          }

          // 关键 Hook 失败时记录错误但继续执行
          if (!hookResult.success && hookResult.hook.critical) {
            log.error(
              `[LifecycleManager] 关键 Hook '${hookResult.hook.name}' 失败，但继续关闭:`,
              hookResult.error
            )
          }
        }
      }
    }

    return true
  }

  /**
   * 执行单个 Hook
   */
  private async executeHook(
    hookId: string,
    hook: LifecycleHook,
    context: LifecycleContext
  ): Promise<LifecycleHookExecutionResult> {
    log.info(
      `[LifecycleManager] 执行 Hook: ${hook.name} (优先级: ${hook.priority}, 关键: ${hook.critical})`
    )

    try {
      const result = await hook.execute(context)

      log.info(`[LifecycleManager] Hook 完成: ${hook.name}`)

      return {
        hookId,
        hook,
        success: true,
        result
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log.error(`[LifecycleManager] Hook 失败: ${hook.name}`, err)

      return {
        hookId,
        hook,
        success: false,
        error: err
      }
    }
  }

  /**
   * 按优先级分组 Hook
   */
  private groupHooksByPriority(
    hooks: Array<{ id: string; hook: LifecycleHook }>
  ): Map<number, Array<{ id: string; hook: LifecycleHook }>> {
    const groups = new Map<number, Array<{ id: string; hook: LifecycleHook }>>()

    for (const hookEntry of hooks) {
      const priority = hookEntry.hook.priority
      if (!groups.has(priority)) {
        groups.set(priority, [])
      }
      groups.get(priority)!.push(hookEntry)
    }

    // 返回按优先级排序的 Map
    return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]))
  }

  /**
   * 设置关闭拦截
   */
  private setupShutdownInterception(): void {
    app.on('before-quit', async (event) => {
      if (!this.isShuttingDown) {
        event.preventDefault()
        this.isShuttingDown = true

        const canShutdown = await this.requestShutdown()

        if (canShutdown) {
          app.quit()
        } else {
          this.isShuttingDown = false
        }
      }
    })
  }

  /**
   * 获取上下文数据
   */
  getContextData<T>(key: string): T | undefined {
    return this.context.data?.[key] as T | undefined
  }

  /**
   * 设置上下文数据
   */
  setContextData(key: string, value: unknown): void {
    if (!this.context.data) {
      this.context.data = {}
    }
    this.context.data[key] = value
  }
}
