/**
 * QualityLoopRuntime 单元测试
 *
 * 覆盖：基本流程、修复循环、最大迭代、中止策略、空输出、执行失败
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamChunk, ExecutionResult } from '../../runtime/types';

// Mock logger
vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock Validator and Repairer - use hoisted fns so they exist when mock factory runs
const mockValidate = vi.hoisted(() => vi.fn());
const mockGenerateRepairPlan = vi.hoisted(() => vi.fn());

vi.mock('../Validator', () => ({
  Validator: class MockValidator {
    validate = mockValidate;
  }
}));

vi.mock('../Repairer', () => ({
  Repairer: class MockRepairer {
    generateRepairPlan = mockGenerateRepairPlan;
  }
}));

// Mock createLLMChat - used for repair execution
const mockLLMChat = vi.hoisted(() => vi.fn());
vi.mock('../llm-chat', () => ({
  createLLMChat: () => mockLLMChat
}));

// Mock saveContextSnapshot to avoid side effects
vi.mock('../../runtime/ContextSnapshot', () => ({
  saveContextSnapshot: vi.fn().mockResolvedValue(undefined)
}));

// Helper: consume generator and collect chunks + final result
async function consumeGenerator(
  gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>
): Promise<{ chunks: StreamChunk[]; result: ExecutionResult }> {
  const chunks: StreamChunk[] = [];
  let r = await gen.next();
  while (!r.done) {
    chunks.push(r.value);
    r = await gen.next();
  }
  return { chunks, result: r.value };
}

// Default mock for agentExecutor
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createMockAgentExecutor(streamImpl: () => AsyncGenerator<StreamChunk, ExecutionResult, unknown>) {
  return {
    stream: vi.fn().mockImplementation(streamImpl),
    piMono: vi.fn().mockReturnValue({
      name: vi.fn().mockReturnValue({
        mode: vi.fn().mockReturnValue({
          lightweight: vi.fn().mockReturnValue({})
        })
      })
    })
  };
}

describe('QualityLoopRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Basic flow — passes on first try', () => {
    it('yields quality events and returns correct metadata when validation passes', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* () {
        yield { type: 'text:delta', content: 'Hello World' };
        return { output: 'Hello World' };
      });

      mockValidate.mockResolvedValueOnce({
        passed: true,
        overallScore: 90,
        criteriaScores: [],
        issues: [],
        duration: 10
      });

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(chunks.some((c) => c.type === 'run:start')).toBe(true);
      expect(chunks.some((c) => c.type === 'quality:round_start')).toBe(true);
      expect(chunks.some((c) => c.type === 'quality:validating')).toBe(true);
      expect(chunks.some((c) => c.type === 'quality:score')).toBe(true);
      expect(chunks.some((c) => c.type === 'quality:done')).toBe(true);
      expect(chunks.some((c) => c.type === 'run:done')).toBe(true);

      const scoreChunk = chunks.find((c) => c.type === 'quality:score');
      expect(scoreChunk?.data).toMatchObject({ score: 90, passed: true });

      const doneChunk = chunks.find((c) => c.type === 'quality:done');
      expect(doneChunk?.data).toMatchObject({ finalScore: 90, rounds: 1, passed: true });

      expect(result.output).toBe('Hello World');
      expect(result.metadata?.qualityLoop).toMatchObject({
        finalScore: 90,
        rounds: 1,
        passed: true,
        maxIterations: 3,
        passThreshold: 70
      });
    });
  });

  describe('2. Repair loop', () => {
    it('runs 2 rounds when first validation fails and second passes', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* () {
        yield { type: 'text:delta', content: 'Initial output' };
        return { output: 'Initial output' };
      });

      mockValidate
        .mockResolvedValueOnce({
          passed: false,
          overallScore: 40,
          criteriaScores: [],
          issues: [{ severity: 'critical', description: 'Incomplete', suggestedFix: 'Add more' }],
          duration: 10
        })
        .mockResolvedValueOnce({
          passed: true,
          overallScore: 85,
          criteriaScores: [],
          issues: [],
          duration: 10
        });

      mockGenerateRepairPlan.mockResolvedValueOnce({
        shouldRepair: true,
        strategy: 'patch',
        repairInstructions: 'Add more content',
        rootCause: 'Incomplete output',
        expectedImprovements: ['Add more'],
        duration: 5
      });

      mockLLMChat.mockResolvedValueOnce('Fixed output with more content');

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(mockValidate).toHaveBeenCalledTimes(2);
      expect(mockGenerateRepairPlan).toHaveBeenCalledTimes(1);

      const roundStarts = chunks.filter((c) => c.type === 'quality:round_start');
      expect(roundStarts).toHaveLength(2);

      const doneChunk = chunks.find((c) => c.type === 'quality:done');
      expect(doneChunk?.data).toMatchObject({ finalScore: 85, rounds: 2, passed: true });

      expect(result.output).toBe('Fixed output with more content');
      expect(result.metadata?.qualityLoop).toMatchObject({ passed: true, rounds: 2 });
    });
  });

  describe('3. Max iterations exceeded', () => {
    it('stops at maxIterations and returns passed=false when validation always fails', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* () {
        yield { type: 'text:delta', content: 'Output' };
        return { output: 'Output' };
      });

      mockValidate.mockResolvedValue({
        passed: false,
        overallScore: 40,
        criteriaScores: [],
        issues: [],
        duration: 10
      });

      mockGenerateRepairPlan.mockResolvedValue({
        shouldRepair: true,
        strategy: 'patch',
        repairInstructions: 'Fix it',
        rootCause: 'Bad',
        expectedImprovements: [],
        duration: 5
      });

      mockLLMChat.mockResolvedValue('Still bad output');

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor,
        maxIterations: 3
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(mockValidate).toHaveBeenCalledTimes(3);
      expect(mockGenerateRepairPlan).toHaveBeenCalledTimes(3);

      const doneChunk = chunks.find((c) => c.type === 'quality:done');
      // Loop runs 3 iterations (round 1,2,3); after exit round=4
      expect(doneChunk?.data).toMatchObject({ finalScore: 40, rounds: 4, passed: false });

      expect(result.metadata?.qualityLoop).toMatchObject({
        passed: false,
        rounds: 4,
        maxIterations: 3
      });
    });
  });

  describe('4. Abort strategy', () => {
    it('stops immediately when Repairer returns strategy=abort', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* () {
        yield { type: 'text:delta', content: 'Output' };
        return { output: 'Output' };
      });

      mockValidate.mockResolvedValueOnce({
        passed: false,
        overallScore: 40,
        criteriaScores: [],
        issues: [],
        duration: 10
      });

      mockGenerateRepairPlan.mockResolvedValueOnce({
        shouldRepair: false,
        strategy: 'abort',
        repairInstructions: '',
        rootCause: 'Unfixable',
        expectedImprovements: [],
        duration: 5
      });

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(mockValidate).toHaveBeenCalledTimes(1);
      expect(mockGenerateRepairPlan).toHaveBeenCalledTimes(1);
      expect(mockLLMChat).not.toHaveBeenCalled();

      const repairingChunk = chunks.find((c) => c.type === 'quality:repairing');
      expect(repairingChunk?.data).toMatchObject({ strategy: 'abort', rootCause: 'Unfixable' });

      const doneChunk = chunks.find((c) => c.type === 'quality:done');
      expect(doneChunk?.data).toMatchObject({ passed: false });

      expect(result.metadata?.qualityLoop).toMatchObject({ passed: false });
    });
  });

  describe('5. Empty output', () => {
    it('yields quality:done with passed=false when agent returns no text', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* () {
        yield { type: 'run:start', content: '' };
        yield { type: 'run:done', content: '' };
        return { output: '' };
      });

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(mockValidate).not.toHaveBeenCalled();

      const doneChunk = chunks.find((c) => c.type === 'quality:done');
      expect(doneChunk?.content).toBe('主 Agent 无输出');
      expect(doneChunk?.data).toMatchObject({ finalScore: 0, rounds: 0, passed: false });

      expect(result.output).toBe('');
      expect(result.metadata?.qualityLoop).toMatchObject({
        passed: false,
        reason: 'empty_output'
      });
    });
  });

  describe('6. Execution failure', () => {
    it('yields run:error when agentExecutor.stream throws', async () => {
      const mockAgentExecutor = createMockAgentExecutor(async function* (): AsyncGenerator<
        StreamChunk,
        ExecutionResult,
        unknown
      > {
        yield { type: 'run:start', content: '' };
        throw new Error('Network error');
      });

      const { QualityLoopRuntime } = await import('../QualityLoopRuntime');
      const runtime = new QualityLoopRuntime({
        sessionId: 'test-session',
        agentExecutor: mockAgentExecutor
      });
      await runtime.initialize();

      const gen = runtime.stream('test input');
      const { chunks, result } = await consumeGenerator(gen);

      expect(mockValidate).not.toHaveBeenCalled();

      const errorChunk = chunks.find((c) => c.type === 'run:error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.content).toContain('主 Agent 执行失败');
      expect(errorChunk?.content).toContain('Network error');

      expect(result.output).toBe('');
      expect(result.metadata?.qualityLoop).toMatchObject({
        passed: false,
        reason: 'execution_failed'
      });
    });
  });
});
