/**
 * write — 文件写入工具
 *
 * 将内容写入指定路径的文件。如果文件不存在则创建（含中间目录）。
 * 如果文件已存在则完全覆盖。
 *
 * 安全：路径受沙箱限制，不能写入工作区之外的文件。
 *
 * 分类：FileSystem | 风险：中（修改文件系统）
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { resolveToolPath, formatFileError, checkAborted } from '../pipeline';
import { withFileLock } from './file-lock';
import { backupBeforeWrite } from './file-backup';
import { canWrite } from '../security/sensitive-paths';
import { scanScriptContent } from '../security/command-scanner';

export const writeTool: ToolDefinition = {
  name: 'write',
  description:
    'Write content to a file. Creates the file (and parent directories) if it does not exist. ' +
    'Overwrites the file completely if it already exists. ' +
    'Always provide the COMPLETE file content — do not use placeholders or omit sections.',
  category: ToolCategory.FileSystem,
  needUserConfirm: true,
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path to write'),
    content: z.string().describe('The full content to write to the file')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const filePath = params.path as string;
    const content = params.content as string;
    const startTime = Date.now();

    if (typeof content !== 'string') {
      return {
        success: false,
        llmContent: 'Error: content must be a string',
        error: { code: 'INVALID_PARAM', message: 'content must be a string' }
      };
    }

    // 统一路径解析
    const resolved = resolveToolPath(filePath, context);
    if (!resolved.ok) return resolved.error;

    const absolutePath = resolved.absolutePath;

    // 敏感路径检查
    const sensitiveError = canWrite(absolutePath);
    if (sensitiveError) {
      return {
        success: false,
        llmContent: `Error: ${sensitiveError}`,
        error: { code: 'SENSITIVE_PATH', message: sensitiveError }
      };
    }

    // 脚本内容扫描（如果是 Python/JS/TS 脚本）
    const ext = extname(absolutePath).toLowerCase();
    const isScript = ['.py', '.js', '.ts', '.mjs', '.cjs', '.sh', '.bash'].includes(ext);
    if (isScript) {
      const scriptError = scanScriptContent(content);
      if (scriptError) {
        return {
          success: false,
          llmContent: `Error: ${scriptError}`,
          error: { code: 'DANGEROUS_SCRIPT', message: scriptError }
        };
      }
    }

    // 取消信号检查
    const aborted = checkAborted(signal);
    if (aborted) return aborted;

    yield { type: 'progress', content: `Writing to ${filePath}...`, percentage: 0 };

    try {
      // 文件级互斥锁（防止多 Agent 竞态写入）
      await withFileLock(absolutePath, async () => {
        // 写入前备份（已有文件才备份，新建文件跳过）
        if (context?.workspaceRoot) {
          backupBeforeWrite(absolutePath, context.workspaceRoot);
        }
        // 确保父目录存在
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf-8');
      });

      const lineCount = content.split('\n').length;
      const byteSize = Buffer.byteLength(content, 'utf-8');
      const duration = Date.now() - startTime;

      const summary = `Successfully wrote ${byteSize} bytes (${lineCount} lines) to ${filePath}`;

      yield { type: 'output', content: summary };

      return {
        success: true,
        llmContent: summary,
        userContent: summary,
        metadata: { startTime, endTime: Date.now(), duration, byteSize, lineCount }
      };
    } catch (error: unknown) {
      return formatFileError(error, filePath, 'writing', startTime);
    }
  }
};
