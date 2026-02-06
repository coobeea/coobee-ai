/**
 * 快捷键管理器
 *
 * 管理应用的全局和本地快捷键
 * - 全局快捷键：即使应用不在焦点也能触发（如 ShowHideWindow）
 * - 本地快捷键：应用内快捷键（如 Quit、GoSettings）
 */

import { globalShortcut } from 'electron'
import { log } from '@main/common/logger'
import { eventBus } from '@main/common/eventbus'
import { ShortcutEvents } from '@shared/events'
import type { Shortcut } from '@shared/types'
import LocalShortcut from './LocalShortcut'

// ==================== 常量定义 ====================

/** 命令键（macOS: Command, Windows/Linux: Control） */
export const CommandKey = 'CommandOrControl'
/** Shift 修饰键 */
export const ShiftKey = 'Shift'

// ==================== 默认快捷键配置 ====================

/**
 * 默认快捷键配置
 *
 * 不包含导航快捷键（Left/Right），只保留核心功能
 */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    key: 'ShowHideWindow',
    shortcut: `${CommandKey}+Tab`,
    editable: true,
    enabled: true,
    global: true, // 全局快捷键
    registered: false
  },
  {
    key: 'Quit',
    shortcut: `${CommandKey}+Q`,
    editable: true,
    enabled: true,
    global: false, // 本地快捷键
    registered: false
  },
  {
    key: 'GoSettings',
    shortcut: `${CommandKey}+,`,
    editable: true,
    enabled: true,
    global: false,
    registered: false
  },
  {
    key: 'NewWindow',
    shortcut: `${CommandKey}+N`,
    editable: true,
    enabled: true,
    global: true, // 全局快捷键
    registered: false
  },
  {
    key: 'NewTab',
    shortcut: `${CommandKey}+T`,
    editable: true,
    enabled: true,
    global: false, // 本地快捷键（需要焦点窗口）
    registered: false
  },
  {
    key: 'Refresh',
    shortcut: `${CommandKey}+R`,
    editable: true,
    enabled: true,
    global: false,
    registered: false
  },
  {
    key: 'RefreshTab',
    shortcut: `F5`,
    editable: true,
    enabled: true,
    global: false,
    registered: false
  }
]

// ==================== 快捷键管理器 ====================

/**
 * 快捷键管理器类
 */
export class ShortcutManager {
  private shortcuts: Shortcut[] = DEFAULT_SHORTCUTS

  /**
   * 创建新窗口
   */
  private handleNewWindow(): void {
    log.info('[ShortcutManager] 快捷键触发: NewWindow')
    eventBus.emit('newWindow:changed')
  }

  /**
   * 创建新标签页
   */
  private handleNewTab(): void {
    log.info('[ShortcutManager] 快捷键触发: NewTab')
    eventBus.emit('newTab:changed')
  }

  /**
   * 刷新当前页面 (Command+R)
   */
  private handleRefresh(): void {
    log.info('[ShortcutManager] 快捷键触发: Refresh')
    eventBus.emit('refresh:changed')
  }

  /**
   * 刷新当前标签页 (F5)
   */
  private handleRefreshTab(): void {
    log.info('[ShortcutManager] 快捷键触发: RefreshTab')
    eventBus.emit('refreshTab:changed')
  }

  /**
   * 退出应用
   */
  private handleQuit(): void {
    log.info('[ShortcutManager] 快捷键触发: Quit')
    eventBus.emit(ShortcutEvents.QUIT)
  }

  /**
   * 跳转到设置页面
   */
  private handleGoSettings(): void {
    log.info('[ShortcutManager] 快捷键触发: GoSettings')
    eventBus.emit(ShortcutEvents.GO_SETTINGS)
  }

  /**
   * 显示/隐藏窗口
   */
  private handleShowHideWindow(): void {
    log.info('[ShortcutManager] 快捷键触发: ShowHideWindow')
    eventBus.emit(ShortcutEvents.SHOW_HIDE_WINDOW)
  }

  /**
   * 获取当前快捷键配置
   */
  getShortcuts(): Shortcut[] {
    return this.shortcuts
  }

  /**
   * 刷新快捷键
   * 从配置中读取快捷键设置并重新注册
   */
  async refreshShortcuts(): Promise<void> {
    try {
      // 动态导入避免循环依赖
      const { config } = await import('@main/common/config')
      const configShortcuts: Shortcut[] = config.getShortcuts()

      if (configShortcuts && configShortcuts.length > 0) {
        // 合并配置中的快捷键和默认快捷键
        // 只有 editable 为 true 的快捷键才会被配置中的值覆盖
        this.shortcuts = DEFAULT_SHORTCUTS.map((defaultShortcut) => {
          const configShortcut = configShortcuts.find((cs) => cs.key === defaultShortcut.key)

          if (configShortcut && defaultShortcut.editable) {
            // 如果配置中有该快捷键且默认快捷键是可编辑的，则使用配置中的值
            return {
              ...defaultShortcut,
              shortcut: configShortcut.shortcut,
              enabled: configShortcut.enabled
            }
          }

          // 否则使用默认快捷键
          return defaultShortcut
        })
      }

      this.unregisterShortcuts()
      this.registerShortcuts()
    } catch (error) {
      log.error('[ShortcutManager] 刷新快捷键失败:', error)
    }
  }

  /**
   * 注册所有应用快捷键
   */
  registerShortcuts(): void {
    log.info('[ShortcutManager] 开始注册应用快捷键...')

    // 遍历所有快捷键并注册
    this.shortcuts.forEach((shortcut) => {
      if (!shortcut.enabled || !shortcut.shortcut) {
        log.info(`[ShortcutManager] 跳过快捷键注册: ${shortcut.key} (未启用或无快捷键)`)
        return
      }

      let handler: () => void

      // 根据快捷键类型选择对应的处理函数
      switch (shortcut.key) {
        case 'NewWindow':
          handler = () => this.handleNewWindow()
          break
        case 'NewTab':
          handler = () => this.handleNewTab()
          break
        case 'Refresh':
          handler = () => this.handleRefresh()
          break
        case 'RefreshTab':
          handler = () => this.handleRefreshTab()
          break
        case 'Quit':
          handler = () => this.handleQuit()
          break
        case 'GoSettings':
          handler = () => this.handleGoSettings()
          break
        case 'ShowHideWindow':
          handler = () => this.handleShowHideWindow()
          break
        default:
          log.warn(`[ShortcutManager] 未知的快捷键类型: ${shortcut.key}`)
          return
      }

      // 根据快捷键类型决定注册方式
      if (shortcut.global) {
        // 显示/隐藏窗口使用全局快捷键
        const success = globalShortcut.register(shortcut.shortcut, handler)
        shortcut.registered = success
        if (success) {
          log.info(`[ShortcutManager] 全局快捷键注册成功: ${shortcut.key} -> ${shortcut.shortcut}`)
        } else {
          log.warn(`[ShortcutManager] 全局快捷键注册失败: ${shortcut.key} -> ${shortcut.shortcut}`)
        }
      } else {
        // 其他快捷键使用本地快捷键（应用内）
        try {
          LocalShortcut.register(shortcut.shortcut, handler)
          shortcut.registered = true
          log.info(`[ShortcutManager] 本地快捷键注册成功: ${shortcut.key} -> ${shortcut.shortcut}`)
        } catch (error) {
          log.warn(
            `[ShortcutManager] 本地快捷键注册失败: ${shortcut.key} -> ${shortcut.shortcut}`,
            error
          )
        }
      }
    })

    log.info(
      `[ShortcutManager] 快捷键注册完成，共注册 ${this.shortcuts.filter((s) => s.registered).length} 个快捷键`
    )
  }

  /**
   * 注销所有快捷键
   */
  unregisterShortcuts(): void {
    log.info('[ShortcutManager] 注销所有快捷键')

    // 注销全局快捷键
    globalShortcut.unregisterAll()

    // 注销本地快捷键
    LocalShortcut.unregisterAll()

    // 重置注册状态
    this.shortcuts.forEach((shortcut) => {
      shortcut.registered = false
    })
  }

  /**
   * 销毁快捷键管理器
   */
  destroy(): void {
    this.unregisterShortcuts()
    log.info('[ShortcutManager] 快捷键管理器已销毁')
  }
}

// ==================== 单例导出 ====================

export const shortcutManager = new ShortcutManager()
export default shortcutManager
