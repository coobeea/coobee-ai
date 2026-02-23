/**
 * Gateway Stream 方法组
 *
 * 对应旧 StreamChannel 的客户端请求处理部分。
 * 事件推送部分在 events/StreamBridge.ts 处理。
 *
 * 方法：
 *   stream.subscribe   — 订阅会话流式消息
 *   stream.unsubscribe — 取消订阅
 *   stream.resend      — 重发历史消息
 *   stream.latestSeq   — 获取最新序列号
 */

import { log } from '@main/common/logger';
import { streamStore } from '@main/ai/streaming/consumers/StreamStore';
import { GatewayMethodError, GatewayErrorCode } from '../protocol/errors';
import type { MethodGroup } from '../protocol';

export const streamMethods: MethodGroup = {
  namespace: 'stream',
  methods: {
    /**
     * 订阅会话流式消息
     */
    subscribe: async (params, ctx) => {
      const { sessionId } = params as { sessionId?: string };
      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }

      ctx.meta.subscribedSessions.add(sessionId);
      log.info(`[stream.subscribe] ${ctx.clientId} → ${sessionId}`);
      return { data: { sessionId } };
    },

    /**
     * 取消订阅会话流式消息
     */
    unsubscribe: async (params, ctx) => {
      const { sessionId } = params as { sessionId?: string };
      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }

      const existed = ctx.meta.subscribedSessions.has(sessionId);
      ctx.meta.subscribedSessions.delete(sessionId);
      log.info(`[stream.unsubscribe] ${ctx.clientId} → ${sessionId}`);
      return { data: { unsubscribed: existed } };
    },

    /**
     * 重发历史消息
     */
    resend: async (params) => {
      const { sessionId, fromSequence } = params as {
        sessionId?: string;
        fromSequence?: number;
      };

      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }
      if (typeof fromSequence !== 'number') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'fromSequence must be a number');
      }

      try {
        const messages = await streamStore.getMessages(sessionId, fromSequence, 100);
        log.info(`[stream.resend] ${sessionId} from #${fromSequence} → ${messages.length} msgs`);
        return { data: { messages } };
      } catch (err) {
        log.error(`[stream.resend] Failed for ${sessionId}:`, err);
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          `Failed to resend messages: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },

    /**
     * 获取最新序列号
     */
    latestSeq: async (params) => {
      const { sessionId } = params as { sessionId?: string };
      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }

      try {
        const sequence = await streamStore.getLatestSequence(sessionId);
        return { data: { sequence } };
      } catch (err) {
        log.error(`[stream.latestSeq] Failed for ${sessionId}:`, err);
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          `Failed to get latest sequence: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
};
