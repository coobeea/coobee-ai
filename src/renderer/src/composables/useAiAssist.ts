/**
 * useAiAssist — 前端通用 AI 辅助 composable
 *
 * 封装对 /gateway/ai-assist SSE 端点的调用。
 * 每个调用返回一个 Promise，通过 SSE 流获取进度和最终结果。
 *
 * 用法：
 *   const { execute, executing } = useAiAssist()
 *   const result = await execute('generate-title', { threadId: '...', message: '...' })
 */

import { ref } from 'vue';
import configManager from '@/config';

const AI_ASSIST_URL = `${configManager.getBaseUrl()}/gateway/ai-assist`;

/** 进度事件 */
export interface AssistProgress {
  step: 'starting' | 'processing' | 'done' | 'error';
  message: string;
  detail?: string;
}

/** 执行结果 */
export interface AssistResult {
  task: string;
  ok: boolean;
  data?: unknown;
  rawOutput?: string;
  error?: string;
}

/** SSE 事件解析 */
function parseSSEEvent(text: string): { event: string; data: string } | null {
  let event = '';
  let data = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (event && data) {
    return { event, data };
  }
  return null;
}

/**
 * AI 辅助 composable
 */
export function useAiAssist(): {
  executing: ReturnType<typeof ref<boolean>>;
  execute: (
    task: string,
    params: Record<string, unknown>,
    onProgress?: (progress: AssistProgress) => void
  ) => Promise<AssistResult>;
} {
  const executing = ref(false);

  async function execute(
    task: string,
    params: Record<string, unknown>,
    onProgress?: (progress: AssistProgress) => void
  ): Promise<AssistResult> {
    executing.value = true;

    try {
      const response = await fetch(AI_ASSIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, params })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        const msg = (errBody as { error?: string }).error || `HTTP ${response.status}`;
        return { task, ok: false, error: msg };
      }

      // 读取 SSE 流
      const reader = response.body?.getReader();
      if (!reader) {
        return { task, ok: false, error: 'No response body' };
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let result: AssistResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以 \n\n 分隔
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          const parsed = parseSSEEvent(trimmed);
          if (!parsed) continue;

          try {
            const data = JSON.parse(parsed.data);

            if (parsed.event === 'progress') {
              onProgress?.(data as AssistProgress);
            } else if (parsed.event === 'result') {
              result = data as AssistResult;
            } else if (parsed.event === 'error') {
              result = data as AssistResult;
            }
          } catch {
            console.warn('[useAiAssist] Failed to parse SSE data:', parsed.data);
          }
        }
      }

      return result ?? { task, ok: false, error: 'No result received' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { task, ok: false, error: msg };
    } finally {
      executing.value = false;
    }
  }

  return { executing, execute };
}

/**
 * 便捷函数：生成 Thread 标题
 *
 * 调用 generate-title task，返回生成的标题字符串。
 * 标题生成后自动更新 Thread（通过 ThreadStore）。
 *
 * 这是一个"fire-and-forget"调用 — 不阻塞主流程。
 */
export async function generateThreadTitle(threadId: string, message: string): Promise<string | null> {
  try {
    const response = await fetch(AI_ASSIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'generate-title',
        params: { threadId, message }
      })
    });

    if (!response.ok) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let buffer = '';
    let title: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const parsed = parseSSEEvent(part.trim());
        if (!parsed) continue;

        try {
          const data = JSON.parse(parsed.data);
          if (parsed.event === 'result' && data.ok && data.data) {
            title = data.data as string;
          }
        } catch {
          // ignore
        }
      }
    }

    return title;
  } catch (err) {
    console.warn('[generateThreadTitle] Failed:', err);
    return null;
  }
}
