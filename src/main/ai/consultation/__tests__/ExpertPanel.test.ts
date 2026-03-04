/**
 * ExpertPanel 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ExpertPanel } from '../ExpertPanel';
import { OpinionAggregator } from '../OpinionAggregator';
import type { ExpertOpinion } from '../types';

describe('ExpertPanel', () => {
  const mockExperts = [
    { agentId: 'expert-1', roleName: '安全专家', specialty: '安全' },
    { agentId: 'expert-2', roleName: '性能专家', specialty: '性能' },
    { agentId: 'expert-3', roleName: '架构专家', specialty: '架构' }
  ];

  it('should create consultation session', () => {
    const panel = new ExpertPanel({
      question: '我们应该使用微服务架构吗？',
      experts: mockExperts
    });

    const session = panel.getSession();
    expect(session.question).toContain('微服务');
    expect(session.experts.length).toBe(3);
    expect(session.status).toBe('pending');
  });

  it('should gather opinions and generate conclusion', async () => {
    const panel = new ExpertPanel({
      question: '我们应该使用微服务架构吗？',
      experts: mockExperts
    });

    const result = await panel.consult();

    expect(result.status).toBe('completed');
    expect(result.opinions.length).toBe(3);
    expect(result.conclusion).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });
});

describe('OpinionAggregator', () => {
  const aggregator = new OpinionAggregator();

  const mockOpinions: ExpertOpinion[] = [
    {
      agentId: 'e1',
      roleName: '专家1',
      content: '我认为这个方案可行',
      confidence: 0.9,
      type: 'approval',
      timestamp: Date.now()
    },
    {
      agentId: 'e2',
      roleName: '专家2',
      content: '我有一些担忧',
      confidence: 0.7,
      type: 'warning',
      timestamp: Date.now()
    },
    {
      agentId: 'e3',
      roleName: '专家3',
      content: '我建议采用这个方案',
      confidence: 0.85,
      type: 'suggestion',
      timestamp: Date.now()
    }
  ];

  it('should aggregate using majority-vote', async () => {
    const result = await aggregator.aggregate(mockOpinions, 'majority-vote');
    expect(result).toContain('专家');
    expect(typeof result).toBe('string');
  });

  it('should aggregate using weighted-average', async () => {
    const result = await aggregator.aggregate(mockOpinions, 'weighted-average');
    expect(result).toContain('置信度');
    expect(result).toContain('%');
  });

  it('should aggregate using consensus-first', async () => {
    const result = await aggregator.aggregate(mockOpinions, 'consensus-first');
    expect(result).toContain('综合结论');
  });

  it('should handle empty opinions', async () => {
    const result = await aggregator.aggregate([]);
    expect(result).toBe('无专家意见');
  });
});
