import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { OrchestrationLifecycleManager } from '../lifecycle/OrchestrationLifecycleManager';
import { OrchestrationLifecycleMonitor } from '../lifecycle/OrchestrationLifecycleMonitor';
import type { Task, SubTaskExecutionResult } from '../types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock('@main/common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn(async (_id: string) => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'test-workspace-'));
      return tmpDir;
    }),
    paths: {
      userHome: tmpdir()
    }
  }
}));

describe('OrchestrationLifecycleManager', () => {
  let tempDir: string;
  let manager: OrchestrationLifecycleManager;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lifecycle-test-'));
    manager = new OrchestrationLifecycleManager();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  const createMockTask = (objective: string): Task => ({
    id: 'test-task-1',
    objective,
    context: {}
  });

  describe('初始化生命周期', () => {
    it('应为复杂任务创建完整模式的 8 个文档', async () => {
      const task = createMockTask('重构用户认证系统，实现多因素认证和会话管理，确保安全性和可扩展性');
      const lifecycleDir = await manager.initialize(task, 'test-session-1');

      // 验证目录创建
      const stats = await fs.stat(lifecycleDir);
      expect(stats.isDirectory()).toBe(true);

      // 验证 8 个文档都已生成
      const expectedFiles = [
        '01-需求分析.md',
        '02-方案设计.md',
        '03-反思优化.md',
        '04-TODO.md',
        '05-PROGRESS.md',
        '06-BUGS.md',
        '07-验收报告.md',
        '08-综合报告.md',
        'README.md'
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(lifecycleDir, file);
        const exists = await fs
          .stat(filePath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `File ${file} should exist`).toBe(true);

        // 验证文件有内容
        const content = await fs.readFile(filePath, 'utf-8');
        expect(content.length, `File ${file} should have content`).toBeGreaterThan(100);
      }
    });

    it('应为简单任务创建快速模式的 3 个文档', async () => {
      const task = createMockTask('修改 Button 样式');
      const lifecycleDir = await manager.initialize(task, 'test-session-2');

      // 验证快速模式只生成 3 个文档
      const expectedFiles = ['01-需求分析.md', '04-TODO.md', '08-综合报告.md', 'README.md'];

      for (const file of expectedFiles) {
        const filePath = path.join(lifecycleDir, file);
        const exists = await fs
          .stat(filePath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `File ${file} should exist`).toBe(true);
      }

      // 确认完整模式文档不存在
      const fullModeFiles = ['02-方案设计.md', '03-反思优化.md'];
      for (const file of fullModeFiles) {
        const filePath = path.join(lifecycleDir, file);
        const exists = await fs
          .stat(filePath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `File ${file} should NOT exist in fast mode`).toBe(false);
      }
    });
  });

  describe('阶段检测', () => {
    it('应正确检测已完成的阶段', async () => {
      const task = createMockTask('测试任务');
      const lifecycleDir = await manager.initialize(task, 'test-session-3');

      // 修改需求分析文档，移除占位符
      const reqPath = path.join(lifecycleDir, '01-需求分析.md');
      const reqContent = await fs.readFile(reqPath, 'utf-8');
      const completedReqContent = reqContent
        .replace(/\[请描述为什么要执行此编排任务.*?\]/g, '这是一个测试任务')
        .replace(/\[请描述目标 \d+\]/g, '完成测试目标')
        .replace(/\[请描述.*?\]/g, '已完成')
        .replace(/\[请评估.*?\]/g, '已完成')
        .replace(/\[描述\]/g, '已完成');

      await fs.writeFile(reqPath, completedReqContent, 'utf-8');

      // 检测阶段
      const stages = await manager.detectCompletedStages(lifecycleDir);
      expect(stages).toContainEqual(expect.objectContaining({ stage: 'requirement', completed: true }));
    });
  });
});

describe('OrchestrationLifecycleMonitor', () => {
  let tempDir: string;
  let lifecycleDir: string;
  let monitor: OrchestrationLifecycleMonitor;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'monitor-test-'));
    lifecycleDir = path.join(tempDir, 'lifecycle');
    await fs.mkdir(lifecycleDir, { recursive: true });

    // 创建基础文件
    await fs.writeFile(
      path.join(lifecycleDir, '04-TODO.md'),
      `# 待办事项

### 1. 测试任务

- **状态**：[ ] 待处理
`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(lifecycleDir, '05-PROGRESS.md'),
      `# 执行进度

## 当前状态

| 指标        | 值    |
| ----------- | ----- |
| 已完成 TODO | 0/5   |
| 完成度      | 0%    |

---
`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(lifecycleDir, '06-BUGS.md'),
      `# 问题记录

## 问题清单

*暂无问题*

---
`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(lifecycleDir, '07-验收报告.md'),
      `# 验收报告

## 一、验收概览

- **项目周期**：[开始时间] ~ [结束时间]
- **总体评价**：[待验收]

---
`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(lifecycleDir, '08-综合报告.md'),
      `# 综合报告

## 一、执行摘要

[3-5 段：项目背景、核心目标、实施成果、关键成就]

---
`,
      'utf-8'
    );

    monitor = new OrchestrationLifecycleMonitor(lifecycleDir);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('TODO 状态更新', () => {
    it('应正确标记子任务为已完成', async () => {
      await monitor.updateTodoStatus('subtask-1', 'completed');

      const content = await fs.readFile(path.join(lifecycleDir, '04-TODO.md'), 'utf-8');
      expect(content).toContain('[x] 已完成');
    });

    it('应正确标记子任务为失败', async () => {
      await monitor.updateTodoStatus('subtask-1', 'failed');

      const content = await fs.readFile(path.join(lifecycleDir, '04-TODO.md'), 'utf-8');
      expect(content).toContain('[-] 已取消（失败）');
    });
  });

  describe('进度追加', () => {
    it('应追加成功的子任务进度', async () => {
      const result: SubTaskExecutionResult = {
        subTaskId: 'st-1',
        status: 'completed',
        result: '任务完成',
        duration: 5000,
        timestamp: Date.now()
      };

      await monitor.appendProgress(result);

      const content = await fs.readFile(path.join(lifecycleDir, '05-PROGRESS.md'), 'utf-8');
      expect(content).toContain('✅ 完成了');
      expect(content).toContain('st-1');
      expect(content).toContain('5.00秒');
    });

    it('应追加失败的子任务进度', async () => {
      const result: SubTaskExecutionResult = {
        subTaskId: 'st-2',
        status: 'failed',
        error: 'Execution timeout',
        timestamp: Date.now()
      };

      await monitor.appendProgress(result);

      const content = await fs.readFile(path.join(lifecycleDir, '05-PROGRESS.md'), 'utf-8');
      expect(content).toContain('❌ 失败了');
      expect(content).toContain('st-2');
      expect(content).toContain('Execution timeout');
    });
  });

  describe('Bug 记录', () => {
    it('应记录 Bug 到 BUGS.md', async () => {
      await monitor.recordBug('st-1', 'Test Task', 'Task execution failed', 'Error stack trace...');

      const content = await fs.readFile(path.join(lifecycleDir, '06-BUGS.md'), 'utf-8');
      expect(content).toContain('### BUG-001');
      expect(content).toContain('Test Task');
      expect(content).toContain('Task execution failed');
      expect(content).toContain('Error stack trace...');
    });
  });

  describe('验收报告生成', () => {
    it('应生成验收报告并更新统计信息', async () => {
      const results: SubTaskExecutionResult[] = [
        { subTaskId: 'st-1', status: 'completed', result: 'Output 1', duration: 1000, timestamp: Date.now() },
        { subTaskId: 'st-2', status: 'completed', result: 'Output 2', duration: 2000, timestamp: Date.now() },
        { subTaskId: 'st-3', status: 'failed', error: 'Error', timestamp: Date.now() }
      ];

      const startTime = Date.now() - 10000;
      const endTime = Date.now();

      await monitor.generateAcceptanceReport(results, startTime, endTime);

      const content = await fs.readFile(path.join(lifecycleDir, '07-验收报告.md'), 'utf-8');
      expect(content).toContain('总子任务数');
      expect(content).toContain('完成数');
      expect(content).toContain('3');
      expect(content).toContain('2');
      expect(content).toContain('1');
    });
  });

  describe('综合报告生成', () => {
    it('应生成综合报告并插入执行摘要', async () => {
      const results: SubTaskExecutionResult[] = [
        { subTaskId: 'st-1', status: 'completed', result: 'Output 1', duration: 1000, timestamp: Date.now() }
      ];

      const stats = {
        startTime: Date.now() - 5000,
        endTime: Date.now(),
        duration: 5000,
        totalSubTasks: 1,
        completedSubTasks: 1,
        failedSubTasks: 0
      };

      await monitor.generateFinalReport(results, stats);

      const content = await fs.readFile(path.join(lifecycleDir, '08-综合报告.md'), 'utf-8');
      expect(content).toContain('自动生成执行摘要');
      expect(content).toContain('成功完成');
      expect(content).toContain('1 个子任务');
    });
  });
});
