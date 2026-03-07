/**
 * 汇总者（Aggregator Agent）
 * 负责汇总多个子任务的执行结果，生成简洁的总结
 *
 * 设计原则：
 * - 委托给子智能体，而非直接调用 LLM
 * - 使用工具读取任务文件（plan.md, results/*.md）
 * - 生成简洁的汇总（1000-2000 字符）
 * - 输出保存到 tasks/{taskId}/aggregation.md
 */

import { createLogger } from '@main/common/logger';
import type { Task, ExecutionPlan, SubTaskExecutionResult } from './types';
import { WorkspaceManager } from '../storage/WorkspaceManager';

const log = createLogger('orchestration:aggregator');

/**
 * 汇总结果
 */
export interface AggregationResult {
  /** 简洁的汇总输出（1000-2000 字符） */
  summary: string;

  /** 汇总耗时（ms） */
  duration: number;
}

/**
 * 汇总者配置
 */
export interface AggregatorConfig {
  /** 父 sessionId（= threadId），用于子 sessionId 命名 */
  parentSessionId?: string;

  /** 自定义模型 */
  model?: string;

  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 汇总者接口
 */
export interface IAggregator {
  /**
   * 汇总任务结果
   * @param task 原始任务
   * @param plan 执行计划
   * @param subTaskResults 子任务执行结果
   * @param taskDirPath 任务目录路径（如 workspaces/xxx/tasks/task-123/）
   */
  aggregate(
    task: Task,
    plan: ExecutionPlan,
    subTaskResults: SubTaskExecutionResult[],
    taskDirPath: string
  ): Promise<AggregationResult>;
}

/**
 * 汇总者实现
 *
 * 通过 AgentRuntime (PiMonoBuilder) 创建一个临时的 Aggregator Agent，
 * 让 Agent 使用工具读取文件，分析子任务输出，生成简洁的汇总。
 */
export class AggregatorAgent implements IAggregator {
  constructor(private readonly config?: AggregatorConfig) {}

  /**
   * 汇总任务结果
   */
  async aggregate(
    task: Task,
    plan: ExecutionPlan,
    subTaskResults: SubTaskExecutionResult[],
    taskDirPath: string
  ): Promise<AggregationResult> {
    const startTime = Date.now();

    try {
      log.info(`[AggregatorAgent] 开始汇总 ${subTaskResults.length} 个子任务结果`);

      const prompt = this.buildAggregationPrompt(task, plan, subTaskResults, taskDirPath);
      const output = await this.callAggregatorAgent(prompt);

      const duration = Date.now() - startTime;

      log.info(`[AggregatorAgent] 汇总完成，耗时 ${duration}ms`);

      return {
        summary: output.trim(),
        duration
      };
    } catch (error) {
      log.error('[AggregatorAgent] 汇总失败:', error);

      // Fallback：简单拼接子任务摘要
      const fallbackSummary = this.buildFallbackSummary(plan, subTaskResults);

      return {
        summary: fallbackSummary,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 构建汇总提示词
   */
  private buildAggregationPrompt(
    task: Task,
    plan: ExecutionPlan,
    subTaskResults: SubTaskExecutionResult[],
    taskDirPath: string
  ): string {
    const completed = subTaskResults.filter((r) => r.status === 'completed');

    return `你是一个任务汇总专家。你的职责是分析多个子任务的执行结果，生成简洁的总结。

## 背景信息

**用户原始请求**: ${task.objective}

**执行计划**: ${plan.subTasks.length} 个子任务，分 ${plan.stages.length} 个阶段执行

**执行结果**: ${completed.length}/${subTaskResults.length} 个子任务成功完成

## 任务输出文件

所有子任务的详细输出已保存在以下目录：
\`\`\`
${taskDirPath}
├── definition.md       # 任务定义
├── plan.md             # 执行计划
└── results/            # 子任务输出
    ├── subtask-1.md
    ├── subtask-2.md
    └── ...
\`\`\`

## 你的任务

**使用 \`fs_read_file\` 工具** 读取以下文件来完成汇总：

1. 读取 \`${taskDirPath}/plan.md\` - 了解原始计划
2. 读取 \`${taskDirPath}/results/\` 目录下的所有 \`.md\` 文件 - 获取子任务输出
3. 分析各子任务的核心成果和关键发现
4. 生成一个 **简洁的总结**（控制在 1000-2000 字符）

## 输出要求

输出格式：简洁的 Markdown，包含以下部分：

\`\`\`markdown
# 任务执行总结

## 执行概况
- 任务：[一句话概括任务目标]
- 结果：[X/Y 个子任务完成]
- 关键成果：[2-3 个核心成果]

## 主要发现

[3-5 个关键发现点，每个 1-2 句话]

## 建议后续行动

[如果适用，提供 2-3 个具体的后续行动建议]
\`\`\`

**重要约束**：
- ✅ 必须使用工具读取文件，不要基于假设生成内容
- ✅ 输出控制在 **1000-2000 字符**，不要超长
- ✅ 聚焦核心成果和关键发现，不要重复子任务的详细内容
- ✅ 使用清晰的结构和简洁的语言

现在开始执行汇总任务。
`;
  }

  /**
   * 调用 Aggregator Agent 执行汇总
   */
  private async callAggregatorAgent(prompt: string): Promise<string> {
    const { agentExecutor } = await import('../AgentExecutor');

    const sessionId = this.config?.parentSessionId
      ? `${this.config.parentSessionId}:aggregator`
      : `aggregator-${Date.now()}`;

    const builder = agentExecutor
      .piMono()
      .name('Task Aggregator')
      .mode('agent')
      .sessionMode('file')
      .instructions(AGGREGATOR_INSTRUCTIONS)
      .sessionId(sessionId);

    if (this.config?.model) {
      builder.model(this.config.model);
    }

    // 🆕 如果有嵌套 workspace，手动设置
    if (this.config?.parentSessionId) {
      const { Env } = await import('@main/common/env');
      const path = await import('node:path');
      const mainWorkspace = await Env.getAgentWorkspaceDir(this.config.parentSessionId);

      const subAgentWorkspace = WorkspaceManager.getOrCreateSubAgentWorkspace({
        agentName: 'aggregator',
        sessionId,
        type: 'planner', // 类似 Planner，使用相同类型
        threadWorkspace: mainWorkspace,
        enableSkills: true,
        enableExtensions: true
      });

      builder.sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions', sessionId));
      builder.workspaceRoot(subAgentWorkspace);
      builder.contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
    }

    try {
      const agent = await builder.build();

      if (this.config?.signal) {
        this.config.signal.addEventListener('abort', () => {
          agent.destroy?.();
        });
      }

      const result = await agent.run(prompt);
      await agent.destroy?.();

      return result.output || '';
    } catch (error) {
      log.error('[AggregatorAgent] callAggregatorAgent failed:', error);
      throw error;
    }
  }

  /**
   * Fallback 汇总（简单拼接）
   */
  private buildFallbackSummary(plan: ExecutionPlan, subTaskResults: SubTaskExecutionResult[]): string {
    const completed = subTaskResults.filter((r) => r.status === 'completed');
    const failed = subTaskResults.filter((r) => r.status === 'failed');

    const lines: string[] = [];
    lines.push('# 任务执行总结\n');
    lines.push('## 执行概况\n');
    lines.push(`- 任务：${plan.subTasks.length} 个子任务`);
    lines.push(`- 结果：${completed.length}/${subTaskResults.length} 个子任务完成\n`);

    if (failed.length > 0) {
      lines.push('## 失败的子任务\n');
      failed.forEach((f) => {
        const subTask = plan.subTasks.find((st) => st.id === f.subTaskId);
        lines.push(`- ${subTask?.name || f.subTaskId}: ${f.error || '执行失败'}`);
      });
      lines.push('');
    }

    lines.push('## 子任务摘要\n');
    completed.forEach((r) => {
      const subTask = plan.subTasks.find((st) => st.id === r.subTaskId);
      lines.push(`- **${subTask?.name || r.subTaskId}**: 完成 (${r.duration || 0}ms)`);
    });

    return lines.join('\n');
  }
}

/**
 * Aggregator Agent 指令
 */
const AGGREGATOR_INSTRUCTIONS = `你是一个任务汇总专家（Task Aggregator）。

你的职责是分析多个子任务的执行结果，生成简洁的总结报告。

## 核心原则

1. **使用工具** - 必须使用 \`fs_read_file\` 工具读取任务文件，不要基于假设生成内容
2. **简洁输出** - 输出控制在 1000-2000 字符，聚焦核心成果和关键发现
3. **结构化** - 使用清晰的 Markdown 格式组织内容
4. **去重整合** - 提取共性，去除重复信息

## 工作流程

1. 读取 \`definition.md\` 了解任务目标
2. 读取 \`plan.md\` 了解执行计划
3. 读取 \`results/\` 目录下的所有 \`.md\` 文件获取子任务输出
4. 分析核心成果和关键发现
5. 生成简洁的汇总报告

## 输出格式

\`\`\`markdown
# 任务执行总结

## 执行概况
- 任务：[一句话概括]
- 结果：[X/Y 完成]
- 关键成果：[2-3 个核心成果]

## 主要发现

[3-5 个关键发现点，每个 1-2 句话]

## 建议后续行动

[2-3 个具体的后续行动建议（如果适用）]
\`\`\`

## 注意事项

- ❌ 不要重复子任务的详细内容
- ❌ 不要超过 2000 字符
- ✅ 聚焦用户最关心的结果和价值
- ✅ 使用清晰、专业的语言
`;
