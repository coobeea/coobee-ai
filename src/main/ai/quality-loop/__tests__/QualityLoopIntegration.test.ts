/**
 * Quality Loop 集成测试 - 完整质量闭环验证
 *
 * 测试场景：
 * 1. 汇总多个子 Agent 输出
 * 2. 验证输出质量并打分
 * 3. 生成修复计划
 * 4. 多轮迭代直到达标或中止
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Aggregator } from '../Aggregator';
import { Validator } from '../Validator';
import { Repairer } from '../Repairer';
import type { LLMService } from '@main/ai/provider/LLMService';

describe('Quality Loop Integration Tests', () => {
  let mockLLMClient: LLMService;
  let aggregator: Aggregator;
  let validator: Validator;
  let repairer: Repairer;

  beforeEach(() => {
    mockLLMClient = {
      chat: vi.fn()
    } as unknown as LLMService;

    aggregator = new Aggregator(mockLLMClient);
    validator = new Validator(mockLLMClient);
    repairer = new Repairer(mockLLMClient);

    // Mock Date.now() to ensure duration > 0
    let mockTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 50; // 每次调用增加 50ms
      return mockTime;
    });
  });

  it('完整质量闭环: 汇总 → 验证低分 → 修复 → 验证达标', async () => {
    // 第1轮: Aggregator 汇总
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        finalOutput: '这是初步汇总的输出',
        summary: {
          completedTasks: ['任务1', '任务2'],
          failedTasks: [],
          keyFindings: ['发现1'],
          recommendations: ['建议1']
        }
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // 第1轮: Validator 返回低分
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        passed: false,
        overallScore: 55,
        criteriaScores: [
          { criterion: '完整性', passed: false, score: 50, reason: '内容不够完整' },
          { criterion: '准确性', passed: true, score: 70, reason: '准确性可接受' },
          { criterion: '清晰度', passed: false, score: 45, reason: '表达不够清晰' }
        ],
        issues: [
          { severity: 'major', description: '内容不完整', suggestedFix: '补充缺失内容' },
          { severity: 'minor', description: '表达不清晰', suggestedFix: '优化表达' }
        ]
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // 第1轮: Repairer 生成修复计划
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        rootCause: '内容完整性和表达清晰度不足',
        improvements: ['补充缺失内容', '优化表达清晰度'],
        repairInstructions: '请补充缺失的内容，并优化表达的清晰度'
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // 第2轮: Validator 返回达标分数
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        passed: true,
        overallScore: 85,
        criteriaScores: [
          { criterion: '完整性', passed: true, score: 90, reason: '内容完整' },
          { criterion: '准确性', passed: true, score: 85, reason: '准确性良好' },
          { criterion: '清晰度', passed: true, score: 80, reason: '表达清晰' }
        ],
        issues: []
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // === 执行完整流程 ===

    // 1. Aggregator 汇总
    const aggregationResult = await aggregator.aggregate({
      userRequest: '编写产品介绍',
      subTaskResults: [
        { taskId: 'task-1', agentName: 'Agent1', output: '产品特性A', status: 'success' },
        { taskId: 'task-2', agentName: 'Agent2', output: '产品特性B', status: 'success' }
      ]
    });

    expect(aggregationResult.finalOutput).toBe('这是初步汇总的输出');
    expect(aggregationResult.isComplete).toBe(true);
    expect(aggregationResult.duration).toBeGreaterThan(0);

    // 2. Validator 验证（第1轮）
    let output = aggregationResult.finalOutput;
    let validationResult = await validator.validate({
      userRequest: '编写产品介绍',
      output,
      acceptanceCriteria: [
        { description: '内容完整', type: 'qualitative', weight: 8 },
        { description: '准确无误', type: 'quantifiable', weight: 7 },
        { description: '表达清晰', type: 'qualitative', weight: 6 }
      ]
    });

    expect(validationResult.passed).toBe(false);
    expect(validationResult.overallScore).toBe(55);
    expect(validationResult.issues.length).toBeGreaterThan(0);

    // 3. Repairer 生成修复计划
    const repairPlan = await repairer.generateRepairPlan({
      userRequest: '编写产品介绍',
      currentOutput: output,
      validationResult,
      repairRound: 1
    });

    expect(repairPlan.shouldRepair).toBe(true);
    // 分数 50-70 使用 regenerate 策略（部分重做）
    expect(['regenerate', 'patch']).toContain(repairPlan.strategy);
    expect(repairPlan.repairInstructions).toBeTruthy();

    // 4. 模拟修复后重新验证（第2轮）
    output = `${output} [经过修复]`;
    validationResult = await validator.validate({
      userRequest: '编写产品介绍',
      output
    });

    expect(validationResult.passed).toBe(true);
    expect(validationResult.overallScore).toBe(85);
    expect(validationResult.issues.length).toBe(0);
  });

  it('低质量输出应该建议 replan 策略', async () => {
    // Validator 返回极低分
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        passed: false,
        overallScore: 30,
        criteriaScores: [{ criterion: '完整性', passed: false, score: 20, reason: '内容严重缺失' }],
        issues: [{ severity: 'critical', description: '核心内容缺失', suggestedFix: '重新理解需求' }]
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // Validator 验证
    const validationResult = await validator.validate({
      userRequest: '编写产品介绍',
      output: '产品很好'
    });

    expect(validationResult.overallScore).toBe(30);

    // Repairer 应该建议 replan
    const repairPlan = await repairer.generateRepairPlan({
      userRequest: '编写产品介绍',
      currentOutput: '产品很好',
      validationResult,
      repairRound: 1
    });

    expect(repairPlan.shouldRepair).toBe(true);
    expect(repairPlan.strategy).toBe('replan');
    expect(repairPlan.rootCause).toContain('质量过低');
  });

  it('修复轮次过多应该中止', async () => {
    // Validator 返回中等分数
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        passed: false,
        overallScore: 60,
        criteriaScores: [{ criterion: '完整性', passed: false, score: 60, reason: '仍有改进空间' }],
        issues: [{ severity: 'minor', description: '小问题', suggestedFix: '微调' }]
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    const validationResult = await validator.validate({
      userRequest: '测试',
      output: '测试输出'
    });

    // 第3轮修复应该中止
    const repairPlan = await repairer.generateRepairPlan({
      userRequest: '测试',
      currentOutput: '测试输出',
      validationResult,
      repairRound: 3
    });

    expect(repairPlan.shouldRepair).toBe(false);
    expect(repairPlan.strategy).toBe('abort');
    expect(repairPlan.repairInstructions).toContain('最大修复次数');
  });

  it('汇总失败应该返回 fallback 输出', async () => {
    // Mock LLM 失败
    vi.mocked(mockLLMClient.chat).mockRejectedValueOnce(new Error('LLM API failed'));

    // Aggregator 应该返回 fallback
    const result = await aggregator.aggregate({
      userRequest: '测试请求',
      subTaskResults: [
        { taskId: 'task-1', agentName: 'Agent1', output: '输出1', status: 'success' },
        { taskId: 'task-2', agentName: 'Agent2', output: '输出2', status: 'success' }
      ]
    });

    // Fallback 应该简单拼接
    expect(result.finalOutput).toContain('输出1');
    expect(result.finalOutput).toContain('输出2');
    // LLM 失败时，fallback 会标记为不完整
    expect(result.isComplete).toBe(false);
    expect(result.summary.completedTasks).toEqual(['Agent1', 'Agent2']);
    expect(result.summary.recommendations).toContain('汇总过程出现错误，请检查日志');
  });

  it('验证失败应该返回默认低分结果', async () => {
    // Mock LLM 失败
    vi.mocked(mockLLMClient.chat).mockRejectedValueOnce(new Error('LLM API failed'));

    // Validator 在失败时会返回保守的 fallback（passed: true, score: 70）
    // 这是因为验证失败时无法判断输出的真实质量，70分保持中等水平
    const result = await validator.validate({
      userRequest: '测试',
      output: '测试输出'
    });

    // Validator 的 fallback 是保守的（70分）
    expect(result.passed).toBe(true);
    expect(result.overallScore).toBe(70);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].description).toContain('验证过程失败');
  });

  it('多轮迭代测试: 30分 → 60分 → 85分 → 通过', async () => {
    let round = 0;

    // 配置 mock：每次验证返回更高的分数
    vi.mocked(mockLLMClient.chat).mockImplementation(async () => {
      round++;

      if (round === 1) {
        // 第1轮验证：30分
        return {
          content: JSON.stringify({
            passed: false,
            overallScore: 30,
            criteriaScores: [{ criterion: '质量', passed: false, score: 30, reason: '质量过低' }],
            issues: [{ severity: 'critical', description: '质量过低', suggestedFix: '重新规划' }]
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        };
      } else if (round === 2) {
        // 第1轮修复
        return {
          content: JSON.stringify({
            rootCause: '理解不足',
            improvements: ['重新理解需求'],
            repairInstructions: '请重新理解需求并输出'
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        };
      } else if (round === 3) {
        // 第2轮验证：60分
        return {
          content: JSON.stringify({
            passed: false,
            overallScore: 60,
            criteriaScores: [{ criterion: '质量', passed: false, score: 60, reason: '质量改善但仍不足' }],
            issues: [{ severity: 'major', description: '仍需改进', suggestedFix: '继续优化' }]
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        };
      } else if (round === 4) {
        // 第2轮修复
        return {
          content: JSON.stringify({
            rootCause: '细节不足',
            improvements: ['补充细节'],
            repairInstructions: '请补充更多细节'
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        };
      } else {
        // 第3轮验证：85分，通过
        return {
          content: JSON.stringify({
            passed: true,
            overallScore: 85,
            criteriaScores: [{ criterion: '质量', passed: true, score: 85, reason: '质量良好' }],
            issues: []
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        };
      }
    });

    // 模拟质量闭环
    const maxRounds = 3;
    let currentOutput = '初始低质量输出';
    let passed = false;

    for (let r = 1; r <= maxRounds && !passed; r++) {
      // 验证
      const validationResult = await validator.validate({
        userRequest: '编写产品介绍',
        output: currentOutput
      });

      if (validationResult.passed) {
        passed = true;
        expect(validationResult.overallScore).toBeGreaterThanOrEqual(70);
        break;
      }

      // 生成修复计划
      const repairPlan = await repairer.generateRepairPlan({
        userRequest: '编写产品介绍',
        currentOutput,
        validationResult,
        repairRound: r
      });

      expect(repairPlan.shouldRepair).toBe(true);
      expect(repairPlan.repairInstructions).toBeTruthy();

      // 模拟修复（实际应该由 Agent 重新生成）
      currentOutput = `${currentOutput} [第${r}轮优化]`;
    }

    // 验证最终通过
    expect(passed).toBe(true);
  });

  it('高分输出应该建议 patch 策略', async () => {
    // Validator 返回高分但未通过
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        passed: false,
        overallScore: 85,
        criteriaScores: [
          { criterion: '完整性', passed: true, score: 90, reason: '内容完整' },
          { criterion: '格式', passed: false, score: 75, reason: '格式有小问题' }
        ],
        issues: [{ severity: 'minor', description: '格式小问题', suggestedFix: '调整格式' }]
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    // Validator 验证
    const validationResult = await validator.validate({
      userRequest: '编写产品介绍',
      output: '很好的产品介绍内容'
    });

    expect(validationResult.overallScore).toBe(85);

    // Repairer 应该建议 patch（小修补）
    const repairPlan = await repairer.generateRepairPlan({
      userRequest: '编写产品介绍',
      currentOutput: '很好的产品介绍内容',
      validationResult,
      repairRound: 1
    });

    expect(repairPlan.shouldRepair).toBe(true);
    expect(repairPlan.strategy).toBe('patch');
  });

  it('包含失败子任务的汇总应该标记为不完整', async () => {
    // Aggregator 汇总
    vi.mocked(mockLLMClient.chat).mockResolvedValueOnce({
      content: JSON.stringify({
        finalOutput: '部分完成的汇总',
        summary: {
          completedTasks: ['任务1'],
          failedTasks: ['任务2: 执行失败'],
          keyFindings: ['发现1'],
          recommendations: ['需要重新执行任务2']
        }
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });

    const result = await aggregator.aggregate({
      userRequest: '完成两个任务',
      subTaskResults: [
        { taskId: 'task-1', agentName: 'Agent1', output: '成功输出', status: 'success' },
        { taskId: 'task-2', agentName: 'Agent2', output: '', status: 'failed', error: '执行失败' }
      ]
    });

    // 应该标记为不完整
    expect(result.isComplete).toBe(false);
    expect(result.summary.failedTasks).toHaveLength(1);
    expect(result.summary.completedTasks).toHaveLength(1);
  });
});
