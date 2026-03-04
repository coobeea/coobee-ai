/**
 * DiscussionRoom 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiscussionRoom } from '../DiscussionRoom';
import { TurnManager } from '../TurnManager';
import { ConsensusDetector } from '../ConsensusDetector';
import type { DiscussionParticipant } from '../types';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('DiscussionRoom', () => {
  let testDir: string;
  const mockParticipants: DiscussionParticipant[] = [
    { agentId: 'agent-1', name: 'Frontend Expert', role: '前端专家', active: true },
    { agentId: 'agent-2', name: 'Backend Expert', role: '后端专家', active: true },
    { agentId: 'agent-3', name: 'Architect', role: '架构师', active: true }
  ];

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(__dirname, 'tmp-discussion-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create discussion room with participants', () => {
      const room = new DiscussionRoom({
        topic: 'Technical Design Discussion',
        participants: mockParticipants
      });

      const session = room.getSession();
      expect(session.topic).toBe('Technical Design Discussion');
      expect(session.participants.length).toBe(3);
      expect(session.status).toBe('active');
    });
  });

  describe('message management', () => {
    it('should add message to discussion', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      await room.addMessage('agent-1', 'I think we should use Vue 3', 'statement');

      const messages = room.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].agentId).toBe('agent-1');
      expect(messages[0].content).toContain('Vue 3');
    });

    it('should track multiple messages', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      await room.addMessage('agent-1', 'Message 1', 'statement');
      await room.addMessage('agent-2', 'Message 2', 'question');
      await room.addMessage('agent-3', 'Message 3', 'answer');

      const messages = room.getMessages();
      expect(messages.length).toBe(3);
    });
  });

  describe('turn management', () => {
    it('should rotate speakers in round-robin', () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants,
        turnStrategy: 'round-robin'
      });

      const speaker1 = room.getNextSpeaker();
      const speaker2 = room.getNextSpeaker();
      const speaker3 = room.getNextSpeaker();
      const speaker4 = room.getNextSpeaker();

      expect(speaker1?.agentId).toBe('agent-1');
      expect(speaker2?.agentId).toBe('agent-2');
      expect(speaker3?.agentId).toBe('agent-3');
      expect(speaker4?.agentId).toBe('agent-1');
    });
  });

  describe('consensus detection', () => {
    it('should detect consensus when threshold is met', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      await room.addMessage('agent-1', '我同意使用 Vue 3', 'agreement');
      await room.addMessage('agent-2', '我也赞成这个方案', 'agreement');
      await room.addMessage('agent-3', '支持，LGTM', 'agreement');

      const consensus = await room.checkConsensus();
      expect(consensus.achieved).toBe(true);
      expect(consensus.level).toBeGreaterThan(0.7);
    });

    it('should not detect consensus when disagreements exist', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      await room.addMessage('agent-1', '我同意', 'agreement');
      await room.addMessage('agent-2', '我反对', 'objection');
      await room.addMessage('agent-3', '我不同意', 'objection');

      const consensus = await room.checkConsensus();
      expect(consensus.achieved).toBe(false);
    });
  });

  describe('session lifecycle', () => {
    it('should pause and resume discussion', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      expect(room.getSession().status).toBe('active');

      await room.pause();
      expect(room.getSession().status).toBe('paused');

      await room.resume();
      expect(room.getSession().status).toBe('active');
    });

    it('should end discussion', async () => {
      const room = new DiscussionRoom({
        topic: 'Test Discussion',
        participants: mockParticipants
      });

      await room.start();
      await room.end('讨论已结束，达成一致意见');

      const session = room.getSession();
      expect(session.status).toBe('completed');
      expect(session.messages.some((m) => m.type === 'summary')).toBe(true);
    });
  });
});

describe('TurnManager', () => {
  const mockParticipants: DiscussionParticipant[] = [
    { agentId: 'a1', name: 'Agent 1', active: true },
    { agentId: 'a2', name: 'Agent 2', active: true },
    { agentId: 'a3', name: 'Agent 3', active: true }
  ];

  it('should rotate in round-robin', () => {
    const manager = new TurnManager('round-robin');
    manager.setParticipants(mockParticipants);

    const speakers = [
      manager.getNextSpeaker(),
      manager.getNextSpeaker(),
      manager.getNextSpeaker(),
      manager.getNextSpeaker()
    ];

    expect(speakers[0]?.agentId).toBe('a1');
    expect(speakers[1]?.agentId).toBe('a2');
    expect(speakers[2]?.agentId).toBe('a3');
    expect(speakers[3]?.agentId).toBe('a1');
  });

  it('should handle weighted strategy', () => {
    const weightedParticipants: DiscussionParticipant[] = [
      { agentId: 'a1', name: 'Agent 1', weight: 0.5, active: true },
      { agentId: 'a2', name: 'Agent 2', weight: 0.3, active: true },
      { agentId: 'a3', name: 'Agent 3', weight: 0.2, active: true }
    ];

    const manager = new TurnManager('weighted');
    manager.setParticipants(weightedParticipants);

    const speaker = manager.getNextSpeaker();
    expect(speaker).not.toBeNull();
  });
});

describe('ConsensusDetector', () => {
  const detector = new ConsensusDetector();

  it('should detect high consensus', async () => {
    const messages: any[] = [
      { agentId: 'a1', content: '我同意', type: 'agreement', timestamp: Date.now() },
      { agentId: 'a2', content: '我也赞成', type: 'agreement', timestamp: Date.now() },
      { agentId: 'a3', content: 'LGTM', type: 'agreement', timestamp: Date.now() }
    ];

    const result = await detector.detect(messages);
    expect(result.achieved).toBe(true);
    expect(result.level).toBeGreaterThanOrEqual(0.7);
  });

  it('should detect low consensus', async () => {
    const messages: any[] = [
      { agentId: 'a1', content: '我同意', type: 'agreement', timestamp: Date.now() },
      { agentId: 'a2', content: '我反对', type: 'objection', timestamp: Date.now() },
      { agentId: 'a3', content: '我有异议', type: 'objection', timestamp: Date.now() }
    ];

    const result = await detector.detect(messages);
    expect(result.achieved).toBe(false);
    expect(result.level).toBeLessThan(0.7);
  });
});
