/**
 * DiscussionCoordinator 单元测试
 *
 * 验证多智能体讨论机制：
 *   - 基本讨论流程（多轮发言 + 共识判断 + 结论生成）
 *   - 参与者不足时的错误处理
 *   - 达成共识后提前结束
 *   - 未达成共识时的强制总结
 *   - 事件回调完整性
 *   - MessageBus 记录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscussionCoordinator, type DiscussionEvent } from '../DiscussionCoordinator';
import type { AgentRole, SwarmConfig } from '../types';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

const mockBuild = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: {
    piMono: () => ({
      name: () => ({
        mode: () => ({
          sessionMode: () => ({
            instructions: () => ({
              sessionId: () => ({
                model: () => ({ build: mockBuild }),
                build: mockBuild
              })
            })
          })
        })
      })
    })
  }
}));

const TEST_ROLES: AgentRole[] = [
  {
    id: 'architect',
    name: '架构师',
    description: '负责系统架构设计',
    instructions: 'You are an architect.',
    handoffDescription: 'Architecture design',
    capabilities: ['architecture']
  },
  {
    id: 'developer',
    name: '开发者',
    description: '负责代码实现',
    instructions: 'You are a developer.',
    handoffDescription: 'Code implementation',
    capabilities: ['coding']
  },
  {
    id: 'tester',
    name: '测试工程师',
    description: '负责质量保证',
    instructions: 'You are a tester.',
    handoffDescription: 'Testing',
    capabilities: ['testing']
  }
];

function createSwarmConfig(): SwarmConfig {
  return {
    id: 'test-swarm',
    name: 'Test Swarm',
    parentSessionId: 'test-session',
    maxConcurrentAgents: 5,
    agentIdleTimeout: 60000,
    maxHandoffDepth: 5,
    enableSharedContext: true,
    enableMonitoring: false
  };
}

function mockRuntime(output: string): {
  run: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn().mockResolvedValue({ output, toolCalls: [], duration: 100 }),
    destroy: vi.fn().mockResolvedValue(undefined)
  };
}

describe('DiscussionCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if less than 2 participants', async () => {
    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect'],
      maxRounds: 2
    });
    coordinator.registerRole(TEST_ROLES[0]);

    await expect(coordinator.discuss({ id: 't1', input: '讨论架构', createdAt: Date.now() })).rejects.toThrow(
      '讨论至少需要 2 个参与者'
    );

    await coordinator.destroy();
  });

  it('should conduct multi-round discussion with consensus', async () => {
    const events: DiscussionEvent[] = [];

    const architectRuntime = mockRuntime('我建议使用微服务架构');
    const developerRuntime = mockRuntime('我同意微服务方案，补充建议使用 gRPC');

    let participantCalls = 0;
    const mockPool = {
      acquireAgent: vi.fn().mockImplementation((role: AgentRole) => {
        participantCalls++;
        const rt = role.id === 'architect' ? architectRuntime : developerRuntime;
        return { runtime: rt, poolId: `pool-${participantCalls}` };
      }),
      releaseAgent: vi.fn(),
      drain: vi.fn().mockResolvedValue(undefined)
    };

    const moderatorRuntime = mockRuntime(
      JSON.stringify({
        consensusScore: 80,
        consensusReached: true,
        summary: '双方均同意微服务架构',
        divergencePoints: [],
        conclusion: '最终结论：采用微服务架构 + gRPC 通信',
        guidanceForNextRound: ''
      })
    );

    mockBuild.mockResolvedValue({
      run: moderatorRuntime.run,
      destroy: mockDestroy
    });

    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect', 'developer'],
      maxRounds: 3,
      enableModerator: true,
      consensusThreshold: 75
    });

    for (const role of TEST_ROLES) {
      coordinator.registerRole(role);
    }

    // Replace pool with mock
    (coordinator as unknown as { pool: typeof mockPool }).pool = mockPool;

    coordinator.setOnEvent((event) => {
      events.push(event as DiscussionEvent);
    });

    const result = await coordinator.discuss({
      id: 't1',
      input: '讨论系统架构方案',
      createdAt: Date.now()
    });

    expect(result.consensusReached).toBe(true);
    expect(result.conclusion).toBe('最终结论：采用微服务架构 + gRPC 通信');
    expect(result.totalRounds).toBe(1);
    expect(result.participantRoles).toEqual(['architect', 'developer']);
    expect(result.turns).toHaveLength(2);

    expect(result.turns[0].roleId).toBe('architect');
    expect(result.turns[0].content).toBe('我建议使用微服务架构');
    expect(result.turns[1].roleId).toBe('developer');
    expect(result.turns[1].content).toBe('我同意微服务方案，补充建议使用 gRPC');

    const startEvents = events.filter((e) => e.type === 'discussion:start');
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].data).toHaveProperty('topic', '讨论系统架构方案');

    const turnEvents = events.filter((e) => e.type === 'discussion:turn');
    expect(turnEvents).toHaveLength(2);

    const conclusionEvents = events.filter((e) => e.type === 'discussion:conclusion');
    expect(conclusionEvents).toHaveLength(1);
    expect((conclusionEvents[0].data as { consensusReached: boolean }).consensusReached).toBe(true);

    await coordinator.destroy();
  });

  it('should continue discussion when consensus not reached', async () => {
    const architectOutputs = ['方案A: 单体架构', '方案A改进: 单体+模块化'];
    const developerOutputs = ['方案B: 微服务架构', '让步: 可以先单体后拆分'];

    let architectCall = 0;
    let developerCall = 0;

    const mockPool = {
      acquireAgent: vi.fn().mockImplementation((role: AgentRole) => {
        if (role.id === 'architect') {
          const rt = mockRuntime(architectOutputs[architectCall] || '同意');
          architectCall++;
          return { runtime: rt, poolId: `pool-arch-${architectCall}` };
        } else {
          const rt = mockRuntime(developerOutputs[developerCall] || '同意');
          developerCall++;
          return { runtime: rt, poolId: `pool-dev-${developerCall}` };
        }
      }),
      releaseAgent: vi.fn(),
      drain: vi.fn().mockResolvedValue(undefined)
    };

    let moderatorCallCount = 0;
    mockBuild.mockImplementation(() => {
      moderatorCallCount++;
      if (moderatorCallCount === 1) {
        return Promise.resolve({
          run: vi.fn().mockResolvedValue({
            output: JSON.stringify({
              consensusScore: 40,
              consensusReached: false,
              summary: '双方分歧较大',
              divergencePoints: ['架构模式选择'],
              guidanceForNextRound: '请讨论是否可以折中'
            }),
            toolCalls: [],
            duration: 50
          }),
          destroy: mockDestroy
        });
      }
      return Promise.resolve({
        run: vi.fn().mockResolvedValue({
          output: JSON.stringify({
            consensusScore: 85,
            consensusReached: true,
            summary: '双方达成折中方案',
            divergencePoints: [],
            conclusion: '先单体开发，未来可拆分为微服务'
          }),
          toolCalls: [],
          duration: 50
        }),
        destroy: mockDestroy
      });
    });

    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect', 'developer'],
      maxRounds: 3,
      enableModerator: true,
      consensusThreshold: 75
    });

    for (const role of TEST_ROLES) {
      coordinator.registerRole(role);
    }

    (coordinator as unknown as { pool: typeof mockPool }).pool = mockPool;

    const result = await coordinator.discuss({
      id: 't2',
      input: '讨论架构选型',
      createdAt: Date.now()
    });

    expect(result.consensusReached).toBe(true);
    expect(result.totalRounds).toBe(2);
    expect(result.turns).toHaveLength(4);
    expect(result.conclusion).toBe('先单体开发，未来可拆分为微服务');

    await coordinator.destroy();
  });

  it('should generate forced summary when max rounds reached without consensus', async () => {
    const mockPool = {
      acquireAgent: vi.fn().mockImplementation(() => {
        return { runtime: mockRuntime('我的观点保持不变'), poolId: `pool-${Date.now()}` };
      }),
      releaseAgent: vi.fn(),
      drain: vi.fn().mockResolvedValue(undefined)
    };

    let moderatorCallCount = 0;
    mockBuild.mockImplementation(() => {
      moderatorCallCount++;
      if (moderatorCallCount <= 2) {
        return Promise.resolve({
          run: vi.fn().mockResolvedValue({
            output: JSON.stringify({
              consensusScore: 30,
              consensusReached: false,
              summary: '仍有分歧',
              divergencePoints: ['核心分歧'],
              guidanceForNextRound: '请尝试折中'
            }),
            toolCalls: [],
            duration: 50
          }),
          destroy: mockDestroy
        });
      }
      return Promise.resolve({
        run: vi.fn().mockResolvedValue({
          output: '强制总结：各方仍有分歧，建议采用渐进式方案。',
          toolCalls: [],
          duration: 50
        }),
        destroy: mockDestroy
      });
    });

    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect', 'developer'],
      maxRounds: 2,
      enableModerator: true,
      consensusThreshold: 75
    });

    for (const role of TEST_ROLES) {
      coordinator.registerRole(role);
    }
    (coordinator as unknown as { pool: typeof mockPool }).pool = mockPool;

    const result = await coordinator.discuss({
      id: 't3',
      input: '讨论难以达成共识的问题',
      createdAt: Date.now()
    });

    expect(result.consensusReached).toBe(false);
    expect(result.totalRounds).toBe(2);
    expect(result.conclusion).toContain('强制总结');

    await coordinator.destroy();
  });

  it('should work without moderator', async () => {
    const mockPool = {
      acquireAgent: vi.fn().mockImplementation((role: AgentRole) => {
        return {
          runtime: mockRuntime(`${role.name}的观点：方案不错`),
          poolId: `pool-${Date.now()}`
        };
      }),
      releaseAgent: vi.fn(),
      drain: vi.fn().mockResolvedValue(undefined)
    };

    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect', 'developer'],
      maxRounds: 1,
      enableModerator: false
    });

    for (const role of TEST_ROLES) {
      coordinator.registerRole(role);
    }
    (coordinator as unknown as { pool: typeof mockPool }).pool = mockPool;

    const result = await coordinator.discuss({
      id: 't4',
      input: '无主持人讨论',
      createdAt: Date.now()
    });

    expect(result.totalRounds).toBe(1);
    expect(result.turns).toHaveLength(2);
    expect(result.conclusion).toContain('架构师');
    expect(result.conclusion).toContain('开发者');

    await coordinator.destroy();
  });

  it('should record messages in MessageBus', async () => {
    const mockPool = {
      acquireAgent: vi.fn().mockImplementation(() => {
        return { runtime: mockRuntime('讨论观点'), poolId: `pool-${Date.now()}` };
      }),
      releaseAgent: vi.fn(),
      drain: vi.fn().mockResolvedValue(undefined)
    };

    const coordinator = new DiscussionCoordinator(createSwarmConfig(), {
      participantRoleIds: ['architect', 'developer'],
      maxRounds: 1,
      enableModerator: false
    });

    for (const role of TEST_ROLES) {
      coordinator.registerRole(role);
    }
    (coordinator as unknown as { pool: typeof mockPool }).pool = mockPool;

    const result = await coordinator.discuss({
      id: 't5',
      input: 'MessageBus 测试',
      createdAt: Date.now()
    });

    expect(result.turns).toHaveLength(2);

    const messageBus = (coordinator as unknown as { messageBus: { getMessagesByTopic: (t: string) => unknown[] } })
      .messageBus;
    const messages = messageBus.getMessagesByTopic('discussion');
    expect(messages.length).toBe(2);

    await coordinator.destroy();
  });
});
