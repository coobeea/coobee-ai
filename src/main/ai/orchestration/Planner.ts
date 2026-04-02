/**
 * 规划者（Planner）
 * 负责将高层任务分解为可执行的子任务
 *
 * 基于 AgentRuntime 实现 — SDK 无关。
 * 通过 AgentExecutor 的 PiMonoBuilder 创建内部 Planner Agent，
 * 由 LLM 完成任务分解，输出结构化的 ExecutionPlan。
 */

import { z } from 'zod';
import { createLogger } from '@main/common/logger';
import type { Task, SubTask, ExecutionPlan, ExecutionStage, SubTaskStatus } from './types';

const log = createLogger('orchestration:planner');

// ========== 结构化输出 Schema ==========

/**
 * 子任务输出 Schema
 */
const SubTaskSchema = z.object({
  id: z.string().describe('子任务唯一标识，如 "subtask-1"'),
  objective: z.string().describe('子任务目标'),
  description: z.string().optional().describe('子任务详细描述'),
  dependencies: z.array(z.string()).default([]).describe('依赖的子任务 ID 列表'),
  assignedWorker: z.string().default('general').describe('分配的 Worker 类型或 Agent ID')
});

const StageSchema = z.object({
  stageId: z.string().describe('阶段唯一标识'),
  name: z.string().describe('阶段名称'),
  subTaskIds: z.array(z.string()).default([]).describe('包含的子任务 ID 列表'),
  parallelizable: z.boolean().default(false).describe('是否可并行执行')
});

/**
 * 规划输出 Schema
 */
const PlanOutputSchema = z.object({
  subTasks: z.array(SubTaskSchema).describe('子任务列表'),
  stages: z.array(StageSchema).describe('执行阶段列表')
});

/** 规划输出类型 */
type PlanOutput = z.infer<typeof PlanOutputSchema>;

/**
 * 规划者接口
 */
export interface IPlanner {
  /**
   * 规划任务
   * @param task 任务定义
   * @param lifecycleDir 生命周期文档目录（可选）
   */
  plan(task: Task, lifecycleDir?: string): Promise<ExecutionPlan>;

  /**
   * 重新规划（当任务失败时）
   * @param task 原始任务
   * @param failureInfo 失败信息
   */
  replan(task: Task, failureInfo: { failedSubTaskId: string; reason: string }): Promise<ExecutionPlan>;
}

/**
 * 规划者实现
 *
 * 通过 AgentRuntime (PiMonoBuilder) 创建一个临时的 Planner Agent，
 * 让 LLM 分析任务并输出结构化的执行计划。
 *
 * 与旧实现的区别：
 *   - 不依赖 @openai/agents SDK
 *   - 使用项目统一的 AgentExecutor + PiMonoBuilder
 *   - 使用配置的模型（而非硬编码 gpt-4o）
 *   - 支持 AbortSignal
 */
export class Planner implements IPlanner {
  constructor(
    private readonly options?: {
      /** 父 sessionId（= threadId），用于子 sessionId 命名 */
      parentSessionId?: string;
      /** 自定义模型（不传则使用配置默认值） */
      model?: string;
      /** 中止信号 */
      signal?: AbortSignal;
    }
  ) {}

  /**
   * 规划任务
   *
   * 构建规划提示词 → 调用 LLM → 解析结构化输出 → 返回 ExecutionPlan
   */
  async plan(task: Task, lifecycleDir?: string): Promise<ExecutionPlan> {
    const prompt = await this.buildPlanningPrompt(task, lifecycleDir);
    const output = await this.callPlannerAgent(prompt);
    const planData = this.convertPlanOutput(output, task.id);

    log.info(`[Planner] Plan created: ${planData.subTasks.length} subtasks, ${planData.stages.length} stages`);

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    };
  }

  /**
   * 重新规划
   */
  async replan(task: Task, failureInfo: { failedSubTaskId: string; reason: string }): Promise<ExecutionPlan> {
    const replanPrompt = `
Original Task: ${task.objective}

Failed Subtask: ${failureInfo.failedSubTaskId}
Failure Reason: ${failureInfo.reason}

Please create a new execution plan that addresses this failure.
Consider:
- Why did this subtask fail?
- What alternative approach can we use?
- Should we split this subtask further?
- Are there missing prerequisites?
`;

    const output = await this.callPlannerAgent(replanPrompt);
    const planData = this.convertPlanOutput(output, task.id);

    log.info(`[Planner] Replan created: ${planData.subTasks.length} subtasks, ${planData.stages.length} stages`);

    return {
      taskId: task.id,
      subTasks: planData.subTasks,
      stages: planData.stages,
      createdAt: Date.now()
    };
  }

  // ========== 内部方法 ==========

  /**
   * 调用 Planner Agent
   *
   * 通过 AgentExecutor 创建临时的 PiMono Runtime 执行规划请求。
   * Runtime 用完即销毁（无状态）。
   */
  private async callPlannerAgent(prompt: string): Promise<PlanOutput | null> {
    const { agentExecutor } = await import('../AgentExecutor');
    const { WorkspaceManager } = await import('../storage/WorkspaceManager');
    const path = await import('node:path');

    const prefix = this.options?.parentSessionId || `planner-${Date.now()}`;
    const sessionId = this.options?.parentSessionId ? `${prefix}:planner` : prefix;

    // 🆕 创建嵌套 workspace
    let subAgentWorkspace: string | undefined;
    if (this.options?.parentSessionId) {
      const { Env } = await import('@main/common/env');
      const mainWorkspace = await Env.getAgentWorkspaceDir(this.options.parentSessionId);
      subAgentWorkspace = WorkspaceManager.getOrCreateSubAgentWorkspace({
        agentName: 'planner',
        sessionId,
        type: 'planner',
        threadWorkspace: mainWorkspace,
        enableSkills: true,
        enableExtensions: true
      });
    }

    const builder = agentExecutor
      .piMono()
      .name('Orchestration Planner')
      .mode('chat')
      .sessionMode('file')
      .instructions(PLANNER_INSTRUCTIONS)
      .sessionId(sessionId);

    if (this.options?.model) {
      builder.model(this.options.model);
    }

    // 🆕 如果有嵌套 workspace，手动设置
    if (subAgentWorkspace) {
      builder
        .sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions'))
        .workspaceRoot(subAgentWorkspace)
        .contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
    }

    let runtime: import('../runtime/AgentRuntime').AgentRuntime | null = null;

    try {
      runtime = await builder.build();

      // 同步执行（Planner 不需要流式）
      const result = await runtime.run(prompt);

      // 尝试从 LLM 输出中提取结构化计划
      return this.parseOutput(result.output);
    } catch (error) {
      log.error('[Planner] Agent execution failed:', error);
      return null;
    } finally {
      if (runtime) {
        try {
          await runtime.destroy();
        } catch {
          // 静默
        }
      }
    }
  }

  /**
   * 解析 LLM 输出为结构化 PlanOutput
   *
   * 尝试多种解析策略：
   * 1. 直接 JSON 解析
   * 2. 从 markdown 代码块中提取 JSON
   * 3. 使用 Zod schema 验证
   */
  private parseOutput(rawOutput: string): PlanOutput | null {
    if (!rawOutput) return null;

    // 策略 1：直接 JSON 解析
    try {
      const parsed = JSON.parse(rawOutput);
      const validated = PlanOutputSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // 不是纯 JSON，继续尝试
    }

    // 策略 2：从 markdown 代码块提取
    const jsonMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const validated = PlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // 解析失败，继续
      }
    }

    // 策略 3：尝试查找 JSON 对象（从第一个 { 到最后一个 }）
    const firstBrace = rawOutput.indexOf('{');
    const lastBrace = rawOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const jsonStr = rawOutput.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        const validated = PlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // 解析失败
      }
    }

    log.warn('[Planner] Failed to parse structured output, using default plan');
    return null;
  }

  /**
   * 构建规划提示词
   */
  private async buildPlanningPrompt(task: Task, lifecycleDir?: string): Promise<string> {
    let prompt = `请为以下任务制定详细的执行计划：\n\n`;
    prompt += `## 任务信息\n\n`;
    prompt += `**任务目标**：${task.objective}\n\n`;

    if (task.description) {
      prompt += `**任务描述**：${task.description}\n\n`;
    }

    if (task.requirements?.length) {
      prompt += `**具体要求**：\n${task.requirements.map((r) => `- ${r}`).join('\n')}\n\n`;
    }

    if (task.constraints?.length) {
      prompt += `**约束条件**：\n${task.constraints.map((c) => `- ${c}`).join('\n')}\n\n`;
    }

    // 🆕 如果启用了生命周期，读取需求分析文档
    if (lifecycleDir) {
      prompt += await this.injectLifecycleContext(lifecycleDir);
    }

    prompt += `\n## 规划要求\n\n`;
    prompt += `请基于上述信息，制定详细的执行计划：\n\n`;
    prompt += `1. **拆解子任务**：将任务拆分为 5-15 个具体的子任务\n`;
    prompt += `2. **每个子任务必须包含**：\n`;
    prompt += `   - id：唯一标识（subtask-1, subtask-2, ...）\n`;
    prompt += `   - objective：子任务目标（简洁明确，一句话）\n`;
    prompt += `   - description：详细描述（至少2-3句话，说明：做什么？修改哪些文件？涉及哪些模块？如何验证？）\n`;
    prompt += `   - dependencies：依赖的子任务 ID 列表（如 ["subtask-1"]）\n`;
    prompt += `   - assignedWorker："general"（通用 Worker）\n\n`;
    prompt += `3. **阶段划分**：将子任务分组为 3-5 个执行阶段\n`;
    prompt += `   - 每个阶段包含：stageId、name、subTaskIds、parallelizable\n`;
    prompt += `   - 同阶段内的任务如果无依赖关系，可设置 parallelizable=true\n\n`;
    prompt += `## 输出格式\n\n`;
    prompt += `请严格按照以下 JSON 格式输出（不要用 markdown 代码块包裹）：\n\n`;
    prompt += `{\n`;
    prompt += `  "subTasks": [\n`;
    prompt += `    {\n`;
    prompt += `      "id": "subtask-1",\n`;
    prompt += `      "objective": "实现XX功能",\n`;
    prompt += `      "description": "详细描述：做什么？修改哪些文件？如何验证？（至少2-3句话）",\n`;
    prompt += `      "dependencies": [],\n`;
    prompt += `      "assignedWorker": "general"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "stages": [\n`;
    prompt += `    {\n`;
    prompt += `      "stageId": "stage-1",\n`;
    prompt += `      "name": "核心功能开发",\n`;
    prompt += `      "subTaskIds": ["subtask-1"],\n`;
    prompt += `      "parallelizable": false\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n\n`;
    prompt += `**重要提示**：\n`;
    prompt += `- 直接输出 JSON，不要包含任何额外说明或代码块标记\n`;
    prompt += `- description 必须详细（至少2-3句话）\n`;
    prompt += `- 子任务数量建议在 5-15 个之间\n`;
    prompt += `- dependencies 必须准确（引用已定义的子任务 ID）\n`;

    return prompt;
  }

  /**
   * 🆕 注入生命周期文档上下文（重点读取需求分析文档）
   */
  private async injectLifecycleContext(lifecycleDir: string): Promise<string> {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      let context = `\n\n---\n\n## 需求分析文档\n\n`;
      context += `以下是已完成的需求分析文档，请仔细阅读并基于此制定详细计划：\n\n`;

      // 🆕 优先读取需求分析文档（完整内容）
      try {
        const analysisPath = path.join(lifecycleDir, '01-需求分析.md');
        const analysisContent = await fs.readFile(analysisPath, 'utf-8');

        // 限制长度，避免超过 context 限制
        const maxLength = 10000; // 10K 字符
        if (analysisContent.length > maxLength) {
          log.warn(
            `[Planner] Requirement analysis too long (${analysisContent.length} chars), truncating to ${maxLength}`
          );
          context += analysisContent.slice(0, maxLength) + '\n\n[文档过长，已截断...]\n\n';
        } else {
          context += analysisContent + '\n\n';
        }

        context += `---\n\n`;
        context += `**规划要求**：\n`;
        context += `- 基于上述需求分析，拆解为 5-15 个具体的子任务\n`;
        context += `- 每个子任务包含详细描述（至少2-3句话）\n`;
        context += `- 明确依赖关系和执行顺序\n`;
        context += `- 按阶段分组（通常3-5个阶段）\n\n`;
      } catch (_err) {
        log.warn('[Planner] 01-需求分析.md not found, using basic context');
        context += `[需求分析文档尚未完成]\n\n`;
      }

      // 可选：读取方案设计（如果存在）
      try {
        const solutionPath = path.join(lifecycleDir, '02-方案设计.md');
        const solutionContent = await fs.readFile(solutionPath, 'utf-8');
        context += `\n## 方案设计（供参考）\n\n`;
        // 只提取前 2000 字符
        const excerpt = solutionContent.length > 2000 ? solutionContent.slice(0, 2000) + '...\n' : solutionContent;
        context += excerpt + '\n\n';
      } catch {
        // 方案设计不存在也无妨
      }

      return context;
    } catch (_err) {
      log.warn('[Planner] Failed to inject lifecycle context:', _err);
      return '';
    }
  }

  /**
   * 将 PlanOutput 转换为内部类型
   */
  private convertPlanOutput(
    output: PlanOutput | null,
    taskId: string
  ): {
    subTasks: SubTask[];
    stages: ExecutionStage[];
  } {
    if (!output) {
      log.warn('[Planner] No structured output, using default plan');
      return this.getDefaultPlan(taskId);
    }

    const subTasks: SubTask[] = output.subTasks.map(
      (st): SubTask => ({
        id: st.id,
        taskId,
        name: st.objective,
        description: st.description || st.objective,
        dependencies: st.dependencies,
        assignedWorker: st.assignedWorker,
        status: 'pending' as SubTaskStatus
      })
    );

    const stages: ExecutionStage[] = output.stages.map((stage, index) => {
      const stageTasks = subTasks.filter((st) => stage.subTaskIds.includes(st.id));
      return {
        id: stage.stageId,
        name: stage.name,
        tasks: stageTasks,
        order: index,
        parallel: stage.parallelizable
      };
    });

    return { subTasks, stages };
  }

  /**
   * 默认计划（降级方案）
   */
  private getDefaultPlan(taskId: string): { subTasks: SubTask[]; stages: ExecutionStage[] } {
    const defaultSubTask: SubTask = {
      id: 'subtask-1',
      taskId,
      name: 'Complete the task',
      description: 'Execute the task as a single unit',
      dependencies: [],
      assignedWorker: 'general',
      status: 'pending' as SubTaskStatus
    };

    return {
      subTasks: [defaultSubTask],
      stages: [
        {
          id: 'stage-1',
          name: 'Main Stage',
          tasks: [defaultSubTask],
          order: 0,
          parallel: false
        }
      ]
    };
  }
}

// ========== Planner Agent 指令 ==========

const PLANNER_INSTRUCTIONS = `你是一个专业的任务规划专家。你的职责是将高层级的复杂任务分解为可执行的子任务列表（TODO）。

**核心原则**：
1. **细致拆解**：将任务拆分为具体、可执行的步骤，每个子任务应该是独立、明确的
2. **验收标准**：每个子任务必须包含可量化的验收标准（至少3个）
3. **依赖关系**：明确子任务之间的依赖关系，合理安排执行顺序
4. **合理分组**：将子任务按阶段分组，同阶段内可并行的任务标记为 parallelizable=true
5. **工作量估算**：为每个子任务估算预计代码量或工作时间

**规划流程**：
1. 仔细阅读需求分析文档（如果有）
2. 提取核心功能点和非功能需求
3. 将每个功能点拆解为具体的实施任务
4. 为每个任务设计验收标准
5. 规划实施顺序和依赖关系

**子任务拆分原则**：
- ✅ **好的子任务**：具体、可验证、有明确产出
  - 示例："实现 LifecycleOrchestrator 类（src/main/ai/tavern/lifecycle/LifecycleOrchestrator.ts）"
  - 验收标准："execute() 方法能创建 lifecycle 目录"、"单元测试覆盖率 > 85%"
- ❌ **不好的子任务**：模糊、无法验证、范围不清
  - 示例："完成后端开发"、"优化性能"、"修复 Bug"

**验收标准要求**：
每个子任务至少包含3个可量化的验收标准：
- 功能验收：功能是否正确实现（如"能创建目录"、"能解析JSON"）
- 测试验收：是否有测试代码、测试是否通过（如"单元测试通过"、"覆盖率>85%"）
- 质量验收：代码质量、性能指标（如"TypeScript无错误"、"响应时间<100ms"）

**输出格式**：
严格输出 JSON 格式（无 markdown 代码块）：
{
  "subTasks": [
    {
      "id": "subtask-1",
      "objective": "实现XX功能",
      "description": "详细描述：做什么？修改哪些文件？涉及哪些模块？",
      "dependencies": [],
      "assignedWorker": "general"
    }
  ],
  "stages": [
    {
      "stageId": "stage-1",
      "name": "核心功能开发",
      "subTaskIds": ["subtask-1"],
      "parallelizable": false
    }
  ]
}

**重要提示**：
- 子任务数量通常在 5-15 个之间（太少=拆分不够细，太多=过度拆分）
- 每个子任务的 description 必须详细（至少 2-3 句话）
- dependencies 必须准确（错误的依赖关系会导致执行失败）
- 阶段划分要合理（通常 3-5 个阶段）
- 直接输出 JSON，不要用代码块包裹`;

// 导出 Schema 供外部使用（如测试）
export { PlanOutputSchema, type PlanOutput };
