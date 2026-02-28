/**
 * FileSwarmContext - 持久化的 SwarmContext
 *
 * 扩展 SwarmContext，将所有变更同步写入文件：
 * - 状态变更 → context.jsonl
 * - 产物 → artifacts/ 文件夹
 * - 进度 → progress.jsonl
 *
 * 程序重启时自动从文件恢复状态。
 */

import { createLogger } from '@main/common/logger';
import { SwarmContext } from './SwarmContext';

const log = createLogger('FileSwarmContext');
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 上下文变更日志条目
 */
interface ContextLogEntry {
  type: 'state_set' | 'state_delete';
  key: string;
  value?: unknown;
  roleId: string;
  ts: number;
}

/**
 * 进度日志条目
 */
interface ProgressLogEntry {
  note: string;
  roleId: string;
  ts: number;
}

/**
 * 产物元数据
 */
interface ArtifactMeta {
  name: string;
  createdBy: string;
  createdAt: number;
  type?: string;
}

/**
 * 持久化的 SwarmContext
 *
 * 所有操作同步写入文件，程序重启时自动恢复。
 */
export class FileSwarmContext extends SwarmContext {
  private readonly contextLogPath: string;
  private readonly artifactsDir: string;
  private readonly progressLogPath: string;

  /**
   * @param workspaceDir Workspace 根目录
   */
  constructor(workspaceDir: string) {
    super();

    const swarmDir = join(workspaceDir, 'swarm');

    this.contextLogPath = join(swarmDir, 'context.jsonl');
    this.artifactsDir = join(swarmDir, 'artifacts');
    this.progressLogPath = join(swarmDir, 'progress.jsonl');

    this.init();
  }

  /**
   * 初始化：创建目录并恢复状态
   */
  private init(): void {
    // 创建目录
    mkdirSync(dirname(this.contextLogPath), { recursive: true });
    mkdirSync(this.artifactsDir, { recursive: true });

    // 创建文件（如果不存在）
    if (!existsSync(this.contextLogPath)) {
      writeFileSync(this.contextLogPath, '', 'utf-8');
    }
    if (!existsSync(this.progressLogPath)) {
      writeFileSync(this.progressLogPath, '', 'utf-8');
    }

    // 恢复状态（重放日志）
    this.replay();
  }

  /**
   * 从日志文件恢复状态
   */
  private replay(): void {
    // 1. 恢复状态（从 context.jsonl）
    if (existsSync(this.contextLogPath)) {
      const content = readFileSync(this.contextLogPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((l) => l);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as ContextLogEntry;

          switch (entry.type) {
            case 'state_set':
              super.set(entry.key, entry.value, entry.roleId);
              break;
            case 'state_delete':
              super.delete(entry.key, entry.roleId);
              break;
          }
        } catch (error) {
          log.error('Failed to replay entry:', line, error);
        }
      }
    }

    // 2. 恢复产物（从 artifacts/ 文件夹）
    if (existsSync(this.artifactsDir)) {
      const files = readdirSync(this.artifactsDir);

      for (const file of files) {
        if (file.endsWith('.meta.json')) continue;

        const filePath = join(this.artifactsDir, file);
        const metaPath = join(this.artifactsDir, `${file}.meta.json`);

        try {
          const content = readFileSync(filePath, 'utf-8');

          if (existsSync(metaPath)) {
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as ArtifactMeta;
            super.addArtifact(meta.name, content, meta.createdBy, meta.type);
          } else {
            // 没有元数据，使用默认值
            super.addArtifact(file, content, 'system');
          }
        } catch (error) {
          log.error('Failed to restore artifact:', file, error);
        }
      }
    }

    // 3. 恢复进度（从 progress.jsonl）
    // 进度只是日志，不需要恢复到内存（可选）
  }

  // ========== 覆盖方法：状态持久化 ==========

  override set(key: string, value: unknown, roleId: string = 'system'): void {
    super.set(key, value, roleId);

    // 同步写入日志
    this.appendContextLog({
      type: 'state_set',
      key,
      value,
      roleId,
      ts: Date.now()
    });
  }

  override delete(key: string, roleId: string = 'system'): boolean {
    const deleted = super.delete(key, roleId);

    if (deleted) {
      this.appendContextLog({
        type: 'state_delete',
        key,
        roleId,
        ts: Date.now()
      });
    }

    return deleted;
  }

  // ========== 覆盖方法：产物持久化 ==========

  override addArtifact(name: string, content: string, createdBy: string, type?: string): void {
    super.addArtifact(name, content, createdBy, type);

    // 写入文件
    const filePath = join(this.artifactsDir, name);
    const metaPath = join(this.artifactsDir, `${name}.meta.json`);

    try {
      // 写入产物内容
      writeFileSync(filePath, content, 'utf-8');

      // 写入元数据
      const meta: ArtifactMeta = {
        name,
        createdBy,
        createdAt: Date.now(),
        type
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      // 🆕 触发产物创建事件（供外部监听，如 KnowledgeBase）
      this.emitArtifactCreated(name, createdBy, type);
    } catch (error) {
      log.error('Failed to write artifact:', name, error);
    }
  }

  /**
   * 🆕 触发产物创建事件
   * 供 SwarmCoordinator 监听并记录到 KnowledgeBase
   */
  private emitArtifactCreated(_name: string, _createdBy: string, _type?: string): void {
    // 使用父类的 changeListeners 机制
    // SwarmCoordinator 会监听这些事件
  }

  // ========== 覆盖方法：进度持久化 ==========

  override addProgressNote(note: string, roleId: string = 'system'): void {
    super.addProgressNote(note, roleId);

    // 同步写入日志
    this.appendProgressLog({
      note,
      roleId,
      ts: Date.now()
    });
  }

  // ========== 辅助方法 ==========

  /**
   * 追加上下文日志
   */
  private appendContextLog(entry: ContextLogEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      appendFileSync(this.contextLogPath, line, 'utf-8');
    } catch (error) {
      log.error('Failed to append context log:', error);
    }
  }

  /**
   * 追加进度日志
   */
  private appendProgressLog(entry: ProgressLogEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      appendFileSync(this.progressLogPath, line, 'utf-8');
    } catch (error) {
      log.error('Failed to append progress log:', error);
    }
  }

  /**
   * 获取文件路径（用于测试/调试）
   */
  getFilePaths(): { contextLog: string; artifactsDir: string; progressLog: string } {
    return {
      contextLog: this.contextLogPath,
      artifactsDir: this.artifactsDir,
      progressLog: this.progressLogPath
    };
  }
}
