import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Aggregator } from '../Aggregator';
import { Validator } from '../Validator';
import { Repairer } from '../Repairer';
import type { LLMClient } from '@main/ai/provider/LLMClient';

describe('Quality Loop', () => {
  let mockLLMClient: LLMClient;

  beforeEach(() => {
    mockLLMClient = {
      chat: vi.fn()
    } as unknown as LLMClient;

    // Mock Date.now() to ensure duration > 0
    let mockTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 100; // 每次调用增加 100ms
      return mockTime;
    });
  });

  describe('Aggregator', () => {
    it('should aggregate multiple agent outputs', async () => {
      const aggregator = new Aggregator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockResolvedValue({
        content: JSON.stringify({
          finalOutput: '汇总后的最终输出',
          summary: {
            completedTasks: ['任务1', '任务2'],
            failedTasks: [],
            keyFindings: ['发现1', '发现2'],
            recommendations: ['建议1']
          }
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const result = await aggregator.aggregate({
        userRequest: '测试请求',
        subTaskResults: [
          {
            taskId: 'task-1',
            agentName: 'Agent1',
            output: '输出1',
            status: 'success'
          },
          {
            taskId: 'task-2',
            agentName: 'Agent2',
            output: '输出2',
            status: 'success'
          }
        ]
      });

      expect(result.finalOutput).toBe('汇总后的最终输出');
      expect(result.summary.completedTasks).toEqual(['任务1', '任务2']);
      expect(result.isComplete).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle failed subtasks', async () => {
      const aggregator = new Aggregator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockResolvedValue({
        content: JSON.stringify({
          finalOutput: '部分汇总输出',
          summary: {
            completedTasks: ['任务1'],
            failedTasks: ['任务2: 执行失败'],
            keyFindings: ['发现1'],
            recommendations: ['建议1']
          }
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const result = await aggregator.aggregate({
        userRequest: '测试请求',
        subTaskResults: [
          {
            taskId: 'task-1',
            agentName: 'Agent1',
            output: '输出1',
            status: 'success'
          },
          {
            taskId: 'task-2',
            agentName: 'Agent2',
            output: '',
            status: 'failed',
            error: '执行失败'
          }
        ]
      });

      expect(result.isComplete).toBe(false);
      expect(result.summary.failedTasks.length).toBeGreaterThan(0);
    });

    it('should fallback gracefully on LLM failure', async () => {
      const aggregator = new Aggregator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockRejectedValue(new Error('LLM API 失败'));

      const result = await aggregator.aggregate({
        userRequest: '测试请求',
        subTaskResults: [
          {
            taskId: 'task-1',
            agentName: 'Agent1',
            output: '输出1',
            status: 'success'
          }
        ]
      });

      expect(result.finalOutput).toContain('输出1');
      expect(result.isComplete).toBe(false);
    });
  });

  describe('Validator', () => {
    it('should validate output quality and return scores', async () => {
      const validator = new Validator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockResolvedValue({
        content: JSON.stringify({
          passed: true,
          overallScore: 85,
          criteriaScores: [
            {
              criterion: '完整性',
              passed: true,
              score: 90,
              reason: '完整回答了用户的所有问题'
            },
            {
              criterion: '准确性',
              passed: true,
              score: 80,
              reason: '内容准确，无明显错误'
            }
          ],
          issues: []
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const result = await validator.validate({
        userRequest: '测试请求',
        output: '测试输出'
      });

      expect(result.passed).toBe(true);
      expect(result.overallScore).toBe(85);
      expect(result.criteriaScores.length).toBe(2);
      expect(result.issues.length).toBe(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should detect quality issues', async () => {
      const validator = new Validator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockResolvedValue({
        content: JSON.stringify({
          passed: false,
          overallScore: 65,
          criteriaScores: [
            {
              criterion: '完整性',
              passed: false,
              score: 60,
              reason: '缺少关键信息'
            }
          ],
          issues: [
            {
              severity: 'major',
              description: '输出不完整',
              suggestedFix: '补充缺失的内容'
            }
          ]
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const result = await validator.validate({
        userRequest: '测试请求',
        output: '不完整的输出'
      });

      expect(result.passed).toBe(false);
      expect(result.overallScore).toBe(65);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].severity).toBe('major');
    });

    it('should fallback on validation failure', async () => {
      const validator = new Validator(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockRejectedValue(new Error('验证失败'));

      const result = await validator.validate({
        userRequest: '测试请求',
        output: '测试输出'
      });

      expect(result.passed).toBe(true);
      expect(result.overallScore).toBe(70);
    });
  });

  describe('Repairer', () => {
    it('should generate repair plan for failed validation', async () => {
      const repairer = new Repairer(mockLLMClient);

      vi.mocked(mockLLMClient.chat).mockResolvedValue({
        content: '修复指令：\n1. 补充缺失的内容\n2. 修正错误',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const result = await repairer.generateRepairPlan({
        userRequest: '测试请求',
        currentOutput: '不完整的输出',
        validationResult: {
          passed: false,
          overallScore: 65,
          criteriaScores: [
            {
              criterion: '完整性',
              passed: false,
              score: 60,
              reason: '缺少关键信息'
            }
          ],
          issues: [
            {
              severity: 'major',
              description: '输出不完整',
              suggestedFix: '补充缺失的内容'
            }
          ],
          duration: 100
        },
        repairRound: 1
      });

      expect(result.shouldRepair).toBe(true);
      expect(result.strategy).toBe('regenerate');
      expect(result.repairInstructions).toContain('修复指令');
    });

    it('should suggest replan for very low scores', async () => {
      const repairer = new Repairer(mockLLMClient);

      const result = await repairer.generateRepairPlan({
        userRequest: '测试请求',
        currentOutput: '质量很差的输出',
        validationResult: {
          passed: false,
          overallScore: 30,
          criteriaScores: [],
          issues: [
            {
              severity: 'critical',
              description: '完全不符合要求',
              suggestedFix: '重新开始'
            }
          ],
          duration: 100
        },
        repairRound: 1
      });

      expect(result.shouldRepair).toBe(true);
      expect(result.strategy).toBe('replan');
    });

    it('should suggest patch for high scores', async () => {
      const repairer = new Repairer(mockLLMClient);

      const result = await repairer.generateRepairPlan({
        userRequest: '测试请求',
        currentOutput: '质量较高的输出',
        validationResult: {
          passed: false,
          overallScore: 85,
          criteriaScores: [],
          issues: [
            {
              severity: 'minor',
              description: '轻微格式问题',
              suggestedFix: '调整格式'
            }
          ],
          duration: 100
        },
        repairRound: 1
      });

      expect(result.shouldRepair).toBe(true);
      expect(result.strategy).toBe('patch');
    });

    it('should abort after max repair rounds', async () => {
      const repairer = new Repairer(mockLLMClient);

      const result = await repairer.generateRepairPlan({
        userRequest: '测试请求',
        currentOutput: '输出',
        validationResult: {
          passed: false,
          overallScore: 65,
          criteriaScores: [],
          issues: [],
          duration: 100
        },
        repairRound: 3
      });

      expect(result.shouldRepair).toBe(false);
      expect(result.strategy).toBe('abort');
    });
  });

  describe('Integration: Quality Loop', () => {
    it('should complete full quality loop: aggregate → validate → repair', async () => {
      const aggregator = new Aggregator(mockLLMClient);
      const validator = new Validator(mockLLMClient);
      const repairer = new Repairer(mockLLMClient);

      // Mock aggregation
      vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
        content: JSON.stringify({
          finalOutput: '初始汇总输出',
          summary: {
            completedTasks: ['任务1'],
            failedTasks: [],
            keyFindings: [],
            recommendations: []
          }
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      // Mock validation (failed)
      vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
        content: JSON.stringify({
          passed: false,
          overallScore: 65,
          criteriaScores: [],
          issues: [
            {
              severity: 'major',
              description: '质量不达标',
              suggestedFix: '优化内容'
            }
          ]
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      // Mock repair instructions
      vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
        content: '修复指令：优化内容质量',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      const aggregationResult = await aggregator.aggregate({
        userRequest: '测试请求',
        subTaskResults: [
          {
            taskId: 'task-1',
            agentName: 'Agent1',
            output: '输出1',
            status: 'success'
          }
        ]
      });

      expect(aggregationResult.finalOutput).toBe('初始汇总输出');

      const validationResult = await validator.validate({
        userRequest: '测试请求',
        output: aggregationResult.finalOutput
      });

      expect(validationResult.passed).toBe(false);
      expect(validationResult.overallScore).toBe(65);

      const repairPlan = await repairer.generateRepairPlan({
        userRequest: '测试请求',
        currentOutput: aggregationResult.finalOutput,
        validationResult,
        repairRound: 1
      });

      expect(repairPlan.shouldRepair).toBe(true);
      expect(repairPlan.repairInstructions).toContain('修复指令');
    });
  });
});
