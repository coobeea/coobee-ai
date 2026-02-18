/**
 * AgentPool - 动态 Agent 池
 *
 * SDK 无关 — 管理 AgentRuntime 实例的创建、复用和退休。
 * 通过 AgentExecutor.piMono() 创建运行时实例。
 *
 * 功能：
 * - 按角色按需创建 AgentRuntime
 * - 空闲 Agent 自动复用
 * - 超时自动退休
 * - 池大小限制 + LRU 淘汰
 * - 性能追踪（执行次数、成功率）
 */

import { createLogger } from '@main/common/logger';
import type { AgentRuntime } from '../runtime/AgentRuntime';
import type { ToolDefinition } from '../tools/types';
import type { AgentRole, PoolAgentEntry, SwarmConfig } from './types';

const log = createLogger('swarm:pool');

/**
 * Agent 池事件类型
 */
export type AgentPoolEvent =
  | { type: 'agent_created'; poolId: string; roleId: string }
  | { type: 'agent_acquired'; poolId: string; roleId: string }
  | { type: 'agent_released'; poolId: string; roleId: string }
  | { type: 'agent_retired'; poolId: string; roleId: string; reason: string };

/**
 * Agent 池事件监听器
 */
export type AgentPoolEventListener = (event: AgentPoolEvent) => void;

/**
 * 创建运行时工厂函数类型
 * 由 SwarmCoordinator 注入，解耦 AgentPool 对 AgentExecutor 的直接依赖
 */
export type RuntimeFactory = (
  role: AgentRole,
  sessionId: string,
  extraTools?: ToolDefinition[]
) => Promise<AgentRuntime>;

/**
 * 动态 Agent 池
 */
export class AgentPool {
  private pool = new Map<string, PoolAgentEntry>();
  private createCounter = 0;
  private retiredCount = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private eventListeners: AgentPoolEventListener[] = [];
  private runtimeFactory: RuntimeFactory | null = null;

  constructor(private readonly config: SwarmConfig) {}

  /**
   * 注入运行时工厂
   */
  setRuntimeFactory(factory: RuntimeFactory): void {
    this.runtimeFactory = factory;
  }

  // ========== 生命周期 ==========

  start(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleAgents();
    }, 60 * 1000);

    log.info('Agent pool started', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      agentIdleTimeout: this.config.agentIdleTimeout
    });
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [poolId] of this.pool) {
      await this.retireAgent(poolId, 'pool_stopped');
    }

    this.pool.clear();
    this.eventListeners = [];
    log.info('Agent pool stopped');
  }

  // ========== Agent 获取与释放 ==========

  async acquireAgent(
    role: AgentRole,
    extraTools?: ToolDefinition[]
  ): Promise<{ runtime: AgentRuntime; poolId: string }> {
    const idleEntry = this.findIdleAgent(role.id);
    if (idleEntry) {
      idleEntry.status = 'busy';
      idleEntry.lastActiveAt = Date.now();
      idleEntry.taskCount++;

      this.emitEvent({ type: 'agent_acquired', poolId: idleEntry.poolId, roleId: role.id });
      log.debug(`Reused idle agent ${idleEntry.poolId} for role: ${role.id}`);
      return { runtime: idleEntry.runtime, poolId: idleEntry.poolId };
    }

    const activeCount = this.getActiveCount();
    if (activeCount >= this.config.maxConcurrentAgents) {
      const evicted = await this.evictLRU();
      if (!evicted) {
        throw new Error(
          `Agent pool capacity exceeded (${activeCount}/${this.config.maxConcurrentAgents}), no idle agents to evict`
        );
      }
    }

    if (!this.runtimeFactory) {
      throw new Error('RuntimeFactory not set. Call setRuntimeFactory() before acquiring agents.');
    }

    const poolId = this.generatePoolId(role.id);
    const sessionId = `swarm-${poolId}-${Date.now()}`;
    const runtime = await this.runtimeFactory(role, sessionId, extraTools);

    const entry: PoolAgentEntry = {
      runtime,
      role,
      poolId,
      status: 'busy',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      taskCount: 1,
      successCount: 0,
      failCount: 0
    };

    this.pool.set(poolId, entry);
    this.emitEvent({ type: 'agent_created', poolId, roleId: role.id });
    log.debug(`Created new agent ${poolId} for role: ${role.id}`);

    return { runtime, poolId };
  }

  releaseAgent(poolId: string, success: boolean = true): void {
    const entry = this.pool.get(poolId);
    if (!entry || entry.status === 'retiring') return;

    entry.status = 'idle';
    entry.lastActiveAt = Date.now();
    if (success) entry.successCount++;
    else entry.failCount++;

    this.emitEvent({ type: 'agent_released', poolId, roleId: entry.role.id });
  }

  async retireAgent(poolId: string, reason: string): Promise<void> {
    const entry = this.pool.get(poolId);
    if (!entry) return;

    entry.status = 'retiring';
    try {
      await entry.runtime.destroy();
    } catch (err) {
      log.warn(`Failed to destroy runtime for ${poolId}`, err);
    }

    this.pool.delete(poolId);
    this.retiredCount++;
    this.emitEvent({ type: 'agent_retired', poolId, roleId: entry.role.id, reason });
  }

  // ========== 查询方法 ==========

  private findIdleAgent(roleId: string): PoolAgentEntry | undefined {
    for (const entry of this.pool.values()) {
      if (entry.role.id === roleId && entry.status === 'idle') return entry;
    }
    return undefined;
  }

  getActiveCount(): number {
    let count = 0;
    for (const entry of this.pool.values()) {
      if (entry.status !== 'retiring') count++;
    }
    return count;
  }

  getBusyCount(): number {
    let count = 0;
    for (const entry of this.pool.values()) {
      if (entry.status === 'busy') count++;
    }
    return count;
  }

  getAgentsByRole(roleId: string): PoolAgentEntry[] {
    const result: PoolAgentEntry[] = [];
    for (const entry of this.pool.values()) {
      if (entry.role.id === roleId) result.push(entry);
    }
    return result;
  }

  getEntry(poolId: string): PoolAgentEntry | undefined {
    return this.pool.get(poolId);
  }

  getStats(): {
    totalCreated: number;
    currentActive: number;
    currentBusy: number;
    currentIdle: number;
    totalRetired: number;
    roleDistribution: Record<string, number>;
  } {
    const roleDistribution: Record<string, number> = {};
    let currentBusy = 0;
    let currentIdle = 0;

    for (const entry of this.pool.values()) {
      if (entry.status === 'busy') currentBusy++;
      if (entry.status === 'idle') currentIdle++;
      roleDistribution[entry.role.id] = (roleDistribution[entry.role.id] || 0) + 1;
    }

    return {
      totalCreated: this.createCounter,
      currentActive: this.pool.size,
      currentBusy,
      currentIdle,
      totalRetired: this.retiredCount,
      roleDistribution
    };
  }

  // ========== 清理策略 ==========

  private cleanupIdleAgents(): void {
    const now = Date.now();
    const toRetire: string[] = [];

    for (const [poolId, entry] of this.pool.entries()) {
      if (entry.status === 'idle' && now - entry.lastActiveAt > this.config.agentIdleTimeout) {
        toRetire.push(poolId);
      }
    }

    for (const poolId of toRetire) {
      void this.retireAgent(poolId, 'idle_timeout');
    }

    if (toRetire.length > 0) {
      log.debug(`Cleaned up ${toRetire.length} idle agents`);
    }
  }

  private async evictLRU(): Promise<boolean> {
    let oldestPoolId: string | null = null;
    let oldestTime = Infinity;

    for (const [poolId, entry] of this.pool.entries()) {
      if (entry.status === 'idle' && entry.lastActiveAt < oldestTime) {
        oldestTime = entry.lastActiveAt;
        oldestPoolId = poolId;
      }
    }

    if (oldestPoolId) {
      await this.retireAgent(oldestPoolId, 'lru_eviction');
      return true;
    }
    return false;
  }

  // ========== 事件系统 ==========

  addEventListener(listener: AgentPoolEventListener): void {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener: AgentPoolEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) this.eventListeners.splice(index, 1);
  }

  private emitEvent(event: AgentPoolEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('Event listener error', error);
      }
    }
  }

  private generatePoolId(roleId: string): string {
    this.createCounter++;
    return `${roleId}-${this.createCounter}-${Date.now().toString(36)}`;
  }
}
