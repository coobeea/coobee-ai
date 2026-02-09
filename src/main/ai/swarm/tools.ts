/**
 * Swarm 通信工具
 *
 * 暴露给 Agent 使用的工具函数，让 Agent 能够：
 * - 读写共享上下文（黑板）
 * - 添加和获取中间产物
 * - 发送和接收消息
 * - 查看任务进度
 *
 * 这些工具通过闭包捕获 SwarmContext 和 MessageBus 的引用，
 * 在 Agent 创建时注入，使 Agent 能在执行过程中与其他 Agent 通信。
 */

import { tool } from '@openai/agents'
import { z } from 'zod'
import type { SwarmContext } from './SwarmContext'
import type { MessageBus } from './MessageBus'

/**
 * 创建共享上下文读取工具
 *
 * @param context SwarmContext 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createReadContextTool(
  context: SwarmContext,
  _roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'read_shared_context',
    description:
      '读取 Swarm 共享上下文中的状态值。可以获取其他 Agent 存储的信息、中间产物和进度说明。',
    parameters: z.object({
      key: z.string().optional().describe('要读取的状态键名。不传则返回所有状态的摘要。')
    }),
    execute: async ({ key }) => {
      if (key) {
        const value = context.get(key)
        if (value === undefined) {
          return JSON.stringify({ success: false, error: `键 "${key}" 不存在` })
        }
        return JSON.stringify({ success: true, key, value })
      }
      // 返回完整摘要
      return JSON.stringify({
        success: true,
        summary: context.toSummary(),
        keys: context.keys(),
        artifactCount: context.getArtifacts().length,
        recentProgress: context.getRecentProgress(5)
      })
    }
  })
}

/**
 * 创建共享上下文写入工具
 *
 * @param context SwarmContext 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createWriteContextTool(
  context: SwarmContext,
  roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'write_shared_context',
    description:
      '向 Swarm 共享上下文写入状态值。其他 Agent 可以读取你写入的信息。用于传递中间结果、标记进度等。',
    parameters: z.object({
      key: z.string().describe('状态键名'),
      value: z.string().describe('状态值（字符串格式）')
    }),
    execute: async ({ key, value }) => {
      context.set(key, value, roleId)
      return JSON.stringify({ success: true, key, message: `已写入状态: ${key}` })
    }
  })
}

/**
 * 创建添加产物工具
 *
 * @param context SwarmContext 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createAddArtifactTool(
  context: SwarmContext,
  roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'add_artifact',
    description:
      '向共享上下文添加中间产物（如代码、文档、分析报告等）。其他 Agent 可以查看和引用你产出的产物。',
    parameters: z.object({
      name: z.string().describe('产物名称'),
      content: z.string().describe('产物内容'),
      type: z.string().optional().describe('产物类型（如 code, document, analysis, report）')
    }),
    execute: async ({ name, content, type }) => {
      context.addArtifact(name, content, roleId, type)
      return JSON.stringify({
        success: true,
        name,
        message: `已添加产物: ${name} (${type || 'unknown'})`
      })
    }
  })
}

/**
 * 创建获取产物工具
 *
 * @param context SwarmContext 实例
 * @param _roleId 当前 Agent 的角色 ID
 */
export function createGetArtifactTool(
  context: SwarmContext,
  _roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'get_artifact',
    description: '获取共享上下文中的中间产物。可以查看其他 Agent 产出的代码、文档等。',
    parameters: z.object({
      name: z.string().optional().describe('产物名称。不传则返回所有产物列表。')
    }),
    execute: async ({ name }) => {
      if (name) {
        const artifact = context.getArtifact(name)
        if (!artifact) {
          return JSON.stringify({ success: false, error: `产物 "${name}" 不存在` })
        }
        return JSON.stringify({ success: true, artifact })
      }
      // 返回所有产物列表
      const artifacts = context.getArtifacts()
      return JSON.stringify({
        success: true,
        count: artifacts.length,
        artifacts: artifacts.map((a) => ({
          name: a.name,
          type: a.type,
          createdBy: a.createdBy,
          contentLength: a.content.length
        }))
      })
    }
  })
}

/**
 * 创建发送消息工具
 *
 * @param messageBus MessageBus 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createSendMessageTool(
  messageBus: MessageBus,
  roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'send_message',
    description:
      '向其他 Agent 发送消息。可以请求帮助、通知进度、或传递信息。使用 "*" 作为 to 参数表示广播给所有 Agent。',
    parameters: z.object({
      to: z.string().describe('接收者角色 ID（如 coder, researcher, reviewer）或 "*" 表示广播'),
      content: z.string().describe('消息内容'),
      topic: z.string().optional().describe('话题标签（用于分类消息）'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('消息优先级')
    }),
    execute: async ({ to, content, topic, priority }) => {
      const message = messageBus.send(roleId, to, content, { topic, priority })
      return JSON.stringify({
        success: true,
        messageId: message.id,
        message: `消息已发送给 ${to}`
      })
    }
  })
}

/**
 * 创建接收消息工具
 *
 * @param messageBus MessageBus 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createGetMessagesTool(
  messageBus: MessageBus,
  roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'get_messages',
    description: '获取发给你的消息。可以查看未读消息、特定话题的消息、或与某个 Agent 的对话历史。',
    parameters: z.object({
      type: z
        .enum(['unread', 'all', 'topic', 'conversation'])
        .describe('查询类型: unread=未读, all=全部, topic=按话题, conversation=对话'),
      topic: z.string().optional().describe('话题名称（type=topic 时必填）'),
      withRole: z.string().optional().describe('对方角色 ID（type=conversation 时必填）'),
      limit: z.number().optional().describe('最大返回数量')
    }),
    execute: async ({ type, topic, withRole, limit }) => {
      let messages: Array<{
        fromRoleId: string
        content: string
        topic?: string
        timestamp: number
      }>

      switch (type) {
        case 'unread': {
          const unread = messageBus.getUnreadMessages(roleId)
          messages = unread
          // 标记为已读
          for (const msg of unread) {
            messageBus.markAsRead(msg.id)
          }
          break
        }
        case 'all':
          messages = messageBus.getMessagesForRole(roleId, limit)
          break
        case 'topic':
          if (!topic) {
            return JSON.stringify({ success: false, error: '需要指定 topic 参数' })
          }
          messages = messageBus.getMessagesByTopic(topic, limit)
          break
        case 'conversation':
          if (!withRole) {
            return JSON.stringify({ success: false, error: '需要指定 withRole 参数' })
          }
          messages = messageBus.getConversation(roleId, withRole, limit)
          break
        default:
          return JSON.stringify({ success: false, error: `未知查询类型: ${type}` })
      }

      return JSON.stringify({
        success: true,
        count: messages.length,
        messages: messages.map((m) => ({
          from: m.fromRoleId,
          content: m.content,
          topic: m.topic,
          time: new Date(m.timestamp).toISOString()
        }))
      })
    }
  })
}

/**
 * 创建进度上报工具
 *
 * @param context SwarmContext 实例
 * @param roleId 当前 Agent 的角色 ID
 */
export function createReportProgressTool(
  context: SwarmContext,
  roleId: string
): ReturnType<typeof tool> {
  return tool({
    name: 'report_progress',
    description: '上报当前任务进度。其他 Agent 和监控系统可以看到你的进度信息。',
    parameters: z.object({
      note: z.string().describe('进度说明')
    }),
    execute: async ({ note }) => {
      context.addProgressNote(note, roleId)
      return JSON.stringify({ success: true, message: '进度已上报' })
    }
  })
}

// ========== 工具集合 ==========

/**
 * 为指定角色创建完整的通信工具集
 *
 * @param context SwarmContext 实例
 * @param messageBus MessageBus 实例
 * @param roleId 当前 Agent 的角色 ID
 * @returns 通信工具数组
 */
export function createSwarmTools(
  context: SwarmContext,
  messageBus: MessageBus,
  roleId: string
): ReturnType<typeof tool>[] {
  return [
    createReadContextTool(context, roleId),
    createWriteContextTool(context, roleId),
    createAddArtifactTool(context, roleId),
    createGetArtifactTool(context, roleId),
    createSendMessageTool(messageBus, roleId),
    createGetMessagesTool(messageBus, roleId),
    createReportProgressTool(context, roleId)
  ]
}
