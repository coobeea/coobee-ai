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

// Prompts
export {
  ENABLED_MEMORY_TYPES,
  buildExtractionPrompt,
  formatCategoriesForPrompt,
  parseExtractionResponse
} from './prompts';
export type { ExtractedMemory } from './prompts';

// Memorize Pipeline
export { MemorizePipeline } from './memorize';
export type { MemorizeInput, MemorizeResult, MemorizeOptions } from './memorize';

// Retrieve Pipeline
export { RetrievePipeline } from './retrieve';
export type { RetrieveInput, RetrieveResult } from './retrieve';

// Embedding
export { OpenAIEmbeddingProvider, NoopEmbeddingProvider } from './embedding';
export type { EmbeddingProvider } from './embedding';

// Migration
export { migrateFromMarkdown, exportToMarkdown } from './migration';
export type { MigrationResult, MigrationOptions } from './migration';

// Service (singleton facade)
export { StructuredMemoryService } from './service';
export type { StructuredMemoryServiceOptions } from './service';
