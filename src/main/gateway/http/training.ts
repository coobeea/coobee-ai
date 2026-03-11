/**
 * 训练相关 HTTP 路由
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { TrainingSessionStore } from '@main/training/TrainingSessionStore';
import { TrainingExecutor } from '@main/training/TrainingExecutor';
import { ParallelTrainingExecutor } from '@main/training/ParallelTrainingExecutor';
import { AdaptiveTrainingExecutor } from '@main/training/AdaptiveTrainingExecutor';
import { GoalGenerator } from '@main/training/GoalGenerator';
import { KnowledgeBaseDataSource } from '@main/training/data-sources/KnowledgeBaseDataSource';
import { DEFAULT_TRAINING_CONFIG } from '@main/training/types';
import { Env } from '@main/common/env';
import { log as logger } from '@main/common/logger';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
      const skillName = String(body.skillName || '');
      const goalDescription = String(body.goalDescription || '');
      const dataSource = body.dataSource as { type: string; path?: string } | undefined;
      const maxRounds = Number(body.maxRounds || 0);
      const strategy = String(body.strategy || 'sequential');
      const parallelCount = Number(body.parallelCount || 1);
      const continueFromSessionId = body.continueFromSessionId ? String(body.continueFromSessionId) : undefined;

      // 验证参数
      if (!agentId || !skillName || !goalDescription || !maxRounds) {
        ctx.status = 400;
        ctx.body = { error: '缺少必需参数: agentId, skillName, goalDescription, maxRounds' };
        return;
      }

      if (!dataSource || !dataSource.type) {
        ctx.status = 400;
        ctx.body = { error: '缺少数据源配置' };
        return;
      }

      logger.info(`[Training API] 创建训练: ${agentId} + ${skillName}, 目标: ${goalDescription}`);

      // 1. 生成训练目标（使用 GoalGenerator）
      const goalGenerator = new GoalGenerator();
      const goal = await goalGenerator.generate({
        agentId,
        skillName,
        goalDescription
      });

      logger.info(`[Training API] 训练目标已生成: ${goal.name} (${goal.dimensions.length} 个维度)`);

      // 2. 生成训练数据集
      let dataset;

      if (dataSource.type === 'knowledge-base') {
        if (!dataSource.path) {
          ctx.status = 400;
          ctx.body = { error: '知识库类型需要提供 path' };
          return;
        }

        // 使用知识库数据源
        const kbDataSource = new KnowledgeBaseDataSource({
          path: dataSource.path,
          trainingGoal: goal,
          agentId,
          skillName
        });

        dataset = await kbDataSource.generate({
          totalCount: Math.min(maxRounds, 100), // 数据集大小不超过 100
          trainTestRatio: 0.8,
          batchSize: 30
        });

        logger.info(
          `[Training API] 数据集已生成: ${dataset.trainSet.length} 个训练任务, ${dataset.testSet.length} 个测试任务`
        );

        // 保存数据集到临时文件
        const datasetDir = path.join(Env.paths.userHome, 'training', 'datasets');
        if (!fs.existsSync(datasetDir)) {
          fs.mkdirSync(datasetDir, { recursive: true });
        }

        const datasetFilename = `${skillName}-${Date.now()}.json`;
        const datasetPath = path.join(datasetDir, datasetFilename);
        fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf-8');

        logger.info(`[Training API] 数据集已保存: ${datasetPath}`);
      } else {
        // 其他数据源类型（历史会话、自动生成等）
        ctx.status = 400;
        ctx.body = { error: `不支持的数据源类型: ${dataSource.type}` };
        return;
      }

      // 3. 创建训练会话
      const autoCreateVersion = body.autoCreateVersion === true;

      const session = await trainingStore.create({
        agentId,
        goal,
        dataset: dataset, // 直接传递 TrainingDataset 对象
        maxRounds,
        strategy: (strategy || 'sequential') as 'sequential' | 'parallel' | 'adaptive' | 'weakness-targeted',
        parallelCount: parallelCount || 1,
        parentSessionId: continueFromSessionId,
        metadata: {
          autoCreateVersion,
          skillName,
          goalDescription,
          dataSourceType: dataSource.type,
          dataSourcePath: dataSource.path
        }
      });

      // 4. 异步启动训练（根据策略选择执行器）
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
