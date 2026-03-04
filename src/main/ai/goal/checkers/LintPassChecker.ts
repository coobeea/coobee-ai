/**
 * LintPassChecker - Linter 通过检查器
 *
 * 运行 ESLint 和 TypeScript 检查，确认无错误
 */

import { execSync } from 'node:child_process';
import { AbstractGoalChecker } from '../GoalChecker';
import type { GoalCheckResult, ExecutionContext } from '../types';
import { log } from '@main/common/logger';

export class LintPassChecker extends AbstractGoalChecker {
  name = 'lint-pass';
  description = '运行 Linter 并检查是否无错误';

  async check(context: ExecutionContext): Promise<GoalCheckResult> {
    log.info(`[LintPassChecker] 运行 Lint 检查 (迭代 ${context.iteration}/${context.maxIterations})`);

    const errors: string[] = [];
    let totalErrors = 0;

    // 1. ESLint 检查
    try {
      execSync('pnpm lint', {
        cwd: context.workspace,
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe'
      });
      log.info('[LintPassChecker] ESLint 检查通过');
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: string; stdout?: string };
      const output = err.stdout || err.stderr || '';
      const errorMatch = output.match(/(\d+)\s+error/);
      const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 1;
      totalErrors += errorCount;
      errors.push(`ESLint: ${errorCount} 个错误`);
      log.warn('[LintPassChecker] ESLint 检查失败', { errorCount });
    }

    // 2. TypeScript 检查
    try {
      execSync('pnpm typecheck', {
        cwd: context.workspace,
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe'
      });
      log.info('[LintPassChecker] TypeScript 检查通过');
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: string; stdout?: string };
      const output = err.stdout || err.stderr || '';
      const errorMatch = output.match(/Found\s+(\d+)\s+error/);
      const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 1;
      totalErrors += errorCount;
      errors.push(`TypeScript: ${errorCount} 个错误`);
      log.warn('[LintPassChecker] TypeScript 检查失败', { errorCount });
    }

    if (totalErrors === 0) {
      return this.success('Lint 检查全部通过', { eslintPass: true, typescriptPass: true });
    } else {
      return this.failure(`Lint 检查失败：${errors.join('，')}。请修复这些错误。`, 0, { totalErrors, errors });
    }
  }
}
