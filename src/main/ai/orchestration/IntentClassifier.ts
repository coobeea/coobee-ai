/**
 * 意图分类器 — 判断是否需要启动编排模式
 *
 * 设计原则：
 *   - 简单对话（打招呼、闲聊、单步查询）→ 单 Agent 模式
 *   - 复杂任务（多步骤、需要分工协作）→ 编排模式
 *
 * 分类策略：
 *   1. 启发式规则（快速过滤明显的简单场景）
 *   2. LLM 分类（边界不明确时使用）
 */

import { createLogger } from '@main/common/logger';

const log = createLogger('intent-classifier');

/**
 * 意图类型
 */
export type IntentType =
  | 'simple-chat' // 简单对话（打招呼、闲聊）
  | 'simple-query' // 单步查询（查天气、查时间）
  | 'complex-task'; // 复杂任务（需要多步骤、分工）

/**
 * 分类结果
 */
export interface IntentClassificationResult {
  /** 意图类型 */
  type: IntentType;
  /** 置信度 (0-1) */
  confidence: number;
  /** 推理依据 */
  reason: string;
  /** 是否需要编排模式 */
  needsOrchestration: boolean;
}

/**
 * 意图分类器
 */
export class IntentClassifier {
  constructor(private readonly agentExecutor?: unknown) {}

  /**
   * 分类用户消息
   *
   * @param message 用户消息
   * @param context 上下文信息（可选）
   * @returns 分类结果
   */
  async classify(
    message: string,
    _context?: {
      hasHistory?: boolean; // 是否有对话历史
      agentType?: string; // Agent 类型
    }
  ): Promise<IntentClassificationResult> {
    // 1. 启发式规则（快速过滤）
    const heuristicResult = this.classifyByHeuristics(message, _context);
    if (heuristicResult.confidence >= 0.9) {
      return heuristicResult;
    }

    // 2. LLM 分类（边界不明确时）
    if (this.agentExecutor) {
      try {
        return await this.classifyByLLM(message, _context);
      } catch (error) {
        log.warn('[IntentClassifier] LLM classification failed, fallback to heuristics:', error);
      }
    }

    // 3. 降级：返回启发式结果
    return heuristicResult;
  }

  /**
   * 启发式规则分类
   */
  private classifyByHeuristics(message: string, _context?: { hasHistory?: boolean }): IntentClassificationResult {
    const trimmed = message.trim();
    const length = trimmed.length;

    // ========== 简单对话（打招呼、礼貌用语） ==========
    const greetings = [
      '你好',
      'hi',
      'hello',
      '嗨',
      '您好',
      '早上好',
      '下午好',
      '晚上好',
      '晚安',
      '谢谢',
      '再见',
      'bye',
      '拜拜'
    ];

    if (
      greetings.some(
        (g) => trimmed.toLowerCase() === g || trimmed.toLowerCase() === g + '！' || trimmed.toLowerCase() === g + '!'
      )
    ) {
      return {
        type: 'simple-chat',
        confidence: 1.0,
        reason: '匹配到问候语/礼貌用语',
        needsOrchestration: false
      };
    }

    // ========== 单步查询（时间、天气、简单问题）- 优先级高 ==========
    const simpleQueryPatterns = [
      /^(现在|今天|明天)?(几点|时间|日期)/,
      /^(今天|明天|后天)?(天气|温度)/,
      /^(帮我|请)?(查|搜|找)(一下)?/,
      /^什么是.{1,20}$/ // "什么是 X" 格式的简单问题
    ];

    if (simpleQueryPatterns.some((p) => p.test(trimmed))) {
      return {
        type: 'simple-query',
        confidence: 0.9,
        reason: '匹配到单步查询模式',
        needsOrchestration: false
      };
    }

    // ========== 短消息（< 10 字且无关键词） ==========
    if (length < 10 && !this.hasComplexKeywords(trimmed)) {
      return {
        type: 'simple-chat',
        confidence: 0.95,
        reason: '消息过短（< 10 字）且无复杂任务关键词',
        needsOrchestration: false
      };
    }

    // ========== 复杂任务特征 ==========
    const complexIndicators = this.getComplexityScore(trimmed);

    if (complexIndicators.score >= 2) {
      // 降低阈值从 3 到 2
      return {
        type: 'complex-task',
        confidence: 0.7 + complexIndicators.score * 0.05, // 最高 0.95
        reason: `检测到 ${complexIndicators.indicators.join('、')}`,
        needsOrchestration: true
      };
    }

    // ========== 默认：简单查询 ==========
    return {
      type: 'simple-query',
      confidence: 0.6,
      reason: '未匹配到明确特征，默认为简单查询',
      needsOrchestration: false
    };
  }

  /**
   * 检测复杂任务关键词
   */
  private hasComplexKeywords(message: string): boolean {
    const keywords = [
      '帮我',
      '创建',
      '实现',
      '开发',
      '设计',
      '部署',
      '分析',
      '规划',
      '方案',
      '架构',
      '重构',
      '测试',
      '优化',
      '修复',
      '调试',
      '第一步',
      '第二步',
      '然后',
      '接下来',
      '最后',
      '同时',
      '并且',
      '以及',
      '还有'
    ];

    return keywords.some((kw) => message.includes(kw));
  }

  /**
   * 计算任务复杂度评分
   */
  private getComplexityScore(message: string): { score: number; indicators: string[] } {
    let score = 0;
    const indicators: string[] = [];

    // 1. 长度 (> 50 字)
    if (message.length > 50) {
      score += 1;
      indicators.push('长文本');
    }

    // 2. 多步骤关键词
    const stepKeywords = ['第一', '第二', '第三', '首先', '然后', '接下来', '最后', '步骤'];
    if (stepKeywords.some((kw) => message.includes(kw))) {
      score += 2;
      indicators.push('多步骤指令');
    }

    // 3. 并发关键词
    const parallelKeywords = ['同时', '并且', '以及', '还要', '也要', '包括'];
    if (parallelKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('并发需求');
    }

    // 4. 代码/技术关键词（降低阈值）
    const techKeywords = [
      '代码',
      '函数',
      '接口',
      'API',
      '数据库',
      '服务器',
      '部署',
      '测试',
      'Node.js',
      'MongoDB',
      'REST'
    ];
    const techCount = techKeywords.filter((kw) => message.includes(kw)).length;
    if (techCount >= 1) {
      // 降低阈值从 2 到 1
      score += 1;
      indicators.push('技术任务');
    }

    // 5. 创建/开发关键词
    const devKeywords = ['创建', '开发', '实现', '设计', '搭建', '构建', '需要实现'];
    if (devKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('开发任务');
    }

    // 6. 文件/项目关键词
    const projectKeywords = ['项目', '应用', '网站', '系统', '平台', '播放器', '管理', '博客'];
    if (projectKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('项目级任务');
    }

    // 7. 功能列举（需要实现多个功能）
    const featureKeywords = ['播放', '暂停', '切换', '发布', '评论', '点赞', '审核', '注册', '登录', '验证'];
    const featureCount = featureKeywords.filter((kw) => message.includes(kw)).length;
    if (featureCount >= 2) {
      score += 1;
      indicators.push('多功能需求');
    }

    return { score, indicators };
  }

  /**
   * LLM 分类（更精确但更慢）
   */
  private async classifyByLLM(
    _message: string,
    _context?: { hasHistory?: boolean }
  ): Promise<IntentClassificationResult> {
    if (!this.agentExecutor) {
      throw new Error('AgentExecutor not available');
    }

    // TODO: 实现 LLM 调用（使用轻量级模型，如 gpt-4o-mini）
    // 示例 prompt（未使用）：
    // `请判断以下用户消息是否需要使用多智能体编排模式处理。
    //  用户消息："${_message}"
    //  判断标准：简单对话/查询 → 不需要编排，复杂任务 → 需要编排`

    // 这里先返回一个占位实现
    log.info('[IntentClassifier] LLM classification not implemented yet');

    return {
      type: 'simple-query',
      confidence: 0.5,
      reason: 'LLM 分类未实现，降级为启发式',
      needsOrchestration: false
    };
  }
}

/**
 * 创建默认分类器实例
 */
export function createIntentClassifier(agentExecutor?: unknown): IntentClassifier {
  return new IntentClassifier(agentExecutor);
}
