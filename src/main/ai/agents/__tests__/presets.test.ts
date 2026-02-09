/**
 * Agent 预设配置测试
 *
 * 验证各预设配置结构的正确性
 */
import { describe, it, expect } from 'vitest'
import {
  agentPresets,
  chatAgentPreset,
  codeAgentPreset,
  researchAgentPreset,
  type AgentPresetType
} from '../presets'

describe('Agent Presets', () => {
  describe('预设结构验证', () => {
    it('chat 预设包含必需字段', () => {
      expect(chatAgentPreset.name).toBeDefined()
      expect(typeof chatAgentPreset.name).toBe('string')
      expect(chatAgentPreset.instructions).toBeDefined()
      expect(typeof chatAgentPreset.instructions).toBe('string')
    })

    it('code 预设包含必需字段', () => {
      expect(codeAgentPreset.name).toBeDefined()
      expect(codeAgentPreset.instructions).toBeDefined()
    })

    it('research 预设包含必需字段', () => {
      expect(researchAgentPreset.name).toBeDefined()
      expect(researchAgentPreset.instructions).toBeDefined()
    })
  })

  describe('chat 预设', () => {
    it('名称为 ChatAssistant', () => {
      expect(chatAgentPreset.name).toBe('ChatAssistant')
    })

    it('使用 gpt-4o 模型', () => {
      expect(chatAgentPreset.model).toBe('gpt-4o')
    })

    it('包含助手角色描述', () => {
      expect(chatAgentPreset.instructions).toContain('helpful')
    })
  })

  describe('code 预设', () => {
    it('名称为 CodeAssistant', () => {
      expect(codeAgentPreset.name).toBe('CodeAssistant')
    })

    it('使用 gpt-4o 模型', () => {
      expect(codeAgentPreset.model).toBe('gpt-4o')
    })

    it('包含 TypeScript 描述', () => {
      expect(codeAgentPreset.instructions).toContain('TypeScript')
    })
  })

  describe('research 预设', () => {
    it('名称为 ResearchAssistant', () => {
      expect(researchAgentPreset.name).toBe('ResearchAssistant')
    })

    it('包含研究相关描述', () => {
      expect(researchAgentPreset.instructions).toContain('research')
    })
  })

  describe('agentPresets 映射', () => {
    it('包含三个预设键', () => {
      const keys = Object.keys(agentPresets)
      expect(keys).toEqual(['chat', 'code', 'research'])
    })

    it('每个键映射到正确的预设', () => {
      expect(agentPresets.chat).toBe(chatAgentPreset)
      expect(agentPresets.code).toBe(codeAgentPreset)
      expect(agentPresets.research).toBe(researchAgentPreset)
    })

    it('AgentPresetType 类型覆盖所有键', () => {
      const keys: AgentPresetType[] = ['chat', 'code', 'research']
      keys.forEach((key) => {
        expect(agentPresets[key]).toBeDefined()
      })
    })
  })
})
