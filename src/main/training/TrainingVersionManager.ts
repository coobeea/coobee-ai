/**
 * 训练版本管理器 - Phase 5
 *
 * 核心功能：
 * - 训练完成后创建新版本 Agent
 * - 分析训练结果，提取优化建议
 * - 保留训练元数据（训练会话、得分、弱点等）
 * - 版本追溯和对比
 */

import * as fs from 'fs';
import * as path from 'path';
import { WeaknessAnalyzer } from './WeaknessAnalyzer';
import type { TrainingSession } from './types';
import { log as logger } from '@main/common/logger';
import { Env } from '@main/common/env';

/**
 * Agent 定义（简化版）
 */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  skills?: string[];
  tools?: string[];
  models?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * 训练优化建议
 */
export interface TrainingOptimization {
  /** 优化建议列表 */
  suggestions: string[];
  /** 识别的主要问题 */
  majorIssues: string[];
  /** 建议的改进方向 */
  improvements: string[];
  /** 训练统计 */
  statistics: {
    totalRounds: number;
    passRate: number;
    avgScore: number;
    weakDimensions: string[];
  };
}

export class TrainingVersionManager {
  private readonly agentsDir: string;
  private readonly weaknessAnalyzer: WeaknessAnalyzer;

  constructor(agentsDir?: string) {
    // agents 目录在项目根目录下
    const projectRoot = path.resolve(Env.paths.root, '../../');
    this.agentsDir = agentsDir || path.join(projectRoot, 'agents');
    this.weaknessAnalyzer = new WeaknessAnalyzer();
  }

  /**
   * 训练完成后创建新版本 Agent
   */
  async createTrainedVersion(session: TrainingSession): Promise<string> {
    logger.info(`[VersionManager] 开始为 ${session.agentId} 创建训练版本`);

    // 1. 加载原始 Agent 定义
    const originalAgent = await this.loadAgentDefinition(session.agentId);

    // 2. 分析训练结果，生成优化建议
    const optimizations = this.analyzeOptimizations(session);

    // 3. 生成新版本 ID
    const timestamp = Date.now();
    const newVersionId = `${session.agentId}-trained-${timestamp}`;

    // 4. 构建训练元数据
    const trainingMetadata = {
      isTrainedVersion: true,
      parentAgentId: session.agentId,
      trainingSessionId: session.id,
      trainedAt: timestamp,
      trainingGoal: session.goal.name,
      trainingRounds: session.results.length,
      finalScore: this.calculateFinalScore(session),
      passRate: this.calculatePassRate(session),
      weakDimensions: optimizations.statistics.weakDimensions,
      optimizations: {
        suggestions: optimizations.suggestions,
        majorIssues: optimizations.majorIssues,
        improvements: optimizations.improvements
      }
    };

    // 5. 创建新版本 Agent 定义
    const newAgent: AgentDefinition = {
      ...originalAgent,
      id: newVersionId,
      name: `${originalAgent.name} (训练版)`,
      description: `${originalAgent.description}\n\n🎓 训练信息：\n- 训练目标: ${session.goal.name}\n- 训练轮次: ${session.results.length}\n- 最终得分: ${trainingMetadata.finalScore.toFixed(1)}\n- 通过率: ${(trainingMetadata.passRate * 100).toFixed(1)}%`,
      metadata: {
        ...(originalAgent.metadata || {}),
        ...trainingMetadata
      }
    };

    // 6. 保存新版本 Agent
    await this.saveAgentDefinition(newAgent);

    logger.info(`[VersionManager] 训练版本创建成功: ${newVersionId}`);
    logger.info(
      `[VersionManager] 最终得分: ${trainingMetadata.finalScore.toFixed(1)}, 通过率: ${(trainingMetadata.passRate * 100).toFixed(1)}%`
    );

    return newVersionId;
  }

  /**
   * 分析训练结果，提取优化建议
   */
  private analyzeOptimizations(session: TrainingSession): TrainingOptimization {
    const results = session.results;

    // 1. 基础统计
    const totalRounds = results.length;
    const passedRounds = results.filter((r) => r.evaluation.passed).length;
    const passRate = passedRounds / totalRounds;
    const avgScore = results.reduce((sum, r) => sum + r.evaluation.score, 0) / totalRounds;

    // 2. 弱点分析
    const weakness = this.weaknessAnalyzer.analyze(session);
    const weakDimensions = weakness.weakDimensions.map((d) => d.dimension);

    // 3. 提取主要问题
    const majorIssues: string[] = [];
    if (passRate < 0.7) {
      majorIssues.push(`整体通过率较低 (${(passRate * 100).toFixed(1)}%)，需要加强基础能力`);
    }
    if (avgScore < 70) {
      majorIssues.push(`平均得分偏低 (${avgScore.toFixed(1)}分)，建议增加训练轮次`);
    }
    for (const dim of weakness.weakDimensions.slice(0, 3)) {
      majorIssues.push(`${dim.dimension} 维度薄弱 (失败率 ${(dim.failureRate * 100).toFixed(1)}%)`);
    }

    // 4. 生成优化建议
    const suggestions: string[] = [];
    if (weakDimensions.length > 0) {
      suggestions.push(`针对弱点维度 [${weakDimensions.join(', ')}] 进行增量训练`);
    }
    if (passRate < 0.8) {
      suggestions.push(`使用 weakness-targeted 策略进行弱点强化训练`);
    }
    if (avgScore >= 80 && passRate >= 0.8) {
      suggestions.push(`表现良好，可以尝试更高难度的训练目标`);
    }

    // 5. 改进方向
    const improvements: string[] = [];
    if (weakDimensions.length > 0) {
      improvements.push(`在 instructions 中强化 ${weakDimensions[0]} 相关的指导`);
    }
    if (passRate < 0.7) {
      improvements.push(`增加更多示例和边界情况处理说明`);
    }

    return {
      suggestions,
      majorIssues,
      improvements,
      statistics: {
        totalRounds,
        passRate: Math.round(passRate * 100) / 100,
        avgScore: Math.round(avgScore * 10) / 10,
        weakDimensions
      }
    };
  }

  /**
   * 计算最终得分
   */
  private calculateFinalScore(session: TrainingSession): number {
    const results = session.results;
    if (results.length === 0) return 0;

    // 取最近 20% 轮次的平均分（代表训练后的稳定表现）
    const recentCount = Math.max(10, Math.floor(results.length * 0.2));
    const recentResults = results.slice(-recentCount);
    const avgScore = recentResults.reduce((sum, r) => sum + r.evaluation.score, 0) / recentResults.length;

    return Math.round(avgScore * 10) / 10;
  }

  /**
   * 计算通过率
   */
  private calculatePassRate(session: TrainingSession): number {
    const results = session.results;
    if (results.length === 0) return 0;

    const passedCount = results.filter((r) => r.evaluation.passed).length;
    return Math.round((passedCount / results.length) * 100) / 100;
  }

  /**
   * 加载 Agent 定义
   */
  private async loadAgentDefinition(agentId: string): Promise<AgentDefinition> {
    const filePath = path.join(this.agentsDir, `${agentId}.json`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Agent 定义文件不存在: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * 保存 Agent 定义
   */
  private async saveAgentDefinition(agent: AgentDefinition): Promise<void> {
    const filePath = path.join(this.agentsDir, `${agent.id}.json`);

    // 确保目录存在
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    }

    // 保存为格式化的 JSON
    fs.writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');

    logger.info(`[VersionManager] Agent 定义已保存: ${filePath}`);
  }

  /**
   * 列出某个 Agent 的所有训练版本
   */
  async listTrainedVersions(agentId: string): Promise<AgentDefinition[]> {
    if (!fs.existsSync(this.agentsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.agentsDir);
    const versions: AgentDefinition[] = [];

    for (const file of files) {
      if (file.startsWith(`${agentId}-trained-`) && file.endsWith('.json')) {
        const filePath = path.join(this.agentsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        versions.push(JSON.parse(content));
      }
    }

    // 按训练时间降序排序
    versions.sort((a, b) => {
      const timeA = ((a.metadata as Record<string, unknown>)?.trainedAt as number) || 0;
      const timeB = ((b.metadata as Record<string, unknown>)?.trainedAt as number) || 0;
      return timeB - timeA;
    });

    return versions;
  }

  /**
   * 获取版本对比信息
   */
  async compareVersions(
    versionId1: string,
    versionId2: string
  ): Promise<{
    version1: AgentDefinition;
    version2: AgentDefinition;
    scoreDiff: number;
    passRateDiff: number;
  }> {
    const version1 = await this.loadAgentDefinition(versionId1);
    const version2 = await this.loadAgentDefinition(versionId2);

    const meta1 = version1.metadata as { finalScore?: number; passRate?: number } | undefined;
    const meta2 = version2.metadata as { finalScore?: number; passRate?: number } | undefined;

    const scoreDiff = (meta2?.finalScore || 0) - (meta1?.finalScore || 0);
    const passRateDiff = (meta2?.passRate || 0) - (meta1?.passRate || 0);

    return {
      version1,
      version2,
      scoreDiff,
      passRateDiff
    };
  }
}
