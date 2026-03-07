/**
 * DiscussionCoordinator - 讨论协调者智能体
 *
 * 职责：
 *   1. 创建并管理讨论室主 Thread
 *   2. 判断共识度，决定是否继续讨论
 *   3. 管理轮次和发言模式（顺序/并发）
 *   4. 接入 ThreadWaker 实现重启恢复
 *
 * 设计理念：
 *   - 类似 Orchestrator：Coordinator 是程序逻辑 + LLM Agent
 *   - 主 Thread = 讨论室本身
 *   - 参与者 Agent 临时执行，不创建独立 Thread
 */

import { createLogger } from '@main/common/logger';
import { ThreadStore } from '@main/ai/threads/ThreadStore';
import { CheckpointManager } from '@main/ai/threads/CheckpointManager';
import { ConsensusDetector } from './ConsensusDetector';
import { DiscussionStore } from './DiscussionStore';
import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import type { DiscussionSession, DiscussionParticipant, TurnStrategy } from './types';
import type { ThreadCheckpoint } from '@main/ai/threads/types';

const log = createLogger('discussion-coordinator');

/**
 * 讨论配置
 */
export interface DiscussionCoordinatorOptions {
  /** 讨论主题 */
  topic: string;
  /** 参与者 */
  participants: DiscussionParticipant[];
  /** 共识阈值（0-1，默认 0.7） */
  consensusThreshold?: number;
  /** 最大轮次（默认 10） */
  maxRounds?: number;
  /** 默认发言模式 */
  defaultTurnMode?: 'sequential' | 'concurrent';
}

/**
 * 协调者元数据（存储在 Checkpoint.metadata）
 */
interface CoordinatorMetadata {
  /** 当前轮次 */
  currentRound: number;
  /** 当前发言者（顺序模式下） */
  currentSpeakerIndex: number;
  /** 发言模式 */
  turnMode: 'sequential' | 'concurrent';
  /** 讨论室 ID（DiscussionStore 中的 session） */
  discussionSessionId: string;
}

/**
 * 将 TurnStrategy 映射为内部使用的发言模式
 */
function mapTurnModeFromStrategy(
  strategy: TurnStrategy | 'sequential' | 'concurrent' | undefined
): 'sequential' | 'concurrent' {
  if (strategy === 'concurrent') return 'concurrent';
  return 'sequential'; // round-robin, weighted, reactive 等都映射为 sequential
}

/**
 * 讨论协调者
 */
export class DiscussionCoordinator {
  private threadId: string;
  private session: DiscussionSession;
  private consensusDetector: ConsensusDetector;

  constructor(options: DiscussionCoordinatorOptions) {
    // 生成简洁的主 Thread ID
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).slice(2, 8);
    this.threadId = `discussion-${timestamp}-${randomId}`;

    // 初始化 session
    this.session = {
      id: this.threadId, // 使用 threadId 作为 session ID
      topic: options.topic,
      participants: options.participants,
      messages: [],
      status: 'active',
      turnStrategy: options.defaultTurnMode || 'sequential',
      consensusThreshold: options.consensusThreshold || 0.7,
      maxRounds: options.maxRounds || 10,
      consensusLevel: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.consensusDetector = new ConsensusDetector();
  }

  /**
   * 获取主 Thread ID
   */
  getThreadId(): string {
    return this.threadId;
  }

  /**
   * 获取 Session 信息
   */
  getSession(): DiscussionSession {
    return { ...this.session };
  }

  /**
   * 开始讨论
   */
  async start(): Promise<void> {
    log.info(`[DiscussionCoordinator] Starting discussion: ${this.session.topic}`);

    // 1. 创建主 Thread（接入 ThreadWaker）
    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.create({
      title: `Discussion: ${this.session.topic}`,
      agentId: 'discussion-coordinator',
      agentMode: 'discussion',
      agentType: 'discussion'
    });

    // 更新为生成的 Thread ID
    this.threadId = thread.id;
    this.session.id = thread.id;

    // 设置为运行中状态
    await threadStore.update(this.threadId, { runStatus: 'running' });

    // 2. 创建 Checkpoint
    await this.updateCheckpoint({
      currentRound: 0,
      currentSpeakerIndex: 0,
      turnMode: mapTurnModeFromStrategy(this.session.turnStrategy),
      discussionSessionId: this.threadId
    });

    // 3. 保存 DiscussionSession
    const discussionStore = await DiscussionStore.getInstance();
    await discussionStore.save(this.session);

    // 4. 添加系统消息
    await discussionStore.addMessage(this.threadId, {
      participant: 'System',
      content: `Discussion started. Topic: ${this.session.topic}`,
      timestamp: Date.now(),
      type: 'statement'
    });

    // 5. 开始第1轮协调
    await this.coordinateNextRound();
  }

  /**
   * 恢复讨论（从 Checkpoint 恢复）
   */
  static async resume(threadId: string): Promise<DiscussionCoordinator> {
    log.info(`[DiscussionCoordinator] Resuming discussion: ${threadId}`);

    // 1. 加载 DiscussionSession
    const discussionStore = await DiscussionStore.getInstance();
    const session = await discussionStore.get(threadId);

    if (!session) {
      throw new Error(`Discussion session ${threadId} not found`);
    }

    // 2. 创建协调者实例
    const defaultTurnMode = mapTurnModeFromStrategy(session.turnStrategy);
    const coordinator = new DiscussionCoordinator({
      topic: session.topic,
      participants: session.participants,
      consensusThreshold: session.consensusThreshold,
      maxRounds: session.maxRounds,
      defaultTurnMode
    });

    // 覆盖 threadId 和 session（使用恢复的数据）
    coordinator.threadId = threadId;
    coordinator.session = session;

    // 3. 继续协调
    await coordinator.coordinateNextRound();

    return coordinator;
  }

  /**
   * 协调下一轮（核心逻辑）
   */
  private async coordinateNextRound(): Promise<void> {
    try {
      // 重新加载最新的 session（可能被参与者更新）
      const store = await DiscussionStore.getInstance();
      const latestSession = await store.get(this.threadId);
      if (latestSession) {
        this.session = latestSession;
      }

      // 1. 检查是否应该结束
      const shouldEnd = await this.checkShouldEnd();
      if (shouldEnd.should) {
        await this.end(shouldEnd.reason);
        return;
      }

      // 2. 判断本轮模式（顺序/并发）
      const turnMode = this.getTurnMode();

      // 3. 获取本轮发言者
      const speakers = this.getNextSpeakers(turnMode);
      if (speakers.length === 0) {
        await this.end('No active participants');
        return;
      }

      // 4. 更新轮次
      const currentRound = this.getCurrentRound();
      log.info(
        `[DiscussionCoordinator] Round ${currentRound}/${this.session.maxRounds}, Mode: ${turnMode}, Speakers: ${speakers.map((s) => s.agentId).join(', ')}`
      );

      // 5. 执行本轮发言
      if (turnMode === 'concurrent') {
        // 并发模式：所有人同时发言
        await this.executeRoundConcurrent(speakers);
      } else {
        // 顺序模式：一个接一个
        await this.executeRoundSequential(speakers);
      }

      // 6. 本轮结束，继续下一轮（递归）
      // 注意：这里会立即继续，实际可能需要延迟或等待条件
      setTimeout(() => {
        this.coordinateNextRound().catch((err) => {
          log.error('[DiscussionCoordinator] Failed to coordinate next round:', err);
        });
      }, 2000); // 延迟2秒
    } catch (error) {
      log.error('[DiscussionCoordinator] Coordination error:', error);
      await this.end(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查是否应该结束讨论
   */
  private async checkShouldEnd(): Promise<{ should: boolean; reason?: string }> {
    // 1. 检查状态
    if (this.session.status !== 'active') {
      return { should: true, reason: 'Discussion already ended or paused' };
    }

    // 2. 检查轮次
    const currentRound = this.getCurrentRound();
    const maxRounds = this.session.maxRounds || 10;
    if (currentRound >= maxRounds) {
      return { should: true, reason: `Reached max rounds (${maxRounds})` };
    }

    // 3. 检查共识度
    const consensus = await this.consensusDetector.detect(
      this.session.messages,
      this.session.consensusThreshold || 0.7
    );

    this.session.consensusLevel = consensus.level;

    // 更新到 DiscussionStore
    const store = await DiscussionStore.getInstance();
    await store.save(this.session);

    if (consensus.achieved) {
      return {
        should: true,
        reason: `Consensus achieved (${(consensus.level * 100).toFixed(1)}%)`
      };
    }

    return { should: false };
  }

  /**
   * 获取当前轮次
   */
  private getCurrentRound(): number {
    const participantCount = this.session.participants.filter((p) => p.active !== false).length;
    if (participantCount === 0) return 0;
    return Math.ceil(this.session.messages.filter((m) => m.agentId !== 'System').length / participantCount);
  }

  /**
   * 判断本轮模式（顺序/并发）
   */
  private getTurnMode(): 'sequential' | 'concurrent' {
    return mapTurnModeFromStrategy(this.session.turnStrategy);
  }

  /**
   * 获取下一轮发言者
   */
  private getNextSpeakers(mode: 'sequential' | 'concurrent'): DiscussionParticipant[] {
    const active = this.session.participants.filter((p) => p.active !== false);

    if (mode === 'concurrent') {
      // 并发模式：返回所有活跃参与者
      return active;
    } else {
      // 顺序模式：返回下一个发言者
      const lastMessage = this.session.messages.filter((m) => m.agentId !== 'System').slice(-1)[0];

      if (!lastMessage) {
        // 首次发言，返回第一个参与者
        return active.length > 0 ? [active[0]] : [];
      }

      // 找到上次发言者的位置，返回下一个
      const lastIndex = active.findIndex((p) => p.agentId === lastMessage.agentId);
      const nextIndex = (lastIndex + 1) % active.length;
      return [active[nextIndex]];
    }
  }

  /**
   * 执行一轮（顺序模式）
   */
  private async executeRoundSequential(speakers: DiscussionParticipant[]): Promise<void> {
    for (const speaker of speakers) {
      await this.executeParticipant(speaker);
    }
  }

  /**
   * 执行一轮（并发模式）
   */
  private async executeRoundConcurrent(speakers: DiscussionParticipant[]): Promise<void> {
    await Promise.all(speakers.map((speaker) => this.executeParticipant(speaker)));
  }

  /**
   * 执行单个参与者发言
   */
  private async executeParticipant(participant: DiscussionParticipant): Promise<void> {
    try {
      log.info(`[DiscussionCoordinator] Participant ${participant.agentId} speaking...`);

      // 获取最近的讨论历史
      const recentMessages = this.session.messages
        .slice(-10)
        .map((m) => `${m.agentId}: ${m.content}`)
        .join('\n');

      const runtime = ChannelRuntime.getInstance();

      // 执行参与者 Agent（使用主 Thread ID）
      const result = await runtime.executeAgent({
        agentId: participant.agentId,
        sessionId: this.threadId, // ✅ 使用主 Thread ID，不再拼接
        message: `You are ${participant.role || participant.name}. Continue discussing "${this.session.topic}".\n\nRecent messages:\n${recentMessages}\n\nPlease share your perspective.`,
        context: {
          channel: 'discussion',
          roomId: this.threadId,
          role: participant.role || participant.name,
          topic: this.session.topic,
          discussionHistory: this.session.messages.map((m) => ({
            sender: m.agentId,
            content: m.content,
            timestamp: m.timestamp
          })),
          myPreviousMessages: this.session.messages
            .filter((m) => m.agentId === participant.agentId)
            .map((m) => m.content)
        }
      });

      if (result.error) {
        log.error(`[DiscussionCoordinator] Participant ${participant.agentId} error: ${result.error}`);
        return;
      }

      // 保存消息到 DiscussionStore
      const store = await DiscussionStore.getInstance();
      await store.addMessage(this.threadId, {
        participant: participant.agentId,
        content: result.output,
        timestamp: Date.now(),
        type: 'statement'
      });

      // 更新本地 session
      this.session.messages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: participant.agentId,
        content: result.output,
        type: 'statement',
        timestamp: Date.now()
      });

      this.session.updatedAt = Date.now();

      // 更新 Checkpoint
      await this.updateCheckpoint();

      log.info(`[DiscussionCoordinator] Participant ${participant.agentId} finished`);
    } catch (error) {
      log.error(`[DiscussionCoordinator] Failed to execute participant ${participant.agentId}:`, error);
    }
  }

  /**
   * 更新 Checkpoint
   */
  private async updateCheckpoint(metadata?: Partial<CoordinatorMetadata>): Promise<void> {
    const checkpoint = await CheckpointManager.getInstance().load(this.threadId);

    const currentMetadata: CoordinatorMetadata = (checkpoint?.metadata as CoordinatorMetadata | undefined) || {
      currentRound: 0,
      currentSpeakerIndex: 0,
      turnMode: 'sequential',
      discussionSessionId: this.threadId
    };

    const newCheckpoint: ThreadCheckpoint = {
      threadId: this.threadId,
      runStatus: 'running',
      updatedAt: new Date().toISOString(),
      metadata: {
        ...currentMetadata,
        ...metadata,
        currentRound: this.getCurrentRound()
      }
    };

    await CheckpointManager.getInstance().save(newCheckpoint);
  }

  /**
   * 结束讨论
   */
  private async end(reason?: string): Promise<void> {
    log.info(`[DiscussionCoordinator] Ending discussion: ${reason || 'Manual end'}`);

    this.session.status = 'completed';
    this.session.updatedAt = Date.now();

    // 1. 更新 DiscussionStore
    const discussionStore = await DiscussionStore.getInstance();
    const consensusPercent = ((this.session.consensusLevel || 0) * 100).toFixed(1);
    await discussionStore.addMessage(this.threadId, {
      participant: 'System',
      content: `Discussion ended. Reason: ${reason || 'Manual end'}. Consensus level: ${consensusPercent}%`,
      timestamp: Date.now(),
      type: 'summary'
    });
    await discussionStore.save(this.session);

    // 2. 更新 Thread 为已完成
    const threadStore = await ThreadStore.getInstance();
    await threadStore.update(this.threadId, {
      runStatus: 'completed'
    });

    // 3. 清理 Checkpoint
    await CheckpointManager.getInstance().clear(this.threadId);

    log.info(`[DiscussionCoordinator] Discussion ended: ${this.threadId}`);
  }

  /**
   * 暂停讨论
   */
  async pause(): Promise<void> {
    log.info(`[DiscussionCoordinator] Pausing discussion: ${this.threadId}`);

    this.session.status = 'paused';
    this.session.updatedAt = Date.now();

    // 1. 更新 DiscussionStore
    const discussionStore = await DiscussionStore.getInstance();
    await discussionStore.save(this.session);

    // 2. 更新 Thread
    const threadStore = await ThreadStore.getInstance();
    await threadStore.update(this.threadId, { runStatus: 'idle' });

    // 3. 更新 Checkpoint
    await this.updateCheckpoint({ turnMode: 'sequential' });
  }

  /**
   * 恢复讨论
   */
  async resume(): Promise<void> {
    log.info(`[DiscussionCoordinator] Resuming discussion: ${this.threadId}`);

    this.session.status = 'active';
    this.session.updatedAt = Date.now();

    // 1. 更新 DiscussionStore
    const discussionStore = await DiscussionStore.getInstance();
    await discussionStore.save(this.session);

    // 2. 更新 Thread
    const threadStore = await ThreadStore.getInstance();
    await threadStore.update(this.threadId, { runStatus: 'running' });

    // 3. 更新 Checkpoint
    await this.updateCheckpoint();

    // 4. 继续协调
    await this.coordinateNextRound();
  }
}
