/**
 * GoalChecker 单元测试
 */

import { describe, it, expect } from 'vitest';
import { TestPassChecker } from '../checkers/TestPassChecker';
import { LintPassChecker } from '../checkers/LintPassChecker';
import { CustomScriptChecker } from '../checkers/CustomScriptChecker';
import type { ExecutionContext } from '../types';

describe('GoalChecker', () => {
  const mockContext: ExecutionContext = {
    sessionId: 'test-session',
    taskId: 'test-task',
    workspace: process.cwd(),
    iteration: 1,
    maxIterations: 10
  };

  describe('TestPassChecker', () => {
    it('should pass when tests succeed', async () => {
      const checker = new TestPassChecker('echo "5 passed"');
      const result = await checker.check(mockContext);

      expect(result.achieved).toBe(true);
      expect(result.metadata?.passed).toBeGreaterThan(0);
    });

    it('should fail when tests fail', async () => {
      const checker = new TestPassChecker('exit 1');
      const result = await checker.check(mockContext);

      expect(result.achieved).toBe(false);
      expect(result.feedback).toContain('失败');
    });

    it('should have correct name and description', () => {
      const checker = new TestPassChecker();
      expect(checker.name).toBe('test-pass');
      expect(checker.description).toContain('测试');
    });
  });

  describe('LintPassChecker', () => {
    it('should have correct name and description', () => {
      const checker = new LintPassChecker();
      expect(checker.name).toBe('lint-pass');
      expect(checker.description).toContain('Linter');
    });
  });

  describe('CustomScriptChecker', () => {
    it('should pass when script succeeds', async () => {
      const checker = new CustomScriptChecker('echo "success"', '检查通过', '检查失败');
      const result = await checker.check(mockContext);

      expect(result.achieved).toBe(true);
      expect(result.feedback).toContain('通过');
    });

    it('should fail when script exits with non-zero', async () => {
      const checker = new CustomScriptChecker('exit 1', '检查通过', '检查失败');
      const result = await checker.check(mockContext);

      expect(result.achieved).toBe(false);
      expect(result.feedback).toContain('失败');
    });

    it('should have correct name and description', () => {
      const checker = new CustomScriptChecker('echo "test"');
      expect(checker.name).toBe('custom-script');
      expect(checker.description).toContain('自定义');
    });

    it('should include output in metadata', async () => {
      const checker = new CustomScriptChecker('echo "test output"');
      const result = await checker.check(mockContext);

      expect(result.metadata?.output).toBeDefined();
      expect(typeof result.metadata?.output).toBe('string');
    });
  });
});
