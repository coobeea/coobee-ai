/**
 * Media Permission Hook
 *
 * 在 READY 阶段设置媒体设备权限策略：
 * - 自动授予渲染进程的麦克风/摄像头访问请求（Electron 默认拒绝）
 * - macOS：主动请求系统级麦克风权限（首次使用时弹出系统授权弹窗）
 *
 * 如果不设置此 Hook，渲染进程中 navigator.mediaDevices.getUserMedia()
 * 将无法获取麦克风音频流。
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'
import { session, systemPreferences } from 'electron'

export const ReadyMediaPermissionHook: LifecycleHook = {
  name: 'ready-media-permission',
  phase: LifecyclePhase.READY,
  priority: 85, // 在 AppBootstrap (90) 之后、WindowBootstrap (100) 之前
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyMediaPermissionHook] 配置媒体设备权限...')

    try {
      // ---- 1. Electron session 权限策略 ----
      // 自动授予 media（麦克风/摄像头）权限请求
      session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        // 允许的权限类型
        const allowedPermissions = [
          'media', // 麦克风/摄像头
          'mediaKeySystem', // 加密媒体
          'geolocation', // 地理位置（预留）
          'notifications' // 通知（预留）
        ]

        if (allowedPermissions.includes(permission)) {
          log.debug(`[ReadyMediaPermissionHook] 授予权限: ${permission}`)
          callback(true)
        } else {
          log.warn(`[ReadyMediaPermissionHook] 拒绝权限: ${permission}`)
          callback(false)
        }
      })

      // 同步权限检查 — 允许所有权限（避免阻止设备枚举）
      // 使用 null 代替自定义 handler，确保不会误拦截设备枚举等隐式权限检查
      session.defaultSession.setPermissionCheckHandler(null)

      log.info('[ReadyMediaPermissionHook] Electron session 权限策略已设置')

      // ---- 2. macOS 系统级麦克风权限 ----
      if (process.platform === 'darwin') {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone')
        log.info(`[ReadyMediaPermissionHook] macOS 麦克风权限状态: ${micStatus}`)

        if (micStatus === 'not-determined') {
          // 首次使用，弹出系统授权弹窗
          const granted = await systemPreferences.askForMediaAccess('microphone')
          log.info(
            `[ReadyMediaPermissionHook] macOS 麦克风授权结果: ${granted ? '已授予' : '已拒绝'}`
          )
        } else if (micStatus === 'denied') {
          log.warn('[ReadyMediaPermissionHook] macOS 麦克风权限被拒绝，请在系统偏好设置中手动开启')
        }
        // 'granted' 或 'restricted' 不需要处理
      }

      log.info('[ReadyMediaPermissionHook] 媒体设备权限配置完成')
    } catch (error) {
      log.error('[ReadyMediaPermissionHook] 媒体权限配置失败:', error)
      // 不抛出错误，允许应用继续启动
    }
  }
}
