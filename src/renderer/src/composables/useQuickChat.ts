/**
 * useQuickChat — 轻量级 Agent 对话 composable
 *
 * 封装对 /gateway/agents/:id/quick-chat SSE 端点的调用。
 * 用于一次性、临时的 Agent 调用（如标题生成、任务分析）。
 *
 * 用法：
 *   const result = await quickChat('one-line-summary', '请为我的网站设计一个导航栏')
 */

import configManager from '@/config';

/** SSE 事件类型 */
interface SSEEvent {
  event: string;
  data: string;
}

/** 解析 SSE 事件 */
function parseSSEEvent(text: string): SSEEvent | null {
  let event = '';
  let data = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  return event && data ? { event, data } : null;
}

/**
 * 调用 Agent 的 quick-chat 接口（非流式）
 *
 * @param agentId - Agent ID（如 'one-line-summary'）
 * @param message - 用户消息
 * @returns 返回 Agent 的完整输出文本
 */
export async function quickChat(agentId: string, message: string): Promise<string | null> {
  try {
    const url = `${configManager.getBaseUrl()}/gateway/agents/${agentId}/quick-chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      console.warn(`[quickChat] HTTP ${response.status} for agent "${agentId}"`);
      return null;
    }

    // 读取 SSE 流
    const reader = response.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

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

          // 收集 text:delta 增量
          if (parsed.event === 'delta' && data.content) {
            output += data.content;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return output.trim() || null;
  } catch (err) {
    console.warn(`[quickChat] Failed for agent "${agentId}":`, err);
    return null;
  }
}

/**
 * 调用 Agent 的 quick-chat 接口（流式版本）
 *
 * @param agentId - Agent ID
 * @param message - 用户消息
 * @param onChunk - 每次接收到增量时的回调
 * @returns 返回 Agent 的完整输出文本
 */
export async function quickChatStream(
  agentId: string,
  message: string,
  onChunk?: (chunk: string) => void
): Promise<string | null> {
  try {
    const url = `${configManager.getBaseUrl()}/gateway/agents/${agentId}/quick-chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      console.warn(`[quickChatStream] HTTP ${response.status} for agent "${agentId}"`);
      return null;
    }

    const reader = response.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        const parsed = parseSSEEvent(trimmed);
        if (!parsed) continue;

        try {
          const data = JSON.parse(parsed.data);

          if (parsed.event === 'delta' && data.content) {
            output += data.content;
            // 实时回调增量
            if (onChunk) {
              onChunk(data.content);
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return output.trim() || null;
  } catch (err) {
    console.warn(`[quickChatStream] Failed for agent "${agentId}":`, err);
    return null;
  }
}

/**
 * 便捷函数：生成 Thread 标题
 *
 * 调用 one-line-summary Agent，返回生成的标题字符串。
 * 这是一个"fire-and-forget"调用 — 不阻塞主流程。
 */
export async function generateThreadTitle(_threadId: string, message: string): Promise<string | null> {
  const prompt = `请为以下消息生成标题：\n\n${message}`;
  return await quickChat('one-line-summary', prompt);
}
