/**
 * GoalChecker - 目标检查器基类
 *
 * 提供通用的检查逻辑和工具方法
 */

import type { GoalChecker, GoalCheckResult, ExecutionContext } from './types';

/**
 * 抽象目标检查器基类
 */
export abstract class AbstractGoalChecker implements GoalChecker {
  abstract name: string;
  abstract description: string;

  abstract check(context: ExecutionContext): Promise<GoalCheckResult>;

  /**
   * 辅助方法：创建成功结果
   */
  protected success(message?: string, metadata?: Record<string, unknown>): GoalCheckResult {
    return {
      achieved: true,
      feedback: message,
      progress: 1.0,
      metadata
    };
  }

  /**
   * 辅助方法：创建失败结果
   */
  protected failure(feedback: string, progress = 0, metadata?: Record<string, unknown>): GoalCheckResult {
    return {
      achieved: false,
      feedback,
      progress,
      metadata
    };
  }
}
