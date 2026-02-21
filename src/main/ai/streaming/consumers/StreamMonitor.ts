/**
 * 流式监控器（消费者 3：监控统计）
 * 监听 EventBus 的流式事件，收集统计信息
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import { StreamEventType, type StreamEvent } from '../types';

/**
 * 会话统计信息
 */
export interface SessionStats {
  sessionId: string;
  messageCount: number;
  textCount: number;
  toolCallCount: number;
  handoffCount: number;
  errorCount: number;
  startTime?: number;
  endTime?: number;
  duration?: number;
  lastSequence: number;
}

/**
 * 流式监控器
 */
export class StreamMonitor {
  private sessionStats = new Map<string, SessionStats>();
  private initialized = false;

  // EventBus 监听器引用（用于清理）
  private readonly handleStart: (event: StreamEvent) => void;
  private readonly handleMessage: (event: StreamEvent) => void;
  private readonly handleEnd: (event: StreamEvent) => void;
  private readonly handleError: (event: StreamEvent) => void;

  constructor() {
    // 在构造函数中绑定所有 handler，确保 off() 时引用一致
    this.handleStart = (event: StreamEvent) => {
      const stats: SessionStats = {
        sessionId: event.sessionId,
        messageCount: 0,
        textCount: 0,
        toolCallCount: 0,
        handoffCount: 0,
        errorCount: 0,
        startTime: Date.now(),
        lastSequence: 0
      };
      this.sessionStats.set(event.sessionId, stats);
      log.info(`[StreamMonitor] Stream started: ${event.sessionId}`);
    };

    this.handleMessage = (event: StreamEvent) => {
      if (!event.message) return;

      const stats = this.getOrCreateStats(event.sessionId);
      stats.messageCount++;
      stats.lastSequence = event.message.sequence;

      // 分类统计
      switch (event.message.type) {
        case 'text:delta':
        case 'reasoning:delta':
          stats.textCount++;
          break;
        case 'tool:start':
        case 'tool:done':
          stats.toolCallCount++;
          break;
        case 'handoff:start':
        case 'handoff:done':
          stats.handoffCount++;
          break;
        case 'run:error':
          stats.errorCount++;
          break;
      }
    };

    this.handleEnd = (event: StreamEvent) => {
      const stats = this.sessionStats.get(event.sessionId);
      if (stats && stats.startTime) {
        stats.endTime = Date.now();
        stats.duration = stats.endTime - stats.startTime;
      }
      log.info(`[StreamMonitor] Stream ended: ${event.sessionId}`, stats);

      // 延迟 60 秒后清理，保留一段时间供查询
      setTimeout(() => {
        this.sessionStats.delete(event.sessionId);
      }, 60_000);
    };

    this.handleError = (event: StreamEvent) => {
      const stats = this.getOrCreateStats(event.sessionId);
      stats.errorCount++;
      log.error(`[StreamMonitor] Stream error: ${event.sessionId}`, event.error);
    };
  }

  /**
   * 初始化（注册事件监听）
   */
  initialize(): void {
    if (this.initialized) return;

    this.registerEventListeners();

    this.initialized = true;
    log.info('[StreamMonitor] Initialized');
  }

  /**
   * 清理资源（移除 EventBus 监听器）
   */
  destroy(): void {
    if (!this.initialized) return;

    // 移除所有 EventBus 监听器
    eventBus.off(StreamEventType.START, this.handleStart);
    eventBus.off(StreamEventType.MESSAGE, this.handleMessage);
    eventBus.off(StreamEventType.END, this.handleEnd);
    eventBus.off(StreamEventType.ERROR, this.handleError);

    // 清空统计数据
    this.sessionStats.clear();

    this.initialized = false;
    log.info('[StreamMonitor] Destroyed');
  }

  /**
   * 注册事件监听器（消费者核心）
   */
  private registerEventListeners(): void {
    // 使用预先绑定的 handler
    eventBus.on(StreamEventType.START, this.handleStart);
    eventBus.on(StreamEventType.MESSAGE, this.handleMessage);
    eventBus.on(StreamEventType.END, this.handleEnd);
    eventBus.on(StreamEventType.ERROR, this.handleError);

    log.info('[StreamMonitor] Event listeners registered');
  }

  /**
   * 获取或创建统计信息
   */
  private getOrCreateStats(sessionId: string): SessionStats {
    let stats = this.sessionStats.get(sessionId);
    if (!stats) {
      stats = {
        sessionId,
        messageCount: 0,
        textCount: 0,
        toolCallCount: 0,
        handoffCount: 0,
        errorCount: 0,
        lastSequence: 0
      };
      this.sessionStats.set(sessionId, stats);
    }
    return stats;
  }

  /**
   * 获取会话统计
   */
  getStats(sessionId: string): SessionStats | null {
    return this.sessionStats.get(sessionId) || null;
  }

  /**
   * 获取所有会话统计
   */
  getAllStats(): SessionStats[] {
    return Array.from(this.sessionStats.values());
  }

  /**
   * 清除会话统计
   */
  clearStats(sessionId: string): void {
    this.sessionStats.delete(sessionId);
  }

  /**
   * 清除所有统计
   */
  clearAllStats(): void {
    this.sessionStats.clear();
  }
}

/**
 * 全局 StreamMonitor 实例
 */
export const streamMonitor = new StreamMonitor();
