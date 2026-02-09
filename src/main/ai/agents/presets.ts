/**
 * Agent 预设配置
 * 基于 @openai/agents SDK 的标准 Agent 配置
 *
 * SDK 合规改进：
 * - 引入 modelSettings 支持 temperature、topP、toolChoice 等高级参数
 */

import type { ModelSettings } from '@openai/agents'

/**
 * Agent 预设配置类型
 *
 * SDK 改进：增加 modelSettings 字段
 * 支持 temperature、topP、frequencyPenalty、presencePenalty、
 * toolChoice、parallelToolCalls、maxTokens 等参数
 */
export interface AgentPreset {
  name: string
  instructions: string
  model?: string
  /** SDK modelSettings: 精细控制模型行为参数 */
  modelSettings?: ModelSettings
}

/**
 * 聊天助手 Agent 配置
 */
export const chatAgentPreset: AgentPreset = {
  name: 'ChatAssistant',
  instructions: `You are a helpful AI assistant in the coobee-ai application.
  
Your responsibilities:
- Answer user questions clearly and concisely
- Provide helpful suggestions and recommendations
- Maintain a friendly and professional tone
- Use tools when necessary to provide accurate information`,
  model: 'gpt-4o',
  modelSettings: {
    temperature: 0.7,
    topP: 0.9,
    toolChoice: 'auto'
  }
}

/**
 * 代码助手 Agent 配置
 */
export const codeAgentPreset: AgentPreset = {
  name: 'CodeAssistant',
  instructions: `You are an expert programming assistant specializing in TypeScript, Vue 3, and Electron development.

Your responsibilities:
- Write clean, well-documented code
- Follow project coding standards
- Provide code reviews and suggestions
- Help debug issues
- Explain complex technical concepts clearly

Tech stack:
- TypeScript
- Vue 3 (Composition API)
- Electron
- Tailwind CSS
- OpenAI Agents SDK`,
  model: 'gpt-4o',
  modelSettings: {
    temperature: 0.3, // 代码生成需要更确定性的输出
    topP: 0.85,
    toolChoice: 'auto'
  }
}

/**
 * 研究助手 Agent 配置
 */
export const researchAgentPreset: AgentPreset = {
  name: 'ResearchAssistant',
  instructions: `You are a research assistant that helps users find and analyze information.

Your responsibilities:
- Search for relevant information using available tools
- Synthesize information from multiple sources
- Provide well-structured summaries
- Cite sources when possible
- Identify key insights and patterns`,
  model: 'gpt-4o',
  modelSettings: {
    temperature: 0.5,
    topP: 0.9,
    toolChoice: 'auto',
    parallelToolCalls: true // 研究任务可并行调用多个搜索工具
  }
}

/**
 * 所有预设配置
 */
export const agentPresets = {
  chat: chatAgentPreset,
  code: codeAgentPreset,
  research: researchAgentPreset
} as const

/**
 * Agent 预设类型
 */
export type AgentPresetType = keyof typeof agentPresets
