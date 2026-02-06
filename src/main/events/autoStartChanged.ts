import { app } from 'electron'
import { log } from '@main/common/logger'

/**
 * 自动启动变更事件处理器
 * 事件名: config:autoStart:changed
 * 对应事件: EventTypes.CONFIG_AUTO_START_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理自动启动变更事件:', payload.value)

  const autoStart = payload.value
  const isLinux = process.platform === 'linux'

  if (isLinux) {
    log.warn('[Event] Linux 平台不支持自动设置开机启动')
  } else {
    // 设置开机启动配置
    app.setLoginItemSettings({
      openAtLogin: autoStart,
      openAsHidden: false // 后续可以根据 startToTray 配置决定
    })

    log.info(`[Event] 操作系统: ${process.platform}`)
    log.info(`[Event] 设置开机启动: ${autoStart}`)
  }
}
