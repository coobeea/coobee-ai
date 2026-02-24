/**
 * 工具注册表
 *
 * 管理所有可用工具（内置 + 扩展），基于统一的 ToolDefinition 格式。
 * 两个 Runtime（OpenAI / PiMono）通过 getAll() 获取工具列表后各自转换为 SDK 原生格式。
 */
import type { ToolDefinition } from './types';

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ToolDefinition> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDefinition[]): void {
    tools.forEach((tool) => this.register(tool));
  }

  /**
   * 注销工具（热插拔用）
   *
   * @returns 是否存在并已移除
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}
