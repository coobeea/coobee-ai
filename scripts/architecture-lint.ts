#!/usr/bin/env tsx
/**
 * 架构 Lint 工具
 * 检查代码库的架构质量问题
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * 架构违规类型
 */
type ViolationType =
  | 'circular_dependency'
  | 'missing_export'
  | 'type_safety'
  | 'resource_leak'
  | 'todo_violation'
  | 'naming_violation'
  | 'doc_sync';

/**
 * 违规严重程度
 */
type Severity = 'error' | 'warning' | 'info';

/**
 * 架构违规
 */
interface ArchitectureViolation {
  type: ViolationType;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  suggestion?: string;
}

/**
 * 架构 Lint 工具
 */
class ArchitectureLinter {
  private violations: ArchitectureViolation[] = [];
  private aiModulePath = join(process.cwd(), 'src/main/ai');

  /**
   * 运行所有检查
   */
  async lint(): Promise<void> {
    console.log('🔍 Running architecture checks...\n');

    await this.checkTypeSafety();
    await this.checkResourceLeaks();
    await this.checkTODOs();
    await this.checkNamingConventions();
    await this.checkDocSync();
    await this.checkExports();

    this.printResults();
  }

  /**
   * 检查类型安全
   */
  private async checkTypeSafety(): Promise<void> {
    console.log('📝 Checking type safety...');

    const files = await this.getAllTsFiles();

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n');

      // 检查 any 使用
      lines.forEach((line, index) => {
        if (line.includes(': any') || line.includes('<any>')) {
          if (!line.includes('eslint-disable') && !line.includes('@ts-expect-error')) {
            this.violations.push({
              type: 'type_safety',
              severity: 'warning',
              message: 'Avoid using "any" type',
              file,
              line: index + 1,
              suggestion: 'Use "unknown" with type guards instead'
            });
          }
        }

        // 检查类型断言
        if (line.match(/as\s+any(?!\])/)) {
          this.violations.push({
            type: 'type_safety',
            severity: 'error',
            message: 'Dangerous type assertion "as any"',
            file,
            line: index + 1,
            suggestion: 'Provide proper type narrowing'
          });
        }

        // 检查 @ts-ignore
        if (line.includes('@ts-ignore')) {
          this.violations.push({
            type: 'type_safety',
            severity: 'error',
            message: 'Use of @ts-ignore detected',
            file,
            line: index + 1,
            suggestion: 'Fix the underlying type issue or use @ts-expect-error with comment'
          });
        }
      });
    }
  }

  /**
   * 检查资源泄漏
   */
  private async checkResourceLeaks(): Promise<void> {
    console.log('🔧 Checking resource leaks...');

    const files = await this.getAllTsFiles();

    for (const file of files) {
      const content = await readFile(file, 'utf-8');

      // 检查 setInterval 是否有对应的 clearInterval
      const hasSetInterval = content.includes('setInterval');
      const hasClearInterval = content.includes('clearInterval');

      if (hasSetInterval && !hasClearInterval) {
        this.violations.push({
          type: 'resource_leak',
          severity: 'error',
          message: 'setInterval without clearInterval',
          file,
          suggestion: 'Add cleanup() method with clearInterval()'
        });
      }

      // 检查 EventBus.on 是否有对应的 off
      const hasEventOn = content.includes('eventBus.on');
      const hasEventOff = content.includes('eventBus.off');

      if (hasEventOn && !hasEventOff && !content.includes('cleanup')) {
        this.violations.push({
          type: 'resource_leak',
          severity: 'warning',
          message: 'EventBus.on without cleanup',
          file,
          suggestion: 'Consider adding cleanup() to remove listeners'
        });
      }

      // 检查类是否有 cleanup/destroy 方法
      if (content.match(/class\s+\w+/)) {
        const hasTimer = content.includes('setInterval') || content.includes('setTimeout');
        const hasEventListener = hasEventOn;
        const hasCleanup = content.includes('cleanup()') || content.includes('destroy()');

        if ((hasTimer || hasEventListener) && !hasCleanup) {
          this.violations.push({
            type: 'resource_leak',
            severity: 'warning',
            message: 'Class with resources lacks cleanup/destroy method',
            file,
            suggestion: 'Add cleanup() or destroy() method'
          });
        }
      }
    }
  }

  /**
   * 检查 TODO
   */
  private async checkTODOs(): Promise<void> {
    console.log('📋 Checking TODOs...');

    const files = await this.getAllTsFiles();

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (line.includes('TODO') && !line.includes('TodoWrite')) {
          this.violations.push({
            type: 'todo_violation',
            severity: 'info',
            message: 'TODO comment found',
            file,
            line: index + 1,
            suggestion: 'Create an issue or complete the TODO'
          });
        }
      });
    }
  }

  /**
   * 检查命名规范
   */
  private async checkNamingConventions(): Promise<void> {
    console.log('✏️  Checking naming conventions...');

    const files = await this.getAllTsFiles();

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // 检查类命名（应该是 PascalCase）
        const classMatch = line.match(/class\s+([a-z][a-zA-Z0-9]*)/);
        if (classMatch) {
          this.violations.push({
            type: 'naming_violation',
            severity: 'error',
            message: `Class name should be PascalCase: ${classMatch[1]}`,
            file,
            line: index + 1,
            suggestion: `Rename to ${classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1)}`
          });
        }

        // 检查接口命名（不应该用 I 前缀的除外）
        const interfaceMatch = line.match(/interface\s+([a-z][a-zA-Z0-9]*)/);
        if (interfaceMatch) {
          this.violations.push({
            type: 'naming_violation',
            severity: 'warning',
            message: `Interface name should be PascalCase: ${interfaceMatch[1]}`,
            file,
            line: index + 1
          });
        }
      });
    }
  }

  /**
   * 检查文档同步
   */
  private async checkDocSync(): Promise<void> {
    console.log('📚 Checking documentation sync...');

    // 检查每个模块是否有文档
    const modules = ['agents', 'memory', 'orchestration', 'runtime', 'streaming', 'storage'];

    for (const module of modules) {
      const modulePath = join(this.aiModulePath, module);
      const readmePath = join(modulePath, 'README.md');

      if (!existsSync(readmePath)) {
        this.violations.push({
          type: 'doc_sync',
          severity: 'warning',
          message: `Module ${module} missing README.md`,
          file: modulePath,
          suggestion: 'Create README.md documenting the module'
        });
      }
    }
  }

  /**
   * 检查导出
   */
  private async checkExports(): Promise<void> {
    console.log('📦 Checking exports...');

    const modules = ['agents', 'memory', 'orchestration', 'runtime', 'streaming', 'storage'];

    for (const module of modules) {
      const indexPath = join(this.aiModulePath, module, 'index.ts');

      if (!existsSync(indexPath)) {
        this.violations.push({
          type: 'missing_export',
          severity: 'error',
          message: `Module ${module} missing index.ts`,
          file: join(this.aiModulePath, module),
          suggestion: 'Create index.ts to export public API'
        });
      }
    }
  }

  /**
   * 获取所有 TypeScript 文件
   */
  private async getAllTsFiles(dir: string = this.aiModulePath): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string): Promise<void> {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // 跳过特定目录
          if (!entry.name.startsWith('.') && !entry.name.includes('node_modules')) {
            await walk(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    }

    await walk(dir);
    return files;
  }

  /**
   * 打印结果
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('Architecture Lint Results');
    console.log('='.repeat(80) + '\n');

    if (this.violations.length === 0) {
      console.log('✅ No architecture violations found!\n');
      return;
    }

    // 按严重程度分组
    const errors = this.violations.filter((v) => v.severity === 'error');
    const warnings = this.violations.filter((v) => v.severity === 'warning');
    const infos = this.violations.filter((v) => v.severity === 'info');

    if (errors.length > 0) {
      console.log(`❌ ${errors.length} Error(s):`);
      errors.forEach((v) => {
        console.log(`  ${v.file}${v.line ? `:${v.line}` : ''}`);
        console.log(`    ${v.message}`);
        if (v.suggestion) {
          console.log(`    💡 ${v.suggestion}`);
        }
        console.log();
      });
    }

    if (warnings.length > 0) {
      console.log(`⚠️  ${warnings.length} Warning(s):`);
      warnings.forEach((v) => {
        console.log(`  ${v.file}${v.line ? `:${v.line}` : ''}`);
        console.log(`    ${v.message}`);
        if (v.suggestion) {
          console.log(`    💡 ${v.suggestion}`);
        }
        console.log();
      });
    }

    if (infos.length > 0) {
      console.log(`ℹ️  ${infos.length} Info(s):`);
      infos.slice(0, 10).forEach((v) => {
        console.log(`  ${v.file}${v.line ? `:${v.line}` : ''}`);
        console.log(`    ${v.message}`);
        console.log();
      });
      if (infos.length > 10) {
        console.log(`  ... and ${infos.length - 10} more\n`);
      }
    }

    console.log('='.repeat(80));
    console.log(`Total: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos\n`);

    // 如果有错误，退出码为 1
    if (errors.length > 0) {
      process.exit(1);
    }
  }
}

// 运行 Lint
const linter = new ArchitectureLinter();
linter.lint().catch((error) => {
  console.error('Failed to run architecture lint:', error);
  process.exit(1);
});
