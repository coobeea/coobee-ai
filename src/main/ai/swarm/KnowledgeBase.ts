/**
 * KnowledgeBase - Swarm 共享知识库
 *
 * 存储所有 Agent 应该知道的信息：
 * - 讨论结果
 * - 重要决策
 * - 产物创建
 * - 里程碑
 * - 发现的问题
 *
 * 所有 Agent 启动时自动加载，确保上下文一致。
 */

import { createLogger } from '@main/common/logger';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';

const log = createLogger('KnowledgeBase');
import { join, dirname } from 'path';

/**
 * 知识条目类型
 */
export interface KnowledgeEntry {
  /** 条目类型 */
  type: 'discussion_summary' | 'decision' | 'artifact_created' | 'milestone' | 'issue_found' | 'custom';
  /** 时间戳 */
  ts: number;
  /** 其他字段（根据类型不同） */
  [key: string]: unknown;
}

/**
 * 讨论摘要条目
 */
export interface DiscussionSummaryEntry extends KnowledgeEntry {
  type: 'discussion_summary';
  discussionId: string;
  participants: string[];
  topic: string;
  summary: string;
  decision?: string;
}

/**
 * 决策条目
 */
export interface DecisionEntry extends KnowledgeEntry {
  type: 'decision';
  decision: string;
  madeBy: string;
  reason?: string;
  context?: unknown;
}

/**
 * 产物创建条目
 */
export interface ArtifactCreatedEntry extends KnowledgeEntry {
  type: 'artifact_created';
  name: string;
  createdBy: string;
  artifactType?: string;
  description?: string;
}

/**
 * 里程碑条目
 */
export interface MilestoneEntry extends KnowledgeEntry {
  type: 'milestone';
  milestone: string;
  achievedBy: string;
  details?: string;
}

/**
 * 问题发现条目
 */
export interface IssueFoundEntry extends KnowledgeEntry {
  type: 'issue_found';
  issue: string;
  foundBy: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  context?: string;
}

/**
 * 共享知识库
 *
 * 功能：
 * - 追加知识条目（同步写入文件）
 * - 获取最近知识
 * - 按类型筛选
 * - 搜索
 * - 构建上下文摘要（供 Agent instructions 使用）
 */
export class KnowledgeBase {
  private readonly filePath: string;
  private entries: KnowledgeEntry[] = [];

  /**
   * @param workspaceDir Workspace 根目录
   */
  constructor(workspaceDir: string) {
    const swarmDir = join(workspaceDir, 'swarm');
    this.filePath = join(swarmDir, 'knowledge-base.jsonl');

    this.init();
  }

  /**
   * 初始化：创建目录并加载历史数据
   */
  private init(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, '', 'utf-8');
      return;
    }

    // 加载历史数据
    this.reload();
  }

  /**
   * 重新加载所有条目（从文件）
   */
  reload(): void {
    if (!existsSync(this.filePath)) {
      this.entries = [];
      return;
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l);

    this.entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as KnowledgeEntry;
        } catch (error) {
          log.error('Failed to parse line:', line, error);
          return null;
        }
      })
      .filter((e): e is KnowledgeEntry => e !== null);
  }

  // ========== 写入操作 ==========

  /**
   * 追加知识条目（同步写入文件）
   *
   * @param entry 知识条目
   */
  append(entry: KnowledgeEntry): void {
    // 确保有时间戳
    if (!entry.ts) {
      entry.ts = Date.now();
    }

    this.entries.push(entry);

    // 同步写入文件（用户要求不考虑性能）
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.filePath, line, 'utf-8');
  }

  /**
   * 清空所有条目
   */
  clear(): void {
    this.entries = [];
    writeFileSync(this.filePath, '', 'utf-8');
  }

  // ========== 查询操作 ==========

  /**
   * 获取所有条目
   */
  getAll(): KnowledgeEntry[] {
    return [...this.entries];
  }

  /**
   * 获取最近 N 条知识
   *
   * @param count 数量（默认 20）
   */
  getRecent(count: number = 20): KnowledgeEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * 按类型筛选
   *
   * @param type 条目类型
   */
  getByType(type: string): KnowledgeEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * 搜索（按关键词）
   *
   * @param keyword 关键词
   */
  search(keyword: string): KnowledgeEntry[] {
    const lowerKeyword = keyword.toLowerCase();
    return this.entries.filter((e) => JSON.stringify(e).toLowerCase().includes(lowerKeyword));
  }

  /**
   * 获取条目数量
   */
  count(): number {
    return this.entries.length;
  }

  // ========== 上下文构建 ==========

  /**
   * 构建上下文摘要（供 Agent instructions 使用）
   *
   * @param count 最近条数（默认 10）
   * @returns 上下文摘要文本
   */
  buildSummary(count: number = 10): string {
    const recent = this.getRecent(count);

    if (recent.length === 0) {
      return '（暂无协作历史）';
    }

    const lines: string[] = [];

    for (const entry of recent) {
      const line = this.formatEntry(entry);
      if (line) {
        lines.push(line);
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化单个条目为可读文本
   */
  private formatEntry(entry: KnowledgeEntry): string | null {
    switch (entry.type) {
      case 'discussion_summary': {
        const e = entry as DiscussionSummaryEntry;
        const participants = e.participants.join('+');
        const decision = e.decision ? ` → 决策：${e.decision}` : '';
        return `- [讨论] ${participants} 讨论了 ${e.topic}：${e.summary}${decision}`;
      }

      case 'decision': {
        const e = entry as DecisionEntry;
        const reason = e.reason ? `（${e.reason}）` : '';
        return `- [决策] ${e.madeBy} 决定：${e.decision}${reason}`;
      }

      case 'artifact_created': {
        const e = entry as ArtifactCreatedEntry;
        const type = e.artifactType ? `（${e.artifactType}）` : '';
        return `- [产物] ${e.createdBy} 创建了 ${e.name}${type}`;
      }

      case 'milestone': {
        const e = entry as MilestoneEntry;
        return `- [里程碑] ${e.achievedBy} 完成：${e.milestone}`;
      }

      case 'issue_found': {
        const e = entry as IssueFoundEntry;
        const severity = e.severity ? `[${e.severity.toUpperCase()}]` : '';
        return `- [问题] ${e.foundBy} 发现${severity}：${e.issue}`;
      }

      case 'custom':
        // 自定义类型，尝试提取有用信息
        return `- [自定义] ${JSON.stringify(entry).substring(0, 100)}`;

      default:
        return null;
    }
  }

  /**
   * 导出为 JSON（用于备份或分析）
   */
  export(): KnowledgeEntry[] {
    return this.getAll();
  }

  /**
   * 从 JSON 导入（批量导入）
   */
  import(entries: KnowledgeEntry[]): void {
    for (const entry of entries) {
      this.append(entry);
    }
  }

  // ========== 统计信息 ==========

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    recentActivity: string;
  } {
    const byType: Record<string, number> = {};

    for (const entry of this.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }

    const recent = this.getRecent(5);
    const recentActivity = recent.length > 0 ? this.buildSummary(5) : '（无活动）';

    return {
      total: this.entries.length,
      byType,
      recentActivity
    };
  }
}
