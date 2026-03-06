/**
 * memory-global 数据模型
 *
 * 基于 OpenClaw memory-lancedb 的简化模型
 */

/** 记忆分类 */
export type MemoryCategory = 'preference' | 'decision' | 'entity' | 'fact' | 'lesson' | 'knowledge' | 'other';

/** 记忆条目（存储在 LanceDB 中） */
export interface MemoryEntry extends Record<string, unknown> {
  /** 唯一 ID (UUID) */
  id: string;
  /** 记忆文本内容 */
  text: string;
  /** embedding 向量（由 LanceDB 自动生成） */
  vector: number[];
  /** 重要度评分（1-10，默认 5） */
  importance: number;
  /** 记忆分类 */
  category: MemoryCategory;
  /** 创建时间（Unix 时间戳，毫秒） */
  createdAt: number;
  /** 最后访问时间（Unix 时间戳，毫秒，用于热度计算） */
  lastAccessedAt: number;
  /** 访问次数（用于重要性增强） */
  accessCount: number;
}

/** 检索结果 */
export interface RecallResult {
  /** 记忆条目 */
  entry: MemoryEntry;
  /** 相似度分数（0-1） */
  score: number;
  /** 距离（越小越相似） */
  distance: number;
}
