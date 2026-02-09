/**
 * Agent 工厂
 * 负责创建 Agent 实例，不持有缓存。
 * Agent 的生命周期由使用方（AgentRuntime 等）自行管理。
 */

import { Agent } from '@openai/agents'
import type { ModelSettings, Tool } from '@openai/agents'
import { agentPresets, type AgentPresetType, type AgentPreset } from './presets'
import { agentConfigStore, type AgentConfigData } from '../storage/AgentConfigStore'

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
  /** SDK modelSettings: 精细控制模型行为参数（覆盖预设的 modelSettings） */
  modelSettings?: ModelSettings
}

/**
 * Agent 工厂类
 *
 * 职责：
 * - 从预设 / 数据库配置 / 自定义选项创建 Agent 实例
 * - 管理工具注册表（工具 ID → Tool 实例的映射）
 *
 * 不负责：
 * - Agent 生命周期管理（由 AgentRuntime / TeamRuntime / SwarmRuntime 管理）
 * - Agent 缓存（SDK Agent 是轻量配置对象，创建成本极低）
 */
export class AgentFactory {
  // 工具注册表（工具 ID -> Tool 实例）
  private toolRegistry = new Map<string, Tool>()

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
   * @param options 创建选项
   */
  async createAgent(options: AgentCreateOptions = {}): Promise<Agent> {
    const { preset, configId, config = {}, tools = [], modelSettings } = options

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
      // 合并 modelSettings（选项 > 自定义配置 > 预设）
      modelSettings: {
        ...(finalConfig.modelSettings || {}),
        ...(config.modelSettings || {}),
        ...(modelSettings || {})
      },
      // 添加工具（如果有）
      ...(tools.length > 0 ? { tools } : {})
    }

    // 创建并返回 Agent 实例
    return new Agent(mergedConfig)
  }

  /**
   * 将数据库配置转换为 Agent 预设
   */
  private configDataToPreset(config: AgentConfigData): AgentPreset {
    return {
      name: config.name,
      instructions: config.instructions,
      model: config.model || 'gpt-4o',
      // 从数据库配置中加载 modelSettings（如果存在）
      ...(config.modelSettings ? { modelSettings: config.modelSettings as ModelSettings } : {})
    }
  }
}

/**
 * 全局 Agent 工厂实例
 */
export const agentFactory = new AgentFactory()
