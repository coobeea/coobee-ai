/**
 * CronScheduler - 格式规范化单元测试
 *
 * 测试 normalizeCronExpression() 方法
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CronScheduler } from '../CronScheduler';
import { CronJobStore } from '../CronJobStore';
import { CronJobExecutor } from '../CronJobExecutor';

describe('CronScheduler - normalizeCronExpression', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    const store = new CronJobStore();
    const executor = new CronJobExecutor(store);
    scheduler = new CronScheduler(store, executor);
  });

  describe('5 位格式转换', () => {
    it('应该将标准 5 位格式转换为 6 位', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('30 5 * * *')).toBe('0 30 5 * * *');
    });

    it('应该将包含范围的 5 位格式转换为 6 位', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 16 * * 1-5')).toBe('0 0 16 * * 1-5');
    });

    it('应该将包含步长的 5 位格式转换为 6 位', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('*/10 * * * *')).toBe('0 */10 * * * *');
    });

    it('应该将包含列表的 5 位格式转换为 6 位', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0,15,30,45 * * * *')).toBe('0 0,15,30,45 * * * *');
    });

    it('应该处理复杂表达式', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('*/5 9-17 * * 1-5')).toBe('0 */5 9-17 * * 1-5');
    });
  });

  describe('6 位格式保持不变', () => {
    it('应该保持标准 6 位格式不变', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 30 5 * * *')).toBe('0 30 5 * * *');
    });

    it('应该保持复杂 6 位格式不变', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('30 0 16 * * 1-5')).toBe('30 0 16 * * 1-5');
    });

    it('应该保持 7 位格式（含年份）不变', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 30 5 * * * 2026')).toBe('0 30 5 * * * 2026');
    });
  });

  describe('边界情况处理', () => {
    it('应该处理多余的空格', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('  30   5  *  *  *  ')).toBe('0 30 5 * * *');
    });

    it('应该处理 Tab 字符', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('30\t5\t*\t*\t*')).toBe('0 30 5 * * *');
    });

    it('应该处理混合空白字符', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('30  5\t* \t*  *')).toBe('0 30 5 * * *');
    });
  });

  describe('错误处理', () => {
    it('应该拒绝少于 5 位的表达式', () => {
      // @ts-expect-error - 测试私有方法
      expect(() => scheduler.normalizeCronExpression('30 5 *')).toThrow('无效的 cron 表达式格式');
    });

    it('应该拒绝空字符串', () => {
      // @ts-expect-error - 测试私有方法
      expect(() => scheduler.normalizeCronExpression('')).toThrow('无效的 cron 表达式格式');
    });

    it('应该拒绝只有空格的字符串', () => {
      // @ts-expect-error - 测试私有方法
      expect(() => scheduler.normalizeCronExpression('   ')).toThrow('无效的 cron 表达式格式');
    });
  });

  describe('真实场景测试', () => {
    it('应该正确转换"起床提醒"任务', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('30 5 * * *')).toBe('0 30 5 * * *');
    });

    it('应该正确转换"证券数据抓取"任务', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 16 * * 1-5')).toBe('0 0 16 * * 1-5');
    });

    it('应该正确转换"每日会话沉淀"任务', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 1 * * *')).toBe('0 0 1 * * *');
    });

    it('应该正确转换"knowledge-archive"任务', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('0 2 * * *')).toBe('0 0 2 * * *');
    });

    it('应该正确转换"worker-health-check"任务', () => {
      // @ts-expect-error - 测试私有方法
      expect(scheduler.normalizeCronExpression('*/10 * * * *')).toBe('0 */10 * * * *');
    });
  });
});
