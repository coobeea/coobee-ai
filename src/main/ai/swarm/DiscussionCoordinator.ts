/**
 * DiscussionCoordinator — 多智能体讨论协调器
 *
 * 核心机制：
 * 1. 接收一个话题和参与讨论的 Agent 角色列表
 * 2. 多个 Agent 围绕该话题轮流发言（Round-Robin）
 * 3. 每轮将之前所有发言注入 prompt，让当前 Agent 基于上下文发表观点
 * 4. 主持人 Agent 在每轮后判断是否达成共识
 * 5. 达成共识或达到最大轮次后，由主持人生成最终结论
 *
 * 与现有系统的关系：
 * - 复用 AgentPool 获取 AgentRuntime
 * - 复用 MessageBus 记录讨论消息（可回溯）
 * - 复用 SwarmContext 共享讨论状态
 * - 通过 SwarmEvent 将讨论进展推送到前端
 */

import { createLogger } from '@main/common/logger';
import type { AgentRole, SwarmConfig, SwarmTask } from './types';
import { AgentPool } from './AgentPool';
import { SwarmContext } from './SwarmContext';
import { MessageBus } from './MessageBus';
import { RoleRegistry } from './roles';
import type { SwarmEventCallback } from './SwarmCoordinator';

const log = createLogger('swarm:discussion');

// ========== 类型定义 ==========

export interface DiscussionConfig {
  /** 最大讨论轮次 */
  maxRounds: number;
  /** 参与讨论的角色 ID 列表 */
  participantRoleIds: string[];
  /** 是否需要主持人（moderator）总结 */
  enableModerator: boolean;
  /** 主持人使用的模型（不指定则使用系统默认） */
  moderatorModel?: string;
  /** 共识判断阈值（0-100），主持人判断达到此分数即认为达成共识 */
  consensusThreshold: number;
}

export const DEFAULT_DISCUSSION_CONFIG: DiscussionConfig = {
  maxRounds: 3,
  participantRoleIds: [],
  enableModerator: true,
  consensusThreshold: 75
};

export interface DiscussionTurn {
  round: number;
  roleId: string;
  roleName: string;
  content: string;
  timestamp: number;
}

export interface DiscussionResult {
  topic: string;
  turns: DiscussionTurn[];
  conclusion: string;
  consensusReached: boolean;
  totalRounds: number;
  participantRoles: string[];
  duration: number;
}

export type DiscussionEvent =
  | { type: 'discussion:start'; data: { topic: string; participants: string[] } }
  | { type: 'discussion:turn'; data: { round: number; roleId: string; roleName: string; content: string } }
  | { type: 'discussion:consensus_check'; data: { round: number; reached: boolean; score: number } }
  | { type: 'discussion:conclusion'; data: { conclusion: string; consensusReached: boolean } }
  | { type: 'discussion:done'; data: { totalRounds: number; duration: number } };

// ========== 主持人指令 ==========

const MODERATOR_SYSTEM_PROMPT = `你是一场多智能体讨论的主持人。你的职责是：

1. 分析各参与者的发言
2. 判断是否已达成共识（给出 0-100 的共识分数）
3. 如果未达成共识，指出分歧点，引导下一轮讨论
4. 达成共识后，生成简洁的结论

请以 JSON 格式输出你的判断：
{
  "consensusScore": 75,
  "consensusReached": true,
  "summary": "各方观点的简要总结",
  "divergencePoints": ["分歧点1", "分歧点2"],
  "conclusion": "最终结论（仅当 consensusReached 为 true 时填写）",
  "guidanceForNextRound": "下一轮讨论的引导方向（仅当 consensusReached 为 false 时填写）"
}`;

// ========== 参与者指令 ==========

function buildParticipantPrompt(
  topic: string,
  role: AgentRole,
  previousTurns: DiscussionTurn[],
  moderatorGuidance?: string
): string {
  let prompt = `# 讨论话题\n\n${topic}\n\n`;
  prompt += `# 你的身份\n\n你是 **${role.name}**（${role.description}）。请基于你的专业领域，对讨论话题发表你的观点和建议。\n\n`;

  if (previousTurns.length > 0) {
    prompt += `# 之前的讨论\n\n`;
    for (const turn of previousTurns) {
      prompt += `**${turn.roleName}** (第${turn.round}轮): ${turn.content}\n\n`;
    }
  }

  if (moderatorGuidance) {
    prompt += `# 主持人引导\n\n${moderatorGuidance}\n\n`;
  }

  prompt += `# 要求\n\n`;
  prompt += `- 基于你的专业视角发表观点\n`;
  prompt += `- 可以赞同、反驳或补充其他参与者的观点\n`;
  prompt += `- 提出具体可行的建议\n`;
  prompt += `- 简明扼要，不超过 300 字\n`;

  return prompt;
}

// ========== 协调器 ==========

export class DiscussionCoordinator {
  private config: DiscussionConfig;
  private swarmConfig: SwarmConfig;
  private pool: AgentPool;
  private context: SwarmContext;
  private messageBus: MessageBus;
  private roleRegistry: RoleRegistry;
  private onEvent: SwarmEventCallback | null = null;

  constructor(swarmConfig: SwarmConfig, discussionConfig?: Partial<DiscussionConfig>) {
    this.swarmConfig = swarmConfig;
    this.config = { ...DEFAULT_DISCUSSION_CONFIG, ...discussionConfig };
    this.pool = new AgentPool(swarmConfig);
    this.context = swarmConfig.context || new SwarmContext();
    this.messageBus = swarmConfig.messageBus || new MessageBus();
    this.roleRegistry = new RoleRegistry();
  }

  setOnEvent(callback: SwarmEventCallback | ((event: DiscussionEvent) => void)): void {
    this.onEvent = callback as SwarmEventCallback;
  }

  private emit(event: DiscussionEvent): void {
    log.info(`[Discussion] ${event.type}`, JSON.stringify(event.data).substring(0, 200));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.onEvent as any)?.(event);
  }

  registerRole(role: AgentRole): void {
    this.roleRegistry.register(role);
  }

  /**
   * 发起讨论
   *
   * @param task 包含讨论话题的任务
   * @returns 讨论结果（所有轮次的发言 + 最终结论）
   */
  async discuss(task: SwarmTask): Promise<DiscussionResult> {
    const startTime = Date.now();
    const topic = task.input;
    const turns: DiscussionTurn[] = [];

    const participantRoles = this.config.participantRoleIds
      .map((id) => this.roleRegistry.getRole(id))
      .filter((r): r is AgentRole => r !== null);

    if (participantRoles.length < 2) {
      throw new Error(`讨论至少需要 2 个参与者，当前只有 ${participantRoles.length} 个`);
    }

    log.info(`[Discussion] 开始讨论: "${topic}", 参与者: ${participantRoles.map((r) => r.name).join(', ')}`);

    this.emit({
      type: 'discussion:start',
      data: { topic, participants: participantRoles.map((r) => r.name) }
    });

    this.context.set('discussion_topic', topic, 'system');
    this.context.set(
      'discussion_participants',
      participantRoles.map((r) => r.id),
      'system'
    );

    let moderatorGuidance: string | undefined;
    let consensusReached = false;
    let finalConclusion = '';
    let totalRounds = 0;

    for (let round = 1; round <= this.config.maxRounds; round++) {
      totalRounds = round;
      log.info(`[Discussion] === 第 ${round} 轮 ===`);

      // 每个参与者轮流发言
      for (const role of participantRoles) {
        const prompt = buildParticipantPrompt(topic, role, turns, moderatorGuidance);

        const { runtime, poolId } = await this.pool.acquireAgent(role);
        try {
          const result = await runtime.run(prompt);
          const content = result.output || '(无回应)';

          const turn: DiscussionTurn = {
            round,
            roleId: role.id,
            roleName: role.name,
            content,
            timestamp: Date.now()
          };
          turns.push(turn);

          this.messageBus.broadcast(role.id, content, { topic: 'discussion' });

          this.emit({
            type: 'discussion:turn',
            data: { round, roleId: role.id, roleName: role.name, content }
          });
        } finally {
          this.pool.releaseAgent(poolId, true);
        }
      }

      // 主持人评估共识
      if (this.config.enableModerator) {
        const assessment = await this.assessConsensus(topic, turns, round);

        this.emit({
          type: 'discussion:consensus_check',
          data: { round, reached: assessment.consensusReached, score: assessment.consensusScore }
        });

        if (assessment.consensusReached) {
          consensusReached = true;
          finalConclusion = assessment.conclusion || '';
          log.info(`[Discussion] 第 ${round} 轮达成共识 (分数: ${assessment.consensusScore})`);
          break;
        } else {
          moderatorGuidance = assessment.guidanceForNextRound;
          log.info(`[Discussion] 第 ${round} 轮未达成共识 (分数: ${assessment.consensusScore}), 继续...`);
        }
      }
    }

    // 如果循环结束仍未达成共识，由主持人强制总结
    if (!consensusReached && this.config.enableModerator) {
      finalConclusion = await this.generateFinalSummary(topic, turns);
    }

    // 如果不启用主持人，简单拼接最后一轮发言
    if (!this.config.enableModerator) {
      finalConclusion = turns
        .filter((t) => t.round === totalRounds)
        .map((t) => `**${t.roleName}**: ${t.content}`)
        .join('\n\n');
    }

    this.emit({
      type: 'discussion:conclusion',
      data: { conclusion: finalConclusion, consensusReached }
    });

    this.emit({
      type: 'discussion:done',
      data: { totalRounds, duration: Date.now() - startTime }
    });

    const result: DiscussionResult = {
      topic,
      turns,
      conclusion: finalConclusion,
      consensusReached,
      totalRounds,
      participantRoles: participantRoles.map((r) => r.id),
      duration: Date.now() - startTime
    };

    this.context.set('discussion_result', result, 'system');

    return result;
  }

  /**
   * 主持人评估共识
   */
  private async assessConsensus(
    topic: string,
    turns: DiscussionTurn[],
    currentRound: number
  ): Promise<{
    consensusScore: number;
    consensusReached: boolean;
    summary: string;
    divergencePoints: string[];
    conclusion?: string;
    guidanceForNextRound?: string;
  }> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');
      const sessionId = this.swarmConfig.parentSessionId
        ? `${this.swarmConfig.parentSessionId}:moderator-r${currentRound}`
        : `moderator-${Date.now()}`;

      const builder = agentExecutor
        .piMono()
        .name('DiscussionModerator')
        .mode('chat')
        .sessionMode('memory')
        .instructions(MODERATOR_SYSTEM_PROMPT)
        .sessionId(sessionId);

      if (this.config.moderatorModel || this.swarmConfig.triageModel) {
        builder.model(this.config.moderatorModel || this.swarmConfig.triageModel!);
      }

      const runtime = await builder.build();
      try {
        const discussionLog = turns.map((t) => `[第${t.round}轮] ${t.roleName}: ${t.content}`).join('\n\n');

        const prompt = `# 讨论话题\n${topic}\n\n# 讨论记录\n\n${discussionLog}\n\n# 当前轮次\n第 ${currentRound} 轮，共最多 ${this.config.maxRounds} 轮\n\n请评估当前讨论状态。共识阈值: ${this.config.consensusThreshold} 分。`;

        const result = await runtime.run(prompt);
        const output = result.output || '';

        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            consensusScore: Number(parsed.consensusScore) || 0,
            consensusReached: parsed.consensusScore >= this.config.consensusThreshold,
            summary: parsed.summary || '',
            divergencePoints: Array.isArray(parsed.divergencePoints) ? parsed.divergencePoints : [],
            conclusion: parsed.conclusion,
            guidanceForNextRound: parsed.guidanceForNextRound
          };
        }
      } finally {
        await runtime.destroy();
      }
    } catch (error) {
      log.warn('[Discussion] Consensus assessment failed:', error);
    }

    return {
      consensusScore: 0,
      consensusReached: false,
      summary: '',
      divergencePoints: [],
      guidanceForNextRound: '请各位继续讨论，深入分析各自观点的优劣。'
    };
  }

  /**
   * 主持人强制生成最终总结
   */
  private async generateFinalSummary(topic: string, turns: DiscussionTurn[]): Promise<string> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');
      const sessionId = this.swarmConfig.parentSessionId
        ? `${this.swarmConfig.parentSessionId}:moderator-final`
        : `moderator-final-${Date.now()}`;

      const builder = agentExecutor
        .piMono()
        .name('DiscussionSummary')
        .mode('chat')
        .sessionMode('memory')
        .instructions(
          `你是一场讨论的主持人。讨论已达到最大轮次但未完全达成共识。请综合各方观点，给出一个平衡的最终结论。结论应该：
1. 总结各方共识的部分
2. 指出仍有分歧的部分
3. 给出你的推荐方案
4. 简洁明了，控制在 500 字以内`
        )
        .sessionId(sessionId);

      if (this.config.moderatorModel || this.swarmConfig.triageModel) {
        builder.model(this.config.moderatorModel || this.swarmConfig.triageModel!);
      }

      const runtime = await builder.build();
      try {
        const discussionLog = turns.map((t) => `[第${t.round}轮] ${t.roleName}: ${t.content}`).join('\n\n');

        const result = await runtime.run(
          `# 讨论话题\n${topic}\n\n# 完整讨论记录\n\n${discussionLog}\n\n请生成最终结论。`
        );
        return result.output || '讨论未能得出明确结论。';
      } finally {
        await runtime.destroy();
      }
    } catch (error) {
      log.warn('[Discussion] Final summary failed:', error);
      return '讨论结论生成失败。';
    }
  }

  async destroy(): Promise<void> {
    this.messageBus.destroy();
  }
}
