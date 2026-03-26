/**
 * 普通群聊 HTTP 路由
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { log } from '@main/common/logger';
import { GroupChatManager } from '@main/ai/discussion/GroupChatManager';
import type { DiscussionParticipant } from '@main/ai/discussion/types';

export function registerGroupChatRoutes(router: Router): void {
  router.post('/groupchat/sessions', async (ctx: Context) => {
    try {
      const { topic, participants } = ctx.request.body as {
        topic: string;
        participants: DiscussionParticipant[];
      };
      if (!topic || !participants?.length) {
        ctx.status = 400;
        ctx.body = { success: false, error: '缺少 topic 或 participants' };
        return;
      }
      const session = await GroupChatManager.create({ topic, participants });
      ctx.body = { success: true, session };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  router.get('/groupchat/sessions', async (ctx: Context) => {
    const sessions = await GroupChatManager.list();
    ctx.body = { success: true, sessions };
  });

  router.get('/groupchat/sessions/:id', async (ctx: Context) => {
    const session = await GroupChatManager.get(ctx.params.id);
    if (!session) {
      ctx.status = 404;
      ctx.body = { success: false, error: '群聊不存在' };
      return;
    }
    ctx.body = { success: true, session };
  });

  router.post('/groupchat/sessions/:id/message', async (ctx: Context) => {
    try {
      const { content } = ctx.request.body as { content: string };
      if (!content?.trim()) {
        ctx.status = 400;
        ctx.body = { success: false, error: '消息内容不能为空' };
        return;
      }
      GroupChatManager.sendUserMessage(ctx.params.id, content).catch((err) => {
        log.error('[GroupChat] sendUserMessage failed:', err);
      });
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  router.post('/groupchat/sessions/:id/end', async (ctx: Context) => {
    try {
      const session = await GroupChatManager.end(ctx.params.id);
      ctx.body = { success: true, session };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  router.delete('/groupchat/sessions/:id', async (ctx: Context) => {
    try {
      await GroupChatManager.delete(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  log.info('[GroupChatRoutes] Registered');
}
