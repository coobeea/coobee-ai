/**
 * 快捷键注册 Hook
 *
 * 在应用 ready 阶段注册所有快捷键
 *
 * 执行时机：READY (应用启动完成后)
 * 执行优先级：400 (在窗口和其他核心服务初始化后)
 */

import { log } from '@main/common/logger'
import { LifecyclePhase, type LifecycleHook } from '@main/common/types'

export const ReadyShortcutRegistrationHook: LifecycleHook = {
  name: 'ReadyShortcutRegistrationHook',
  phase: LifecyclePhase.READY,
  priority: 400,
  critical: false,

  async execute(): Promise<void> {
    log.info('[ReadyShortcutRegistrationHook] 开始注册快捷键...')

    try {
      // 动态导入避免循环依赖
      const { shortcutManager, DEFAULT_SHORTCUTS } = await import('@main/common/shortcut')
      const { config } = await import('@main/common/config')

      // 如果配置中没有快捷键，使用默认值
      const configShortcuts = config.getShortcuts()
      if (!configShortcuts || configShortcuts.length === 0) {
        log.debug('[ReadyShortcutRegistrationHook] 首次运行，初始化默认快捷键配置')
        config.setShortcuts(DEFAULT_SHORTCUTS)
      }

      // 注册快捷键
      shortcutManager.registerShortcuts()

      log.info('[ReadyShortcutRegistrationHook] 快捷键注册完成')
    } catch (error) {
      log.error('[ReadyShortcutRegistrationHook] 快捷键注册失败:', error)
      throw error
    }
  }
}
