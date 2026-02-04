/**
 * 应用管理相关类型定义
 */

import type { LifecycleManager } from '../lifecycle'

// ==================== Electron App 事件定义 ====================

/**
 * Electron App 事件枚举
 *
 * 定义所有 Electron app 相关的事件名称，避免硬编码字符串
 */
export enum ElectronAppEvents {
  // 应用生命周期事件
  WILL_FINISH_LAUNCHING = 'will-finish-launching', // 应用完成基础启动时触发
  READY = 'ready', // 应用初始化完成时触发
  WINDOW_ALL_CLOSED = 'window-all-closed', // 所有窗口关闭时触发
  BEFORE_QUIT = 'before-quit', // 应用退出前触发
  WILL_QUIT = 'will-quit', // 应用即将退出时触发
  QUIT = 'quit', // 应用退出时触发

  // 窗口管理事件
  BROWSER_WINDOW_CREATED = 'browser-window-created', // 创建新窗口时触发
  BROWSER_WINDOW_FOCUS = 'browser-window-focus', // 窗口获得焦点时触发
  BROWSER_WINDOW_BLUR = 'browser-window-blur', // 窗口失去焦点时触发

  // macOS 特有事件
  ACTIVATE = 'activate', // 应用被激活时触发（macOS）
  CONTINUE_ACTIVITY = 'continue-activity', // Handoff 活动继续时触发（macOS）
  WILL_CONTINUE_ACTIVITY = 'will-continue-activity', // Handoff 活动即将继续时触发（macOS）
  CONTINUE_ACTIVITY_ERROR = 'continue-activity-error', // Handoff 活动出错时触发（macOS）
  ACTIVITY_WAS_CONTINUED = 'activity-was-continued', // Handoff 活动已继续时触发（macOS）
  UPDATE_ACTIVITY_STATE = 'update-activity-state', // Handoff 活动状态更新时触发（macOS）
  NEW_WINDOW_FOR_TAB = 'new-window-for-tab', // 新标签页窗口时触发（macOS）

  // 网络事件
  OPEN_FILE = 'open-file', // 打开文件时触发
  OPEN_URL = 'open-url', // 打开 URL 时触发

  // 会话事件
  SESSION_CREATED = 'session-created', // 会话创建时触发

  // 更新事件
  CHECK_FOR_UPDATE = 'check-for-update', // 检查更新时触发
  UPDATE_AVAILABLE = 'update-available', // 有可用更新时触发
  UPDATE_NOT_AVAILABLE = 'update-not-available', // 无可用更新时触发
  UPDATE_DOWNLOADED = 'update-downloaded', // 更新下载完成时触发

  // 证书错误
  CERTIFICATE_ERROR = 'certificate-error', // 证书错误时触发

  // 登录事件
  LOGIN = 'login', // 登录时触发

  // GPU 进程崩溃
  GPU_PROCESS_CRASHED = 'gpu-process-crashed', // GPU 进程崩溃时触发（已废弃）
  GPU_INFO_UPDATE = 'gpu-info-update', // GPU 信息更新时触发

  // 渲染进程事件
  RENDER_PROCESS_GONE = 'render-process-gone', // 渲染进程消失时触发
  CHILD_PROCESS_GONE = 'child-process-gone', // 子进程消失时触发

  // 辅助功能事件
  ACCESSIBILITY_SUPPORT_CHANGED = 'accessibility-support-changed', // 辅助功能支持改变时触发

  // 第二实例
  SECOND_INSTANCE = 'second-instance', // 第二个实例启动时触发（单实例应用）

  // Web 内容创建
  WEB_CONTENTS_CREATED = 'web-contents-created' // WebContents 创建时触发
}

// ==================== 应用管理器接口 ====================

/**
 * 应用管理器接口
 */
export interface IAppManager {
  /**
   * 初始化应用
   */
  initialize(): Promise<void>

  /**
   * 获取生命周期管理器
   */
  getLifecycleManager(): LifecycleManager
}
