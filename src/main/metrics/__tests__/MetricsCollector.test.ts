import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MetricsCollector } from '../MetricsCollector';

describe('MetricsCollector', () => {
  let tempDir: string;
  let collector: MetricsCollector;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metrics-test-'));

    // 创建实例并覆盖路径
    collector = new MetricsCollector();
    Object.defineProperty(collector, 'metricsDir', {
      value: tempDir,
      writable: false
    });
    Object.defineProperty(collector, 'tokenUsageFile', {
      value: path.join(tempDir, 'token-usage.json'),
      writable: false
    });
    Object.defineProperty(collector, 'requestsFile', {
      value: path.join(tempDir, 'requests.json'),
      writable: false
    });
    Object.defineProperty(collector, 'compressionsFile', {
      value: path.join(tempDir, 'compressions.json'),
      writable: false
    });
    Object.defineProperty(collector, 'memoryToolFile', {
      value: path.join(tempDir, 'memory-tool.json'),
      writable: false
    });

    await collector.initialize();
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('recordTokenUsage', () => {
    it('应该记录 Token 使用', async () => {
      await collector.recordTokenUsage({
        sessionId: 'test-session',
        model: 'gpt-4',
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        cost: 0.01
      });

      const metrics = collector.getAggregatedMetrics();
      expect(metrics.tokens.total).toBe(300);
      expect(metrics.tokens.prompt).toBe(100);
      expect(metrics.tokens.completion).toBe(200);
      expect(metrics.tokens.totalCost).toBe(0.01);
    });
  });

  describe('recordRequest', () => {
    it('应该记录成功请求', async () => {
      await collector.recordRequest({
        sessionId: 'test-session',
        model: 'gpt-4',
        duration: 1500,
        success: true
      });

      const metrics = collector.getAggregatedMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.success).toBe(1);
      expect(metrics.requests.failed).toBe(0);
      expect(metrics.requests.successRate).toBe(1);
      expect(metrics.requests.avgDuration).toBe(1500);
    });

    it('应该记录失败请求', async () => {
      await collector.recordRequest({
        sessionId: 'test-session',
        model: 'gpt-4',
        duration: 500,
        success: false,
        error: 'Test error'
      });

      const metrics = collector.getAggregatedMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.success).toBe(0);
      expect(metrics.requests.failed).toBe(1);
      expect(metrics.requests.successRate).toBe(0);
    });
  });

  describe('recordCompression', () => {
    it('应该记录压缩事件', async () => {
      await collector.recordCompression({
        sessionId: 'test-session',
        beforeTokens: 1000,
        afterTokens: 500,
        compressionRatio: 0.5,
        duration: 200
      });

      const metrics = collector.getAggregatedMetrics();
      expect(metrics.compressions.total).toBe(1);
      expect(metrics.compressions.avgCompressionRatio).toBe(0.5);
      expect(metrics.compressions.totalTokensSaved).toBe(500);
    });
  });

  describe('recordMemoryTool', () => {
    it('应该记录 Memory 工具调用', async () => {
      await collector.recordMemoryTool({
        sessionId: 'test-session',
        operation: 'store',
        success: true,
        duration: 50
      });

      await collector.recordMemoryTool({
        sessionId: 'test-session',
        operation: 'retrieve',
        success: true,
        duration: 30
      });

      const metrics = collector.getAggregatedMetrics();
      expect(metrics.memoryTool.total).toBe(2);
      expect(metrics.memoryTool.byOperation.store).toBe(1);
      expect(metrics.memoryTool.byOperation.retrieve).toBe(1);
      expect(metrics.memoryTool.successRate).toBe(1);
    });
  });

  describe('getAggregatedMetrics', () => {
    beforeEach(async () => {
      // 添加测试数据
      await collector.recordTokenUsage({
        sessionId: 'session-1',
        model: 'gpt-4',
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        cost: 0.01
      });

      await collector.recordTokenUsage({
        sessionId: 'session-2',
        model: 'gpt-3.5-turbo',
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
        cost: 0.002
      });

      await collector.recordRequest({
        sessionId: 'session-1',
        model: 'gpt-4',
        duration: 1500,
        success: true
      });

      await collector.recordRequest({
        sessionId: 'session-2',
        model: 'gpt-3.5-turbo',
        duration: 800,
        success: true
      });
    });

    it('应该计算全局统计', () => {
      const metrics = collector.getAggregatedMetrics();

      expect(metrics.tokens.total).toBe(450);
      expect(metrics.tokens.totalCost).toBeCloseTo(0.012);
      expect(metrics.requests.total).toBe(2);
      expect(metrics.requests.successRate).toBe(1);
    });

    it('应该按模型分组统计', () => {
      const metrics = collector.getAggregatedMetrics();

      expect(metrics.byModel['gpt-4']).toBeDefined();
      expect(metrics.byModel['gpt-4'].tokens).toBe(300);
      expect(metrics.byModel['gpt-4'].requests).toBe(1);
      expect(metrics.byModel['gpt-4'].cost).toBeCloseTo(0.01);

      expect(metrics.byModel['gpt-3.5-turbo']).toBeDefined();
      expect(metrics.byModel['gpt-3.5-turbo'].tokens).toBe(150);
      expect(metrics.byModel['gpt-3.5-turbo'].requests).toBe(1);
    });

    it('应该支持按会话过滤', () => {
      const metrics = collector.getAggregatedMetrics({
        sessionId: 'session-1'
      });

      expect(metrics.tokens.total).toBe(300);
      expect(metrics.requests.total).toBe(1);
    });
  });

  describe('persistence', () => {
    it('应该持久化指标到文件', async () => {
      await collector.recordTokenUsage({
        sessionId: 'test',
        model: 'gpt-4',
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300
      });

      // 创建新实例加载数据
      const newCollector = new MetricsCollector();
      Object.defineProperty(newCollector, 'metricsDir', {
        value: tempDir,
        writable: false
      });
      Object.defineProperty(newCollector, 'tokenUsageFile', {
        value: path.join(tempDir, 'token-usage.json'),
        writable: false
      });
      Object.defineProperty(newCollector, 'requestsFile', {
        value: path.join(tempDir, 'requests.json'),
        writable: false
      });
      Object.defineProperty(newCollector, 'compressionsFile', {
        value: path.join(tempDir, 'compressions.json'),
        writable: false
      });
      Object.defineProperty(newCollector, 'memoryToolFile', {
        value: path.join(tempDir, 'memory-tool.json'),
        writable: false
      });

      await newCollector.initialize();

      const metrics = newCollector.getAggregatedMetrics();
      expect(metrics.tokens.total).toBe(300);
    });
  });
});
