/**
 * OpenAI Agents SDK 运行时实现
 *
 * 导出 OpenAI 特有的 AgentRuntime 实现及相关组件。
 */

// 运行时实现
export { OpenAIAgentRuntime } from './OpenAIAgentRuntime';

// Session 管理
export { FileSession } from './FileSession';
export { SessionCompressor } from './SessionCompressor';

// Think 标签解析器
export { ThinkTagParser, stripThinkTags } from './ThinkTagParser';
export type { ThinkTagCallbacks } from './ThinkTagParser';

// Token 计数工具
export { countTokens, countItemTokens, countItemsTokens, isWithinLimit, formatTokens } from './tokenCounter';

// OpenAI 特有类型
export type {
  OpenAIAgentRuntimeOptions,
  OpenAIApprovalItem,
  SessionItem,
  SummaryMeta,
  SessionCompressionOptions,
  CompressionResult,
  ContextSnapshot
} from './types';
