/**
 * ThinkTagParser 单元测试
 *
 * 测试流式 <think> 标签解析器的所有边界场景：
 * - 完整标签在单个 delta 中
 * - 标签跨 delta 拆分
 * - 标签和正文混合
 * - 大小写不敏感
 * - 嵌套 <think>
 * - 无 <think> 标签（纯文本）
 * - 多个 <think> 块
 * - flush 未完成的缓冲
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ThinkTagParser, stripThinkTags, type ThinkTagCallbacks } from '../ThinkTagParser'

/** 测试辅助：收集回调输出 */
interface CollectedEvents {
  texts: string[]
  reasonings: string[]
  starts: number
  dones: number
}

function createCollector(): { events: CollectedEvents; callbacks: ThinkTagCallbacks } {
  const events: CollectedEvents = {
    texts: [],
    reasonings: [],
    starts: 0,
    dones: 0
  }
  const callbacks: ThinkTagCallbacks = {
    onText: (text) => events.texts.push(text),
    onReasoning: (text) => events.reasonings.push(text),
    onReasoningStart: () => events.starts++,
    onReasoningDone: () => events.dones++
  }
  return { events, callbacks }
}

describe('ThinkTagParser', () => {
  let collector: ReturnType<typeof createCollector>
  let parser: ThinkTagParser

  beforeEach(() => {
    collector = createCollector()
    parser = new ThinkTagParser(collector.callbacks)
  })

  // ===== 基本场景 =====

  describe('基本场景', () => {
    it('纯文本（无标签）', () => {
      parser.feed('Hello, world!')
      parser.flush()

      expect(collector.events.texts.join('')).toBe('Hello, world!')
      expect(collector.events.reasonings).toHaveLength(0)
      expect(collector.events.starts).toBe(0)
      expect(collector.events.dones).toBe(0)
    })

    it('完整 <think> 在单个 delta 中', () => {
      parser.feed('<think>用户在思考</think>这是正文')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('用户在思考')
      expect(collector.events.texts.join('')).toBe('这是正文')
    })

    it('只有 <think> 块（无正文）', () => {
      parser.feed('<think>纯推理</think>')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('纯推理')
      expect(collector.events.texts.join('')).toBe('')
    })

    it('前后都有正文', () => {
      parser.feed('前面的文本<think>推理</think>后面的文本')
      parser.flush()

      expect(collector.events.texts.join('')).toBe('前面的文本后面的文本')
      expect(collector.events.reasonings.join('')).toBe('推理')
    })
  })

  // ===== 跨 delta 拆分 =====

  describe('标签跨 delta 拆分', () => {
    it('<think> 标签拆分为两个 delta', () => {
      parser.feed('<thi')
      parser.feed('nk>推理内容')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('推理内容')
    })

    it('</think> 标签拆分为两个 delta', () => {
      parser.feed('<think>推理内容</thi')
      parser.feed('nk>正文')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('推理内容')
      expect(collector.events.texts.join('')).toBe('正文')
    })

    it('<think> 标签拆分为三个 delta', () => {
      parser.feed('<th')
      parser.feed('in')
      parser.feed('k>content')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('content')
    })

    it('单字符逐个喂入', () => {
      const input = '<think>abc</think>xyz'
      for (const ch of input) {
        parser.feed(ch)
      }
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('abc')
      expect(collector.events.texts.join('')).toBe('xyz')
    })
  })

  // ===== 真实日志场景 =====

  describe('真实日志场景（MiniMax 模型）', () => {
    it('场景1：简单问答', () => {
      // #5 text:delta → "<think>\n用户问"
      parser.feed('<think>\n用户问')
      // #6 text:delta → "1+1等于几，要求用一个数字回答。\n</think>\n\n2"
      parser.feed('1+1等于几，要求用一个数字回答。\n</think>\n\n2')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('\n用户问1+1等于几，要求用一个数字回答。\n')
      expect(collector.events.texts.join('')).toBe('\n\n2')
    })

    it('场景2：工具调用', () => {
      // #5 text:delta → "<think>\n用户要求"
      parser.feed('<think>\n用户要求')
      // #6 text:delta → "计算 17 + 28...add_numbers"
      parser.feed('计算 17 + 28...add_numbers')
      // #7 text:delta → "...\n</think>\n\n我来帮您"
      parser.feed('...\n</think>\n\n我来帮您')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('\n用户要求计算 17 + 28...add_numbers...\n')
      expect(collector.events.texts.join('')).toBe('\n\n我来帮您')
    })

    it('多轮 <think> 块（第二轮答案）', () => {
      // Turn 2 也有 <think>
      parser.feed('<think>\n好的，add_numbers')
      parser.feed(' 返回了 45')
      parser.feed('\n</think>\n\n17 + 28 = 45')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('\n好的，add_numbers 返回了 45\n')
      expect(collector.events.texts.join('')).toBe('\n\n17 + 28 = 45')
    })
  })

  // ===== 大小写 =====

  describe('大小写不敏感', () => {
    it('<Think>...</Think>', () => {
      parser.feed('<Think>推理</Think>正文')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('推理')
      expect(collector.events.texts.join('')).toBe('正文')
    })

    it('<THINK>...</THINK>', () => {
      parser.feed('<THINK>推理</THINK>正文')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(1)
      expect(collector.events.reasonings.join('')).toBe('推理')
      expect(collector.events.texts.join('')).toBe('正文')
    })
  })

  // ===== 边界情况 =====

  describe('边界情况', () => {
    it('类似但不是标签的文本 <thinking>', () => {
      parser.feed('<thinking>这不是标签</thinking>')
      parser.flush()

      // <thinking> 不匹配 <think>，应作为纯文本输出
      expect(collector.events.starts).toBe(0)
      expect(collector.events.texts.join('')).toBe('<thinking>这不是标签</thinking>')
    })

    it('尖括号但不是标签 <div>', () => {
      parser.feed('content with <div> tags')
      parser.flush()

      expect(collector.events.starts).toBe(0)
      expect(collector.events.texts.join('')).toBe('content with <div> tags')
    })

    it('空输入', () => {
      parser.feed('')
      parser.flush()

      expect(collector.events.texts).toHaveLength(0)
      expect(collector.events.reasonings).toHaveLength(0)
    })

    it('flush 时有未完成的标签缓冲', () => {
      parser.feed('text <thi')
      // 不继续喂入，直接 flush
      parser.flush()

      // '<thi' 不是完整标签，应作为普通文本输出
      expect(collector.events.texts.join('')).toBe('text <thi')
      expect(collector.events.starts).toBe(0)
    })

    it('flush 时有未关闭的 <think>', () => {
      parser.feed('<think>未关闭的推理')
      parser.flush()

      expect(collector.events.starts).toBe(1)
      expect(collector.events.dones).toBe(0) // 未关闭
      expect(collector.events.reasonings.join('')).toBe('未关闭的推理')
    })

    it('多个 <think> 块', () => {
      parser.feed('<think>推理1</think>文本1<think>推理2</think>文本2')
      parser.flush()

      expect(collector.events.starts).toBe(2)
      expect(collector.events.dones).toBe(2)
      expect(collector.events.reasonings.join('')).toBe('推理1推理2')
      expect(collector.events.texts.join('')).toBe('文本1文本2')
    })

    it('NORMAL 状态下遇到 </think>（当作文本）', () => {
      parser.feed('text </think> more text')
      parser.flush()

      expect(collector.events.starts).toBe(0)
      expect(collector.events.dones).toBe(0)
      expect(collector.events.texts.join('')).toBe('text </think> more text')
    })
  })

  // ===== isInThinking =====

  describe('isInThinking', () => {
    it('初始为 false', () => {
      expect(parser.isInThinking).toBe(false)
    })

    it('进入 <think> 后为 true', () => {
      parser.feed('<think>reasoning')
      expect(parser.isInThinking).toBe(true)
    })

    it('关闭 </think> 后为 false', () => {
      parser.feed('<think>reasoning</think>')
      expect(parser.isInThinking).toBe(false)
    })
  })

  // ===== reset =====

  describe('reset', () => {
    it('重置后回到初始状态', () => {
      parser.feed('<think>something')
      expect(parser.isInThinking).toBe(true)

      parser.reset()
      expect(parser.isInThinking).toBe(false)

      // 重置后当作新的流
      parser.feed('new text')
      parser.flush()

      // 只看 reset 之后的输出
      // 注意：reset 前的 'something' 已经通过回调输出了
      const allTexts = collector.events.texts.join('')
      expect(allTexts).toContain('new text')
    })
  })
})

// ===== stripThinkTags =====

describe('stripThinkTags', () => {
  it('移除单个 <think> 块', () => {
    expect(stripThinkTags('<think>推理</think>正文')).toBe('正文')
  })

  it('移除多个 <think> 块', () => {
    expect(stripThinkTags('<think>推理1</think>文本1<think>推理2</think>文本2')).toBe('文本1文本2')
  })

  it('移除多行 <think> 块', () => {
    const text = '<think>\n多行\n推理\n</think>\n\n正文'
    expect(stripThinkTags(text)).toBe('正文')
  })

  it('大小写不敏感', () => {
    expect(stripThinkTags('<Think>推理</Think>正文')).toBe('正文')
    expect(stripThinkTags('<THINK>推理</THINK>正文')).toBe('正文')
  })

  it('空字符串', () => {
    expect(stripThinkTags('')).toBe('')
  })

  it('无标签', () => {
    expect(stripThinkTags('hello world')).toBe('hello world')
  })

  it('null/undefined', () => {
    expect(stripThinkTags(null as unknown as string)).toBe('')
    expect(stripThinkTags(undefined as unknown as string)).toBe('')
  })
})
