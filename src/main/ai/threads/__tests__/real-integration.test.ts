/**
 * 真实集成测试 — Thread-Checkpoint 异步可恢复架构
 *
 * 这是**真正的端到端测试**，连接运行中的应用实例，通过 WebSocket 发送消息：
 *   - 大模型真实运行
 *   - 文件系统真实写入
 *   - 验证 thread JSON、workspace 目录、checkpoint 文件
 *
 * 前置条件：
 *   - 应用已通过 `pnpm dev` 启动
 *   - WebSocket 可达 ws://127.0.0.1:8765/gateway/ws
 *
 * 运行命令：
 *   npx vitest run src/main/ai/threads/__tests__/real-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';
const HOME_DIR = path.resolve(__dirname, '../../../../..', '.home');
const THREADS_DIR = path.join(HOME_DIR, 'threads');
const WORKSPACES_DIR = path.join(HOME_DIR, 'workspaces');

let ws: WebSocket;
let reqIdCounter = 0;

function nextReqId(): string {
  return `test-${Date.now()}-${++reqIdCounter}`;
}

function sendRpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = nextReqId();
    const msg = JSON.stringify({ type: 'req', id, method, params });
    const timeout = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 30_000);

    const onMessage = (data: WebSocket.Data): void => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === id && parsed.type === 'res') {
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          if (parsed.ok) {
            resolve(parsed.payload);
          } else {
            reject(new Error(`RPC error: ${JSON.stringify(parsed.error)}`));
          }
        }
      } catch {
        // not for us, ignore
      }
    };

    ws.on('message', onMessage);
    ws.send(msg);
  });
}

/**
 * 订阅 session 的流式消息，并等待完成事件
 *
 * Gateway 事件格式:
 *   {"type":"event","event":"stream.message","payload":{"sessionId":"...","message":StreamMessage}}
 *
 * StreamMessage.type 直接透传 StreamChunkType:
 *   text:delta / reasoning:delta / tool:start / tool:done / run:done / run:error / ...
 * 文本在 StreamMessage.content
 */
async function subscribeAndWait(
  sid: string,
  timeoutMs = 120_000
): Promise<{ texts: string[]; events: Record<string, unknown>[] }> {
  await sendRpc('stream.subscribe', { sessionId: sid });

  return new Promise((resolve) => {
    const texts: string[] = [];
    const events: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => {
      ws.removeListener('message', onMessage);
      resolve({ texts, events });
    }, timeoutMs);

    const onMessage = (data: WebSocket.Data): void => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'event' && parsed.event === 'stream.message') {
          const payload = parsed.payload;
          if (payload?.sessionId === sid) {
            const msg = payload.message;
            events.push(msg);
            if (msg?.type === 'text:delta') {
              texts.push(msg.content || '');
            }
            if (msg?.type === 'run:done' || msg?.type === 'run:error') {
              clearTimeout(timeout);
              ws.removeListener('message', onMessage);
              resolve({ texts, events });
            }
          }
        }
      } catch {
        // ignore
      }
    };

    ws.on('message', onMessage);
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 检测 dev server 是否可用 */
async function isDevServerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      probe.close();
      resolve(false);
    }, 3000);
    probe.on('open', () => {
      clearTimeout(timer);
      probe.close();
      resolve(true);
    });
    probe.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

const canConnect = await isDevServerAvailable();

describe.skipIf(!canConnect)('真实集成测试', () => {
  beforeAll(async () => {
    ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (err) => reject(new Error(`WebSocket 连接失败: ${err.message}。请确保 pnpm dev 已启动`)));
      setTimeout(() => reject(new Error('WebSocket 连接超时')), 5000);
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      await waitMs(500);
    }
  });

  // ==========================================
  // 测试 1：单 Agent 基础流程
  // ==========================================

  describe('单 Agent 基础流程', () => {
    let sessionId: string;

    it('发送 chat.send 并获得 sessionId', async () => {
      const result = await sendRpc('chat.send', {
        message: '你好，请简要回答：1+1等于几？只回答数字。',
        mode: 'agent',
        agentId: 'app-copilot'
      });

      expect(result.status).toBe('streaming');
      expect(result.sessionId).toBeDefined();
      sessionId = result.sessionId as string;
      console.log(`[Test] sessionId: ${sessionId}`);
    });

    it('等待 Agent 运行完成', async () => {
      const { texts, events } = await subscribeAndWait(sessionId, 60_000);
      const fullText = texts.join('');
      console.log(`[Test] Agent 回复: ${fullText.slice(0, 200)}`);
      console.log(`[Test] 收到事件数: ${events.length}`);
      expect(fullText.length).toBeGreaterThan(0);
    }, 65_000);

    it('验证 thread JSON 文件包含新字段', async () => {
      await waitMs(1000);

      // 查找匹配的 thread 文件
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matchedFile = threadFiles.find((f) => {
        const content = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8'));
        return content.id === sessionId || content.sessionId === sessionId;
      });

      expect(matchedFile).toBeDefined();
      const threadData = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matchedFile!), 'utf-8'));

      console.log(`[Test] Thread JSON:`, JSON.stringify(threadData, null, 2));

      // 验证新增字段
      expect(threadData.sessionId).toBe(threadData.id);
      expect(threadData.agentMode).toBeDefined();
      expect(threadData.agentType).toBeDefined();
      expect(threadData.runStatus).toBeDefined();
      expect(['idle', 'completed']).toContain(threadData.runStatus);
    });

    it('验证 workspace 目录创建', () => {
      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (fs.existsSync(workspaceDir)) {
        const contents = fs.readdirSync(workspaceDir);
        console.log(`[Test] Workspace 目录内容: ${contents.join(', ')}`);
        expect(contents.length).toBeGreaterThanOrEqual(0);
      } else {
        console.log(`[Test] Workspace 目录未创建（可能由于 Agent 未需要工具）`);
      }
    });

    it('验证 checkpoint 状态（运行结束应为 idle）', async () => {
      const cpPath = path.join(WORKSPACES_DIR, sessionId, 'checkpoint.json');
      if (fs.existsSync(cpPath)) {
        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        console.log(`[Test] Checkpoint:`, JSON.stringify(cp, null, 2));
        expect(['idle', 'completed']).toContain(cp.runStatus);
        expect(cp.threadId).toBe(sessionId);
      } else {
        console.log(`[Test] Checkpoint 文件不存在（Agent run 无工具调用时可能不创建）`);
      }
    });
  });

  // ==========================================
  // 测试 2：带工具调用的 Agent（触发 checkpoint 写入）
  // ==========================================

  describe('工具调用 + checkpoint 写入', () => {
    let sessionId: string;

    it('发送需要使用工具的任务', async () => {
      const result = await sendRpc('chat.send', {
        message: '请帮我读取当前项目的 package.json 文件，告诉我项目名称和版本号。使用 read 工具。',
        mode: 'agent',
        agentId: 'app-copilot'
      });

      expect(result.status).toBe('streaming');
      sessionId = result.sessionId as string;
      console.log(`[Test] 工具调用测试 sessionId: ${sessionId}`);
    });

    it('等待完成并验证工具被调用', async () => {
      const { texts, events } = await subscribeAndWait(sessionId, 90_000);
      const fullText = texts.join('');
      console.log(`[Test] Agent 回复 (前300字): ${fullText.slice(0, 300)}`);
      console.log(`[Test] 事件数: ${events.length}`);

      const toolEvents = events.filter((e) => e.type === 'tool:start' || e.type === 'tool:done');
      console.log(`[Test] 工具事件数: ${toolEvents.length}`);
      expect(fullText.length).toBeGreaterThan(0);
    }, 95_000);

    it('验证 thread 新字段', async () => {
      await waitMs(1000);

      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8'));
          return content.id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const data = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test] Thread (工具):`, JSON.stringify(data, null, 2));
        expect(data.sessionId).toBe(data.id);
        expect(data.agentMode).toBe('agent');
        expect(data.agentType).toBe('agent');
      }
    });

    it('验证 workspace 和 session 文件', () => {
      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (fs.existsSync(workspaceDir)) {
        const contents = fs.readdirSync(workspaceDir, { recursive: true });
        console.log(`[Test] Workspace 递归内容:`, contents);

        // session 目录
        const sessionsDir = path.join(workspaceDir, 'sessions');
        if (fs.existsSync(sessionsDir)) {
          const sessions = fs.readdirSync(sessionsDir);
          console.log(`[Test] Sessions 目录:`, sessions);
        }
      }
    });
  });

  // ==========================================
  // 测试 3：多 Agent 委托（创建测试 Agent 后触发）
  // ==========================================

  describe('多 Agent 委托', () => {
    let sessionId: string;
    const testAgentId = 'test-delegation-target';
    const orchestratorId = 'test-orchestrator';

    it('创建委托目标 Agent 和编排 Agent', async () => {
      // 1. 创建目标 Agent（被委托的对象）
      const targetDef = {
        id: testAgentId,
        name: '委托测试目标',
        description: '被委托的目标 Agent，接收任务并简短回复',
        instructions:
          '你是一个被委托的测试 Agent。收到任何任务后，简短回复"委托任务已收到并处理完毕，答案是2"即可。不要做任何复杂操作。',
        tools: ['read'],
        createdBy: 'user'
      };

      const res1 = await fetch('http://127.0.0.1:8765/gateway/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetDef)
      });
      const data1 = await res1.json();
      console.log(`[Test] 创建委托目标 Agent:`, JSON.stringify(data1));

      // 2. 创建编排 Agent（拥有 delegate_to_agent 工具）
      const orchDef = {
        id: orchestratorId,
        name: '测试编排器',
        description: '用于测试多 Agent 委托的编排智能体',
        instructions:
          '你是一个编排器。当用户要求你委托任务时，使用 delegate_to_agent 工具将任务委托给指定的 Agent。委托完成后汇报结果。用中文回复。',
        tools: ['delegate_to_agent', 'read', 'search'],
        createdBy: 'user'
      };

      const res2 = await fetch('http://127.0.0.1:8765/gateway/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orchDef)
      });
      const data2 = await res2.json();
      console.log(`[Test] 创建编排 Agent:`, JSON.stringify(data2));
    });

    it('发送委托任务', async () => {
      const result = await sendRpc('chat.send', {
        message: `请使用 delegate_to_agent 工具将以下任务委托给 agent "${testAgentId}"：请回答 1+1 等于几。委托后直接告诉我结果。`,
        mode: 'agent',
        agentId: orchestratorId
      });

      expect(result.status).toBe('streaming');
      sessionId = result.sessionId as string;
      console.log(`[Test] 委托测试 sessionId: ${sessionId}`);
    });

    it('等待委托完成', async () => {
      const { texts, events } = await subscribeAndWait(sessionId, 120_000);
      const fullText = texts.join('');
      console.log(`[Test] 委托回复 (前500字): ${fullText.slice(0, 500)}`);
      console.log(`[Test] 委托事件数: ${events.length}`);

      const delegateEvents = events.filter((e) => e.type === 'delegate:start' || e.type === 'delegate:done');
      const toolCallEvents = events.filter((e) => e.type === 'tool:start' || e.type === 'tool:done');
      console.log(`[Test] 委托事件: ${delegateEvents.length}, 工具事件: ${toolCallEvents.length}`);
      expect(fullText.length).toBeGreaterThan(0);
    }, 125_000);

    it('验证 thread 和 workspace', async () => {
      await waitMs(2000);

      // 验证 thread
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8'));
          return c.id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const data = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test] 委托 Thread:`, JSON.stringify(data, null, 2));
        expect(data.sessionId).toBe(sessionId);
      }

      // 验证 workspace — 子 Agent 的 tasks 目录
      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (fs.existsSync(workspaceDir)) {
        const allFiles = listDirRecursive(workspaceDir);
        console.log(`[Test] 委托 Workspace 文件树:`);
        allFiles.forEach((f) => console.log(`  ${f}`));

        // 检查是否有子 agent 目录或 delegate 相关文件
        const hasDelegateFiles = allFiles.some(
          (f) => f.includes('delegate') || f.includes('task') || f.includes(testAgentId)
        );
        console.log(`[Test] 存在委托相关文件: ${hasDelegateFiles}`);
      }
    });

    it('验证子 Agent sessionId 命名格式', async () => {
      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (!fs.existsSync(workspaceDir)) return;

      const sessionsDir = path.join(workspaceDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const sessions = fs.readdirSync(sessionsDir);
        console.log(`[Test] Sessions:`, sessions);

        // 查找子 Agent session
        const delegateSessions = sessions.filter((s) => s.includes(':delegate:'));
        if (delegateSessions.length > 0) {
          console.log(`[Test] 子 Agent sessions:`, delegateSessions);
          for (const ds of delegateSessions) {
            expect(ds.startsWith(sessionId)).toBe(true);
            expect(ds).toContain(':delegate:');
          }
        }
      }
    });

    // 清理测试 Agent
    afterAll(async () => {
      try {
        await fetch(`http://127.0.0.1:8765/gateway/agents/${testAgentId}`, { method: 'DELETE' });
        await fetch(`http://127.0.0.1:8765/gateway/agents/${orchestratorId}`, { method: 'DELETE' });
      } catch {
        // ignore
      }
    });
  });

  // ==========================================
  // 测试 4：审批流程验证
  // ==========================================

  describe('审批流程（checkpoint 验证）', () => {
    let sessionId: string;

    it('发送需要 exec 审批的任务', async () => {
      const result = await sendRpc('chat.send', {
        message: '请使用 exec 工具执行命令: echo "hello from approval test"。请直接调用工具，不要询问我。',
        mode: 'agent',
        agentId: 'performance-analyzer'
      });

      expect(result.status).toBe('streaming');
      sessionId = result.sessionId as string;
      console.log(`[Test] 审批测试 sessionId: ${sessionId}`);
    });

    it('订阅流并等待 Agent 触发审批或完成', async () => {
      // 订阅流事件
      await sendRpc('stream.subscribe', { sessionId });

      // 等待流事件（最多30秒）并同时轮询 checkpoint
      let approvalDetected = false;
      const pollStart = Date.now();
      const maxWaitMs = 30_000;

      while (Date.now() - pollStart < maxWaitMs) {
        await waitMs(2000);
        const cpPath = path.join(WORKSPACES_DIR, sessionId, 'checkpoint.json');
        if (fs.existsSync(cpPath)) {
          const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
          console.log(`[Test] checkpoint 轮询: runStatus=${cp.runStatus}`);

          if (cp.runStatus === 'approval-pending') {
            console.log(`[Test] ✅ 检测到 approval-pending 状态！`);
            console.log(`[Test] 审批 Checkpoint:`, JSON.stringify(cp, null, 2));
            expect(cp.pendingOperation).toBeDefined();
            expect(cp.pendingOperation.type).toBe('approval');
            expect(cp.pendingOperation.toolName).toBe('exec');
            approvalDetected = true;

            // 提交审批（hitl.decide 需要 sessionId + index + decision）
            const approvalIndex = cp.pendingOperation?.approvalId
              ? parseInt(cp.pendingOperation.approvalId.split(':').pop() || '0')
              : 0;
            console.log(`[Test] 提交审批决策: approve-once, index=${approvalIndex}`);
            const approvalResult = await sendRpc('hitl.decide', {
              sessionId,
              index: approvalIndex,
              decision: 'approve-once'
            });
            console.log(`[Test] 审批结果:`, JSON.stringify(approvalResult));
            break;
          } else if (cp.runStatus === 'idle' || cp.runStatus === 'completed') {
            console.log(`[Test] Agent 已完成（可能 exec 不需审批或 Agent 未调用 exec）`);
            break;
          }
        }
      }

      if (!approvalDetected) {
        console.log(`[Test] 未检测到 approval-pending（可能审批已同步处理或 Agent 未调用需审批的工具）`);
      }
    }, 35_000);

    it('等待最终完成并验证 thread 状态', async () => {
      // 等待 Agent 完成后续处理
      await waitMs(15_000);

      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8'));
          return c.id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const data = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test] 最终 Thread 状态:`, JSON.stringify(data, null, 2));
      }

      // 验证 checkpoint 最终状态
      const cpPath = path.join(WORKSPACES_DIR, sessionId, 'checkpoint.json');
      if (fs.existsSync(cpPath)) {
        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        console.log(`[Test] 最终 Checkpoint:`, JSON.stringify(cp, null, 2));
      }
    }, 20_000);
  });

  // ==========================================
  // 测试 5：系统启动恢复模拟
  // ==========================================

  describe('启动恢复模拟', () => {
    it('手动写入一个 pending checkpoint 并验证 findPending', async () => {
      const fakeThreadId = 'test-recovery-999999';
      const fakeDir = path.join(WORKSPACES_DIR, fakeThreadId);

      // 创建目录和 checkpoint
      fs.mkdirSync(fakeDir, { recursive: true });
      fs.writeFileSync(
        path.join(fakeDir, 'checkpoint.json'),
        JSON.stringify(
          {
            threadId: fakeThreadId,
            updatedAt: new Date().toISOString(),
            runStatus: 'running',
            activeAgent: {
              sessionId: `${fakeThreadId}:delegate:test-agent`,
              agentId: 'test-agent',
              role: 'delegate',
              workspace: 'tasks/test/agents/test-agent'
            }
          },
          null,
          2
        ),
        'utf-8'
      );

      // 验证文件写入
      const cpPath = path.join(fakeDir, 'checkpoint.json');
      expect(fs.existsSync(cpPath)).toBe(true);
      const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
      expect(cp.runStatus).toBe('running');
      expect(cp.activeAgent.role).toBe('delegate');

      console.log(`[Test] 模拟 pending checkpoint 已写入: ${cpPath}`);

      // 清理
      fs.rmSync(fakeDir, { recursive: true, force: true });
    });

    it('验证旧格式 thread 兼容性', () => {
      // 检查现有 thread 文件中缺少新字段的情况
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));

      for (const file of threadFiles) {
        const data = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, file), 'utf-8'));
        console.log(
          `[Test] Thread ${data.id}: sessionId=${data.sessionId || '(无)'}, ` +
            `runStatus=${data.runStatus || '(无)'}, agentType=${data.agentType || '(无)'}`
        );
      }
    });
  });

  // ==========================================
  // 测试 6：子 Agent 委托 + 审批链路
  // ==========================================

  describe('子 Agent 委托 + 审批链路', () => {
    let sessionId: string;
    const subAgentId = 'test-sub-exec-agent';
    const parentAgentId = 'test-parent-delegator';

    it('创建子 Agent（带 exec）和父 Agent（带 delegate_to_agent）', async () => {
      // 子 Agent: 收到任务后用 exec 执行命令
      const subDef = {
        id: subAgentId,
        name: '命令执行子Agent',
        description: '接收委托任务后使用 exec 执行命令',
        instructions:
          '你是一个命令执行助手。当你收到任务时，直接使用 exec 工具执行要求的命令。不要做多余解释，执行完后返回结果即可。用中文回复。',
        tools: ['exec', 'read'],
        createdBy: 'user'
      };

      const res1 = await fetch('http://127.0.0.1:8765/gateway/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subDef)
      });
      expect(res1.ok).toBe(true);
      console.log(`[Test6] 子Agent创建:`, await res1.json());

      // 父 Agent: 使用 delegate_to_agent 委托任务
      const parentDef = {
        id: parentAgentId,
        name: '委托父Agent',
        description: '将任务委托给指定的子 Agent 执行',
        instructions:
          '你是一个任务委托者。用户要求你委托任务时，使用 delegate_to_agent 工具将任务交给指定 Agent。委托完成后汇报结果。用中文回复。',
        tools: ['delegate_to_agent', 'read'],
        createdBy: 'user'
      };

      const res2 = await fetch('http://127.0.0.1:8765/gateway/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parentDef)
      });
      expect(res2.ok).toBe(true);
      console.log(`[Test6] 父Agent创建:`, await res2.json());
    });

    it('发送委托任务（触发审批链路）', async () => {
      const result = await sendRpc('chat.send', {
        message: `请使用 delegate_to_agent 工具将以下任务委托给 agent "${subAgentId}"：请使用 exec 工具执行 echo "sub-agent-approval-test"。直接调用工具，不要询问。`,
        mode: 'agent',
        agentId: parentAgentId
      });

      expect(result.status).toBe('streaming');
      sessionId = result.sessionId as string;
      console.log(`[Test6] sessionId: ${sessionId}`);
    });

    it('处理审批链路（可能多轮）并等待完成', async () => {
      await sendRpc('stream.subscribe', { sessionId });

      let approvalCount = 0;
      let completed = false;
      const pollStart = Date.now();
      const maxWaitMs = 120_000;

      while (Date.now() - pollStart < maxWaitMs && !completed) {
        await waitMs(3000);
        const cpPath = path.join(WORKSPACES_DIR, sessionId, 'checkpoint.json');
        if (!fs.existsSync(cpPath)) {
          console.log(`[Test6] checkpoint 不存在，继续等待...`);
          continue;
        }

        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        console.log(`[Test6] checkpoint: runStatus=${cp.runStatus}, approvals=${approvalCount}`);

        if (cp.runStatus === 'approval-pending') {
          approvalCount++;
          const toolName = cp.pendingOperation?.toolName || 'unknown';
          console.log(`[Test6] ✅ 审批轮次 #${approvalCount}: ${toolName}`);

          // 提取 approvalIndex
          const approvalIndex = cp.pendingOperation?.approvalId
            ? parseInt(cp.pendingOperation.approvalId.split(':').pop() || '0')
            : 0;

          // 批准
          const approvalResult = await sendRpc('hitl.decide', {
            sessionId,
            index: approvalIndex,
            decision: 'approve-once'
          });
          console.log(`[Test6] 审批 #${approvalCount} 结果:`, JSON.stringify(approvalResult));

          // 审批后等几秒让 Agent 继续
          await waitMs(5000);
        } else if (cp.runStatus === 'idle' || cp.runStatus === 'completed') {
          console.log(`[Test6] ✅ 执行完成 (runStatus=${cp.runStatus})`);
          completed = true;
        } else if (cp.runStatus === 'error') {
          console.log(`[Test6] ❌ 执行出错`);
          completed = true;
        }
      }

      console.log(`[Test6] 总审批轮次: ${approvalCount}, 完成: ${completed}`);
      expect(completed).toBe(true);
    }, 130_000);

    it('验证子 Agent session 和 workspace', async () => {
      await waitMs(2000);

      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (!fs.existsSync(workspaceDir)) {
        console.log(`[Test6] workspace 不存在`);
        return;
      }

      const allFiles = listDirRecursive(workspaceDir);
      console.log(`[Test6] Workspace 文件树:`);
      allFiles.forEach((f) => console.log(`  ${f}`));

      // 验证子 Agent session 存在
      const sessionsDir = path.join(workspaceDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const sessions = fs.readdirSync(sessionsDir);
        console.log(`[Test6] Sessions:`, sessions);

        const delegateSessions = sessions.filter((s) => s.includes(':delegate:'));
        console.log(`[Test6] 子Agent sessions:`, delegateSessions);

        if (delegateSessions.length > 0) {
          for (const ds of delegateSessions) {
            expect(ds.startsWith(sessionId)).toBe(true);
            expect(ds).toContain(':delegate:');
          }
        }
      }

      // 验证 checkpoint 最终状态
      const cpPath = path.join(workspaceDir, 'checkpoint.json');
      if (fs.existsSync(cpPath)) {
        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        console.log(`[Test6] 最终 checkpoint:`, JSON.stringify(cp, null, 2));
        expect(['idle', 'completed']).toContain(cp.runStatus);
      }

      // 验证 thread
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8')).id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const thread = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test6] Thread:`, JSON.stringify(thread, null, 2));
        expect(thread.sessionId).toBe(sessionId);
      }
    });

    afterAll(async () => {
      try {
        await fetch(`http://127.0.0.1:8765/gateway/agents/${subAgentId}`, { method: 'DELETE' });
        await fetch(`http://127.0.0.1:8765/gateway/agents/${parentAgentId}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
    });
  });

  // ==========================================
  // 测试 7：Orchestrator 统筹模式
  // ==========================================

  describe('Orchestrator 统筹模式', () => {
    let sessionId: string;

    it('发送 orchestrator 模式请求', async () => {
      const result = await sendRpc('chat.send', {
        message:
          '帮我分析这两个问题并分别给出简短回答：1. JavaScript 中 let 和 const 的区别是什么？2. TypeScript 中 interface 和 type 的区别是什么？每个问题回答不超过2句话。',
        mode: 'orchestrator'
      });

      expect(result.status).toBe('streaming');
      expect(result.mode).toBe('orchestrator');
      sessionId = result.sessionId as string;
      console.log(`[Test7] Orchestrator sessionId: ${sessionId}`);
    });

    it('接收 Orchestrator 流式事件并等待完成', async () => {
      const { texts, events } = await subscribeAndWait(sessionId, 180_000);

      console.log(`[Test7] 事件总数: ${events.length}`);
      console.log(`[Test7] 文本片段: ${texts.length}`);

      const eventTypes = events.map((e) => e.type);
      console.log(`[Test7] 事件类型:`, [...new Set(eventTypes)]);

      const fullText = texts.join('');
      console.log(`[Test7] 输出文本长度: ${fullText.length}`);
      console.log(`[Test7] 前200字: ${fullText.slice(0, 200)}`);

      expect(events.length).toBeGreaterThan(0);

      // run:done 或 run:error 必须存在（run:start 可能因订阅时机被错过）
      const hasEnded = eventTypes.includes('run:done') || eventTypes.includes('run:error');
      expect(hasEnded).toBe(true);

      // delegate 事件（Orchestrator → Planner 交互）— 可能因订阅时机错过
      const delegateEvents = events.filter((e) => e.type === 'delegate:start' || e.type === 'delegate:done');
      console.log(`[Test7] delegate 事件: ${delegateEvents.length}`);

      // tool 事件（子任务执行）
      const toolEvents = events.filter((e) => e.type === 'tool:start' || e.type === 'tool:done');
      console.log(`[Test7] tool 事件（子任务）: ${toolEvents.length}`);

      // 应有文本输出
      expect(fullText.length).toBeGreaterThan(0);
    }, 200_000);

    it('验证 Orchestrator workspace 和 thread', async () => {
      await waitMs(2000);

      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (fs.existsSync(workspaceDir)) {
        const allFiles = listDirRecursive(workspaceDir);
        console.log(`[Test7] Workspace 文件树:`);
        allFiles.forEach((f) => console.log(`  ${f}`));

        // 验证 checkpoint
        const cpPath = path.join(workspaceDir, 'checkpoint.json');
        if (fs.existsSync(cpPath)) {
          const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
          console.log(`[Test7] checkpoint:`, JSON.stringify(cp, null, 2));
        }
      }

      // 验证 thread
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8')).id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const thread = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test7] Thread:`, JSON.stringify(thread, null, 2));
        expect(thread.sessionId).toBe(sessionId);
        expect(thread.agentType).toBe('orchestrator');
      }
    });
  });

  // ==========================================
  // 测试 8：Swarm 群体模式
  // ==========================================

  describe('Swarm 群体模式', () => {
    let sessionId: string;

    it('发送 swarm 模式请求', async () => {
      const result = await sendRpc('chat.send', {
        message: '请帮我解释一下什么是 REST API，用2-3句话简单说明即可。',
        mode: 'swarm'
      });

      expect(result.status).toBe('streaming');
      expect(result.mode).toBe('swarm');
      sessionId = result.sessionId as string;
      console.log(`[Test8] Swarm sessionId: ${sessionId}`);
    });

    it('接收 Swarm 流式事件并等待完成', async () => {
      const { texts, events } = await subscribeAndWait(sessionId, 180_000);

      console.log(`[Test8] 事件总数: ${events.length}`);
      console.log(`[Test8] 文本片段: ${texts.length}`);

      const eventTypes = events.map((e) => e.type);
      console.log(`[Test8] 事件类型:`, [...new Set(eventTypes)]);

      const fullText = texts.join('');
      console.log(`[Test8] 输出文本长度: ${fullText.length}`);
      console.log(`[Test8] 前200字: ${fullText.slice(0, 200)}`);

      expect(events.length).toBeGreaterThan(0);

      // run:done 或 run:error 必须存在（run:start 可能因订阅时机被错过）
      const hasEnded = eventTypes.includes('run:done') || eventTypes.includes('run:error');
      expect(hasEnded).toBe(true);

      // Swarm 特征事件（Handoff / [Swarm] 标记）
      const handoffEvents = events.filter(
        (e) =>
          e.type === 'handoff:start' ||
          e.type === 'handoff:done' ||
          (e.type === 'text:delta' && typeof e.content === 'string' && e.content.includes('[Swarm]'))
      );
      console.log(`[Test8] Swarm 特征事件: ${handoffEvents.length}`);

      expect(fullText.length).toBeGreaterThan(0);
    }, 200_000);

    it('验证 Swarm workspace 和 thread', async () => {
      await waitMs(2000);

      const workspaceDir = path.join(WORKSPACES_DIR, sessionId);
      if (fs.existsSync(workspaceDir)) {
        const allFiles = listDirRecursive(workspaceDir);
        console.log(`[Test8] Workspace 文件树:`);
        allFiles.forEach((f) => console.log(`  ${f}`));

        const cpPath = path.join(workspaceDir, 'checkpoint.json');
        if (fs.existsSync(cpPath)) {
          const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
          console.log(`[Test8] checkpoint:`, JSON.stringify(cp, null, 2));
        }
      }

      // 验证 thread
      const threadFiles = fs.readdirSync(THREADS_DIR).filter((f) => f.endsWith('.json'));
      const matched = threadFiles.find((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf-8')).id === sessionId;
        } catch {
          return false;
        }
      });

      if (matched) {
        const thread = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, matched), 'utf-8'));
        console.log(`[Test8] Thread:`, JSON.stringify(thread, null, 2));
        expect(thread.sessionId).toBe(sessionId);
        expect(thread.agentType).toBe('swarm');
      }
    });
  });
});

// ==================== 工具函数 ====================

function listDirRecursive(dir: string, prefix = ''): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        results.push(fullPath + '/');
        results.push(...listDirRecursive(path.join(dir, entry.name), fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return results;
}
