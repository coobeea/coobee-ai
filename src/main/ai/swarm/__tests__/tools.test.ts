/**
 * Swarm 通信工具测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@openai/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: vi.fn((config: any) => ({
    type: 'function',
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute
  }))
}))

import {
  createReadContextTool,
  createWriteContextTool,
  createAddArtifactTool,
  createGetArtifactTool,
  createSendMessageTool,
  createGetMessagesTool,
  createReportProgressTool,
  createSwarmTools
} from '../tools'
import { SwarmContext } from '../SwarmContext'
import { MessageBus } from '../MessageBus'

// Mock 返回的工具对象包含 execute 方法（FunctionTool 类型中为 invoke）
// 辅助函数用于在测试中安全调用 mock 工具的 execute
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any, args: Record<string, any>): Promise<string> => t.execute(args)

describe('Swarm Tools', () => {
  let context: SwarmContext
  let messageBus: MessageBus

  beforeEach(() => {
    context = new SwarmContext()
    messageBus = new MessageBus()
  })

  describe('read_shared_context', () => {
    it('读取指定键', async () => {
      context.set('k', 'v', 'system')
      const tool = createReadContextTool(context, 'r1')
      const result = JSON.parse(await exec(tool, { key: 'k' }))
      expect(result.success).toBe(true)
      expect(result.value).toBe('v')
    })

    it('键不存在', async () => {
      const tool = createReadContextTool(context, 'r1')
      const result = JSON.parse(await exec(tool, { key: 'nope' }))
      expect(result.success).toBe(false)
    })

    it('无参数返回摘要', async () => {
      context.set('a', '1', 'system')
      const tool = createReadContextTool(context, 'r1')
      const result = JSON.parse(await exec(tool, { key: undefined }))
      expect(result.success).toBe(true)
      expect(result.keys).toContain('a')
    })
  })

  describe('write_shared_context', () => {
    it('写入值', async () => {
      const tool = createWriteContextTool(context, 'writer')
      const result = JSON.parse(await exec(tool, { key: 'k', value: 'v' }))
      expect(result.success).toBe(true)
      expect(context.get('k')).toBe('v')
    })
  })

  describe('add_artifact', () => {
    it('添加产物', async () => {
      const tool = createAddArtifactTool(context, 'coder')
      const result = JSON.parse(await exec(tool, { name: 'code.ts', content: 'x=1', type: 'code' }))
      expect(result.success).toBe(true)
      expect(context.getArtifact('code.ts')).toBeDefined()
    })
  })

  describe('get_artifact', () => {
    it('获取产物', async () => {
      context.addArtifact('doc', 'text', 'w', 'document')
      const tool = createGetArtifactTool(context, 'r')
      const result = JSON.parse(await exec(tool, { name: 'doc' }))
      expect(result.success).toBe(true)
      expect(result.artifact.content).toBe('text')
    })

    it('不存在返回错误', async () => {
      const tool = createGetArtifactTool(context, 'r')
      const result = JSON.parse(await exec(tool, { name: 'nope' }))
      expect(result.success).toBe(false)
    })

    it('无参数返回列表', async () => {
      context.addArtifact('a', 'a', 'r1')
      context.addArtifact('b', 'b', 'r2')
      const tool = createGetArtifactTool(context, 'r')
      const result = JSON.parse(await exec(tool, { name: undefined }))
      expect(result.count).toBe(2)
    })
  })

  describe('send_message', () => {
    it('发送消息', async () => {
      const tool = createSendMessageTool(messageBus, 'sender')
      const result = JSON.parse(await exec(tool, { to: 'recv', content: 'hi' }))
      expect(result.success).toBe(true)
      expect(messageBus.getMessagesForRole('recv')).toHaveLength(1)
    })
  })

  describe('get_messages', () => {
    it('获取未读消息', async () => {
      messageBus.send('sender', 'role1', 'msg1')
      const tool = createGetMessagesTool(messageBus, 'role1')
      const result = JSON.parse(await exec(tool, { type: 'unread' }))
      expect(result.count).toBe(1)
      expect(messageBus.getUnreadMessages('role1')).toHaveLength(0)
    })

    it('topic 参数缺失', async () => {
      const tool = createGetMessagesTool(messageBus, 'r')
      const result = JSON.parse(await exec(tool, { type: 'topic' }))
      expect(result.success).toBe(false)
    })
  })

  describe('report_progress', () => {
    it('上报进度', async () => {
      const tool = createReportProgressTool(context, 'worker')
      const result = JSON.parse(await exec(tool, { note: 'done' }))
      expect(result.success).toBe(true)
      expect(context.getProgressNotes()).toHaveLength(1)
    })
  })

  describe('createSwarmTools', () => {
    it('返回 7 个工具', () => {
      const tools = createSwarmTools(context, messageBus, 'r1')
      expect(tools).toHaveLength(7)
    })

    it('包含所有工具名', () => {
      const tools = createSwarmTools(context, messageBus, 'r1')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names = tools.map((t: any) => t.name)
      expect(names).toContain('read_shared_context')
      expect(names).toContain('write_shared_context')
      expect(names).toContain('add_artifact')
      expect(names).toContain('get_artifact')
      expect(names).toContain('send_message')
      expect(names).toContain('get_messages')
      expect(names).toContain('report_progress')
    })
  })
})
