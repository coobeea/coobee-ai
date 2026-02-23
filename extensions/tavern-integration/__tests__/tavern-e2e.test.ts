/**
 * Tavern Worker 端到端集成测试
 *
 * 测试整个流程：
 * 1. 创建待处理任务
 * 2. Worker 扫描任务（模拟）
 * 3. Worker 推送到 Webhook
 * 4. Extension 接收并发布事件
 * 5. TaskDispatcher 派单给 Agent
 * 6. Agent 处理任务（模拟）
 * 7. 验证任务状态变更
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
      userHome: '/tmp/test-tavern-e2e'
    }
  }
}));

const mockBuilderInstance = {
  name: vi.fn().mockReturnThis(),
  instructions: vi.fn().mockReturnThis(),
  tools: vi.fn().mockReturnThis(),
  maxSteps: vi.fn().mockReturnThis()
};

const mockAgentExecutor = {
  piMono: vi.fn(() => mockBuilderInstance),
  submit: vi.fn()
};

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: mockAgentExecutor
}));

describe('Tavern Worker E2E 集成测试', () => {
  const testTavernDir = '/tmp/test-tavern-e2e/tavern';
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

    // 重置 mock
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testTavernDir, { recursive: true, force: true });
  });

  it('完整流程：从任务创建到自动派单', async () => {
    // === Step 1: 创建待处理任务 ===
    const taskId = 'e2e-test-task-1';
    const taskDir = path.join(testTasksDir, taskId);
    await fs.mkdir(taskDir, { recursive: true });

    const taskData = {
      id: taskId,
      title: 'E2E Test Task',
      description: 'This is an end-to-end test task. Please write a hello world program.',
      status: 'pending',
      amount: 100,
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(taskData, null, 2));
    await fs.writeFile(testTasksIndex, JSON.stringify(taskData) + '\n');

    // === Step 2 & 3: Worker 扫描并推送到 Webhook（模拟） ===
    // 导入并注册 Extension
    const extensionModule = await import('../index');
    const extension = extensionModule.default;

    const mockApi = createMockApi();
    const eventBus = mockApi.eventBus as { emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };

    extension.register(mockApi as never);

    // 启动 TaskDispatcher 服务
    const serviceCall = (mockApi.registerService as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0].id === 'tavern-task-dispatcher'
    );
    expect(serviceCall).toBeDefined();
    const service = serviceCall![0];
    await service.start();

    // 验证事件监听器已注册（使用 eventBus）
    expect(eventBus.on).toHaveBeenCalledWith('external.tavern.task.created', expect.any(Function));

    // === Step 4: 模拟 Worker 推送到 Webhook ===
    const httpRouteCall = mockApi.registerHttpRoute.mock.calls.find(
      (call) => call[0].path === '/internal/tavern/events'
    );
    expect(httpRouteCall).toBeDefined();

    const webhookHandler = httpRouteCall![0].handler;
    const mockCtx = {
      request: {
        body: {
          event: 'external.tavern.task.created',
          task: taskData
        }
      },
      status: 0,
      body: null as unknown
    };

    await webhookHandler(mockCtx);

    // 验证 Webhook 响应成功
    expect(mockCtx.status).toBe(200);
    expect(mockCtx.body).toEqual({ ok: true, message: 'Event received and published' });

    // 验证事件已发布到 EventBus
    expect(eventBus.emit).toHaveBeenCalledWith('external.tavern.task.created', taskData);

    // === Step 5: TaskDispatcher 自动派单 ===
    // 获取事件监听器回调
    const eventListener = eventBus.on.mock.calls.find((call) => call[0] === 'external.tavern.task.created')?.[1];
    expect(eventListener).toBeDefined();

    // 触发事件处理
    await eventListener(taskData);

    // === Step 6: 验证 Agent 被调用 ===
    expect(mockAgentExecutor.piMono).toHaveBeenCalled();
    expect(mockBuilderInstance.name).toHaveBeenCalledWith('app-copilot');
    expect(mockBuilderInstance.instructions).toHaveBeenCalledWith(expect.stringContaining('autonomous AI worker'));
    expect(mockBuilderInstance.tools).toHaveBeenCalledWith(
      expect.arrayContaining(['external_tavern_accept_task', 'external_tavern_submit_result'])
    );

    expect(mockAgentExecutor.submit).toHaveBeenCalled();
    const submitCall = mockAgentExecutor.submit.mock.calls[0][0];
    expect(submitCall.sessionId).toContain(`tavern-task-${taskId}`);
    expect(submitCall.message).toContain('E2E Test Task');
    expect(submitCall.message).toContain('write a hello world program');
  });

  it('工具调用流程：接单 → 处理 → 提交结果', async () => {
    // 创建测试任务
    const taskId = 'tool-test-task-1';
    const taskDir = path.join(testTasksDir, taskId);
    await fs.mkdir(taskDir, { recursive: true });

    const taskData = {
      id: taskId,
      title: 'Tool Test Task',
      description: 'Test task for tool invocation',
      status: 'pending',
      amount: 100,
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(taskData, null, 2));
    await fs.writeFile(testTasksIndex, JSON.stringify(taskData) + '\n');

    // 注册 Extension
    const extensionModule = await import('../index');
    const extension = extensionModule.default;

    const mockApi = createMockApi();

    extension.register(mockApi as never);

    // 获取工具
    const acceptTaskTool = mockApi.registerTool.mock.calls.find(
      (call) => call[0].name === 'external_tavern_accept_task'
    )![0];
    const submitResultTool = mockApi.registerTool.mock.calls.find(
      (call) => call[0].name === 'external_tavern_submit_result'
    )![0];

    // === Step 1: Agent 接单 ===
    const acceptResult = await acceptTaskTool.execute({ taskId });
    expect(acceptResult.success).toBe(true);

    // 验证状态已更新为 in-progress
    const taskAfterAccept = JSON.parse(await fs.readFile(path.join(taskDir, 'meta.json'), 'utf-8'));
    expect(taskAfterAccept.status).toBe('in-progress');

    // === Step 2: Agent 提交结果 ===
    const submitResult = await submitResultTool.execute({
      taskId,
      textResult: 'Task completed successfully! Here is the hello world program.',
      fileResults: ['/tmp/hello_world.py']
    });
    expect(submitResult.success).toBe(true);

    // 验证状态已更新为 completed 并包含结果
    const taskAfterSubmit = JSON.parse(await fs.readFile(path.join(taskDir, 'meta.json'), 'utf-8'));
    expect(taskAfterSubmit.status).toBe('completed');
    expect(taskAfterSubmit.result).toEqual({
      textResult: 'Task completed successfully! Here is the hello world program.',
      fileResults: ['/tmp/hello_world.py']
    });
  });

  it('错误处理：处理不存在的任务', async () => {
    const extensionModule = await import('../index');
    const extension = extensionModule.default;

    const mockApi = createMockApi();

    extension.register(mockApi as never);

    const acceptTaskTool = mockApi.registerTool.mock.calls.find(
      (call) => call[0].name === 'external_tavern_accept_task'
    )![0];

    const result = await acceptTaskTool.execute({ taskId: 'non-existent-task' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('并发任务处理：多个任务同时到达', async () => {
    // 创建多个任务
    const taskIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
    const tasks = [];

    for (const taskId of taskIds) {
      const taskDir = path.join(testTasksDir, taskId);
      await fs.mkdir(taskDir, { recursive: true });

      const taskData = {
        id: taskId,
        title: `Concurrent Task ${taskId}`,
        description: `Concurrent test task ${taskId}`,
        status: 'pending',
        amount: 100,
        files: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(taskData, null, 2));
      tasks.push(taskData);
    }

    // 注册 Extension 并启动服务
    const extensionModule = await import('../index');
    const extension = extensionModule.default;

    const mockApi = createMockApi();
    const eventBus = mockApi.eventBus as { on: ReturnType<typeof vi.fn> };

    extension.register(mockApi as never);

    const serviceCall = (mockApi.registerService as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0].id === 'tavern-task-dispatcher'
    );
    const service = serviceCall![0];
    await service.start();

    // 获取事件监听器
    const eventListener = eventBus.on.mock.calls.find((call) => call[0] === 'external.tavern.task.created')?.[1];

    // 并发触发多个任务
    await Promise.all(tasks.map((task) => eventListener(task)));

    // 验证所有任务都被派单
    expect(mockAgentExecutor.submit).toHaveBeenCalledTimes(3);

    // 验证每个任务都有独立的 session
    const sessionIds = mockAgentExecutor.submit.mock.calls.map((call) => call[0].sessionId);
    const uniqueSessionIds = new Set(sessionIds);
    expect(uniqueSessionIds.size).toBe(3);
  });
});
