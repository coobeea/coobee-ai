/**
 * Swarm 通信工具 + Handoff 工具
 *
 * SDK 无关 — 使用项目统一的 ToolDefinition 格式。
 *
 * 两类工具：
 * 1. 通信工具 — 让 Agent 读写共享上下文、收发消息、上报进度
 * 2. Handoff 工具 — 让 Agent 发起控制权交接（transfer_to_XXX）
 *    协调器通过检测 HANDOFF_SIGNAL_PREFIX 截获交接信号
 */

import { z } from 'zod';
import { ToolCategory } from '../tools/types';
import type { ToolDefinition, ToolStreamUpdate } from '../tools/types';
import type { SwarmContext } from './SwarmContext';
import type { MessageBus } from './MessageBus';
import type { AgentRole } from './types';
import { HANDOFF_SIGNAL_PREFIX } from './types';

function progress(content: string): ToolStreamUpdate {
  return { type: 'progress', content };
}

// ========== 通信工具 ==========

export function createReadContextTool(context: SwarmContext, _roleId: string): ToolDefinition {
  return {
    name: 'read_shared_context',
    description: '读取 Swarm 共享上下文中的状态值。可以获取其他 Agent 存储的信息、中间产物和进度说明。',
    category: ToolCategory.Memory,
    parameters: z.object({
      key: z.string().optional().describe('要读取的状态键名。不传则返回所有状态的摘要。')
    }),
    execute: async function* ({ key }) {
      yield progress('Reading shared context...');
      if (key) {
        const value = context.get(key as string);
        if (value === undefined) {
          return { success: false, llmContent: `键 "${key}" 不存在` };
        }
        return { success: true, llmContent: JSON.stringify({ key, value }) };
      }
      return {
        success: true,
        llmContent: JSON.stringify({
          summary: context.toSummary(),
          keys: context.keys(),
          artifactCount: context.getArtifacts().length,
          recentProgress: context.getRecentProgress(5)
        })
      };
    }
  };
}

export function createWriteContextTool(context: SwarmContext, roleId: string): ToolDefinition {
  return {
    name: 'write_shared_context',
    description: '向 Swarm 共享上下文写入状态值。其他 Agent 可以读取你写入的信息。用于传递中间结果、标记进度等。',
    category: ToolCategory.Memory,
    parameters: z.object({
      key: z.string().describe('状态键名'),
      value: z.string().describe('状态值（字符串格式）')
    }),
    execute: async function* ({ key, value }) {
      yield progress('Writing shared context...');
      context.set(key as string, value, roleId);
      return { success: true, llmContent: `已写入状态: ${key}` };
    }
  };
}

export function createAddArtifactTool(context: SwarmContext, roleId: string): ToolDefinition {
  return {
    name: 'add_artifact',
    description: '向共享上下文添加中间产物（如代码、文档、分析报告等）。其他 Agent 可以查看和引用你产出的产物。',
    category: ToolCategory.Memory,
    parameters: z.object({
      name: z.string().describe('产物名称'),
      content: z.string().describe('产物内容'),
      type: z.string().optional().describe('产物类型（如 code, document, analysis, report）')
    }),
    execute: async function* ({ name, content, type }) {
      yield progress('Adding artifact...');
      context.addArtifact(name as string, content as string, roleId, type as string | undefined);
      return { success: true, llmContent: `已添加产物: ${name} (${type || 'unknown'})` };
    }
  };
}

export function createGetArtifactTool(context: SwarmContext, _roleId: string): ToolDefinition {
  return {
    name: 'get_artifact',
    description: '获取共享上下文中的中间产物。可以查看其他 Agent 产出的代码、文档等。',
    category: ToolCategory.Memory,
    parameters: z.object({
      name: z.string().optional().describe('产物名称。不传则返回所有产物列表。')
    }),
    execute: async function* ({ name }) {
      yield progress('Getting artifact...');
      if (name) {
        const artifact = context.getArtifact(name as string);
        if (!artifact) {
          return { success: false, llmContent: `产物 "${name}" 不存在` };
        }
        return { success: true, llmContent: JSON.stringify(artifact) };
      }
      const artifacts = context.getArtifacts();
      return {
        success: true,
        llmContent: JSON.stringify({
          count: artifacts.length,
          artifacts: artifacts.map((a) => ({
            name: a.name,
            type: a.type,
            createdBy: a.createdBy,
            contentLength: a.content.length
          }))
        })
      };
    }
  };
}

export function createSendMessageTool(messageBus: MessageBus, roleId: string): ToolDefinition {
  return {
    name: 'send_message',
    description:
      '向其他 Agent 发送消息。可以请求帮助、通知进度、或传递信息。使用 "*" 作为 to 参数表示广播给所有 Agent。',
    category: ToolCategory.Memory,
    parameters: z.object({
      to: z.string().describe('接收者角色 ID（如 coder, researcher, reviewer）或 "*" 表示广播'),
      content: z.string().describe('消息内容'),
      topic: z.string().optional().describe('话题标签（用于分类消息）'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('消息优先级')
    }),
    execute: async function* ({ to, content, topic, priority }) {
      yield progress('Sending message...');
      const message = messageBus.send(roleId, to as string, content as string, {
        topic: topic as string | undefined,
        priority: priority as 'low' | 'normal' | 'high' | 'urgent' | undefined
      });
      return { success: true, llmContent: `消息已发送给 ${to}，ID: ${message.id}` };
    }
  };
}

export function createGetMessagesTool(messageBus: MessageBus, roleId: string): ToolDefinition {
  return {
    name: 'get_messages',
    description: '获取发给你的消息。可以查看未读消息、特定话题的消息、或与某个 Agent 的对话历史。',
    category: ToolCategory.Memory,
    parameters: z.object({
      type: z
        .enum(['unread', 'all', 'topic', 'conversation'])
        .describe('查询类型: unread=未读, all=全部, topic=按话题, conversation=对话'),
      topic: z.string().optional().describe('话题名称（type=topic 时必填）'),
      withRole: z.string().optional().describe('对方角色 ID（type=conversation 时必填）'),
      limit: z.number().optional().describe('最大返回数量')
    }),
    execute: async function* ({ type, topic, withRole, limit }) {
      yield progress('Getting messages...');
      let messages: Array<{
        fromRoleId: string;
        content: string;
        topic?: string;
        timestamp: number;
        id: string;
      }>;

      switch (type) {
        case 'unread': {
          const unread = messageBus.getUnreadMessages(roleId);
          messages = unread;
          for (const msg of unread) {
            messageBus.markAsRead(msg.id);
          }
          break;
        }
        case 'all':
          messages = messageBus.getMessagesForRole(roleId, limit as number | undefined);
          break;
        case 'topic':
          if (!topic) {
            return { success: false, llmContent: '需要指定 topic 参数' };
          }
          messages = messageBus.getMessagesByTopic(topic as string, limit as number | undefined);
          break;
        case 'conversation':
          if (!withRole) {
            return { success: false, llmContent: '需要指定 withRole 参数' };
          }
          messages = messageBus.getConversation(roleId, withRole as string, limit as number | undefined);
          break;
        default:
          return { success: false, llmContent: `未知查询类型: ${type}` };
      }

      return {
        success: true,
        llmContent: JSON.stringify({
          count: messages.length,
          messages: messages.map((m) => ({
            from: m.fromRoleId,
            content: m.content,
            topic: m.topic,
            time: new Date(m.timestamp).toISOString()
          }))
        })
      };
    }
  };
}

export function createReportProgressTool(context: SwarmContext, roleId: string): ToolDefinition {
  return {
    name: 'report_progress',
    description: '上报当前任务进度。其他 Agent 和监控系统可以看到你的进度信息。',
    category: ToolCategory.Memory,
    parameters: z.object({
      note: z.string().describe('进度说明')
    }),
    execute: async function* ({ note }) {
      yield progress('Reporting progress...');
      context.addProgressNote(note as string, roleId);
      return { success: true, llmContent: '进度已上报' };
    }
  };
}

// ========== Handoff 工具 ==========

/**
 * 为指定角色创建 Handoff 工具（transfer_to_XXX）
 *
 * 每个可交接的目标角色生成一个工具。
 * Agent 调用后返回 HANDOFF_SIGNAL_PREFIX + targetRoleId，
 * 协调器截获信号并执行实际交接。
 */
export function createHandoffTools(availableRoles: AgentRole[], currentRoleId: string): ToolDefinition[] {
  return availableRoles
    .filter((role) => role.id !== currentRoleId)
    .map((role) => ({
      name: `transfer_to_${role.id}`,
      description: role.handoffDescription || `交接给 ${role.name}: ${role.description}`,
      category: ToolCategory.Memory,
      parameters: z.object({
        reason: z.string().optional().describe('交接原因说明')
      }),
      execute: async function* ({ reason }) {
        yield progress(`Transferring to ${role.name}...`);
        return {
          success: true,
          llmContent: `${HANDOFF_SIGNAL_PREFIX}${role.id}`,
          metadata: { reason, targetRole: role.id }
        };
      }
    }));
}

// ========== 工具集合 ==========

/**
 * 为指定角色创建完整的通信工具集（不含 Handoff 工具）
 */
export function createSwarmCommTools(context: SwarmContext, messageBus: MessageBus, roleId: string): ToolDefinition[] {
  return [
    createReadContextTool(context, roleId),
    createWriteContextTool(context, roleId),
    createAddArtifactTool(context, roleId),
    createGetArtifactTool(context, roleId),
    createSendMessageTool(messageBus, roleId),
    createGetMessagesTool(messageBus, roleId),
    createReportProgressTool(context, roleId)
  ];
}

/**
 * 为指定角色创建完整工具集（通信 + Handoff）
 */
export function createSwarmTools(
  context: SwarmContext,
  messageBus: MessageBus,
  roleId: string,
  availableRoles: AgentRole[] = []
): ToolDefinition[] {
  return [...createSwarmCommTools(context, messageBus, roleId), ...createHandoffTools(availableRoles, roleId)];
}
