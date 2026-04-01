/**
 * OrchestrationLifecycleMonitor - 编排任务生命周期监控器
 *
 * 职责：
 * 1. 监控 lifecycle 目录中的文档变化
 * 2. 检测阶段完成情况
 * 3. 更新 TODO、PROGRESS、BUGS 文件
 * 4. 发送阶段变更事件
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { SubTaskExecutionResult } from '../types';

const log = createLogger('orchestration-lifecycle-monitor');

export interface LifecycleStageUpdate {
  stage: 'requirement' | 'solution' | 'reflection' | 'implementation' | 'acceptance';
  status: 'started' | 'in-progress' | 'completed';
  timestamp: number;
}

export class OrchestrationLifecycleMonitor {
  constructor(private readonly lifecycleDir: string) {}

  /**
   * 更新 TODO 文件中的子任务状态
   */
  async updateTodoStatus(subTaskId: string, status: 'completed' | 'failed'): Promise<void> {
    try {
      const todoPath = path.join(this.lifecycleDir, '04-TODO.md');
      const content = await fs.readFile(todoPath, 'utf-8');

      // 查找子任务对应的 TODO 项（通过 ID 匹配）
      const pattern = new RegExp(`### (\\d+)\\.\\s+.*${subTaskId}.*\\n([\\s\\S]*?)(?=\\n###|$)`, 'i');
      const match = content.match(pattern);

      if (!match) {
        log.warn(`[LifecycleMonitor] Could not find TODO for subtask ${subTaskId}`);
        return;
      }

      const todoNumber = match[1];

      // 更新状态标记
      let updatedContent: string;
      if (status === 'completed') {
        updatedContent = content.replace(
          new RegExp(`### ${todoNumber}\\.\\s+.*\\n([\\s\\S]*?)- \\*\\*状态\\*\\*：\\[ \\] 待处理`, 'i'),
          (match) => match.replace('[ ] 待处理', '[x] 已完成')
        );
      } else {
        updatedContent = content.replace(
          new RegExp(`### ${todoNumber}\\.\\s+.*\\n([\\s\\S]*?)- \\*\\*状态\\*\\*：\\[ \\] 待处理`, 'i'),
          (match) => match.replace('[ ] 待处理', '[-] 已取消（失败）')
        );
      }

      await fs.writeFile(todoPath, updatedContent, 'utf-8');
      log.info(`[LifecycleMonitor] Updated TODO status for subtask ${subTaskId}: ${status}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to update TODO status:`, err);
    }
  }

  /**
   * 追加进度记录到 PROGRESS.md
   */
  async appendProgress(subTaskResult: SubTaskExecutionResult): Promise<void> {
    try {
      const progressPath = path.join(this.lifecycleDir, '05-PROGRESS.md');
      const timestamp = new Date().toLocaleString('zh-CN');

      const statusIcon = subTaskResult.status === 'completed' ? '✅' : '❌';
      const progressEntry = `
### ${timestamp}

- ${statusIcon} ${subTaskResult.status === 'completed' ? '完成了' : '失败了'} 子任务 [${subTaskResult.subTaskId}]
- 执行耗时：${subTaskResult.duration ? `${(subTaskResult.duration / 1000).toFixed(2)}秒` : '未知'}
${subTaskResult.error ? `- 错误信息：${subTaskResult.error}` : ''}
${subTaskResult.result ? `- 执行结果：${String(subTaskResult.result).slice(0, 200)}...` : ''}

---
`;

      await fs.appendFile(progressPath, progressEntry, 'utf-8');
      log.info(`[LifecycleMonitor] Appended progress for subtask ${subTaskResult.subTaskId}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to append progress:`, err);
    }
  }

  /**
   * 记录 Bug 到 BUGS.md
   */
  async recordBug(subTaskId: string, subTaskName: string, error: string, errorStack?: string): Promise<void> {
    try {
      const bugsPath = path.join(this.lifecycleDir, '06-BUGS.md');
      const content = await fs.readFile(bugsPath, 'utf-8');

      // 统计已有 Bug 数量
      const bugCount = (content.match(/### BUG-\d+:/g) || []).length;
      const bugId = `BUG-${String(bugCount + 1).padStart(3, '0')}`;
      const timestamp = new Date().toLocaleString('zh-CN');

      const bugEntry = `
### ${bugId}: 子任务执行失败 - ${subTaskName}

- **发现时间**：${timestamp}
- **严重程度**：严重
- **涉及模块**：编排模式 - 子任务执行
- **子任务 ID**：${subTaskId}
- **现象描述**：子任务在执行过程中失败
- **错误日志**：

\`\`\`
${error}
${errorStack ? `\n堆栈信息：\n${errorStack}` : ''}
\`\`\`

- **分析**：[待分析]
- **修复方案**：[待制定]
- **修复时间**：[待修复]
- **验证方式**：[待定]
- **状态**：[ ] 待修复

---
`;

      await fs.appendFile(bugsPath, bugEntry, 'utf-8');
      log.info(`[LifecycleMonitor] Recorded bug ${bugId} for subtask ${subTaskId}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to record bug:`, err);
    }
  }

  /**
   * 更新当前进度统计
   */
  async updateProgressStats(completedCount: number, totalCount: number): Promise<void> {
    try {
      const progressPath = path.join(this.lifecycleDir, '05-PROGRESS.md');
      const content = await fs.readFile(progressPath, 'utf-8');

      const percentage = Math.round((completedCount / totalCount) * 100);

      // 更新统计表格
      const updatedContent = content
        .replace(/\| 已完成 TODO \| .*? \|/, `| 已完成 TODO | ${completedCount}/${totalCount} |`)
        .replace(/\| 完成度\s+\| .*? \|/, `| 完成度      | ${percentage}% |`);

      await fs.writeFile(progressPath, updatedContent, 'utf-8');
      log.info(`[LifecycleMonitor] Updated progress stats: ${completedCount}/${totalCount} (${percentage}%)`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to update progress stats:`, err);
    }
  }

  /**
   * 生成验收报告
   */
  async generateAcceptanceReport(
    allResults: SubTaskExecutionResult[],
    startTime: number,
    endTime: number
  ): Promise<void> {
    try {
      const acceptancePath = path.join(this.lifecycleDir, '07-验收报告.md');
      const content = await fs.readFile(acceptancePath, 'utf-8');

      const completedCount = allResults.filter((r) => r.status === 'completed').length;
      const failedCount = allResults.filter((r) => r.status === 'failed').length;
      const totalDuration = ((endTime - startTime) / 1000).toFixed(2);

      // 更新验收概览
      let updatedContent = content
        .replace(
          /- \*\*项目周期\*\*：.*/,
          `- **项目周期**：${new Date(startTime).toLocaleString('zh-CN')} ~ ${new Date(endTime).toLocaleString('zh-CN')}`
        )
        .replace(
          /- \*\*总体评价\*\*：.*/,
          `- **总体评价**：${failedCount === 0 ? '✅ 全部通过' : `🔄 部分通过（${completedCount}/${allResults.length} 完成）`}`
        );

      // 追加验收详情
      const acceptanceDetails = `

---

## 自动生成验收详情

### 子任务验收统计

- **总子任务数**：${allResults.length}
- **完成数**：${completedCount}
- **失败数**：${failedCount}
- **成功率**：${Math.round((completedCount / allResults.length) * 100)}%
- **总执行时间**：${totalDuration} 秒

### 各子任务验收结果

${allResults
  .map(
    (r, idx) => `
#### 子任务 ${idx + 1} (${r.subTaskId})

- **验收结果**：${r.status === 'completed' ? '✅ 通过' : '❌ 失败'}
- **执行耗时**：${r.duration ? `${(r.duration / 1000).toFixed(2)}秒` : '未知'}
${r.error ? `- **错误信息**：${r.error}` : ''}
${r.result ? `- **执行结果**：${String(r.result).slice(0, 200)}...` : ''}
`
  )
  .join('\n')}

---

**自动生成时间**: ${new Date().toLocaleString('zh-CN')}
`;

      updatedContent += acceptanceDetails;
      await fs.writeFile(acceptancePath, updatedContent, 'utf-8');
      log.info(`[LifecycleMonitor] Generated acceptance report: ${acceptancePath}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to generate acceptance report:`, err);
    }
  }

  /**
   * 生成综合报告
   */
  async generateFinalReport(
    _allResults: SubTaskExecutionResult[],
    stats: {
      startTime: number;
      endTime: number;
      duration: number;
      totalSubTasks: number;
      completedSubTasks: number;
      failedSubTasks: number;
    }
  ): Promise<void> {
    try {
      const reportPath = path.join(this.lifecycleDir, '08-综合报告.md');
      const content = await fs.readFile(reportPath, 'utf-8');

      const summary = `
## 自动生成执行摘要

本次编排任务共分解为 ${stats.totalSubTasks} 个子任务，历时 ${(stats.duration / 1000).toFixed(2)} 秒完成执行。

- **成功完成**：${stats.completedSubTasks} 个子任务
- **执行失败**：${stats.failedSubTasks} 个子任务
- **成功率**：${Math.round((stats.completedSubTasks / stats.totalSubTasks) * 100)}%
- **平均耗时**：${(stats.duration / stats.totalSubTasks / 1000).toFixed(2)} 秒/任务

### 执行时间线

- **开始时间**：${new Date(stats.startTime).toLocaleString('zh-CN')}
- **结束时间**：${new Date(stats.endTime).toLocaleString('zh-CN')}
- **总耗时**：${(stats.duration / 1000).toFixed(2)} 秒

---
`;

      // 在执行摘要章节后插入
      const updatedContent = content.replace(/## 一、执行摘要\n\n\[.*?\]\n\n---/, `## 一、执行摘要\n${summary}\n---`);

      await fs.writeFile(reportPath, updatedContent, 'utf-8');
      log.info(`[LifecycleMonitor] Generated final report: ${reportPath}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to generate final report:`, err);
    }
  }

  /**
   * 检测阶段完成情况
   */
  async detectCompletedStages(): Promise<string[]> {
    const completedStages: string[] = [];
    const stages = [
      { name: 'requirement', file: '01-需求分析.md' },
      { name: 'solution', file: '02-方案设计.md' },
      { name: 'reflection', file: '03-反思优化.md' },
      { name: 'implementation', file: '04-TODO.md' },
      { name: 'acceptance', file: '07-验收报告.md' }
    ];

    for (const stage of stages) {
      const filePath = path.join(this.lifecycleDir, stage.file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (this.isDocumentCompleted(content)) {
          completedStages.push(stage.name);
        }
      } catch {
        // 文件不存在或无法读取
      }
    }

    return completedStages;
  }

  /**
   * 判断文档是否已完成
   */
  private isDocumentCompleted(content: string): boolean {
    const placeholders = [/\[请描述/g, /\[待填写/g, /\[TODO/g, /请在此处/g];

    let placeholderCount = 0;
    for (const regex of placeholders) {
      const matches = content.match(regex);
      if (matches) placeholderCount += matches.length;
    }

    return placeholderCount < 5 && content.length > 100;
  }
}
