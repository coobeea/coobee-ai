/**
 * SwarmCoordinator 单元测试
 *
 * 验证蜂群模式核心流程：
 *   - Triage → 直接回答（无 handoff）
 *   - Triage → 单次 handoff → 角色执行
 *   - 多次 handoff 链
 *   - 最大深度限制
 *   - 事件回调完整性
 *   - 错误处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentRuntime } from '../../runtime/AgentRuntime';
import type { ExecutionResult } from '../../runtime/types';
import type { SwarmConfig, AgentRole, SwarmTask } from '../types';
import { HANDOFF_SIGNAL_PREFIX } from '../types';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

function createMockRuntime(runResult: ExecutionResult): AgentRuntime {
  return {
    type: 'agent',
    id: 'mock-runtime',
    name: 'MockRuntime',
    options: { name: 'Mock', instructions: '' },
    interrupted: false,
    supportsHITL: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(runResult),
    stream: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn(),
    resumeStream: vi.fn()
  } as unknown as AgentRuntime;
}

function task(id: string, input: string): SwarmTask {
  return { id, input, createdAt: Date.now() };
}

const TEST_ROLES: AgentRole[] = [
  {
    id: 'test-coder',
    name: 'Test Coder',
    description: 'Writes code',
    instructions: 'You are a coder.',
    handoffDescription: 'Transfer for coding tasks',
    capabilities: ['coding']
  },
  {
    id: 'test-reviewer',
    name: 'Test Reviewer',
    description: 'Reviews code',
    instructions: 'You are a reviewer.',
    handoffDescription: 'Transfer for review tasks',
    capabilities: ['review']
  }
];

const DEFAULT_CONFIG: SwarmConfig = {
  id: 'test-swarm',
  name: 'Test Swarm',
  maxConcurrentAgents: 3,
  agentIdleTimeout: 60000,
  maxHandoffDepth: 5,
  enableSharedContext: true,
  enableMonitoring: true
};

describe('SwarmCoordinator', () => {
  let SwarmCoordinator: typeof import('../SwarmCoordinator').SwarmCoordinator;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../SwarmCoordinator');
    SwarmCoordinator = mod.SwarmCoordinator;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Triage 直接回答（无 handoff）', async () => {
    const coordinator = new SwarmCoordinator(DEFAULT_CONFIG);

    const triageRuntime = createMockRuntime({ output: '直接回答结果', duration: 100 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(coordinator as any, 'createTriageRuntime').mockResolvedValue(triageRuntime);
    coordinator.roleRegistry.registerAll(TEST_ROLES);

    const events: string[] = [];
    coordinator.setOnEvent((e) => events.push(e.type));

    const result = await coordinator.coordinate(task('task-1', '你好'));

    expect(result.output).toBe('直接回答结果');
    expect(result.handoffCount).toBe(0);
    expect(events).toContain('triage:start');
    expect(events).toContain('agent:start');
    expect(events).toContain('agent:done');
    expect(events).toContain('complete');
  });

  it('Triage → 单次 handoff → 角色执行', async () => {
    const coordinator = new SwarmCoordinator(DEFAULT_CONFIG);

    const triageRuntime = createMockRuntime({
      output: `${HANDOFF_SIGNAL_PREFIX}test-coder`,
      duration: 50
    });
    const coderRuntime = createMockRuntime({ output: '代码已完成', duration: 200 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(coordinator as any, 'createTriageRuntime').mockResolvedValue(triageRuntime);
    coordinator.roleRegistry.registerAll(TEST_ROLES);
    coordinator.pool.start();
    coordinator.pool.setRuntimeFactory(async () => coderRuntime);

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    coordinator.setOnEvent((e) => events.push(e));

    const result = await coordinator.coordinate(task('task-2', '写一个排序算法'));

    expect(result.output).toBe('代码已完成');
    expect(result.handoffCount).toBe(1);
    expect(result.rolesUsed).toContain('test-coder');

    const handoffEvent = events.find((e) => e.type === 'handoff');
    expect(handoffEvent).toBeDefined();
    expect(handoffEvent!.data).toMatchObject({ from: 'triage', to: 'test-coder' });
  });

  it('多次 handoff 链: triage → test-coder → test-reviewer', async () => {
    const coordinator = new SwarmCoordinator(DEFAULT_CONFIG);

    const triageRuntime = createMockRuntime({
      output: `${HANDOFF_SIGNAL_PREFIX}test-coder`,
      duration: 50
    });
    const coderRuntime = createMockRuntime({
      output: `${HANDOFF_SIGNAL_PREFIX}test-reviewer`,
      duration: 100
    });
    const reviewerRuntime = createMockRuntime({ output: '审查完成，代码质量优良', duration: 150 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(coordinator as any, 'createTriageRuntime').mockResolvedValue(triageRuntime);
    coordinator.roleRegistry.registerAll(TEST_ROLES);
    coordinator.pool.start();

    coordinator.pool.setRuntimeFactory(async (role) => {
      if (role.id === 'test-coder') return coderRuntime;
      if (role.id === 'test-reviewer') return reviewerRuntime;
      return createMockRuntime({ output: 'fallback', duration: 10 });
    });

    const result = await coordinator.coordinate(task('task-3', '写代码并审查'));

    expect(result.output).toBe('审查完成，代码质量优良');
    expect(result.handoffCount).toBe(2);
    expect(result.rolesUsed).toContain('test-coder');
    expect(result.rolesUsed).toContain('test-reviewer');
  });

  it('最大深度限制', async () => {
    const config: SwarmConfig = { ...DEFAULT_CONFIG, maxHandoffDepth: 1 };
    const coordinator = new SwarmCoordinator(config);

    const triageRuntime = createMockRuntime({
      output: `${HANDOFF_SIGNAL_PREFIX}test-coder`,
      duration: 50
    });
    const coderRuntime = createMockRuntime({
      output: `${HANDOFF_SIGNAL_PREFIX}test-reviewer`,
      duration: 100
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(coordinator as any, 'createTriageRuntime').mockResolvedValue(triageRuntime);
    coordinator.roleRegistry.registerAll(TEST_ROLES);
    coordinator.pool.start();
    coordinator.pool.setRuntimeFactory(async () => coderRuntime);

    const result = await coordinator.coordinate(task('task-depth', '深度测试'));

    expect(result.handoffCount).toBeLessThanOrEqual(config.maxHandoffDepth + 1);
  });

  it('错误处理：runtime 抛出异常', async () => {
    const coordinator = new SwarmCoordinator(DEFAULT_CONFIG);

    const failRuntime = createMockRuntime({ output: '', duration: 0 });
    (failRuntime.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Runtime crash'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(coordinator as any, 'createTriageRuntime').mockResolvedValue(failRuntime);
    coordinator.roleRegistry.registerAll(TEST_ROLES);

    const events: string[] = [];
    coordinator.setOnEvent((e) => events.push(e.type));

    const result = await coordinator.coordinate(task('task-err', '会失败的任务'));

    expect(result.state.status).toBe('failed');
    expect(result.state.error).toContain('Runtime crash');
    expect(events).toContain('error');
  });

  it('共享上下文在 handoff 之间传递', () => {
    const coordinator = new SwarmCoordinator(DEFAULT_CONFIG);
    coordinator.roleRegistry.registerAll(TEST_ROLES);

    expect(coordinator.context).toBeDefined();
    coordinator.context.set('analysis', 'This is a coding task', 'triage');

    const value = coordinator.context.get('analysis');
    expect(value).toBe('This is a coding task');
  });
});
