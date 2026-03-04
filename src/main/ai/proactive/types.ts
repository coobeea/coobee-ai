/**
 * Proactive Types
 *
 * 主动式任务发现类型定义
 */

/**
 * 发现的机会
 */
export interface Opportunity {
  /** 机会 ID */
  id: string;

  /** 类型 */
  type: 'bug' | 'improvement' | 'optimization' | 'refactor' | 'security' | 'documentation';

  /** 标题 */
  title: string;

  /** 描述 */
  description: string;

  /** 优先级（1-10） */
  priority: number;

  /** 预估影响 */
  estimatedImpact: 'low' | 'medium' | 'high';

  /** 置信度（0-1） */
  confidence: number;

  /** 来源 */
  source: string;

  /** 相关文件 */
  relatedFiles?: string[];

  /** 建议操作 */
  suggestedAction?: string;

  /** 状态 */
  status: 'new' | 'acknowledged' | 'planned' | 'dismissed';

  /** 发现时间 */
  discoveredAt: number;
}

/**
 * 扫描规则
 */
export interface ScanRule {
  /** 规则 ID */
  id: string;

  /** 规则名称 */
  name: string;

  /** 类型 */
  type: Opportunity['type'];

  /** 是否启用 */
  enabled: boolean;

  /** 扫描间隔（毫秒） */
  interval: number;

  /** 检查函数 */
  check: (context: ScanContext) => Promise<Opportunity[]>;
}

/**
 * 扫描上下文
 */
export interface ScanContext {
  /** 工作空间目录 */
  workspaceDir: string;

  /** Git 仓库路径 */
  gitRepoPath?: string;

  /** 最近活动（commit、PR 等） */
  recentActivity?: unknown[];
}

/**
 * 主动发现配置
 */
export interface ProactiveConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 扫描间隔（毫秒） */
  scanInterval: number;

  /** 最小优先级（低于此值的不展示） */
  minPriority: number;

  /** 通知方式 */
  notificationMethod: 'console' | 'ui' | 'both';
}
