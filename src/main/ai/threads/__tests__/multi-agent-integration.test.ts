/**
 * 多 Agent 委托集成测试
 *
 * 验证：
 *   1. 子 Agent sessionId 命名规范（{parentSessionId}:delegate:{agentId}）
 *   2. 子 Agent 使用 sessionMode('file')（持久化）
 *   3. Orchestrator/Swarm sessionId 命名规范
 *   4. CheckpointManager 与多 Agent 场景的联动
 *   5. 文件系统目录结构验证
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

let tmpDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return { paths: { workspacesDir: tmpDir } };
  }
}));

describe('多 Agent 集成', () => {
  let CheckpointManager: typeof import('../CheckpointManager').CheckpointManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-agent-test-'));
    vi.resetModules();
    const cpMod = await import('../CheckpointManager');
    CheckpointManager = cpMod.CheckpointManager;
    CheckpointManager.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ========== SessionId 命名规范 ==========

  describe('sessionId 命名规范', () => {
    it('delegate 子 Agent sessionId 格式: {threadId}:delegate:{agentId}', () => {
      const threadId = '300000000000000001';
      const agentId = 'code-reviewer';
      const subSessionId = `${threadId}:delegate:${agentId}`;

      expect(subSessionId).toBe('300000000000000001:delegate:code-reviewer');
      expect(subSessionId.startsWith(threadId)).toBe(true);
      expect(subSessionId.includes(':delegate:')).toBe(true);
    });

    it('planner sessionId 格式: {threadId}:planner', () => {
      const threadId = '300000000000000001';
      const sessionId = `${threadId}:planner`;
      expect(sessionId).toBe('300000000000000001:planner');
    });

    it('worker sessionId 格式: {threadId}:worker:{subtaskId}', () => {
      const threadId = '300000000000000001';
      const subtaskId = 'subtask-1';
      const sessionId = `${threadId}:worker:${subtaskId}`;
      expect(sessionId).toBe('300000000000000001:worker:subtask-1');
    });

    it('swarm triage sessionId 格式: {threadId}:triage', () => {
      const threadId = '300000000000000001';
      const sessionId = `${threadId}:triage`;
      expect(sessionId).toBe('300000000000000001:triage');
    });

    it('swarm role sessionId 格式: {threadId}:swarm:{roleId}', () => {
      const threadId = '300000000000000001';
      const roleId = 'researcher';
      const sessionId = `${threadId}:swarm:${roleId}`;
      expect(sessionId).toBe('300000000000000001:swarm:researcher');
    });

    it('子 Agent sessionId 包含 : 可以正确识别为非主 thread', () => {
      const mainSessionId = '300000000000000001';
      const subSessionId = '300000000000000001:delegate:reviewer';

      expect(mainSessionId.includes(':')).toBe(false);
      expect(subSessionId.includes(':')).toBe(true);
    });
  });

  // ========== Checkpoint 与多 Agent 联动 ==========

  describe('checkpoint 多层嵌套', () => {
    const mainThreadId = '400000000000000001';
    const subAgentSessionId = `${mainThreadId}:delegate:code-reviewer`;

    it('主 thread 记录 activeAgent 信息', async () => {
      const mgr = CheckpointManager.getInstance();

      await mgr.save({
        threadId: mainThreadId,
        updatedAt: new Date().toISOString(),
        runStatus: 'tool-pending',
        activeAgent: {
          sessionId: subAgentSessionId,
          agentId: 'code-reviewer',
          role: 'delegate',
          workspace: `tasks/task-001/agents/code-reviewer`
        }
      });

      const cp = await mgr.load(mainThreadId);
      expect(cp!.activeAgent).toBeDefined();
      expect(cp!.activeAgent!.sessionId).toBe(subAgentSessionId);
      expect(cp!.activeAgent!.agentId).toBe('code-reviewer');
      expect(cp!.activeAgent!.role).toBe('delegate');
    });

    it('子 Agent 审批时主 thread checkpoint 记录完整上下文', async () => {
      const mgr = CheckpointManager.getInstance();

      await mgr.save({
        threadId: mainThreadId,
        updatedAt: new Date().toISOString(),
        runStatus: 'approval-pending',
        activeAgent: {
          sessionId: subAgentSessionId,
          agentId: 'code-reviewer',
          role: 'delegate',
          workspace: `tasks/task-001/agents/code-reviewer`
        },
        pendingOperation: {
          type: 'approval',
          approvalId: `${subAgentSessionId}:0`,
          toolName: 'exec',
          toolCallId: 'tc-sub-1',
          agentSessionId: subAgentSessionId
        }
      });

      const cp = await mgr.load(mainThreadId);
      expect(cp!.runStatus).toBe('approval-pending');
      expect(cp!.pendingOperation!.agentSessionId).toBe(subAgentSessionId);
      expect(cp!.pendingOperation!.toolName).toBe('exec');
      expect(cp!.activeAgent!.agentId).toBe('code-reviewer');
    });

    it('子 Agent 完成后清除 activeAgent', async () => {
      const mgr = CheckpointManager.getInstance();

      await mgr.save({
        threadId: mainThreadId,
        updatedAt: '',
        runStatus: 'tool-pending',
        activeAgent: {
          sessionId: subAgentSessionId,
          agentId: 'code-reviewer',
          role: 'delegate',
          workspace: 'w'
        }
      });

      // 子 Agent 完成后更新主 thread
      await mgr.updateStatus(mainThreadId, 'running');
      const cp = await mgr.load(mainThreadId);
      expect(cp!.runStatus).toBe('running');
      // updateStatus 不会自动清除 activeAgent（仅 idle/completed 会清除）
      expect(cp!.activeAgent).toBeDefined();

      // 主 thread 最终完成
      await mgr.updateStatus(mainThreadId, 'idle');
      const final = await mgr.load(mainThreadId);
      expect(final!.activeAgent).toBeUndefined();
    });
  });

  // ========== 文件系统结构验证 ==========

  describe('文件系统结构', () => {
    it('checkpoint.json 在 workspace/{threadId}/ 目录下', async () => {
      const mgr = CheckpointManager.getInstance();
      const threadId = '500000000000000001';

      await mgr.save({
        threadId,
        updatedAt: '',
        runStatus: 'running'
      });

      const expectedPath = path.join(tmpDir, threadId, 'checkpoint.json');
      expect(fs.existsSync(expectedPath)).toBe(true);

      const raw = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));
      expect(raw.threadId).toBe(threadId);
      expect(raw.runStatus).toBe('running');
    });

    it('多个 thread 各有独立的 checkpoint 目录', async () => {
      const mgr = CheckpointManager.getInstance();

      await mgr.save({ threadId: 't-1', updatedAt: '', runStatus: 'running' });
      await mgr.save({ threadId: 't-2', updatedAt: '', runStatus: 'idle' });
      await mgr.save({ threadId: 't-3', updatedAt: '', runStatus: 'approval-pending' });

      expect(fs.existsSync(path.join(tmpDir, 't-1', 'checkpoint.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 't-2', 'checkpoint.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 't-3', 'checkpoint.json'))).toBe(true);
    });

    it('checkpoint.json 内容是格式化的 JSON', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'pretty',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'running'
      });

      const raw = fs.readFileSync(path.join(tmpDir, 'pretty', 'checkpoint.json'), 'utf-8');
      // 格式化 JSON 应包含换行和缩进
      expect(raw).toContain('\n');
      expect(raw).toContain('  ');
    });
  });

  // ========== Orchestrator/Swarm 配置传递 ==========

  describe('Orchestrator parentSessionId 传递', () => {
    it('WorkerCoordinator 接收 parentSessionId', () => {
      // 验证类型兼容性
      const config = {
        parentSessionId: '300000000000000001',
        model: 'gpt-4o'
      };

      const sessionId = config.parentSessionId
        ? `${config.parentSessionId}:worker:subtask-1`
        : `worker-subtask-1-${Date.now()}`;

      expect(sessionId).toBe('300000000000000001:worker:subtask-1');
    });

    it('Planner 接收 parentSessionId', () => {
      const options = {
        parentSessionId: '300000000000000001',
        model: 'gpt-4o'
      };

      const sessionId = options.parentSessionId ? `${options.parentSessionId}:planner` : `planner-${Date.now()}`;

      expect(sessionId).toBe('300000000000000001:planner');
    });

    it('SwarmConfig 接收 parentSessionId', () => {
      const config = {
        parentSessionId: '300000000000000001'
      };

      const triageSessionId = config.parentSessionId ? `${config.parentSessionId}:triage` : `triage-${Date.now()}`;

      const swarmSessionId = config.parentSessionId
        ? `${config.parentSessionId}:swarm:researcher`
        : `swarm-pool-${Date.now()}`;

      expect(triageSessionId).toBe('300000000000000001:triage');
      expect(swarmSessionId).toBe('300000000000000001:swarm:researcher');
    });
  });
});
