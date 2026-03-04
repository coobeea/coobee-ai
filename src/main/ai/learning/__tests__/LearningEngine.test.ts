/**
 * LearningEngine 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LearningEngine } from '../LearningEngine';
import type { LearningConfig } from '../types';

describe('LearningEngine', () => {
  let tmpDir: string;
  let engine: LearningEngine;

  const config: LearningConfig = {
    enabled: true,
    minSampleSize: 5,
    confidenceThreshold: 0.6,
    learningInterval: 60000
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-test-'));
    engine = new LearningEngine(tmpDir, config);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('Record execution', () => {
    it('should record task execution', () => {
      engine.recordExecution({
        taskId: 'task-1',
        agentId: 'agent-1',
        taskType: 'code-review',
        strategy: 'thorough',
        outcome: 'success',
        qualityScore: 0.9,
        duration: 5000,
        context: {
          inputLength: 1000,
          outputLength: 500,
          iterations: 1
        }
      });

      const stats = engine.getStatistics();
      expect(stats.totalRecords).toBe(1);
    });

    it('should accumulate multiple records', () => {
      for (let i = 0; i < 10; i++) {
        engine.recordExecution({
          taskId: `task-${i}`,
          agentId: 'agent-1',
          taskType: 'testing',
          strategy: 'comprehensive',
          outcome: i % 2 === 0 ? 'success' : 'failure',
          qualityScore: i % 2 === 0 ? 0.8 : 0.4,
          duration: 3000,
          context: {
            inputLength: 500,
            outputLength: 200,
            iterations: 1
          }
        });
      }

      const stats = engine.getStatistics();
      expect(stats.totalRecords).toBe(10);
      expect(stats.successRate).toBe(0.5);
    });
  });

  describe('Pattern recognition', () => {
    it('should learn patterns from records', async () => {
      for (let i = 0; i < 10; i++) {
        engine.recordExecution({
          taskId: `task-${i}`,
          agentId: 'agent-1',
          taskType: 'code-review',
          strategy: 'thorough',
          outcome: 'success',
          qualityScore: 0.85,
          duration: 4000,
          context: {
            inputLength: 1000,
            outputLength: 500,
            iterations: 1
          }
        });
      }

      await engine.learn();

      const patterns = engine.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);

      const codeReviewPattern = patterns.find((p) => p.taskType === 'code-review');
      expect(codeReviewPattern).toBeDefined();
      expect(codeReviewPattern?.recommendedStrategy).toBe('thorough');
    });
  });

  describe('Strategy recommendation', () => {
    it('should recommend better strategy', async () => {
      for (let i = 0; i < 10; i++) {
        engine.recordExecution({
          taskId: `task-${i}`,
          agentId: 'agent-1',
          taskType: 'testing',
          strategy: 'comprehensive',
          outcome: 'success',
          qualityScore: 0.9,
          duration: 5000,
          context: {
            inputLength: 1000,
            outputLength: 500,
            iterations: 1
          }
        });
      }

      for (let i = 0; i < 5; i++) {
        engine.recordExecution({
          taskId: `task-old-${i}`,
          agentId: 'agent-1',
          taskType: 'testing',
          strategy: 'quick',
          outcome: 'partial',
          qualityScore: 0.5,
          duration: 2000,
          context: {
            inputLength: 500,
            outputLength: 200,
            iterations: 1
          }
        });
      }

      await engine.learn();

      const recommendation = engine.getRecommendation('testing', 'quick');

      expect(recommendation).not.toBeNull();
      expect(recommendation?.recommendedStrategy).toBe('comprehensive');
      expect(recommendation?.expectedImprovement).toBeGreaterThan(0);
    });

    it('should return null if no better strategy found', async () => {
      for (let i = 0; i < 10; i++) {
        engine.recordExecution({
          taskId: `task-${i}`,
          agentId: 'agent-1',
          taskType: 'refactoring',
          strategy: 'best-practice',
          outcome: 'success',
          qualityScore: 0.95,
          duration: 6000,
          context: {
            inputLength: 2000,
            outputLength: 1500,
            iterations: 1
          }
        });
      }

      await engine.learn();

      const recommendation = engine.getRecommendation('refactoring', 'best-practice');

      expect(recommendation).toBeNull();
    });
  });
});
