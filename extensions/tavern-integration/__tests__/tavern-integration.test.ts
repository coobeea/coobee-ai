/**
 * Tavern Integration Extension 测试
 *
 * 测试覆盖：
 * 1. HTTP Webhook 接收接口
 * 2. EventBus 事件发布
 * 3. Agent 工具（accept_task, submit_result）
 * 4. TaskDispatcher 自动派单
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userHome: '/tmp/test-tavern'
    }
  }
}));

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    piMono: vi.fn(() => ({
      name: vi.fn().mockReturnThis(),
      instructions: vi.fn().mockReturnThis(),
      tools: vi.fn().mockReturnThis(),
      maxSteps: vi.fn().mockReturnThis()
    })),
    submit: vi.fn()
  }
}));

describe('Tavern Integration Extension', () => {
  const testTavernDir = '/tmp/test-tavern/tavern';
  const testTasksDir = path.join(testTavernDir, 'tasks');
  const testTasksIndex = path.join(testTavernDir, 'tasks.jsonl');

  // Helper: create mock API with logger
  const createMockApi = (events?: Record<string, unknown>): Record<string, unknown> => ({
    registerChannel: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerService: vi.fn(),
    registerTool: vi.fn(),
    events: events || { emit: vi.fn(), on: vi.fn() },
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn())
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  });

  beforeEach(async () => {
    // 清理测试目录
    await fs.rm(testTavernDir, { recursive: true, force: true });
    await fs.mkdir(testTavernDir, { recursive: true });
    await fs.mkdir(testTasksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testTavernDir, { recursive: true, force: true });
  });

  describe('Webhook 接收接口', () => {
    it('应该正确接收并发布任务创建事件', async () => {
      const mockCtx = {
        request: {
          body: {
            event: 'external.tavern.task.created',
            task: {
              id: 'test-task-1',
              title: 'Test Task',
              description: 'Test description',
              status: 'pending'
            }
          }
        },
        status: 0,
        body: null as unknown
      };

      // 动态导入 Extension（避免顶层 mock 问题）
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      // 模拟注册
      const mockApi = createMockApi();
      const eventBus = mockApi.eventBus as { emit: ReturnType<typeof vi.fn> };

      extension.register(mockApi as never);

      // 获取注册的 HTTP 路由 handler
      const httpRouteCall = (mockApi.registerHttpRoute as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].path === '/internal/tavern/events'
      );
      expect(httpRouteCall).toBeDefined();

      const handler = httpRouteCall![0].handler;
      await handler(mockCtx);

      // 验证响应
      expect(mockCtx.status).toBe(200);
      expect(mockCtx.body).toEqual({ ok: true, message: 'Event received and published' });

      // 验证事件发布（使用 eventBus）
      expect(eventBus.emit).toHaveBeenCalledWith('external.tavern.task.created', mockCtx.request.body.task);
    });

    it('应该拒绝无效的请求体', async () => {
      const mockCtx = {
        request: {
          body: {
            invalid: 'data'
          }
        },
        status: 0,
        body: null as unknown
      };

      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();
      const eventBus = mockApi.eventBus as { emit: ReturnType<typeof vi.fn> };

      extension.register(mockApi as never);

      const httpRouteCall = (mockApi.registerHttpRoute as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].path === '/internal/tavern/events'
      );
      const handler = httpRouteCall![0].handler;
      await handler(mockCtx);

      expect(mockCtx.status).toBe(400);
      expect(mockCtx.body).toEqual({ ok: false, error: 'Invalid event payload' });

      // 验证 eventBus 没有被调用
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('Agent 工具 - external_tavern_accept_task', () => {
    it('应该成功接受任务并更新状态为 in-progress', async () => {
      // 创建测试任务
      const taskId = 'test-task-1';
      const taskDir = path.join(testTasksDir, taskId);
      await fs.mkdir(taskDir, { recursive: true });

      const taskData = {
        id: taskId,
        title: 'Test Task',
        description: 'Test description',
        status: 'pending',
        amount: 100,
        files: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(taskData, null, 2));

      // 写入索引
      await fs.writeFile(testTasksIndex, JSON.stringify(taskData) + '\n');

      // 导入并注册 Extension
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();

      extension.register(mockApi as never);

      // 获取 accept_task 工具
      const acceptTaskCall = mockApi.registerTool.mock.calls.find(
        (call) => call[0].name === 'external_tavern_accept_task'
      );
      expect(acceptTaskCall).toBeDefined();

      const acceptTool = acceptTaskCall![0];
      const result = await acceptTool.execute({ taskId });

      // 验证返回结果
      expect(result).toEqual({
        success: true,
        message: `Task ${taskId} accepted successfully.`
      });

      // 验证任务状态已更新
      const updatedTask = JSON.parse(await fs.readFile(path.join(taskDir, 'meta.json'), 'utf-8'));
      expect(updatedTask.status).toBe('in-progress');
    });

    it('应该正确处理不存在的任务', async () => {
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();

      extension.register(mockApi as never);

      const acceptTaskCall = mockApi.registerTool.mock.calls.find(
        (call) => call[0].name === 'external_tavern_accept_task'
      );
      const acceptTool = acceptTaskCall![0];
      const result = await acceptTool.execute({ taskId: 'non-existent' });

      expect(result).toEqual({
        success: false,
        error: 'Task non-existent not found or update failed.'
      });
    });
  });

  describe('Agent 工具 - external_tavern_submit_result', () => {
    it('应该成功提交任务结果并更新状态为 completed', async () => {
      // 创建测试任务
      const taskId = 'test-task-1';
      const taskDir = path.join(testTasksDir, taskId);
      await fs.mkdir(taskDir, { recursive: true });

      const taskData = {
        id: taskId,
        title: 'Test Task',
        description: 'Test description',
        status: 'in-progress',
        amount: 100,
        files: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(taskData, null, 2));
      await fs.writeFile(testTasksIndex, JSON.stringify(taskData) + '\n');

      // 导入并注册 Extension
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();

      extension.register(mockApi as never);

      // 获取 submit_result 工具
      const submitResultCall = mockApi.registerTool.mock.calls.find(
        (call) => call[0].name === 'external_tavern_submit_result'
      );
      expect(submitResultCall).toBeDefined();

      const submitTool = submitResultCall![0];
      const result = await submitTool.execute({
        taskId,
        textResult: 'Task completed successfully!',
        fileResults: ['/path/to/output.txt']
      });

      // 验证返回结果
      expect(result).toEqual({
        success: true,
        message: `Result for task ${taskId} submitted successfully.`
      });

      // 验证任务状态和结果已更新
      const updatedTask = JSON.parse(await fs.readFile(path.join(taskDir, 'meta.json'), 'utf-8'));
      expect(updatedTask.status).toBe('completed');
      expect(updatedTask.result).toEqual({
        textResult: 'Task completed successfully!',
        fileResults: ['/path/to/output.txt']
      });
    });
  });

  describe('TaskDispatcher 服务', () => {
    it('应该正确注册服务', async () => {
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();

      extension.register(mockApi as never);

      // 验证服务已注册
      const serviceCall = mockApi.registerService.mock.calls.find((call) => call[0].id === 'tavern-task-dispatcher');
      expect(serviceCall).toBeDefined();
    });

    it('应该在收到任务事件时自动派单', async () => {
      const { agentExecutor } = await import('@main/ai/AgentExecutor');

      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();
      const eventBus = mockApi.eventBus as { on: ReturnType<typeof vi.fn> };

      extension.register(mockApi as never);

      // 获取服务并启动
      const serviceCall = (mockApi.registerService as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].id === 'tavern-task-dispatcher'
      );
      const service = serviceCall![0];
      await service.start();

      // 验证监听器已注册
      expect(eventBus.on).toHaveBeenCalledWith('external.tavern.task.created', expect.any(Function));

      // 获取监听器回调
      const eventListener = eventBus.on.mock.calls.find((call) => call[0] === 'external.tavern.task.created')?.[1];

      // 触发事件
      const testTask = {
        id: 'test-task-1',
        title: 'Test Task',
        description: 'Please write a hello world program'
      };

      await eventListener(testTask);

      // 验证 AgentExecutor.submit 被调用
      expect(agentExecutor.submit).toHaveBeenCalled();
      const submitCall = (agentExecutor.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(submitCall.sessionId).toContain('tavern-task-test-task-1');
      expect(submitCall.message).toContain('Test Task');
      expect(submitCall.message).toContain('Please write a hello world program');
    });
  });

  describe('Channel 生命周期', () => {
    it('应该正确注册 Channel', async () => {
      const extensionModule = await import('../index');
      const extension = extensionModule.default;

      const mockApi = createMockApi();

      extension.register(mockApi as never);

      // 验证 Channel 已注册
      expect(mockApi.registerChannel).toHaveBeenCalledWith({
        id: 'tavern-channel',
        name: 'Tavern Channel',
        gateway: expect.objectContaining({
          start: expect.any(Function),
          stop: expect.any(Function)
        })
      });
    });
  });
});
