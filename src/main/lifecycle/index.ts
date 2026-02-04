/**
 * 生命周期管理模块
 */

export { LifecycleManager } from './LifecycleManager'
export {
  LifecyclePhase,
  type LifecycleHook,
  type LifecycleContext,
  type ILifecycleManager,
  type LifecycleHookExecutionResult
} from './types'

/**
 * 创建生命周期管理器单例
 */
let lifecycleManager: InstanceType<typeof LifecycleManager> | null = null

export function getLifecycleManager(): InstanceType<typeof LifecycleManager> {
  if (!lifecycleManager) {
    const { LifecycleManager } = require('./LifecycleManager')
    lifecycleManager = new LifecycleManager()
  }
  return lifecycleManager
}
