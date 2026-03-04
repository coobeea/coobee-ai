/**
 * ConsensusEngine - 共识引擎
 *
 * 管理投票流程和共识达成
 */

import { createLogger } from '@main/common/logger';
import { VotingAlgorithm } from './VotingAlgorithm';
import { WeightCalculator } from './WeightCalculator';
import type { Vote, VoteOption, VoteResult, ConsensusConfig } from './types';

const log = createLogger('consensus-engine');

export class ConsensusEngine {
  private algorithm: VotingAlgorithm;
  private weightCalculator: WeightCalculator;
  private votes = new Map<string, Vote>();

  constructor() {
    this.algorithm = new VotingAlgorithm();
    this.weightCalculator = new WeightCalculator();
  }

  /**
   * 创建投票
   */
  createVote(topic: string, options: string[], participants: string[], type: Vote['type'] = 'single-choice'): Vote {
    const now = Date.now();
    const voteId = `vote-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const voteOptions: VoteOption[] = options.map((content, index) => ({
      id: `option-${index}`,
      content,
      votes: 0,
      voters: []
    }));

    const vote: Vote = {
      id: voteId,
      topic,
      options: voteOptions,
      status: 'open',
      type,
      participants,
      createdAt: now
    };

    this.votes.set(voteId, vote);
    log.info(`[ConsensusEngine] Vote created: ${voteId} - ${topic}`);

    return vote;
  }

  /**
   * 投票
   */
  castVote(voteId: string, agentId: string, optionIds: string[]): boolean {
    const vote = this.votes.get(voteId);
    if (!vote) {
      log.warn(`[ConsensusEngine] Vote ${voteId} not found`);
      return false;
    }

    if (vote.status !== 'open') {
      log.warn(`[ConsensusEngine] Vote ${voteId} is ${vote.status}`);
      return false;
    }

    if (!vote.participants.includes(agentId)) {
      log.warn(`[ConsensusEngine] Agent ${agentId} not a participant in vote ${voteId}`);
      return false;
    }

    for (const option of vote.options) {
      const alreadyVoted = option.voters.includes(agentId);
      if (alreadyVoted) {
        option.voters = option.voters.filter((v) => v !== agentId);
        option.votes--;
      }
    }

    for (const optionId of optionIds) {
      const option = vote.options.find((o) => o.id === optionId);
      if (option) {
        option.voters.push(agentId);
        option.votes++;
      }
    }

    log.info(`[ConsensusEngine] Agent ${agentId} voted in ${voteId}: ${optionIds.join(', ')}`);
    return true;
  }

  /**
   * 关闭投票并计算结果
   */
  closeVote(voteId: string, config: ConsensusConfig): VoteResult | null {
    const vote = this.votes.get(voteId);
    if (!vote) return null;

    vote.status = 'closed';

    const result = this.algorithm.calculateResult(vote, config, this.weightCalculator.getAllWeights());
    vote.result = result;

    log.info(`[ConsensusEngine] Vote ${voteId} closed. Winners: ${result.winners.join(', ')}`);

    return result;
  }

  /**
   * 获取投票
   */
  getVote(voteId: string): Vote | undefined {
    return this.votes.get(voteId);
  }

  /**
   * 列出所有投票
   */
  listVotes(): Vote[] {
    return Array.from(this.votes.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取权重计算器
   */
  getWeightCalculator(): WeightCalculator {
    return this.weightCalculator;
  }
}
