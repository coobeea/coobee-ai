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
import type { Task, SubTask, ExecutionPlan, SubTaskStatus, Stage } from './types';

const log = createLogger('orchestration:planner');

// ========== 结构化输出 Schema ==========

/**
 * 宏观阶段输出 Schema
 */
const MacroStageSchema = z.object({
  id: z.string().describe('阶段唯一标识，如 "stage-1"'),
  name: z.string().describe('阶段名称'),
  objective: z.string().describe('阶段目标'),
  description: z.string().optional().describe('阶段详细描述')
});

const MacroPlanOutputSchema = z.object({
  stages: z.array(MacroStageSchema).describe('执行阶段列表')
});

type MacroPlanOutput = z.infer<typeof MacroPlanOutputSchema>;

/**
 * 微观任务输出 Schema
 */
const MicroTaskSchema = z.object({
  id: z.string().describe('子任务唯一标识，如 "subtask-1.1"'),
  objective: z.string().describe('子任务目标'),
  description: z.string().optional().describe('子任务详细描述（包含验收标准）'),
  dependencies: z.array(z.string()).default([]).describe('依赖的子任务 ID 列表（仅限同阶段内）'),
  assignedWorker: z.string().default('general').describe('分配的 Worker 类型或 Agent ID')
});

const MicroPlanOutputSchema = z.object({
  subTasks: z.array(MicroTaskSchema).describe('子任务列表'),
  parallelizable: z.boolean().default(false).describe('本阶段内的任务是否可并行执行')
});

type MicroPlanOutput = z.infer<typeof MicroPlanOutputSchema>;

/**
 * 规划者接口
 */
export interface IPlanner {
  /**
   * 宏观规划：将任务拆分为几个大阶段
   */
  planMacroStages(task: Task, requirementAnalysis?: string): Promise<Stage[]>;

  /**
   * 微观规划：为特定阶段拆解具体的子任务
   */
  planMicroTasks(task: Task, stage: Stage, currentContext: string): Promise<{ tasks: SubTask[]; parallel: boolean }>;

  /**
   * 重新规划（当任务失败时）
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
   * 宏观规划：将任务拆分为几个大阶段
   */
  async planMacroStages(task: Task, requirementAnalysis?: string): Promise<Stage[]> {
    const prompt = await this.buildMacroPlanningPrompt(task, requirementAnalysis);
    const output = await this.callPlannerAgent(prompt, MACRO_PLANNER_INSTRUCTIONS);

    if (!output) {
      log.warn('[Planner] Macro planning failed, using default stage');
      return this.getDefaultStages(task.id);
    }

    const parsed = this.parseMacroOutput(output);
    if (!parsed || parsed.stages.length === 0) {
      return this.getDefaultStages(task.id);
    }

    return parsed.stages.map((s, index) => ({
      id: s.id,
      name: s.name,
      tasks: [], // 此时还没有子任务
      order: index,
      parallel: false // 阶段之间默认串行
    }));
  }

  /**
   * 微观规划：为特定阶段拆解具体的子任务
   */
  async planMicroTasks(
    task: Task,
    stage: Stage,
    currentContext: string
  ): Promise<{ tasks: SubTask[]; parallel: boolean }> {
    const prompt = this.buildMicroPlanningPrompt(task, stage, currentContext);
    const output = await this.callPlannerAgent(prompt, MICRO_PLANNER_INSTRUCTIONS);

    if (!output) {
      log.warn(`[Planner] Micro planning failed for stage ${stage.id}, using default subtask`);
      return { tasks: [this.getDefaultSubTask(task.id, stage.id)], parallel: false };
    }

    const parsed = this.parseMicroOutput(output);
    if (!parsed || parsed.subTasks.length === 0) {
      return { tasks: [this.getDefaultSubTask(task.id, stage.id)], parallel: false };
    }

    const tasks = parsed.subTasks.map((st) => ({
      id: st.id,
      taskId: task.id,
      name: st.objective,
      description: st.description || st.objective,
      dependencies: st.dependencies || [],
      assignedWorker: st.assignedWorker || 'general',
      status: 'pending' as SubTaskStatus
    }));

    return { tasks, parallel: parsed.parallelizable };
  }

  /**
   * 重新规划
   */
  async replan(task: Task, _failureInfo: { failedSubTaskId: string; reason: string }): Promise<ExecutionPlan> {
    // 暂时保留，后续可以根据动态规划重构
    return {
      taskId: task.id,
      subTasks: [],
      stages: [],
      createdAt: Date.now()
    };
  }

  // ========== 内部方法 ==========

  /**
   * 调用 Planner Agent
   */
  private async callPlannerAgent(prompt: string, instructions: string): Promise<string | null> {
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
      .instructions(instructions)
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

      return result.output;
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
   * 解析宏观规划输出
   */
  private parseMacroOutput(rawOutput: string): MacroPlanOutput | null {
    if (!rawOutput) return null;

    try {
      const jsonMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawOutput;

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const cleanJson = jsonStr.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(cleanJson);
        const validated = MacroPlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      }
    } catch {
      // 解析失败
    }

    log.warn('[Planner] Failed to parse macro structured output');
    return null;
  }

  /**
   * 解析微观规划输出
   */
  private parseMicroOutput(rawOutput: string): MicroPlanOutput | null {
    if (!rawOutput) return null;

    try {
      const jsonMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawOutput;

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const cleanJson = jsonStr.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(cleanJson);
        const validated = MicroPlanOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      }
    } catch {
      // 解析失败
    }

    log.warn('[Planner] Failed to parse micro structured output');
    return null;
  }

  /**
   * 构建宏观规划提示词
   */
  private async buildMacroPlanningPrompt(task: Task, requirementAnalysis?: string): Promise<string> {
    let prompt = `请为以下任务制定高层级的阶段执行计划（Macro Plan）：\n\n`;
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

    if (requirementAnalysis) {
      prompt += `\n---\n\n## 需求分析文档\n\n`;
      prompt += `以下是已完成的需求分析文档，请仔细阅读并基于此划分执行阶段：\n\n`;
      const maxLength = 10000;
      if (requirementAnalysis.length > maxLength) {
        prompt += requirementAnalysis.slice(0, maxLength) + '\n\n[文档过长，已截断...]\n\n';
      } else {
        prompt += requirementAnalysis + '\n\n';
      }
      prompt += `---\n\n`;
    }

    prompt += `\n## 规划要求\n\n`;
    prompt += `请基于上述信息，将整个任务划分为 3-5 个高层级的执行阶段（Stages/Epics）。\n`;
    prompt += `每个阶段应该是一个相对独立的里程碑，例如：数据库设计、核心API开发、前端UI搭建、集成测试等。\n\n`;
    prompt += `## 输出格式\n\n`;
    prompt += `请严格按照以下 JSON 格式输出（不要用 markdown 代码块包裹）：\n\n`;
    prompt += `{\n`;
    prompt += `  "stages": [\n`;
    prompt += `    {\n`;
    prompt += `      "id": "stage-1",\n`;
    prompt += `      "name": "数据库与数据模型设计",\n`;
    prompt += `      "objective": "完成所有核心数据表的设计与迁移脚本编写",\n`;
    prompt += `      "description": "详细描述该阶段需要完成的里程碑内容..."\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n\n`;
    prompt += `**重要提示**：直接输出 JSON，不要包含任何额外说明或代码块标记。\n`;

    return prompt;
  }

  /**
   * 构建微观规划提示词
   */
  private buildMicroPlanningPrompt(task: Task, stage: Stage, currentContext: string): string {
    let prompt = `请为当前执行阶段制定详细的底层子任务计划（Micro Plan）：\n\n`;
    prompt += `## 整体任务目标\n${task.objective}\n\n`;
    prompt += `## 当前阶段：${stage.name}\n`;
    prompt += `**阶段目标**：${stage.objective || '无'}\n`;
    if (stage.description) {
      prompt += `**阶段描述**：${stage.description}\n`;
    }
    prompt += `\n---\n\n`;

    prompt += `## 当前代码库状态与上下文\n`;
    prompt += `在执行此阶段之前，代码库的当前状态如下（供你参考，以避免闭门造车）：\n\n`;
    prompt += `${currentContext || '（暂无前置上下文）'}\n\n`;
    prompt += `---\n\n`;

    prompt += `## 规划要求\n\n`;
    prompt += `请结合当前代码库状态，将【${stage.name}】阶段拆解为 3-8 个具体的底层子任务（Tasks）。\n`;
    prompt += `1. **每个子任务必须包含**：\n`;
    prompt += `   - id：唯一标识（如 "${stage.id}-task-1"）\n`;
    prompt += `   - objective：子任务目标（简洁明确，一句话）\n`;
    prompt += `   - description：详细描述（至少2-3句话，说明：修改哪些具体文件？涉及哪些函数/组件？如何验证？）\n`;
    prompt += `   - dependencies：依赖的子任务 ID 列表（仅限本阶段内的依赖）\n`;
    prompt += `   - assignedWorker："general"（通用 Worker）\n\n`;
    prompt += `2. **验收标准**：description 中必须体现验收标准（如何验证完成？测试文件路径？）\n\n`;
    prompt += `## 输出格式\n\n`;
    prompt += `请严格按照以下 JSON 格式输出（不要用 markdown 代码块包裹）：\n\n`;
    prompt += `{\n`;
    prompt += `  "subTasks": [\n`;
    prompt += `    {\n`;
    prompt += `      "id": "${stage.id}-task-1",\n`;
    prompt += `      "objective": "实现XX具体接口",\n`;
    prompt += `      "description": "在 src/api/xxx.ts 中新增 yyy 方法，并编写对应的单元测试。验收标准：...",\n`;
    prompt += `      "dependencies": [],\n`;
    prompt += `      "assignedWorker": "general"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "parallelizable": false\n`;
    prompt += `}\n\n`;
    prompt += `**重要提示**：\n`;
    prompt += `- 直接输出 JSON，不要包含任何额外说明或代码块标记\n`;
    prompt += `- description 必须详细（至少2-3句话），必须包含具体的文件路径或模块名\n`;

    return prompt;
  }

  /**
   * 默认宏观阶段（降级方案）
   */
  private getDefaultStages(_taskId: string): Stage[] {
    return [
      {
        id: 'stage-1',
        name: 'Main Stage',
        objective: 'Complete the task',
        tasks: [],
        order: 0,
        parallel: false
      }
    ];
  }

  /**
   * 默认微观子任务（降级方案）
   */
  private getDefaultSubTask(taskId: string, stageId: string): SubTask {
    return {
      id: `${stageId}-subtask-1`,
      taskId,
      name: 'Complete the task',
      description: 'Execute the task as a single unit',
      dependencies: [],
      assignedWorker: 'general',
      status: 'pending' as SubTaskStatus
    };
  }
}

// ========== Planner Agent 指令 ==========

const MACRO_PLANNER_INSTRUCTIONS = `你是一个高级架构师和任务规划专家。你的职责是将高层级的复杂任务分解为几个大阶段（Stages/Epics）。

**核心原则**：
1. **高层级划分**：不要陷入底层代码细节，关注系统架构和业务模块的划分。
2. **逻辑顺序**：阶段之间应该有明确的先后顺序（例如：先设计数据库，再写API，最后写前端）。
3. **里程碑意义**：每个阶段都应该是一个有意义的里程碑。

**输出格式**：
严格输出 JSON 格式（无 markdown 代码块）：
{
  "stages": [
    {
      "id": "stage-1",
      "name": "数据库与数据模型设计",
      "objective": "完成所有核心数据表的设计与迁移脚本编写",
      "description": "详细描述该阶段需要完成的里程碑内容..."
    }
  ]
}

**重要提示**：直接输出 JSON，不要包含任何额外说明。`;

const MICRO_PLANNER_INSTRUCTIONS = `你是一个高级研发工程师和任务规划专家。你的职责是将一个大阶段（Stage）拆解为具体的底层子任务（Tasks）。

**核心原则**：
1. **细致拆解**：将阶段拆分为具体、可执行的代码级步骤。
2. **结合现状**：必须参考当前代码库的状态，不要闭门造车。如果数据库已经建好，就直接基于现有的表写 API 任务。
3. **验收标准**：每个子任务必须在 description 中包含可量化的验收标准和测试方法。
4. **依赖关系**：明确本阶段内子任务之间的依赖关系。

**输出格式**：
严格输出 JSON 格式（无 markdown 代码块）：
{
  "subTasks": [
    {
      "id": "stage-1-task-1",
      "objective": "实现XX具体接口",
      "description": "在 src/api/xxx.ts 中新增 yyy 方法，并编写对应的单元测试。验收标准：...",
      "dependencies": [],
      "assignedWorker": "general"
    }
  ],
  "parallelizable": false
}

**重要提示**：直接输出 JSON，不要包含任何额外说明。`;

// 导出 Schema 供外部使用（如测试）
export { MacroPlanOutputSchema, MicroPlanOutputSchema, type MacroPlanOutput, type MicroPlanOutput };
