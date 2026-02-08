/**
 * Agent 预设配置
 * 基于 @openai/agents SDK 的标准 Agent 配置
 */

/**
 * Agent 预设配置类型
 * 简化的配置，只包含必要字段
 */
export interface AgentPreset {
  name: string
  instructions: string
  model?: string
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
  model: 'gpt-4o'
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
  model: 'gpt-4o'
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
  model: 'gpt-4o'
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
