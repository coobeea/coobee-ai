/**
 * emit_event — 事件发送工具
 *
 * 允许 Agent 在运行过程中向前端发送事件，触发 UI 交互。
 * 事件通过 Gateway WebSocket 广播给所有连接的前端客户端。
 *
 * 典型场景：
 *   - Agent 启动 dev server 后通知前端打开网页预览
 *   - Agent 生成了文件后通知前端打开查看
 *   - 任何需要前端配合执行的交互场景
 *
 * 预定义事件类型：
 *   - open-preview: 在工作台打开 URL 预览（iframe）
 *   - open-file:    在工作台打开文件
 *   - notify:       向用户显示通知消息
 *
 * 分类：Observability | 风险：低（只读通知，不改变系统状态）
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolStreamUpdate, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { eventBus } from '@main/common/eventbus';

export const emitEventTool: ToolDefinition = {
  name: 'emit_event',
  description:
    'Send an event to the user interface. Use this to trigger UI actions like:\n' +
    '- "open-preview": Open a URL preview in the workbench (e.g. after starting a dev server)\n' +
    '  payload: { url: "http://localhost:3000", title?: "My App" }\n' +
    '- "open-file": Open a file in the workbench editor\n' +
    '  payload: { path: "/absolute/path/to/file" }\n' +
    '- "notify": Show a notification to the user\n' +
    '  payload: { message: "Task completed!", level?: "info"|"success"|"warning"|"error" }',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: z.object({
    event: z.string().describe('Event type: "open-preview", "open-file", "notify", or custom event name'),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Event payload (key-value object). Content depends on event type.')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const event = params.event as string;
    const payload = (params.payload as Record<string, unknown>) || {};

    if (!event || typeof event !== 'string') {
      return {
        success: false,
        llmContent: 'Error: event must be a non-empty string',
        error: { code: 'INVALID_PARAM', message: 'event must be a non-empty string' }
      };
    }

    const enrichedPayload = {
      ...payload,
      _event: event,
      _sessionId: context?.sessionId,
      _agentName: context?.agentName,
      _timestamp: Date.now()
    };

    eventBus.emit('agent:event', enrichedPayload);

    yield { type: 'progress', content: `Event "${event}" sent`, percentage: 100 };

    return {
      success: true,
      llmContent: `Event "${event}" has been sent to the user interface.`,
      userContent: `📡 ${event}`,
      metadata: { event, payload }
    };
  }
};
