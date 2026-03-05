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
import type { DiscussionParticipant, TurnStrategy } from '@main/ai/discussion/types';

const log = createLogger('gateway-http-discussion');

// 活跃的讨论室实例
const activeRooms = new Map<string, DiscussionRoom>();

export function registerDiscussionRoutes(router: Router): void {
  // ==================== 讨论会话 CRUD ====================

  router.get('/discussion/sessions', async (ctx) => {
    try {
      const store = new DiscussionStore();
      const sessions = await store.list();
      sessions.sort((a, b) => b.createdAt - a.createdAt);
      ctx.body = { sessions };
    } catch (err) {
      log.error('Failed to list discussions:', err);
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
      const store = new DiscussionStore();
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
      log.error('Failed to create discussion:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to create discussion' };
    }
  });

  // ==================== 讨论控制 ====================

  router.post('/discussion/sessions/:id/start', async (ctx) => {
    const sessionId = ctx.params.id;

    try {
      const store = new DiscussionStore();
      const session = await store.load(sessionId);

      if (!session) {
        ctx.status = 404;
        ctx.body = { error: 'Discussion not found' };
        return;
      }

      if (session.messages.length > 0) {
        ctx.status = 400;
        ctx.body = { error: 'Discussion already started' };
        return;
      }

      // 创建或获取 DiscussionRoom 实例
      let room = activeRooms.get(sessionId);
      if (!room) {
        room = new DiscussionRoom({
          topic: session.topic,
          participants: session.participants,
          turnStrategy: 'round-robin',
          consensusThreshold: 0.7,
          maxRounds: 20
        });
        activeRooms.set(sessionId, room);
      }

      // TODO: 集成 LLM，触发第一个 Agent 发言
      // 目前添加系统消息作为占位
      await room.addMessage('system', `讨论已开始！主题: ${session.topic}`, 'statement');

      const firstSpeaker = room.getNextSpeaker();
      if (firstSpeaker) {
        await room.addMessage(
          firstSpeaker.agentId,
          `我是 ${firstSpeaker.name}（${firstSpeaker.role}），让我先分享一下我的观点...（此处应调用 LLM 生成真实发言）`,
          'statement'
        );
      }

      const updatedSession = room.getSession();
      ctx.body = { session: updatedSession };
    } catch (err) {
      log.error(`Failed to start discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to start discussion' };
    }
  });

  router.post('/discussion/sessions/:id/pause', async (ctx) => {
    const sessionId = ctx.params.id;
    const room = activeRooms.get(sessionId);

    if (!room) {
      ctx.status = 404;
      ctx.body = { error: 'Discussion room not found or not active' };
      return;
    }

    try {
      await room.pause();
      const session = room.getSession();
      ctx.body = { session };
    } catch (err) {
      log.error(`Failed to pause discussion ${sessionId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to pause discussion' };
    }
  });

  router.post('/discussion/sessions/:id/resume', async (ctx) => {
    const sessionId = ctx.params.id;
    const room = activeRooms.get(sessionId);

    if (!room) {
      ctx.status = 404;
      ctx.body = { error: 'Discussion room not found or not active' };
      return;
    }

    try {
      await room.resume();
      const session = room.getSession();
      ctx.body = { session };
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
