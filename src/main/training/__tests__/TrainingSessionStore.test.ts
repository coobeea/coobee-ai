/**
 * TrainingSessionStore 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrainingSessionStore } from '../TrainingSessionStore';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TrainingSessionStore', () => {
  let tempDir: string;
  let store: TrainingSessionStore;

  beforeEach(() => {
    // 创建临时目录（使用 coobee-ai-test 前缀，匹配 Env.paths 逻辑）
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-ai-test-'));
    store = new TrainingSessionStore(tempDir);

    // 创建临时数据集文件
    const testDatasetPath = path.join(tempDir, 'test-dataset.json');
    const testDataset = {
      name: 'test-dataset',
      version: '1.0.0',
      category: 'test',
      trainSet: [{ id: 'task-1', description: 'Test task 1', difficulty: 3, category: 'test' }],
      testSet: []
    };
    fs.writeFileSync(testDatasetPath, JSON.stringify(testDataset, null, 2));
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('应该能够创建新的训练会话', async () => {
    const datasetPath = path.join(tempDir, 'test-dataset.json');

    const session = await store.create({
      agentId: 'test-agent',
      goal: {
        name: 'Test Goal',
        description: 'Test description',
        dimensions: [],
        threshold: 70
      },
      dataset: datasetPath, // 使用绝对路径
      maxRounds: 100,
      strategy: 'sequential'
    });

    expect(session.id).toBeDefined();
    expect(session.agentId).toBe('test-agent');
    expect(session.status).toBe('pending');
    expect(session.results).toEqual([]);
  });

  it('应该能够保存和加载会话', async () => {
    const session = await store.create({
      agentId: 'test-agent',
      goal: {
        name: 'Test Goal',
        description: 'Test description',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    // 修改会话
    session.status = 'running';
    session.progress.currentRound = 5;

    // 保存
    await store.save(session);

    // 加载
    const loaded = await store.load(session.id);

    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe('running');
    expect(loaded!.progress.currentRound).toBe(5);
  });

  it('应该能够列出所有会话', async () => {
    const session1 = await store.create({
      agentId: 'agent-1',
      goal: {
        name: 'Goal 1',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    // 等待一点时间，确保生成不同的 ID
    await new Promise((resolve) => setTimeout(resolve, 10));

    const session2 = await store.create({
      agentId: 'agent-2',
      goal: {
        name: 'Goal 2',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    const sessions = await store.list();

    expect(sessions.length).toBe(2);
    expect([session1.id, session2.id]).toContain(sessions[0].id);
    expect([session1.id, session2.id]).toContain(sessions[1].id);
  });

  it('应该能够删除会话', async () => {
    const session = await store.create({
      agentId: 'test-agent',
      goal: {
        name: 'Test Goal',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    await store.delete(session.id);

    const loaded = await store.load(session.id);
    expect(loaded).toBeNull();
  });

  it('应该处理不存在的会话', async () => {
    const loaded = await store.load('non-existent-id');
    expect(loaded).toBeNull();
  });

  it('应该能够按状态筛选会话', async () => {
    const session1 = await store.create({
      agentId: 'agent-1',
      goal: {
        name: 'Goal 1',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const session2 = await store.create({
      agentId: 'agent-2',
      goal: {
        name: 'Goal 2',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    // 修改状态并保存
    session1.status = 'running';
    await store.save(session1);

    session2.status = 'completed';
    await store.save(session2);

    // 重新加载以验证保存成功
    const reloaded1 = await store.load(session1.id);
    const reloaded2 = await store.load(session2.id);

    expect(reloaded1?.status).toBe('running');
    expect(reloaded2?.status).toBe('completed');

    // 按状态筛选（先获取所有会话验证）
    const allSessions = await store.list();
    expect(allSessions.length).toBe(2);

    const runningSessions = await store.list({ status: 'running' });
    const completedSessions = await store.list({ status: 'completed' });

    expect(runningSessions.length).toBeGreaterThanOrEqual(1);
    expect(completedSessions.length).toBeGreaterThanOrEqual(1);

    // 验证筛选结果包含正确的会话
    const runningIds = runningSessions.map((s) => s.id);
    const completedIds = completedSessions.map((s) => s.id);

    expect(runningIds).toContain(session1.id);
    expect(completedIds).toContain(session2.id);
  });

  it('应该能够按时间降序排列会话', async () => {
    // 创建多个会话，有间隔
    const session1 = await store.create({
      agentId: 'agent-1',
      goal: {
        name: 'Goal 1',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    // 等待一点时间
    await new Promise((resolve) => setTimeout(resolve, 10));

    const session2 = await store.create({
      agentId: 'agent-2',
      goal: {
        name: 'Goal 2',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    const sessions = await store.list();

    // 应该按时间降序排列（最新的在前）
    expect(sessions[0].id).toBe(session2.id);
    expect(sessions[1].id).toBe(session1.id);
  });

  it('应该正确生成唯一的会话 ID', async () => {
    const session1 = await store.create({
      agentId: 'test-agent',
      goal: {
        name: 'Test',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    // 等待确保生成不同的时间戳
    await new Promise((resolve) => setTimeout(resolve, 10));

    const session2 = await store.create({
      agentId: 'test-agent',
      goal: {
        name: 'Test',
        description: 'Test',
        dimensions: [],
        threshold: 70
      },
      dataset: path.join(tempDir, 'test-dataset.json'),
      maxRounds: 100,
      strategy: 'sequential'
    });

    expect(session1.id).not.toBe(session2.id);
  });
});
