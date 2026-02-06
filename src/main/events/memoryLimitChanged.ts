import { log } from '@main/common/logger'

/**
 * 内存限制变更事件处理器
 * 事件名: config:memoryLimit:changed
 * 对应事件: EventTypes.CONFIG_MEMORY_LIMIT_CHANGED
 *
 * 注意：内存限制需要在应用启动时设置（通过 --js-flags）
 * 运行时修改需要重启应用才能生效
 */
export default (payload: { value: number }): void => {
  log.info('[Event] 处理内存限制变更事件:', payload.value, 'MB')
  log.warn('[Event] 内存限制变更需要重启应用才能生效')
  // 内存限制需要在启动参数中设置，如: --js-flags="--max-old-space-size=4096"
}
