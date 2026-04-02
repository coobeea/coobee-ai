/**
 * Worker 协调器
 *
 * 管理 Worker（AgentRuntime 实例）池，分配和执行子任务。
 *
 * 基于 AgentRuntime 实现 — SDK 无关。
 * 每个 Worker 通过 AgentExecutor 的 PiMonoBuilder 创建，
 * 具备完整的工具访问、Skill 注入等能力。
 *
 * 与旧实现的区别：
 *   - 不依赖 @openai/agents SDK
 *   - Worker 通过 PiMonoBuilder 创建 AgentRuntime
 *   - 支持从 AgentStore 加载已有 Agent 定义作为 Worker
 *   - 支持 AbortSignal 和执行超时
 *   - 使用项目统一日志
 */

import { createLogger } from '@main/common/logger';
import type { AgentRuntime } from '../runtime/AgentRuntime';
import type { StreamChunk, ExecutionResult } from '../runtime/types';
import type { SubTask, WorkerInfo } from './types';
import { injectEnv } from '../AgentEnvInjector';

const log = createLogger('orchestration:worker');

/**
 * Worker 协调器接口
 */
export interface IWorkerCoordinator {
  /**
   * 获取或创建 Worker
   * @param workerType Worker 类型或 Agent ID
   */
  getOrCreateWorker(workerType: string): Promise<WorkerInfo>;

  /**
   * 执行子任务
   * @param subTask 子任务
   * @param worker Worker 信息
   */
  executeSubTask(subTask: SubTask, worker: WorkerInfo): Promise<WorkerExecutionResult>;

  /**
   * 获取 Worker 状态
   * @param workerId Worker ID
   */
  getWorkerStatus(workerId: string): WorkerInfo | null;

  /**
   * 清理所有 Workers
   */
  clear(): Promise<void>;
}

/**
 * Worker 执行结果
 */
export interface WorkerExecutionResult {
  /** 输出文本 */
  output: string;
  /** 执行耗时 */
  duration: number;
  /** 流式事件（如果收集了的话） */
  chunks?: StreamChunk[];
  /** 原始 ExecutionResult */
  raw?: ExecutionResult;
}

/**
 * Worker 协调器配置
 */
export interface WorkerCoordinatorConfig {
  /** 父 sessionId（= threadId），用于子 sessionId 命名 */
  parentSessionId?: string;
  /** Worker 默认模型 */
  model?: string;
  /** 默认工作区根目录 */
  workspaceRoot?: string;
  /** 🆕 项目空间路径（所有 Worker 共享的代码开发目录） */
  projectDir?: string;
  /** 是否为 Worker 注入工具 */
  injectTools?: boolean;
  /** 执行超时（ms，默认 5 分钟） */
  executionTimeout?: number;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 每种类型最多 Worker 数量（默认 3） */
  maxWorkersPerType?: number;
  /** 总共最多 Worker 数量（默认 10） */
  maxTotalWorkers?: number;
}

/**
 * Worker 协调器实现
 */
export class WorkerCoordinator implements IWorkerCoordinator {
  /** Worker 池：workerId -> { WorkerInfo, runtime } */
  private workers = new Map<string, { info: WorkerInfo; runtime: AgentRuntime | null }>();

  /** Worker 计数器 */
  private workerCounter = 0;

  constructor(private readonly config?: WorkerCoordinatorConfig) {}

  /**
   * 获取或创建 Worker
   *
   * 查找空闲的 Worker，如果没有则创建新的。
   * Worker 通过 PiMonoBuilder 创建 AgentRuntime。
   */
  async getOrCreateWorker(workerType: string): Promise<WorkerInfo> {
    // 查找空闲的同类型 Worker
    for (const [, entry] of this.workers) {
      if (entry.info.type === workerType && entry.info.status === 'idle') {
        return entry.info;
      }
    }

    // 检查 Worker 数量限制
    const maxTotalWorkers = this.config?.maxTotalWorkers ?? 10;
    const maxWorkersPerType = this.config?.maxWorkersPerType ?? 3;

    // 检查总数限制
    if (this.workers.size >= maxTotalWorkers) {
      log.warn(`[WorkerCoordinator] Max total workers (${maxTotalWorkers}) reached, waiting for idle worker...`);
      // 等待任意空闲 Worker
      const idleWorker = await this.waitForIdleWorker(30000); // 最多等待 30 秒
      if (idleWorker) return idleWorker;
      throw new Error(`Max total workers (${maxTotalWorkers}) reached and no worker became idle`);
    }

    // 检查同类型数量限制
    const sameTypeCount = Array.from(this.workers.values()).filter((e) => e.info.type === workerType).length;
    if (sameTypeCount >= maxWorkersPerType) {
      log.warn(`[WorkerCoordinator] Max workers per type (${maxWorkersPerType}) reached for ${workerType}, waiting...`);
      // 等待同类型空闲 Worker
      const idleWorker = await this.waitForIdleWorker(30000, workerType);
      if (idleWorker) return idleWorker;
      throw new Error(
        `Max workers per type (${maxWorkersPerType}) reached for ${workerType} and no worker became idle`
      );
    }

    // 创建新的 Worker
    const workerId = `worker-${workerType}-${++this.workerCounter}`;

    const workerInfo: WorkerInfo = {
      id: workerId,
      name: `Worker (${workerType})`,
      type: workerType,
      status: 'idle'
    };

    this.workers.set(workerId, { info: workerInfo, runtime: null });

    log.info(`[WorkerCoordinator] Created worker: ${workerId} (type=${workerType}), total=${this.workers.size}`);
    return workerInfo;
  }

  /**
   * 等待空闲 Worker（带超时）
   */
  private async waitForIdleWorker(timeoutMs: number, workerType?: string): Promise<WorkerInfo | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      for (const [, entry] of this.workers) {
        if (entry.info.status === 'idle') {
          if (!workerType || entry.info.type === workerType) {
            return entry.info;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 每秒检查一次
    }
    return null;
  }

  /**
   * 执行子任务
   *
   * 为子任务创建临时 AgentRuntime（用完即销毁），
   * 注入子任务上下文，执行并返回结果。
   *
   * 每次执行创建新的 Runtime 实例（无状态），
   * 确保不同子任务之间不共享上下文。
   */
  async executeSubTask(subTask: SubTask, worker: WorkerInfo): Promise<WorkerExecutionResult> {
    const startTime = Date.now();
    const entry = this.workers.get(worker.id);
    if (!entry) {
      throw new Error(`Worker not found: ${worker.id}`);
    }

    log.info(`[WorkerCoordinator] Executing subtask: ${subTask.name} on ${worker.id}`);

    // 更新 Worker 状态
    entry.info.status = 'busy';
    entry.info.currentTaskId = subTask.id;

    let runtime: AgentRuntime | null = null;

    try {
      // 创建临时 Runtime
      runtime = await this.createWorkerRuntime(worker.type || 'general', subTask);

      // 构建子任务提示词
      const prompt = this.buildSubTaskPrompt(subTask);

      // 🆕 添加超时控制
      const timeoutMs = this.config?.executionTimeout ?? 5 * 60 * 1000; // 默认 5 分钟
      const result = await this.executeWithTimeout(runtime, prompt, timeoutMs, subTask.id);

      const duration = Date.now() - startTime;

      // 恢复 Worker 状态
      entry.info.status = 'idle';
      entry.info.currentTaskId = undefined;

      log.info(`[WorkerCoordinator] SubTask ${subTask.id} completed in ${duration}ms`);

      return {
        output: result.output,
        duration,
        raw: result
      };
    } catch (error) {
      // Worker 发生错误时，不要将其标记为永久 error 导致泄漏，而是重置为 idle 以便回收或重试
      entry.info.status = 'idle';
      entry.info.currentTaskId = undefined;
      throw error;
    } finally {
      // 销毁临时 Runtime
      if (runtime) {
        try {
          await runtime.destroy();
        } catch {
          // 静默
        }
      }
    }
  }

  /**
   * 带超时的执行
   */
  private async executeWithTimeout(
    runtime: AgentRuntime,
    prompt: string,
    timeoutMs: number,
    subTaskId: string
  ): Promise<ExecutionResult> {
    return Promise.race([
      runtime.run(prompt),
      new Promise<ExecutionResult>((_, reject) =>
        setTimeout(() => reject(new Error(`SubTask ${subTaskId} execution timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * 获取 Worker 状态
   */
  getWorkerStatus(workerId: string): WorkerInfo | null {
    return this.workers.get(workerId)?.info || null;
  }

  /**
   * 🆕 设置项目空间路径
   *
   * 允许 Orchestrator 动态设置所有 Worker 共享的项目空间。
   */
  setProjectDir(projectDir: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mutableThis = this as any;
    if (!mutableThis.config) {
      mutableThis.config = {};
    }
    mutableThis.config.projectDir = projectDir;
    log.info(`[WorkerCoordinator] ProjectDir set to: ${projectDir}`);
  }

  /**
   * 清理所有 Workers
   */
  async clear(): Promise<void> {
    for (const [, entry] of this.workers) {
      if (entry.runtime) {
        try {
          await entry.runtime.destroy();
        } catch {
          // 静默
        }
      }
    }
    this.workers.clear();
    this.workerCounter = 0;
    log.info('[WorkerCoordinator] All workers cleared');
  }

  // ========== 内部方法 ==========

  /**
   * 创建 Worker 的 AgentRuntime
   *
   * 优先尝试从 AgentStore 加载已有定义。
   * 如果 workerType 不是已有 Agent ID，则创建默认 Worker。
   */
  private async createWorkerRuntime(workerType: string, subTask: SubTask): Promise<AgentRuntime> {
    const { agentExecutor } = await import('../AgentExecutor');
    const { WorkspaceManager } = await import('../storage/WorkspaceManager');
    const path = await import('node:path');

    const sessionId = this.config?.parentSessionId
      ? `${this.config.parentSessionId}:worker:${subTask.id}`
      : `worker-${subTask.id}-${Date.now()}`;

    // 🆕 创建嵌套 workspace
    let subAgentWorkspace: string | undefined;
    if (this.config?.parentSessionId) {
      const { Env } = await import('@main/common/env');
      const mainWorkspace = await Env.getAgentWorkspaceDir(this.config.parentSessionId);
      subAgentWorkspace = WorkspaceManager.getOrCreateSubAgentWorkspace({
        agentName: `worker-${subTask.id}`,
        sessionId,
        type: 'worker',
        threadWorkspace: mainWorkspace,
        enableSkills: true,
        enableExtensions: true
      });
    }

    // 尝试从 AgentStore 加载已有 Agent 定义
    const agentDef = await this.tryLoadAgentDefinition(workerType);

    if (agentDef) {
      // 使用已有 Agent 定义创建 Worker
      log.info(`[WorkerCoordinator] Using agent definition: ${agentDef.id} for worker`);

      const builder = agentExecutor
        .piMono()
        .name(agentDef.name || agentDef.id)
        .mode('agent')
        .sessionMode('file')
        .instructions(agentDef.instructions)
        .sessionId(sessionId);

      if (agentDef.model) {
        builder.model(agentDef.model);
      } else if (this.config?.model) {
        builder.model(this.config.model);
      }

      // 🆕 如果有嵌套 workspace，手动设置
      if (subAgentWorkspace) {
        builder
          .sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions'))
          .workspaceRoot(subAgentWorkspace)
          .contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
      }

      // 🆕 设置项目空间（所有 Worker 共享的代码开发目录）
      if (this.config?.projectDir) {
        builder.projectDir(this.config.projectDir);
        log.info(`[WorkerCoordinator] Set projectDir for worker: ${this.config.projectDir}`);
      }

      await injectEnv(sessionId, builder);
      return await builder.build();
    }

    // 默认 Worker：通用 Agent
    const preset = this.getWorkerPreset(workerType);

    const builder = agentExecutor
      .piMono()
      .name(preset.name)
      .mode('agent')
      .sessionMode('file')
      .instructions(preset.instructions)
      .sessionId(sessionId);

    if (this.config?.model) {
      builder.model(this.config.model);
    }

    // 🆕 如果有嵌套 workspace，手动设置
    if (subAgentWorkspace) {
      builder
        .sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions'))
        .workspaceRoot(subAgentWorkspace)
        .contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
    }

    // 🆕 设置项目空间（所有 Worker 共享的代码开发目录）
    if (this.config?.projectDir) {
      builder.projectDir(this.config.projectDir);
      log.info(`[WorkerCoordinator] Set projectDir for default worker: ${this.config.projectDir}`);
    }

    await injectEnv(sessionId, builder);
    return await builder.build();
  }

  /**
   * 尝试从 AgentStore 加载 Agent 定义
   */
  private async tryLoadAgentDefinition(
    workerType: string
  ): Promise<{ id: string; name: string; instructions: string; model?: string } | null> {
    try {
      const { AgentStore } = await import('../agents/AgentStore');
      const store = await AgentStore.getInstance();
      const def = await store.get(workerType);
      if (def) {
        return {
          id: def.id,
          name: def.name,
          instructions: def.instructions,
          model: def.model
        };
      }
    } catch {
      // AgentStore 不可用，静默回退
    }
    return null;
  }

  /**
   * 获取 Worker 类型对应的预设配置
   */
  private getWorkerPreset(workerType: string): {
    name: string;
    instructions: string;
  } {
    switch (workerType.toLowerCase()) {
      case 'code':
        return {
          name: 'Code Worker',
          instructions:
            'You are a code generation and analysis assistant. ' +
            'Focus on writing clean, well-structured code. ' +
            'Use available tools to read, write, and modify files.'
        };
      case 'research':
        return {
          name: 'Research Worker',
          instructions:
            'You are a research and analysis assistant. ' +
            'Focus on gathering information, analyzing data, and providing insights.'
        };
      case 'review':
        return {
          name: 'Review Worker',
          instructions:
            'You are a code review and quality assurance assistant. ' +
            'Focus on identifying issues, suggesting improvements, and ensuring quality.'
        };
      case 'general':
      default:
        return {
          name: 'General Worker',
          instructions: 'You are a helpful assistant. ' + 'Complete the assigned task thoroughly using available tools.'
        };
    }
  }

  /**
   * 构建子任务提示词
   */
  private buildSubTaskPrompt(subTask: SubTask): string {
    const parts: string[] = [];

    parts.push(`**Your Task**: ${subTask.name}`);

    if (subTask.description) {
      parts.push(`**Details**: ${subTask.description}`);
    }

    if (subTask.context) {
      parts.push(`**Context**: ${JSON.stringify(subTask.context, null, 2)}`);
    }

    if (subTask.dependencies && subTask.dependencies.length > 0) {
      parts.push(`**Dependencies**: This task depends on: ${subTask.dependencies.join(', ')}`);
    }

    parts.push(`Please complete this task thoroughly and provide your result.`);

    return parts.join('\n\n');
  }
}
