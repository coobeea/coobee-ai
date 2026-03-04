/**
 * CustomScriptChecker - 自定义脚本检查器
 *
 * 运行用户指定的脚本或命令，根据 exit code 判断目标是否达成
 */

import { execSync } from 'node:child_process';
import { AbstractGoalChecker } from '../GoalChecker';
import type { GoalCheckResult, ExecutionContext } from '../types';
import { log } from '@main/common/logger';

export class CustomScriptChecker extends AbstractGoalChecker {
  name = 'custom-script';
  description = '运行自定义脚本检查目标';

  private script: string;
  private successMessage: string;
  private failureMessage: string;

  /**
   * @param script 要运行的脚本或命令
   * @param successMessage 成功时的消息
   * @param failureMessage 失败时的消息
   */
  constructor(script: string, successMessage = '自定义检查通过', failureMessage = '自定义检查失败') {
    super();
    this.script = script;
    this.successMessage = successMessage;
    this.failureMessage = failureMessage;
  }

  async check(context: ExecutionContext): Promise<GoalCheckResult> {
    log.info(`[CustomScriptChecker] 运行脚本 (迭代 ${context.iteration}/${context.maxIterations}): ${this.script}`);

    try {
      const output = execSync(this.script, {
        cwd: context.workspace,
        encoding: 'utf-8',
        timeout: 60000, // 1 分钟超时
        stdio: 'pipe'
      });

      // exit code 0 表示成功
      return this.success(this.successMessage, {
        output: output.trim().slice(-500)
      });
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: string; stdout?: string };
      const output = err.stderr || err.stdout || '';

      log.warn('[CustomScriptChecker] 脚本执行失败', {
        exitCode: err.status,
        output: output.slice(-200)
      });

      return this.failure(`${this.failureMessage}。Exit code: ${err.status}。请检查脚本输出。`, 0, {
        exitCode: err.status,
        error: output.trim().slice(-500)
      });
    }
  }
}
