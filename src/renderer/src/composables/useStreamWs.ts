/**
 * Stream 领域 WebSocket 组合式
 *
 * 封装 AI 流式频道的所有交互逻辑：
 *   - 订阅/取消订阅会话的流式事件（通过 Gateway RPC）
 *   - 重连后自动恢复订阅
 *   - 消息分发给消费方（如 chatStore）
 *
 * RPC 方法：
 *   stream.subscribe   — 订阅会话
 *   stream.unsubscribe — 取消订阅
 *   stream.resend      — 请求重发历史消息
 *   stream.latestSeq   — 请求最新序号
 *
 * 事件：
 *   stream.message       — 单条流式消息
 *   stream.resend_batch  — 历史消息批量重发
 */

import { gateway } from '@/plugins/gatewaySetup';
import type { StreamMessage } from '@shared/stream-protocol';

// ==================== 内部状态 ====================

// 支持多个会话同时订阅（如 Chat 和 Copilot 各自订阅不同的 sessionId）
const subscribedSessions = new Set<string>();
// 由于可能有多个组件处理同一个流，也可以改成一个数组或映射
// 但最简单的是：允许传递 handler，而这个全局组合式主要负责 Gateway RPC 侧的订阅注册
// 让真正的事件分发交由事件监听器。但原代码把 messageHandler 存在全局了。
// 为了向后兼容，我们将 messageHandler 改为支持多订阅的 Map 结构。
const messageHandlers = new Map<string, (msg: StreamMessage) => void>();

let unregisterMessage: (() => void) | null = null;
let unregisterBatch: (() => void) | null = null;
let unregisterConnect: (() => void) | null = null;

/** 已接收到的最新 sequence（用于重连补发），按 sessionId 隔离 */
const lastReceivedSeqs = new Map<string, number>();

// ==================== 初始化 ====================

/**
 * 初始化 stream 事件监听
 *
 * 在模块加载时自动注册，确保 Gateway 连接后即可接收 stream.* 事件。
 */
function init(): void {
  if (unregisterMessage) return; // 已注册

  // 监听 stream.message 事件
  // Gateway 事件 payload 结构: { sessionId, message: StreamMessage }
  unregisterMessage = gateway.on('stream.message', (payload) => {
    if (!payload) return;
    const data = payload as { sessionId?: string; message?: StreamMessage };
    if (!data.sessionId || !data.message) return;

    // 获取该会话的处理器
    const handler = messageHandlers.get(data.sessionId);
    if (!handler) return; // 未订阅该会话

    // 追踪最新 sequence（用于重连后补发）
    const seq = lastReceivedSeqs.get(data.sessionId) || 0;
    if (data.message.sequence > seq) {
      lastReceivedSeqs.set(data.sessionId, data.message.sequence);
    }

    handler(data.message);
  });

  // 监听 stream.resend_batch 事件
  // 注意：批量重发事件需要附带 sessionId 才能正确分发，原版 payload 没有处理，我们假设批量里的 message 也带有会话特征或者可以分发
  // 暂时保留原逻辑，但批量可能需要后端给出 sessionId。这里假设 batch 是从某个地方来的
  unregisterBatch = gateway.on('stream.resend_batch', (payload) => {
    // 假设 resend_batch 当前不带 sessionId... 但它确实需要。
    // 如果可以，分发给所有 handler（不够精确，但兜底）
    if (Array.isArray(payload)) {
      for (const m of payload) {
        const msg = m as StreamMessage;
        // 我们不知道它属于哪个 session，只能发给所有 handler 碰碰运气
        // TODO: 后端 resend_batch 应该带有 sessionId，目前临时分发
        for (const handler of messageHandlers.values()) {
          handler(msg);
        }
      }
    }
  });

  // 注册连接回调：重连后自动恢复订阅 + 补发断连期间的消息
  unregisterConnect = gateway.onConnect(() => {
    for (const sid of subscribedSessions) {
      const fromSeq = lastReceivedSeqs.get(sid) || 0;
      gateway
        .request('stream.subscribe', { sessionId: sid })
        .then(() => {
          console.log(`[useStreamWs] 重连后恢复订阅: ${sid}`);
          // 补发断连期间丢失的消息
          const handler = messageHandlers.get(sid);
          if (fromSeq > 0 && handler) {
            gateway
              .request('stream.resend', { sessionId: sid, fromSequence: fromSeq + 1 })
              .then((res) => {
                const result = res as { ok?: boolean; messages?: StreamMessage[] };
                if (result.ok && Array.isArray(result.messages) && result.messages.length > 0) {
                  console.log(
                    `[useStreamWs] 补发 ${result.messages.length} 条消息 (for ${sid}, from seq ${fromSeq + 1})`
                  );
                  for (const msg of result.messages) {
                    const currentSeq = lastReceivedSeqs.get(sid) || 0;
                    if (msg.sequence > currentSeq) {
                      lastReceivedSeqs.set(sid, msg.sequence);
                    }
                    handler(msg);
                  }
                }
              })
              .catch((err) => console.error(`[useStreamWs] 补发消息失败 (${sid}):`, err));
          }
        })
        .catch((err) => console.error(`[useStreamWs] 重连后恢复订阅失败 (${sid}):`, err));
    }
  });
}

// 模块加载时自动初始化
init();

// ==================== 导出 API ====================

/**
 * 订阅指定 session 的流式事件
 *
 * @param sessionId 会话 ID
 * @param handler   消息回调（由 chatStore 等消费方提供）
 */
export function streamSubscribe(sessionId: string, handler: (msg: StreamMessage) => void): void {
  // 如果之前已经存在对某个会话的订阅（且不允许多订阅的场景下），我们不主动去 unsubscribe。
  // 改为纯粹的向集合中注册
  subscribedSessions.add(sessionId);
  messageHandlers.set(sessionId, handler);
  if (!lastReceivedSeqs.has(sessionId)) {
    lastReceivedSeqs.set(sessionId, 0);
  }

  // 已连接则立即发送订阅
  if (gateway.connectionState.value === 'connected') {
    gateway
      .request('stream.subscribe', { sessionId })
      .then(() => console.log(`[useStreamWs] 订阅会话: ${sessionId}`))
      .catch((err) => console.error('[useStreamWs] 订阅失败:', err));
  }
  // 未连接时，onConnect 回调会在连接后自动恢复
}

/**
 * 取消订阅指定会话
 */
export function streamUnsubscribe(sessionId: string): void {
  if (subscribedSessions.has(sessionId)) {
    gateway
      .request('stream.unsubscribe', { sessionId })
      .catch((err) => console.error(`[useStreamWs] 取消订阅失败 (${sessionId}):`, err));
    subscribedSessions.delete(sessionId);
    messageHandlers.delete(sessionId);
  }
}

/**
 * 请求重发历史消息
 */
export function streamResend(sessionId: string, fromSequence: number): void {
  gateway
    .request('stream.resend', { sessionId, fromSequence })
    .catch((err) => console.error('[useStreamWs] 重发请求失败:', err));
}

/**
 * 请求最新序号
 */
export function streamLatestSequence(sessionId: string): void {
  gateway
    .request('stream.latestSeq', { sessionId })
    .catch((err) => console.error('[useStreamWs] 获取最新序号失败:', err));
}

/**
 * 清理资源（通常在应用销毁时调用）
 */
export function streamCleanup(): void {
  for (const sid of subscribedSessions) {
    streamUnsubscribe(sid);
  }
  unregisterMessage?.();
  unregisterBatch?.();
  unregisterConnect?.();
  unregisterMessage = null;
  unregisterBatch = null;
  unregisterConnect = null;
}
