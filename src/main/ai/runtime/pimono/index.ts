/**
 * Pi-Mono Agent Runtime 模块
 *
 * 基于 pi-coding-agent SDK 的 AgentRuntime 实现。
 *
 * 模块结构：
 *   PiMonoAgentRuntime.ts   — 核心生命周期（initialize/stream/destroy）
 *   PiMonoToolConverter.ts  — 工具转换（ToolDefinition → PiToolDefinition）
 *   PiMonoStreamAdapter.ts  — 流式事件适配（AgentSessionEvent → StreamChunk）
 *   ChunkQueue.ts           — 推送→拉取桥接器
 *   PiMonoBuilder.ts        — 构建器
 *   types.ts                — 类型定义
 */

export { PiMonoAgentRuntime } from './PiMonoAgentRuntime'
export { convertTools } from './PiMonoToolConverter'
export {
  setupEventSubscription,
  stripThinkTags,
  extractToolOutput,
  extractFullText
} from './PiMonoStreamAdapter'
export { ChunkQueue } from './ChunkQueue'
export type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './types'
export type { StreamAdapterCallbacks } from './PiMonoStreamAdapter'
