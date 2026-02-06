import { log } from '@main/common/logger'

/**
 * 硬件加速变更事件处理器
 * 事件名: config:hardwareAcceleration:changed
 * 对应事件: EventTypes.CONFIG_HARDWARE_ACCELERATION_CHANGED
 *
 * 注意：硬件加速的开关需要在 app.ready 之前设置
 * 运行时修改需要重启应用才能生效
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 硬件加速配置已更新:', payload.value)
  log.warn('[Event] 硬件加速设置需要重启应用才能生效')

  // 硬件加速的实际开关应该在应用启动时处理
  // 这里只是记录日志，提示用户需要重启
  if (!payload.value) {
    log.info('[Event] 下次启动时将禁用硬件加速')
  } else {
    log.info('[Event] 下次启动时将启用硬件加速')
  }
}
