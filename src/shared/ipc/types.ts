/**
 * IPC 相关类型定义（前后端共用）
 *
 * 统一管理所有 IPC 通信的请求和响应类型
 */

// ==================== 通用类型 ====================

/**
 * IPC 统一响应格式
 */
export interface IpcResult<T = unknown> {
  /** 是否成功 */
  success: boolean
  /** 数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /** 错误代码 */
  code?: string
}

/**
 * 窗口类型
 */
export type WindowType = 'agent' | 'browser'

/**
 * Tab 类型
 */
export type TabType = 'chat' | 'task' | 'settings' | 'webpage'

// ==================== Shell 相关类型（主进程 -> 渲染进程） ====================

/**
 * 窗口信息响应（shell:get-window-info 返回）
 */
export interface WindowInfoResponse {
  /** 窗口 ID */
  windowId: number
  /** 窗口类型 */
  windowType: WindowType
  /** Tab 列表 */
  tabs: TabInfoResponse[]
  /** 当前激活的 Tab ID */
  currentTabId: number | null
}

/**
 * Tab 信息响应
 */
export interface TabInfoResponse {
  /** Tab ID */
  id: number
  /** Tab 标题 */
  title: string
  /** Tab URL */
  url: string
  /** 是否激活 */
  isActive: boolean
  /** 是否可关闭 */
  closable: boolean
  /** 位置索引 */
  position: number
  /** Tab 类型（可选） */
  type?: TabType
}

// ==================== Window 控制相关类型（渲染进程 -> 主进程） ====================

/**
 * 窗口控制请求参数
 */
export interface WindowControlRequest {
  /** 窗口 ID（可选，不传则使用当前窗口） */
  windowId?: number
}

/**
 * 窗口最小化请求
 */
export type MinimizeWindowRequest = WindowControlRequest

/**
 * 窗口最大化请求
 */
export type MaximizeWindowRequest = WindowControlRequest

/**
 * 窗口关闭请求
 */
export type CloseWindowRequest = WindowControlRequest

// ==================== Tab 操作相关类型（渲染进程 -> 主进程） ====================

/**
 * 创建 Tab 请求
 */
export interface CreateTabRequest {
  /** 窗口 ID */
  windowId?: number
  /** Tab 标题 */
  title: string
  /** Tab URL */
  url: string
  /** Tab 类型 */
  type?: TabType
  /** 是否激活 */
  isActive?: boolean
  /** 是否可关闭 */
  closable?: boolean
}

/**
 * 创建 Tab 响应
 */
export interface CreateTabResponse {
  /** Tab ID */
  tabId: number
  /** Tab 信息 */
  tab: TabInfoResponse
}

/**
 * 关闭 Tab 请求
 */
export interface CloseTabRequest {
  /** 窗口 ID */
  windowId?: number
  /** Tab ID */
  tabId: number
}

/**
 * 切换 Tab 请求
 */
export interface SwitchTabRequest {
  /** 窗口 ID */
  windowId?: number
  /** Tab ID */
  tabId: number
}

/**
 * 更新 Tab 请求
 */
export interface UpdateTabRequest {
  /** 窗口 ID */
  windowId?: number
  /** Tab ID */
  tabId: number
  /** 更新的标题 */
  title?: string
  /** 更新的 URL */
  url?: string
}

// ==================== 窗口状态监听相关类型（主进程 -> 渲染进程） ====================

/**
 * Tab 列表更新事件数据
 */
export interface TabsUpdatedEvent {
  /** 窗口 ID */
  windowId: number
  /** Tab 列表 */
  tabs: TabInfoResponse[]
  /** 当前激活的 Tab ID */
  currentTabId: number | null
}

/**
 * Tab 激活事件数据
 */
export interface TabActivatedEvent {
  /** 窗口 ID */
  windowId: number
  /** Tab ID */
  tabId: number
  /** 之前激活的 Tab ID */
  previousTabId: number | null
}

/**
 * Tab 关闭事件数据
 */
export interface TabClosedEvent {
  /** 窗口 ID */
  windowId: number
  /** Tab ID */
  tabId: number
}
