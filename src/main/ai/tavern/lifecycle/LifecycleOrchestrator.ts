/**
 * LifecycleOrchestrator - 五阶段任务执行调度器
 *
 * 核心职责：
 * 1. 准备 lifecycle 目录和模板文件
 * 2. 构造包含五阶段指令的 Agent Prompt
 * 3. 提交给 AgentExecutor 执行
 * 4. 启动 LifecycleMonitor 监控进度
 * 5. 处理任务恢复（崩溃后重启）
 */

import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';
import type { Task } from '../TavernStore';
import { TemplateGenerator } from './TemplateGenerator';
import { LifecycleMonitor } from './LifecycleMonitor';
import type { TaskConfig } from '../types';

const log = createLogger('lifecycle-orchestrator');

export class LifecycleOrchestrator {
  private templateGenerator = new TemplateGenerator();

  /**
   * 执行五阶段生命周期流程
   *
   * @param task - 任务定义
   * @param sessionId - 会话 ID
   */
  async execute(task: Task, sessionId: string): Promise<void> {
    try {
      log.info(`[LifecycleOrchestrator] Executing lifecycle for task ${task.id}`);

      // 1. 创建 lifecycle 目录
      const lifecycleDir = await this.createLifecycleDir(sessionId);

      // 2. 生成模板文件
      await this.templateGenerator.generate(lifecycleDir, task, sessionId);

      // 3. 判断任务复杂度，选择执行模式
      const isComplex = this.isComplexTask(task);
      const mode = isComplex ? 'full' : 'fast';
      log.info(
        `[LifecycleOrchestrator] Task ${task.id} complexity: ${isComplex ? 'complex' : 'simple'}, using ${mode} mode`
      );

      // 4. 构造 Prompt
      const message =
        mode === 'full' ? this.buildFullModePrompt(task, lifecycleDir) : this.buildFastModePrompt(task, lifecycleDir);

      // 5. 启动监控器
      const monitor = new LifecycleMonitor(sessionId, task.id, lifecycleDir);
      monitor.start();

      // 6. 提交给 AgentExecutor
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const result = await agentExecutor.submitViaPipeline(sessionId, message, 'agent');

      if (!result) {
        log.warn(`[LifecycleOrchestrator] Pipeline not ready for task ${task.id}, using direct submit`);
        const builder = agentExecutor.createBuilderFromFactory('agent');
        if (!builder) {
          throw new Error('Neither Pipeline nor BuilderFactory is available');
        }
        agentExecutor.submit({ sessionId, message, builder });
      }

      log.info(`[LifecycleOrchestrator] Task ${task.id} submitted successfully`);
    } catch (err) {
      log.error(`[LifecycleOrchestrator] Failed to execute lifecycle for task ${task.id}:`, err);
      throw err;
    }
  }

  /**
   * 创建 lifecycle 目录
   */
  private async createLifecycleDir(sessionId: string): Promise<string> {
    try {
      const workspace = await Env.getAgentWorkspaceDir(sessionId);
      const lifecycleDir = path.join(workspace, 'lifecycle');
      await import('node:fs').then((fs) => fs.promises.mkdir(lifecycleDir, { recursive: true }));

      // 验证可写性
      const testFile = path.join(lifecycleDir, '.test');
      await import('node:fs').then(async (fs) => {
        await fs.promises.writeFile(testFile, 'test', 'utf-8');
        await fs.promises.unlink(testFile);
      });

      log.debug(`[LifecycleOrchestrator] Lifecycle directory created: ${lifecycleDir}`);
      return lifecycleDir;
    } catch (err) {
      log.error(`[LifecycleOrchestrator] Failed to create lifecycle dir:`, err);
      throw new Error(`无法创建 lifecycle 目录：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 判断任务是否复杂（决定使用完整模式还是快速模式）
   *
   * 复杂任务的特征：
   * - 描述较长（> 200 字符）
   * - 涉及多个文件（> 3 个）
   * - 包含复杂关键词（重构、迁移、架构、设计等）
   * - 金额较高（> 100）
   */
  private isComplexTask(task: Task): boolean {
    const indicators = [
      task.description.length > 200,
      task.files.length > 3,
      /重构|迁移|架构|设计|系统|优化|改造/.test(task.description),
      task.amount > 100
    ];

    const complexityScore = indicators.filter(Boolean).length;

    // 满足任意一个条件，认为是复杂任务
    return complexityScore >= 1;
  }

  /**
   * 构造完整模式 Prompt（五个阶段）
   */
  private buildFullModePrompt(task: Task, _lifecycleDir: string): string {
    return `# 酒馆任务：${task.title}

## 任务描述

${task.description}

${task.files.length > 0 ? `\n## 相关文件\n\n${task.files.map((f) => `- ${f}`).join('\n')}\n` : ''}

---

## 🚀 执行要求：标准化五阶段流程

请按照以下**五阶段流程**完成此任务。lifecycle 目录已为你准备好模板文件，请依次填充：

### 阶段一：需求分析（必须）📋

**文件**：\`lifecycle/01-需求分析.md\`

**任务**：
1. 理解任务的本质需求（不仅仅是表面描述）
2. 识别核心目标（要达成什么效果）
3. 评估技术可行性（当前技术栈能否实现？）
4. 检查资料完整性（是否需要用户补充 API Key、文档、数据等）
5. 分析涉及范围（模块、文件、接口）

**输出**：
- 完整的需求分析文档（填充模板的所有章节）
- 如果需要用户补充资料，在文档中列出，并使用以下工具通知：

\`\`\`typescript
emit_event({
  _event: "tavern:awaiting-input",
  taskId: "${task.id}",
  requiredInputs: ["资料名称 1", "资料名称 2"]
})
\`\`\`

**完成标志**：
- \`01-需求分析.md\` 文件有实质内容（不是模板占位符）
- 发送通知：\`emit_event({ _event: "notify", message: "任务「${task.title}」完成需求分析阶段", level: "info" })\`

---

### 阶段二：方案设计（必须）🎨

**文件**：\`lifecycle/02-方案设计.md\`

**任务**：
1. 基于需求分析，设计**三个层次的技术方案**：
   - **上策**：架构最优，长远收益高（即使实施成本大）
   - **中策**：平衡质量和效率（推荐大多数场景）
   - **下策**：最快实现，适合紧急场景（可能有技术债）
2. 对比三个方案的优劣（实施成本、长期收益、风险）
3. 选定方案（默认选择**中策**，除非任务明确要求其他方案）

**输出**：
- 完整的方案设计文档（包含上中下三策 + 对比表 + 选定方案）

**完成标志**：
- \`02-方案设计.md\` 文件有实质内容
- 明确选定了某个方案
- 发送通知：\`emit_event({ _event: "notify", message: "任务「${task.title}」完成方案设计阶段", level: "info" })\`

---

### 阶段三：反思优化（必须）🤔

**文件**：\`lifecycle/03-反思优化.md\`

**任务**：
1. 对选定方案进行**自我审查**（Self-Reflection）：
   - 是否有遗漏的边界情况？（异常输入、并发、权限等）
   - 是否有安全隐患？（注入攻击、权限泄露、数据泄漏等）
   - 对现有功能的影响？（是否破坏现有逻辑、向后兼容性）
   - 性能和可维护性？（是否有性能瓶颈、代码是否易维护）
2. 提出优化建议（针对发现的问题）
3. 确定最终方案（经过优化调整后的版本）

**输出**：
- 完整的反思优化文档（包含边界情况、安全评估、影响分析、优化调整）

**完成标志**：
- \`03-反思优化.md\` 文件有实质内容
- 明确了最终方案
- 发送通知：\`emit_event({ _event: "notify", message: "任务「${task.title}」完成反思优化阶段", level: "info" })\`

---

### 阶段四：实施跟踪（必须）⚙️

**文件**：\`lifecycle/04-TODO.md\` + \`05-PROGRESS.md\` + \`06-BUGS.md\`

**任务**：
1. 根据最终方案，生成**待办事项列表**（\`04-TODO.md\`）：
   - 每个 TODO 项必须有：名称、描述、验收标准（可量化、可验证）
   - 验收标准必须包含：功能测试、测试代码路径、类型检查通过
2. 逐项执行待办：
   - 每完成一项 → 更新 \`04-TODO.md\` 状态为 \`[x]\`
   - 在 \`05-PROGRESS.md\` 追加进度记录（时间 + 完成内容 + 文件路径）
   - 每项完成后，**执行其验收标准中的测试**
3. 遇到问题时：
   - 记录到 \`06-BUGS.md\`（问题描述、根因、解决方案）
   - 判断是否阻塞（阻塞问题必须立即修复）

**执行规则**：
- ✅ 必须按顺序执行（除非明确可并行）
- ✅ 每项完成后必须验证（运行测试、检查输出）
- ✅ 所有 TODO 完成后，才能进入阶段五

**完成标志**：
- \`04-TODO.md\` 中所有项标记为 \`[x]\`
- \`05-PROGRESS.md\` 记录了每次变更
- \`06-BUGS.md\` 中无未解决的阻塞问题
- 发送通知：\`emit_event({ _event: "notify", message: "任务「${task.title}」完成实施跟踪阶段", level: "info" })\`

---

### 阶段五：验收报告（必须）✅

**文件**：\`lifecycle/07-验收报告.md\` + \`lifecycle/08-综合报告.md\`

**任务**：
1. 执行整体验收：
   - 检查每个 TODO 的验收标准是否通过
   - 检查 \`06-BUGS.md\` 中是否有未解决的阻塞问题
   - 统计：代码行数、测试覆盖率、文档完整性
2. 生成验收报告（\`07-验收报告.md\`）：
   - 逐项验收结果（✅ 通过 / ❌ 失败）
   - 测试结果（单元测试、集成测试、类型检查）
   - 遗留问题（如有）
3. 生成综合报告（\`08-综合报告.md\`）：
   - 任务摘要（做了什么，解决了什么问题）
   - 技术亮点（3-5 个关键设计）
   - 改动统计（代码行数、测试覆盖率）
   - 后续优化方向

**输出**：
- 验收报告 + 综合报告

**完成标志**：
- 两个文档都有实质内容
- 验收结论明确（✅ 通过 / ❌ 失败 / 🔄 部分通过）
- 如果验收通过，更新酒馆任务状态为 \`completed\`
- 发送完成通知：\`emit_event({ _event: "notify", message: "任务「${task.title}」已完成！", level: "success" })\`
- 使用 \`external_tavern_submit_result\` 提交结果

---

## ⚠️ 重要规则

### 执行顺序

✅ **必须按照 1 → 2 → 3 → 4 → 5 的顺序完成**，不可跳过任何阶段。

### 进度通知

✅ 每完成一个阶段，必须使用 \`emit_event\` 发送通知：

\`\`\`typescript
emit_event({
  _event: "notify",
  message: "任务「${task.title}」完成 [阶段名] 阶段",
  level: "info"
})
\`\`\`

### 暂停机制

⚠️ 如果需要用户补充资料（阶段一）或选择方案（阶段二），立即暂停执行：

\`\`\`typescript
emit_event({
  _event: "tavern:awaiting-input",
  taskId: "${task.id}",
  requiredInputs: ["资料名称"]
})
\`\`\`

### 文档规范

✅ 所有文档使用 Markdown 格式，放在 \`lifecycle/\` 目录。

✅ 每个文档必须填充模板的所有必需章节，不可省略。

### 验收标准

✅ \`04-TODO.md\` 中每个 TODO 项必须有**可验证的验收标准**（至少 2 条）。

✅ 验收标准必须包含：功能测试 + 测试代码路径 + 类型检查。

---

## 📂 目录结构

任务工作空间已为你准备好以下结构：

\`\`\`
{workspace}/
├── lifecycle/              （← 你的工作目录）
│   ├── 01-需求分析.md      （← 请填充）
│   ├── 02-方案设计.md      （← 请填充）
│   ├── 03-反思优化.md      （← 请填充）
│   ├── 04-TODO.md          （← 请填充）
│   ├── 05-PROGRESS.md      （← 实时更新）
│   ├── 06-BUGS.md          （← 遇到问题时记录）
│   ├── 07-验收报告.md      （← 最后生成）
│   ├── 08-综合报告.md      （← 最后生成）
│   └── README.md           （说明文档）
├── output/                 （任务产出物）
└── CONTEXT.md              （上下文信息）
\`\`\`

---

## 🎯 任务成功标准

### 必须满足（验收通过的前提）

- ✅ 五个阶段全部完成
- ✅ 八个文档文件全部生成且有实质内容
- ✅ \`04-TODO.md\` 中所有项标记为已完成
- ✅ \`06-BUGS.md\` 中无未解决的阻塞问题
- ✅ 所有测试通过（单元测试 + 集成测试）
- ✅ TypeScript 和 ESLint 检查通过
- ✅ 任务产出物（如有）保存到 \`output/\` 目录

---

## 🔧 可用工具

你可以使用以下工具完成任务：

- \`read_file\`、\`write_file\`、\`edit_file\` - 文件操作
- \`list_files\`、\`search_files\` - 文件搜索
- \`run_command\` - 执行命令（测试、编译）
- \`emit_event\` - 发送通知和事件
- \`external_tavern_submit_result\` - 提交任务结果

---

**现在开始执行！**

⏳ 第一步：填充 \`lifecycle/01-需求分析.md\`
`;
  }

  /**
   * 构造快速模式 Prompt（简化为三个阶段）
   */
  private buildFastModePrompt(task: Task, _lifecycleDir: string): string {
    return `# 酒馆任务：${task.title}（快速模式）

## 任务描述

${task.description}

${task.files.length > 0 ? `\n## 相关文件\n\n${task.files.map((f) => `- ${f}`).join('\n')}\n` : ''}

---

## 🚀 执行要求：快速模式（三阶段）

本任务被识别为**简单任务**，使用简化的三阶段流程：

### 阶段一：需求分析（简化）📋

**文件**：\`lifecycle/01-需求分析.md\`

**任务**：
1. 理解任务核心需求（1-2 段即可）
2. 快速评估技术可行性
3. 识别涉及的主要文件/模块

**输出**：简化的需求分析（只填充"核心目标"和"涉及范围"章节）

---

### 阶段二：实施（核心）⚙️

**文件**：\`lifecycle/04-TODO.md\` + \`lifecycle/05-PROGRESS.md\`

**任务**：
1. 生成待办列表（3-5 项即可）
2. 逐项执行并记录进度
3. 遇到问题记录到 \`06-BUGS.md\`

**输出**：待办列表 + 进度日志

---

### 阶段三：验收（必须）✅

**文件**：\`lifecycle/08-综合报告.md\`

**任务**：
1. 验证所有 TODO 项完成
2. 生成简化的综合报告（任务摘要 + 交付清单）
3. 提交任务结果

**输出**：综合报告

---

## ⚠️ 重要规则

- ✅ 按顺序完成三个阶段
- ✅ 每个阶段完成后发送通知（\`emit_event\`）
- ✅ 所有文档使用 Markdown 格式，放在 \`lifecycle/\` 目录
- ✅ 完成后使用 \`external_tavern_submit_result\` 提交结果

---

**现在开始执行！**

⏳ 第一步：填充 \`lifecycle/01-需求分析.md\`（简化版）
`;
  }

  /**
   * 恢复任务执行（应用重启后）
   *
   * @param task - 任务定义
   * @param sessionId - 会话 ID
   */
  async recover(task: Task, sessionId: string): Promise<void> {
    try {
      log.info(`[LifecycleOrchestrator] Recovering task ${task.id}`);

      const workspace = await Env.getAgentWorkspaceDir(sessionId);
      const lifecycleDir = path.join(workspace, 'lifecycle');

      // 检测已完成的阶段
      const completedStages = await this.templateGenerator.detectCompletedStages(lifecycleDir);
      const nextStage = this.templateGenerator.getNextStage(completedStages);

      if (nextStage === 'completed') {
        log.info(`[LifecycleOrchestrator] Task ${task.id} already completed, no recovery needed`);
        return;
      }

      log.info(
        `[LifecycleOrchestrator] Task ${task.id} completed stages: [${completedStages.join(', ')}], next: ${nextStage}`
      );

      // 构造恢复消息
      const message = this.buildRecoveryPrompt(task, completedStages, nextStage);

      // 重新启动监控器
      const monitor = new LifecycleMonitor(sessionId, task.id, lifecycleDir);
      monitor.start();

      // 重新提交
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const result = await agentExecutor.submitViaPipeline(sessionId, message, 'agent');

      if (!result) {
        const builder = agentExecutor.createBuilderFromFactory('agent');
        if (!builder) {
          throw new Error('Neither Pipeline nor BuilderFactory is available');
        }
        agentExecutor.submit({ sessionId, message, builder });
      }

      log.info(`[LifecycleOrchestrator] Task ${task.id} recovery submitted`);
    } catch (err) {
      log.error(`[LifecycleOrchestrator] Failed to recover task ${task.id}:`, err);
      throw err;
    }
  }

  /**
   * 构造恢复执行的 Prompt
   */
  private buildRecoveryPrompt(task: Task, completedStages: string[], nextStage: string): string {
    const stageNames: Record<string, string> = {
      'requirement-analysis': '需求分析',
      'solution-design': '方案设计',
      reflection: '反思优化',
      implementation: '实施跟踪',
      acceptance: '验收报告'
    };

    const completedStageNames = completedStages.map((s) => stageNames[s] || s).join('、');
    const nextStageName = stageNames[nextStage] || nextStage;

    return `# 任务恢复：${task.title}

## 恢复信息

你的任务执行被中断（应用重启或崩溃）。

**任务 ID**：${task.id}  
**已完成阶段**：${completedStageNames}  
**下一阶段**：${nextStageName}

---

## 恢复指令

请从 \`lifecycle/\` 目录读取已完成的文档，了解任务当前进度，然后继续执行未完成的阶段。

**操作步骤**：

1. 使用 \`read_file\` 读取已有文档：
   ${completedStages.map((s) => `   - lifecycle/${stageNames[s]}.md`).join('\n')}

2. 理解任务当前进度和已选定的方案

3. 继续执行下一阶段：**${nextStageName}**

---

## 注意事项

- ✅ 不需要重新执行已完成的阶段
- ✅ 继续使用现有的 \`lifecycle/\` 目录
- ✅ 保持文档的连贯性（引用已有文档）
- ✅ 完成后发送通知和提交结果

---

**现在开始恢复执行！**

⏳ 下一阶段：${nextStageName}
`;
  }

  /**
   * 获取任务配置（合并默认值）
   */
  getTaskConfig(task: Task): Required<TaskConfig> {
    return {
      useLifecycle: task.config?.useLifecycle ?? false,
      autoSelectSolution: task.config?.autoSelectSolution ?? true,
      requireDocumentation: task.config?.requireDocumentation ?? true,
      stageTimeout: task.config?.stageTimeout ?? 10 * 60 * 1000, // 10 分钟
      awaitingInputTimeout: task.config?.awaitingInputTimeout ?? 24 * 60 * 60 * 1000 // 24 小时
    };
  }
}
