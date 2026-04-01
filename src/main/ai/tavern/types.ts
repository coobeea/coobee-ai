/**
 * Tavern Lifecycle - 类型定义
 *
 * 定义五阶段任务执行流程的核心类型
 */

import type { Task } from './TavernStore';

/**
 * 生命周期阶段枚举
 */
export enum LifecycleStage {
  /** 阶段一：需求分析 */
  REQUIREMENT_ANALYSIS = 'requirement-analysis',
  /** 阶段二：方案设计 */
  SOLUTION_DESIGN = 'solution-design',
  /** 阶段三：反思优化 */
  REFLECTION = 'reflection',
  /** 阶段四：实施跟踪 */
  IMPLEMENTATION = 'implementation',
  /** 阶段五：验收报告 */
  ACCEPTANCE = 'acceptance'
}

/**
 * 任务配置
 */
export interface TaskConfig {
  /** 是否使用五阶段生命周期流程，默认 false */
  useLifecycle?: boolean;
  /** 是否自动选择中策方案，默认 true */
  autoSelectSolution?: boolean;
  /** 是否强制要求文档完整性，默认 true */
  requireDocumentation?: boolean;
  /** 单阶段超时时间（毫秒），默认 10 分钟 */
  stageTimeout?: number;
  /** awaiting-input 超时时间（毫秒），默认 24 小时 */
  awaitingInputTimeout?: number;
}

/**
 * 任务上下文（贯穿整个生命周期）
 */
export interface TaskContext {
  /** 任务定义 */
  task: Task;
  /** 会话 ID（ThreadStore 中的 ID） */
  sessionId: string;
  /** 工作空间目录路径 */
  workspaceDir: string;
  /** lifecycle 文档目录路径 */
  lifecycleDir: string;
  /** 当前阶段 */
  currentStage: LifecycleStage;
  /** 已生成的文档（文件名 → 内容） */
  documents: Map<string, string>;
  /** 用户补充的资料（键 → 值） */
  userInputs: Map<string, unknown>;
  /** 任务配置 */
  config: Required<TaskConfig>;
}

/**
 * 阶段执行结果
 */
export interface StageResult {
  /** 阶段名称 */
  stage: LifecycleStage;
  /** 是否成功 */
  success: boolean;
  /** 生成的文档文件名 */
  documents: string[];
  /** 错误信息（如果失败） */
  error?: string;
  /** 是否需要用户输入（暂停执行） */
  awaitingInput?: boolean;
  /** 需要用户补充的资料列表 */
  requiredInputs?: string[];
  /** 是否需要用户决策（选择方案） */
  awaitingDecision?: boolean;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 元数据（自定义信息） */
  metadata?: Record<string, unknown>;
}

/**
 * 文档验证结果
 */
export interface ValidationResult {
  /** 文档是否有效 */
  valid: boolean;
  /** 质量评分（0-100） */
  score: number;
  /** 错误列表（必需章节缺失） */
  errors: string[];
  /** 警告列表（可选章节缺失） */
  warnings: string[];
  /** 缺失的章节名称 */
  missingSections?: string[];
  /** 内容完整度（百分比） */
  completeness?: number;
}

/**
 * 模板定义
 */
export interface TemplateDefinition {
  /** 文件名（如 "01-需求分析.md"） */
  filename: string;
  /** 必需章节列表（用于验证） */
  sections: string[];
  /** 模板内容（Markdown 格式，支持变量 {{var}}） */
  content: string;
  /** 模板描述 */
  description?: string;
}

/**
 * 模板变量（用于替换 {{var}}）
 */
export interface TemplateVariables {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 时间戳（完整日期时间） */
  timestamp: string;
  /** 任务 ID */
  taskId: string;
  /** 任务标题 */
  taskTitle: string;
  /** 任务描述 */
  taskDescription: string;
  /** 会话 ID */
  sessionId: string;
  /** 自定义变量 */
  [key: string]: string | number | boolean;
}

/**
 * 阶段切换事件数据
 */
export interface StageChangedEvent {
  /** 任务 ID */
  taskId: string;
  /** 新阶段 */
  stage: LifecycleStage;
  /** 阶段名称（中文） */
  stageName: string;
  /** 关联的文档文件名 */
  file: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 进度事件数据
 */
export interface ProgressEvent {
  /** 任务 ID */
  taskId: string;
  /** 进度类型 */
  type: 'todo-completed' | 'document-created' | 'bug-reported' | 'stage-completed';
  /** 进度消息 */
  message: string;
  /** 关联文件（如有） */
  file?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 任务恢复信息
 */
export interface TaskRecoveryInfo {
  /** 任务 ID */
  taskId: string;
  /** 已完成的阶段 */
  completedStages: LifecycleStage[];
  /** 下一个应执行的阶段 */
  nextStage: LifecycleStage;
  /** 挂起时间（毫秒） */
  stuckDuration: number;
  /** 是否可恢复 */
  recoverable: boolean;
  /** 不可恢复原因（如果 recoverable=false） */
  reason?: string;
}
