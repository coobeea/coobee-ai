/**
 * 窗口管理器（统一管理窗口和 Tab）
 *
 * 职责：
 * - 创建和管理 BrowserWindow
 * - 创建和管理 WebContentsView（Tab）
 * - 窗口生命周期管理
 * - Tab 生命周期管理
 * - 窗口状态跟踪
 * - 窗口事件处理
 * - Tab 事件处理
 */

import type { BrowserWindow, BrowserWindowConstructorOptions, WebContentsView } from 'electron'
import type {
  WindowConfig,
  WindowInfo,
  WindowState,
  WindowBounds,
  WindowType,
  TabConfig,
  TabInfo,
  IWindowManager
} from './types'
import { WINDOW_PRESETS, CHROME_HEIGHT } from './types'

export class WindowManager implements IWindowManager {
  // ==================== 窗口管理状态 ====================

  /** 窗口信息存储: windowId -> WindowInfo */
  private windows: Map<number, WindowInfo> = new Map()

  /** 主窗口 ID */
  private mainWindowId: number | null = null

  /** 当前聚焦的窗口 ID */
  private focusedWindowId: number | null = null

  // ==================== Tab 管理状态 ====================

  /** WebContents ID → Tab ID 映射 (用于快速查找) */
  private webContentsToTabId: Map<number, number> = new Map()

  /** 每个窗口最大 Tab 数量限制 */
  private readonly MAX_TABS_PER_WINDOW = 20

  constructor() {
    // WindowManager 初始化
    // 事件处理由 EventBus 自动扫描注册，参见 src/main/common/eventbus.ts
  }

  // ==================== Tab 管理方法 ====================

  /**
   * 创建新 Tab
   * @param windowId 目标窗口 ID
   * @param config Tab 配置
   * @returns Tab ID，创建失败返回 null
   */
  async createTab(windowId: number, config: TabConfig): Promise<number | null> {
    // TODO: 实现 Tab 创建逻辑
    // 1. 检查窗口是否存在
    // 2. 检查 Tab 数量限制
    // 3. 创建 WebContentsView
    // 4. 注册 Tab 信息
    // 5. 添加到窗口
    // 6. 更新窗口 Tab 列表
    // 7. 设置 View 边界
    // 8. 绑定事件
    // 9. 加载内容
    // 10. 发送 Tab 创建事件
    // 11. 通知窗口更新
    throw new Error('Not implemented')
  }

  /**
   * 切换激活的 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功切换
   */
  async switchTab(windowId: number, tabId: number): Promise<boolean> {
    // TODO: 实现 Tab 切换逻辑
    // 1. 获取 Tab 信息
    // 2. 获取窗口实例
    // 3. 取消当前窗口所有 Tab 的激活状态
    // 4. 激活目标 Tab
    // 5. 将 View 移到最上层
    // 6. 更新边界
    // 7. 发送 Tab 切换事件
    // 8. 通知窗口更新
    throw new Error('Not implemented')
  }

  /**
   * 关闭 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功关闭
   */
  async closeTab(windowId: number, tabId: number): Promise<boolean> {
    // TODO: 实现 Tab 关闭逻辑
    // 1. 获取 Tab 信息
    // 2. 从窗口移除 View
    // 3. 销毁 webContents
    // 4. 清理映射
    // 5. 从窗口 Tab 列表移除
    // 6. 如果是激活的 Tab，切换到其他 Tab
    // 7. 发送 Tab 关闭事件
    // 8. 通知窗口更新
    throw new Error('Not implemented')
  }

  /**
   * 重新排序 Tab
   * @param windowId 窗口 ID
   * @param tabIds 新的 Tab ID 顺序
   * @returns 是否成功重新排序
   */
  async reorderTabs(windowId: number, tabIds: number[]): Promise<boolean> {
    // TODO: 实现 Tab 重新排序逻辑
    throw new Error('Not implemented')
  }

  /**
   * 将 Tab 移动到另一个窗口
   * @param tabId Tab ID
   * @param fromWindowId 源窗口 ID
   * @param toWindowId 目标窗口 ID
   * @returns 是否成功移动
   */
  async moveTabToWindow(tabId: number, fromWindowId: number, toWindowId: number): Promise<boolean> {
    // TODO: 实现 Tab 移动到另一个窗口的逻辑
    throw new Error('Not implemented')
  }

  /**
   * 复制 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 新 Tab 的 ID，失败返回 null
   */
  async duplicateTab(windowId: number, tabId: number): Promise<number | null> {
    // TODO: 实现 Tab 复制逻辑
    throw new Error('Not implemented')
  }

  /**
   * 刷新 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功刷新
   */
  reloadTab(windowId: number, tabId: number): boolean {
    // TODO: 实现 Tab 刷新逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取 Tab 信息
   * @param tabId Tab ID
   * @returns Tab 信息
   */
  getTabInfo(tabId: number): TabInfo | undefined {
    // 遍历所有窗口查找 Tab
    for (const windowInfo of this.windows.values()) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab) return tab
    }
    return undefined
  }

  /**
   * 获取窗口的所有 Tab
   * @param windowId 窗口 ID
   * @returns Tab 信息数组（按 position 排序）
   */
  getWindowTabs(windowId: number): TabInfo[] {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return []

    return Array.from(windowInfo.tabs.values()).sort((a, b) => a.position - b.position)
  }

  /**
   * 获取窗口的激活 Tab
   * @param windowId 窗口 ID
   * @returns 激活的 Tab 信息
   */
  getActiveTab(windowId: number): TabInfo | undefined {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return undefined

    return Array.from(windowInfo.tabs.values()).find((tab) => tab.isActive)
  }

  /**
   * 获取窗口的 Tab 数量
   * @param windowId 窗口 ID
   * @returns Tab 数量
   */
  getWindowTabCount(windowId: number): number {
    const windowInfo = this.windows.get(windowId)
    return windowInfo?.tabs.size || 0
  }

  /**
   * 根据 WebContents ID 获取 Tab ID
   * @param webContentsId WebContents ID
   * @returns Tab ID
   */
  getTabIdByWebContentsId(webContentsId: number): number | undefined {
    return this.webContentsToTabId.get(webContentsId)
  }

  // ==================== 窗口创建 ====================

  /**
   * 创建新窗口
   * @param config 窗口配置
   * @returns BrowserWindow 实例，创建失败返回 null
   *
   * @example
   * ```typescript
   * // 创建 Agent 窗口（使用预设配置）
   * const agentWindow = windowManager.createWindow({
   *   type: 'agent',
   *   initialUrl: '/shell'
   * })
   *
   * // 创建浏览器窗口并自定义大小
   * const browserWindow = windowManager.createWindow({
   *   type: 'browser',
   *   width: 1440,  // 覆盖预设的 1024
   *   height: 900,  // 覆盖预设的 768
   *   initialUrl: 'https://google.com'
   * })
   * ```
   */
  createWindow(config: WindowConfig): BrowserWindow | null {
    // TODO: 实现窗口创建逻辑
    // 1. 获取窗口预设配置
    //    const preset = this.getWindowPreset(config.type)
    // 2. 合并预设配置和用户配置（用户配置优先）
    //    const options = { ...preset, ...config }
    // 3. 创建 BrowserWindow 实例
    //    const window = new BrowserWindow(options)
    // 4. 注册窗口信息
    //    this.windows.set(window.id, window)
    //    this.windowInfo.set(window.id, {...})
    // 5. 设置主窗口（如果是第一个 agent 窗口）
    //    if (config.type === 'agent' && !this.mainWindowId) {
    //      this.mainWindowId = window.id
    //    }
    // 6. 绑定窗口事件
    //    this.setupWindowEvents(window.id)
    // 7. 加载窗口内容
    //    await this.loadWindowContent(window, config.initialUrl || '/')
    // 8. 发送窗口创建事件
    //    eventBus.emit('window:created', { windowId: window.id, type: config.type })
    throw new Error('Not implemented')
  }

  // ==================== 窗口查询 ====================

  /**
   * 根据 ID 获取窗口
   * @param windowId 窗口 ID
   * @returns BrowserWindow 实例
   */
  getWindow(windowId: number): BrowserWindow | undefined {
    // TODO: 实现获取窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取主窗口
   * @returns 主窗口实例
   */
  getMainWindow(): BrowserWindow | undefined {
    // TODO: 实现获取主窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取当前聚焦的窗口
   * @returns 聚焦窗口实例
   */
  getFocusedWindow(): BrowserWindow | undefined {
    // TODO: 实现获取聚焦窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取所有窗口
   * @returns 所有窗口实例数组
   */
  getAllWindows(): BrowserWindow[] {
    // TODO: 实现获取所有窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 根据类型获取窗口
   * @param type 窗口类型
   * @returns 该类型的所有窗口
   */
  getWindowsByType(type: WindowType): BrowserWindow[] {
    // TODO: 实现根据类型获取窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取窗口信息
   * @param windowId 窗口 ID
   * @returns 窗口信息
   */
  getWindowInfo(windowId: number): WindowInfo | undefined {
    // TODO: 实现获取窗口信息逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取窗口数量
   * @returns 窗口数量
   */
  getWindowCount(): number {
    // TODO: 实现获取窗口数量逻辑
    throw new Error('Not implemented')
  }

  // ==================== 窗口操作 ====================

  /**
   * 关闭窗口
   * @param windowId 窗口 ID
   * @returns 是否成功关闭
   */
  async closeWindow(windowId: number): Promise<boolean> {
    // TODO: 实现关闭窗口逻辑
    // 1. 检查窗口是否存在
    // 2. 如果是主窗口，可能需要特殊处理
    // 3. 关闭窗口
    // 4. 清理窗口信息
    // 5. 发送窗口关闭事件
    throw new Error('Not implemented')
  }

  /**
   * 聚焦窗口
   * @param windowId 窗口 ID
   * @returns 是否成功聚焦
   */
  focusWindow(windowId: number): boolean {
    // TODO: 实现聚焦窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 最小化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最小化
   */
  minimizeWindow(windowId: number): boolean {
    // TODO: 实现最小化窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最大化
   */
  maximizeWindow(windowId: number): boolean {
    // TODO: 实现最大化窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 取消最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功取消最大化
   */
  unmaximizeWindow(windowId: number): boolean {
    // TODO: 实现取消最大化窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 全屏窗口
   * @param windowId 窗口 ID
   * @param fullscreen 是否全屏
   * @returns 是否成功设置全屏
   */
  setFullScreen(windowId: number, fullscreen: boolean): boolean {
    // TODO: 实现全屏窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 显示窗口
   * @param windowId 窗口 ID
   * @returns 是否成功显示
   */
  showWindow(windowId: number): boolean {
    // TODO: 实现显示窗口逻辑
    throw new Error('Not implemented')
  }

  /**
   * 隐藏窗口
   * @param windowId 窗口 ID
   * @returns 是否成功隐藏
   */
  hideWindow(windowId: number): boolean {
    // TODO: 实现隐藏窗口逻辑
    throw new Error('Not implemented')
  }

  // ==================== 窗口状态 ====================

  /**
   * 获取窗口状态
   * @param windowId 窗口 ID
   * @returns 窗口状态
   */
  getWindowState(windowId: number): WindowState | null {
    // TODO: 实现获取窗口状态逻辑
    throw new Error('Not implemented')
  }

  /**
   * 获取窗口边界
   * @param windowId 窗口 ID
   * @returns 窗口边界
   */
  getWindowBounds(windowId: number): WindowBounds | null {
    // TODO: 实现获取窗口边界逻辑
    throw new Error('Not implemented')
  }

  /**
   * 设置窗口边界
   * @param windowId 窗口 ID
   * @param bounds 窗口边界
   * @returns 是否成功设置
   */
  setWindowBounds(windowId: number, bounds: Partial<WindowBounds>): boolean {
    // TODO: 实现设置窗口边界逻辑
    throw new Error('Not implemented')
  }

  // ==================== 窗口通信 ====================

  /**
   * 向指定窗口发送消息
   * @param windowId 窗口 ID
   * @param channel 通道名称
   * @param args 参数
   */
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void {
    // TODO: 实现向窗口发送消息逻辑
    throw new Error('Not implemented')
  }

  /**
   * 向所有窗口广播消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToAllWindows(channel: string, ...args: unknown[]): void {
    // TODO: 实现向所有窗口广播消息逻辑
    throw new Error('Not implemented')
  }

  /**
   * 向聚焦窗口发送消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToFocused(channel: string, ...args: unknown[]): void {
    // TODO: 实现向聚焦窗口发送消息逻辑
    throw new Error('Not implemented')
  }

  // ==================== 内部方法 ====================

  /**
   * 获取窗口预设配置
   * @param type 窗口类型
   * @returns 预设配置
   */
  private getWindowPreset(type: WindowType): Partial<BrowserWindowConstructorOptions> {
    return WINDOW_PRESETS[type]
  }

  /**
   * 设置窗口事件监听器
   * @param windowId 窗口 ID
   */
  private setupWindowEvents(windowId: number): void {
    // TODO: 实现设置窗口事件监听器逻辑
    // 监听的事件：
    // - ready-to-show: 窗口准备显示
    // - closed: 窗口关闭
    // - focus: 窗口获得焦点
    // - blur: 窗口失去焦点
    // - minimize: 窗口最小化
    // - maximize: 窗口最大化
    // - unmaximize: 窗口取消最大化
    // - enter-full-screen: 进入全屏
    // - leave-full-screen: 离开全屏
    // - resize: 窗口大小变化
    // - move: 窗口位置变化
    throw new Error('Not implemented')
  }

  /**
   * 加载窗口内容
   * @param window BrowserWindow 实例
   * @param url 要加载的 URL
   */
  private async loadWindowContent(window: BrowserWindow, url: string): Promise<void> {
    // TODO: 实现加载窗口内容逻辑
    // 1. 判断是开发环境还是生产环境
    // 2. 加载对应的 URL 或文件
    throw new Error('Not implemented')
  }

  /**
   * 清理窗口资源
   * @param windowId 窗口 ID
   */
  private cleanupWindow(windowId: number): void {
    // TODO: 实现清理窗口资源逻辑
    // 1. 从 Map 中移除窗口
    // 2. 更新主窗口 ID（如果需要）
    // 3. 更新聚焦窗口 ID（如果需要）
    throw new Error('Not implemented')
  }

  // ==================== Tab 内部方法 ====================

  /**
   * 更新 View 边界（考虑 Chrome 高度）
   * @param window BrowserWindow 实例
   * @param view WebContentsView 实例
   */
  private updateViewBounds(window: BrowserWindow, view: WebContentsView): void {
    // TODO: 实现更新 View 边界逻辑
    // 1. 获取窗口边界
    // 2. 获取 Chrome 高度 (使用 CHROME_HEIGHT 常量)
    // 3. 计算 View 边界
    // 4. 设置 View 边界
    throw new Error('Not implemented')
  }

  /**
   * 加载 Tab 内容
   * @param view WebContentsView 实例
   * @param url URL
   */
  private async loadTabContent(view: WebContentsView, url: string): Promise<void> {
    // TODO: 实现加载 Tab 内容逻辑
    // 1. 判断是本地路由还是外部 URL
    // 2. 加载对应的内容
    throw new Error('Not implemented')
  }

  /**
   * 设置 Tab 事件
   * @param tabId Tab ID
   */
  private setupTabEvents(tabId: number): void {
    // TODO: 实现设置 Tab 事件逻辑
    // 监听的事件：
    // - page-title-updated: 页面标题更新
    // - did-navigate: 页面导航
    // - did-start-loading: 开始加载
    // - did-stop-loading: 停止加载
    // - render-process-gone: 进程崩溃
    throw new Error('Not implemented')
  }

  /**
   * 通知窗口 Tab 列表更新
   * @param windowId 窗口 ID
   */
  private notifyWindowTabsUpdate(windowId: number): void {
    // TODO: 实现通知窗口 Tab 列表更新逻辑
    // 1. 获取窗口实例
    // 2. 获取窗口的所有 Tab
    // 3. 转换为 TabData 格式
    // 4. 发送到窗口的 webContents
    throw new Error('Not implemented')
  }

  /**
   * 清理 Tab 资源
   * @param tabId Tab ID
   */
  private cleanupTab(tabId: number): void {
    // TODO: 实现清理 Tab 资源逻辑
    // 1. 从 Map 中移除 Tab
    // 2. 清理映射关系
    throw new Error('Not implemented')
  }

  /**
   * 验证 Tab 是否属于窗口
   * @param tabId Tab ID
   * @param windowId 窗口 ID
   * @returns 是否属于该窗口
   */
  private isTabInWindow(tabId: number, windowId: number): boolean {
    // TODO: 实现验证 Tab 是否属于窗口逻辑
    throw new Error('Not implemented')
  }
}
