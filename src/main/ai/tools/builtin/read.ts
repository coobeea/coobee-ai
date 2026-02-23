/**
 * read — 文件读取工具
 *
 * 读取指定路径的文件内容，支持 offset/limit 分页读取大文件。
 * 返回带行号的文本，便于 LLM 引用具体行。
 *
 * 安全：只读操作，不限制读取路径。Agent 需要读取 Skill 文件、
 * 配置文件等 workspace 外的资源，限制读取只会导致体验下降。
 *
 * 分类：FileSystem | 风险：低（只读操作）
 */
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { resolveToolPath, formatFileError, checkAborted } from '../pipeline';
import { canRead } from '../security/sensitive-paths';

/** 默认最大读取行数（防止超大文件打爆 token） */
const DEFAULT_MAX_LINES = 2000;

/** 文件大小限制（50MB） */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export const readTool: ToolDefinition = {
  name: 'read',
  description:
    'Read the contents of a file. ' +
    'Returns lines with line numbers (e.g. "  1|content"). ' +
    'Use offset and limit to read specific ranges of large files.',
  category: ToolCategory.FileSystem,
  needUserConfirm: false,
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path to read'),
    offset: z.number().optional().describe('Starting line number (1-based). Defaults to 1'),
    limit: z.number().optional().describe(`Maximum number of lines to return. Defaults to ${DEFAULT_MAX_LINES}`)
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const filePath = params.path as string;
    const offset = Math.max(1, (params.offset as number) || 1);
    const limit = Math.min((params.limit as number) || DEFAULT_MAX_LINES, DEFAULT_MAX_LINES);
    const startTime = Date.now();

    // 统一路径解析（读操作不限制目录边界）
    const resolved = resolveToolPath(filePath, context, { readOnly: true });
    if (!resolved.ok) return resolved.error;

    const absolutePath = resolved.absolutePath;

    // 敏感路径检查
    const sensitiveError = canRead(absolutePath);
    if (sensitiveError) {
      return {
        success: false,
        llmContent: `Error: ${sensitiveError}`,
        error: { code: 'SENSITIVE_PATH', message: sensitiveError }
      };
    }

    // 取消信号检查
    const aborted = checkAborted(signal);
    if (aborted) return aborted;

    yield { type: 'progress', content: `Reading ${filePath}...`, percentage: 0 };

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        return {
          success: false,
          llmContent: `Error: ${filePath} is not a file`,
          error: { code: 'NOT_FILE', message: `${filePath} is not a file` }
        };
      }

      // 检查文件大小
      if (fileStat.size > MAX_FILE_SIZE) {
        return {
          success: false,
          llmContent: `Error: File too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB). Maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB. Use offset/limit parameters for large files.`,
          error: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit' }
        };
      }

      // 检测二进制文件
      if (await isBinaryFile(absolutePath)) {
        return {
          success: false,
          llmContent: `Error: Cannot read binary file: ${filePath}. This file appears to be a binary file (image, executable, archive, etc.) and cannot be displayed as text.`,
          error: { code: 'BINARY_FILE', message: 'File is binary' }
        };
      }

      yield { type: 'progress', content: 'Reading content...', percentage: 30 };

      const content = await readFile(absolutePath, 'utf-8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      yield { type: 'progress', content: 'Formatting output...', percentage: 70 };

      // 分页截取
      const startIdx = offset - 1;
      const endIdx = Math.min(startIdx + limit, totalLines);
      const selectedLines = allLines.slice(startIdx, endIdx);

      // 添加行号（右对齐，宽度自适应）
      const lineNumWidth = String(endIdx).length;
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = String(startIdx + i + 1).padStart(lineNumWidth, ' ');
        return `${lineNum}|${line}`;
      });

      let result = numberedLines.join('\n');

      if (startIdx > 0) {
        result = `... ${startIdx} lines not shown ...\n` + result;
      }
      if (endIdx < totalLines) {
        result = result + `\n... ${totalLines - endIdx} lines not shown ...`;
      }

      const duration = Date.now() - startTime;

      yield {
        type: 'output',
        content: `Read ${selectedLines.length} lines from ${filePath} (${totalLines} total)`
      };

      return {
        success: true,
        llmContent: result,
        userContent: result,
        metadata: {
          startTime,
          endTime: Date.now(),
          duration,
          totalLines,
          readLines: selectedLines.length
        }
      };
    } catch (error: unknown) {
      return formatFileError(error, filePath, 'reading', startTime);
    }
  }
};

/**
 * 检查文件是否为二进制文件
 *
 * 通过读取文件前 8KB 字节，检查是否包含 null 字节或大量非文本字符。
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const { open } = await import('node:fs/promises');
    const buffer = Buffer.alloc(8192);
    const fd = await open(filePath, 'r');

    try {
      const { bytesRead } = await fd.read(buffer, 0, 8192, 0);

      if (bytesRead === 0) {
        return false; // 空文件视为文本
      }

      const sampleSize = Math.min(bytesRead, 8192);
      let nullBytes = 0;
      let nonTextBytes = 0;

      for (let i = 0; i < sampleSize; i++) {
        const byte = buffer[i];

        // Null 字节几乎总是表明是二进制文件
        if (byte === 0) {
          nullBytes++;
          if (nullBytes > 1) {
            return true; // 发现多个 null 字节，确定是二进制
          }
        }

        // 检查是否是非文本字符（排除常见的控制字符）
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
          nonTextBytes++;
        }
      }

      // 如果超过 30% 的字节是非文本字符，认为是二进制
      const nonTextRatio = nonTextBytes / sampleSize;
      return nonTextRatio > 0.3;
    } finally {
      await fd.close();
    }
  } catch {
    // 读取失败，保守地视为二进制
    return true;
  }
}
