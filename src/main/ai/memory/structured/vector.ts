/**
 * 结构化记忆系统 — 向量搜索
 *
 * 实现 brute-force 余弦相似度搜索和 Salience 评分算法。
 * 纯 TypeScript 实现，无需 numpy 等外部依赖。
 */

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-9) return 0;
  return dot / denom;
}

/**
 * Salience 评分：综合相似度、强化频率和时间衰减。
 *
 * 公式: similarity × log(reinforcementCount + 1) × recencyFactor
 *
 * - reinforcement_factor: 对数缩放防止高频记忆过度主导
 * - recency_factor: 半衰期指数衰减（默认 30 天）
 */
export function salienceScore(
  similarity: number,
  reinforcementCount: number,
  lastReinforcedAt: Date | null,
  recencyDecayDays: number = 30
): number {
  const reinforcementFactor = Math.log(reinforcementCount + 1);

  let recencyFactor: number;
  if (!lastReinforcedAt) {
    recencyFactor = 0.5;
  } else {
    const daysAgo = (Date.now() - lastReinforcedAt.getTime()) / (86400 * 1000);
    // 0.693 = ln(2) ensures half-life at recencyDecayDays
    recencyFactor = Math.exp((-0.693 * daysAgo) / recencyDecayDays);
  }

  return similarity * reinforcementFactor * recencyFactor;
}

export interface VectorSearchResult {
  id: string;
  score: number;
}

/**
 * Brute-force 余弦 Top-K 搜索
 */
export function cosineTopK(
  queryVec: number[],
  corpus: Array<{ id: string; embedding: number[] }>,
  k: number
): VectorSearchResult[] {
  const scored: VectorSearchResult[] = [];

  for (const item of corpus) {
    const score = cosineSimilarity(queryVec, item.embedding);
    scored.push({ id: item.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Salience-aware Top-K 搜索
 */
export function cosineTopKSalience(
  queryVec: number[],
  corpus: Array<{
    id: string;
    embedding: number[];
    reinforcementCount: number;
    lastReinforcedAt: Date | null;
  }>,
  k: number,
  recencyDecayDays: number = 30
): VectorSearchResult[] {
  const scored: VectorSearchResult[] = [];

  for (const item of corpus) {
    const similarity = cosineSimilarity(queryVec, item.embedding);
    const score = salienceScore(similarity, item.reinforcementCount, item.lastReinforcedAt, recencyDecayDays);
    scored.push({ id: item.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
