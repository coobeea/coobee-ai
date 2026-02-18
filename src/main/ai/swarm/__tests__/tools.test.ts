/**
 * Swarm 通信工具 + Handoff 工具测试
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  createReadContextTool,
  createWriteContextTool,
  createAddArtifactTool,
  createGetArtifactTool,
  createSendMessageTool,
  createGetMessagesTool,
  createReportProgressTool,
  createSwarmTools,
  createSwarmCommTools,
  createHandoffTools
} from '../tools';
import { SwarmContext } from '../SwarmContext';
import { MessageBus } from '../MessageBus';
import { HANDOFF_SIGNAL_PREFIX } from '../types';
import type { ToolDefinition } from '../../tools/types';
import type { AgentRole } from '../types';

async function execTool(
  tool: ToolDefinition,
  params: Record<string, unknown>
): Promise<{ success: boolean; llmContent?: string; metadata?: Record<string, unknown> }> {
  const gen = tool.execute(params);
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

describe('Swarm Tools', () => {
  let context: SwarmContext;
  let messageBus: MessageBus;

  beforeEach(() => {
    context = new SwarmContext();
    messageBus = new MessageBus();
  });

  describe('read_shared_context', () => {
    it('读取指定键', async () => {
      context.set('k', 'v', 'system');
      const tool = createReadContextTool(context, 'r1');
      const result = await execTool(tool, { key: 'k' });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent!);
      expect(parsed.value).toBe('v');
    });

    it('键不存在', async () => {
      const tool = createReadContextTool(context, 'r1');
      const result = await execTool(tool, { key: 'nope' });
      expect(result.success).toBe(false);
    });

    it('无参数返回摘要', async () => {
      context.set('a', '1', 'system');
      const tool = createReadContextTool(context, 'r1');
      const result = await execTool(tool, { key: undefined });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent!);
      expect(parsed.keys).toContain('a');
    });
  });

  describe('write_shared_context', () => {
    it('写入值', async () => {
      const tool = createWriteContextTool(context, 'writer');
      const result = await execTool(tool, { key: 'k', value: 'v' });
      expect(result.success).toBe(true);
      expect(context.get('k')).toBe('v');
    });
  });

  describe('add_artifact', () => {
    it('添加产物', async () => {
      const tool = createAddArtifactTool(context, 'coder');
      const result = await execTool(tool, { name: 'code.ts', content: 'x=1', type: 'code' });
      expect(result.success).toBe(true);
      expect(context.getArtifact('code.ts')).toBeDefined();
    });
  });

  describe('get_artifact', () => {
    it('获取产物', async () => {
      context.addArtifact('doc', 'text', 'w', 'document');
      const tool = createGetArtifactTool(context, 'r');
      const result = await execTool(tool, { name: 'doc' });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent!);
      expect(parsed.content).toBe('text');
    });

    it('不存在返回错误', async () => {
      const tool = createGetArtifactTool(context, 'r');
      const result = await execTool(tool, { name: 'nope' });
      expect(result.success).toBe(false);
    });

    it('无参数返回列表', async () => {
      context.addArtifact('a', 'a', 'r1');
      context.addArtifact('b', 'b', 'r2');
      const tool = createGetArtifactTool(context, 'r');
      const result = await execTool(tool, { name: undefined });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent!);
      expect(parsed.count).toBe(2);
    });
  });

  describe('send_message', () => {
    it('发送消息', async () => {
      const tool = createSendMessageTool(messageBus, 'sender');
      const result = await execTool(tool, { to: 'recv', content: 'hi' });
      expect(result.success).toBe(true);
      expect(messageBus.getMessagesForRole('recv')).toHaveLength(1);
    });
  });

  describe('get_messages', () => {
    it('获取未读消息', async () => {
      messageBus.send('sender', 'role1', 'msg1');
      const tool = createGetMessagesTool(messageBus, 'role1');
      const result = await execTool(tool, { type: 'unread' });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent!);
      expect(parsed.count).toBe(1);
      expect(messageBus.getUnreadMessages('role1')).toHaveLength(0);
    });

    it('topic 参数缺失', async () => {
      const tool = createGetMessagesTool(messageBus, 'r');
      const result = await execTool(tool, { type: 'topic' });
      expect(result.success).toBe(false);
    });
  });

  describe('report_progress', () => {
    it('上报进度', async () => {
      const tool = createReportProgressTool(context, 'worker');
      const result = await execTool(tool, { note: 'done' });
      expect(result.success).toBe(true);
      expect(context.getProgressNotes()).toHaveLength(1);
    });
  });

  describe('createSwarmCommTools', () => {
    it('返回 7 个通信工具', () => {
      const tools = createSwarmCommTools(context, messageBus, 'r1');
      expect(tools).toHaveLength(7);
      const names = tools.map((t) => t.name);
      expect(names).toContain('read_shared_context');
      expect(names).toContain('write_shared_context');
      expect(names).toContain('add_artifact');
      expect(names).toContain('get_artifact');
      expect(names).toContain('send_message');
      expect(names).toContain('get_messages');
      expect(names).toContain('report_progress');
    });
  });

  describe('createHandoffTools', () => {
    const roles: AgentRole[] = [
      {
        id: 'coder',
        name: 'Coder',
        description: 'Codes',
        instructions: '',
        handoffDescription: 'Transfer to coder',
        capabilities: []
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Reviews',
        instructions: '',
        handoffDescription: 'Transfer to reviewer',
        capabilities: []
      }
    ];

    it('生成排除自身的 handoff 工具', () => {
      const tools = createHandoffTools(roles, 'coder');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('transfer_to_reviewer');
    });

    it('调用返回 HANDOFF_SIGNAL_PREFIX', async () => {
      const tools = createHandoffTools(roles, 'coder');
      const result = await execTool(tools[0], { reason: 'need review' });
      expect(result.success).toBe(true);
      expect(result.llmContent).toBe(`${HANDOFF_SIGNAL_PREFIX}reviewer`);
    });
  });

  describe('createSwarmTools', () => {
    it('返回通信 + handoff 工具', () => {
      const roles: AgentRole[] = [
        {
          id: 'a',
          name: 'A',
          description: 'A',
          instructions: '',
          handoffDescription: '',
          capabilities: []
        },
        {
          id: 'b',
          name: 'B',
          description: 'B',
          instructions: '',
          handoffDescription: '',
          capabilities: []
        }
      ];
      const tools = createSwarmTools(context, messageBus, 'a', roles);
      expect(tools).toHaveLength(8);
      const names = tools.map((t) => t.name);
      expect(names).toContain('transfer_to_b');
    });

    it('无 roles 时只有通信工具', () => {
      const tools = createSwarmTools(context, messageBus, 'r1');
      expect(tools).toHaveLength(7);
    });
  });
});
