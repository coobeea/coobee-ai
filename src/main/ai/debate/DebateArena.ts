/**
 * DebateArena - 辩论竞技场
 *
 * 管理智能体辩论会话
 */

import { createLogger } from '@main/common/logger';
import type { DebateSession, DebateArgument, DebateRules, DebateStance } from './types';

const log = createLogger('debate-arena');

export class DebateArena {
  private sessions = new Map<string, DebateSession>();

  /**
   * 创建辩论会话
   */
  createSession(
    topic: string,
    participants: Array<{ agentId: string; stance: DebateStance }>,
    rules: DebateRules
  ): DebateSession {
    const sessionId = `debate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const session: DebateSession = {
      id: sessionId,
      topic,
      participants: participants.map((p) => ({
        agentId: p.agentId,
        stance: p.stance,
        argumentCount: 0,
        persuasivenessScore: 0
      })),
      arguments: [],
      currentRound: 0,
      totalRounds: rules.maxRounds,
      status: 'pending',
      createdAt: Date.now()
    };

    this.sessions.set(sessionId, session);

    log.info(`[DebateArena] Created debate session: ${sessionId} - ${topic}`);
    log.info(`[DebateArena] Participants: ${participants.map((p) => `${p.agentId} (${p.stance})`).join(', ')}`);

    return session;
  }

  /**
   * 开始辩论
   */
  async start(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'active';

    log.info(`[DebateArena] Starting debate: ${session.topic}`);
  }

  /**
   * 提交论点
   */
  submitArgument(
    sessionId: string,
    agentId: string,
    content: string,
    rebuttalTo?: string,
    evidence?: string[]
  ): DebateArgument {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    const participant = session.participants.find((p) => p.agentId === agentId);

    if (!participant) {
      throw new Error(`Agent ${agentId} is not a participant`);
    }

    const argument: DebateArgument = {
      id: `arg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      participant: agentId,
      stance: participant.stance,
      content,
      rebuttalTo,
      evidence,
      strength: this.calculateStrength(content, evidence),
      timestamp: Date.now()
    };

    session.arguments.push(argument);
    participant.argumentCount++;

    log.info(`[DebateArena] Argument submitted by ${agentId}: "${content.slice(0, 50)}..."`);

    return argument;
  }

  /**
   * 进入下一轮
   */
  nextRound(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) return;

    session.currentRound++;

    if (session.currentRound >= session.totalRounds) {
      this.conclude(sessionId);
    } else {
      log.info(`[DebateArena] Round ${session.currentRound + 1}/${session.totalRounds} started`);
    }
  }

  /**
   * 结束辩论并裁决
   */
  conclude(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) return;

    session.status = 'completed';
    session.completedAt = Date.now();

    const scores = this.calculateScores(session);

    session.verdict = {
      winner: scores.pro > scores.con ? 'pro' : scores.con > scores.pro ? 'con' : 'neutral',
      score: scores,
      reasoning: `基于 ${session.arguments.length} 个论点的分析，正方得分 ${scores.pro.toFixed(2)}，反方得分 ${scores.con.toFixed(2)}`
    };

    log.info(`[DebateArena] Debate concluded: ${session.topic}`);
    log.info(`[DebateArena] Winner: ${session.verdict.winner} (Pro: ${scores.pro}, Con: ${scores.con})`);
  }

  /**
   * 计算论点强度
   */
  private calculateStrength(content: string, evidence?: string[]): number {
    let strength = 0.5;

    if (content.length > 100) strength += 0.1;
    if (content.length > 200) strength += 0.1;

    if (evidence && evidence.length > 0) {
      strength += Math.min(0.3, evidence.length * 0.1);
    }

    return Math.min(1.0, strength);
  }

  /**
   * 计算各方得分
   */
  private calculateScores(session: DebateSession): { pro: number; con: number; neutral: number } {
    const scores = { pro: 0, con: 0, neutral: 0 };

    for (const arg of session.arguments) {
      scores[arg.stance] += arg.strength;
    }

    for (const participant of session.participants) {
      participant.persuasivenessScore = scores[participant.stance];
    }

    return scores;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): DebateSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 列出所有会话
   */
  listSessions(): DebateSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}
