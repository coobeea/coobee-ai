/**
 * 切换执行模式工具
 *
 * 当 Agent 在自由模式下检测到任务过于复杂、需要群体协作、或需要讨论时，可以调用此工具请求升级到其他模式。
 */

import { z } from 'zod';
import { createLogger } from '@main/common/logger';
import type { ToolDefinition, ToolResult, ToolStreamUpdate, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { eventBus } from '@main/common/eventbus';

const log = createLogger('tools:switch-execution-mode');

export const switchExecutionModeTool: ToolDefinition = {
  name: 'switch_execution_mode',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  description: `切换执行模式以处理不同类型的任务。

何时使用此工具：
- 任务需要详细的需求分析、方案设计、实施计划，预计需要 30 分钟以上（切换到 orchestrator 编排模式）
- 任务需要多个专业角色共同协作完成（切换到 swarm 群体模式）
- 任务需要多个视角进行辩论和讨论（切换到 discussion 讨论模式）
- 任务需要极高的代码质量和自我修复循环（切换到 quality-loop 质量闭环模式）

何时不使用此工具：
- 简单对话（"你好"、"谢谢"）
- 简单查询（"今天天气"、"什么是 TypeScript"）
- 单一文件的修改或代码片段生成
- 简单的工具调用（读文件、执行命令）

⚠️ 重要：
- 调用此工具后，当前会话将立即结束
- 系统会自动重新以新模式处理用户的原始请求
- 不要在调用此工具后继续输出内容`,

  parameters: z.object({
    targetMode: z.enum(['orchestrator', 'swarm', 'discussion', 'quality-loop']).describe('目标执行模式'),
    reason: z.string().describe('为什么需要切换模式（简短说明，1-2 句话）'),
    estimatedComplexity: z.enum(['low', 'medium', 'high']).describe('任务复杂度评估')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const args = params as { targetMode: string; reason: string; estimatedComplexity: string };

    log.info(
      `[switch_execution_mode] Requested: ${args.targetMode} because ${args.reason} (complexity: ${args.estimatedComplexity})`
    );

    const modeNames: Record<string, string> = {
      orchestrator: '编排模式',
      swarm: '群体模式',
      discussion: '讨论模式',
      'quality-loop': '质量闭环模式'
    };
    const modeName = modeNames[args.targetMode] || args.targetMode;

    yield {
      type: 'progress',
      content: `正在切换到${modeName}...`,
      percentage: 50
    };

    // 🔥 发送切换事件，让 Gateway 和前端知道需要升级模式
    eventBus.emit('agent:mode-switch-requested', {
      targetMode: args.targetMode,
      reason: args.reason,
      estimatedComplexity: args.estimatedComplexity
    });

    log.info('[switch_execution_mode] Switch event emitted');

    const message = `🔄 检测到任务特征，正在切换到${modeName}处理...\n\n原因：${args.reason}`;

    return {
      success: true,
      llmContent: message,
      userContent: message,
      metadata: {
        targetMode: args.targetMode,
        reason: args.reason,
        estimatedComplexity: args.estimatedComplexity
      }
    };
  }
};
