/**
 * AbstractAgentRuntime 单元测试
 *
 * 测试 P1 提取的基类默认实现：
 * - run() 消费 stream() 收集结果
 * - runStream(onChunk) 回调模式
 * - HITL 默认 throw
 * - 工具函数：createRuntimeLogger、stripThinkTags、generateRuntimeId
 */
import { describe, it, expect, vi } from 'vitest'

// Mock logger for createRuntimeLogger
vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

import {
  AbstractAgentRuntime,
  createRuntimeLogger,
  stripThinkTags,
  generateRuntimeId
} from '../AbstractAgentRuntime'
import type {
  AgentRuntimeOptions,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo
} from '../types'

// ========== 测试用具体子类 ==========

class MockRuntime extends AbstractAgentRuntime {
  readonly type = 'agent' as const
  readonly id = 'mock-1'
  readonly name = 'MockAgent'
  readonly options: AgentRuntimeOptions = { name: 'MockAgent', instructions: 'test' }
  readonly interrupted = false
  readonly supportsHITL = false

  private _chunks: StreamChunk[]

  constructor(
    chunks: StreamChunk[],
    private result: ExecutionResult
  ) {
    super()
    this._chunks = chunks
  }

  async initialize(): Promise<void> {
    // no-op for mock
  }
  async destroy(): Promise<void> {
    // no-op for mock
  }

  protected async *doStream(
    _input: string,
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    for (const chunk of this._chunks) {
      yield chunk
    }
    return this.result
  }

  async getSession(): Promise<SessionInfo> {
    return {
      sessionId: 'mock-session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0
    }
  }

  async clearSession(): Promise<void> {
    // no-op for mock
  }
}

// ========== 测试 ==========

describe('AbstractAgentRuntime', () => {
  const mockResult: ExecutionResult = {
    output: 'hello world',
    duration: 100
  }

  const mockChunks: StreamChunk[] = [
    { type: 'run:start', content: '' },
    { type: 'text:delta', content: 'hello', data: { delta: 'hello' } },
    { type: 'text:delta', content: ' world', data: { delta: ' world' } },
    { type: 'run:done', content: '' }
  ]

  describe('run() 默认实现', () => {
    it('消费 stream() 并返回最终结果', async () => {
      const runtime = new MockRuntime(mockChunks, mockResult)
      const result = await runtime.run('test input')

      expect(result.output).toBe('hello world')
      expect(result.duration).toBe(100)
    })
  })

  describe('runStream() 默认实现', () => {
    it('通过回调转发所有 chunk 并返回结果', async () => {
      const runtime = new MockRuntime(mockChunks, mockResult)
      const collected: StreamChunk[] = []

      const result = await runtime.runStream('test', {}, (chunk) => collected.push(chunk))

      expect(collected).toHaveLength(4)
      expect(collected[0].type).toBe('run:start')
      expect(collected[1].type).toBe('text:delta')
      expect(collected[3].type).toBe('run:done')
      expect(result.output).toBe('hello world')
    })
  })

  describe('HITL 默认实现', () => {
    it('approveToolCall 抛出错误', () => {
      const runtime = new MockRuntime([], mockResult)
      expect(() => runtime.approveToolCall(0)).toThrow('MockRuntime does not support')
    })

    it('rejectToolCall 抛出错误', () => {
      const runtime = new MockRuntime([], mockResult)
      expect(() => runtime.rejectToolCall(0)).toThrow('MockRuntime does not support')
    })

    it('resumeStream 抛出错误', async () => {
      const runtime = new MockRuntime([], mockResult)
      const gen = runtime.resumeStream()
      await expect(gen.next()).rejects.toThrow('MockRuntime does not support')
    })
  })
})

// ========== 工具函数测试 ==========

describe('createRuntimeLogger', () => {
  it('返回具有 info/warn/error/debug 方法的 logger', () => {
    const logger = createRuntimeLogger('test-module')

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })
})

describe('stripThinkTags', () => {
  it('去除 <think>...</think> 标签', () => {
    const text = '<think>内部思考内容</think>这是正文'
    expect(stripThinkTags(text)).toBe('这是正文')
  })

  it('去除多个 <think> 块', () => {
    const text = '<think>思考1</think>正文<think>思考2</think>结尾'
    expect(stripThinkTags(text)).toBe('正文结尾')
  })

  it('处理跨行 <think> 内容', () => {
    const text = '<think>\n这是\n多行\n思考\n</think>\n正文内容'
    expect(stripThinkTags(text)).toBe('正文内容')
  })

  it('空字符串返回空', () => {
    expect(stripThinkTags('')).toBe('')
  })

  it('没有 think 标签时返回原文', () => {
    expect(stripThinkTags('hello world')).toBe('hello world')
  })
})

describe('generateRuntimeId', () => {
  it('使用指定前缀生成 ID', () => {
    const id = generateRuntimeId('agent')
    expect(id).toMatch(/^agent-\d+-[a-z0-9]+$/)
  })

  it('每次生成不同的 ID', () => {
    const id1 = generateRuntimeId('test')
    const id2 = generateRuntimeId('test')
    expect(id1).not.toBe(id2)
  })
})
