/**
 * memory-thread Extension 单元测试
 *
 * 测试线程级记忆注入（before_agent_start）和信号检测/摘要（agent_end）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_BASE = path.join(os.tmpdir(), `memory-thread-test-${process.pid}`);
const WORKSPACE = path.join(TEST_BASE, 'workspace');

vi.mock('../../../src/main/common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn(async () => WORKSPACE)
  }
}));

vi.mock('../../../src/main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
}));

type HookHandler = (...args: unknown[]) => unknown;

// 从 extension 文件中提取纯函数进行测试
// 由于 extension 以 default export 形式注册钩子，直接测试钩子逻辑较复杂
// 改用直接测试文件写入结果

function ensureDirs(): void {
  fs.mkdirSync(path.join(WORKSPACE, 'memory'), { recursive: true });
}

function cleanup(): void {
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true });
  }
}

describe('memory-thread Extension', () => {
  beforeEach(() => {
    cleanup();
    ensureDirs();
  });

  afterEach(() => {
    cleanup();
  });

  describe('before_agent_start: 记忆注入', () => {
    it('MEMORY.md 存在时读取并注入 core_memory', async () => {
      fs.writeFileSync(path.join(WORKSPACE, 'MEMORY.md'), '# Core\n\nUser prefers TypeScript.');

      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      expect(hooks['before_agent_start']).toBeDefined();
      const handler = hooks['before_agent_start'][0];

      const result = (await handler({
        sessionId: 'test-session',
        prompt: 'Help me with TypeScript config'
      })) as { prependContext?: string } | undefined;

      expect(result).toBeDefined();
      expect(result!.prependContext).toContain('<core_memory>');
      expect(result!.prependContext).toContain('User prefers TypeScript');
    });

    it('无 MEMORY.md 且无 memory/ 文件时不注入', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['before_agent_start'][0];
      const result = await handler({
        sessionId: 'test-session',
        prompt: 'Hello'
      });

      expect(result).toBeUndefined();
    });

    it('memory/ 有匹配关键词的文件时注入 recalled_memories', async () => {
      fs.writeFileSync(
        path.join(WORKSPACE, 'memory', 'lessons.md'),
        '# Lessons\n\n- TypeScript 配置需要 strict mode\n- Tailwind CSS 使用 v4 语法'
      );

      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['before_agent_start'][0];
      const result = (await handler({
        sessionId: 'test-session',
        prompt: 'How to configure TypeScript strict mode?'
      })) as { prependContext?: string } | undefined;

      expect(result).toBeDefined();
      expect(result!.prependContext).toContain('<recalled_memories>');
      expect(result!.prependContext).toContain('lessons.md');
    });
  });

  describe('agent_end: 信号词检测', () => {
    it('输出包含"记住"时自动写入 memory/{date}.md', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '好的，我记住了用户偏好使用 TypeScript 和 Tailwind CSS 进行开发。',
        durationMs: 1000
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(true);

      const content = fs.readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('Memory');
      expect(content).toContain('explicit');
    });

    it('输出包含"经验"时触发 lesson 类型记忆', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '这次的经验总结：在修改 Worker 配置时需要先停止进程再重启。',
        durationMs: 2000
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(true);
      const content = fs.readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('lesson');
    });

    it('输出包含"架构"时触发 knowledge 类型记忆', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '系统架构采用 Electron + Vue 3 前后端分离的设计，通过 Gateway WebSocket 进行通信。',
        durationMs: 1500
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(true);
      const content = fs.readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('knowledge');
    });

    it('输出包含"fix"时触发 lesson 类型记忆', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: 'I managed to fix the timeout issue by increasing the connection pool size to 20.',
        durationMs: 3000
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(true);
      const content = fs.readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('lesson');
    });

    it('较长输出无信号词时自动提取摘要', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      const longOutput =
        '完成了数据导入任务。共处理了 1500 条记录，其中 1480 条成功导入，20 条因格式不正确被跳过。' +
        '导入过程耗时约 3 分钟，整体性能良好。后续可以考虑添加格式自动修正功能来处理那些被跳过的记录。' +
        '此外还更新了相关的日志输出，现在可以在控制台看到详细的导入进度。' +
        '数据库连接池大小已从默认的 5 调整到 20，有效减少了并发写入时的等待时间。' +
        '日志格式统一为 JSON 结构化输出，便于后续接入 ELK 等日志分析平台进行监控和告警。';

      await handler({
        sessionId: 'test-session',
        success: true,
        output: longOutput,
        durationMs: 5000
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(true);
      const content = fs.readFileSync(memoryFile, 'utf-8');
      expect(content).toContain('summary');
    });

    it('短输出不产生记忆', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '好的。',
        durationMs: 500
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(false);
    });

    it('空输出不产生记忆', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '',
        durationMs: 100
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(false);
    });

    it('多次写入追加到同一文件', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];

      await handler({
        sessionId: 'test-session',
        success: true,
        output: '记住用户偏好使用 Vue 3 Composition API。',
        durationMs: 1000
      });

      await handler({
        sessionId: 'test-session',
        success: true,
        output: '发现了一个重要的经验教训：Worker 需要在配置变更后重启。',
        durationMs: 2000
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      const content = fs.readFileSync(memoryFile, 'utf-8');

      expect(content).toContain('explicit');
      expect(content).toContain('lesson');
      // 文件头只出现一次
      expect(content.split('# Memory').length).toBe(2);
    });

    it('代码块内容不触发信号词匹配', async () => {
      const ext = (await import('../index')).default;
      const hooks: Record<string, HookHandler[]> = {};
      const api = {
        on: (name: string, handler: HookHandler) => {
          hooks[name] = hooks[name] || [];
          hooks[name].push(handler);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      };
      ext.register(api as never);

      const handler = hooks['agent_end'][0];
      await handler({
        sessionId: 'test-session',
        success: true,
        output: '```typescript\n// remember to always use strict mode\nconst x = 1;\n```',
        durationMs: 500
      });

      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(WORKSPACE, 'memory', `${today}.md`);
      expect(fs.existsSync(memoryFile)).toBe(false);
    });
  });
});
