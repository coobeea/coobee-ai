/**
 * memory-smart 临时 runtime ID 过滤测试
 *
 * 验证 isTemporaryRuntimeId() 正确识别临时 ID vs 真实 Agent ID
 */

import { describe, it, expect } from 'vitest';

/**
 * 判断是否为临时 runtime ID
 *
 * 临时 runtime ID 的特征：
 * - pi-agent-{timestamp}-{random}   （PiMono Runtime）
 * - orch-{timestamp}                （Orchestrator）
 * - {threadId}:planner              （Orchestrator Planner）
 * - {threadId}:worker:{subtaskId}   （Orchestrator Worker）
 * - {threadId}:triage               （Swarm Triage）
 * - {threadId}:swarm-role-{roleId}  （Swarm Role Agent）
 *
 * 真实 Agent ID 特征：
 * - kebab-case（如 "code-reviewer", "app-copilot"）
 * - 不含时间戳和随机后缀
 */
function isTemporaryRuntimeId(agentId: string): boolean {
  // PiMono 临时 runtime
  if (/^pi-agent-\d+-[a-z0-9]+$/i.test(agentId)) return true;

  // Orchestrator 相关
  if (/^orch-\d+$/.test(agentId)) return true;
  if (agentId.includes(':planner')) return true;
  if (agentId.includes(':worker:')) return true;

  // Swarm 相关
  if (agentId.includes(':triage')) return true;
  if (agentId.includes(':swarm-role-')) return true;

  // Worker 临时 ID（如 "worker-general-1"）
  if (/^worker-[a-z]+-\d+$/i.test(agentId)) return true;

  // 默认：认为是真实 Agent ID
  return false;
}

describe('memory-smart 临时 runtime ID 过滤', () => {
  describe('临时 runtime ID（应被过滤）', () => {
    it('PiMono runtime ID', () => {
      expect(isTemporaryRuntimeId('pi-agent-1772818456463-4wn5ay')).toBe(true);
      expect(isTemporaryRuntimeId('pi-agent-123456789-abc123')).toBe(true);
    });

    it('Orchestrator runtime ID', () => {
      expect(isTemporaryRuntimeId('orch-1234567890')).toBe(true);
    });

    it('Orchestrator Planner ID', () => {
      expect(isTemporaryRuntimeId('288371906425724928:planner')).toBe(true);
      expect(isTemporaryRuntimeId('thread-123:planner')).toBe(true);
    });

    it('Orchestrator Worker ID', () => {
      expect(isTemporaryRuntimeId('288371906425724928:worker:subtask-1')).toBe(true);
      expect(isTemporaryRuntimeId('thread-456:worker:task-abc')).toBe(true);
    });

    it('Swarm Triage ID', () => {
      expect(isTemporaryRuntimeId('288371906425724928:triage')).toBe(true);
      expect(isTemporaryRuntimeId('thread-789:triage')).toBe(true);
    });

    it('Swarm Role Agent ID', () => {
      expect(isTemporaryRuntimeId('288371906425724928:swarm-role-researcher')).toBe(true);
      expect(isTemporaryRuntimeId('thread-999:swarm-role-writer')).toBe(true);
    });

    it('Worker 临时 ID', () => {
      expect(isTemporaryRuntimeId('worker-general-1')).toBe(true);
      expect(isTemporaryRuntimeId('worker-code-2')).toBe(true);
      expect(isTemporaryRuntimeId('worker-data-99')).toBe(true);
    });
  });

  describe('真实 Agent ID（应保存记忆）', () => {
    it('kebab-case Agent ID', () => {
      expect(isTemporaryRuntimeId('code-reviewer')).toBe(false);
      expect(isTemporaryRuntimeId('app-copilot')).toBe(false);
      expect(isTemporaryRuntimeId('project-manager')).toBe(false);
      expect(isTemporaryRuntimeId('test-specialist')).toBe(false);
    });

    it('单词 Agent ID', () => {
      expect(isTemporaryRuntimeId('researcher')).toBe(false);
      expect(isTemporaryRuntimeId('writer')).toBe(false);
      expect(isTemporaryRuntimeId('reviewer')).toBe(false);
    });

    it('带数字的 kebab-case ID（但不是临时格式）', () => {
      expect(isTemporaryRuntimeId('bot-v2')).toBe(false);
      expect(isTemporaryRuntimeId('agent-2024')).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('空字符串', () => {
      expect(isTemporaryRuntimeId('')).toBe(false);
    });

    it('特殊字符', () => {
      expect(isTemporaryRuntimeId('agent@test')).toBe(false);
      expect(isTemporaryRuntimeId('agent#123')).toBe(false);
    });
  });
});
