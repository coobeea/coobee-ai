/**
 * 工具策略全面测试
 *
 * 覆盖：
 *   - isToolAllowed: 精确匹配、glob 模式、大小写不敏感、deny 优先、边界情况
 *   - resolveToolPolicy: 默认值、保留原始配置
 *   - formatToolBlockedMessage: deny/allow 原因生成
 *   - 复杂组合策略场景
 */
import { describe, it, expect } from 'vitest'
import { isToolAllowed, resolveToolPolicy, formatToolBlockedMessage } from '../tool-policy'

// ========== isToolAllowed ==========

describe('isToolAllowed', () => {
  // --- 无策略 / 空策略 ---

  describe('无策略 / 空策略', () => {
    it('无策略时全部允许', () => {
      expect(isToolAllowed('bash')).toBe(true)
      expect(isToolAllowed('read')).toBe(true)
      expect(isToolAllowed('any_tool_name')).toBe(true)
    })

    it('undefined 策略允许所有', () => {
      expect(isToolAllowed('bash', undefined)).toBe(true)
    })

    it('空对象策略允许所有', () => {
      expect(isToolAllowed('bash', {})).toBe(true)
      expect(isToolAllowed('read', {})).toBe(true)
    })

    it('空数组 allow 和 deny 允许所有', () => {
      expect(isToolAllowed('bash', { allow: [], deny: [] })).toBe(true)
    })

    it('只有空 allow 列表允许所有', () => {
      expect(isToolAllowed('bash', { allow: [] })).toBe(true)
    })

    it('只有空 deny 列表允许所有', () => {
      expect(isToolAllowed('bash', { deny: [] })).toBe(true)
    })
  })

  // --- deny 精确匹配 ---

  describe('deny 精确匹配', () => {
    it('deny 精确匹配拒绝', () => {
      const policy = { deny: ['bash'] }
      expect(isToolAllowed('bash', policy)).toBe(false)
      expect(isToolAllowed('read', policy)).toBe(true)
    })

    it('deny 多个精确匹配', () => {
      const policy = { deny: ['bash', 'exec', 'rm'] }
      expect(isToolAllowed('bash', policy)).toBe(false)
      expect(isToolAllowed('exec', policy)).toBe(false)
      expect(isToolAllowed('rm', policy)).toBe(false)
      expect(isToolAllowed('read', policy)).toBe(true)
    })

    it('deny 大小写不敏感', () => {
      expect(isToolAllowed('BASH', { deny: ['bash'] })).toBe(false)
      expect(isToolAllowed('Bash', { deny: ['bash'] })).toBe(false)
      expect(isToolAllowed('bAsH', { deny: ['bash'] })).toBe(false)
      expect(isToolAllowed('bash', { deny: ['BASH'] })).toBe(false)
    })
  })

  // --- deny glob 模式 ---

  describe('deny glob 模式', () => {
    it('deny * 匹配全部', () => {
      expect(isToolAllowed('anything', { deny: ['*'] })).toBe(false)
      expect(isToolAllowed('bash', { deny: ['*'] })).toBe(false)
    })

    it('deny 前缀通配 file_*', () => {
      const policy = { deny: ['file_*'] }
      expect(isToolAllowed('file_read', policy)).toBe(false)
      expect(isToolAllowed('file_write', policy)).toBe(false)
      expect(isToolAllowed('file_', policy)).toBe(false)
      expect(isToolAllowed('bash', policy)).toBe(true)
      expect(isToolAllowed('file', policy)).toBe(true)
    })

    it('deny 后缀通配 *_exec', () => {
      const policy = { deny: ['*_exec'] }
      expect(isToolAllowed('cmd_exec', policy)).toBe(false)
      expect(isToolAllowed('shell_exec', policy)).toBe(false)
      expect(isToolAllowed('exec', policy)).toBe(true)
      expect(isToolAllowed('read', policy)).toBe(true)
    })

    it('deny 中间通配 file_*_v2', () => {
      const policy = { deny: ['file_*_v2'] }
      expect(isToolAllowed('file_read_v2', policy)).toBe(false)
      expect(isToolAllowed('file_write_v2', policy)).toBe(false)
      expect(isToolAllowed('file_read_v1', policy)).toBe(true)
      expect(isToolAllowed('file_read', policy)).toBe(true)
    })
  })

  // --- allow 精确匹配 ---

  describe('allow 精确匹配', () => {
    it('allow 列表过滤：只有列表内工具被允许', () => {
      const policy = { allow: ['read', 'write'] }
      expect(isToolAllowed('read', policy)).toBe(true)
      expect(isToolAllowed('write', policy)).toBe(true)
      expect(isToolAllowed('bash', policy)).toBe(false)
      expect(isToolAllowed('edit', policy)).toBe(false)
    })

    it('allow 只有单个工具', () => {
      const policy = { allow: ['read'] }
      expect(isToolAllowed('read', policy)).toBe(true)
      expect(isToolAllowed('write', policy)).toBe(false)
    })

    it('allow 大小写不敏感', () => {
      const policy = { allow: ['read'] }
      expect(isToolAllowed('READ', policy)).toBe(true)
      expect(isToolAllowed('Read', policy)).toBe(true)
    })
  })

  // --- allow glob 模式 ---

  describe('allow glob 模式', () => {
    it('allow * 允许全部', () => {
      const policy = { allow: ['*'] }
      expect(isToolAllowed('anything', policy)).toBe(true)
      expect(isToolAllowed('bash', policy)).toBe(true)
    })

    it('allow 前缀通配 file_*', () => {
      const policy = { allow: ['file_*', 'read'] }
      expect(isToolAllowed('file_read', policy)).toBe(true)
      expect(isToolAllowed('file_write', policy)).toBe(true)
      expect(isToolAllowed('read', policy)).toBe(true)
      expect(isToolAllowed('bash', policy)).toBe(false)
    })

    it('allow 后缀通配 *_search', () => {
      const policy = { allow: ['*_search'] }
      expect(isToolAllowed('web_search', policy)).toBe(true)
      expect(isToolAllowed('file_search', policy)).toBe(true)
      expect(isToolAllowed('read', policy)).toBe(false)
    })
  })

  // --- deny 优先于 allow ---

  describe('deny 优先于 allow', () => {
    it('deny 精确匹配优先于 allow 通配', () => {
      const policy = { allow: ['*'], deny: ['bash'] }
      expect(isToolAllowed('read', policy)).toBe(true)
      expect(isToolAllowed('bash', policy)).toBe(false)
    })

    it('deny glob 优先于 allow glob', () => {
      const policy = { allow: ['file_*'], deny: ['file_delete'] }
      expect(isToolAllowed('file_read', policy)).toBe(true)
      expect(isToolAllowed('file_delete', policy)).toBe(false)
    })

    it('deny * 即使 allow * 也全部拒绝', () => {
      const policy = { allow: ['*'], deny: ['*'] }
      expect(isToolAllowed('read', policy)).toBe(false)
      expect(isToolAllowed('bash', policy)).toBe(false)
    })

    it('deny 精确匹配优先于 allow 精确匹配', () => {
      const policy = { allow: ['bash'], deny: ['bash'] }
      expect(isToolAllowed('bash', policy)).toBe(false)
    })
  })

  // --- 使用已解析的策略 (ResolvedToolPolicy) ---

  describe('使用 ResolvedToolPolicy', () => {
    it('已解析策略正常工作', () => {
      const resolved = resolveToolPolicy({ allow: ['read', 'write'], deny: ['bash'] })
      expect(isToolAllowed('read', resolved)).toBe(true)
      expect(isToolAllowed('bash', resolved)).toBe(false)
      expect(isToolAllowed('edit', resolved)).toBe(false)
    })
  })

  // --- 边界情况 ---

  describe('边界情况', () => {
    it('空字符串工具名', () => {
      expect(isToolAllowed('', { allow: ['read'] })).toBe(false)
      expect(isToolAllowed('', { deny: [] })).toBe(true)
    })

    it('带空格的工具名会 trim', () => {
      expect(isToolAllowed(' bash ', { deny: ['bash'] })).toBe(false)
    })

    it('deny 列表中包含空字符串被忽略', () => {
      const policy = { deny: ['', 'bash'] }
      expect(isToolAllowed('bash', policy)).toBe(false)
      expect(isToolAllowed('read', policy)).toBe(true)
    })
  })
})

// ========== resolveToolPolicy ==========

describe('resolveToolPolicy', () => {
  it('undefined 返回空策略', () => {
    const result = resolveToolPolicy(undefined)
    expect(result.allow).toEqual([])
    expect(result.deny).toEqual([])
  })

  it('空对象返回空策略', () => {
    const result = resolveToolPolicy({})
    expect(result.allow).toEqual([])
    expect(result.deny).toEqual([])
  })

  it('只有 allow', () => {
    const result = resolveToolPolicy({ allow: ['read', 'write'] })
    expect(result.allow).toEqual(['read', 'write'])
    expect(result.deny).toEqual([])
  })

  it('只有 deny', () => {
    const result = resolveToolPolicy({ deny: ['bash'] })
    expect(result.allow).toEqual([])
    expect(result.deny).toEqual(['bash'])
  })

  it('同时有 allow 和 deny', () => {
    const result = resolveToolPolicy({ allow: ['read'], deny: ['bash'] })
    expect(result.allow).toEqual(['read'])
    expect(result.deny).toEqual(['bash'])
  })

  it('保留 glob 模式字符串', () => {
    const result = resolveToolPolicy({ allow: ['file_*'], deny: ['*_delete'] })
    expect(result.allow).toEqual(['file_*'])
    expect(result.deny).toEqual(['*_delete'])
  })
})

// ========== formatToolBlockedMessage ==========

describe('formatToolBlockedMessage', () => {
  it('deny 拦截消息包含 deny 原因', () => {
    const msg = formatToolBlockedMessage('bash', { allow: [], deny: ['bash'] })
    expect(msg).toContain('bash')
    expect(msg).toContain('blocked')
    expect(msg).toContain('deny')
  })

  it('allow 拦截消息包含 allow 原因', () => {
    const msg = formatToolBlockedMessage('exec', { allow: ['read', 'write'], deny: [] })
    expect(msg).toContain('exec')
    expect(msg).toContain('blocked')
    expect(msg).toContain('allow')
  })

  it('同时被 deny 和不在 allow 中', () => {
    const msg = formatToolBlockedMessage('bash', { allow: ['read'], deny: ['bash'] })
    expect(msg).toContain('bash')
    expect(msg).toContain('blocked')
    expect(msg).toContain('deny')
  })

  it('消息格式正确包含工具名', () => {
    const msg = formatToolBlockedMessage('dangerous_tool', { allow: ['safe_tool'], deny: [] })
    expect(msg).toContain('dangerous_tool')
    expect(msg).toContain('blocked by sandbox policy')
  })
})
