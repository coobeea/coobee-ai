/**
 * LifecycleOrchestrator - 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LifecycleOrchestrator } from '../LifecycleOrchestrator';
import type { Task } from '../../TavernStore';

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  }
}));

vi.mock('@main/common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn()
  }
}));

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    submitViaPipeline: vi.fn().mockResolvedValue({ status: 'executing', sessionId: 'test-session' }),
    createBuilderFromFactory: vi.fn(),
    submit: vi.fn()
  }
}));

describe('LifecycleOrchestrator', () => {
  let tempDir: string;
  let orchestrator: LifecycleOrchestrator;
  let mockTask: Task;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(__dirname, 'test-lifecycle-'));

    orchestrator = new LifecycleOrchestrator();

    // Mock task
    mockTask = {
      id: 'test-task-123',
      title: '测试任务',
      description: '这是一个测试任务描述',
      amount: 50,
      files: ['src/test.ts'],
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Mock Env.getAgentWorkspaceDir
    const { Env } = await import('@main/common/env');
    vi.mocked(Env.getAgentWorkspaceDir).mockResolvedValue(tempDir);
  });

  afterEach(async () => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('createLifecycleDir', () => {
    it('should create lifecycle directory', async () => {
      // 通过 execute() 间接测试（因为 createLifecycleDir 是 private）
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(mockTask, 'session-123');

      const lifecycleDir = path.join(tempDir, 'lifecycle');
      expect(fs.existsSync(lifecycleDir)).toBe(true);
    });

    it('should verify directory is writable', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(mockTask, 'session-123');

      const lifecycleDir = path.join(tempDir, 'lifecycle');
      const testFile = path.join(lifecycleDir, 'test-write.txt');

      // 验证可以写入
      await fs.promises.writeFile(testFile, 'test', 'utf-8');
      expect(fs.existsSync(testFile)).toBe(true);
      await fs.promises.unlink(testFile);
    });
  });

  describe('isComplexTask', () => {
    it('should identify simple task', async () => {
      const simpleTask: Task = {
        ...mockTask,
        description: '简单任务', // < 200 字符
        files: ['test.ts'], // 1 个文件
        amount: 10 // 低金额
      };

      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(simpleTask, 'session-123');

      // 检查生成的 Prompt 是否包含"快速模式"
      expect(agentExecutor.submitViaPipeline).toHaveBeenCalled();
      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];
      expect(message).toContain('快速模式');
    });

    it('should identify complex task (long description)', async () => {
      const complexTask: Task = {
        ...mockTask,
        description: '这是一个非常复杂的任务'.repeat(20), // > 200 字符
        files: ['test.ts'],
        amount: 10
      };

      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(complexTask, 'session-123');

      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];
      expect(message).toContain('五阶段流程');
    });

    it('should identify complex task (multiple files)', async () => {
      const complexTask: Task = {
        ...mockTask,
        description: '简单描述',
        files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'], // 4 个文件
        amount: 10
      };

      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(complexTask, 'session-123');

      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];
      expect(message).toContain('五阶段流程');
    });

    it('should identify complex task (keywords)', async () => {
      const complexTask: Task = {
        ...mockTask,
        description: '重构系统架构，优化性能', // 包含关键词
        files: ['test.ts'],
        amount: 10
      };

      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(complexTask, 'session-123');

      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];
      expect(message).toContain('五阶段流程');
    });

    it('should identify complex task (high amount)', async () => {
      const complexTask: Task = {
        ...mockTask,
        description: '简单任务',
        files: ['test.ts'],
        amount: 150 // > 100
      };

      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(complexTask, 'session-123');

      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];
      expect(message).toContain('五阶段流程');
    });
  });

  describe('execute', () => {
    it('should generate 8 template files', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(mockTask, 'session-123');

      const lifecycleDir = path.join(tempDir, 'lifecycle');
      const files = await fs.promises.readdir(lifecycleDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      expect(mdFiles).toContain('01-需求分析.md');
      expect(mdFiles).toContain('02-方案设计.md');
      expect(mdFiles).toContain('03-反思优化.md');
      expect(mdFiles).toContain('04-TODO.md');
      expect(mdFiles).toContain('05-PROGRESS.md');
      expect(mdFiles).toContain('06-BUGS.md');
      expect(mdFiles).toContain('07-验收报告.md');
      expect(mdFiles).toContain('08-综合报告.md');
    });

    it('should generate prompt with task info', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(mockTask, 'session-123');

      expect(agentExecutor.submitViaPipeline).toHaveBeenCalled();
      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];

      expect(message).toContain(mockTask.title);
      expect(message).toContain(mockTask.description);
      expect(message).toContain('lifecycle');
    });

    it('should submit to AgentExecutor', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      await orchestrator.execute(mockTask, 'session-123');

      expect(agentExecutor.submitViaPipeline).toHaveBeenCalledWith('session-123', expect.any(String), 'agent');
    });

    it('should handle pipeline not ready', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockRejectedValue(new Error('Pipeline not ready'));
      vi.mocked(agentExecutor.createBuilderFromFactory).mockReturnValue({ type: 'agent' } as never);

      await orchestrator.execute(mockTask, 'session-123');

      expect(agentExecutor.submit).toHaveBeenCalled();
    });

    it('should throw error if neither pipeline nor builder available', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockRejectedValue(new Error('Pipeline not ready'));
      vi.mocked(agentExecutor.createBuilderFromFactory).mockReturnValue(null);

      await expect(orchestrator.execute(mockTask, 'session-123')).rejects.toThrow(
        'Neither Pipeline nor BuilderFactory is available'
      );
    });
  });

  describe('getTaskConfig', () => {
    it('should return default config if task has no config', () => {
      const config = orchestrator.getTaskConfig(mockTask);

      expect(config.useLifecycle).toBe(false);
      expect(config.autoSelectSolution).toBe(true);
      expect(config.requireDocumentation).toBe(true);
      expect(config.stageTimeout).toBe(10 * 60 * 1000);
      expect(config.awaitingInputTimeout).toBe(24 * 60 * 60 * 1000);
    });

    it('should merge custom config with defaults', () => {
      const taskWithConfig: Task = {
        ...mockTask,
        config: {
          useLifecycle: true,
          autoSelectSolution: false
        }
      };

      const config = orchestrator.getTaskConfig(taskWithConfig);

      expect(config.useLifecycle).toBe(true);
      expect(config.autoSelectSolution).toBe(false);
      expect(config.requireDocumentation).toBe(true); // 默认值
    });
  });

  describe('recover', () => {
    it('should detect completed stages and build recovery prompt', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      // 创建 lifecycle 目录和部分文档（模拟已完成阶段一）
      const lifecycleDir = path.join(tempDir, 'lifecycle');
      await fs.promises.mkdir(lifecycleDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(lifecycleDir, '01-需求分析.md'),
        '# 需求分析\n\n## 需求背景\n\n这是一个完整的需求分析文档，内容长度超过 500 字符。' + '内容填充'.repeat(100),
        'utf-8'
      );

      const taskWithThread: Task = {
        ...mockTask,
        threadId: 'session-123',
        config: { useLifecycle: true }
      };

      await orchestrator.recover(taskWithThread, 'session-123');

      expect(agentExecutor.submitViaPipeline).toHaveBeenCalled();
      const message = vi.mocked(agentExecutor.submitViaPipeline).mock.calls[0][1];

      expect(message).toContain('任务恢复');
      expect(message).toContain('需求分析');
      expect(message).toContain('方案设计'); // 下一阶段
    });

    it('should skip recovery if task already completed', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      vi.mocked(agentExecutor.submitViaPipeline).mockResolvedValue({
        status: 'executing',
        sessionId: 'test-session'
      });

      // 创建所有阶段的完整文档
      const lifecycleDir = path.join(tempDir, 'lifecycle');
      await fs.promises.mkdir(lifecycleDir, { recursive: true });

      const files = ['01-需求分析.md', '02-方案设计.md', '03-反思优化.md', '04-TODO.md', '07-验收报告.md'];

      for (const file of files) {
        await fs.promises.writeFile(path.join(lifecycleDir, file), `# ${file}\n\n完整内容`.repeat(50), 'utf-8');
      }

      const taskWithThread: Task = {
        ...mockTask,
        threadId: 'session-123',
        config: { useLifecycle: true }
      };

      await orchestrator.recover(taskWithThread, 'session-123');

      // 不应调用 submitViaPipeline（任务已完成）
      expect(agentExecutor.submitViaPipeline).not.toHaveBeenCalled();
    });
  });
});
