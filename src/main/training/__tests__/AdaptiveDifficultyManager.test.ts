/**
 * AdaptiveDifficultyManager 测试
 */

import { describe, it, expect } from 'vitest';
import { AdaptiveDifficultyManager } from '../AdaptiveDifficultyManager';
import type { TrainingSession, TrainingTask, TrainingRoundResult } from '../types';

describe('AdaptiveDifficultyManager', () => {
  const createMockSession = (results: TrainingRoundResult[]): TrainingSession => {
    return {
      id: 'test-session',
      agentId: 'test-agent',
      goal: {
        name: 'Test Goal',
        description: 'Test description',
        dimensions: [],
        threshold: 70
      },
      dataset: {
        name: 'test-dataset',
        version: '1.0.0',
        category: 'test',
        trainSet: [],
        testSet: []
      },
      maxRounds: 100,
      strategy: 'adaptive',
      status: 'running',
      progress: {
        currentRound: results.length,
        totalRounds: 100,
        completedRounds: results.length,
        passedRounds: results.filter((r) => r.evaluation.passed).length,
        currentScore: 0,
        avgScore: 0
      },
      results,
      startTime: Date.now()
    };
  };

  const createMockResult = (round: number, score: number, passed: boolean): TrainingRoundResult => {
    const startTime = Date.now();
    const endTime = startTime + 1000;

    return {
      round,
      taskId: `task-${round}`,
      taskDescription: `Test task ${round}`,
      taskDifficulty: 3,
      output: 'test output',
      evaluation: {
        score,
        passed,
        dimensions: {},
        feedback: 'test feedback'
      },
      usedCoachAdvice: false,
      startTime,
      endTime,
      duration: endTime - startTime
    };
  };

  const createMockDataset = (): TrainingTask[] => {
    return [
      { id: 'easy-1', description: 'Easy task 1', difficulty: 1, category: 'test', expectedOutput: '' },
      { id: 'easy-2', description: 'Easy task 2', difficulty: 2, category: 'test', expectedOutput: '' },
      { id: 'medium-1', description: 'Medium task 1', difficulty: 3, category: 'test', expectedOutput: '' },
      { id: 'hard-1', description: 'Hard task 1', difficulty: 4, category: 'test', expectedOutput: '' },
      { id: 'hard-2', description: 'Hard task 2', difficulty: 5, category: 'test', expectedOutput: '' }
    ];
  };

  it('应该能够分析最近表现', () => {
    const manager = new AdaptiveDifficultyManager();

    const results: TrainingRoundResult[] = [
      createMockResult(1, 80, true),
      createMockResult(2, 85, true),
      createMockResult(3, 88, true),
      createMockResult(4, 92, true)
    ];

    const performance = manager.analyzeRecentPerformance(results, 4);

    expect(performance.avgScore).toBeCloseTo(86.25, 1);
    expect(performance.passRate).toBeCloseTo(1.0, 1);
    expect(performance.trend).toBe('improving'); // 后半段(88+92) > 前半段(80+85)
  });

  it('应该识别表现下降趋势', () => {
    const manager = new AdaptiveDifficultyManager();

    const results: TrainingRoundResult[] = [
      createMockResult(1, 90, true),
      createMockResult(2, 85, true),
      createMockResult(3, 75, true),
      createMockResult(4, 65, false)
    ];

    const performance = manager.analyzeRecentPerformance(results, 4);

    expect(performance.trend).toBe('declining');
    expect(performance.passRate).toBeLessThan(1.0);
  });

  it('应该根据表现选择合适难度的任务', () => {
    const manager = new AdaptiveDifficultyManager();
    const dataset = createMockDataset();

    // 高分表现 -> 应该选择更高难度
    const highScoreResults: TrainingRoundResult[] = [
      createMockResult(1, 90, true),
      createMockResult(2, 92, true),
      createMockResult(3, 95, true)
    ];

    const sessionHigh = createMockSession(highScoreResults);
    const taskHigh = manager.selectTaskWithAdaptiveDifficulty(sessionHigh, dataset);

    expect(taskHigh.difficulty).toBeGreaterThanOrEqual(3);

    // 低分表现 -> 应该选择较低难度
    const lowScoreResults: TrainingRoundResult[] = [
      createMockResult(1, 50, false),
      createMockResult(2, 55, false),
      createMockResult(3, 60, false)
    ];

    const sessionLow = createMockSession(lowScoreResults);
    const taskLow = manager.selectTaskWithAdaptiveDifficulty(sessionLow, dataset);

    expect(taskLow.difficulty).toBeLessThanOrEqual(3);
  });

  it('应该处理初始阶段（无历史结果）', () => {
    const manager = new AdaptiveDifficultyManager();
    const dataset = createMockDataset();
    const session = createMockSession([]);

    const task = manager.selectTaskWithAdaptiveDifficulty(session, dataset);

    // 初始阶段应该选择中等难度
    expect(task.difficulty).toBeGreaterThanOrEqual(2);
    expect(task.difficulty).toBeLessThanOrEqual(4);
  });

  it('应该处理单一难度的数据集', () => {
    const manager = new AdaptiveDifficultyManager();
    const singleDifficultyDataset: TrainingTask[] = [
      { id: 'task-1', description: 'Task 1', difficulty: 3, category: 'test', expectedOutput: '' },
      { id: 'task-2', description: 'Task 2', difficulty: 3, category: 'test', expectedOutput: '' }
    ];

    const session = createMockSession([createMockResult(1, 80, true)]);
    const task = manager.selectTaskWithAdaptiveDifficulty(session, singleDifficultyDataset);

    expect(task.difficulty).toBe(3);
  });

  it('应该识别稳定表现趋势', () => {
    const manager = new AdaptiveDifficultyManager();

    const results: TrainingRoundResult[] = [
      createMockResult(1, 75, true),
      createMockResult(2, 76, true),
      createMockResult(3, 75, true),
      createMockResult(4, 74, true)
    ];

    const performance = manager.analyzeRecentPerformance(results, 4);

    expect(performance.trend).toBe('stable');
  });

  it('应该处理空数据集', () => {
    const manager = new AdaptiveDifficultyManager();
    const session = createMockSession([createMockResult(1, 80, true)]);

    expect(() => {
      manager.selectTaskWithAdaptiveDifficulty(session, []);
    }).toThrow();
  });
});
