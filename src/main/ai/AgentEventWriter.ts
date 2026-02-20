/**
 * Agent 事件分发器（统一入口）
 *
 * 所有 StreamChunk 事件的单一出口，同时完成两件事：
 *   1. 持久化 → 追加写入 events.jsonl
 *   2. 推送前端 → 通过注册的 StreamEmitter 广播到 EventBus
 *
 * 设计原则：
 *   - 单一 seq 计数器：所有事件（Runtime + Extension）共享一个单调递增的 seq，保证唯一性
 *   - 单一入口：调用方只需 dispatch(chunk)，不需要手动同时调用 emitter 和 writer
 *   - 会话级注册表：Extension 等外部模块通过 sessionId 找到对应的 dispatcher
 *
 * 使用方式：
 *   AgentExecutor:
 *     const writer = new AgentEventWriter(workspace)
 *     writer.register(sessionId)
 *     writer.setEmitter(emitter)   // 注册 StreamEmitter
 *     ...
 *     writer.dispatch(chunk)       // 一次调用 = 写文件 + 推前端
 *
 *   Extension:
 *     AgentEventWriter.dispatchForSession(sessionId, chunk)  // 同样一次调用 = 两件事
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { StreamChunk } from './runtime/types';
import type { IStreamEmitter } from './streaming/StreamEmitter';

const log = createLogger('event-writer');

/** 会话级 writer 注册表 */
const sessionWriters = new Map<string, AgentEventWriter>();

export class AgentEventWriter {
  private eventsFile: string | null;
  /** 全局唯一序列号（Runtime + Extension 共用） */
  private seq = 0;
  /** 注册的 StreamEmitter — 用于推送前端 */
  private emitter: IStreamEmitter | null = null;

  constructor(workspace: string | undefined) {
    this.eventsFile = workspace ? path.join(workspace, 'events', 'events.jsonl') : null;
  }

  /** 彻底清理当前实例（供异常销毁时备用） */
  destroy(sessionId: string): void {
    this.unregister(sessionId);
  }

  /** 注册到会话注册表 + 设置 emitter */
  register(sessionId: string): void {
    sessionWriters.set(sessionId, this);
  }

  /** 注册 StreamEmitter（推前端） */
  setEmitter(emitter: IStreamEmitter): void {
    this.emitter = emitter;
  }

  /** 从注册表中移除 */
  unregister(sessionId: string): void {
    if (sessionWriters.get(sessionId) === this) {
      sessionWriters.delete(sessionId);
    }
    this.emitter = null;
  }

  // ==================== 核心方法 ====================

  /**
   * 分发事件（统一入口）
   *
   * 一次调用同时完成：
   *   1. 分配全局唯一 seq
   *   2. 写入 events.jsonl
   *   3. 通过 StreamEmitter 推送前端
   *
   * @returns 分配的 seq 编号
   */
  dispatch(chunk: StreamChunk): number {
    const seq = ++this.seq;

    // 1. 持久化到文件
    this.writeEvent(chunk, seq);

    // 2. 推送到前端
    if (this.emitter) {
      try {
        this.emitter.forward(chunk);
      } catch (err) {
        log.warn(`[AgentEventWriter] Emitter forward failed (seq=${seq}):`, err);
      }
    }

    return seq;
  }

  // ==================== 兼容方法（逐步废弃） ====================

  /**
   * @deprecated 使用 dispatch() 替代。保留是为了兼容旧代码。
   */
  append(chunk: StreamChunk, seq: number): void {
    this.seq = Math.max(this.seq, seq);
    this.writeEvent(chunk, seq);
  }

  // ==================== 内部方法 ====================

  private writeEvent(chunk: StreamChunk, seq: number): void {
    if (!this.eventsFile) return;
    try {
      const dir = path.dirname(this.eventsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const line = JSON.stringify({
        ts: new Date().toISOString(),
        seq,
        type: chunk.type,
        content: chunk.content,
        ...(chunk.data ? { data: chunk.data } : {})
      });
      fs.appendFileSync(this.eventsFile, line + '\n');
    } catch (err) {
      log.warn(`[AgentEventWriter] Write failed (seq=${seq}):`, err);
    }
  }

  /** 事件文件路径 */
  get filePath(): string | null {
    return this.eventsFile;
  }

  // ==================== 静态 API（供 Extension 使用） ====================

  /**
   * 通过 sessionId 分发事件
   *
   * Extension 调用此方法，自动完成：写文件 + 推前端。
   * 与 dispatch() 行为一致，seq 严格递增。
   *
   * **Multi-Agent 支持**：
   * 如果 sessionId 包含冒号（如 `main:child`），说明是子 Agent 会话，
   * 会同时将事件转发到主 sessionId，并在 data 中标记 `subSessionId`，
   * 这样前端订阅主 thread 时也能收到子 Agent 的 HITL 审批事件。
   */
  static dispatchForSession(sessionId: string, chunk: StreamChunk): void {
    const writer = sessionWriters.get(sessionId);
    if (writer) {
      writer.dispatch(chunk);
    } else {
      log.debug(`[AgentEventWriter] No writer for session ${sessionId}, event dropped`);
    }

    // Multi-Agent: 如果是子会话，转发到主 thread
    if (sessionId.includes(':')) {
      const mainThreadId = sessionId.split(':')[0];
      const mainWriter = sessionWriters.get(mainThreadId);

      if (mainWriter && mainWriter !== writer) {
        // 避免重复转发（主会话本身不需要转发给自己）
        const modifiedChunk: StreamChunk = {
          ...chunk,
          data: {
            ...(chunk.data ?? {}),
            subSessionId: sessionId // 标记来源子会话
          }
        };
        mainWriter.dispatch(modifiedChunk);
        log.debug(`[AgentEventWriter] Forwarded event from ${sessionId} to ${mainThreadId}`);
      }
    }
  }

  /** 获取指定会话的 writer（调试用） */
  static getWriter(sessionId: string): AgentEventWriter | undefined {
    return sessionWriters.get(sessionId);
  }
}
