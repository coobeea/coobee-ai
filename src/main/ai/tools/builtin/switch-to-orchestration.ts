/**
 * 切换到编排模式工具
 *
 * 当 Agent 在自由模式下检测到任务过于复杂时，可以调用此工具请求升级到编排模式。
 */

import { z } from 'zod';
import { createLogger } from '@main/common/logger';
import type { ToolDefinition, ToolResult, ToolStreamUpdate, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { eventBus } from '@main/common/eventbus';

const log = createLogger('tools:switch-to-orchestration');

export const switchToOrchestrationTool: ToolDefinition = {
  name: 'switch_to_orchestration',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  description: `切换到多智能体编排模式处理复杂任务。

何时使用此工具：
- 用户要求开发完整的应用/系统/网站（如"开发音乐播放器网站"）
- 任务需要多个步骤且涉及多个技术领域（前端+后端+数据库）
- 任务需要详细的需求分析、方案设计、实施计划
- 任务预计需要 30 分钟以上才能完成

何时不使用此工具：
- 简单对话（"你好"、"谢谢"）
- 简单查询（"今天天气"、"什么是 TypeScript"）
- 单一文件的修改或代码片段生成
- 简单的工具调用（读文件、执行命令）

⚠️ 重要：
- 调用此工具后，当前会话将立即结束
- 系统会自动重新以编排模式处理用户的原始请求
- 不要在调用此工具后继续输出内容`,

  parameters: z.object({
    reason: z.string().describe('为什么需要切换到编排模式（简短说明，1-2 句话）'),
    estimatedComplexity: z
      .enum(['medium', 'high'])
      .describe('任务复杂度评估：medium=中等（2-5 个子任务），high=高（5+ 个子任务）')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const args = params as { reason: string; estimatedComplexity: 'medium' | 'high' };

    log.info(`[switch_to_orchestration] Requested: ${args.reason} (complexity: ${args.estimatedComplexity})`);

    yield {
      type: 'progress',
      content: '正在切换到编排模式...',
      percentage: 50
    };

    // 🔥 发送切换事件，让 Gateway 和前端知道需要升级模式
    eventBus.emit('agent:mode-switch-requested', {
      targetMode: 'orchestrator',
      reason: args.reason,
      estimatedComplexity: args.estimatedComplexity
    });

    log.info('[switch_to_orchestration] Switch event emitted');

    const message = `🔄 检测到复杂任务，正在切换到编排模式处理...\n\n原因：${args.reason}\n\n编排模式将提供：\n- 📋 详细的需求分析\n- 💡 多方案设计与选择\n- 🔄 方案反思与优化\n- ✅ 完整的实施计划与验收`;

    return {
      success: true,
      llmContent: message,
      userContent: message,
      metadata: {
        targetMode: 'orchestrator',
        reason: args.reason,
        estimatedComplexity: args.estimatedComplexity
      }
    };
  }
};
