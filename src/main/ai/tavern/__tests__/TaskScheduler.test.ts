/**
 * TaskScheduler 单元测试
 *
 * 验证：
 * 1. 轮询 Tavern pending 任务
 * 2. 创建 Thread 并提交给 AgentExecutor
 * 3. 任务完成后更新状态
 * 4. 并发控制
 * 5. 错误恢复
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';

// ─── Mocks ───

const mockEventBus = new EventEmitter();
mockEventBus.setMaxListeners(100);

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

const mockSubmitViaPipeline = vi.fn();
const mockSubmit = vi.fn();
const mockCreateBuilderFromFactory = vi.fn();

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    submitViaPipeline: mockSubmitViaPipeline,
    submit: mockSubmit,
    createBuilderFromFactory: mockCreateBuilderFromFactory
  }
}));

const mockThreadCreate = vi.fn();
vi.mock('@main/ai/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn().mockResolvedValue({
      create: mockThreadCreate
    })
  }
}));

// ─── Helpers ───

let tmpDir: string;

function createTavernDir(): string {
  const dir = path.join(tmpDir, 'tavern');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTask(tavernDir: string, task: { id: string; title: string; description: string; status: string }): void {
  const full = {
    amount: 1,
    files: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...task
  };

  // Write meta
  const taskDir = path.join(tavernDir, 'tasks', task.id);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(full, null, 2));

  // Append to index
  const indexPath = path.join(tavernDir, 'tasks.jsonl');
  fs.appendFileSync(indexPath, JSON.stringify(full) + '\n');
}

// ─── Tests ───

describe('TaskScheduler', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-scheduler-test-'));
    mockSubmitViaPipeline.mockReset();
    mockSubmit.mockReset();
    mockCreateBuilderFromFactory.mockReset();
    mockThreadCreate.mockReset();
    mockEventBus.removeAllListeners();

    mockThreadCreate.mockResolvedValue({ id: 'thread-001' });
    mockSubmitViaPipeline.mockResolvedValue({ status: 'accepted' });
  });

  afterEach(async () => {
    const { TaskScheduler } = await import('../TaskScheduler');
    TaskScheduler.resetInstance();

    const { TavernStore } = await import('../TavernStore');
    TavernStore.resetInstance();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createScheduler(tavernDir: string) {
    // Inject the temp tavern dir into TavernStore
    const { TavernStore } = await import('../TavernStore');
    TavernStore.resetInstance();
    vi.spyOn(TavernStore, 'getInstance').mockResolvedValue(Object.assign(new TavernStore(), { tavernDir } as never));

    // Re-init TavernStore with our temp dir
    const store = await TavernStore.getInstance();
    // Manually set tavernDir via prototype hack
    (store as unknown as { tavernDir: string }).tavernDir = tavernDir;

    const { TaskScheduler } = await import('../TaskScheduler');
    TaskScheduler.resetInstance();
    return TaskScheduler.getInstance({ pollInterval: 100_000, maxConcurrent: 2, enableNotification: false });
  }

  it('poll() 拉取 pending 任务并调用 submitViaPipeline', async () => {
    const tavernDir = createTavernDir();
    writeTask(tavernDir, { id: 'task-1', title: '写文档', description: '编写 README', status: 'pending' });

    const scheduler = await createScheduler(tavernDir);

    // 手动触发 poll
    await (scheduler as unknown as { poll: () => Promise<void> }).poll();

    expect(mockThreadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[Task] 写文档',
        agentId: 'default',
        metadata: { source: 'task-scheduler', taskId: 'task-1' }
      })
    );

    expect(mockSubmitViaPipeline).toHaveBeenCalledWith('thread-001', expect.stringContaining('写文档'), 'agent');
  });

  it('不拉取非 pending 任务', async () => {
    const tavernDir = createTavernDir();
    writeTask(tavernDir, { id: 'task-1', title: '已完成', description: '已完成', status: 'completed' });
    writeTask(tavernDir, { id: 'task-2', title: '进行中', description: '进行中', status: 'in-progress' });

    const scheduler = await createScheduler(tavernDir);
    await (scheduler as unknown as { poll: () => Promise<void> }).poll();

    expect(mockSubmitViaPipeline).not.toHaveBeenCalled();
  });

  it('并发控制：不超过 maxConcurrent', async () => {
    const tavernDir = createTavernDir();
    writeTask(tavernDir, { id: 'task-1', title: '任务1', description: '1', status: 'pending' });
    writeTask(tavernDir, { id: 'task-2', title: '任务2', description: '2', status: 'pending' });
    writeTask(tavernDir, { id: 'task-3', title: '任务3', description: '3', status: 'pending' });

    const scheduler = await createScheduler(tavernDir);

    // maxConcurrent = 2, 第一次 poll 应该只分发 2 个任务
    let threadCounter = 0;
    mockThreadCreate.mockImplementation(async () => {
      threadCounter++;
      return { id: `thread-${String(threadCounter).padStart(3, '0')}` };
    });

    await (scheduler as unknown as { poll: () => Promise<void> }).poll();

    expect(mockSubmitViaPipeline).toHaveBeenCalledTimes(2);
    expect(scheduler.getActiveExecutions()).toHaveLength(2);

    // 再次 poll 不应分发新任务（已满）
    await (scheduler as unknown as { poll: () => Promise<void> }).poll();
    expect(mockSubmitViaPipeline).toHaveBeenCalledTimes(2);
  });

  it('stream:end 事件触发任务完成', async () => {
    const tavernDir = createTavernDir();
    writeTask(tavernDir, { id: 'task-1', title: '任务1', description: '1', status: 'pending' });

    const scheduler = await createScheduler(tavernDir);

    // 手动注册 completion listener + poll（避免 start() 的异步竞态）
    (scheduler as unknown as { listenForCompletion: () => void }).listenForCompletion();
    await (scheduler as unknown as { poll: () => Promise<void> }).poll();

    const executions = scheduler.getActiveExecutions();
    expect(executions).toHaveLength(1);

    // 模拟 stream:end
    mockEventBus.emit('stream:end', { sessionId: 'thread-001' });

    // 等待异步处理
    await new Promise((r) => setTimeout(r, 200));

    expect(scheduler.getActiveExecutions()).toHaveLength(0);

    // 验证任务状态被更新
    const { TavernStore } = await import('../TavernStore');
    const store = await TavernStore.getInstance();
    const task = await store.readMeta('task-1');
    expect(task?.status).toBe('completed');
  });

  it('Pipeline 不可用时回退到 createBuilderFromFactory + submit', async () => {
    const tavernDir = createTavernDir();
    writeTask(tavernDir, { id: 'task-1', title: '任务1', description: '1', status: 'pending' });

    mockSubmitViaPipeline.mockResolvedValue(null);
    const mockBuilder = { name: vi.fn() };
    mockCreateBuilderFromFactory.mockReturnValue(mockBuilder);
    mockSubmit.mockReturnValue({ status: 'accepted' });

    const scheduler = await createScheduler(tavernDir);
    await (scheduler as unknown as { poll: () => Promise<void> }).poll();

    expect(mockCreateBuilderFromFactory).toHaveBeenCalledWith('agent');
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'thread-001', builder: mockBuilder }));
  });

  it('start() 和 stop() 正确管理生命周期', async () => {
    const tavernDir = createTavernDir();
    const scheduler = await createScheduler(tavernDir);

    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});
