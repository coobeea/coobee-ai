/**
 * Swarm 持久化功能测试
 *
 * 测试：
 * 1. FileSwarmContext - 状态/产物/进度持久化
 * 2. FileMessageBus - 消息持久化
 * 3. KnowledgeBase - 知识库持久化
 * 4. 崩溃恢复 - 程序重启后状态恢复
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSwarmContext } from '../FileSwarmContext';
import { FileMessageBus } from '../FileMessageBus';
import { KnowledgeBase } from '../KnowledgeBase';

describe('Swarm 持久化功能', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'swarm-persistence-test-'));
  });

  afterEach(() => {
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  describe('FileSwarmContext', () => {
    it('状态变更应该同步写入 context.jsonl', () => {
      const ctx = new FileSwarmContext(workspaceDir);

      ctx.set('key1', 'value1', 'coder');
      ctx.set('key2', 42, 'analyst');

      const logPath = join(workspaceDir, 'swarm/context.jsonl');
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('"type":"state_set"');
      expect(content).toContain('"key":"key1"');
      expect(content).toContain('"key":"key2"');
    });

    it('产物应该写入 artifacts/ 文件夹', () => {
      const ctx = new FileSwarmContext(workspaceDir);

      ctx.addArtifact('Button.vue', '<template>Hello</template>', 'coder', 'code');

      const artifactPath = join(workspaceDir, 'swarm/artifacts/Button.vue');
      const metaPath = join(workspaceDir, 'swarm/artifacts/Button.vue.meta.json');

      expect(existsSync(artifactPath)).toBe(true);
      expect(existsSync(metaPath)).toBe(true);

      const content = readFileSync(artifactPath, 'utf-8');
      expect(content).toBe('<template>Hello</template>');

      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.name).toBe('Button.vue');
      expect(meta.createdBy).toBe('coder');
      expect(meta.type).toBe('code');
    });

    it('进度应该写入 progress.jsonl', () => {
      const ctx = new FileSwarmContext(workspaceDir);

      ctx.addProgressNote('开始分析代码', 'coder');
      ctx.addProgressNote('发现3处问题', 'reviewer');

      const progressPath = join(workspaceDir, 'swarm/progress.jsonl');
      expect(existsSync(progressPath)).toBe(true);

      const content = readFileSync(progressPath, 'utf-8');
      expect(content).toContain('开始分析代码');
      expect(content).toContain('发现3处问题');
    });

    it('程序重启后应该恢复状态', () => {
      // 第一次运行
      const ctx1 = new FileSwarmContext(workspaceDir);
      ctx1.set('counter', 42, 'system');
      ctx1.set('status', 'in_progress', 'coder');
      ctx1.addArtifact('doc.md', '# Hello', 'writer', 'markdown');

      // 模拟程序重启
      const ctx2 = new FileSwarmContext(workspaceDir);

      // 验证状态恢复
      expect(ctx2.get('counter')).toBe(42);
      expect(ctx2.get('status')).toBe('in_progress');

      // 验证产物恢复
      const artifact = ctx2.getArtifact('doc.md');
      expect(artifact).toBeDefined();
      expect(artifact!.content).toBe('# Hello');
      expect(artifact!.createdBy).toBe('writer');
      expect(artifact!.type).toBe('markdown');
    });

    it('删除状态应该记录到日志', () => {
      const ctx = new FileSwarmContext(workspaceDir);

      ctx.set('temp_key', 'temp_value', 'system');
      ctx.delete('temp_key', 'system');

      const logPath = join(workspaceDir, 'swarm/context.jsonl');
      const content = readFileSync(logPath, 'utf-8');

      expect(content).toContain('"type":"state_set"');
      expect(content).toContain('"type":"state_delete"');
      expect(content).toContain('"key":"temp_key"');
    });
  });

  describe('FileMessageBus', () => {
    it('消息应该同步写入 messages.jsonl', () => {
      const bus = new FileMessageBus(workspaceDir);

      bus.send('coder', 'reviewer', '请审查代码', { topic: 'code_review' });
      bus.send('reviewer', 'coder', '发现3处问题', { topic: 'code_review', priority: 'high' });

      const messagesPath = join(workspaceDir, 'swarm/messages.jsonl');
      expect(existsSync(messagesPath)).toBe(true);

      const content = readFileSync(messagesPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const msg1 = JSON.parse(lines[0]);
      expect(msg1.fromRoleId).toBe('coder');
      expect(msg1.toRoleId).toBe('reviewer');
      expect(msg1.content).toBe('请审查代码');
      expect(msg1.topic).toBe('code_review');
    });

    it('程序重启后应该恢复消息历史', () => {
      // 第一次运行
      const bus1 = new FileMessageBus(workspaceDir);
      bus1.send('coder', 'reviewer', '消息1');
      bus1.send('analyst', 'reviewer', '消息2'); // 🆕 改为发给 reviewer

      // 模拟程序重启
      const bus2 = new FileMessageBus(workspaceDir);

      // 验证消息恢复
      const messages = bus2.getMessagesForRole('reviewer');
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((m) => m.content === '消息1')).toBe(true);
      expect(messages.some((m) => m.content === '消息2')).toBe(true);
    });

    it('广播消息应该记录', () => {
      const bus = new FileMessageBus(workspaceDir);

      bus.send('system', '*', '系统通知', { priority: 'urgent' });

      const messagesPath = join(workspaceDir, 'swarm/messages.jsonl');
      const content = readFileSync(messagesPath, 'utf-8');

      expect(content).toContain('"toRoleId":"*"');
      expect(content).toContain('系统通知');
      expect(content).toContain('"priority":"urgent"');
    });
  });

  describe('KnowledgeBase', () => {
    it('追加知识条目应该写入文件', () => {
      const kb = new KnowledgeBase(workspaceDir);

      kb.append({
        type: 'decision',
        decision: '采用微服务架构',
        madeBy: 'coder',
        reason: '提高可扩展性',
        ts: Date.now()
      });

      kb.append({
        type: 'artifact_created',
        name: 'Button.vue',
        createdBy: 'coder',
        artifactType: 'code',
        ts: Date.now()
      });

      const kbPath = join(workspaceDir, 'swarm/knowledge-base.jsonl');
      expect(existsSync(kbPath)).toBe(true);

      const content = readFileSync(kbPath, 'utf-8');
      expect(content).toContain('采用微服务架构');
      expect(content).toContain('Button.vue');
    });

    it('buildSummary 应该生成可读摘要', () => {
      const kb = new KnowledgeBase(workspaceDir);

      kb.append({
        type: 'discussion_summary',
        discussionId: 'disc-001',
        participants: ['coder', 'reviewer'],
        topic: '架构设计',
        summary: '决定使用依赖注入',
        decision: '使用工厂模式',
        ts: Date.now()
      });

      kb.append({
        type: 'decision',
        decision: '采用 TypeScript strict 模式',
        madeBy: 'coder',
        ts: Date.now()
      });

      const summary = kb.buildSummary(10);

      expect(summary).toContain('[讨论]');
      expect(summary).toContain('coder+reviewer');
      expect(summary).toContain('架构设计');
      expect(summary).toContain('[决策]');
      expect(summary).toContain('TypeScript strict 模式');
    });

    it('程序重启后应该恢复知识库', () => {
      // 第一次运行
      const kb1 = new KnowledgeBase(workspaceDir);
      kb1.append({
        type: 'milestone',
        milestone: '代码重构完成',
        achievedBy: 'coder',
        ts: Date.now()
      });

      // 模拟程序重启
      const kb2 = new KnowledgeBase(workspaceDir);

      // 验证恢复
      const all = kb2.getAll();
      expect(all.length).toBe(1);
      expect(all[0].type).toBe('milestone');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((all[0] as any).milestone).toBe('代码重构完成');
    });

    it('支持按类型筛选', () => {
      const kb = new KnowledgeBase(workspaceDir);

      kb.append({ type: 'decision', decision: 'D1', madeBy: 'coder', ts: Date.now() });
      kb.append({ type: 'decision', decision: 'D2', madeBy: 'reviewer', ts: Date.now() });
      kb.append({ type: 'milestone', milestone: 'M1', achievedBy: 'analyst', ts: Date.now() });

      const decisions = kb.getByType('decision');
      expect(decisions.length).toBe(2);

      const milestones = kb.getByType('milestone');
      expect(milestones.length).toBe(1);
    });

    it('支持搜索', () => {
      const kb = new KnowledgeBase(workspaceDir);

      kb.append({ type: 'decision', decision: '使用 React', madeBy: 'coder', ts: Date.now() });
      kb.append({ type: 'decision', decision: '使用 Vue', madeBy: 'coder', ts: Date.now() });

      const results = kb.search('React');
      expect(results.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((results[0] as any).decision).toBe('使用 React');
    });

    it('空知识库的 buildSummary 应该返回提示', () => {
      const kb = new KnowledgeBase(workspaceDir);

      const summary = kb.buildSummary();
      expect(summary).toBe('（暂无协作历史）');
    });
  });

  describe('集成测试', () => {
    it('完整流程：Context + MessageBus + KnowledgeBase', () => {
      const ctx = new FileSwarmContext(workspaceDir);
      const bus = new FileMessageBus(workspaceDir);
      const kb = new KnowledgeBase(workspaceDir);

      // 1. Coder 设置状态
      ctx.set('architecture_decision', 'microservices', 'coder');

      // 2. Coder 发送消息
      bus.send('coder', 'reviewer', '请审查架构设计');

      // 3. Reviewer 回复
      bus.send('reviewer', 'coder', '看起来不错');

      // 4. Coder 创建产物
      ctx.addArtifact('design.md', '# 架构设计\n...', 'coder', 'markdown');

      // 5. 手动记录到知识库（实际中由 SwarmCoordinator 自动记录）
      kb.append({
        type: 'decision',
        decision: 'microservices',
        madeBy: 'coder',
        ts: Date.now()
      });

      // 验证文件存在
      expect(existsSync(join(workspaceDir, 'swarm/context.jsonl'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'swarm/messages.jsonl'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'swarm/knowledge-base.jsonl'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'swarm/artifacts/design.md'))).toBe(true);

      // 验证内容
      const kbContent = readFileSync(join(workspaceDir, 'swarm/knowledge-base.jsonl'), 'utf-8');
      expect(kbContent).toContain('microservices');

      const messagesContent = readFileSync(join(workspaceDir, 'swarm/messages.jsonl'), 'utf-8');
      expect(messagesContent).toContain('请审查架构设计');
    });

    it('崩溃恢复：所有数据应该恢复', () => {
      // === 第一次运行 ===
      const ctx1 = new FileSwarmContext(workspaceDir);
      const bus1 = new FileMessageBus(workspaceDir);
      const kb1 = new KnowledgeBase(workspaceDir);

      // 设置数据
      ctx1.set('status', 'in_progress', 'coder');
      ctx1.addArtifact('code.ts', 'const x = 1', 'coder', 'code');
      bus1.send('coder', 'reviewer', '第一条消息');
      kb1.append({
        type: 'milestone',
        milestone: '里程碑1',
        achievedBy: 'coder',
        ts: Date.now()
      });

      // === 模拟程序重启 ===
      const ctx2 = new FileSwarmContext(workspaceDir);
      const bus2 = new FileMessageBus(workspaceDir);
      const kb2 = new KnowledgeBase(workspaceDir);

      // === 验证恢复 ===
      // Context 恢复
      expect(ctx2.get('status')).toBe('in_progress');
      expect(ctx2.getArtifact('code.ts')).toBeDefined();
      expect(ctx2.getArtifact('code.ts')!.content).toBe('const x = 1');

      // MessageBus 恢复
      const messages = bus2.getMessagesForRole('reviewer');
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((m) => m.content === '第一条消息')).toBe(true);

      // KnowledgeBase 恢复
      const all = kb2.getAll();
      expect(all.length).toBe(1);
      expect(all[0].type).toBe('milestone');
    });
  });

  describe('KnowledgeBase 摘要功能', () => {
    it('应该按时间顺序返回最近的条目', () => {
      const kb = new KnowledgeBase(workspaceDir);

      for (let i = 1; i <= 20; i++) {
        kb.append({
          type: 'custom',
          message: `条目 ${i}`,
          ts: Date.now() + i
        });
      }

      const recent = kb.getRecent(5);
      expect(recent.length).toBe(5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((recent[4] as any).message).toBe('条目 20');
    });

    it('buildSummary 应该包含所有类型的格式化输出', () => {
      const kb = new KnowledgeBase(workspaceDir);

      kb.append({
        type: 'discussion_summary',
        discussionId: 'disc-001',
        participants: ['coder', 'reviewer'],
        topic: '架构评审',
        summary: '使用依赖注入',
        decision: '工厂模式',
        ts: Date.now()
      });

      kb.append({
        type: 'decision',
        decision: 'TypeScript strict',
        madeBy: 'coder',
        reason: '提高质量',
        ts: Date.now()
      });

      kb.append({
        type: 'artifact_created',
        name: 'Button.vue',
        createdBy: 'coder',
        artifactType: 'code',
        ts: Date.now()
      });

      kb.append({
        type: 'milestone',
        milestone: '重构完成',
        achievedBy: 'coder',
        ts: Date.now()
      });

      kb.append({
        type: 'issue_found',
        issue: '性能瓶颈',
        foundBy: 'analyst',
        severity: 'high',
        ts: Date.now()
      });

      const summary = kb.buildSummary(10);

      expect(summary).toContain('[讨论] coder+reviewer 讨论了 架构评审');
      expect(summary).toContain('[决策] coder 决定：TypeScript strict');
      expect(summary).toContain('[产物] coder 创建了 Button.vue');
      expect(summary).toContain('[里程碑] coder 完成：重构完成');
      expect(summary).toContain('[问题] analyst 发现[HIGH]：性能瓶颈');
    });
  });

  describe('并发写入测试', () => {
    it('多次快速写入应该不丢失数据', () => {
      const ctx = new FileSwarmContext(workspaceDir);

      // 快速写入 100 次
      for (let i = 0; i < 100; i++) {
        ctx.set(`key${i}`, `value${i}`, 'system');
      }

      const logPath = join(workspaceDir, 'swarm/context.jsonl');
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(100);
    });
  });
});
