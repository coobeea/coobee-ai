/**
 * 知识归档定时任务
 *
 * 每天凌晨扫描昨天的 Agent 工作记录，
 * 提取问题和经验，归档到共享网盘和智库。
 */

import { BaseCronJob, type CronJobContext } from '@main/ai/cron/types';

export default class KnowledgeArchiveJob extends BaseCronJob {
  readonly name = 'knowledge-archive';
  readonly description = '扫描并归档 Agent 执行记录到经验库';
  readonly cronExpression = '0 2 * * *'; // 每天凌晨 2 点
  readonly agentId = 'knowledge-keeper'; // 委托给知识管理员 Agent

  /**
   * 为 Agent 构造详细的任务描述
   */
  get taskForAgent(): string {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split('T')[0];

    return `
扫描并归档昨天（${dateStr}）的 Agent 工作记录。

**扫描范围**：
- 目录：workspaces/ 下所有包含 ${dateStr} 的工作空间
- 重点：.runtime/sessions/ 目录中的对话记录

**提取维度**：
1. 遇到的问题（错误、异常、用户纠正）
2. 解决方案（成功的工具序列、有效策略）
3. 用户反馈（追问、满意度、改进建议）
4. 工具使用（常用工具、有效组合）
5. 技能应用（触发的 Skills、效果评价）

**归档要求**：
1. **共享网盘**（shared-drive）：
   - 路径：知识库/{类别}/{日期}_标题.md
   - 类别：常见问题、解决方案、工具使用经验
   - 格式：Markdown，包含问题描述、解决方案、关键洞察

2. **智库**（brain/tavern）：
   - 使用 tavern_record 工具
   - 结构化记录：question, context, solution, reasoning, tags

**输出报告**：
- 扫描的工作空间数量
- 提取的问题/方案/经验数量
- 归档的文件/记录数量
- 典型问题列表（Top 3-5）
`.trim();
  }

  /**
   * 执行逻辑：不需要实现，因为指定了 agentId，
   * CronJobExecutor 会自动通过 Agent 执行
   */
  async execute(_ctx: CronJobContext): Promise<string> {
    // 当 agentId 存在时，这个方法不会被调用
    // CronJobExecutor 会通过 executeDynamic 调用 Agent
    throw new Error('此方法不应被调用，应该通过 Agent 执行');
  }
}
