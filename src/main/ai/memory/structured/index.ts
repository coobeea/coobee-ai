/**
 * 结构化记忆系统 — 公共导出
 */

// 数据模型
export type {
  MemoryType,
  MemoryResource,
  StructuredMemoryItem,
  StructuredMemoryCategory,
  StructuredCategoryItem,
  CategoryDefinition
} from './models';
export {
  MEMORY_TYPES,
  DEFAULT_CATEGORIES,
  generateId,
  nowISO,
  computeContentHash,
  encodeEmbedding,
  decodeEmbedding,
  decodeExtra
} from './models';

// SQLite 存储
export { StructuredMemoryStorage } from './storage';

// 向量搜索
export { cosineSimilarity, salienceScore, cosineTopK, cosineTopKSalience } from './vector';
export type { VectorSearchResult } from './vector';
