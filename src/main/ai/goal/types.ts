/**
 * Goal-Driven Execution Types
 *
 * 目标驱动循环执行的核心类型定义
 */

/**
 * 目标检查结果
 */
export interface GoalCheckResult {
  /** 目标是否已达成 */
  achieved: boolean;

  /** 反馈消息（当目标未达成时，告诉 Agent 接下来该做什么） */
  feedback?: string;

  /** 当前进度（0-1） */
  progress?: number;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** 会话 ID */
  sessionId: string;

  /** 任务 ID（如果来自 Tavern） */
  taskId?: string;

  /** 工作空间目录 */
  workspace: string;

  /** 当前迭代次数 */
  iteration: number;

  /** 最大迭代次数 */
  maxIterations: number;
}

/**
 * 目标检查器接口
 *
 * 实现此接口来定义各种目标检查逻辑（如测试通过、Lint 通过、自定义脚本）
 */
export interface GoalChecker {
  /** 检查器名称 */
  name: string;

  /** 检查器描述 */
  description: string;

  /**
   * 检查目标是否达成
   *
   * @param context 执行上下文
   * @returns 检查结果
   */
  check(context: ExecutionContext): Promise<GoalCheckResult>;
}

/**
 * 目标定义
 */
export interface Goal {
  /** 目标描述（用户可读） */
  description: string;

  /** 使用的检查器 */
  checker: GoalChecker;

  /** 最大迭代次数（默认 10） */
  maxIterations?: number;

  /** 超时时间（毫秒，默认无限制） */
  timeout?: number;
}
