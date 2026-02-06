/**
 * 本地快捷键管理器
 *
 * 通过监听 before-input-event 实现应用内快捷键
 * 支持在特定窗口或所有窗口注册快捷键
 */

import { app, BrowserWindow, type WebContents } from 'electron'
import { log } from '@main/common/logger'

// ==================== 类型定义 ====================

/**
 * before-input-event 的输入事件类型
 */
interface BeforeInputEvent {
  type: string
  key?: string
  code?: string
  alt?: boolean
  altKey?: boolean
  shift?: boolean
  shiftKey?: boolean
  meta?: boolean
  metaKey?: boolean
  control?: boolean
  ctrlKey?: boolean
}

/**
 * 标准化的键盘事件接口
 */
interface NormalizedKeyEvent {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * 本地快捷键配置
 */
interface LocalShortcut {
  eventStamp: NormalizedKeyEvent
  callback: () => void
  enabled: boolean
}

/**
 * 扩展快捷键数组类型，添加清理函数
 */
interface ShortcutArray extends Array<LocalShortcut> {
  removeListener?: () => void
}

// ==================== 常量 ====================

/** 用于在任何窗口注册快捷键的占位符 */
const ANY_WINDOW = Symbol('ANY_WINDOW')

/** 存储窗口快捷键的 WeakMap */
const windowsWithShortcuts = new WeakMap<WebContents | typeof ANY_WINDOW, ShortcutArray>()

// ==================== 工具函数 ====================

/**
 * 获取窗口标题（用于调试）
 */
function getWindowTitle(win?: BrowserWindow): string {
  if (win) {
    try {
      return win.getTitle()
    } catch {
      return 'A destroyed window'
    }
  }
  return 'An falsy value'
}

/**
 * 检查加速器是否有效
 */
function checkAccelerator(accelerator: string): boolean {
  if (!accelerator || typeof accelerator !== 'string') {
    log.warn(`[LocalShortcut] 无效的快捷键类型: ${typeof accelerator}`)
    return false
  }

  // 修饰键模式
  const modifierPattern =
    '(CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)'
  // 命名键模式
  const namedKeyPattern =
    '(Space|Tab|Enter|Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Escape|Plus|Minus|Equal|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight)'
  // 功能键模式
  const functionKeyPattern = 'F([1-9]|1[0-2]|2[0-4])'
  // 任意单个字符作为按键
  const characterKeyPattern = '.'

  // 完整的加速器模式
  const fullPattern = new RegExp(
    `^(${modifierPattern}\\+)*(${namedKeyPattern}|${functionKeyPattern}|${characterKeyPattern})$`
  )

  // 单独的功能键也是有效的
  const singleFunctionKey = new RegExp(`^${functionKeyPattern}$`)

  const isValid = fullPattern.test(accelerator) || singleFunctionKey.test(accelerator)

  if (!isValid) {
    log.warn(`[LocalShortcut] 无效的快捷键格式: ${accelerator}`)
  }

  return isValid
}

/**
 * 将加速器字符串转换为键盘事件对象
 */
function acceleratorToKeyEvent(accelerator: string): NormalizedKeyEvent {
  const literalToName: Record<string, string> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    '[': 'BracketLeft',
    ']': 'BracketRight'
  }

  const parts = accelerator.split('+')
  const event: NormalizedKeyEvent = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: '',
    code: ''
  }

  // 特殊键映射
  const specialKeys: Record<string, { key: string; code: string }> = {
    Space: { key: ' ', code: 'Space' },
    Tab: { key: 'Tab', code: 'Tab' },
    Enter: { key: 'Enter', code: 'Enter' },
    Return: { key: 'Enter', code: 'Enter' },
    Backspace: { key: 'Backspace', code: 'Backspace' },
    Delete: { key: 'Delete', code: 'Delete' },
    Insert: { key: 'Insert', code: 'Insert' },
    Home: { key: 'Home', code: 'Home' },
    End: { key: 'End', code: 'End' },
    PageUp: { key: 'PageUp', code: 'PageUp' },
    PageDown: { key: 'PageDown', code: 'PageDown' },
    Up: { key: 'ArrowUp', code: 'ArrowUp' },
    Down: { key: 'ArrowDown', code: 'ArrowDown' },
    Left: { key: 'ArrowLeft', code: 'ArrowLeft' },
    Right: { key: 'ArrowRight', code: 'ArrowRight' },
    Escape: { key: 'Escape', code: 'Escape' },
    Plus: { key: '+', code: 'Equal' },
    Minus: { key: '-', code: 'Minus' },
    Equal: { key: '=', code: 'Equal' },
    Comma: { key: ',', code: 'Comma' },
    Period: { key: '.', code: 'Period' },
    Slash: { key: '/', code: 'Slash' },
    Backslash: { key: '\\', code: 'Backslash' },
    Semicolon: { key: ';', code: 'Semicolon' },
    Quote: { key: "'", code: 'Quote' },
    Backquote: { key: '`', code: 'Backquote' },
    BracketLeft: { key: '[', code: 'BracketLeft' },
    BracketRight: { key: ']', code: 'BracketRight' }
  }

  parts.forEach((part) => {
    const lowerPart = part.toLowerCase()
    switch (lowerPart) {
      case 'commandorcontrol':
      case 'cmdorctrl':
        if (process.platform === 'darwin') {
          event.metaKey = true
        } else {
          event.ctrlKey = true
        }
        break
      case 'command':
      case 'cmd':
        event.metaKey = true
        break
      case 'control':
      case 'ctrl':
        event.ctrlKey = true
        break
      case 'alt':
      case 'option':
        event.altKey = true
        break
      case 'shift':
        event.shiftKey = true
        break
      default: {
        // 优先使用字面量到名称的映射
        const keyName = literalToName[part] || part

        // 处理特殊键
        if (specialKeys[keyName]) {
          event.key = specialKeys[keyName].key
          event.code = specialKeys[keyName].code
        }
        // 处理功能键
        else if (/^F([1-9]|1[0-2]|2[0-4])$/.test(keyName)) {
          event.key = keyName
          event.code = keyName
        }
        // 处理普通字母数字键
        else if (/^[A-Za-z0-9]$/.test(keyName)) {
          event.key = keyName.toLowerCase()
          if (/^[A-Za-z]$/.test(keyName)) {
            event.code = `Key${keyName.toUpperCase()}`
          } else {
            event.code = `Digit${keyName}`
          }
        } else {
          log.warn(`[LocalShortcut] 未知的按键: ${keyName}`)
          event.key = keyName
          event.code = keyName
        }
        break
      }
    }
  })

  return event
}

/**
 * 标准化输入事件
 */
function normalizeEvent(input: BeforeInputEvent): NormalizedKeyEvent {
  if (!input) {
    log.warn('[LocalShortcut] 无效的输入事件: null or undefined')
    return {
      code: '',
      key: '',
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false
    }
  }

  const normalizedEvent: NormalizedKeyEvent = {
    code: input.code || '',
    key: input.key || '',
    altKey: Boolean(input.alt || input.altKey),
    shiftKey: Boolean(input.shift || input.shiftKey),
    metaKey: Boolean(input.meta || input.metaKey),
    ctrlKey: Boolean(input.control || input.ctrlKey)
  }

  return normalizedEvent
}

/**
 * 比较两个键盘事件是否相等
 */
function eventsAreEqual(event1: NormalizedKeyEvent, event2: NormalizedKeyEvent): boolean {
  if (!event1 || !event2) {
    return false
  }

  return (
    event1.key === event2.key &&
    event1.code === event2.code &&
    event1.altKey === event2.altKey &&
    event1.ctrlKey === event2.ctrlKey &&
    event1.metaKey === event2.metaKey &&
    event1.shiftKey === event2.shiftKey
  )
}

/**
 * 查找匹配的快捷键
 */
function findShortcut(event: NormalizedKeyEvent, shortcuts: LocalShortcut[]): number {
  if (!event || !shortcuts) {
    return -1
  }

  for (let i = 0; i < shortcuts.length; i++) {
    if (eventsAreEqual(shortcuts[i].eventStamp, event)) {
      return i
    }
  }
  return -1
}

/**
 * 创建输入事件处理器
 */
function createInputHandler(shortcuts: LocalShortcut[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (_: any, input: BeforeInputEvent): void => {
    try {
      if (!input || input.type === 'keyUp') {
        return
      }

      const event = normalizeEvent(input)

      for (const shortcut of shortcuts) {
        if (shortcut && shortcut.enabled && eventsAreEqual(shortcut.eventStamp, event)) {
          try {
            shortcut.callback()
          } catch (error) {
            log.error('[LocalShortcut] 快捷键回调执行失败:', error)
          }
          return
        }
      }
    } catch (error) {
      log.error('[LocalShortcut] 输入处理失败:', error)
    }
  }
}

// ==================== 导出 API ====================

/**
 * 禁用窗口上的所有快捷键
 */
export function disableAll(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) {
    log.debug('[LocalShortcut] 无法禁用已销毁窗口的快捷键')
    return
  }

  log.debug(`[LocalShortcut] 禁用窗口快捷键: ${getWindowTitle(win)}`)
  const wc = win.webContents
  const shortcuts = windowsWithShortcuts.get(wc)

  if (shortcuts) {
    for (const shortcut of shortcuts) {
      shortcut.enabled = false
    }
  }
}

/**
 * 启用窗口上的所有快捷键
 */
export function enableAll(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) {
    log.debug('[LocalShortcut] 无法启用已销毁窗口的快捷键')
    return
  }

  log.debug(`[LocalShortcut] 启用窗口快捷键: ${getWindowTitle(win)}`)
  const wc = win.webContents
  const shortcuts = windowsWithShortcuts.get(wc)

  if (shortcuts) {
    for (const shortcut of shortcuts) {
      shortcut.enabled = true
    }
  }
}

/**
 * 注销窗口上的所有快捷键
 */
export function unregisterAll(win?: BrowserWindow): void {
  // 如果没有传入窗口参数，注销 ANY_WINDOW 上的所有快捷键
  if (!win) {
    log.debug('[LocalShortcut] 注销所有窗口的快捷键')
    const shortcuts = windowsWithShortcuts.get(ANY_WINDOW)

    if (shortcuts && shortcuts.removeListener) {
      shortcuts.removeListener()
      windowsWithShortcuts.delete(ANY_WINDOW)
    }
    return
  }

  // 如果传入了窗口参数，注销该窗口上的所有快捷键
  if (win.isDestroyed()) {
    log.debug('[LocalShortcut] 无法注销已销毁窗口的快捷键')
    return
  }

  log.debug(`[LocalShortcut] 注销窗口快捷键: ${getWindowTitle(win)}`)
  const wc = win.webContents
  const shortcuts = windowsWithShortcuts.get(wc)

  if (shortcuts && shortcuts.removeListener) {
    shortcuts.removeListener()
    windowsWithShortcuts.delete(wc)
  }
}

/**
 * 注册本地快捷键
 *
 * 支持两种调用方式：
 * 1. register(accelerator, callback) - 在所有窗口注册
 * 2. register(win, accelerator, callback) - 在特定窗口注册
 */
export function register(win: BrowserWindow, accelerator: string, callback: () => void): void
export function register(accelerator: string, callback: () => void): void
export function register(
  winOrAccelerator: BrowserWindow | string,
  acceleratorOrCallback: string | (() => void),
  callback?: () => void
): void {
  let wc: WebContents | typeof ANY_WINDOW
  let accelerator: string
  let finalCallback: () => void

  if (typeof acceleratorOrCallback === 'function') {
    // register(accelerator, callback) - 全局注册
    wc = ANY_WINDOW
    accelerator = winOrAccelerator as string
    finalCallback = acceleratorOrCallback
  } else {
    // register(win, accelerator, callback) - 窗口注册
    const win = winOrAccelerator as BrowserWindow
    if (!win || win.isDestroyed()) {
      log.warn('[LocalShortcut] 无法在已销毁的窗口注册快捷键')
      return
    }
    wc = win.webContents
    accelerator = acceleratorOrCallback as string
    finalCallback = callback!
  }

  if (!accelerator || typeof accelerator !== 'string') {
    log.warn('[LocalShortcut] 无效的快捷键')
    return
  }

  log.debug(
    `[LocalShortcut] 注册快捷键 ${accelerator} (窗口: ${getWindowTitle(winOrAccelerator as BrowserWindow)})`
  )

  if (!checkAccelerator(accelerator)) {
    return
  }

  let shortcuts: ShortcutArray
  if (windowsWithShortcuts.has(wc)) {
    shortcuts = windowsWithShortcuts.get(wc)!
  } else {
    shortcuts = [] as ShortcutArray
    windowsWithShortcuts.set(wc, shortcuts)

    if (wc === ANY_WINDOW) {
      const keyHandler = createInputHandler(shortcuts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enableAppShortcuts = (_: any, win: BrowserWindow): void => {
        if (!win || win.isDestroyed()) {
          return
        }
        const wc = win.webContents
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wc.on('before-input-event', keyHandler as any)
        wc.once('destroyed', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wc.removeListener('before-input-event', keyHandler as any)
        })
      }

      // 在当前窗口启用快捷键
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((win) => enableAppShortcuts(null, win))

      // 在未来窗口启用快捷键
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.on('browser-window-created', enableAppShortcuts as any)

      shortcuts.removeListener = () => {
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            win.webContents.removeListener('before-input-event', keyHandler as any)
          }
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.removeListener('browser-window-created', enableAppShortcuts as any)
      }
    } else {
      const keyHandler = createInputHandler(shortcuts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wc.on('before-input-event', keyHandler as any)

      shortcuts.removeListener = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wc.removeListener('before-input-event', keyHandler as any)
      }
      wc.once('destroyed', shortcuts.removeListener)
    }
  }

  const eventStamp = acceleratorToKeyEvent(accelerator)
  shortcuts.push({
    eventStamp,
    callback: finalCallback,
    enabled: true
  })

  log.debug('[LocalShortcut] 快捷键注册成功')
}

/**
 * 注销本地快捷键
 */
export function unregister(win: BrowserWindow, accelerator: string): void
export function unregister(accelerator: string): void
export function unregister(winOrAccelerator: BrowserWindow | string, accelerator?: string): void {
  let wc: WebContents | typeof ANY_WINDOW
  let finalAccelerator: string

  if (typeof accelerator === 'undefined') {
    wc = ANY_WINDOW
    finalAccelerator = winOrAccelerator as string
  } else {
    const win = winOrAccelerator as BrowserWindow
    if (!win || win.isDestroyed()) {
      log.debug('[LocalShortcut] 窗口已销毁，跳过注销')
      return
    }
    wc = win.webContents
    finalAccelerator = accelerator
  }

  if (!finalAccelerator || typeof finalAccelerator !== 'string') {
    log.warn('[LocalShortcut] 无效的快捷键')
    return
  }

  log.debug(`[LocalShortcut] 注销快捷键: ${finalAccelerator}`)

  if (!checkAccelerator(finalAccelerator)) {
    return
  }

  if (!windowsWithShortcuts.has(wc)) {
    log.debug('[LocalShortcut] 窗口没有注册快捷键')
    return
  }

  const shortcuts = windowsWithShortcuts.get(wc)!
  const eventStamp = acceleratorToKeyEvent(finalAccelerator)
  const shortcutIdx = findShortcut(eventStamp, shortcuts)

  if (shortcutIdx === -1) {
    return
  }

  shortcuts.splice(shortcutIdx, 1)

  // 如果窗口没有更多快捷键，清理资源
  if (shortcuts.length === 0 && shortcuts.removeListener) {
    shortcuts.removeListener()
    windowsWithShortcuts.delete(wc)
  }
}

/**
 * 检查快捷键是否已注册
 */
export function isRegistered(win: BrowserWindow, accelerator: string): boolean
export function isRegistered(accelerator: string): boolean
export function isRegistered(
  winOrAccelerator: BrowserWindow | string,
  accelerator?: string
): boolean {
  let wc: WebContents | typeof ANY_WINDOW
  let finalAccelerator: string

  if (typeof accelerator === 'undefined') {
    wc = ANY_WINDOW
    finalAccelerator = winOrAccelerator as string
  } else {
    const win = winOrAccelerator as BrowserWindow
    if (!win || win.isDestroyed()) {
      log.debug('[LocalShortcut] 窗口已销毁，返回 false')
      return false
    }
    wc = win.webContents
    finalAccelerator = accelerator
  }

  if (!finalAccelerator || typeof finalAccelerator !== 'string') {
    log.warn('[LocalShortcut] 无效的快捷键')
    return false
  }

  if (!checkAccelerator(finalAccelerator)) {
    return false
  }

  const shortcuts = windowsWithShortcuts.get(wc)
  if (!shortcuts) {
    return false
  }

  const eventStamp = acceleratorToKeyEvent(finalAccelerator)
  return findShortcut(eventStamp, shortcuts) !== -1
}

/**
 * 本地快捷键管理器（默认导出）
 */
export default {
  register,
  unregister,
  isRegistered,
  unregisterAll,
  enableAll,
  disableAll
}
