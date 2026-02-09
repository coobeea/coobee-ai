/**
 * VerificationGate 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VerificationGate } from '../VerificationGate'
import type { VerificationRule } from '../types'

describe('VerificationGate', () => {
  let gate: VerificationGate

  const mockSessionManager = {
    writeVerificationCheck: vi.fn().mockResolvedValue(undefined),
    appendVerificationIssues: vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    gate = new VerificationGate(mockSessionManager, 'session-1')
  })

  describe('verify', () => {
    it('所有规则通过', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'rule1',
          name: 'Format check',
          type: 'format',
          execute: vi.fn().mockResolvedValue({ passed: true, ruleId: 'rule1', issues: [] })
        }
      ]

      const { passed, results } = await gate.verify('task-1', 'output', rules)
      expect(passed).toBe(true)
      expect(results).toHaveLength(1)
    })

    it('规则失败时返回 passed: false', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'rule1',
          name: 'Content check',
          type: 'content',
          execute: vi.fn().mockResolvedValue({
            passed: false,
            ruleId: 'rule1',
            issues: [{ severity: 'error', code: 'MISSING_CONTENT', message: 'Missing content' }]
          })
        }
      ]

      const { passed, results: _results } = await gate.verify('task-1', 'bad output', rules)
      expect(passed).toBe(false)
      expect(mockSessionManager.appendVerificationIssues).toHaveBeenCalled()
    })

    it('无规则时通过', async () => {
      const { passed } = await gate.verify('task-1', 'anything')
      expect(passed).toBe(true)
    })

    it('写入验证记录', async () => {
      const rules: VerificationRule[] = [
        {
          id: 'r1',
          name: 'test',
          type: 'format',
          execute: vi.fn().mockResolvedValue({ passed: true, ruleId: 'r1', issues: [] })
        }
      ]

      await gate.verify('task-1', 'output', rules)
      expect(mockSessionManager.writeVerificationCheck).toHaveBeenCalledWith(
        'task-1',
        'r1',
        expect.anything()
      )
    })
  })

  describe('generateFixSuggestions', () => {
    it('生成修复建议', async () => {
      const suggestions = await gate.generateFixSuggestions([
        { severity: 'error', code: 'MISSING_HEADER', message: 'Missing header' },
        { severity: 'warning', code: 'TYPO', message: 'Typo found' }
      ])

      expect(suggestions).toContain('ERROR')
      expect(suggestions).toContain('Missing header')
      expect(suggestions).toContain('WARNING')
      expect(suggestions).toContain('Typo found')
    })
  })
})
