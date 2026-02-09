/**
 * Agent 工厂
 * 负责创建和管理 Agent 实例
 */

import { Agent } from '@openai/agents'
import { agentPresets, type AgentPresetType, type AgentPreset } from './presets'
import { agentConfigStore, type AgentConfigData } from '../storage/AgentConfigStore'
import type { Tool } from '@openai/agents'

/**
 * Agent 创建选项
 */
export interface AgentCreateOptions {
  /** 预设类型 */
  preset?: AgentPresetType
  /** 从数据库加载配置 ID */
  configId?: string
  /** 自定义配置（会覆盖预设） */
  config?: Partial<AgentPreset>
  /** 要注册的工具 */
  tools?: Tool[]
}

/**
 * Agent 缓存条目
 */
interface AgentCacheEntry {
  agent: Agent
  lastAccess: number
  createdAt: number
}

/**
 * Agent 工厂类
 */
export class AgentFactory {
  // Agent 实例缓存：sessionId -> AgentCacheEntry
  private agents = new Map<string, AgentCacheEntry>()

  // 缓存配置
  private readonly maxCacheSize = 100 // 最大缓存数量
  private readonly cacheTimeout = 30 * 60 * 1000 // 30分钟过期

  // 工具注册表（工具 ID -> Tool 实例）
  private toolRegistry = new Map<string, Tool>()

  // 清理定时器（用于 destroy() 方法）

  private readonly cleanupInterval: NodeJS.Timeout

  constructor() {
    // 启动定期清理过期缓存
    this.cleanupInterval = this.startCleanup()
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): NodeJS.Timeout {
    // 每5分钟清理一次过期缓存
    return setInterval(
      () => {
        this.cleanupExpiredAgents()
      },
      5 * 60 * 1000
    )
  }

  /**
   * 清理过期的 Agent
   */
  private cleanupExpiredAgents(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [sessionId, entry] of this.agents.entries()) {
      if (now - entry.lastAccess > this.cacheTimeout) {
        this.agents.delete(sessionId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`[AgentFactory] Cleaned up ${cleanedCount} expired agents`)
    }
  }

  /**
   * LRU 淘汰：删除最久未使用的 Agent
   */
  private evictLRU(): void {
    if (this.agents.size < this.maxCacheSize) {
      return
    }

    // 找到最久未使用的条目
    let oldestSessionId: string | null = null
    let oldestTime = Infinity

    for (const [sessionId, entry] of this.agents.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestSessionId = sessionId
      }
    }

    if (oldestSessionId) {
      this.agents.delete(oldestSessionId)
      console.log(`[AgentFactory] Evicted agent for session: ${oldestSessionId}`)
    }
  }

  /**
   * 注册工具到工具注册表
   * @param toolId 工具 ID
   * @param tool 工具实例
   */
  registerTool(toolId: string, tool: Tool): void {
    this.toolRegistry.set(toolId, tool)
  }

  /**
   * 批量注册工具
   * @param tools 工具映射表
   */
  registerTools(tools: Record<string, Tool>): void {
    Object.entries(tools).forEach(([id, tool]) => {
      this.registerTool(id, tool)
    })
  }

  /**
   * 获取工具
   * @param toolId 工具 ID
   */
  getTool(toolId: string): Tool | undefined {
    return this.toolRegistry.get(toolId)
  }

  /**
   * 根据 ID 列表获取工具实例
   * @param toolIds 工具 ID 列表
   */
  getToolsByIds(toolIds: string[]): Tool[] {
    return toolIds.map((id) => this.getTool(id)).filter((tool): tool is Tool => tool !== undefined)
  }

  /**
   * 创建 Agent 实例
   * @param sessionId 会话 ID
   * @param options 创建选项
   */
  async createAgent(sessionId: string, options: AgentCreateOptions = {}): Promise<Agent> {
    const { preset, configId, config = {}, tools = [] } = options

    let finalConfig: AgentPreset

    // 1. 如果提供了 configId，从数据库加载
    if (configId) {
      const dbConfig = await agentConfigStore.getConfig(configId)
      if (!dbConfig) {
        throw new Error(`Agent config not found: ${configId}`)
      }
      finalConfig = this.configDataToPreset(dbConfig)

      // 加载工具
      if (dbConfig.tools && dbConfig.tools.length > 0) {
        const dbTools = this.getToolsByIds(dbConfig.tools)
        tools.push(...dbTools)
      }
    }
    // 2. 否则使用预设
    else if (preset) {
      finalConfig = agentPresets[preset]
    }
    // 3. 或使用默认预设
    else {
      finalConfig = agentPresets.chat
    }

    // 合并自定义配置
    const mergedConfig = {
      ...finalConfig,
      ...config,
      // 添加工具（如果有）
      ...(tools.length > 0 ? { tools } : {})
    }

    // 创建 Agent 实例
    const agent = new Agent(mergedConfig)

    // 执行 LRU 淘汰（如果需要）
    this.evictLRU()

    // 缓存实例
    const now = Date.now()
    this.agents.set(sessionId, {
      agent,
      lastAccess: now,
      createdAt: now
    })

    return agent
  }

  /**
   * 将数据库配置转换为 Agent 预设
   */
  private configDataToPreset(config: AgentConfigData): AgentPreset {
    return {
      name: config.name,
      instructions: config.instructions,
      model: config.model || 'gpt-4o'
    }
  }

  /**
   * 获取已存在的 Agent
   * @param sessionId 会话 ID
   */
  getAgent(sessionId: string): Agent | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) {
      return undefined
    }

    // 检查是否过期
    const now = Date.now()
    if (now - entry.lastAccess > this.cacheTimeout) {
      this.agents.delete(sessionId)
      console.log(`[AgentFactory] Agent expired for session: ${sessionId}`)
      return undefined
    }

    // 更新访问时间
    entry.lastAccess = now

    return entry.agent
  }

  /**
   * 获取或创建 Agent
   * @param sessionId 会话 ID
   * @param options 创建选项（仅在不存在时使用）
   */
  async getOrCreateAgent(sessionId: string, options?: AgentCreateOptions): Promise<Agent> {
    const existingAgent = this.getAgent(sessionId)
    if (existingAgent) {
      return existingAgent
    }
    return await this.createAgent(sessionId, options)
  }

  /**
   * 删除 Agent
   * @param sessionId 会话 ID
   */
  removeAgent(sessionId: string): void {
    this.agents.delete(sessionId)
  }

  /**
   * 清空所有 Agent
   */
  clear(): void {
    this.agents.clear()
  }

  /**
   * 获取所有 Agent 会话 ID
   */
  getAllSessionIds(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * 删除 Agent
   * @param sessionId 会话 ID
   */
  deleteAgent(sessionId: string): void {
    this.agents.delete(sessionId)
    console.log(`[AgentFactory] Deleted agent for session: ${sessionId}`)
  }

  /**
   * 清空所有 Agent
   */
  clearAllAgents(): void {
    const count = this.agents.size
    this.agents.clear()
    console.log(`[AgentFactory] Cleared ${count} agents`)
  }

  /**
   * 清理资源
   */
  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.clearAllAgents()
    console.log('[AgentFactory] Destroyed')
  }
}

/**
 * 全局 Agent 工厂实例
 */
export const agentFactory = new AgentFactory()
