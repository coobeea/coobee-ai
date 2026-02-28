/**
 * Token 计数工具
 *
 * 封装 tokenx 库提供的快速 token 估算能力（94% 准确度、2KB、零依赖）。
 * 供 SessionCompressor 和 FileSession 使用，替代之前的手写正则估算。
 */

import { estimateTokenCount, isWithinTokenLimit } from 'tokenx';
import type { AgentInputItem } from '@openai/agents';
import { createLogger } from '@main/common/logger';

const log = createLogger('runtime:token-counter');

/**
 * 估算文本的 token 数量
 *
 * @param text 要估算的文本
 * @returns token 数量
 */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0;

  try {
    return estimateTokenCount(text);
  } catch (error) {
    log.error('计算失败，降级到简单估算:', error);
    return estimateFallback(text);
  }
}

/**
 * 估算单个 AgentInputItem 的 token 数量
 *
 * 将 item 序列化为 JSON 后估算 token。
 *
 * @param item SDK AgentInputItem
 * @returns token 数量
 */
export function countItemTokens(item: AgentInputItem): number {
  if (!item) return 0;

  try {
    const text = JSON.stringify(item);
    return countTokens(text);
  } catch (error) {
    log.error('Item 序列化失败:', error);
    return 0;
  }
}

/**
 * 估算 AgentInputItem 列表的 token 总量
 *
 * @param items SDK AgentInputItem 列表
 * @returns 总 token 数量
 */
export function countItemsTokens(items: AgentInputItem[]): number {
  if (!items || items.length === 0) return 0;

  let total = 0;
  for (const item of items) {
    total += countItemTokens(item);
  }
  return total;
}

/**
 * 检查文本是否在 token 限制内
 *
 * @param text 要检查的文本
 * @param limit token 限制
 * @returns 是否在限制内
 */
export function isWithinLimit(text: string, limit: number): boolean {
  if (!text) return true;

  try {
    return isWithinTokenLimit(text, limit);
  } catch {
    return countTokens(text) <= limit;
  }
}

/**
 * 格式化 token 数量（带单位）
 *
 * @param tokens token 数量
 * @returns 格式化的字符串
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens} tokens`;
  } else if (tokens < 1000000) {
    return `${(tokens / 1000).toFixed(1)}K tokens`;
  } else {
    return `${(tokens / 1000000).toFixed(2)}M tokens`;
  }
}

/**
 * 降级估算方法（当 tokenx 失败时使用）
 */
function estimateFallback(text: string): number {
  if (!text) return 0;

  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const english = (text.match(/[a-zA-Z]+/g) || []).join('').length;
  const numbers = (text.match(/\d+/g) || []).join('').length;

  return Math.ceil(chinese * 1.5 + english / 4 + numbers / 3);
}
