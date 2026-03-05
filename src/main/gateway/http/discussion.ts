/**
 * Discussion HTTP 路由
 *
 * 提供智能体讨论室的 HTTP API。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/discussion/sessions           — 获取讨论列表
 *   GET    /gateway/discussion/sessions/:id       — 获取讨论详情
 *   POST   /gateway/discussion/sessions           — 创建讨论室
 *   POST   /gateway/discussion/sessions/:id/pause — 暂停讨论
 *   POST   /gateway/discussion/sessions/:id/resume — 继续讨论
 *   POST   /gateway/discussion/sessions/:id/end   — 结束讨论
 *   POST   /gateway/discussion/sessions/:id/message — 发送消息
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { DiscussionRoom, DiscussionStore } from '@main/ai/discussion';
import { ChannelManager } from '@main/channels/ChannelManager';
import type { DiscussionParticipant, TurnStrategy } from '@main/ai/discussion/types';

const log = createLogger('gateway-http-discussion');

// 活跃的讨论室实例
const activeRooms = new Map<string, DiscussionRoom>();

export function registerDiscussionRoutes(router: Router): void {
  // ==================== 讨论会话 CRUD ====================

  router.get('/discussion/sessions', async (ctx) => {
    try {
      const store = await DiscussionStore.getInstance();
      const sessions = await store.list();
      sessions.sort((a, b) => b.createdAt - a.createdAt);
      ctx.body = { sessions };
    } catch (err) {
      log.error('Failed to list discussions:', err instanceof Error ? err.message : err);
      log.error('Stack:', err instanceof Error ? err.stack : 'no stack');
      ctx.status = 500;
      ctx.body = { error: 'Failed to load discussions' };
    }
  });

  router.get('/discussion/sessions/:id', async (ctx) => {
    const sessionId = ctx.params.id;
    if (!sessionId) {
      ctx.status = 400;
      ctx.body = { error: 'Session ID is required' };
      return;
    }

    try {
      const store = await DiscussionStore.getInstance();
      const session = await store.load(sessionId);
      if (!session) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion not found' };
        return;
      }
      ctx.body = { session };
    } catch (err) {
      log.error(`Failed to get discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to load discussion' };
    }
  });

  router.post('/discussion/sessions', async (ctx) => {
    try {
      const body = ctx.request.body as Record<string, unknown>;

      const topic = body.topic as string | undefined;
      const participants = body.participants as DiscussionParticipant[] | undefined;
      const turnStrategy = body.turnStrategy as TurnStrategy | undefined;
      const consensusThreshold = body.consensusThreshold as number | undefined;
      const maxRounds = body.maxRounds as number | undefined;

      if (!topic || !participants || participants.length < 2) {
        ctx.status = 400;
        ctx.body = { error: 'topic and at least 2 participants are required' };
        return;
      }

      const room = new DiscussionRoom({
        topic,
        participants,
        turnStrategy,
        consensusThreshold,
        maxRounds
      });

      await room.start();
      const session = room.getSession();

      activeRooms.set(session.id, room);
      log.info(`Discussion created: ${session.id}`);
      ctx.status = 201;
      ctx.body = { session };
    } catch (err) {
      log.error('Failed to create discussion:', err instanceof Error ? err.message : err);
      log.error('Stack:', err instanceof Error ? err.stack : 'no stack');
      ctx.status = 500;
      ctx.body = { error: 'Failed to create discussion' };
    }
  });

  // ==================== 讨论控制 ====================

  router.post('/discussion/sessions/:id/start', async (ctx) => {
    const sessionId = ctx.params.id;

    try {
      // 1. 获取 Discussion Channel Plugin
      const manager = ChannelManager.getInstance();
      const plugin = manager.getChannelPlugin('discussion');

      if (!plugin) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion channel not available' };
        return;
      }

      if (!plugin.inbound) {
        ctx.status = 500;
        ctx.body = { error: 'Discussion channel does not support inbound messages' };
        return;
      }

      // 2. 加载讨论室
      const store = await DiscussionStore.getInstance();
      const session = await store.get(sessionId);

      if (!session) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion session not found' };
        return;
      }

      // 3. 更新状态为 active
      await store.update(sessionId, { status: 'active' });

      // 4. 添加系统消息
      await store.addMessage(sessionId, {
        participant: 'System',
        content: `Discussion started. Topic: ${session.topic}`,
        timestamp: Date.now(),
        type: 'statement'
      });

      // 5. 选择第一个发言者
      const firstSpeaker = session.participants[0];

      // 6. 触发 Plugin 的 inbound.handleMessage
      await plugin.inbound.handleMessage({
        peer: sessionId,
        from: firstSpeaker.agentId,
        text: `You are ${firstSpeaker.role || firstSpeaker.name}. Please start the discussion on: ${session.topic}`,
        context: {
          channel: 'discussion',
          roomId: sessionId,
          role: firstSpeaker.role || firstSpeaker.name,
          topic: session.topic,
          recentMessages: []
        }
      });

      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to start discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to start discussion' };
    }
  });

  router.post('/discussion/sessions/:id/pause', async (ctx) => {
    const sessionId = ctx.params.id;

    try {
      const store = await DiscussionStore.getInstance();
      const session = await store.get(sessionId);

      if (!session) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion session not found' };
        return;
      }

      // 更新状态为 paused
      await store.update(sessionId, { status: 'paused' });

      // 添加系统消息
      await store.addMessage(sessionId, {
        participant: 'System',
        content: 'Discussion paused',
        timestamp: Date.now(),
        type: 'statement'
      });

      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to pause discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to pause discussion' };
    }
  });

  router.post('/discussion/sessions/:id/resume', async (ctx) => {
    const sessionId = ctx.params.id;

    try {
      const store = await DiscussionStore.getInstance();
      const session = await store.get(sessionId);

      if (!session) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion session not found' };
        return;
      }

      // 更新状态为 active
      await store.update(sessionId, { status: 'active' });

      // 添加系统消息
      await store.addMessage(sessionId, {
        participant: 'System',
        content: 'Discussion resumed',
        timestamp: Date.now(),
        type: 'statement'
      });

      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to resume discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to resume discussion' };
    }
  });

  router.post('/discussion/sessions/:id/end', async (ctx) => {
    const sessionId = ctx.params.id;
    const room = activeRooms.get(sessionId);

    if (!room) {
      ctx.status = 404;
      ctx.body = { error: 'Discussion room not found or not active' };
      return;
    }

    try {
      await room.end();
      const session = room.getSession();
      activeRooms.delete(sessionId);
      ctx.body = { session };
    } catch (err) {
      log.error(`Failed to end discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to end discussion' };
    }
  });

  router.post('/discussion/sessions/:id/message', async (ctx) => {
    const sessionId = ctx.params.id;
    const room = activeRooms.get(sessionId);

    if (!room) {
      ctx.status = 404;
      ctx.body = { error: 'Discussion room not found or not active' };
      return;
    }

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const agentId = body.agentId as string;
      const content = body.content as string;
      const type = body.type as 'statement' | 'question' | 'answer' | 'objection' | 'agreement' | 'summary' | undefined;

      if (!agentId || !content) {
        ctx.status = 400;
        ctx.body = { error: 'agentId and content are required' };
        return;
      }

      await room.addMessage(agentId, content, type);
      const session = room.getSession();
      ctx.body = { session };
    } catch (err) {
      log.error(`Failed to add message to discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to add message' };
    }
  });

  log.info('[Discussion] HTTP routes registered');
}
