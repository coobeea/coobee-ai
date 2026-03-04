/**
 * SlackBot 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlackBot } from '../SlackBot';
import type { SlackConfig, SlackEvent, SlackCommand } from '../types';

describe('SlackBot', () => {
  let bot: SlackBot;

  const config: SlackConfig = {
    botToken: 'xoxb-test-token',
    signingSecret: 'test-secret'
  };

  beforeEach(() => {
    bot = new SlackBot(config);
  });

  describe('Event handlers', () => {
    it('should register event handler', () => {
      const handler = vi.fn(async () => {});
      expect(() => bot.onEvent('app_mention', handler)).not.toThrow();
    });

    it('should handle events', async () => {
      const handler = vi.fn(async () => {});
      bot.onEvent('test_event', handler);

      const event: SlackEvent = {
        type: 'test_event',
        channel: 'C123',
        user: 'U123',
        text: 'Test message'
      };

      await bot.handleEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('Command handlers', () => {
    it('should register command handler', () => {
      const handler = vi.fn(async () => {});
      expect(() => bot.onCommand('/test', handler)).not.toThrow();
    });

    it('should handle commands', async () => {
      const handler = vi.fn(async () => {});
      bot.onCommand('/ask', handler);

      const command: SlackCommand = {
        command: '/ask',
        text: 'What is AI?',
        user_id: 'U123',
        channel_id: 'C123',
        response_url: 'https://hooks.slack.com/commands/123'
      };

      await bot.handleCommand(command);

      expect(handler).toHaveBeenCalledWith(command);
    });
  });

  describe('Message sending', () => {
    it('should have sendMessage method', () => {
      expect(typeof bot.sendMessage).toBe('function');
    });
  });
});
