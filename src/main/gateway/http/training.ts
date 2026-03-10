/**
 * 训练相关 HTTP 路由
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { TrainingSessionStore } from '@main/training/TrainingSessionStore';
import { TrainingExecutor } from '@main/training/TrainingExecutor';
import { ParallelTrainingExecutor } from '@main/training/ParallelTrainingExecutor';
import { AdaptiveTrainingExecutor } from '@main/training/AdaptiveTrainingExecutor';
import { DEFAULT_TRAINING_CONFIG } from '@main/training/types';
import { Env } from '@main/common/env';
import { log as logger } from '@main/common/logger';

// 全局实例（单例）
let trainingStore: TrainingSessionStore;
let trainingExecutor: TrainingExecutor;
let parallelTrainingExecutor: ParallelTrainingExecutor;
let adaptiveTrainingExecutor: AdaptiveTrainingExecutor;

function ensureInstances(): void {
  if (!trainingStore) {
    trainingStore = new TrainingSessionStore(Env.paths.userHome);
  }
  if (!trainingExecutor) {
    trainingExecutor = new TrainingExecutor(trainingStore);
  }
  if (!parallelTrainingExecutor) {
    parallelTrainingExecutor = new ParallelTrainingExecutor(trainingStore);
  }
  if (!adaptiveTrainingExecutor) {
    adaptiveTrainingExecutor = new AdaptiveTrainingExecutor(trainingStore, {
      ...DEFAULT_TRAINING_CONFIG,
      enableCoach: true,
      enableTestSet: false
    });
  }
}

/**
 * 注册训练路由
 */
export function registerTrainingRoutes(router: Router): void {
  // 创建训练
  router.post('/training/sessions', async (ctx: Context) => {
    ensureInstances();

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const agentId = String(body.agentId || '');
      const goalName = String(body.goalName || '');
      const maxRounds = Number(body.maxRounds || 0);
      const strategy = String(body.strategy || 'sequential');
      const parallelCount = Number(body.parallelCount || 1);
      const continueFromSessionId = body.continueFromSessionId ? String(body.continueFromSessionId) : undefined;

      // 验证参数
      if (!agentId || !goalName || !maxRounds) {
        ctx.status = 400;
        ctx.body = { error: '缺少必需参数: agentId, goalName, maxRounds' };
        return;
      }

      // TODO: 根据 goalName 加载对应的训练目标和数据集
      // 目前暂时硬编码"代码生成能力"
      const goal = {
        name: goalName,
        description: '训练智能体的代码生成能力',
        dimensions: [
          {
            name: 'correctness',
            label: '正确性',
            description: '代码可运行且通过测试',
            weight: 40,
            criteria: '基于测试用例'
          },
          { name: 'quality', label: '代码质量', description: '命名规范、结构清晰', weight: 30, criteria: '代码审查' },
          {
            name: 'edge_cases',
            label: '边界处理',
            description: '处理异常和边界情况',
            weight: 20,
            criteria: '边界测试'
          },
          { name: 'performance', label: '性能', description: '时间和空间复杂度合理', weight: 10, criteria: '算法分析' }
        ],
        threshold: 80
      };

      // 创建训练会话
      const autoCreateVersion = body.autoCreateVersion === true;

      const session = await trainingStore.create({
        agentId,
        goal,
        dataset: 'code-generation-basic.json', // TODO: 动态选择数据集
        maxRounds,
        strategy: (strategy || 'sequential') as 'sequential' | 'parallel' | 'adaptive' | 'weakness-targeted',
        parallelCount: parallelCount || 1,
        parentSessionId: continueFromSessionId,
        metadata: {
          autoCreateVersion
        }
      });

      // 异步启动训练（根据策略选择执行器）
      let executor: TrainingExecutor;
      if (session.strategy === 'parallel') {
        executor = parallelTrainingExecutor;
      } else if (session.strategy === 'adaptive' || session.strategy === 'weakness-targeted') {
        executor = adaptiveTrainingExecutor;
      } else {
        executor = trainingExecutor;
      }

      executor.executeTraining(session).catch((err) => {
        logger.error('[Training API] 训练执行失败:', err);
      });

      ctx.body = { session };
    } catch (err) {
      logger.error('[Training API] 创建训练失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 获取训练列表
  router.get('/training/sessions', async (ctx: Context) => {
    ensureInstances();

    try {
      const { agentId, status, goalName } = ctx.query;

      const sessions = await trainingStore.list({
        agentId: agentId as string | undefined,
        status: status as 'pending' | 'running' | 'paused' | 'completed' | 'failed' | undefined,
        goalName: goalName as string | undefined
      });

      ctx.body = { sessions };
    } catch (err) {
      logger.error('[Training API] 获取训练列表失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 获取训练详情
  router.get('/training/sessions/:id', async (ctx: Context) => {
    ensureInstances();

    try {
      const session = await trainingStore.load(ctx.params.id);
      if (!session) {
        ctx.status = 404;
        ctx.body = { error: '训练会话不存在' };
        return;
      }

      ctx.body = { session };
    } catch (err) {
      logger.error('[Training API] 获取训练详情失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 暂停训练
  router.post('/training/sessions/:id/pause', async (ctx: Context) => {
    ensureInstances();

    try {
      await trainingExecutor.pause(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      logger.error('[Training API] 暂停训练失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 恢复训练
  router.post('/training/sessions/:id/resume', async (ctx: Context) => {
    ensureInstances();

    try {
      // 异步恢复训练
      trainingExecutor.resume(ctx.params.id).catch((err) => {
        logger.error('[Training API] 恢复训练失败:', err);
      });

      ctx.body = { success: true };
    } catch (err) {
      logger.error('[Training API] 恢复训练失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 停止训练
  router.post('/training/sessions/:id/stop', async (ctx: Context) => {
    ensureInstances();

    try {
      await trainingExecutor.stop(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      logger.error('[Training API] 停止训练失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 删除训练
  router.delete('/training/sessions/:id', async (ctx: Context) => {
    ensureInstances();

    try {
      await trainingStore.delete(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      logger.error('[Training API] 删除训练失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 获取弱点分析
  router.get('/training/sessions/:id/weakness', async (ctx: Context) => {
    ensureInstances();

    try {
      const session = await trainingStore.load(ctx.params.id);
      if (!session) {
        ctx.status = 404;
        ctx.body = { error: '训练会话不存在' };
        return;
      }

      const { WeaknessAnalyzer } = await import('@main/training/WeaknessAnalyzer');
      const analyzer = new WeaknessAnalyzer();
      const analysis = analyzer.analyze(session);

      ctx.body = { success: true, data: analysis };
    } catch (err) {
      logger.error('[Training API] 弱点分析失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 手动创建训练版本
  router.post('/training/sessions/:id/create-version', async (ctx: Context) => {
    ensureInstances();

    try {
      const session = await trainingStore.load(ctx.params.id);
      if (!session) {
        ctx.status = 404;
        ctx.body = { error: '训练会话不存在' };
        return;
      }

      if (session.status !== 'completed') {
        ctx.status = 400;
        ctx.body = { error: '只能为已完成的训练创建版本' };
        return;
      }

      const { TrainingVersionManager } = await import('@main/training/TrainingVersionManager');
      const versionManager = new TrainingVersionManager();
      const versionId = await versionManager.createTrainedVersion(session);

      // 更新会话记录
      session.trainedVersionId = versionId;
      await trainingStore.save(session);

      ctx.body = { success: true, data: { versionId } };
    } catch (err) {
      logger.error('[Training API] 创建版本失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 列出 Agent 的所有训练版本
  router.get('/training/agents/:agentId/versions', async (ctx: Context) => {
    ensureInstances();

    try {
      const agentId = ctx.params.agentId;
      const { TrainingVersionManager } = await import('@main/training/TrainingVersionManager');
      const versionManager = new TrainingVersionManager();
      const versions = await versionManager.listTrainedVersions(agentId);

      ctx.body = { success: true, data: versions };
    } catch (err) {
      logger.error('[Training API] 获取版本列表失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
