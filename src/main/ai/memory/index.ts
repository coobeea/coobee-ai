/**
 * 记忆系统导出
 *
 * 当前产品记忆能力：
 *   - 文件驱动：`tools/builtin/memory.ts`（MEMORY.md + memory/*.md）
 *   - 自动注入/提取：`extensions/memory-auto/`
 *   - 结构化记忆：`structured/` 子模块（MemU 模式 Resource→Item→Category）
 *
 * 本模块提供会话级别的记忆管理：
 *   - SessionMemoryStore — JSONL 持久化
 *   - ShortTermMemory / TrimmingSession — 上下文窗口裁剪
 *   - WorkingMemoryStore — 多 Agent 编排时的共享状态
 *   - SessionAdapter — SDK Session 适配器
 */

// 类型定义
export type { Message, SessionState, Checkpoint } from './types';

// Session Memory（会话记忆 - JSONL 持久化）
export { SessionMemoryStore } from './SessionMemoryStore';

// Short-Term Memory（短期记忆 - 上下文窗口）
export { TrimmingSession } from './ShortTermMemory';

// Working Memory / State（工作记忆 / 状态）
export { WorkingMemoryStore } from './WorkingMemoryStore';

// SDK Session 适配器
export { SessionAdapter, createSessionAdapter } from './SessionAdapter';
