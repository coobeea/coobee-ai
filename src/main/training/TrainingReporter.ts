/**
 * TrainingReporter - 训练报告生成器
 *
 * 职责：
 *   1. 分析训练记录
 *   2. 统计成果数据（生成了多少文件）
 *   3. 生成 Markdown 训练报告
 */

import { log as logger } from '@main/common/logger';
import { Env } from '@main/common/env';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { TrainingSession } from './types';

export interface TrainingReportData {
  /** 训练会话信息 */
  session: TrainingSession;
  /** 训练时长（毫秒） */
  duration: number;
  /** 整体通过率 */
  overallPassRate: number;
  /** 首次通过率 */
  firstAttemptPassRate: number;
  /** 各维度平均分 */
  dimensionScores: Record<string, number>;
  /** 各维度通过率 */
  dimensionPassRates: Record<string, number>;
  /** 弱点维度 */
  weakDimensions: Array<{ name: string; avgScore: number; passRate: number }>;
  /** 每条数据详情 */
  taskDetails: Array<{
    taskId: string;
    attempts: number;
    finalScore: number;
    passed: boolean;
    generatedFiles?: string[];
  }>;
}

export class TrainingReporter {
  /**
   * 生成训练报告
   *
   * @param session - 训练会话
   * @returns 报告内容（Markdown）
   */
  async generate(session: TrainingSession): Promise<string> {
    logger.info(`[TrainingReporter] 生成训练报告: ${session.id}`);

    try {
      // 1. 分析数据
      const data = this.analyzeSession(session);

      // 2. 生成 Markdown
      const markdown = this.buildMarkdown(data);

      // 3. 保存报告
      await this.saveReport(session, markdown);

      return markdown;
    } catch (error) {
      logger.error(`[TrainingReporter] 生成报告失败:`, error);
      throw error;
    }
  }

  /**
   * 分析训练会话
   */
  private analyzeSession(session: TrainingSession): TrainingReportData {
    const { results, startTime, endTime, goal } = session;

    // 训练时长
    const duration = endTime ? endTime - startTime : 0;

    // 整体通过率
    const passedCount = results.filter((r) => r.evaluation.passed).length;
    const overallPassRate = results.length > 0 ? (passedCount / results.length) * 100 : 0;

    // 首次通过率（第 1 次尝试就通过的比例）
    const firstAttemptPassed = results.filter(
      (r) => r.evaluation.passed && (r.totalAttempts === undefined || r.totalAttempts === 1)
    ).length;
    const firstAttemptPassRate = results.length > 0 ? (firstAttemptPassed / results.length) * 100 : 0;

    // 各维度平均分和通过率
    const dimensionScores: Record<string, number[]> = {};
    const dimensionPassed: Record<string, number[]> = {};

    results.forEach((result) => {
      if (result.evaluation.dimensions) {
        Object.entries(result.evaluation.dimensions).forEach(([dim, score]) => {
          if (!dimensionScores[dim]) {
            dimensionScores[dim] = [];
            dimensionPassed[dim] = [];
          }
          dimensionScores[dim].push(score);

          // 判断该维度是否通过（假设 >= 75 为通过）
          const dimDef = goal.dimensions.find((d) => d.name === dim);
          const threshold = dimDef ? goal.threshold : 75;
          dimensionPassed[dim].push(score >= threshold ? 1 : 0);
        });
      }
    });

    const avgDimensionScores: Record<string, number> = {};
    const dimensionPassRates: Record<string, number> = {};

    Object.entries(dimensionScores).forEach(([dim, scores]) => {
      avgDimensionScores[dim] = scores.reduce((a, b) => a + b, 0) / scores.length;
      const passCount = dimensionPassed[dim].reduce((a, b) => a + b, 0);
      dimensionPassRates[dim] = (passCount / dimensionPassed[dim].length) * 100;
    });

    // 弱点维度（按通过率排序）
    const weakDimensions = Object.entries(dimensionPassRates)
      .map(([name, passRate]) => ({
        name,
        avgScore: avgDimensionScores[name],
        passRate
      }))
      .sort((a, b) => a.passRate - b.passRate)
      .slice(0, 3); // 取最弱的 3 个

    // 每条数据详情
    const taskDetails = results.map((r) => ({
      taskId: r.taskId,
      attempts: r.totalAttempts || 1,
      finalScore: r.evaluation.score,
      passed: r.evaluation.passed,
      generatedFiles: [] // TODO: 从结果中提取生成的文件
    }));

    return {
      session,
      duration,
      overallPassRate,
      firstAttemptPassRate,
      dimensionScores: avgDimensionScores,
      dimensionPassRates,
      weakDimensions,
      taskDetails
    };
  }

  /**
   * 构建 Markdown 报告
   */
  private buildMarkdown(data: TrainingReportData): string {
    const {
      session,
      duration,
      overallPassRate,
      firstAttemptPassRate,
      dimensionPassRates,
      weakDimensions,
      taskDetails
    } = data;

    const durationMin = Math.floor(duration / 60000);
    const durationSec = Math.floor((duration % 60000) / 1000);

    const startDate = new Date(session.startTime).toLocaleString('zh-CN');
    const endDate = session.endTime ? new Date(session.endTime).toLocaleString('zh-CN') : '进行中';

    const markdown = `# 训练报告：${session.agentId} 智能体训练

**训练时间**：${startDate} - ${endDate}
**训练智能体**：${session.agentId}
${session.metadata?.skillName ? `**使用技能包**：${session.metadata.skillName}` : ''}
**训练轮次**：${session.results.length}
**数据源**：${session.metadata?.dataSourceType || '未知'}
**训练时长**：${durationMin} 分 ${durationSec} 秒

---

## 📊 训练数据统计

- **训练集**：${session.dataset.trainSet.length} 条
${session.dataset.testSet ? `- **测试集**：${session.dataset.testSet.length} 条（仅验证，不生成数据）` : ''}
- **数据源类型**：${session.metadata?.dataSourceType || '未知'}

---

## 🎯 训练结果

### 整体表现

| 指标 | 数值 |
|------|------|
| 总轮次 | ${session.results.length} |
| 总通过 | ${taskDetails.filter((t) => t.passed).length} (${overallPassRate.toFixed(1)}%) |
| 首次通过 | ${taskDetails.filter((t) => t.attempts === 1 && t.passed).length} (${firstAttemptPassRate.toFixed(1)}%) |
| 二次通过 | ${taskDetails.filter((t) => t.attempts === 2 && t.passed).length} |
| 三次通过 | ${taskDetails.filter((t) => t.attempts === 3 && t.passed).length} |
| 最终失败 | ${taskDetails.filter((t) => !t.passed).length} (${(100 - overallPassRate).toFixed(1)}%) |

### 各维度表现

| 维度 | 平均分 | 通过率 | 评价 |
|------|--------|--------|------|
${Object.entries(dimensionPassRates)
  .map(([dim, passRate]) => {
    const avgScore = data.dimensionScores[dim];
    const dimDef = session.goal.dimensions.find((d) => d.name === dim);
    const label = dimDef ? dimDef.label : dim;
    const evaluation = passRate >= 80 ? '✅ 优秀' : passRate >= 60 ? '✅ 良好' : '⚠️ 需改进';
    return `| ${label} | ${avgScore.toFixed(1)} | ${passRate.toFixed(1)}% | ${evaluation} |`;
  })
  .join('\n')}

### 弱点分析

**最弱维度**：${weakDimensions[0]?.name || '无'}

**改进建议**：
${weakDimensions
  .map((dim, i) => {
    const dimDef = session.goal.dimensions.find((d) => d.name === dim.name);
    const label = dimDef ? dimDef.label : dim.name;
    return `${i + 1}. **${label}**（通过率 ${dim.passRate.toFixed(1)}%）
   - 加强相关训练
   - 补充该维度的知识和示例`;
  })
  .join('\n')}

---

## 📝 每条数据详情

| 序号 | 任务 ID | 尝试次数 | 最终得分 | 结果 |
|------|---------|----------|----------|------|
${taskDetails
  .map((task, i) => {
    const result = task.passed ? '✅ 通过' : '❌ 失败';
    return `| ${i + 1} | ${task.taskId} | ${task.attempts} | ${task.finalScore} | ${result} |`;
  })
  .join('\n')}

---

## 🎓 训练成果

### 技能包数据增长

${session.metadata?.skillName ? `训练前：\n  skill-data/${session.metadata.skillName}/ → 未知\n\n训练后：\n  skill-data/${session.metadata.skillName}/ → ${taskDetails.filter((t) => t.passed).length} 个新记录\n  （${taskDetails.filter((t) => t.passed).length} 个通过质检，${taskDetails.filter((t) => !t.passed).length} 个失败未生成）` : '未记录技能包数据'}

### 数据质量

${Object.entries(data.dimensionScores)
  .map(([dim, score]) => {
    const dimDef = session.goal.dimensions.find((d) => d.name === dim);
    const label = dimDef ? dimDef.label : dim;
    const evaluation = score >= 80 ? '优秀' : score >= 60 ? '良好' : '需改进';
    return `- ${label}：${score.toFixed(1)} 分（${evaluation}）`;
  })
  .join('\n')}

### 下次使用效果预测

当智能体使用 ${session.metadata?.skillName || '该技能包'} 时：
- 可查询 ${taskDetails.filter((t) => t.passed).length} 个已知问题的解决方案
- 命中率预计：${overallPassRate.toFixed(0)}%+（基于训练通过率）
- 响应速度：更快（直接复用经验，无需重新思考）

---

## 💡 总结与建议

### 优势

${overallPassRate >= 80 ? '- ✅ 整体通过率高，训练效果良好' : ''}
${firstAttemptPassRate >= 50 ? '- ✅ 首次通过率高，智能体学习能力强' : ''}
${weakDimensions.length > 0 && weakDimensions[0].passRate >= 70 ? '- ✅ 各维度表现均衡' : ''}

### 需改进

${overallPassRate < 80 ? '- ⚠️ 整体通过率偏低，建议增加训练轮次或优化数据质量' : ''}
${weakDimensions.length > 0 && weakDimensions[0].passRate < 60 ? `- ⚠️ ${weakDimensions[0].name} 维度较弱，需针对性加强` : ''}
${taskDetails.filter((t) => t.attempts === 3 && !t.passed).length > 5 ? '- ⚠️ 多个任务达到最大尝试次数仍未通过，建议检查任务难度或评估标准' : ''}

---

**报告生成时间**：${new Date().toLocaleString('zh-CN')}
`;

    return markdown;
  }

  /**
   * 保存报告到文件
   */
  private async saveReport(session: TrainingSession, markdown: string): Promise<void> {
    try {
      // 保存到 ~/coobee-data/training/reports/
      const reportsDir = path.join(Env.paths.userHome, 'training', 'reports');

      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filename = `${session.id}-report.md`;
      const filepath = path.join(reportsDir, filename);

      fs.writeFileSync(filepath, markdown, 'utf-8');

      logger.info(`[TrainingReporter] 报告已保存: ${filepath}`);
    } catch (error) {
      logger.error(`[TrainingReporter] 保存报告失败:`, error);
      // 不抛出错误，报告生成失败不应影响训练流程
    }
  }
}
