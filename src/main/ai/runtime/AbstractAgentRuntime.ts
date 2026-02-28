/**
 * AbstractAgentRuntime — 抽象基类
 *
 * 提取 OpenAI、PiMono、Team、Swarm 的公共实现：
 *   - id 生成（crypto.randomUUID 或 timestamp+random）
 *   - run() 默认实现（消费 stream() 收集结果）
 *   - runStream(onChunk) 默认实现
 *   - createRuntimeLogger() 静态工厂
 *   - stripThinkTags() 静态工具
 *
 * 子类只需实现：
 *   - stream() — 核心流式方法
 *   - initialize() / destroy() — 生命周期
 *   - getSession() / clearSession() — 会话管理
 *   - 以及必要的 HITL 方法（或使用默认的 throw 实现）
 */

import type { AgentRuntime } from './AgentRuntime';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from './types';
import { saveContextSnapshot } from './ContextSnapshot';
import { defaultRecoveryChain, type RecoveryContext } from './ErrorRecoveryChain';

// ==================== Logger 工具 ====================

/** Runtime 内部日志接口 */
export interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * 创建 Runtime 日志实例
 *
 * 优先使用项目 createLogger，fallback 到 console（测试环境）。
 */
export function createRuntimeLogger(moduleName: string): RuntimeLogger {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger');
    return createLogger(moduleName) as RuntimeLogger;
  } catch {
    const prefix = `[${moduleName}]`;
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    };
  }
}

// ==================== 文本工具 ====================

/**
 * 去除文本中的 `<think>...</think>` 标签及其内容
 *
 * 部分 Provider（如 MiniMax）在 OpenAI 兼容模式下
 * 会将思考内容以 `<think>` 标签包裹在文本中返回。
 */
export function stripThinkTags(text: string): string {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// ==================== ID 生成 ====================

/**
 * 生成 Runtime 唯一 ID
 * @param prefix 前缀标识（如 'agent', 'pi-agent', 'orchestrator', 'swarm'）
 */
export function generateRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== 抽象基类 ====================

/**
 * Agent Runtime 抽象基类
 *
 * 提供 run()、runStream() 等的默认实现。
 * 子类继承后只需聚焦于 stream() 的 SDK 特定逻辑。
 */
export abstract class AbstractAgentRuntime implements AgentRuntime {
  abstract readonly type: 'agent' | 'orchestrator' | 'swarm' | 'quality-loop';
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly options: AgentRuntimeOptions;
  abstract readonly interrupted: boolean;
  abstract readonly supportsHITL: boolean;

  // ========== 生命周期（子类必须实现） ==========

  abstract initialize(): Promise<void>;
  abstract destroy(): Promise<void>;

  // ========== 核心流式方法 ==========

  /**
   * 子类实现此方法 — 核心流式逻辑
   *
   * 不直接暴露给调用方，由 stream() 模板方法包装。
   * 子类只需关注 SDK 特定的流式执行逻辑。
   */
  protected abstract doStream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;

  /**
   * 流式执行 — 模板方法（最终暴露给调用方）
   *
   * 包装 doStream()，在执行完成后自动写入上下文快照。
   * 子类不需要覆盖此方法，实现 doStream() 即可。
   *
   * 自动行为：
   *   - 透传 doStream() 的所有 StreamChunk
   *   - 执行完成后自动调用 saveContextSnapshot()
   *   - 快照写入失败不阻断主流程
   *   - 错误时尝试渐进式恢复（重试）
   */
  async *stream(input: string, config?: ExecutionConfig): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const maxAttempts = 3;
    let attempt = 0;

    while (true) {
      try {
        const gen = this.doStream(input, config);
        let r = await gen.next();
        while (!r.done) {
          yield r.value;
          r = await gen.next();
        }

        const result = r.value;

        // 自动写入上下文快照（异步，不阻塞返回）
        saveContextSnapshot(this.options, this.type, input, result).catch(() => {});

        return result;
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;

        // 渐进式错误恢复 — 注入 runtime 引用，供 ContextCompression / ThinkingLevel 策略使用
        const recovery = await defaultRecoveryChain.recover(error, {
          attempt,
          maxAttempts,
          sessionId: config?.sessionId as string | undefined,
          runtime: this.buildRecoveryRuntime()
        });

        if (recovery.action === 'retry') {
          attempt++;
          // 延迟等待（如有）
          if (recovery.delay && recovery.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, recovery.delay));
          }
          // 发出恢复事件
          yield {
            type: 'run:error' as const,
            content: `Recovery: ${recovery.reason}`,
            data: { recoveryAttempt: attempt }
          };
          continue; // 重试 doStream
        }

        // 不可恢复，抛出原错误
        throw error;
      }
    }
  }

  // ========== Recovery 辅助 ==========

  /**
   * 构建 RecoveryContext.runtime 对象
   *
   * 子类若有 sessionCompressor / thinkingLevel 等字段，
   * 会通过此方法自动注入到恢复策略中。
   * 使用 `any` 安全访问子类特有字段，基类本身不强制依赖。
   */
  protected buildRecoveryRuntime(): RecoveryContext['runtime'] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;

    const compressor = self.sessionCompressor;
    const thinkingLevel: string | undefined = self.options?.thinkingLevel;

    return {
      compressor:
        compressor && typeof compressor.compress === 'function' ? { compress: () => compressor.compress() } : undefined,
      thinkingLevel,
      setThinkingLevel: (level: string) => {
        if (self.options) {
          self.options.thinkingLevel = level;
        }
      }
    };
  }

  // ========== 默认实现：run ==========

  /**
   * 同步执行 — 消费 stream() 收集结果
   *
   * 通过 stream() 模板方法执行，自动继承上下文快照功能。
   * 子类一般不需要覆盖此方法。
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const gen = this.stream(input, config);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }

  // ========== 默认实现：runStream ==========

  /**
   * 流式执行（回调模式 — stream() 的包装）
   *
   * 这是一个便捷方法，将 AsyncGenerator 转为回调模式。
   * 子类一般不需要覆盖。
   */
  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const gen = this.stream(input, config);
    let r = await gen.next();
    while (!r.done) {
      onChunk(r.value);
      r = await gen.next();
    }
    return r.value;
  }

  // ========== 默认实现：HITL（不支持时 throw） ==========

  approveToolCall(_index: number, _options?: { alwaysApprove?: boolean }): void {
    throw new Error(`${this.constructor.name} does not support HITL tool approval`);
  }

  rejectToolCall(_index: number, _options?: { alwaysReject?: boolean }): void {
    throw new Error(`${this.constructor.name} does not support HITL tool approval`);
  }

  // eslint-disable-next-line require-yield
  async *resumeStream(_config?: ExecutionConfig): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    throw new Error(`${this.constructor.name} does not support HITL resume`);
  }

  // ========== 会话管理（子类必须实现） ==========

  abstract getSession(): Promise<SessionInfo>;
  abstract clearSession(): Promise<void>;
}
