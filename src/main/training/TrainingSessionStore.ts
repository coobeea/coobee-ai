/**
 * 训练会话持久化
 *
 * 负责：
 * - 训练会话的创建、读取、更新、删除
 * - 训练会话的列表和查询
 * - 训练进度的实时保存
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrainingSession, CreateTrainingParams, TrainingDataset, TrainingStatus } from './types';
import { log as logger } from '@main/common/logger';
import { Env } from '@main/common/env';

export class TrainingSessionStore {
  private readonly sessionsDir: string;

  constructor(userHome: string) {
    this.sessionsDir = path.join(userHome, 'training-sessions');
    this.ensureDir();
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      logger.info(`[TrainingStore] 创建训练会话目录: ${this.sessionsDir}`);
    }
  }

  // ==================== CRUD ====================

  /**
   * 创建训练会话
   */
  async create(params: CreateTrainingParams): Promise<TrainingSession> {
    logger.info(`[TrainingStore] 创建训练会话: 智能体=${params.agentId}, 目标=${params.goal.name}`);

    // 加载数据集
    const dataset = typeof params.dataset === 'string' ? await this.loadDataset(params.dataset) : params.dataset;

    // 如果是增量训练，加载父会话
    let parentSession: TrainingSession | null = null;
    if (params.parentSessionId) {
      parentSession = await this.load(params.parentSessionId);
      if (!parentSession) {
        throw new Error(`父会话不存在: ${params.parentSessionId}`);
      }
      logger.info(
        `[TrainingStore] 增量训练: 从会话 ${params.parentSessionId} 继承 ${parentSession.results.length} 轮结果`
      );
    }

    // 创建会话对象
    const session: TrainingSession = {
      id: `training-${Date.now()}`,
      agentId: params.agentId,
      goal: params.goal,
      dataset,
      maxRounds: params.maxRounds,
      strategy: params.strategy || 'sequential',
      parallelCount: params.parallelCount || 1,
      status: 'pending',
      progress: parentSession
        ? {
            currentRound: parentSession.progress.completedRounds,
            totalRounds: params.maxRounds,
            completedRounds: parentSession.progress.completedRounds,
            passedRounds: parentSession.progress.passedRounds
          }
        : {
            currentRound: 0,
            totalRounds: params.maxRounds,
            completedRounds: 0,
            passedRounds: 0
          },
      results: parentSession ? [...parentSession.results] : [],
      startTime: Date.now(),
      parentSessionId: params.parentSessionId,
      metadata: {
        ...params.metadata,
        isIncremental: !!params.parentSessionId
      }
    };

    // 持久化
    await this.save(session);

    logger.info(`[TrainingStore] 训练会话已创建: ${session.id}`);
    return session;
  }

  /**
   * 保存训练会话
   */
  async save(session: TrainingSession): Promise<void> {
    const filePath = this.getSessionPath(session.id);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * 加载训练会话
   */
  async load(sessionId: string): Promise<TrainingSession | null> {
    const filePath = this.getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) {
      logger.warn(`[TrainingStore] 训练会话不存在: ${sessionId}`);
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  /**
   * 更新训练会话
   */
  async update(sessionId: string, updates: Partial<TrainingSession>): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`训练会话不存在: ${sessionId}`);
    }

    Object.assign(session, updates);
    await this.save(session);
  }

  /**
   * 删除训练会话
   */
  async delete(sessionId: string): Promise<void> {
    const filePath = this.getSessionPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`[TrainingStore] 训练会话已删除: ${sessionId}`);
    }
  }

  // ==================== 查询 ====================

  /**
   * 列出所有训练会话
   */
  async list(filter?: { agentId?: string; status?: TrainingStatus; goalName?: string }): Promise<TrainingSession[]> {
    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));

    const sessions = files.map((f) => {
      const raw = fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8');
      return JSON.parse(raw) as TrainingSession;
    });

    // 过滤
    let filtered = sessions;
    if (filter?.agentId) {
      filtered = filtered.filter((s) => s.agentId === filter.agentId);
    }
    if (filter?.status) {
      filtered = filtered.filter((s) => s.status === filter.status);
    }
    if (filter?.goalName) {
      filtered = filtered.filter((s) => s.goal.name === filter.goalName);
    }

    // 按开始时间倒序
    return filtered.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * 列出运行中的训练会话
   */
  async listRunning(): Promise<TrainingSession[]> {
    return await this.list({ status: 'running' });
  }

  /**
   * 列出某个智能体的训练历史
   */
  async listByAgent(agentId: string): Promise<TrainingSession[]> {
    return await this.list({ agentId });
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取会话文件路径
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  /**
   * 加载数据集文件
   */
  private async loadDataset(datasetPath: string): Promise<TrainingDataset> {
    // 如果是绝对路径，直接使用
    if (path.isAbsolute(datasetPath)) {
      if (!fs.existsSync(datasetPath)) {
        throw new Error(`数据集文件不存在: ${datasetPath}`);
      }
      const raw = fs.readFileSync(datasetPath, 'utf-8');
      const dataset = JSON.parse(raw);

      // 验证数据集格式
      if (!dataset.trainSet || !Array.isArray(dataset.trainSet)) {
        throw new Error('数据集格式错误：缺少 trainSet');
      }

      logger.info(
        `[TrainingStore] 数据集已加载: ${dataset.name} (训练集: ${dataset.trainSet.length}, 测试集: ${dataset.testSet?.length || 0})`
      );
      return dataset;
    }

    // 相对路径，从 datasets 目录加载
    const fullPath = path.join(Env.paths.userHome, 'datasets', datasetPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`数据集文件不存在: ${fullPath}`);
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const dataset = JSON.parse(raw);

    // 验证数据集格式
    if (!dataset.trainSet || !Array.isArray(dataset.trainSet)) {
      throw new Error('数据集格式错误：缺少 trainSet');
    }

    logger.info(
      `[TrainingStore] 数据集已加载: ${dataset.name} (训练集: ${dataset.trainSet.length}, 测试集: ${dataset.testSet?.length || 0})`
    );
    return dataset;
  }

  /**
   * 更新训练进度（频繁调用，优化性能）
   */
  async updateProgress(sessionId: string, progress: Partial<TrainingSession['progress']>): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) return;

    // 只更新 progress 字段
    session.progress = { ...session.progress, ...progress };

    // 计算平均分等统计信息
    if (session.results.length > 0) {
      const scores = session.results.map((r) => r.evaluation.score);
      session.progress.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      session.progress.maxScore = Math.max(...scores);
      session.progress.minScore = Math.min(...scores);
    }

    await this.save(session);
  }
}
