/**
 * LLMService - LLM 对接服务
 *
 * 职责：
 * - 管理 OpenAI Agent 实例
 * - 执行 LLM 调用
 * - 提供模型配置管理
 */

import { Agent } from '@openai/agents';
import type { Tool } from '@openai/agents';

/** LLM 配置 */
export interface LLMConfig {
  name: string;
  instructions: string;
  model: string;
  tools?: Tool[];
  handoffs?: Agent[];
  modelSettings?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    [key: string]: unknown;
  };
}

/**
 * LLM 服务
 */
export class LLMService {
  private agent: Agent | null = null;

  /**
   * 创建 Agent
   */
  createAgent(config: LLMConfig): Agent {
    this.agent = new Agent({
      name: config.name,
      instructions: config.instructions,
      model: config.model,
      ...(config.modelSettings ? { modelSettings: config.modelSettings } : {}),
      ...(config.tools && config.tools.length > 0 ? { tools: config.tools } : {}),
      ...(config.handoffs && config.handoffs.length > 0 ? { handoffs: config.handoffs } : {})
    });

    return this.agent;
  }

  /**
   * 获取 Agent 实例
   */
  getAgent(): Agent | null {
    return this.agent;
  }

  /**
   * 更新模型配置
   */
  updateModel(_model: string): void {
    if (!this.agent) {
      throw new Error('[LLMService] Agent 未初始化');
    }

    // SDK Agent 不支持动态更新模型，需要重建
    // 这里只是一个占位，实际需要调用方重新调用 createAgent
    // SDK Agent 不支持动态更新模型，需要调用方重新创建
  }
}
