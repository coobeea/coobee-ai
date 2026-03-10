/**
 * DebateArena 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DebateArena } from '../DebateArena';
import type { DebateRules } from '../types';

describe('DebateArena', () => {
  let arena: DebateArena;

  const rules: DebateRules = {
    maxRounds: 3,
    timePerRound: 60,
    allowInterruptions: false,
    judgeMode: 'ai'
  };

  beforeEach(() => {
    arena = new DebateArena();
  });

  describe('Session creation', () => {
    it('should create debate session', () => {
      const session = arena.createSession(
        'AI 是否会取代人类程序员？',
        [
          { agentId: 'agent-pro', stance: 'pro' },
          { agentId: 'agent-con', stance: 'con' }
        ],
        rules
      );

      expect(session.topic).toContain('AI');
      expect(session.participants.length).toBe(2);
      expect(session.status).toBe('pending');
      expect(session.totalRounds).toBe(3);
    });
  });

  describe('Debate flow', () => {
    it('should start debate', async () => {
      const session = arena.createSession(
        'Test topic',
        [
          { agentId: 'agent-1', stance: 'pro' },
          { agentId: 'agent-2', stance: 'con' }
        ],
        rules
      );

      await arena.start(session.id);

      const updated = arena.getSession(session.id);
      expect(updated?.status).toBe('active');
    });

    it('should submit arguments', async () => {
      const session = arena.createSession(
        'Test topic',
        [
          { agentId: 'agent-1', stance: 'pro' },
          { agentId: 'agent-2', stance: 'con' }
        ],
        rules
      );

      await arena.start(session.id);

      const arg1 = arena.submitArgument(session.id, 'agent-1', 'AI 可以提高开发效率', undefined, ['研究报告 A']);

      expect(arg1.content).toContain('效率');
      expect(arg1.stance).toBe('pro');
      expect(arg1.strength).toBeGreaterThan(0);

      const arg2 = arena.submitArgument(session.id, 'agent-2', '但 AI 缺乏创造力', arg1.id);

      expect(arg2.rebuttalTo).toBe(arg1.id);

      const updated = arena.getSession(session.id);
      expect(updated?.arguments.length).toBe(2);
    });

    it('should progress through rounds', async () => {
      const session = arena.createSession(
        'Test topic',
        [
          { agentId: 'agent-1', stance: 'pro' },
          { agentId: 'agent-2', stance: 'con' }
        ],
        { ...rules, maxRounds: 2 }
      );

      await arena.start(session.id);

      arena.nextRound(session.id);
      let updated = arena.getSession(session.id);
      expect(updated?.currentRound).toBe(1);

      arena.nextRound(session.id);
      updated = arena.getSession(session.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.verdict).toBeDefined();
    });
  });

  describe('Conclusion and verdict', () => {
    it('should conclude debate and determine winner', async () => {
      const session = arena.createSession(
        'Test topic',
        [
          { agentId: 'agent-pro', stance: 'pro' },
          { agentId: 'agent-con', stance: 'con' }
        ],
        rules
      );

      await arena.start(session.id);

      arena.submitArgument(session.id, 'agent-pro', '强有力的论点支持正方观点，并且有充分的证据支持。', undefined, ['证据1', '证据2', '证据3']);

      arena.submitArgument(session.id, 'agent-con', '反方论点', undefined, ['证据A']);

      arena.conclude(session.id);

      const updated = arena.getSession(session.id);

      expect(updated?.status).toBe('completed');
      expect(updated?.verdict).toBeDefined();
      expect(updated?.verdict?.winner).toBe('pro');
    });
  });

  describe('Argument strength calculation', () => {
    it('should calculate strength based on content and evidence', async () => {
      const session = arena.createSession(
        'Test',
        [{ agentId: 'agent-1', stance: 'pro' }],
        rules
      );

      await arena.start(session.id);

      const shortArg = arena.submitArgument(session.id, 'agent-1', '短论点');
      const longArg = arena.submitArgument(session.id, 'agent-1', '这是一个非常详细和充分的论点，包含了大量的分析和推理过程。');
      const evidencedArg = arena.submitArgument(session.id, 'agent-1', '有证据支持的论点', undefined, ['证据1', '证据2']);

      expect(longArg.strength).toBeGreaterThan(shortArg.strength);
      expect(evidencedArg.strength).toBeGreaterThan(shortArg.strength);
    });
  });
});
