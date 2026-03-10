/**
 * ToolAdapterService - 工具适配服务
 *
 * 职责：
 * - 将统一的 ToolDefinition 转换为 OpenAI SDK 的 Tool
 * - 提供工具执行上下文
 */

import { tool } from '@openai/agents';
import type { Tool } from '@openai/agents';
import type { ToolDefinition } from '../types';
import { createFallbackToolContext } from '../shared/ToolExecutionPipeline';

/**
 * 工具适配服务
 */
export class ToolAdapterService {
  /**
   * 将 ToolDefinition 转换为 SDK Tool
   */
  convertTools(tools: ToolDefinition[]): Tool[] {
    return tools.map((t) => this.convertTool(t));
  }

  /**
   * 转换单个工具
   */
  private convertTool(toolDef: ToolDefinition): Tool {
    return tool({
      name: toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        // 使用工具执行管线
        const { executeToolPipeline } = await import('../shared/ToolExecutionPipeline');

        const ctx = createFallbackToolContext({
          workspaceRoot: process.cwd(),
          sessionId: 'unknown'
        });

        const result = await executeToolPipeline(toolDef, args, {
          sandboxContext: ctx,
          onUpdate: () => {}
        });

        return result.resultText;
      }
    });
  }

  /**
   * 从 SDK Tools 和 ToolDefinition 合并工具列表
   */
  mergeTools(sdkTools: Tool[], toolDefs: ToolDefinition[]): Tool[] {
    const convertedTools = this.convertTools(toolDefs);
    return [...sdkTools, ...convertedTools];
  }
}
