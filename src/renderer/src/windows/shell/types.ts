/**
 * Shell 窗口类型定义
 */

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * 消息接口
 */
export interface Message {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: MessageRole
  /** 内容 */
  content: string
  /** 创建时间 */
  createdAt: Date
  /** 是否正在生成 */
  isGenerating?: boolean
}

/**
 * 对话接口
 */
export interface Conversation {
  /** 对话 ID */
  id: string
  /** 标题 */
  title: string
  /** 消息列表 */
  messages: Message[]
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
}

/**
 * Shell 配置
 */
export interface ShellConfig {
  /** 是否显示侧边栏 */
  showSidebar: boolean
  /** 主题 */
  theme: 'light' | 'dark' | 'auto'
  /** 字体大小 */
  fontSize: 'small' | 'medium' | 'large'
}
