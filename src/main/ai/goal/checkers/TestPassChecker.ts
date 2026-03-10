/**
 * TestPassChecker - 测试通过检查器
 *
 * 运行项目测试，检查是否全部通过
 */

import { execSync } from 'node:child_process';
import { AbstractGoalChecker } from '../GoalChecker';
import type { GoalCheckResult, ExecutionContext } from '../types';
import { log } from '@main/common/logger';

export class TestPassChecker extends AbstractGoalChecker {
  name = 'test-pass';
  description = '运行测试并检查是否全部通过';

  private testCommand: string;

  /**
   * @param testCommand 测试命令（默认 'pnpm test'）
   */
  constructor(testCommand = 'pnpm test') {
    super();
    this.testCommand = testCommand;
  }

  async check(context: ExecutionContext): Promise<GoalCheckResult> {
    log.info(`[TestPassChecker] 运行测试 (迭代 ${context.iteration}/${context.maxIterations})`);

    try {
      const output = execSync(this.testCommand, {
        cwd: context.workspace,
        encoding: 'utf-8',
        timeout: 300000, // 5 分钟超时
        stdio: 'pipe'
      });

      // 分析测试输出
      const passedMatch = output.match(/(\d+)\s+passed/);
      const failedMatch = output.match(/(\d+)\s+failed/);

      const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
      const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;

      if (failed === 0 && passed > 0) {
        return this.success(`所有测试通过 (${passed} 个)`, { passed, failed });
      } else {
        return this.failure(
          `测试失败：${failed} 个失败，${passed} 个通过。请修复失败的测试。`,
          passed / (passed + failed),
          { passed, failed, output: output.slice(-1000) }
        );
      }
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: string; stdout?: string };
      const output = err.stderr || err.stdout || '';

      // 测试失败时 exit code 为 1
      if (err.status === 1) {
        const failedMatch = output.match(/(\d+)\s+failed/);
        const passedMatch = output.match(/(\d+)\s+passed/);
        const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
        const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;

        return this.failure(
          `测试失败：${failed} 个失败，${passed} 个通过。请分析错误并修复。`,
          passed / (passed + failed || 1),
          { passed, failed, error: output.slice(-1000) }
        );
      }

      // 其他错误（如命令不存在）
      log.error('[TestPassChecker] 执行测试命令失败:', error);
      return this.failure(`执行测试命令失败: ${String(error)}`, 0, { error: String(error) });
    }
  }
}
