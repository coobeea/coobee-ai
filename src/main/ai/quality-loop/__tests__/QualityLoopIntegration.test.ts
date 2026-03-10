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
import type { LLMChatFn } from '../llm-chat';

describe('Quality Loop Integration Tests', () => {
  let mockLLMChat: LLMChatFn;
  let aggregator: Aggregator;
  let validator: Validator;
  let repairer: Repairer;

  beforeEach(() => {
    mockLLMChat = vi.fn();

    aggregator = new Aggregator(mockLLMChat);
    validator = new Validator(mockLLMChat);
    repairer = new Repairer(mockLLMChat);

    let mockTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 50;
      return mockTime;
    });
  });

  it('完整质量闭环: 汇总 → 验证低分 → 修复 → 验证达标', async () => {
    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        finalOutput: '这是初步汇总的输出',
        summary: {
          completedTasks: ['任务1', '任务2'],
          failedTasks: [],
          keyFindings: ['发现1'],
          recommendations: ['建议1']
        }
      })
    );

    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
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
      })
    );

    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        rootCause: '内容完整性和表达清晰度不足',
        improvements: ['补充缺失内容', '优化表达清晰度'],
        repairInstructions: '请补充缺失的内容，并优化表达的清晰度'
      })
    );

    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        passed: true,
        overallScore: 85,
        criteriaScores: [
          { criterion: '完整性', passed: true, score: 90, reason: '内容完整' },
          { criterion: '准确性', passed: true, score: 85, reason: '准确性良好' },
          { criterion: '清晰度', passed: true, score: 80, reason: '表达清晰' }
        ],
        issues: []
      })
    );

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
    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        passed: false,
        overallScore: 30,
        criteriaScores: [{ criterion: '完整性', passed: false, score: 20, reason: '内容严重缺失' }],
        issues: [{ severity: 'critical', description: '核心内容缺失', suggestedFix: '重新理解需求' }]
      })
    );

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
    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        passed: false,
        overallScore: 60,
        criteriaScores: [{ criterion: '完整性', passed: false, score: 60, reason: '仍有改进空间' }],
        issues: [{ severity: 'minor', description: '小问题', suggestedFix: '微调' }]
      })
    );

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
    vi.mocked(mockLLMChat).mockRejectedValueOnce(new Error('LLM API failed'));

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

  it('验证失败应该返回未通过结果', async () => {
    vi.mocked(mockLLMChat).mockRejectedValueOnce(new Error('LLM API failed'));

    const result = await validator.validate({
      userRequest: '测试',
      output: '测试输出'
    });

    expect(result.passed).toBe(false);
    expect(result.overallScore).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('critical');
    expect(result.issues[0].description).toContain('验证过程失败');
  });

  it('多轮迭代测试: 55分 → 65分 → 85分 → 通过', async () => {
    let callCount = 0;

    // Mock 按调用顺序返回不同结果
    // Repairer 在 50-80 分范围会调用 LLM（regenerate 策略）
    vi.mocked(mockLLMChat).mockImplementation(async () => {
      callCount++;

      switch (callCount) {
        case 1:
          // 第1轮验证：55分（50-80 范围，触发 regenerate）
          return JSON.stringify({
            passed: false,
            overallScore: 55,
            criteriaScores: [{ criterion: '质量', passed: false, score: 55, reason: '质量不足' }],
            issues: [{ severity: 'major', description: '质量不足', suggestedFix: '优化内容' }]
          });
        case 2:
          // 第1轮修复 LLM 调用（regenerate 策略需要 LLM）
          return '修复指令：1. 补充缺失内容 2. 提升表达质量';
        case 3:
          // 第2轮验证：65分
          return JSON.stringify({
            passed: false,
            overallScore: 65,
            criteriaScores: [{ criterion: '质量', passed: false, score: 65, reason: '质量改善但仍不足' }],
            issues: [{ severity: 'major', description: '仍需改进', suggestedFix: '继续优化' }]
          });
        case 4:
          // 第2轮修复 LLM 调用
          return '修复指令：补充更多细节和论据';
        default:
          // 第3轮验证：85分，通过
          return JSON.stringify({
            passed: true,
            overallScore: 85,
            criteriaScores: [{ criterion: '质量', passed: true, score: 85, reason: '质量良好' }],
            issues: []
          });
      }
    });

    const maxRounds = 3;
    let currentOutput = '初始低质量输出';
    let passed = false;

    for (let r = 1; r <= maxRounds && !passed; r++) {
      const validationResult = await validator.validate({
        userRequest: '编写产品介绍',
        output: currentOutput
      });

      if (validationResult.passed) {
        passed = true;
        expect(validationResult.overallScore).toBeGreaterThanOrEqual(70);
        break;
      }

      const repairPlan = await repairer.generateRepairPlan({
        userRequest: '编写产品介绍',
        currentOutput,
        validationResult,
        repairRound: r
      });

      expect(repairPlan.shouldRepair).toBe(true);
      expect(repairPlan.repairInstructions).toBeTruthy();

      currentOutput = `${currentOutput} [第${r}轮优化]`;
    }

    expect(passed).toBe(true);
  });

  it('高分输出应该建议 patch 策略', async () => {
    // Validator 返回高分但未通过
    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        passed: false,
        overallScore: 85,
        criteriaScores: [
          { criterion: '完整性', passed: true, score: 90, reason: '内容完整' },
          { criterion: '格式', passed: false, score: 75, reason: '格式有小问题' }
        ],
        issues: [{ severity: 'minor', description: '格式小问题', suggestedFix: '调整格式' }]
      })
    );

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
    vi.mocked(mockLLMChat).mockResolvedValueOnce(
      JSON.stringify({
        finalOutput: '部分完成的汇总',
        summary: {
          completedTasks: ['任务1'],
          failedTasks: ['任务2: 执行失败'],
          keyFindings: ['发现1'],
          recommendations: ['需要重新执行任务2']
        }
      })
    );

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
