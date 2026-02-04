/**
 * 生命周期管理器
 *
 * 提供生命周期 Hook 注册和执行机制，供其他模块在应用的不同阶段插入自己的逻辑
 *
 * 功能：
 * - 管理应用生命周期的三个阶段：初始化(INIT)、就绪(READY)、退出前(BEFORE_QUIT)
 * - 支持注册和执行生命周期 Hook
 * - 自动扫描并注册 Hook（使用 scan.ts 扫描 @main/lifecycle 目录）
 * - 按优先级顺序执行 Hook（数字越小优先级越高）
 * - 同优先级的 Hook 并行执行
 * - 支持关键/非关键 Hook 的错误处理
 *
 * 使用场景：
 * - 数据库模块在 INIT 阶段初始化连接
 * - 窗口模块在 READY 阶段创建主窗口
 * - 各模块在 BEFORE_QUIT 阶段清理资源
 */

import { log } from './logger'
import { scanLifeCycleHooks } from './scan'
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
  private context: LifecycleContext
  private autoScanCompleted = false

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

    // 自动扫描并注册 Hook
    this.autoRegisterHooks()
  }

  /**
   * 自动扫描并注册生命周期 Hook
   *
   * 使用 scan.ts 的 scanLifeCycleHooks() 函数扫描 @main/lifecycle 目录
   */
  private autoRegisterHooks(): void {
    if (this.autoScanCompleted) {
      log.warn('[LifecycleManager] Hook 自动扫描已完成，跳过重复扫描')
      return
    }

    log.info('[LifecycleManager] 开始自动扫描生命周期 Hook...')

    try {
      // 使用 scan.ts 扫描所有 Hook 文件 (@main/lifecycle/**/*Hook.ts)
      const discoveredModules = scanLifeCycleHooks()

      // 注册所有发现的 Hook
      let registeredCount = 0
      for (const discovered of discoveredModules) {
        const module = discovered.module

        // 遍历模块的所有导出，查找符合 LifecycleHook 接口的对象
        for (const [exportName, exportValue] of Object.entries(module)) {
          if (this.isLifecycleHook(exportValue)) {
            this.registerHook(exportValue as LifecycleHook)
            registeredCount++
            log.info(`[LifecycleManager] 自动注册 Hook: ${exportName} (来自 ${discovered.path})`)
          }
        }
      }

      this.autoScanCompleted = true
      log.info(`[LifecycleManager] Hook 自动扫描完成，共注册 ${registeredCount} 个 Hook`)
    } catch (error) {
      log.error('[LifecycleManager] Hook 自动扫描失败:', error)
      throw error
    }
  }

  /**
   * Check if an object is a LifecycleHook
   */
  private isLifecycleHook(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false

    const hook = obj as Record<string, unknown>
    return (
      typeof hook.name === 'string' &&
      typeof hook.phase === 'string' &&
      typeof hook.priority === 'number' &&
      typeof hook.critical === 'boolean' &&
      typeof hook.execute === 'function'
    )
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
   * 执行生命周期阶段
   * 供外部（如 AppManager）调用，在应用的不同阶段触发注册的 Hook
   */
  async executePhase(phase: LifecyclePhase): Promise<void> {
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
   * 获取当前阶段
   */
  getCurrentPhase(): LifecyclePhase | null {
    return this.currentPhase
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
