/**
 * ConsensusEngine 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConsensusEngine } from '../ConsensusEngine';
import { VotingAlgorithm } from '../VotingAlgorithm';
import { WeightCalculator } from '../WeightCalculator';

describe('ConsensusEngine', () => {
  let engine: ConsensusEngine;

  beforeEach(() => {
    engine = new ConsensusEngine();
  });

  describe('Vote creation', () => {
    it('should create vote with options', () => {
      const vote = engine.createVote('使用 Vue 还是 React?', ['Vue 3', 'React 18'], ['agent-1', 'agent-2', 'agent-3']);

      expect(vote.topic).toContain('Vue');
      expect(vote.options.length).toBe(2);
      expect(vote.participants.length).toBe(3);
      expect(vote.status).toBe('open');
    });
  });

  describe('Voting', () => {
    it('should record vote from agent', () => {
      const vote = engine.createVote('Test vote', ['Option A', 'Option B'], ['agent-1', 'agent-2']);

      const success = engine.castVote(vote.id, 'agent-1', ['option-0']);
      expect(success).toBe(true);

      const updated = engine.getVote(vote.id);
      expect(updated?.options[0].votes).toBe(1);
      expect(updated?.options[0].voters).toContain('agent-1');
    });

    it('should not allow voting from non-participants', () => {
      const vote = engine.createVote('Test vote', ['Option A', 'Option B'], ['agent-1']);

      const success = engine.castVote(vote.id, 'agent-999', ['option-0']);
      expect(success).toBe(false);
    });

    it('should allow vote change', () => {
      const vote = engine.createVote('Test vote', ['Option A', 'Option B'], ['agent-1']);

      engine.castVote(vote.id, 'agent-1', ['option-0']);
      engine.castVote(vote.id, 'agent-1', ['option-1']);

      const updated = engine.getVote(vote.id);
      expect(updated?.options[0].votes).toBe(0);
      expect(updated?.options[1].votes).toBe(1);
    });
  });

  describe('Result calculation', () => {
    it('should calculate simple majority result', () => {
      const vote = engine.createVote('Test vote', ['Option A', 'Option B', 'Option C'], ['a1', 'a2', 'a3', 'a4', 'a5']);

      engine.castVote(vote.id, 'a1', ['option-0']);
      engine.castVote(vote.id, 'a2', ['option-0']);
      engine.castVote(vote.id, 'a3', ['option-0']);
      engine.castVote(vote.id, 'a4', ['option-1']);
      engine.castVote(vote.id, 'a5', ['option-2']);

      const result = engine.closeVote(vote.id, { algorithm: 'simple-majority' });

      expect(result).not.toBeNull();
      expect(result?.winners).toContain('option-0');
      expect(result?.turnout).toBe(1.0);
    });

    it('should detect unanimous vote', () => {
      const vote = engine.createVote('Test vote', ['Option A', 'Option B'], ['a1', 'a2', 'a3']);

      engine.castVote(vote.id, 'a1', ['option-0']);
      engine.castVote(vote.id, 'a2', ['option-0']);
      engine.castVote(vote.id, 'a3', ['option-0']);

      const result = engine.closeVote(vote.id, { algorithm: 'unanimous' });

      expect(result?.winners).toEqual(['option-0']);
    });
  });
});

describe('VotingAlgorithm', () => {
  it('should be instantiable', () => {
    const algorithm = new VotingAlgorithm();
    expect(algorithm).toBeInstanceOf(VotingAlgorithm);
  });
});

describe('WeightCalculator', () => {
  let calculator: WeightCalculator;

  beforeEach(() => {
    calculator = new WeightCalculator();
  });

  it('should calculate weight based on performance', () => {
    const weight = calculator.calculateWeight('agent-1', {
      tasksCompleted: 100,
      tasksSuccessful: 90,
      averageQuality: 0.85,
      expertiseAreas: ['frontend', 'testing']
    });

    expect(weight.agentId).toBe('agent-1');
    expect(weight.weight).toBeGreaterThan(0);
    expect(weight.weight).toBeLessThanOrEqual(2.0);
  });

  it('should give lower weight for poor performance', () => {
    const weight = calculator.calculateWeight('agent-2', {
      tasksCompleted: 10,
      tasksSuccessful: 3,
      averageQuality: 0.5,
      expertiseAreas: []
    });

    expect(weight.weight).toBeLessThan(1.0);
  });

  it('should allow manual weight update', () => {
    calculator.updateWeight('agent-3', 1.5, '手动提升权重');

    const weight = calculator.getWeight('agent-3');
    expect(weight?.weight).toBe(1.5);
  });
});
