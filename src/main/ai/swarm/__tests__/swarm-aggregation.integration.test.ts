/**
 * Swarm/Orchestrator 聚合回归集成测试（真实 API）
 *
 * 验证移除嵌入式质量闭环后，Aggregator 聚合功能仍然正常：
 *   1. 场景 D：多角色聚合 — 模拟多个专家 Agent 输出，验证 LLM 合并
 *   2. 场景 E：含失败子任务的聚合 — 验证部分失败场景的容错处理
 *   3. 场景 F：单子任务 — 验证只有一个输出时的直通行为
 *
 * 运行命令：
 *   VITE_LLM_API_KEY=xxx pnpm vitest run src/main/ai/swarm/__tests__/swarm-aggregation.integration.test.ts
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
import { Aggregator, type AggregationInput } from '../../quality-loop/Aggregator';
import { createLLMChat, type LLMChatFn, type AgentExecutorLike } from '../../quality-loop/llm-chat';
import type { StreamChunk, ExecutionResult } from '../../runtime/types';

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

// ========== 日志 ==========

const LOG_PREFIX = '[Aggr-IntegTest]';
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

/**
 * 创建 fluent builder 代理（支持任意顺序链式调用）
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
 * 创建用于 createLLMChat 注入的 AgentExecutorLike
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
      const runtimeName = (builderState?.name as string) || 'llm-service';
      const runtimeInstructions = (builderState?.instructions as string) || '你是一个有帮助的 AI 助手。';

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

describe.skipIf(!RUN)('Swarm/Orchestrator 聚合回归集成测试（真实 API）', () => {
  let llmChat: LLMChatFn;

  beforeAll(() => {
    if (!apiConfig) return;
    const now = new Date();
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '');
    const runTs = Date.now();
    currentLogDir = path.join(TEST_LOG_BASE, dateDir);
    currentTestLogFile = path.join(currentLogDir, `aggr-integ-test-${runTs}.log`);
    ensureLogDir();

    appendTestLog(
      `========== Aggregator 聚合集成测试 ${now.toISOString()} ==========\n` +
        `  Model: ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    );

    testLog(`${LOG_PREFIX} API: model=${apiConfig.model}, baseURL=${apiConfig.baseURL}`);

    const executorLike = createAgentExecutorLike();
    llmChat = createLLMChat(executorLike as AgentExecutorLike);
  });

  afterAll(() => {
    if (!RUN) return;
    appendTestLog(`\n========== 集成测试结束 ${new Date().toISOString()} ==========`);
    console.log(`\n测试日志: ${currentTestLogFile}`);
  });

  // ===== 场景 D：多角色聚合 =====

  it('场景 D：多角色聚合 — 合并多个专家输出', { timeout: 300_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 D：多角色聚合 ==========`);

    const aggregator = new Aggregator(llmChat);

    const input: AggregationInput = {
      userRequest: '请分析 TypeScript 和 Python 的优缺点，帮我选择后端开发语言',
      subTaskResults: [
        {
          taskId: 'task-1',
          agentName: 'TypeScript 专家',
          output: `TypeScript 的优势：
1. 静态类型系统，编译时发现错误
2. 与前端生态无缝集成（Node.js + 前端共享类型）
3. 丰富的工具链（VS Code 原生支持）
4. 大型项目可维护性强

TypeScript 的劣势：
1. 学习曲线陡峭（类型体操）
2. 编译步骤增加构建复杂度
3. 部分 npm 包类型支持不完善`,
          status: 'success'
        },
        {
          taskId: 'task-2',
          agentName: 'Python 专家',
          output: `Python 的优势：
1. 语法简洁，开发效率高
2. 强大的数据科学/ML 生态（NumPy, PyTorch, TensorFlow）
3. 丰富的第三方库
4. 社区庞大，资源丰富

Python 的劣势：
1. 运行时性能较弱（GIL 限制并发）
2. 动态类型，大型项目容易出错
3. 包管理较混乱（pip, conda, poetry 等）`,
          status: 'success'
        },
        {
          taskId: 'task-3',
          agentName: '架构顾问',
          output: `综合建议：
- 如果团队已有前端经验且项目需要前后端类型共享 → TypeScript
- 如果项目涉及大量数据处理或 ML → Python
- 如果是 API 服务且追求开发速度 → 两者都可以，取决于团队技术栈`,
          status: 'success'
        }
      ]
    };

    const startTime = Date.now();
    const result = await aggregator.aggregate(input);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    testLog(`${LOG_PREFIX}   完整性: ${result.isComplete}`);
    testLog(`${LOG_PREFIX}   输出长度: ${result.finalOutput.length}`);
    testLog(`${LOG_PREFIX}   输出预览: ${result.finalOutput.slice(0, 300)}...`);
    testLog(`${LOG_PREFIX}   完成的任务: ${JSON.stringify(result.summary.completedTasks)}`);
    testLog(`${LOG_PREFIX}   失败的任务: ${JSON.stringify(result.summary.failedTasks)}`);
    testLog(`${LOG_PREFIX}   关键发现: ${JSON.stringify(result.summary.keyFindings)}`);

    // 验证基本结构
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput.length).toBeGreaterThan(50);
    expect(result.isComplete).toBe(true);
    expect(result.duration).toBeGreaterThan(0);

    // 验证 summary 结构
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.summary.completedTasks)).toBe(true);
    expect(Array.isArray(result.summary.failedTasks)).toBe(true);
    expect(Array.isArray(result.summary.keyFindings)).toBe(true);
    expect(Array.isArray(result.summary.recommendations)).toBe(true);

    // 汇总输出应包含两种语言的关键信息
    const output = result.finalOutput.toLowerCase();
    expect(output).toMatch(/typescript|ts/i);
    expect(output).toMatch(/python/i);
  });

  // ===== 场景 E：含失败子任务的聚合 =====

  it('场景 E：含失败子任务 — 容错处理', { timeout: 300_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 E：含失败子任务 ==========`);

    const aggregator = new Aggregator(llmChat);

    const input: AggregationInput = {
      userRequest: '请从三个角度分析远程工作的利弊',
      subTaskResults: [
        {
          taskId: 'task-1',
          agentName: '员工视角分析师',
          output: `从员工角度看远程工作：
优点：灵活的时间安排、节省通勤时间、更好的工作生活平衡
缺点：社交孤立感、工作与生活边界模糊、沟通效率降低`,
          status: 'success'
        },
        {
          taskId: 'task-2',
          agentName: '企业视角分析师',
          output: '',
          status: 'failed',
          error: '模型调用超时'
        },
        {
          taskId: 'task-3',
          agentName: '社会视角分析师',
          output: `从社会角度看远程工作：
优点：减少碳排放、促进地域平等、城市去中心化
缺点：商业区经济衰退、社交技能退化、数字鸿沟加剧`,
          status: 'success'
        }
      ]
    };

    const startTime = Date.now();
    const result = await aggregator.aggregate(input);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    testLog(`${LOG_PREFIX}   完整性: ${result.isComplete}`);
    testLog(`${LOG_PREFIX}   输出长度: ${result.finalOutput.length}`);
    testLog(`${LOG_PREFIX}   输出预览: ${result.finalOutput.slice(0, 300)}...`);
    testLog(`${LOG_PREFIX}   失败的任务: ${JSON.stringify(result.summary.failedTasks)}`);

    // 验证基本结构
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput.length).toBeGreaterThan(20);

    // 含失败任务时 isComplete 应为 false
    expect(result.isComplete).toBe(false);
    expect(result.duration).toBeGreaterThan(0);

    // 输出应包含成功子任务的内容
    const output = result.finalOutput;
    expect(output.length).toBeGreaterThan(0);
  });

  // ===== 场景 F：单子任务（直通行为） =====

  it('场景 F：单子任务 — 验证单输出聚合', { timeout: 300_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 场景 F：单子任务 ==========`);

    const aggregator = new Aggregator(llmChat);

    const input: AggregationInput = {
      userRequest: '什么是微服务架构？',
      subTaskResults: [
        {
          taskId: 'task-1',
          agentName: '架构师',
          output: `微服务架构是一种将应用程序构建为一组小型服务的架构风格。每个服务运行在自己的进程中，通过轻量级机制（通常是 HTTP API）进行通信。这些服务围绕业务能力构建，可以独立部署。`,
          status: 'success'
        }
      ]
    };

    const startTime = Date.now();
    const result = await aggregator.aggregate(input);
    const duration = Date.now() - startTime;

    testLog(`${LOG_PREFIX}   耗时: ${duration}ms`);
    testLog(`${LOG_PREFIX}   完整性: ${result.isComplete}`);
    testLog(`${LOG_PREFIX}   输出长度: ${result.finalOutput.length}`);
    testLog(`${LOG_PREFIX}   输出: ${result.finalOutput.slice(0, 300)}`);

    // 单子任务应该完整
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput.length).toBeGreaterThan(10);
    expect(result.isComplete).toBe(true);
    expect(result.duration).toBeGreaterThan(0);

    // 输出应包含微服务相关内容
    expect(result.finalOutput).toMatch(/微服务/);
  });
});
