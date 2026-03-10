/**
 * PlanVersionManager 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanVersionManager } from '../PlanVersionManager';
import { PlanVersionReason } from '../types';

describe('PlanVersionManager', () => {
  let manager: PlanVersionManager;

  const mockSessionManager = {
    readPlanIndex: vi.fn().mockResolvedValue(null),
    writePlanIndex: vi.fn().mockResolvedValue(undefined),
    writePlanFile: vi.fn().mockResolvedValue(undefined),
    readPlanFile: vi.fn().mockResolvedValue(null),
    appendPlanChange: vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    manager = new PlanVersionManager(mockSessionManager, 'session-1');
    await manager.initialize();
  });

  describe('initialize', () => {
    it('无已有索引时创建新索引', () => {
      expect(manager.getCurrentVersion()).toBe(0);
    });

    it('加载已有索引', async () => {
      mockSessionManager.readPlanIndex.mockResolvedValueOnce({
        sessionId: 's1',
        versions: [],
        currentVersion: 2,
        totalVersions: 2,
        createdAt: 100,
        updatedAt: 200
      });

      const m = new PlanVersionManager(mockSessionManager, 's1');
      await m.initialize();
      expect(m.getCurrentVersion()).toBe(2);
    });
  });

  describe('createPlanVersion', () => {
    it('创建第一个版本', async () => {
      const plan = {
        id: 'plan-1',
        objective: 'test',
        subTasks: [{ id: 'st1', description: 'do something' }],
        stages: [{ stageIndex: 0, subTaskIds: ['st1'] }]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const version = await manager.createPlanVersion(plan, PlanVersionReason.INITIAL);
      expect(version).toBe(1);
      expect(manager.getCurrentVersion()).toBe(1);
      expect(mockSessionManager.writePlanFile).toHaveBeenCalled();
      expect(mockSessionManager.appendPlanChange).toHaveBeenCalled();
    });

    it('创建后续版本', async () => {
      const plan = {
        id: 'p1',
        subTasks: [{ id: 'st1' }],
        stages: [{ stageIndex: 0, subTaskIds: ['st1'] }]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      await manager.createPlanVersion(plan, PlanVersionReason.INITIAL);
      const v2 = await manager.createPlanVersion(plan, PlanVersionReason.TASK_FAILED, 'Task failed', 1);

      expect(v2).toBe(2);
      expect(manager.getCurrentVersion()).toBe(2);
    });
  });

  describe('getPlanHistory', () => {
    it('返回版本历史', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan = { id: 'p', subTasks: [{ id: 's' }], stages: [] } as any;
      await manager.createPlanVersion(plan, PlanVersionReason.INITIAL);
      await manager.createPlanVersion(plan, PlanVersionReason.TASK_FAILED, 'fail', 1);

      const history = manager.getPlanHistory();
      expect(history).toHaveLength(2);
    });
  });

  describe('getCurrentPlan', () => {
    it('无计划时返回 null', async () => {
      const plan = await manager.getCurrentPlan();
      expect(plan).toBeNull();
    });
  });

  describe('getPlanAnalytics', () => {
    it('返回空分析', async () => {
      const analytics = await manager.getPlanAnalytics();
      expect(analytics.totalVersions).toBe(0);
    });
  });
});
