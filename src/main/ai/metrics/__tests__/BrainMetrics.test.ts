import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BrainMetrics } from '../BrainMetrics';

describe('BrainMetrics', () => {
  let tempDir: string;
  let metrics: BrainMetrics;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-metrics-test-'));

    // 创建实例并覆盖路径
    metrics = new BrainMetrics();
    Object.defineProperty(metrics, 'metricsDir', {
      value: tempDir,
      writable: false
    });
    Object.defineProperty(metrics, 'recordsFile', {
      value: path.join(tempDir, 'brain-records.json'),
      writable: false
    });

    await metrics.initialize();
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('recordCall', () => {
    it('应该记录搜索调用', async () => {
      await metrics.recordCall({
        toolType: 'search',
        agentId: 'test-agent',
        success: true,
        hit: true,
        query: 'test query',
        resultCount: 5
      });

      const stats = metrics.getStats();
      expect(stats.totalSearches).toBe(1);
      expect(stats.searchHits).toBe(1);
      expect(stats.hitRate).toBe(1);
    });

    it('应该记录发布调用', async () => {
      await metrics.recordCall({
        toolType: 'publish',
        agentId: 'test-agent',
        success: true,
        topic: 'test topic'
      });

      const stats = metrics.getStats();
      expect(stats.totalPublishes).toBe(1);
      expect(stats.totalSearches).toBe(0);
    });

    it('应该记录失败的调用', async () => {
      await metrics.recordCall({
        toolType: 'search',
        agentId: 'test-agent',
        success: false,
        hit: false,
        error: 'Test error'
      });

      const stats = metrics.getStats();
      expect(stats.totalSearches).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      // 添加测试数据
      await metrics.recordCall({
        toolType: 'search',
        agentId: 'agent-1',
        success: true,
        hit: true,
        query: 'query 1',
        resultCount: 3
      });

      await metrics.recordCall({
        toolType: 'search',
        agentId: 'agent-1',
        success: true,
        hit: false,
        query: 'query 2',
        resultCount: 0
      });

      await metrics.recordCall({
        toolType: 'publish',
        agentId: 'agent-2',
        success: true,
        topic: 'topic 1'
      });

      await metrics.recordCall({
        toolType: 'search',
        agentId: 'agent-2',
        success: true,
        hit: true,
        query: 'query 3',
        resultCount: 2
      });
    });

    it('应该计算全局统计', () => {
      const stats = metrics.getStats();

      expect(stats.totalSearches).toBe(3);
      expect(stats.totalPublishes).toBe(1);
      expect(stats.searchHits).toBe(2);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.successRate).toBe(1);
    });

    it('应该按 Agent 分组统计', () => {
      const stats = metrics.getStats();

      expect(stats.byAgent['agent-1']).toBeDefined();
      expect(stats.byAgent['agent-1'].searches).toBe(2);
      expect(stats.byAgent['agent-1'].hits).toBe(1);
      expect(stats.byAgent['agent-1'].hitRate).toBe(0.5);

      expect(stats.byAgent['agent-2']).toBeDefined();
      expect(stats.byAgent['agent-2'].searches).toBe(1);
      expect(stats.byAgent['agent-2'].publishes).toBe(1);
      expect(stats.byAgent['agent-2'].hits).toBe(1);
      expect(stats.byAgent['agent-2'].hitRate).toBe(1);
    });

    it('应该支持按 Agent 过滤', () => {
      const stats = metrics.getStats({ agentId: 'agent-1' });

      expect(stats.totalSearches).toBe(2);
      expect(stats.totalPublishes).toBe(0);
      expect(Object.keys(stats.byAgent)).toHaveLength(1);
    });

    it('应该支持按时间过滤', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);

      const stats = metrics.getStats({ since: oneHourAgo });

      expect(stats.totalSearches).toBe(3);
      expect(stats.totalPublishes).toBe(1);
    });
  });

  describe('getRecords', () => {
    beforeEach(async () => {
      // 添加测试数据
      for (let i = 0; i < 10; i++) {
        await metrics.recordCall({
          toolType: i % 2 === 0 ? 'search' : 'publish',
          agentId: `agent-${i % 3}`,
          success: true,
          hit: i % 3 === 0,
          query: `query ${i}`
        });
      }
    });

    it('应该返回记录列表', () => {
      const records = metrics.getRecords();
      expect(records).toHaveLength(10);
    });

    it('应该支持分页', () => {
      const page1 = metrics.getRecords({ limit: 3, offset: 0 });
      const page2 = metrics.getRecords({ limit: 3, offset: 3 });

      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('应该支持按 Agent 过滤', () => {
      const records = metrics.getRecords({ agentId: 'agent-0' });
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((r) => r.agentId === 'agent-0')).toBe(true);
    });

    it('应该支持按工具类型过滤', () => {
      const searchRecords = metrics.getRecords({ toolType: 'search' });
      const publishRecords = metrics.getRecords({ toolType: 'publish' });

      expect(searchRecords.every((r) => r.toolType === 'search')).toBe(true);
      expect(publishRecords.every((r) => r.toolType === 'publish')).toBe(true);
    });
  });

  describe('clearRecords', () => {
    it('应该清空所有记录', async () => {
      await metrics.recordCall({
        toolType: 'search',
        agentId: 'test-agent',
        success: true,
        hit: true
      });

      expect(metrics.getStats().totalSearches).toBe(1);

      await metrics.clearRecords();

      expect(metrics.getStats().totalSearches).toBe(0);
    });
  });

  describe('persistence', () => {
    it('应该持久化记录到文件', async () => {
      await metrics.recordCall({
        toolType: 'search',
        agentId: 'test-agent',
        success: true,
        hit: true
      });

      // 创建新实例加载数据
      const newMetrics = new BrainMetrics();
      Object.defineProperty(newMetrics, 'metricsDir', {
        value: tempDir,
        writable: false
      });
      Object.defineProperty(newMetrics, 'recordsFile', {
        value: path.join(tempDir, 'brain-records.json'),
        writable: false
      });

      await newMetrics.initialize();

      const stats = newMetrics.getStats();
      expect(stats.totalSearches).toBe(1);
    });
  });
});
