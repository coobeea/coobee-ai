/**
 * 内置工具全面测试
 *
 * 验证 4 个基础工具（read, write, edit, exec）的 AsyncGenerator 执行逻辑：
 *   - yield ToolStreamUpdate — 增量输出
 *   - return ToolResult      — 最终结果
 *
 * 文件系统操作使用 mock，exec 工具使用真实 shell 执行。
 *
 * 覆盖维度：
 *   - 正常流程
 *   - 参数校验
 *   - 沙箱路径守卫
 *   - 文件系统错误（ENOENT, EACCES）
 *   - 边界情况（空文件、大文件、特殊字符、Unicode）
 *   - AbortSignal 取消
 *   - 流式输出验证
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';

// Mock logger（memory 工具依赖 @main/common/logger → env → electron）
vi.mock('@main/common/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log, createLogger: vi.fn(() => log) };
});

// Mock env（memory 工具延迟导入 Env）
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userMemoryDir: '/tmp/test-memory/user',
      agentMemoryDir: '/tmp/test-memory/agent'
    }
  }
}));

// Mock extension system（exec 工具检查 tool-approval 是否加载）
vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getRegistry: (): { getExtensionIds: () => string[] } => ({
      getExtensionIds: (): string[] => ['tool-approval']
    }),
    getHookRunner: (): null => null
  }
}));

// Mock fs 模块
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  open: vi.fn()
}));

import { readFile, writeFile, mkdir, stat, open } from 'node:fs/promises';
import { readTool, writeTool, editTool, execTool, builtinTools } from '../builtin';
import { ProcessRegistry } from '../../process/ProcessRegistry';
import { resolveSandboxPath } from '../../sandbox';
import { createFallbackToolContext } from '../../runtime/shared/ToolExecutionPipeline';

/** 测试用 context：允许 /tmp 目录下的操作 */
const tmpContext = createFallbackToolContext({ workspaceRoot: '/tmp' });

/**
 * 辅助函数：消费 AsyncGenerator，收集所有 yield 的更新和最终结果
 */
async function consumeGenerator(
  gen: AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>
): Promise<{ updates: ToolStreamUpdate[]; result: ToolResult }> {
  const updates: ToolStreamUpdate[] = [];
  let iterResult = await gen.next();
  while (!iterResult.done) {
    updates.push(iterResult.value);
    iterResult = await gen.next();
  }
  return { updates, result: iterResult.value };
}

// ═══════════════════════════════════════════
// readTool
// ═══════════════════════════════════════════

describe('readTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock open() 返回假的 file handle（用于 isBinaryFile 检测）
    const mockFileHandle = {
      read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    vi.mocked(open).mockResolvedValue(mockFileHandle as never);
  });

  // --- 元数据 ---

  describe('元数据', () => {
    it('工具名称为 read, 分类为 FileSystem', () => {
      expect(readTool.name).toBe('read');
      expect(readTool.category).toBe(ToolCategory.FileSystem);
      expect(readTool.needUserConfirm).toBe(false);
    });

    it('有必要的参数定义（Zod schema）', () => {
      const jsonSchema = z.toJSONSchema(readTool.parameters) as Record<string, unknown>;
      const props = jsonSchema.properties as Record<string, unknown>;
      expect(props.path).toBeDefined();
      expect(props.offset).toBeDefined();
      expect(props.limit).toBeDefined();
    });

    it('path 是必填参数', () => {
      const jsonSchema = z.toJSONSchema(readTool.parameters) as Record<string, unknown>;
      const required = jsonSchema.required as string[];
      expect(required).toContain('path');
    });
  });

  // --- 正常读取 ---

  describe('正常读取', () => {
    it('读取文件返回带行号的内容', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      vi.mocked(readFile).mockResolvedValue('line1\nline2\nline3');

      const { updates, result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt' }, undefined, tmpContext)
      );

      expect(updates.length).toBeGreaterThan(0);
      expect(updates.some((u) => u.type === 'progress')).toBe(true);

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('1|line1');
      expect(result.llmContent).toContain('2|line2');
      expect(result.llmContent).toContain('3|line3');
      expect(result.metadata?.duration).toBeDefined();
    });

    it('读取空文件', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      vi.mocked(readFile).mockResolvedValue('');

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/empty.txt' }, undefined, tmpContext));

      expect(result.success).toBe(true);
      expect(result.metadata?.totalLines).toBe(1); // '' split by \n → ['']
    });

    it('读取单行文件', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      vi.mocked(readFile).mockResolvedValue('single line without newline');

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/single.txt' }, undefined, tmpContext));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('1|single line without newline');
    });

    it('读取包含中文的文件', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      vi.mocked(readFile).mockResolvedValue('你好世界\n这是测试\n第三行');

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/chinese.txt' }, undefined, tmpContext));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('你好世界');
      expect(result.llmContent).toContain('这是测试');
    });

    it('读取包含特殊字符的文件', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      vi.mocked(readFile).mockResolvedValue('$HOME\n`backtick`\n"quotes"\n\'single\'');

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/special.txt' }, undefined, tmpContext));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('$HOME');
      expect(result.llmContent).toContain('`backtick`');
    });

    it('行号宽度自适应', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      // 创建 100 行的内容
      const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
      vi.mocked(readFile).mockResolvedValue(lines.join('\n'));

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/many_lines.txt' }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      // 第 1 行应该有空格前缀对齐到 3 位宽
      expect(result.llmContent).toContain('  1|line1');
      expect(result.llmContent).toContain('100|line100');
    });
  });

  // --- 分页读取 ---

  describe('分页读取', () => {
    it('支持 offset/limit 分页读取', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('a\nb\nc\nd\ne');

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt', offset: 2, limit: 2 }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('2|b');
      expect(result.llmContent).toContain('3|c');
      expect(result.llmContent).not.toContain('1|a');
      expect(result.llmContent).not.toContain('4|d');
      expect(result.llmContent).toContain('not shown');
    });

    it('offset 超出文件行数返回空内容', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('only one line');

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt', offset: 100 }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.readLines).toBe(0);
    });

    it('offset 为 0 或负数时默认为 1', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('line1\nline2');

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt', offset: 0 }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('1|line1');
    });

    it('limit 为 0 时使用默认值', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('a\nb\nc');

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt', limit: 0 }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      // limit 为 0 → 使用默认 2000，应该能读到所有行
      expect(result.metadata?.readLines).toBe(3);
    });

    it('有前后截断提示', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('a\nb\nc\nd\ne');

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt', offset: 2, limit: 2 }, undefined, tmpContext)
      );

      expect(result.llmContent).toContain('1 lines not shown'); // 开头
      expect(result.llmContent).toContain('2 lines not shown'); // 结尾
    });
  });

  // --- 错误处理 ---

  describe('错误处理', () => {
    it('文件不存在返回 ENOENT', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/nope.txt' }, undefined, tmpContext));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENOENT');
      expect(result.llmContent).toContain('not found');
    });

    it('权限不足返回 EACCES', async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/protected.txt' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EACCES');
      expect(result.llmContent).toContain('Permission denied');
    });

    it('非文件路径返回 NOT_FILE', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => false } as never);

      const { result } = await consumeGenerator(readTool.execute({ path: '/tmp/a_directory' }, undefined, tmpContext));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FILE');
    });

    it('其他读取错误', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 1000 } as never);
      // Mock open().read() 返回文本内容（非二进制），但 readFile 抛出错误
      const mockFileHandle = {
        read: vi.fn().mockResolvedValue({
          bytesRead: 5,
          buffer: Buffer.from('hello')
        }),
        close: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(open).mockResolvedValue(mockFileHandle as never);
      vi.mocked(readFile).mockRejectedValue(new Error('Disk read error'));

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/disk-error.txt' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('READ_ERROR');
      expect(result.llmContent).toContain('Disk read error');
    });
  });

  // --- AbortSignal ---

  describe('AbortSignal 取消', () => {
    it('已取消的信号立即返回 ABORTED', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
      const abortController = new AbortController();
      abortController.abort();

      const { result } = await consumeGenerator(
        readTool.execute({ path: '/tmp/test.txt' }, abortController.signal, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ABORTED');
    });
  });

  // --- 流式输出 ---

  describe('流式输出', () => {
    it('至少有 progress 和 output 类型的更新', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('content');

      const { updates } = await consumeGenerator(readTool.execute({ path: '/tmp/test.txt' }, undefined, tmpContext));

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
      expect(updates.some((u) => u.type === 'output')).toBe(true);
    });

    it('progress 更新包含百分比', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100 } as never);
      vi.mocked(readFile).mockResolvedValue('content');

      const { updates } = await consumeGenerator(readTool.execute({ path: '/tmp/test.txt' }, undefined, tmpContext));

      const progresses = updates.filter((u) => u.type === 'progress');
      expect(progresses.some((u) => u.percentage !== undefined)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════
// writeTool
// ═══════════════════════════════════════════

describe('writeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 元数据 ---

  describe('元数据', () => {
    it('工具名称为 write, 需要用户确认', () => {
      expect(writeTool.name).toBe('write');
      expect(writeTool.category).toBe(ToolCategory.FileSystem);
      expect(writeTool.needUserConfirm).toBe(true);
    });

    it('path 和 content 是必填参数', () => {
      const jsonSchema = z.toJSONSchema(writeTool.parameters) as Record<string, unknown>;
      const required = jsonSchema.required as string[];
      expect(required).toContain('path');
      expect(required).toContain('content');
    });
  });

  // --- 正常写入 ---

  describe('正常写入', () => {
    it('写入文件成功返回统计信息', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { updates, result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/out.txt', content: 'hello\nworld' }, undefined, tmpContext)
      );

      expect(updates.length).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Successfully wrote');
      expect(result.llmContent).toContain('2 lines');
      expect(result.metadata?.byteSize).toBeDefined();
      expect(result.metadata?.lineCount).toBe(2);

      expect(mkdir).toHaveBeenCalledWith(resolve('/tmp'), { recursive: true });
      expect(writeFile).toHaveBeenCalled();
    });

    it('写入空内容', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/empty.txt', content: '' }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.byteSize).toBe(0);
      expect(result.metadata?.lineCount).toBe(1); // '' has 1 line
    });

    it('写入中文内容', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const content = '你好世界\n这是一个测试';
      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/chinese.txt', content }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.byteSize).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('写入大量内容', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}: content here`);
      const content = lines.join('\n');
      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/big.txt', content }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.lineCount).toBe(1000);
    });

    it('创建嵌套目录', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await consumeGenerator(
        writeTool.execute({ path: '/tmp/deep/nested/dir/file.txt', content: 'test' }, undefined, tmpContext)
      );

      expect(mkdir).toHaveBeenCalledWith(resolve('/tmp/deep/nested/dir'), { recursive: true });
    });
  });

  // --- 参数校验 ---

  describe('参数校验', () => {
    it('content 非字符串返回错误', async () => {
      const { result } = await consumeGenerator(writeTool.execute({ path: '/tmp/out.txt', content: 123 }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });

    it('content 为 null 返回错误', async () => {
      const { result } = await consumeGenerator(writeTool.execute({ path: '/tmp/out.txt', content: null }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });

    it('content 为 undefined 返回错误', async () => {
      const { result } = await consumeGenerator(writeTool.execute({ path: '/tmp/out.txt', content: undefined }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });

    it('content 为对象返回错误', async () => {
      const { result } = await consumeGenerator(writeTool.execute({ path: '/tmp/out.txt', content: { key: 'value' } }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });
  });

  // --- 错误处理 ---

  describe('错误处理', () => {
    it('权限不足返回 EACCES', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockRejectedValue(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));

      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/protected.txt', content: 'test' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EACCES');
    });

    it('其他写入错误', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockRejectedValue(new Error('Disk full'));

      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/disk-full.txt', content: 'test' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WRITE_ERROR');
      expect(result.llmContent).toContain('Disk full');
    });

    it('mkdir 失败传递错误', async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error('mkdir failed'));

      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/no-dir/file.txt', content: 'test' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('mkdir failed');
    });
  });

  // --- AbortSignal ---

  describe('AbortSignal 取消', () => {
    it('已取消的信号返回 ABORTED', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const { result } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/test.txt', content: 'test' }, abortController.signal, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ABORTED');
    });
  });

  // --- 流式输出 ---

  describe('流式输出', () => {
    it('包含 progress 和 output 更新', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { updates } = await consumeGenerator(
        writeTool.execute({ path: '/tmp/out.txt', content: 'hello' }, undefined, tmpContext)
      );

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
      expect(updates.some((u) => u.type === 'output')).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════
// editTool
// ═══════════════════════════════════════════

describe('editTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 元数据 ---

  describe('元数据', () => {
    it('工具名称为 edit, 需要用户确认', () => {
      expect(editTool.name).toBe('edit');
      expect(editTool.category).toBe(ToolCategory.FileSystem);
      expect(editTool.needUserConfirm).toBe(true);
    });

    it('path, oldText, newText 是必填参数', () => {
      const jsonSchema = z.toJSONSchema(editTool.parameters) as Record<string, unknown>;
      const required = jsonSchema.required as string[];
      expect(required).toContain('path');
      expect(required).toContain('oldText');
      expect(required).toContain('newText');
    });
  });

  // --- 正常编辑 ---

  describe('正常编辑', () => {
    it('精确替换唯一匹配的文本', async () => {
      vi.mocked(readFile).mockResolvedValue('const a = 1;\nconst b = 2;\nconst c = 3;\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { updates, result } = await consumeGenerator(
        editTool.execute(
          { path: '/tmp/code.ts', oldText: 'const b = 2;', newText: 'const b = 42;' },
          undefined,
          tmpContext
        )
      );

      expect(updates.length).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Replaced');
      expect(result.metadata?.lineDiff).toBe(0);

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toContain('const b = 42;');
      expect(writtenContent).toContain('const a = 1;');
    });

    it('多行替换', async () => {
      vi.mocked(readFile).mockResolvedValue('line1\nline2\nline3\nline4\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        editTool.execute(
          {
            path: '/tmp/multi.txt',
            oldText: 'line2\nline3',
            newText: 'newline2\nnewline3\nnewline3b'
          },
          undefined,
          tmpContext
        )
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.lineDiff).toBe(1); // 2行 → 3行

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toContain('newline2\nnewline3\nnewline3b');
    });

    it('替换为空字符串（删除文本）', async () => {
      vi.mocked(readFile).mockResolvedValue('before\nTODO: remove this line\nafter\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        editTool.execute(
          {
            path: '/tmp/del.txt',
            oldText: '\nTODO: remove this line',
            newText: ''
          },
          undefined,
          tmpContext
        )
      );

      expect(result.success).toBe(true);
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toBe('before\nafter\n');
    });

    it('替换包含特殊正则字符的文本', async () => {
      vi.mocked(readFile).mockResolvedValue('price is $100.00 (USD)');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        editTool.execute(
          {
            path: '/tmp/regex.txt',
            oldText: '$100.00 (USD)',
            newText: '$200.00 (EUR)'
          },
          undefined,
          tmpContext
        )
      );

      expect(result.success).toBe(true);
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toBe('price is $200.00 (EUR)');
    });

    it('替换包含中文的文本', async () => {
      vi.mocked(readFile).mockResolvedValue('这是旧的内容');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/cn.txt', oldText: '旧的', newText: '新的' }, undefined, tmpContext)
      );

      expect(result.success).toBe(true);
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toBe('这是新的内容');
    });

    it('替换包含缩进空白的文本（保持空白敏感）', async () => {
      const content = '  function foo() {\n    return 1;\n  }';
      vi.mocked(readFile).mockResolvedValue(content);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { result } = await consumeGenerator(
        editTool.execute(
          {
            path: '/tmp/indent.ts',
            oldText: '    return 1;',
            newText: '    return 2;'
          },
          undefined,
          tmpContext
        )
      );

      expect(result.success).toBe(true);
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(writtenContent).toContain('    return 2;');
    });
  });

  // --- 参数校验和错误处理 ---

  describe('参数校验', () => {
    it('oldText 未找到返回 NOT_FOUND', async () => {
      vi.mocked(readFile).mockResolvedValue('hello world');

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/code.ts', oldText: 'not here', newText: 'replacement' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('oldText 未找到但 trim 后能找到给出提示', async () => {
      vi.mocked(readFile).mockResolvedValue('  hello world  ');

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/code.ts', oldText: '  hello world  \n', newText: 'new' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.llmContent).toContain('whitespace');
    });

    it('多次匹配返回 MULTIPLE_MATCHES', async () => {
      vi.mocked(readFile).mockResolvedValue('aaa bbb aaa');

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/code.ts', oldText: 'aaa', newText: 'ccc' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MULTIPLE_MATCHES');
      expect(result.error?.details).toEqual({ occurrences: 2 });
    });

    it('oldText === newText 返回 IDENTICAL', async () => {
      const { result } = await consumeGenerator(
        editTool.execute({
          path: '/tmp/code.ts',
          oldText: 'same',
          newText: 'same'
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('IDENTICAL');
    });

    it('文件不存在返回 ENOENT', async () => {
      vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/nope.ts', oldText: 'old', newText: 'new' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENOENT');
    });

    it('权限不足返回 EACCES', async () => {
      vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const { result } = await consumeGenerator(
        editTool.execute({ path: '/tmp/prot.ts', oldText: 'old', newText: 'new' }, undefined, tmpContext)
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EACCES');
    });
  });

  // --- 流式输出 ---

  describe('流式输出', () => {
    it('编辑过程有 progress 和 output 更新', async () => {
      vi.mocked(readFile).mockResolvedValue('old text here');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const { updates } = await consumeGenerator(
        editTool.execute({ path: '/tmp/s.ts', oldText: 'old text', newText: 'new text' }, undefined, tmpContext)
      );

      expect(updates.some((u) => u.type === 'progress')).toBe(true);
      expect(updates.some((u) => u.type === 'output')).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════
// execTool
// ═══════════════════════════════════════════

describe('execTool', () => {
  // --- 元数据 ---

  describe('元数据', () => {
    it('工具名称为 exec, 分类为 Execute, 需要用户确认', () => {
      expect(execTool.name).toBe('exec');
      expect(execTool.category).toBe(ToolCategory.Execute);
      expect(execTool.needUserConfirm).toBe(true);
    });

    it('command 是必填参数', () => {
      const jsonSchema = z.toJSONSchema(execTool.parameters) as Record<string, unknown>;
      const required = jsonSchema.required as string[];
      expect(required).toContain('command');
    });
  });

  // --- 正常执行 ---

  describe('正常执行', () => {
    it('执行简单命令返回输出', async () => {
      const { updates, result } = await consumeGenerator(execTool.execute({ command: 'echo hello' }));

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].content).toContain('echo hello');
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Exit code: 0');
      expect(result.llmContent).toContain('hello');
      expect(result.metadata?.exitCode).toBe(0);
      expect(result.metadata?.duration).toBeDefined();
    });

    it('执行多行命令', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'echo line1 && echo line2' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('line1');
      expect(result.llmContent).toContain('line2');
    });

    it('执行数学计算命令', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'echo $((2 + 3))' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('5');
    });

    it('使用安全的环境变量', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'echo $HOME' }));

      expect(result.success).toBe(true);
      // HOME 环境变量应该被传递
      expect(result.llmContent).toBeDefined();
    });
  });

  // --- 命令失败 ---

  describe('命令失败', () => {
    it('命令失败返回非零 exit code', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'exit 42' }));

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('Exit code: 42');
      expect(result.error?.code).toBe('EXIT_CODE');
      expect(result.metadata?.exitCode).toBe(42);
    });

    it('不存在的命令', async () => {
      const { result } = await consumeGenerator(
        execTool.execute({ command: 'this_command_definitely_does_not_exist_xyz123' })
      );

      expect(result.success).toBe(false);
      expect(result.metadata?.exitCode).not.toBe(0);
    });
  });

  // --- stderr ---

  describe('stderr 捕获', () => {
    it('捕获 stderr 输出', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'echo err >&2' }));

      expect(result.llmContent).toContain('stderr:');
      expect(result.llmContent).toContain('err');
    });

    it('同时有 stdout 和 stderr', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'echo out && echo err >&2' }));

      expect(result.llmContent).toContain('stdout:');
      expect(result.llmContent).toContain('out');
      expect(result.llmContent).toContain('stderr:');
      expect(result.llmContent).toContain('err');
    });
  });

  // --- 参数校验 ---

  describe('参数校验', () => {
    it('空命令返回 INVALID_PARAM', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: '' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });

    it('非字符串命令返回 INVALID_PARAM', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 123 }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });

    it('null 命令返回 INVALID_PARAM', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: null }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAM');
    });
  });

  // --- 超时 ---

  describe('超时处理', () => {
    it('自定义短超时触发 TIMEOUT', async () => {
      const { result } = await consumeGenerator(
        // sleep 10 秒，但超时 200ms
        execTool.execute({ command: 'sleep 10', timeout: 200 })
      );

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('Timed out');
      expect(result.metadata?.timedOut).toBe(true);
    }, 10_000);
  });

  // --- 工作目录 ---

  describe('工作目录', () => {
    it('使用 context 的 workspaceRoot 作为 cwd', async () => {
      const ctx = createFallbackToolContext({ workspaceRoot: '/tmp' });
      const { result } = await consumeGenerator(execTool.execute({ command: 'pwd' }, undefined, ctx));

      expect(result.success).toBe(true);
      // macOS 下 /tmp 可能解析为 /private/tmp
      expect(result.llmContent).toMatch(/\/tmp|\/private\/tmp/);
      expect(result.metadata?.cwd).toMatch(/\/tmp/);
    });

    it('无 context 时使用 process.cwd()', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'pwd' }));

      expect(result.success).toBe(true);
      expect(result.metadata?.cwd).toBe(process.cwd());
    });
  });

  // --- 流式输出 ---

  describe('流式输出', () => {
    it('第一个 yield 包含命令回显', async () => {
      const { updates } = await consumeGenerator(execTool.execute({ command: 'echo test' }));

      expect(updates[0].type).toBe('progress');
      expect(updates[0].content).toContain('echo test');
    });

    it('最后一个 yield 包含执行结果摘要', async () => {
      const { updates } = await consumeGenerator(execTool.execute({ command: 'echo test' }));

      const lastUpdate = updates[updates.length - 1];
      expect(lastUpdate.type).toBe('output');
      expect(lastUpdate.content).toContain('completed');
    });
  });

  // --- stdout/stderr 截断 ---

  describe('stdout/stderr 截断', () => {
    it('超大输出时 llmContent 包含 truncated', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'python3 -c "print(\'x\' * 200000)"' }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('truncated');
    });
  });

  // --- 后台模式 ---

  describe('后台模式', () => {
    afterEach(() => {
      ProcessRegistry.resetInstance();
    });

    it('background=true 时立即返回 processId', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'sleep 100', background: true }));

      expect(result.success).toBe(true);
      expect(result.metadata?.processId).toBeDefined();
      expect(result.metadata?.processId).toMatch(/^proc-/);
      expect(result.metadata?.background).toBe(true);
      expect(result.metadata?.pid).toBeDefined();
    });

    it('返回的 llmContent 包含 process 工具使用说明', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'sleep 100', background: true }));

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('processId');
      expect(result.llmContent).toContain('process');
      expect(result.llmContent).toContain('read_output');
      expect(result.llmContent).toContain('kill');
    });

    it('yield 的 progress 包含 [background]', async () => {
      const { updates } = await consumeGenerator(execTool.execute({ command: 'sleep 100', background: true }));

      const progressUpdate = updates.find((u) => u.type === 'progress');
      expect(progressUpdate).toBeDefined();
      expect(progressUpdate!.content).toContain('[background]');
    });

    it('yield 的 output 包含 Background process started', async () => {
      const { updates } = await consumeGenerator(execTool.execute({ command: 'sleep 100', background: true }));

      const outputUpdate = updates.find((u) => u.type === 'output');
      expect(outputUpdate).toBeDefined();
      expect(outputUpdate!.content).toContain('Background process started');
    });

    it('后台进程可通过 ProcessRegistry 管理', async () => {
      const { result } = await consumeGenerator(execTool.execute({ command: 'sleep 100', background: true }));

      expect(result.success).toBe(true);
      const processId = result.metadata?.processId as string;
      const proc = ProcessRegistry.getInstance().get(processId);
      expect(proc).toBeDefined();
      expect(proc!.status).toBe('running');
    });

    it('前台模式不受 background 参数影响（background=false/undefined）', async () => {
      const { result: r1 } = await consumeGenerator(execTool.execute({ command: 'echo hello' }));
      const { result: r2 } = await consumeGenerator(execTool.execute({ command: 'echo hello', background: false }));

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.metadata?.background).toBeUndefined();
      expect(r2.metadata?.background).toBeUndefined();
      expect(r1.llmContent).toContain('hello');
      expect(r2.llmContent).toContain('hello');
    });
  });
});

// ═══════════════════════════════════════════
// builtinTools 集合
// ═══════════════════════════════════════════

describe('builtinTools 集合', () => {
  it('包含 12 个内置工具（5 个工具已迁移到 Skill）', () => {
    expect(builtinTools).toHaveLength(12);
  });

  it('按正确顺序包含所有工具', () => {
    const names = builtinTools.map((t) => t.name);
    expect(names).toEqual([
      'read',
      'write',
      'edit',
      'exec',
      'process',
      'memory',
      'search',
      'glob',
      // session_status, session_history, context_inspect 已迁移到 observability Skill
      'skill_list',
      // config_get, config_patch 已迁移到 config-manager Skill
      // manage_agent, manage_skill 已移除
      'delegate_to_agent',
      'task_plan',
      'todo_write'
    ]);
  });

  it('所有工具都符合 ToolDefinition 接口', () => {
    for (const t of builtinTools) {
      expect(t.name).toBeDefined();
      expect(typeof t.name).toBe('string');
      expect(t.description).toBeDefined();
      expect(typeof t.description).toBe('string');
      expect(t.category).toBeDefined();
      expect(t.parameters).toBeDefined();
      expect(typeof t.execute).toBe('function');
    }
  });

  it('每个工具的 execute 返回 AsyncGenerator', async () => {
    for (const t of builtinTools) {
      const gen = t.execute({ path: '__nonexistent__', command: 'true' });
      expect(gen[Symbol.asyncIterator]).toBeDefined();
      await gen.return({ success: false } as ToolResult);
    }
  });

  it('文件工具不需要确认（read）或需要确认（write, edit）', () => {
    const readT = builtinTools.find((t) => t.name === 'read')!;
    const writeT = builtinTools.find((t) => t.name === 'write')!;
    const editT = builtinTools.find((t) => t.name === 'edit')!;

    expect(readT.needUserConfirm).toBe(false);
    expect(writeT.needUserConfirm).toBe(true);
    expect(editT.needUserConfirm).toBe(true);
  });

  it('exec 工具需要用户确认', () => {
    const exec = builtinTools.find((t) => t.name === 'exec')!;
    expect(exec.needUserConfirm).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 沙箱路径守卫 + 文件工具集成
// ═══════════════════════════════════════════

describe('resolveSandboxPath', () => {
  it('相对路径基于 workspaceRoot 解析', () => {
    const result = resolveSandboxPath('src/index.ts', { workspaceRoot: '/home/user/project' });
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(resolve('/home/user/project', 'src/index.ts'));
  });

  it('绝对路径在 workspaceRoot 内允许', () => {
    const result = resolveSandboxPath('/home/user/project/src/index.ts', {
      workspaceRoot: '/home/user/project'
    });
    expect(result.error).toBeUndefined();
    expect(result.path).toBe('/home/user/project/src/index.ts');
  });

  it('路径穿越（../）被拒绝', () => {
    const result = resolveSandboxPath('../../../etc/passwd', {
      workspaceRoot: '/home/user/project'
    });
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('SANDBOX_VIOLATION');
  });

  it('绝对路径超出 workspaceRoot 被拒绝', () => {
    const result = resolveSandboxPath('/etc/passwd', {
      workspaceRoot: '/home/user/project'
    });
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('SANDBOX_VIOLATION');
  });

  it('sandboxRoot 优先于 workspaceRoot', () => {
    const result = resolveSandboxPath('../package.json', {
      workspaceRoot: '/home/user/project',
      sandboxRoot: '/home/user/project/src'
    });
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('SANDBOX_VIOLATION');
  });

  it('sandboxRoot 内的路径允许', () => {
    const result = resolveSandboxPath('index.ts', {
      workspaceRoot: '/home/user/project',
      sandboxRoot: '/home/user/project/src'
    });
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(resolve('/home/user/project/src', 'index.ts'));
  });

  it('没有 context 时降级为 process.cwd()', () => {
    const result = resolveSandboxPath('test.txt');
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(resolve(process.cwd(), 'test.txt'));
  });
});

describe('文件工具沙箱集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sandboxContext = createFallbackToolContext({ workspaceRoot: '/home/user/project' });

  it('readTool 读操作不受沙箱限制（readOnly=true），可读取 workspace 外路径', async () => {
    const { result } = await consumeGenerator(readTool.execute({ path: '/etc/passwd' }, undefined, sandboxContext));
    expect(result.success).toBe(true);
  });

  it('writeTool 拒绝越界路径', async () => {
    const { result } = await consumeGenerator(
      writeTool.execute({ path: '/tmp/hack.txt', content: 'bad' }, undefined, sandboxContext)
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_VIOLATION');
  });

  it('editTool 拒绝越界路径', async () => {
    const { result } = await consumeGenerator(
      editTool.execute({ path: '../../../etc/hosts', oldText: 'old', newText: 'new' }, undefined, sandboxContext)
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_VIOLATION');
  });

  it('readTool 路径穿越不受限（readOnly=true），可读取穿越路径', async () => {
    const { result } = await consumeGenerator(
      readTool.execute({ path: 'src/../../etc/passwd' }, undefined, sandboxContext)
    );
    expect(result.success).toBe(true);
  });

  it('writeTool 拒绝绝对路径越界', async () => {
    const { result } = await consumeGenerator(
      writeTool.execute({ path: '/root/.ssh/authorized_keys', content: 'bad' }, undefined, sandboxContext)
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_VIOLATION');
  });

  it('sandboxRoot 对写操作生效（writeTool 拒绝 sandboxRoot 外路径）', async () => {
    const strictContext = {
      ...createFallbackToolContext({ workspaceRoot: '/home/user/project' }),
      sandboxRoot: '/home/user/project/src'
    };

    const { result } = await consumeGenerator(
      writeTool.execute({ path: '../package.json', content: 'hack' }, undefined, strictContext)
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_VIOLATION');
  });

  it('允许 sandbox 内的正常操作', async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue('content');

    const { result } = await consumeGenerator(readTool.execute({ path: 'src/index.ts' }, undefined, sandboxContext));
    expect(result.success).toBe(true);
  });
});
