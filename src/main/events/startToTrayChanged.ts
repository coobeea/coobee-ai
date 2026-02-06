import { app } from 'electron'
import { log } from '@main/common/logger'

/**
 * 启动到托盘变更事件处理器
 * 事件名: config:startToTray:changed
 * 对应事件: EventTypes.CONFIG_START_TO_TRAY_CHANGED
 *
 * 注意：此设置需要配合 autoStart 使用
 * 当 startToTray 变更时，需要同步更新开机启动设置
 */
export default async (payload: { value: boolean }): Promise<void> => {
  log.info('[Event] 处理启动到托盘变更事件:', payload.value)

  const startToTray = payload.value
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  // 获取 autoStart 配置
  const { config } = await import('@main/common/config')
  const autoStart = config.getAutoStart()

  // 只有在开机启动开启时，才需要更新 startToTray 相关设置
  if (!autoStart) {
    log.info('[Event] 开机启动未开启，跳过启动到托盘设置')
    return
  }

  const appName = app.getName()

  // 更新开机启动设置（同步 startToTray）
  app.setLoginItemSettings({
    openAtLogin: true,
    type: isMac ? 'agentService' : undefined,
    name: `${appName}-${process.env.NODE_ENV || 'production'}`,
    path: process.execPath,
    args: isWindows ? ['--hidden'] : [],
    openAsHidden: startToTray
  })

  log.info(`[Event] 更新开机启动隐藏设置: ${startToTray}`)
  log.info(`[Event] 平台: ${process.platform}`)
}
