/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，职责聚焦于：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. Builder 工厂 — piMono() / openai()
 *
 * 已提取的职责：
 *   - Builder 实现 → runtime/pimono/PiMonoBuilder.ts, runtime/openai/OpenAIBuilder.ts
 *   - 环境注入 → AgentEnvInjector.ts
 *   - 事件写入 → AgentEventWriter.ts
 *   - 执行协议 → AgentEnvInjector.ts (buildExecutionProtocol)
 *   - HITL 审批 → extensions/tool-approval（通过 before_tool_call Hook）
 *
 * 设计哲学（参考 OpenClaw pi-integration-architecture）：
 *   - 消息驱动：每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程
 *   - 无状态实例：Runtime 对象用完即丢，由 GC 回收
 *   - 有状态存储：会话连续性靠 JSONL 文件持久化（SDK 自动管理）
 */

import { createLogger } from '@main/common/logger';

const log = createLogger('ai');

import type { AgentRuntime } from './runtime/AgentRuntime';
import type { AgentMode, ExecutionResult, StreamChunk } from './runtime/types';
import { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder';
import { OpenAIBuilder } from './runtime/openai/OpenAIBuilder';
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter';
import type { StreamSource } from './streaming/types';
import { injectEnv } from './AgentEnvInjector';
import { AgentEventWriter } from './AgentEventWriter';
import { resolveApiKey } from './provider/ApiKeyResolver';
import type { ProviderRegistry } from './provider/ProviderRegistry';
import type { ModelSelector } from './provider/ModelSelector';
import { MessagePipeline } from './pipeline/MessagePipeline';
import type { QueueSettings, SubmitResult } from './pipeline/types';
import { SkillManager } from './skills/SkillManager';
import { CheckpointManager } from './threads/CheckpointManager';

// ==================== 类型定义 ====================

/** 支持的 Builder 类型 */
export type AgentBuilder = PiMonoBuilder | OpenAIBuilder;

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 */
  message: string;
  /** Builder 实例（通过 agentExecutor.piMono() 或 agentExecutor.openai() 创建） */
  builder?: AgentBuilder;
  /** 预构建的 Runtime（Orchestrator / Swarm 等已初始化的运行时，跳过 Builder 流程） */
  runtime?: AgentRuntime;
  /** 流式事件回调（可选） */
  onChunk?: (chunk: StreamChunk) => void;
  /** 中止信号（Pipeline 传入，用于提前终止流式消费） */
  signal?: AbortSignal;
}

/** 执行状态 */
export interface SessionStatus {
  /** 是否正在执行 */
  busy: boolean;
  /** 开始时间（busy 时有值） */
  startedAt?: number;
}

// ==================== AgentExecutor ====================

/** Provider 系统接口 */
export interface ProviderSystem {
  registry: ProviderRegistry;
  selector: ModelSelector;
}

class AgentExecutor {
  /** 正在执行的 session 集合 */
  private busySessions = new Map<string, { startedAt: number }>();

  /** 有待审批的 session（hitl:required 已触发，checkpoint 保持 approval-pending） */
  private pendingApprovalSessions = new Map<string, { addedAt: number }>();

  /** 审批等待 TTL（2 小时） */
  private static readonly APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;

  /** 上次清理时间 */
  private lastApprovalCleanupTime = Date.now();

  /** Provider 系统（初始化后注入） */
  private providerSystem: ProviderSystem | null = null;

  /** 消息管线（可选，初始化后注入） */
  private pipeline: MessagePipeline | null = null;

  /** Session → AgentMode 映射（管线执行时用于创建 builder） */
  private sessionModes = new Map<string, AgentMode>();

  /** Builder 工厂（管线执行时创建 builder；由 chat.ts 注册） */
  private builderFactory: ((mode: AgentMode) => AgentBuilder) | null = null;

  // ========== Provider 系统 ==========

  /**
   * 注入 Provider 系统（应用初始化时调用）
   */
  setProviderSystem(system: ProviderSystem): void {
    this.providerSystem = system;
  }

  /**
   * 获取 Provider 系统（chat.ts 等消费者使用）
   */
  getProviderSystem(): ProviderSystem | null {
    return this.providerSystem;
  }

  /**
   * 注入 Provider 配置到 Builder（API Key + 模型 + baseURL）
   *
   * 供 chat.ts、Orchestrator Worker、Swarm Role 等所有创建 Agent 的地方使用。
   * 如果 Provider 系统未就绪或无可用配置，静默回退。
   */
  applyProviderConfig(builder: PiMonoBuilder): void {
    try {
      if (!this.providerSystem) return;
      const { selector, registry } = this.providerSystem;
      const ref = selector.resolve();
      const provider = registry.get(ref.provider);
      if (!provider) return;

      const apiKey = resolveApiKey(provider.apiKey, provider.id);
      if (!apiKey) return;

      builder.fromProviderConfig(provider, ref.model);
    } catch {
      // Provider 系统未就绪，静默回退
    }
  }

  /**
   * 注入默认思维链级别到 Builder
   *
   * 从 coobee.json5 读取 models.defaults.thinkingLevel，默认 'medium'。
   * 注意：这是同步方法，使用延迟导入避免循环依赖。
   */
  applyThinkingLevel(builder: PiMonoBuilder): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const config = configStoreInstance?.getAll?.();
      const level = config?.models?.defaults?.thinkingLevel;
      if (level) {
        builder.thinkingLevel(level);
        return;
      }
    } catch {
      // 静默回退
    }
    builder.thinkingLevel('medium');
  }

  // ========== 消息管线 ==========

  /**
   * 注册 Builder 工厂
   *
   * 管线执行时通过此工厂创建 Builder（包含工具、指令、Provider 配置等）。
   * 由 chat.ts 在加载时注册。
   */
  setBuilderFactory(factory: (mode: AgentMode) => AgentBuilder): void {
    this.builderFactory = factory;
  }

  /**
   * 使用已注册的 builderFactory 创建 Builder
   *
   * 供 ThreadWaker 等模块在恢复执行时使用。
   * 如果 factory 未注册则返回 null。
   */
  createBuilderFromFactory(mode: AgentMode): AgentBuilder | null {
    return this.builderFactory ? this.builderFactory(mode) : null;
  }

  /**
   * 初始化消息管线
   *
   * 创建 MessagePipeline 并注入到当前 AgentExecutor。
   * 管线的执行器委托给内部 execute() 方法，使用 builderFactory 创建 Builder。
   */
  initPipeline(settings?: Partial<QueueSettings>): void {
    this.pipeline = new MessagePipeline(async (sessionId, message, signal) => {
      const mode = this.sessionModes.get(sessionId) ?? 'agent';

      if (!this.builderFactory) {
        log.error(`[AgentExecutor] Pipeline executor: no builderFactory registered`);
        // 通知前端：发射 run:error 到 EventBus
        try {
          const { eventBus } = await import('@main/common/eventbus');
          const { StreamEventType } = await import('./streaming/types');
          eventBus.emit(StreamEventType.MESSAGE, {
            sessionId,
            type: 'run:error',
            content: 'Internal error: builderFactory not registered'
          });
        } catch {
          // eventBus 不可用时静默
        }
        return;
      }

      const builder = this.builderFactory(mode);
      const request: ExecuteRequest = { sessionId, message, builder, signal };

      this.busySessions.set(sessionId, { startedAt: Date.now() });
      try {
        await this.execute(request);
      } finally {
        this.busySessions.delete(sessionId);
        this.sessionModes.delete(sessionId);
      }
    }, settings);
  }

  /**
   * 获取消息管线
   */
  getPipeline(): MessagePipeline | null {
    return this.pipeline;
  }

  /**
   * 通过管线提交消息
   *
   * 如果管线已初始化，使用管线的排队/合并/中断能力。
   * 否则回退到原始的 busySessions 逻辑。
   *
   * @param sessionId - 会话 ID
   * @param message - 用户消息
   * @param mode - Agent 模式（默认 'agent'），管线执行器据此创建 Builder
   */
  async submitViaPipeline(sessionId: string, message: string, mode: AgentMode = 'agent'): Promise<SubmitResult | null> {
    if (!this.pipeline) return null;
    this.sessionModes.set(sessionId, mode);
    return await this.pipeline.submit(sessionId, message);
  }

  /**
   * 中止 session 执行
   */
  abort(sessionId: string): boolean {
    if (this.pipeline) {
      return this.pipeline.abort(sessionId);
    }
    // 无管线时，仅标记为非 busy
    const existed = this.busySessions.has(sessionId);
    this.busySessions.delete(sessionId);
    return existed;
  }

  // ========== Builder 工厂 ==========

  /**
   * 创建 PiMono Agent Builder（自动注入 Provider 配置 + 思维链级别）
   *
   * 所有通过此工厂创建的 Agent（单 Agent、Orchestrator Worker、Swarm Role 等）
   * 天然就有 API Key、model、baseURL 和 thinkingLevel。
   * 调用方只需关心自己的业务配置（instructions、tools、name 等）。
   * 如需覆盖模型，在工厂返回后调 .model() 即可。
   */
  piMono(): PiMonoBuilder {
    const builder = new PiMonoBuilder();
    this.applyProviderConfig(builder);
    this.applyThinkingLevel(builder);
    return builder;
  }

  /** 创建 OpenAI Agent Builder */
  openai(): OpenAIBuilder {
    return new OpenAIBuilder();
  }

  // ========== 提交执行 ==========

  /**
   * 提交执行请求（非阻塞）
   *
   * 立即返回状态，流式事件通过 StreamEmitter → EventBus → WebSocket 推送。
   * 如果 session 正在执行中，返回 busy 错误。
   */
  submit(request: ExecuteRequest): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string } {
    const { sessionId } = request;

    if (this.busySessions.has(sessionId)) {
      log.warn(`[AgentExecutor] Session busy: ${sessionId}`);
      return { status: 'busy', sessionId };
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() });

    this.execute(request)
      .catch((error: unknown) => {
        log.error(`[AgentExecutor] Execution failed: sessionId=${sessionId}`, error);
      })
      .finally(() => {
        this.busySessions.delete(sessionId);
      });

    return { status: 'accepted', sessionId };
  }

  /**
   * 清理审批等待状态（ThreadWaker 恢复后调用）
   */
  clearPendingApproval(sessionId: string): void {
    const deleted = this.pendingApprovalSessions.delete(sessionId);
    if (deleted) {
      log.info(`[AgentExecutor] Cleared pending approval for ${sessionId}`);
    }
  }

  /**
   * 清理过期的审批等待（TTL 机制）
   * 每 5 分钟检查一次，清理超过 2 小时的条目
   */
  private cleanupExpiredApprovals(): void {
    const now = Date.now();
    // 每 5 分钟检查一次
    if (now - this.lastApprovalCleanupTime < 5 * 60 * 1000) return;
    this.lastApprovalCleanupTime = now;

    let cleanedCount = 0;
    for (const [sid, entry] of this.pendingApprovalSessions) {
      if (now - entry.addedAt > AgentExecutor.APPROVAL_TTL_MS) {
        this.pendingApprovalSessions.delete(sid);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.info(`[AgentExecutor] Cleaned up ${cleanedCount} expired pending approvals`);
    }
  }

  /**
   * 提交并等待执行完成（阻塞）
   *
   * 适用于需要同步获取结果的场景（如测试）。
   */
  async submitAndWait(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId } = request;

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() });
    try {
      return await this.execute(request);
    } finally {
      this.busySessions.delete(sessionId);
    }
  }

  // ========== 状态查询 ==========

  /** 查询 session 状态 */
  getStatus(sessionId: string): SessionStatus {
    if (this.pipeline) {
      const status = this.pipeline.getQueueStatus(sessionId);
      if (status.isRunning) {
        // pipeline is running, try to get startedAt from busySessions if it's there
        const info = this.busySessions.get(sessionId);
        return { busy: true, startedAt: info?.startedAt };
      }
    }

    const info = this.busySessions.get(sessionId);
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false };
  }

  /** 获取所有活跃 session */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    // If pipeline is used, we should ideally combine pipeline active sessions and busySessions.
    // However, pipeline's getQueueStatus doesn't provide a way to list ALL active sessions easily.
    // Given the architecture, busySessions is populated during execute(), which pipeline also calls.
    // So busySessions should still be the source of truth for "currently executing" sessions.
    return Array.from(this.busySessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }));
  }

  // ========== 流式执行（SSE 透传） ==========

  /**
   * 流式执行 — AsyncGenerator 透传
   *
   * 供 SSE 端点直接 yield* 使用。
   * 内部管理完整的 busy 锁 + 创建 → stream() → 销毁 生命周期。
   * 每个 chunk 同时通过 StreamEmitter.forward() 广播到 EventBus。
   */
  async *stream(request: Omit<ExecuteRequest, 'onChunk'>): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId, message, builder, signal } = request;

    if (!builder) {
      throw new Error('stream() requires a builder. Use submit() with runtime for pre-built runtimes.');
    }

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() });
    let runtime: AgentRuntime | null = null;

    log.info(`[AgentExecutor] Stream: sessionId=${sessionId}, messageLen=${message.length}`);

    let eventWriter: AgentEventWriter | null = null;

    try {
      // 0. 注入运行时环境
      const workspace = await injectEnv(sessionId, builder);
      eventWriter = new AgentEventWriter(workspace);
      eventWriter.register(sessionId);

      // 1. 创建 Runtime + 注册统一分发器
      runtime = await builder.sessionId(sessionId).build();
      eventWriter.setEmitter(this.createEmitter(sessionId, runtime));

      // 2. 透传 stream()（同步触发 Extension Hook），传入 signal
      const gen = runtime.stream(message, { signal });
      let turnStartTime = 0;
      let turnToolCallCount = 0;

      let r = await gen.next();
      while (!r.done) {
        const chunk = r.value;

        // 统一分发：写文件 + 推前端（唯一入口）
        eventWriter.dispatch(chunk);

        if (chunk.type === 'run:error') {
          log.error(`[AgentExecutor] API error: sessionId=${sessionId}, error=${chunk.content}`);
        }

        // Extension Hook 触发（与 consumeAndForward 一致）
        this.fireChunkHooks(chunk, sessionId, {
          getTurnStartTime: () => turnStartTime,
          getTurnToolCallCount: () => turnToolCallCount
        });

        if (chunk.type === 'turn:start') {
          turnStartTime = Date.now();
          turnToolCallCount = 0;
        } else if (chunk.type === 'tool:done') {
          turnToolCallCount++;
        }

        yield chunk;
        r = await gen.next();
      }

      this.logCompletion(sessionId, r.value);
      return r.value;
    } catch (error: unknown) {
      log.error(`[AgentExecutor] Stream error: sessionId=${sessionId}`, error);
      throw error;
    } finally {
      eventWriter?.unregister(sessionId);
      await this.destroyRuntime(runtime);
      runtime = null;
      this.busySessions.delete(sessionId);
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并通过统一分发器处理所有事件
   *
   * 事件通过 eventWriter.dispatch() 统一处理：
   *   - 分配唯一 seq（与 Extension 事件共享同一个计数器）
   *   - 写入 events.jsonl
   *   - 推送到前端（通过注册的 StreamEmitter）
   *
   * 同时在关键流式事件上触发 Extension Hook：
   *   - turn:start → turn_start (void)
   *   - turn:done  → turn_end (void)
   *   - compression:start → before_compaction (void)
   *   - compression:done  → after_compaction (void)
   */
  private async consumeAndForward(
    gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
    eventWriter: AgentEventWriter,
    sessionId: string,
    onChunk?: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<ExecutionResult> {
    // Turn 状态跟踪（用于 turn_end 事件数据）
    let turnStartTime = 0;
    let turnToolCallCount = 0;

    const checkpoint = CheckpointManager.getInstance();

    // 标记开始执行
    checkpoint.updateStatus(sessionId, 'running').catch(() => {});

    let r = await gen.next();
    while (!r.done) {
      // 检测中止信号：提前退出循环，通知 generator 结束
      if (signal?.aborted) {
        log.info(`[AgentExecutor] Aborted: sessionId=${sessionId}`);
        await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
        checkpoint.updateStatus(sessionId, 'idle').catch(() => {});
        return { output: '', error: 'Aborted by user' };
      }

      const chunk = r.value;

      // 统一分发：写文件 + 推前端（唯一入口，seq 全局唯一）
      eventWriter.dispatch(chunk);

      // === 检查点更新（fire-and-forget） ===
      this.updateCheckpoint(checkpoint, sessionId, chunk);

      if (chunk.type === 'run:error') {
        log.error(`[AgentExecutor] API error in execute: error=${chunk.content}`);
      }

      // === Extension Hook 触发（fire-and-forget，不阻塞流） ===
      this.fireChunkHooks(chunk, sessionId, {
        getTurnStartTime: () => turnStartTime,
        getTurnToolCallCount: () => turnToolCallCount
      });

      // Turn 状态更新
      if (chunk.type === 'turn:start') {
        turnStartTime = Date.now();
        turnToolCallCount = 0;
      } else if (chunk.type === 'tool:done') {
        turnToolCallCount++;
      }

      onChunk?.(chunk);

      // 使用 Promise.race 让 abort 信号能在 gen.next() 阻塞期间生效
      if (signal) {
        const abortPromise = new Promise<{ done: true; value: ExecutionResult }>((resolve) => {
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolve({ done: true, value: { output: '', error: 'Aborted by user' } });
          };
          if (signal.aborted) {
            resolve({ done: true, value: { output: '', error: 'Aborted by user' } });
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
            // 当 gen.next() 正常完成时也需要清理监听器
            gen.next().then(
              (result) => {
                signal.removeEventListener('abort', onAbort);
                resolve(result as { done: true; value: ExecutionResult });
              },
              (err) => {
                signal.removeEventListener('abort', onAbort);
                throw err;
              }
            );
          }
        });
        r = await abortPromise;
        if (signal.aborted && !r.done) {
          log.info(`[AgentExecutor] Aborted during gen.next(): sessionId=${sessionId}`);
          await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
          checkpoint.updateStatus(sessionId, 'idle').catch(() => {});
          return { output: '', error: 'Aborted by user' };
        }
      } else {
        r = await gen.next();
      }
    }

    // 执行完成 - 但如果在等待审批，不覆盖 approval-pending 状态
    if (!this.pendingApprovalSessions.has(sessionId)) {
      checkpoint.updateStatus(sessionId, 'completed').catch(() => {});
    } else {
      log.info(`[AgentExecutor] Execute loop done but approval-pending, keeping checkpoint for ${sessionId}`);
    }

    return r.value;
  }

  /**
   * 根据 StreamChunk 类型更新检查点状态
   *
   * fire-and-forget：不阻塞流式输出。
   * 同步更新 checkpoint.json 和 Thread 的 runStatus。
   *
   * 关键设计：approval-pending 是"粘性"状态。
   * hitl:required 设置 approval-pending 后，后续的 tool:done / run:done 不能覆盖它，
   * 因为异步审批模式下 Agent run 正常结束，但 checkpoint 必须保持 approval-pending
   * 等待用户审批后由 ThreadWaker 唤醒恢复。
   */
  private updateCheckpoint(checkpoint: CheckpointManager, sessionId: string, chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'tool:start':
        if (!this.pendingApprovalSessions.has(sessionId)) {
          checkpoint.updateStatus(sessionId, 'tool-pending').catch(() => {});
          this.syncThreadRunStatus(sessionId, 'tool-pending');
        }
        break;
      case 'tool:done':
        // 检测工具挂起（suspended 标志来自 ToolExecutionPipeline → PiMonoStreamAdapter）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((chunk.data as any)?.suspended === true) {
          this.pendingApprovalSessions.set(sessionId, { addedAt: Date.now() });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const suspendReason = (chunk.data as any)?.suspendReason;
          const pendingOp = this.parseSuspendReason(suspendReason, sessionId);
          checkpoint
            .save({
              threadId: sessionId,
              updatedAt: new Date().toISOString(),
              runStatus: 'approval-pending',
              pendingOperation: pendingOp
            })
            .catch(() => {});
          this.syncThreadRunStatus(sessionId, 'approval-pending');
          log.info(`[AgentExecutor] Tool suspended (approval-pending): ${sessionId}, tool=${pendingOp?.toolName}`);
        } else if (!this.pendingApprovalSessions.has(sessionId)) {
          checkpoint.updateStatus(sessionId, 'running').catch(() => {});
          this.syncThreadRunStatus(sessionId, 'running');
        }
        break;
      case 'hitl:required':
        // 通过 Extension 的 api.services.events.emit 发出的 hitl:required
        // 不经过 consumeAndForward，所以这个 case 是备用路径
        this.pendingApprovalSessions.set(sessionId, { addedAt: Date.now() });
        checkpoint
          .save({
            threadId: sessionId,
            updatedAt: new Date().toISOString(),
            runStatus: 'approval-pending',
            pendingOperation: {
              type: 'approval',
              approvalId: (chunk.data as Record<string, unknown>)?.approvalId as string,
              toolName: ((chunk.data as Record<string, unknown>)?.toolName as string) || chunk.content,
              toolCallId: ((chunk.data as Record<string, unknown>)?.toolCallId as string) || '',
              agentSessionId: sessionId,
              arguments: ((chunk.data as Record<string, unknown>)?.arguments as string) || '{}'
            }
          })
          .catch(() => {});
        this.syncThreadRunStatus(sessionId, 'approval-pending');
        break;
      case 'run:error':
        this.pendingApprovalSessions.delete(sessionId);
        checkpoint.updateStatus(sessionId, 'error').catch(() => {});
        this.syncThreadRunStatus(sessionId, 'error');
        break;
      case 'run:done':
        if (this.pendingApprovalSessions.has(sessionId)) {
          // 审批等待中：不删除 pending 状态，不更新 checkpoint
          // checkpoint 保持 approval-pending，等待 ThreadWaker 恢复
          log.info(`[AgentExecutor] Run done but approval-pending, keeping checkpoint for ${sessionId}`);
        } else {
          // 正常完成，设置为 completed（不是 idle）
          // 这样系统重启后不会尝试恢复已完成的对话
          checkpoint.updateStatus(sessionId, 'completed').catch(() => {});
          this.syncThreadRunStatus(sessionId, 'completed');
        }
        break;
    }
  }

  /**
   * 从 suspendReason 中解析出 pendingOperation
   *
   * suspendReason 格式（来自 ToolExecutionPipeline）: "approval-pending:{approvalId}:{toolName}"
   * 例如: "approval-pending:282850582706069504:0:write"
   */
  private parseSuspendReason(
    suspendReason: string,
    sessionId: string
  ):
    | { type: 'approval'; approvalId: string; toolName: string; toolCallId: string; agentSessionId: string }
    | undefined {
    if (!suspendReason) return undefined;

    // 去除可能的前缀（如果有的话）
    const reason = suspendReason.replace(/^suspended:\s*/i, '').trim();

    // 匹配格式: approval-pending:{approvalId}:{toolName}
    const match = reason.match(/^approval-pending:([^:]+:[^:]+):(.+)$/);
    if (!match) {
      log.warn(`[AgentExecutor] Failed to parse suspendReason: ${suspendReason}`);
      return undefined;
    }

    const approvalId = match[1]; // "sessionId:index"
    const toolName = match[2]; // "write"

    return {
      type: 'approval',
      approvalId,
      toolName,
      toolCallId: '',
      agentSessionId: sessionId
    };
  }

  /**
   * 同步 Thread 的 runStatus（fire-and-forget）
   *
   * 仅在 sessionId 对应已有 Thread 时更新（子 Agent sessionId 含 ':' 不会匹配 Thread）。
   */
  private syncThreadRunStatus(sessionId: string, runStatus: import('./threads/types').ThreadRunStatus): void {
    if (sessionId.includes(':')) return;
    import('./threads/ThreadStore')
      .then(({ ThreadStore }) => ThreadStore.getInstance())
      .then((store) => store.update(sessionId, { runStatus }))
      .catch(() => {});
  }

  /**
   * 根据 StreamChunk 类型触发对应的 Extension Hook
   *
   * 全部 fire-and-forget（不阻塞流式输出）。
   *
   * before_compaction：
   *   - 在此仅作为通知（PiMono 的 SDK 内置压缩无法拦截）
   *   - OpenAI Runtime 在 compressSessionWithChunks 中单独处理 modifying 逻辑
   *   - 为避免重复触发，OpenAI 会在 chunk.data 中标记 hookHandled: true
   */
  private fireChunkHooks(
    chunk: StreamChunk,
    sessionId: string,
    turnState: {
      getTurnStartTime: () => number;
      getTurnToolCallCount: () => number;
    }
  ): void {
    // 只关心这 4 种事件类型
    if (
      chunk.type !== 'turn:start' &&
      chunk.type !== 'turn:done' &&
      chunk.type !== 'compression:start' &&
      chunk.type !== 'compression:done'
    ) {
      return;
    }

    const fire = async (): Promise<void> => {
      const { ExtensionManager } = await import('../common/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      const data = chunk.data as Record<string, unknown> | undefined;

      switch (chunk.type) {
        case 'turn:start':
          await runner.runVoidHook('turn_start', {
            sessionId,
            turnIndex: (data?.turnIndex as number) || 1
          });
          break;

        case 'turn:done':
          await runner.runVoidHook('turn_end', {
            sessionId,
            turnIndex: (data?.turnIndex as number) || 1,
            durationMs: Date.now() - turnState.getTurnStartTime(),
            toolCallCount: turnState.getTurnToolCallCount()
          });
          break;

        case 'compression:start': {
          // 如果 OpenAI Runtime 已在压缩前调用过 modifying Hook，跳过
          if (data?.hookHandled) break;
          // 通知型：扩展可在此做 Memory Flush 等操作
          // 注意：对 PiMono 来说 skipDefault 无效（SDK 自行管理压缩）
          await runner.run('before_compaction', {
            sessionId,
            messageCount: 0, // PiMono 不提供此信息
            totalTokens: (data?.totalTokens as number) || 0,
            threshold: (data?.threshold as number) || 0
          });
          break;
        }

        case 'compression:done': {
          await runner.runVoidHook('after_compaction', {
            sessionId,
            originalTokens: (data?.originalTokens as number) || 0,
            compressedTokens: (data?.summaryTokens as number) || 0,
            compressionRatio: (data?.compressionRatio as number) || 0,
            duration: (data?.duration as number) || 0
          });
          break;
        }
      }
    };

    // Fire-and-forget：Hook 执行不阻塞流式输出
    fire().catch((err) => {
      log.warn(`[AgentExecutor] Chunk hook failed for ${chunk.type}:`, err);
    });
  }

  /**
   * 核心执行流程：创建 → 推理 → 销毁
   *
   * HITL 审批：
   *   不再在 Executor 层编排 HITL 循环。
   *   所有审批逻辑由 tool-approval Extension 在 before_tool_call Hook 中处理：
   *   - ExecPolicy 自动决策
   *   - needUserConfirm 工具的用户审批等待
   *   - 审批结果自学习（approve-always → 动态白名单）
   *
   *   这使得 HITL 成为 SDK 无关的能力，OpenAI / PiMono 等所有 Runtime 均可使用。
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk, signal } = request;
    let runtime: AgentRuntime | null = null;

    // 定期清理过期的审批等待
    this.cleanupExpiredApprovals();

    log.info(`[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`);
    const startTime = Date.now();

    let eventWriter: AgentEventWriter | null = null;

    try {
      if (request.runtime) {
        // === 预构建 Runtime 路径（Orchestrator / Swarm） ===
        const { Env } = await import('@main/common/env');
        const workspace = await Env.getAgentWorkspaceDir(sessionId);
        eventWriter = new AgentEventWriter(workspace);
        eventWriter.register(sessionId);

        runtime = request.runtime;
        eventWriter.setEmitter(this.createEmitter(sessionId, runtime));

        const gen = runtime.stream(message, { signal });
        const result = await this.consumeAndForward(gen, eventWriter, sessionId, onChunk, signal);

        const duration = Date.now() - startTime;
        this.logCompletion(sessionId, result, duration);
        return result;
      }

      // === Builder 路径（标准 Agent / Chat） ===
      if (!builder) {
        throw new Error('ExecuteRequest requires either builder or runtime');
      }

      // 0. 注入运行时环境
      const workspace = await injectEnv(sessionId, builder);
      eventWriter = new AgentEventWriter(workspace);
      eventWriter.register(sessionId);

      // 重置审批计数器（会话开始）
      const { resetApprovalCounter } = await import('./runtime/shared/ToolExecutionPipeline');
      resetApprovalCounter(sessionId);

      // === Extension Hooks: message_received + session_start + before_agent_start ===
      await this.runExtensionHooks(sessionId, message, builder);

      // 1. 创建 Runtime + 注册统一分发器
      runtime = await builder.sessionId(sessionId).build();
      eventWriter.setEmitter(this.createEmitter(sessionId, runtime));

      // 2. 流式执行（HITL 在 before_tool_call Hook 中自动处理），传入 signal
      const gen = runtime.stream(message, { signal });
      const result = await this.consumeAndForward(gen, eventWriter, sessionId, onChunk, signal);

      const duration = Date.now() - startTime;

      // === Extension Hooks: agent_end + session_end ===
      await this.runExtensionEndHooks(sessionId, result, duration);

      this.logCompletion(sessionId, result, duration);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms`, error);
      throw error;
    } finally {
      eventWriter?.unregister(sessionId);
      SkillManager.clearSession(sessionId);
      await this.destroyRuntime(runtime);
      runtime = null;
    }
  }

  // ========== 辅助方法 ==========

  /** 创建 StreamEmitter */
  private createEmitter(sessionId: string, runtime: AgentRuntime): IStreamEmitter {
    const source: StreamSource = {
      type: runtime.type,
      id: runtime.id,
      name: runtime.name
    };
    return createStreamEmitter(sessionId, source);
  }

  /** 安全销毁 Runtime */
  private async destroyRuntime(runtime: AgentRuntime | null): Promise<void> {
    if (!runtime) return;
    try {
      await runtime.destroy();
    } catch (e: unknown) {
      log.warn('[AgentExecutor] Runtime destroy warning:', e);
    }
  }

  /** 记录完成日志 */
  private logCompletion(sessionId: string, result: ExecutionResult, duration?: number): void {
    const durationStr = duration ? `, duration=${duration}ms` : '';
    if (result.error) {
      log.error(`[AgentExecutor] Failed: sessionId=${sessionId}${durationStr}, error=${result.error}`);
    } else {
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}${durationStr}, output=${result.output.slice(0, 100)}...`
      );
    }
  }

  // ========== Extension Hook ==========

  /**
   * 执行 Extension 前置 Hook
   * message_received → session_start → before_agent_start
   */
  private async runExtensionHooks(sessionId: string, message: string, builder: AgentBuilder): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('message_received', { sessionId, message });
      await runner.runVoidHook('session_start', { sessionId });

      const result = await runner.runModifyingHook('before_agent_start', {
        sessionId,
        prompt: message
      });
      if (result) {
        if (result.prependContext) {
          builder.appendInstructions(result.prependContext);
        }
        if (result.replaceSystemPrompt) {
          builder.instructions(result.replaceSystemPrompt);
        }
      }
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (start) failed:', err);
    }
  }

  /**
   * 执行 Extension 后置 Hook
   * agent_end → session_end
   */
  private async runExtensionEndHooks(sessionId: string, result: ExecutionResult, durationMs: number): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('agent_end', {
        sessionId,
        success: !result.error,
        output: result.output,
        durationMs
      });
      await runner.runVoidHook('session_end', { sessionId });

      // 清理审批计数器（会话结束）
      const { resetApprovalCounter } = await import('./runtime/shared/ToolExecutionPipeline');
      resetApprovalCounter(sessionId);
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (end) failed:', err);
    }
  }
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor();

// Re-export builders for consumers
export { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder';
export { OpenAIBuilder } from './runtime/openai/OpenAIBuilder';
