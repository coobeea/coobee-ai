/**
 * Knowledge Transfer Types
 *
 * 跨项目知识迁移类型定义
 */

/**
 * 知识包
 */
export interface KnowledgePackage {
  /** 包 ID */
  id: string;

  /** 包名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 来源项目 */
  sourceProject: string;

  /** 知识项列表 */
  items: KnowledgeItem[];

  /** 标签 */
  tags: string[];

  /** 版本 */
  version: string;

  /** 创建时间 */
  createdAt: number;
}

/**
 * 知识项
 */
export interface KnowledgeItem {
  /** 项 ID */
  id: string;

  /** 类型 */
  type: 'pattern' | 'best-practice' | 'solution' | 'lesson' | 'tip';

  /** 标题 */
  title: string;

  /** 内容 */
  content: string;

  /** 适用场景 */
  applicableScenarios?: string[];

  /** 相关技术栈 */
  techStack?: string[];

  /** 置信度 */
  confidence: number;
}

/**
 * 迁移任务
 */
export interface TransferTask {
  /** 任务 ID */
  id: string;

  /** 源项目 */
  sourceProject: string;

  /** 目标项目 */
  targetProject: string;

  /** 知识包 ID */
  packageId: string;

  /** 状态 */
  status: 'pending' | 'analyzing' | 'adapting' | 'completed' | 'failed';

  /** 进度（0-1） */
  progress: number;

  /** 适配结果 */
  adaptationResult?: {
    applicableItems: number;
    modifiedItems: number;
    skippedItems: number;
  };

  /** 创建时间 */
  createdAt: number;

  /** 完成时间 */
  completedAt?: number;
}

/**
 * 知识适配器配置
 */
export interface AdaptationConfig {
  /** 自动适配阈值 */
  autoAdaptThreshold: number;

  /** 相似度计算方法 */
  similarityMethod: 'keyword' | 'semantic' | 'hybrid';

  /** 是否需要人工审核 */
  requireHumanReview: boolean;
}
