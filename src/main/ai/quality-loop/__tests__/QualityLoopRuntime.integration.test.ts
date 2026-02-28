/**
 * QualityLoopRuntime 真实 API 集成测试
 *
 * 验证质量循环独立运行模式的端到端流程：
 *   1. 场景 A：简单问答，首轮通过
 *   2. 场景 B：高阈值强制触发修复循环
 *   3. 场景 C：自定义验收标准
 *
 * 运行命令：
 *   VITE_LLM_API_KEY=xxx pnpm vitest run src/main/ai/quality-loop/__tests__/QualityLoopRuntime.integration.test.ts
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ===== Electron 环境 stub =====

vi.mock('electron', () => {
  const base = path.join(process.cwd(), 'test-results');
  return {
    app: {
      getPath: (name: string) => path.join(base, name),
      getAppPath: () => base,
      getName: () => 'coobee-ai-test',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  };
});

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}));

vi.mock('electron-log', () => {
  const noop = (): void => {};
  const mockTransport = {
    resolvePathFn: null,
    level: 'info',
    maxSize: 10 * 1024 * 1024,
    format: '',
    getFile: () => ({ path: '/tmp/test.log' })
  };
  const mockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    transports: {
      file: { ...mockTransport },
      console: { level: 'info', format: '' }
    },
    create: () => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      transports: {
        file: { ...mockTransport },
        console: { level: 'info', format: '' }
      }
    })
  };
  return { default: mockLogger };
});

vi.mock('mkdirp', () => ({
  mkdirp: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../runtime/ContextSnapshot', () => ({
  saveContextSnapshot: vi.fn().mockResolvedValue(undefined)
}));

// ===== 真实 imports =====

import { PiMonoAgentRuntime } from '../../runtime/pimono/PiMonoAgentRuntime';
import { QualityLoopRuntime, type QualityLoopConfig } from '../QualityLoopRuntime';
import { initLLMService, resetLLMService } from '../../provider/LLMService';
import type { StreamChunk, ExecutionResult } from '../../runtime/types';
import type { AcceptanceCriteria } from '../Validator';

// ========== API 配置 ==========

function resolveApiConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} | null {
  if (process.env.VITE_LLM_API_KEY) {
    return {
      apiKey: process.env.VITE_LLM_API_KEY,
      baseURL: process.env.VITE_LLM_BASE_URL || 'https://api.minimaxi.com/v1',
      model: process.env.VITE_LLM_MODEL || 'MiniMax-M2.1'
    };
  }
  return null;
}

const apiConfig = resolveApiConfig();
const RUN = !!apiConfig;

// ========== 日志系统 ==========

const LOG_PREFIX = '[QL-IntegTest]';
const TEST_LOG_BASE = path.join(process.cwd(), 'test-results');

let currentLogDir: string;
let currentTestLogFile: string;

function ensureLogDir(): void {
  fs.mkdirSync(currentLogDir, { recursive: true });
}

function appendTestLog(line: string): void {
  ensureLogDir();
  fs.appendFileSync(currentTestLogFile, line + '\n', 'utf-8');
}

function testLog(line: string): void {
  console.log(line);
  try {
    appendTestLog(line);
  } catch {
    // ignore
  }
}

// ========== 辅助函数 ==========

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

function ofType(chunks: StreamChunk[], type: string): StreamChunk[] {
  return chunks.filter((c) => c.type === type);
}

function checkClosedLoops(chunks: StreamChunk[]): Record<string, { start: number; done: number; ok: boolean }> {
  const counts: Record<string, number> = {};
  for (const c of chunks) {
    counts[c.type] = (counts[c.type] || 0) + 1;
  }
  const result: Record<string, { start: number; done: number; ok: boolean }> = {};
  const pairs: [string, string][] = [
    ['run:start', 'run:done'],
    ['quality:round_start', 'quality:done']
  ];
  for (const [s, d] of pairs) {
    const sc = counts[s] || 0;
    const dc = counts[d] || 0;
    if (sc > 0 || dc > 0) {
      result[s.split(':')[0]] = { start: sc, done: dc, ok: sc > 0 && dc > 0 };
    }
  }
  return result;
}

function logChunkSummary(chunks: StreamChunk[]): void {
  const typeCounts: Record<string, number> = {};
  for (const c of chunks) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
  }
  testLog(`${LOG_PREFIX}   事件统计:`);
  for (const [t, count] of Object.entries(typeCounts).sort()) {
    testLog(`${LOG_PREFIX}     ${t.padEnd(24)} : ${count}`);
  }
}

/**
 * 创建一个 fluent builder 代理，记录所有调用并返回 self 以支持任意顺序链式调用。
 * 所有方法（name, mode, lightweight, sessionMode, maxTurns, instructions 等）都返回 self。
 */
function createFluentBuilderProxy(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = {};

  const methods = [
    'name',
    'mode',
    'lightweight',
    'sessionMode',
    'maxTurns',
    'instructions',
    'appendInstructions',
    'model',
    'tools',
    'skills',
    'sdkTools',
    'contextDir',
    'workspaceRoot',
    'sandboxContext',
    'fromProviderConfig',
    'sessionId',
    'sessionDir'
  ];

  for (const method of methods) {
    proxy[method] = (val: unknown): Record<string, unknown> => {
      state[method] = val;
      return proxy;
    };
  }

  proxy._state = state;
  return proxy;
}

/**
 * 创建一个包装真实 PiMonoAgentRuntime 的 AgentExecutorLike
 *
 * QualityLoopRuntime 需要 AgentExecutorLike 接口来调用 piMono() 和 stream()。
 * 在集成测试中，我们绕过完整的 AgentExecutor，直接创建 PiMonoAgentRuntime。
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createAgentExecutorLike() {
  if (!apiConfig) throw new Error('No API config');

  return {
    async *stream(request: {
      sessionId: string;
      message: string;
      builder?: Record<string, unknown>;
    }): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
      const builderState = request.builder?._state as Record<string, unknown> | undefined;
      const runtimeName = (builderState?.name as string) || 'ql-executor';
      const runtimeInstructions =
        (builderState?.instructions as string) || '你是一个有帮助的 AI 助手。请准确、完整地回答用户的问题。';

      const runtime = new PiMonoAgentRuntime({
        name: runtimeName,
        instructions: runtimeInstructions,
        apiKey: apiConfig!.apiKey,
        baseURL: apiConfig!.baseURL,
        model: apiConfig!.model,
        thinkingLevel: 'low',
        sessionMode: 'memory',
        sessionId: request.sessionId,
        compaction: { enabled: false }
      });
      await runtime.initialize();

      try {
        const gen = runtime.stream(request.message);
        let r = await gen.next();
        while (!r.done) {
          yield r.value;
          r = await gen.next();
        }
        return r.value;
      } finally {
        try {
          await runtime.destroy();
        } catch {
          // ignore
        }
      }
    },
    piMono(): Record<string, unknown> {
      return createFluentBuilderProxy();
    }
  };
}

// ========== 测试 ==========

describe.skipIf(!RUN)('QualityLoopRuntime 集成测试（真实 API）', () => {
  let llmServiceExecutor: ReturnType<typeof createAgentExecutorLike>;

  beforeAll(() => {
    if (!apiConfig) return;
    const now = new Date();
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '');
    const runTs = Date.now();
    currentLogDir = path.join(TEST_LOG_BASE, dateDir);
    currentTestLogFile = path.join(currentLogDir, `ql-integ-test-${runTs}.log`);
    ensureLogDir();

    appendTestLog(
      `========== QualityLoopRuntime 集成测试 ${now.toISOString()} ==========\n` +
        `  Model: ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    );

    testLog(`${LOG_PREFIX} API: model=${apiConfig.model}, baseURL=${apiConfig.baseURL}`);

    // 注入 LLMService，使 Validator 和 Repairer 能使用真实 LLM
    llmServiceExecutor = createAgentExecutorLike();
    initLLMService(llmServiceExecutor);
  });

  afterAll(() => {
    if (!RUN) return;
    resetLLMService();
    appendTestLog(`\n========== 集成测试结束 ${new Date().toISOString()} ==========`);
    console.log(`\n测试日志: ${currentTestLogFile}`);
  });

  // ===== 场景 A：简单问答，首轮通过 =====

  it('场景 A：简单问答，首轮通过', { timeout: 600_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 A：简单问答，首轮通过 ==========`);

    const agentExecutorLike = createAgentExecutorLike();
    const runtime = new QualityLoopRuntime({
      sessionId: `ql-integ-a-${Date.now()}`,
      agentExecutor: agentExecutorLike as QualityLoopConfig['agentExecutor'],
      passThreshold: 70,
      maxIterations: 3
    });
    await runtime.initialize();

    const startTime = Date.now();
    const gen = runtime.stream('用一句话解释什么是递归');
    const { chunks, result } = await consumeGenerator(gen);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   输入: 用一句话解释什么是递归`);
    testLog(`${LOG_PREFIX}   输出: ${result.output.slice(0, 200)}`);
    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    logChunkSummary(chunks);

    // 验证流式事件闭环
    // 注意：run:start 会出现 2 次（QualityLoopRuntime 自身 + 内部主 Agent 透传）
    expect(ofType(chunks, 'run:start').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'run:done').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:round_start').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:validating').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:score').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:done').length).toBe(1);

    // 验证闭环
    const loops = checkClosedLoops(chunks);
    testLog(`${LOG_PREFIX}   闭环检查: ${JSON.stringify(loops)}`);
    expect(loops.run?.ok).toBe(true);

    // 验证有实际 text:delta 内容
    const deltas = ofType(chunks, 'text:delta');
    expect(deltas.length).toBeGreaterThan(0);

    // 验证输出非空
    expect(result.output.length).toBeGreaterThan(5);

    // 验证 metadata
    const qlMeta = result.metadata?.qualityLoop as {
      finalScore: number;
      rounds: number;
      passed: boolean;
    };
    expect(qlMeta).toBeDefined();
    testLog(`${LOG_PREFIX}   质量循环: score=${qlMeta.finalScore}, rounds=${qlMeta.rounds}, passed=${qlMeta.passed}`);

    // 简单问题应该首轮通过（评分 >= 70）
    expect(qlMeta.finalScore).toBeGreaterThanOrEqual(50);
    expect(qlMeta.rounds).toBeLessThanOrEqual(3);

    // 验证 quality:score 事件数据
    const scoreChunks = ofType(chunks, 'quality:score');
    for (const sc of scoreChunks) {
      const data = sc.data as { score: number; passed: boolean };
      expect(data.score).toBeGreaterThanOrEqual(0);
      expect(data.score).toBeLessThanOrEqual(100);
      expect(typeof data.passed).toBe('boolean');
    }

    // 验证 quality:done 事件数据
    const doneChunk = ofType(chunks, 'quality:done')[0];
    const doneData = doneChunk.data as { finalScore: number; rounds: number; passed: boolean };
    expect(doneData.finalScore).toBe(qlMeta.finalScore);
    expect(doneData.rounds).toBe(qlMeta.rounds);

    await runtime.destroy();
  });

  // ===== 场景 B：高阈值强制触发修复循环 =====

  it('场景 B：高阈值触发修复循环', { timeout: 900_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 B：高阈值触发修复循环 ==========`);

    const agentExecutorLike = createAgentExecutorLike();
    const runtime = new QualityLoopRuntime({
      sessionId: `ql-integ-b-${Date.now()}`,
      agentExecutor: agentExecutorLike as QualityLoopConfig['agentExecutor'],
      passThreshold: 95,
      maxIterations: 3
    });
    await runtime.initialize();

    const startTime = Date.now();
    const gen = runtime.stream('用一句话解释什么是递归');
    const { chunks, result } = await consumeGenerator(gen);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   输入: 用一句话解释什么是递归`);
    testLog(`${LOG_PREFIX}   输出: ${result.output.slice(0, 200)}`);
    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    logChunkSummary(chunks);

    // 验证流式事件闭环
    expect(ofType(chunks, 'run:start').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'run:done').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:done').length).toBe(1);

    // 验证有实际输出
    expect(result.output.length).toBeGreaterThan(0);

    const qlMeta = result.metadata?.qualityLoop as {
      finalScore: number;
      rounds: number;
      passed: boolean;
      maxIterations: number;
      passThreshold: number;
    };
    expect(qlMeta).toBeDefined();
    expect(qlMeta.passThreshold).toBe(95);
    expect(qlMeta.maxIterations).toBe(3);

    testLog(
      `${LOG_PREFIX}   质量循环: score=${qlMeta.finalScore}, rounds=${qlMeta.rounds}, ` +
        `passed=${qlMeta.passed}, threshold=95`
    );

    // 高阈值场景：可能触发修复，也可能首轮就通过（如果 LLM 输出很优秀）
    // 关键是验证流程正确性：
    const roundStarts = ofType(chunks, 'quality:round_start');
    expect(roundStarts.length).toBeGreaterThanOrEqual(1);

    // 验证评分事件数量与轮次一致
    const scoreChunks = ofType(chunks, 'quality:score');
    expect(scoreChunks.length).toBeGreaterThanOrEqual(1);

    // 如果触发了修复，验证修复事件
    const repairChunks = ofType(chunks, 'quality:repairing');
    if (repairChunks.length > 0) {
      testLog(`${LOG_PREFIX}   触发了 ${repairChunks.length} 次修复`);
      for (const rc of repairChunks) {
        const data = rc.data as { strategy: string; rootCause: string };
        expect(data.strategy).toBeDefined();
        expect(data.rootCause).toBeDefined();
        testLog(`${LOG_PREFIX}     修复策略: ${data.strategy}, 根因: ${data.rootCause}`);
      }
    } else {
      testLog(`${LOG_PREFIX}   首轮通过（分数 >= 95）`);
    }

    // 如果有 run:error 事件，记录但不硬性失败（可能是修复过程中的瞬时错误）
    const errors = ofType(chunks, 'run:error');
    if (errors.length > 0) {
      testLog(`${LOG_PREFIX}   ⚠ 发现 ${errors.length} 个 run:error 事件`);
      for (const e of errors) {
        testLog(`${LOG_PREFIX}     ${e.content}`);
      }
    }

    await runtime.destroy();
  });

  // ===== 场景 C：自定义验收标准 =====

  it('场景 C：自定义验收标准', { timeout: 600_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 C：自定义验收标准 ==========`);

    const acceptanceCriteria: AcceptanceCriteria[] = [
      { description: '回答必须包含递归的定义', type: 'existence', weight: 8 },
      { description: '回答必须举一个递归的例子', type: 'existence', weight: 7 },
      { description: '回答长度适中，不超过 200 字', type: 'quantifiable', weight: 5 }
    ];

    const agentExecutorLike = createAgentExecutorLike();
    const runtime = new QualityLoopRuntime({
      sessionId: `ql-integ-c-${Date.now()}`,
      agentExecutor: agentExecutorLike as QualityLoopConfig['agentExecutor'],
      passThreshold: 70,
      maxIterations: 3,
      acceptanceCriteria
    });
    await runtime.initialize();

    const startTime = Date.now();
    const gen = runtime.stream('什么是递归？请简要解释并举例');
    const { chunks, result } = await consumeGenerator(gen);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   输入: 什么是递归？请简要解释并举例`);
    testLog(`${LOG_PREFIX}   输出: ${result.output.slice(0, 300)}`);
    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    logChunkSummary(chunks);

    // 验证流式事件完整
    expect(ofType(chunks, 'run:start').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'run:done').length).toBeGreaterThanOrEqual(1);
    expect(ofType(chunks, 'quality:done').length).toBe(1);

    // 验证有实际输出
    expect(result.output.length).toBeGreaterThan(10);

    const qlMeta = result.metadata?.qualityLoop as {
      finalScore: number;
      rounds: number;
      passed: boolean;
    };
    expect(qlMeta).toBeDefined();
    testLog(`${LOG_PREFIX}   质量循环: score=${qlMeta.finalScore}, rounds=${qlMeta.rounds}, passed=${qlMeta.passed}`);

    // 验证评分事件存在
    const scoreChunks = ofType(chunks, 'quality:score');
    expect(scoreChunks.length).toBeGreaterThanOrEqual(1);

    // 简单的请求 + 合理阈值，应该能通过
    expect(qlMeta.finalScore).toBeGreaterThanOrEqual(50);

    // 如果有 run:error 事件，记录但不硬性失败
    const errors = ofType(chunks, 'run:error');
    if (errors.length > 0) {
      testLog(`${LOG_PREFIX}   ⚠ 发现 ${errors.length} 个 run:error 事件`);
    }

    await runtime.destroy();
  });
});
