/**
 * VotingAlgorithm - 投票算法
 *
 * 实现各种投票算法（简单多数、加权多数、一致同意等）
 */

import { createLogger } from '@main/common/logger';
import type { Vote, VoteResult, ConsensusConfig, AgentWeight } from './types';

const log = createLogger('voting-algorithm');

export class VotingAlgorithm {
  /**
   * 计算投票结果
   */
  calculateResult(vote: Vote, config: ConsensusConfig, weights?: Map<string, AgentWeight>): VoteResult {
    const algorithm = config.algorithm;

    log.info(`[VotingAlgorithm] Calculating result using ${algorithm}`);

    switch (algorithm) {
      case 'simple-majority':
        return this.simpleMajority(vote, config);

      case 'weighted-majority':
        return this.weightedMajority(vote, config, weights);

      case 'unanimous':
        return this.unanimous(vote, config);

      case 'super-majority':
        return this.superMajority(vote, config);

      default:
        return this.simpleMajority(vote, config);
    }
  }

  /**
   * 简单多数（一人一票）
   */
  private simpleMajority(vote: Vote, config: ConsensusConfig): VoteResult {
    const totalVotes = vote.options.reduce((sum, opt) => sum + opt.votes, 0);
    const turnout = totalVotes / vote.participants.length;
    const quorumReached = config.quorum ? turnout >= config.quorum : true;

    const maxVotes = Math.max(...vote.options.map((o) => o.votes));
    const winners = vote.options.filter((o) => o.votes === maxVotes).map((o) => o.id);

    const statistics: Record<string, number> = {};
    for (const option of vote.options) {
      statistics[option.id] = option.votes;
    }

    return {
      winners,
      turnout,
      quorumReached,
      statistics
    };
  }

  /**
   * 加权多数（基于 Agent 权重）
   */
  private weightedMajority(vote: Vote, config: ConsensusConfig, weights?: Map<string, AgentWeight>): VoteResult {
    const weightedVotes = new Map<string, number>();

    for (const option of vote.options) {
      let totalWeight = 0;
      for (const voter of option.voters) {
        const weight = weights?.get(voter)?.weight || 1.0;
        totalWeight += weight;
      }
      weightedVotes.set(option.id, totalWeight);
    }

    const maxWeight = Math.max(...Array.from(weightedVotes.values()));
    const winners = Array.from(weightedVotes.entries())
      .filter(([_id, weight]) => weight === maxWeight)
      .map(([id]) => id);

    const totalWeight = Array.from(weightedVotes.values()).reduce((sum, w) => sum + w, 0);
    const maxPossibleWeight = vote.participants.reduce((sum, p) => sum + (weights?.get(p)?.weight || 1.0), 0);
    const turnout = totalWeight / maxPossibleWeight;

    const statistics: Record<string, number> = Object.fromEntries(weightedVotes);

    return {
      winners,
      turnout,
      quorumReached: config.quorum ? turnout >= config.quorum : true,
      statistics
    };
  }

  /**
   * 一致同意（所有人必须投同一选项）
   */
  private unanimous(vote: Vote, _config: ConsensusConfig): VoteResult {
    const totalVotes = vote.options.reduce((sum, opt) => sum + opt.votes, 0);
    const turnout = totalVotes / vote.participants.length;
    const quorumReached = turnout === 1.0;

    const allAgreeOption = vote.options.find((o) => o.votes === vote.participants.length);
    const winners = allAgreeOption ? [allAgreeOption.id] : [];

    const statistics: Record<string, number> = {};
    for (const option of vote.options) {
      statistics[option.id] = option.votes;
    }

    return {
      winners,
      turnout,
      quorumReached,
      statistics
    };
  }

  /**
   * 超级多数（如 2/3 多数）
   */
  private superMajority(vote: Vote, config: ConsensusConfig): VoteResult {
    const threshold = config.superMajorityThreshold || 2 / 3;
    const totalVotes = vote.options.reduce((sum, opt) => sum + opt.votes, 0);
    const turnout = totalVotes / vote.participants.length;

    const qualifyingOptions = vote.options.filter((o) => o.votes / vote.participants.length >= threshold);
    const winners = qualifyingOptions.map((o) => o.id);

    const statistics: Record<string, number> = {};
    for (const option of vote.options) {
      statistics[option.id] = option.votes;
    }

    return {
      winners,
      turnout,
      quorumReached: config.quorum ? turnout >= config.quorum : true,
      statistics
    };
  }
}
