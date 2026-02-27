/**
 * 结构化记忆系统 — 数据模型
 *
 * 三层数据模型：Resource → MemoryItem → MemoryCategory
 * 参考 memU 的设计，适配 coobee-ai 的 TypeScript + Electron 技术栈。
 */

import { createHash, randomUUID } from 'node:crypto';

// ==================== 记忆类型 ====================

export type MemoryType = 'profile' | 'event' | 'knowledge' | 'behavior' | 'skill' | 'tool';

export const MEMORY_TYPES: readonly MemoryType[] = [
  'profile',
  'event',
  'knowledge',
  'behavior',
  'skill',
  'tool'
] as const;

// ==================== 默认分类 ====================

export interface CategoryDefinition {
  name: string;
  description: string;
}

export const DEFAULT_CATEGORIES: readonly CategoryDefinition[] = [
  { name: 'personal_info', description: '基本信息（姓名、年龄、职业等）' },
  { name: 'preferences', description: '偏好（喜好、厌恶、风格选择）' },
  { name: 'relationships', description: '人际关系（家人、朋友、同事）' },
  { name: 'activities', description: '活动和爱好' },
  { name: 'goals', description: '目标和计划' },
  { name: 'experiences', description: '经历和回忆' },
  { name: 'knowledge', description: '知识和技能' },
  { name: 'opinions', description: '观点和看法' },
  { name: 'habits', description: '习惯和行为模式' },
  { name: 'work_life', description: '工作和职业' }
] as const;

// ==================== 基础记录 ====================

export interface BaseRecord {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ==================== Resource（原始资源） ====================

export interface MemoryResource extends BaseRecord {
  url: string;
  modality: string; // 'conversation' | 'document' | 'text'
  content: string;
}

// ==================== MemoryItem（原子记忆条目） ====================

export interface StructuredMemoryItem extends BaseRecord {
  resourceId: string | null;
  memoryType: MemoryType;
  summary: string;
  embedding: string | null; // JSON-encoded number[] for SQLite storage
  happenedAt: string | null; // ISO 8601
  contentHash: string;
  reinforcementCount: number;
  lastReinforcedAt: string | null; // ISO 8601
  extra: string; // JSON-encoded Record<string, unknown>
}

// ==================== MemoryCategory（记忆分类） ====================

export interface StructuredMemoryCategory extends BaseRecord {
  name: string;
  description: string;
  summary: string | null;
  embedding: string | null; // JSON-encoded number[]
}

// ==================== CategoryItem（分类-条目关系） ====================

export interface StructuredCategoryItem extends BaseRecord {
  itemId: string;
  categoryId: string;
}

// ==================== 工具函数 ====================

export function generateId(): string {
  return randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 计算内容哈希用于去重。
 * 对 summary 做 lowercase + whitespace normalize 后与 memoryType 拼接，取 SHA256 前 16 位。
 */
export function computeContentHash(summary: string, memoryType: string): string {
  const normalized = summary.toLowerCase().trim().replace(/\s+/g, ' ');
  const content = `${memoryType}:${normalized}`;
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 将 embedding 数组编码为 JSON 字符串（用于 SQLite 存储）
 */
export function encodeEmbedding(embedding: number[] | null): string | null {
  if (!embedding) return null;
  return JSON.stringify(embedding);
}

/**
 * 从 JSON 字符串解码 embedding
 */
export function decodeEmbedding(encoded: string | null): number[] | null {
  if (!encoded) return null;
  try {
    return JSON.parse(encoded) as number[];
  } catch {
    return null;
  }
}

/**
 * 解码 extra 字段
 */
export function decodeExtra(encoded: string): Record<string, unknown> {
  try {
    return JSON.parse(encoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}
