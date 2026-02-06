import { app } from 'electron'
import { log } from '@main/common/logger'

/**
 * 启动到托盘变更事件处理器
 * 事件名: config:startToTray:changed
 * 对应事件: EventTypes.CONFIG_START_TO_TRAY_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理启动到托盘变更事件:', payload.value)

  // 更新开机启动设置（需要同步 autoStart 配置）
  const loginItemSettings = app.getLoginItemSettings()
  if (loginItemSettings.openAtLogin) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: payload.value
    })
    log.info(`[Event] 更新开机启动隐藏设置: ${payload.value}`)
  }
}
