/**
 * DiscordBot 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscordBot } from '../DiscordBot';
import type { DiscordConfig, DiscordMessage, DiscordInteraction } from '../types';

describe('DiscordBot', () => {
  let bot: DiscordBot;

  const config: DiscordConfig = {
    botToken: 'test-bot-token',
    applicationId: 'test-app-id'
  };

  beforeEach(() => {
    bot = new DiscordBot(config);
  });

  describe('Message handlers', () => {
    it('should register message handler', () => {
      const handler = vi.fn(async () => {});
      expect(() => bot.onMessage(handler)).not.toThrow();
    });

    it('should handle messages', async () => {
      const handler = vi.fn(async () => {});
      bot.onMessage(handler);

      const message: DiscordMessage = {
        id: '123',
        channel_id: 'C123',
        author: {
          id: 'U123',
          username: 'testuser'
        },
        content: 'Hello @coobee',
        timestamp: new Date().toISOString(),
        mentions_bot: true
      };

      await bot.handleMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should ignore bot messages', async () => {
      const handler = vi.fn(async () => {});
      bot.onMessage(handler);

      const botMessage: DiscordMessage = {
        id: '123',
        channel_id: 'C123',
        author: {
          id: 'B123',
          username: 'bot',
          bot: true
        },
        content: 'Bot message',
        timestamp: new Date().toISOString()
      };

      await bot.handleMessage(botMessage);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Interaction handlers', () => {
    it('should register interaction handler', () => {
      const handler = vi.fn(async () => {});
      expect(() => bot.onInteraction('test', handler)).not.toThrow();
    });

    it('should handle interactions', async () => {
      const handler = vi.fn(async () => {});
      bot.onInteraction('ask', handler);

      const interaction: DiscordInteraction = {
        type: 2,
        data: {
          name: 'ask',
          options: [{ name: 'question', value: 'What is AI?' }]
        },
        user: {
          id: 'U123',
          username: 'testuser'
        },
        channel_id: 'C123',
        token: 'test-token'
      };

      await bot.handleInteraction(interaction);

      expect(handler).toHaveBeenCalledWith(interaction);
    });
  });
});
