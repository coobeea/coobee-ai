/**
 * memory-smart 数据模型
 */

/** 记忆分类（维度） */
export type MemoryCategory = 'preference' | 'decision' | 'entity' | 'fact' | 'lesson' | 'knowledge';

/** 所有分类列表 */
export const ALL_CATEGORIES: MemoryCategory[] = ['preference', 'decision', 'lesson', 'entity', 'knowledge', 'fact'];

/** LLM 分类结果 */
export interface ClassificationResult {
  /** 是否值得记住 */
  shouldRemember: boolean;
  /** 记忆分类 */
  category: MemoryCategory;
  /** 重要度（1-10） */
  importance: number;
  /** 摘要（不超过 20 字） */
  summary: string;
  /** 关键词列表 */
  keywords: string[];
  /** 详细记忆描述（2-3 句话） */
  memory: string;
  /** 分类原因（调试用） */
  reason?: string;
}

/** 记忆条目 */
export interface MemoryEntry {
  /** 唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: string;
  /** 摘要 */
  summary: string;
  /** 重要度 */
  importance: number;
  /** 分类 */
  category: MemoryCategory;
  /** 关键词 */
  keywords: string[];
  /** Agent 输出内容 */
  content: string;
  /** 记忆提取 */
  memory: string;
}

/** 索引条目（索引文件中的一行） */
export interface IndexEntry {
  /** 记忆 ID */
  id: string;
  /** 日期 */
  date: string;
  /** 摘要 */
  summary: string;
  /** 重要度 */
  importance: number;
  /** 关键词 */
  keywords: string[];
  /** 详细描述 */
  description: string;
  /** 内容文件路径 */
  path: string;
}
