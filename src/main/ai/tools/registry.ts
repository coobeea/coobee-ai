/**
 * 工具注册表
 */
import type { Tool } from '../types'

export class ToolRegistry {
  private static instance: ToolRegistry
  private tools: Map<string, Tool> = new Map()

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry()
    }
    return ToolRegistry.instance
  }

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: Tool[]): void {
    tools.forEach((tool) => this.register(tool))
  }
}
