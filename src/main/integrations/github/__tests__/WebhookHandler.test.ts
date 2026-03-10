/**
 * WebhookHandler 单元测试
 */

import { describe, it, expect } from 'vitest';
import { WebhookHandler } from '../WebhookHandler';
import type { GitHubConfig } from '../types';

describe('WebhookHandler', () => {
  const mockConfig: GitHubConfig = {
    token: 'test-token',
    autoReview: {
      enabled: true,
      trigger: '@coobee review'
    }
  };

  it('should initialize with config', () => {
    const handler = new WebhookHandler(mockConfig);
    expect(handler).toBeInstanceOf(WebhookHandler);
  });

  it('should have handle method', () => {
    const handler = new WebhookHandler(mockConfig);
    expect(typeof handler.handle).toBe('function');
  });

  describe('event handling', () => {
    it('should handle issue_comment events', async () => {
      const handler = new WebhookHandler(mockConfig);

      const mockEvent = {
        event: 'issue_comment',
        payload: {
          action: 'created',
          comment: {
            body: '@coobee review this PR',
            user: { login: 'testuser' }
          },
          issue: {
            number: 123,
            title: 'Test PR',
            body: 'Test description',
            state: 'open' as const,
            html_url: 'https://github.com/test/test/pull/123',
            user: { login: 'author' },
            pull_request: { url: 'https://api.github.com/repos/test/test/pulls/123' }
          }
        },
        headers: {}
      };

      // 由于涉及数据库操作，这里只验证方法不抛出异常
      await expect(handler.handle(mockEvent)).resolves.not.toThrow();
    });
  });
});
