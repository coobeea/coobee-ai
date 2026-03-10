/**
 * Webhooks HTTP Routes
 *
 * 接收外部服务（GitHub、GitLab 等）的 Webhook 事件
 */

import type Koa from 'koa';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { WebhookHandler } from '@main/integrations/github/WebhookHandler';
import type { GitHubConfig } from '@main/integrations/github/types';
import * as crypto from 'node:crypto';

const log = createLogger('webhooks-api');

/**
 * 验证 GitHub Webhook 签名
 */
function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

/**
 * 注册 Webhook 路由
 */
export function registerWebhookRoutes(router: Router): void {
  /**
   * POST /webhooks/github
   * 接收 GitHub Webhook 事件
   */
  router.post('/webhooks/github', async (ctx: Koa.Context) => {
    try {
      // 获取配置（暂时从环境变量读取，待配置系统完善后迁移）
      const token = process.env.GITHUB_TOKEN;
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

      if (!token) {
        ctx.status = 503;
        ctx.body = { error: 'GitHub integration not configured (GITHUB_TOKEN missing)' };
        return;
      }

      const config: GitHubConfig = {
        token,
        webhookSecret,
        autoReview: {
          enabled: true,
          trigger: '@coobee review'
        },
        autoFixCI: {
          enabled: false
        }
      };

      // 验证签名（如果配置了 secret）
      if (config.webhookSecret) {
        const signature = ctx.request.headers['x-hub-signature-256'] as string | undefined;
        const payload = JSON.stringify(ctx.request.body);

        if (!verifyGitHubSignature(payload, signature, config.webhookSecret)) {
          log.warn('[Webhooks] Invalid GitHub webhook signature');
          ctx.status = 401;
          ctx.body = { error: 'Invalid signature' };
          return;
        }
      }

      // 处理事件
      const event = ctx.request.headers['x-github-event'] as string;
      const handler = new WebhookHandler(config);

      await handler.handle({
        event,
        payload: ctx.request.body,
        headers: ctx.request.headers as Record<string, string>
      });

      ctx.body = { ok: true };
    } catch (err) {
      log.error('[Webhooks] Failed to handle GitHub webhook:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : 'Internal server error' };
    }
  });

  /**
   * POST /webhooks/gitlab
   * 接收 GitLab Webhook 事件（预留）
   */
  router.post('/webhooks/gitlab', async (ctx: Koa.Context) => {
    log.info('[Webhooks] GitLab webhook received (not yet implemented)');
    ctx.body = { ok: true };
  });

  log.info('[Webhooks] Webhook routes registered');
}
