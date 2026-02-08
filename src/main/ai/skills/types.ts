/**
 * 技能系统类型定义
 * Skills 是对 @openai/agents Tools 的高级封装
 */

import type { Agent } from '@openai/agents'

/**
 * 技能执行上下文
 */
export interface SkillExecutionContext {
  /** 会话 ID */
  sessionId: string
  /** 当前 Agent 实例 */
  agent: Agent
  /** 用户输入 */
  userInput: string
  /** 其他上下文信息 */
  metadata?: Record<string, unknown>
}

/**
 * 技能定义
 * 技能是比 Tool 更高级的抽象，可以包含多个步骤和工具调用
 */
export interface AISkill {
  /** 技能 ID */
  id: string
  /** 技能名称 */
  name: string
  /** 技能描述 */
  description: string
  /** 匹配关键词（用于激活） */
  keywords?: string[]
  /** 使用示例 */
  examples?: string[]
  /** 技能类别 */
  category?: SkillCategory
  /** 技能执行函数 */
  execute: (context: SkillExecutionContext) => Promise<unknown>
}

/**
 * 技能类别
 */
export type SkillCategory =
  | 'web-research' // 网络研究
  | 'code-generation' // 代码生成
  | 'data-analysis' // 数据分析
  | 'file-operation' // 文件操作
  | 'communication' // 通信交互
  | 'reasoning' // 推理分析
  | 'other' // 其他

/**
 * 技能激活选项
 */
export interface SkillActivationOptions {
  /** 是否自动激活（基于上下文） */
  autoActivate?: boolean
  /** 手动指定要激活的技能 ID */
  manualSkillIds?: string[]
  /** 最大激活数量 */
  maxActivated?: number
  /** 最小匹配度阈值 */
  minMatchScore?: number
}
