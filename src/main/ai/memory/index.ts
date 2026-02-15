/**
 * 记忆系统导出
 *
 * ⚠️ **设计储备（Design Reserve）** — 本模块目前未接入产品代码。
 *
 * 当前产品的记忆能力由 `tools/builtin/memory.ts`（文件系统）提供。
 * 本模块包含更完善的多层记忆架构实现（Session / Short-Term / Working / Long-Term），
 * 计划在后续版本中替代或增强文件系统方案：
 *   - LongTermMemoryStore → 作为 memory 工具的后端（SQLite + embedding + importance）
 *   - ShortTermMemory → 配合会话压缩使用
 *   - WorkingMemoryStore → 多 Agent 编排时的共享状态
 *
 * 保留理由：接口设计已稳定，测试覆盖完整，短期内将接入。
 *
 * 包含四类记忆：Session Memory、Short-Term Memory、Working Memory、Long-Term Memory
 */

// 类型定义
export type { Message, SessionState, Checkpoint, LongTermMemoryEntry, MemoryQuery } from './types'
export { LongTermMemoryType } from './types'

// Session Memory（会话记忆 - JSONL 持久化）
export { SessionMemoryStore } from './SessionMemoryStore'

// Short-Term Memory（短期记忆 - 上下文窗口）
export { TrimmingSession, SummarizingSession } from './ShortTermMemory'

// Working Memory / State（工作记忆 / 状态）
export { WorkingMemoryStore } from './WorkingMemoryStore'

// Long-Term Memory（长期记忆 - 知识库）
export { LongTermMemoryStore } from './LongTermMemoryStore'

// SDK Session 适配器
export { SessionAdapter, createSessionAdapter } from './SessionAdapter'
