/**
 * 会话文件管理器
 * 统一管理所有会话相关的文件目录和文件操作
 *
 * 目录结构：
 * ~/.coobee-ai/sessions/{sessionId}/
 * ├── orchestrator/    # 统筹者目录
 * ├── planner/         # 计划者目录
 * ├── workers/         # 工作者目录
 * ├── verification/    # 评审者目录
 * └── shared/          # 共享目录
 */

import { createLogger } from '@main/common/logger';
import { mkdir, writeFile, readFile, readdir, stat } from 'fs/promises';

const log = createLogger('SessionFileManager');
import { join } from 'path';
import { app } from 'electron';
import { existsSync } from 'fs';

/**
 * 会话文件管理器
 */
export class SessionFileManager {
  private readonly basePath: string;
  private initialized = false;

  constructor(private readonly sessionId: string) {
    // 🆕 将 : 替换为 __ 以兼容 Windows 文件系统
    const safeSessionId = sessionId.replace(/:/g, '__');
    // ~/.coobee-ai/sessions/{sessionId}/
    this.basePath = join(app.getPath('userData'), 'sessions', safeSessionId);
  }

  /**
   * 获取会话基础路径
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * 获取会话ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 初始化会话目录结构
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const dirs = [
      '', // 根目录
      'orchestrator',
      'orchestrator/checkpoints',
      'planner',
      'planner/plans',
      'planner/replans',
      'workers',
      'verification',
      'verification/checks',
      'verification/fixes',
      'shared'
    ];

    for (const dir of dirs) {
      await mkdir(join(this.basePath, dir), { recursive: true });
    }

    this.initialized = true;
    log.info(`Initialized session directory: ${this.basePath}`);
  }

  /**
   * 检查会话目录是否存在
   */
  exists(): boolean {
    return existsSync(this.basePath);
  }

  // ========== Planner 文件操作 ==========

  /**
   * 写入原始任务
   */
  async writeOriginalTask(task: unknown): Promise<void> {
    const path = join(this.basePath, 'planner', 'original_task.json');
    await writeFile(path, JSON.stringify(task, null, 2));
  }

  /**
   * 读取原始任务
   */
  async readOriginalTask(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'planner', 'original_task.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 写入执行计划（不推荐直接使用，请使用 PlanVersionManager）
   */
  async writeExecutionPlan(plan: unknown): Promise<void> {
    const path = join(this.basePath, 'planner', 'execution_plan.json');
    await writeFile(path, JSON.stringify(plan, null, 2));
  }

  /**
   * 读取执行计划
   */
  async readExecutionPlan(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'planner', 'execution_plan.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 写入计划文件（指定文件名）
   */
  async writePlanFile(fileName: string, plan: unknown): Promise<void> {
    const path = join(this.basePath, 'planner', 'plans', fileName);
    await writeFile(path, JSON.stringify(plan, null, 2));
  }

  /**
   * 读取计划文件
   */
  async readPlanFile(fileName: string): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'planner', 'plans', fileName);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 写入计划索引
   */
  async writePlanIndex(index: unknown): Promise<void> {
    const path = join(this.basePath, 'planner', 'plan_index.json');
    await writeFile(path, JSON.stringify(index, null, 2));
  }

  /**
   * 读取计划索引
   */
  async readPlanIndex(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'planner', 'plan_index.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 追加计划变更日志
   */
  async appendPlanChange(log: unknown): Promise<void> {
    const path = join(this.basePath, 'planner', 'plan_changes.jsonl');
    await writeFile(path, JSON.stringify(log) + '\n', { flag: 'a' });
  }

  /**
   * 读取计划变更日志
   */
  async readPlanChanges(): Promise<unknown[]> {
    try {
      const path = join(this.basePath, 'planner', 'plan_changes.jsonl');
      const content = await readFile(path, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // ========== Orchestrator 文件操作 ==========

  /**
   * 写入运行时快照
   */
  async writeRuntimeSnapshot(snapshot: unknown): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'runtime.json');
    await writeFile(path, JSON.stringify(snapshot, null, 2));
  }

  /**
   * 读取运行时快照
   */
  async readRuntimeSnapshot(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'orchestrator', 'runtime.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 写入执行进度
   */
  async writeProgress(progress: unknown): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'progress.json');
    await writeFile(path, JSON.stringify(progress, null, 2));
  }

  /**
   * 读取执行进度
   */
  async readProgress(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'orchestrator', 'progress.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 追加决策日志
   */
  async appendDecision(decision: unknown): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'decisions.jsonl');
    await writeFile(path, JSON.stringify(decision) + '\n', { flag: 'a' });
  }

  /**
   * 读取决策日志
   */
  async readDecisions(): Promise<unknown[]> {
    try {
      const path = join(this.basePath, 'orchestrator', 'decisions.jsonl');
      const content = await readFile(path, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // ========== Worker 文件操作 ==========

  /**
   * 写入 Worker 状态
   */
  async writeWorkerStatus(workerId: string, status: unknown): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'status.json');
    await mkdir(join(this.basePath, 'workers', workerId), { recursive: true });
    await writeFile(path, JSON.stringify(status, null, 2));
  }

  /**
   * 读取 Worker 状态
   */
  async readWorkerStatus(workerId: string): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'workers', workerId, 'status.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 追加 Worker 思考日志
   */
  async appendWorkerThinking(workerId: string, thinking: string): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'thinking.jsonl');
    await mkdir(join(this.basePath, 'workers', workerId), { recursive: true });
    const entry = { timestamp: Date.now(), content: thinking };
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' });
  }

  /**
   * 读取 Worker 思考日志
   */
  async readWorkerThinking(workerId: string): Promise<unknown[]> {
    try {
      const path = join(this.basePath, 'workers', workerId, 'thinking.jsonl');
      const content = await readFile(path, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * 追加 Worker 行动日志
   */
  async appendWorkerAction(workerId: string, action: unknown): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'actions.jsonl');
    await mkdir(join(this.basePath, 'workers', workerId), { recursive: true });
    const entry = {
      timestamp: Date.now(),
      ...(typeof action === 'object' && action !== null ? action : { data: action })
    };
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' });
  }

  /**
   * 写入 Worker 输出
   */
  async writeWorkerOutput(workerId: string, output: unknown): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'output.json');
    await mkdir(join(this.basePath, 'workers', workerId), { recursive: true });
    await writeFile(path, JSON.stringify(output, null, 2));
  }

  /**
   * 读取 Worker 输出
   */
  async readWorkerOutput(workerId: string): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'workers', workerId, 'output.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 列出所有 Workers
   */
  async listWorkers(): Promise<string[]> {
    try {
      const workersPath = join(this.basePath, 'workers');
      const entries = await readdir(workersPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  // ========== Verification 文件操作 ==========

  /**
   * 写入验证检查记录
   */
  async writeVerificationCheck(subTaskId: string, ruleId: string, result: unknown): Promise<void> {
    const path = join(this.basePath, 'verification', 'checks', `${subTaskId}-${ruleId}.json`);
    await writeFile(path, JSON.stringify(result, null, 2));
  }

  /**
   * 读取验证检查记录
   */
  async readVerificationCheck(subTaskId: string, ruleId: string): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'verification', 'checks', `${subTaskId}-${ruleId}.json`);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 追加验证问题
   */
  async appendVerificationIssues(subTaskId: string, issues: unknown): Promise<void> {
    const path = join(this.basePath, 'verification', 'issues.jsonl');
    const entry = {
      timestamp: Date.now(),
      subTaskId,
      issues
    };
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' });
  }

  /**
   * 读取验证问题
   */
  async readVerificationIssues(): Promise<unknown[]> {
    try {
      const path = join(this.basePath, 'verification', 'issues.jsonl');
      const content = await readFile(path, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * 写入修复记录
   */
  async writeFixRecord(fixId: string, record: unknown): Promise<void> {
    const path = join(this.basePath, 'verification', 'fixes', `${fixId}.json`);
    await writeFile(path, JSON.stringify(record, null, 2));
  }

  /**
   * 读取修复记录
   */
  async readFixRecord(fixId: string): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'verification', 'fixes', `${fixId}.json`);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // ========== Shared 文件操作 ==========

  /**
   * 写入共享上下文
   */
  async writeSharedContext(context: unknown): Promise<void> {
    const path = join(this.basePath, 'shared', 'context.json');
    await writeFile(path, JSON.stringify(context, null, 2));
  }

  /**
   * 读取共享上下文
   */
  async readSharedContext(): Promise<unknown | null> {
    try {
      const path = join(this.basePath, 'shared', 'context.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 追加消息日志
   */
  async appendMessage(message: unknown): Promise<void> {
    const path = join(this.basePath, 'shared', 'messages.jsonl');
    const entry = {
      timestamp: Date.now(),
      ...(typeof message === 'object' && message !== null ? message : { data: message })
    };
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' });
  }

  /**
   * 读取消息日志
   */
  async readMessages(): Promise<unknown[]> {
    try {
      const path = join(this.basePath, 'shared', 'messages.jsonl');
      const content = await readFile(path, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // ========== 工具方法 ==========

  /**
   * 获取会话统计信息
   */
  async getSessionStats(): Promise<{
    sessionId: string;
    basePath: string;
    exists: boolean;
    size?: number;
    workerCount?: number;
    planVersions?: number;
  }> {
    const exists = this.exists();
    let size = 0;
    let workerCount = 0;
    let planVersions = 0;

    if (exists) {
      try {
        // 计算目录大小
        size = await this.calculateDirectorySize(this.basePath);

        // 统计 Workers
        workerCount = (await this.listWorkers()).length;

        // 统计计划版本
        const plansPath = join(this.basePath, 'planner', 'plans');
        if (existsSync(plansPath)) {
          const plans = await readdir(plansPath);
          planVersions = plans.filter((f) => f.endsWith('.json')).length;
        }
      } catch (error) {
        log.error('Failed to get stats:', error);
      }
    }

    return {
      sessionId: this.sessionId,
      basePath: this.basePath,
      exists,
      size,
      workerCount,
      planVersions
    };
  }

  /**
   * 计算目录大小
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(entryPath);
        } else {
          const stats = await stat(entryPath);
          totalSize += stats.size;
        }
      }
    } catch {
      // 忽略错误
    }

    return totalSize;
  }
}

/**
 * 会话文件管理器工厂
 * 维护会话管理器实例的缓存
 */
class SessionFileManagerFactory {
  private static instances = new Map<string, SessionFileManager>();

  /**
   * 获取或创建会话文件管理器实例
   */
  static getInstance(sessionId: string): SessionFileManager {
    if (!this.instances.has(sessionId)) {
      this.instances.set(sessionId, new SessionFileManager(sessionId));
    }
    return this.instances.get(sessionId)!;
  }

  /**
   * 清除会话管理器实例
   */
  static clearInstance(sessionId: string): void {
    this.instances.delete(sessionId);
  }

  /**
   * 清除所有实例
   */
  static clearAll(): void {
    this.instances.clear();
  }

  /**
   * 获取所有会话ID
   */
  static getAllSessionIds(): string[] {
    return Array.from(this.instances.keys());
  }
}

// 导出工厂方法
export function getSessionFileManager(sessionId: string): SessionFileManager {
  return SessionFileManagerFactory.getInstance(sessionId);
}

export function clearSessionFileManager(sessionId: string): void {
  SessionFileManagerFactory.clearInstance(sessionId);
}
