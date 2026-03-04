/**
 * ExpertPanel - 专家小组
 *
 * 并行调用多个专家 Agent，收集意见并整合
 */

import { createLogger } from '@main/common/logger';
import { OpinionAggregator } from './OpinionAggregator';
import type { ExpertOpinion, ConsultationSession, AggregationStrategy } from './types';

const log = createLogger('expert-panel');

export interface ExpertPanelOptions {
  /** 问题描述 */
  question: string;

  /** 专家列表 */
  experts: Array<{
    agentId: string;
    roleName: string;
    specialty: string;
  }>;

  /** 意见聚合策略 */
  aggregationStrategy?: AggregationStrategy;

  /** 超时时间（毫秒） */
  timeout?: number;
}

export class ExpertPanel {
  private session: ConsultationSession;
  private aggregator: OpinionAggregator;

  constructor(options: ExpertPanelOptions) {
    const now = Date.now();
    this.session = {
      id: `consultation-${now}-${Math.random().toString(36).slice(2, 8)}`,
      question: options.question,
      experts: options.experts,
      opinions: [],
      status: 'pending',
      createdAt: now
    };

    this.aggregator = new OpinionAggregator();
  }

  /**
   * 开始会诊
   */
  async consult(): Promise<ConsultationSession> {
    log.info(`[ExpertPanel] Starting consultation: ${this.session.question}`);
    this.session.status = 'consulting';

    const opinions = await this.gatherOpinions();
    this.session.opinions = opinions;

    const conclusion = await this.aggregator.aggregate(opinions);
    this.session.conclusion = conclusion;
    this.session.status = 'completed';
    this.session.completedAt = Date.now();

    log.info(`[ExpertPanel] Consultation completed with ${opinions.length} opinions`);
    return this.session;
  }

  /**
   * 收集专家意见（并行）
   */
  private async gatherOpinions(): Promise<ExpertOpinion[]> {
    const promises = this.session.experts.map((expert) => this.consultExpert(expert));

    const results = await Promise.allSettled(promises);

    const opinions: ExpertOpinion[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        opinions.push(result.value);
      } else {
        log.warn(`[ExpertPanel] Expert ${this.session.experts[i].agentId} consultation failed:`, result.reason);
      }
    }

    return opinions;
  }

  /**
   * 咨询单个专家
   */
  private async consultExpert(expert: {
    agentId: string;
    roleName: string;
    specialty: string;
  }): Promise<ExpertOpinion> {
    log.debug(`[ExpertPanel] Consulting expert: ${expert.roleName}`);

    // TODO: 接入真实 Agent 执行
    const prompt = `作为${expert.specialty}专家，请对以下问题提供你的专业意见：

${this.session.question}

请从你的专业角度分析：
1. 你的核心观点是什么？
2. 有哪些潜在风险或注意事项？
3. 你的建议是什么？
4. 你对这个建议的置信度（0-100%）？

请简明扼要地回答。`;

    // 当前使用 mock 响应，待集成真实 Agent Runtime
    const mockResponse = `作为${expert.specialty}专家，我的分析如下：\n\n${this.session.question}\n\n基于我的专业知识，我建议采取谨慎的态度。\n\n（提示词长度: ${prompt.length} 字符）`;

    return {
      agentId: expert.agentId,
      roleName: expert.roleName,
      content: mockResponse,
      confidence: 0.8,
      type: 'analysis',
      timestamp: Date.now()
    };
  }

  /**
   * 获取会话信息
   */
  getSession(): ConsultationSession {
    return { ...this.session };
  }
}
