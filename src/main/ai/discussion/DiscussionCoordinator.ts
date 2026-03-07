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
import type { DiscussionSession, DiscussionParticipant, DiscussionMessage, TurnStrategy } from './types';
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
  /** 当前轮次（从 1 开始） */
  currentRound: number;
  /** 当前发言者索引（顺序模式下，0-based） */
  currentSpeakerIndex: number;
  /** 本轮已发言的参与者 ID 列表 */
  currentRoundSpeakers: string[];
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
      currentRound: 1, // 从第1轮开始
      currentSpeakerIndex: 0,
      currentRoundSpeakers: [], // 本轮已发言者列表
      turnMode: mapTurnModeFromStrategy(this.session.turnStrategy),
      discussionSessionId: this.threadId
    });

    // 3. 保存 DiscussionSession
    const discussionStore = await DiscussionStore.getInstance();
    await discussionStore.save(this.session);

    // 4. 添加协调者启动消息
    const participantNames = this.session.participants.map((p) => p.name || p.agentId).join(', ');
    await this.addCoordinatorMessage(
      `🚀 **Discussion Started**\n` +
        `- Topic: ${this.session.topic}\n` +
        `- Participants: ${participantNames}\n` +
        `- Max Rounds: ${this.session.maxRounds}\n` +
        `- Consensus Threshold: ${((this.session.consensusThreshold || 0.7) * 100).toFixed(0)}%\n` +
        `- Mode: ${this.getTurnMode() === 'sequential' ? '顺序发言' : '并发发言'}`
    );

    // 5. 开始第1轮协调（后台异步执行，不阻塞 start() 返回）
    // ✅ 使用 setImmediate 放到下一个事件循环，让 HTTP 请求先返回
    setImmediate(() => {
      this.coordinateNextRound().catch((err) => {
        log.error('[DiscussionCoordinator] Failed to start coordination:', err);
      });
    });

    log.info(`[DiscussionCoordinator] Discussion ${this.threadId} started (coordination running in background)`);
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

    // 3. 继续协调（后台异步执行）
    // ✅ 使用 setImmediate 放到下一个事件循环，让恢复操作立即返回
    setImmediate(() => {
      coordinator.coordinateNextRound().catch((err) => {
        log.error(`[DiscussionCoordinator] Failed to resume coordination for ${threadId}:`, err);
      });
    });

    log.info(`[DiscussionCoordinator] Discussion ${threadId} resumed (coordination running in background)`);

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

      // 加载 Checkpoint 获取当前轮次状态
      const checkpoint = await CheckpointManager.getInstance().load(this.threadId);
      const metadata = (checkpoint?.metadata as CoordinatorMetadata | undefined) || {
        currentRound: 1,
        currentSpeakerIndex: 0,
        currentRoundSpeakers: [],
        turnMode: 'sequential',
        discussionSessionId: this.threadId
      };

      // 1. 检查是否应该结束（在轮次开始前检查）
      if (metadata.currentRoundSpeakers.length === 0) {
        // 新一轮开始前，检查是否应该结束
        const shouldEnd = await this.checkShouldEnd(metadata.currentRound);
        if (shouldEnd.should) {
          await this.end(shouldEnd.reason);
          return;
        }

        // 📢 添加协调者轮次开始消息
        const activeParticipants = this.session.participants.filter((p) => p.active !== false);
        const maxRounds = this.session.maxRounds || 10;
        const participantNames = activeParticipants.map((p) => p.name || p.agentId).join(', ');

        await this.addCoordinatorMessage(
          `🎯 **Round ${metadata.currentRound}/${maxRounds}** - Mode: ${metadata.turnMode === 'sequential' ? '顺序发言' : '并发发言'}\n` +
            `👥 Participants: ${participantNames}\n` +
            `📝 Waiting for all participants to speak...`
        );
      }

      // 2. 判断本轮模式
      const turnMode = metadata.turnMode;
      const activeParticipants = this.session.participants.filter((p) => p.active !== false);

      if (activeParticipants.length === 0) {
        await this.end('No active participants');
        return;
      }

      // 3. 执行本轮发言
      if (turnMode === 'concurrent') {
        // 并发模式：所有人同时发言
        await this.executeRoundConcurrent(activeParticipants, metadata);
      } else {
        // 顺序模式：一个接一个
        await this.executeRoundSequential(activeParticipants, metadata);
      }

      // 4. 本轮结束后，使用 setImmediate 递归检查（避免调用栈溢出）
      // ✅ 每次递归都重新开始调用栈，防止无限增长
      setImmediate(() => {
        this.coordinateNextRound().catch((err) => {
          log.error('[DiscussionCoordinator] Failed to coordinate next round:', err);
        });
      });
    } catch (error) {
      log.error('[DiscussionCoordinator] Coordination error:', error);
      await this.end(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查是否应该结束讨论（每轮开始前调用）
   */
  private async checkShouldEnd(currentRound: number): Promise<{ should: boolean; reason?: string }> {
    // 1. 检查状态
    if (this.session.status !== 'active') {
      return { should: true, reason: 'Discussion already ended or paused' };
    }

    // 2. 检查轮次
    const maxRounds = this.session.maxRounds || 10;
    if (currentRound > maxRounds) {
      return { should: true, reason: `Reached max rounds (${maxRounds})` };
    }

    // 3. 第1轮不检查共识（还没人发言）
    if (currentRound === 1) {
      return { should: false };
    }

    // 4. 检查共识度（只检测参与者的消息）
    const participantMessages = this.session.messages.filter(
      (m) => m.agentId !== 'System' && m.agentId !== 'Coordinator'
    );

    // 至少需要所有参与者都发言过1次才能检测共识
    const activeCount = this.session.participants.filter((p) => p.active !== false).length;
    if (participantMessages.length < activeCount) {
      return { should: false };
    }

    const consensus = await this.consensusDetector.detect(participantMessages, this.session.consensusThreshold || 0.7);

    this.session.consensusLevel = consensus.level;

    // 更新到 DiscussionStore
    const store = await DiscussionStore.getInstance();
    await store.save(this.session);

    // 📢 添加共识检测结果消息
    const consensusPercent = (consensus.level * 100).toFixed(1);
    const thresholdPercent = ((this.session.consensusThreshold || 0.7) * 100).toFixed(0);
    const consensusStatus = consensus.achieved ? '✅ 达成共识' : '⏳ 未达成共识';

    await this.addCoordinatorMessage(
      `📊 **Consensus Check** (Round ${currentRound - 1} completed):\n` +
        `- Current: ${consensusPercent}%\n` +
        `- Threshold: ${thresholdPercent}%\n` +
        `- Status: ${consensusStatus}\n` +
        `- Decision: ${consensus.achieved ? '讨论将结束' : '继续下一轮'}`
    );

    if (consensus.achieved) {
      return {
        should: true,
        reason: `Consensus achieved (${consensusPercent}%)`
      };
    }

    return { should: false };
  }

  /**
   * 判断本轮模式（顺序/并发）
   */
  private getTurnMode(): 'sequential' | 'concurrent' {
    return mapTurnModeFromStrategy(this.session.turnStrategy);
  }

  /**
   * 执行一轮（顺序模式）
   * ✅ 所有参与者依次发言完才算一轮
   */
  private async executeRoundSequential(
    participants: DiscussionParticipant[],
    metadata: CoordinatorMetadata
  ): Promise<void> {
    // 获取本轮还需要发言的参与者
    const remainingSpeakers = participants.filter((p) => !metadata.currentRoundSpeakers.includes(p.agentId));

    if (remainingSpeakers.length === 0) {
      // 本轮所有人都发言完了，进入下一轮
      await this.advanceToNextRound(metadata);
      return;
    }

    // 执行下一个发言者
    const nextSpeaker = remainingSpeakers[0];
    await this.executeParticipant(nextSpeaker);

    // 更新 metadata：记录已发言
    metadata.currentRoundSpeakers.push(nextSpeaker.agentId);
    metadata.currentSpeakerIndex++;
    await this.updateCheckpoint(metadata);

    // 检查本轮是否完成
    if (metadata.currentRoundSpeakers.length >= participants.length) {
      // ✅ 本轮所有人都发言完了
      await this.advanceToNextRound(metadata);
    }
  }

  /**
   * 执行一轮（并发模式）
   * ✅ 所有参与者同时发言完才算一轮
   */
  private async executeRoundConcurrent(
    participants: DiscussionParticipant[],
    metadata: CoordinatorMetadata
  ): Promise<void> {
    // 获取本轮还需要发言的参与者
    const remainingSpeakers = participants.filter((p) => !metadata.currentRoundSpeakers.includes(p.agentId));

    if (remainingSpeakers.length === 0) {
      // 本轮所有人都发言完了，进入下一轮
      await this.advanceToNextRound(metadata);
      return;
    }

    // 并发执行所有剩余发言者
    await Promise.all(remainingSpeakers.map((speaker) => this.executeParticipant(speaker)));

    // 更新 metadata：记录所有人都发言了
    metadata.currentRoundSpeakers = participants.map((p) => p.agentId);
    await this.updateCheckpoint(metadata);

    // ✅ 本轮完成
    await this.advanceToNextRound(metadata);
  }

  /**
   * 进入下一轮
   */
  private async advanceToNextRound(metadata: CoordinatorMetadata): Promise<void> {
    log.info(`[DiscussionCoordinator] Round ${metadata.currentRound} completed, advancing to next round`);

    // 重置本轮发言记录，轮次+1
    metadata.currentRound++;
    metadata.currentSpeakerIndex = 0;
    metadata.currentRoundSpeakers = [];

    await this.updateCheckpoint(metadata);
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

      // 执行参与者 Agent（使用独立的子会话 ID）
      // ✅ 会话结构：主Thread (discussion-xxx) + 子会话 (discussion-xxx-agent-id)
      const participantSessionId = `${this.threadId}-${participant.agentId}`;

      const result = await runtime.executeAgent({
        agentId: participant.agentId,
        sessionId: participantSessionId, // ✅ 每个参与者独立会话
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
      const newMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: participant.agentId,
        content: result.output,
        type: 'statement' as const,
        timestamp: Date.now()
      };

      this.session.messages.push(newMessage);
      this.session.updatedAt = Date.now();

      // 更新 Checkpoint
      await this.updateCheckpoint();

      // 📢 发送前端通知（参与者发言完成）
      const { eventBus } = await import('@main/common/eventbus');
      eventBus.emit('discussion:message', {
        threadId: this.threadId,
        message: newMessage
      });

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
      currentRound: 1,
      currentSpeakerIndex: 0,
      currentRoundSpeakers: [],
      turnMode: 'sequential',
      discussionSessionId: this.threadId
    };

    const newCheckpoint: ThreadCheckpoint = {
      threadId: this.threadId,
      runStatus: 'running',
      updatedAt: new Date().toISOString(),
      metadata: metadata || currentMetadata
    };

    await CheckpointManager.getInstance().save(newCheckpoint);
  }

  /**
   * 结束讨论（生成最终结论）
   */
  private async end(reason?: string): Promise<void> {
    try {
      log.info(`[DiscussionCoordinator] Ending discussion: ${reason || 'Manual end'}`);

      this.session.status = 'completed';
      this.session.updatedAt = Date.now();

      // 1. 生成最终结论（协调者总结）
      const participantMessages = this.session.messages.filter(
        (m) => m.agentId !== 'System' && m.agentId !== 'Coordinator'
      );

      const conclusion = await this.generateConclusion(participantMessages);

      // 2. 添加协调者结束消息
      const consensusPercent = ((this.session.consensusLevel || 0) * 100).toFixed(1);
      const checkpoint = await CheckpointManager.getInstance().load(this.threadId);
      const currentRound = (checkpoint?.metadata as CoordinatorMetadata | undefined)?.currentRound || 1;

      await this.addCoordinatorMessage(
        `🏁 **Discussion Ended**\n` +
          `- Reason: ${reason || 'Manual end'}\n` +
          `- Final Consensus: ${consensusPercent}%\n` +
          `- Completed Rounds: ${currentRound - 1}\n` +
          `- Total Messages: ${participantMessages.length}\n\n` +
          `📝 **Final Conclusion**:\n${conclusion}`
      );

      // 3. 保存最终状态到 DiscussionStore
      const discussionStore = await DiscussionStore.getInstance();
      await discussionStore.save(this.session);

      // 4. 更新 Thread 为已完成
      const threadStore = await ThreadStore.getInstance();
      await threadStore.update(this.threadId, {
        runStatus: 'completed'
      });

      // 5. 清理 Checkpoint
      await CheckpointManager.getInstance().clear(this.threadId);

      // 6. 发送前端通知
      const { eventBus } = await import('@main/common/eventbus');
      eventBus.emit('discussion:ended', {
        threadId: this.threadId,
        reason: reason || 'Manual end',
        consensusLevel: this.session.consensusLevel,
        totalRounds: currentRound - 1,
        messageCount: participantMessages.length,
        conclusion
      });

      log.info(`[DiscussionCoordinator] Discussion ended successfully: ${this.threadId}`);
    } catch (error) {
      log.error(`[DiscussionCoordinator] Error ending discussion ${this.threadId}:`, error);
      throw error;
    }
  }

  /**
   * 生成最终结论（协调者使用 LLM 总结）
   */
  private async generateConclusion(participantMessages: DiscussionMessage[]): Promise<string> {
    try {
      // 构建讨论摘要
      const discussionSummary = participantMessages
        .map((m) => {
          const participant = this.session.participants.find((p) => p.agentId === m.agentId);
          const name = participant?.name || participant?.role || m.agentId;
          return `【${name}】: ${m.content}`;
        })
        .join('\n\n');

      // 使用 LLM 生成结论
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const coordinatorSessionId = `${this.threadId}-coordinator-summary`;

      const builder = agentExecutor.piMono();
      builder
        .agentId('discussion-coordinator')
        .instructions(
          `你是讨论协调者。请基于以下讨论内容生成最终结论。\n\n` +
            `**原始需求**：${this.session.topic}\n\n` +
            `**讨论内容**：\n${discussionSummary}\n\n` +
            `请分析：\n` +
            `1. 参与者的共识点是什么？\n` +
            `2. 是否回答了原始需求？\n` +
            `3. 最终的结论或建议是什么？\n\n` +
            `请用简洁的语言（200字以内）给出结论，不要重复讨论内容，只给出核心结论。`
        );

      const result = await agentExecutor.submitAndWait({
        sessionId: coordinatorSessionId,
        message: '请生成最终结论',
        builder
      });

      if (result.error) {
        log.error('[DiscussionCoordinator] Failed to generate conclusion:', result.error);
        return '协调者无法生成结论（LLM 调用失败）';
      }

      return result.output;
    } catch (error) {
      log.error('[DiscussionCoordinator] Error generating conclusion:', error);
      return '协调者无法生成结论（系统错误）';
    }
  }

  /**
   * 添加协调者状态消息
   */
  private async addCoordinatorMessage(content: string): Promise<void> {
    const store = await DiscussionStore.getInstance();
    await store.addMessage(this.threadId, {
      participant: 'Coordinator',
      content,
      timestamp: Date.now(),
      type: 'statement'
    });

    // 同步到内存（避免下次需要重新加载）
    const newMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: 'Coordinator',
      content,
      type: 'statement' as const,
      timestamp: Date.now()
    };

    this.session.messages.push(newMessage);
    this.session.updatedAt = Date.now();

    // 📢 发送前端通知（协调者消息）
    const { eventBus } = await import('@main/common/eventbus');
    eventBus.emit('discussion:message', {
      threadId: this.threadId,
      message: newMessage
    });
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
