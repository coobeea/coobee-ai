# 自主任务执行系统设计

## 一、核心理念

### 当前系统 vs 目标系统

```
❌ 当前系统（对话驱动）:
用户: "帮我做宣发"
Agent: "好的，我需要了解产品信息..."
用户: "产品是 XXX"
Agent: "我设计了一个海报方案，你看可以吗？"
用户: "可以，帮我发布"
Agent: "发布到哪些平台？"
用户: "微博、小红书"
Agent: "好的，已发布，链接是..."

问题：
- 需要多轮对话
- 需要人工确认
- 产出分散在对话中
- 无法后台运行

✅ 目标系统（任务驱动）:
用户: "帮我做宣发"
[Agent 自主工作 2 小时...]
Agent 汇报:
  ✅ 产品分析完成
  ✅ 设计 3 种海报方案（已保存到 /artifacts/posters/）
  ✅ 生成 5 条文案（已保存到 /artifacts/copywriting.md）
  ✅ 发布到微博/小红书/知乎（链接附后）
  ✅ 监控数据（已设置定时跟踪）

  产出物：
  - 海报: /artifacts/posters/v1.png, v2.png, v3.png
  - 发布链接: https://weibo.com/xxx, https://xiaohongshu.com/xxx
  - 数据看板: http://localhost:3000/analytics

优势：
- 一次输入，全自动执行
- 无需人工确认
- 产出集中管理
- 可后台运行
```

---

## 二、系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层                            │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 任务提交器 (TaskSubmitter)                         │ │
│  │  - 自然语言输入: "帮我做宣发"                      │ │
│  │  - 任务模板选择: "产品发布"、"代码重构"            │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 任务监控器 (TaskMonitor)                           │ │
│  │  - 实时进度: 32% (正在设计海报...)                 │ │
│  │  - 执行日志: [12:30] 完成产品分析                 │ │
│  │  - 产出预览: 已生成 3 个海报                       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 任务历史 (TaskHistory)                             │ │
│  │  - 已完成任务列表                                  │ │
│  │  - 任务报告查看                                    │ │
│  │  - 产出物下载                                      │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   任务编排层                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 任务规划器 (TaskPlanner)                           │ │
│  │  - 意图理解: "宣发" → ProductMarketing            │ │
│  │  - 目标拆解: 分析 → 设计 → 生成 → 发布 → 验证    │ │
│  │  - 验收标准: 至少 3 个平台，触达 1000+ 用户       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 可行性分析器 (FeasibilityAnalyzer)                │ │
│  │  - 资源检查: 是否有设计工具？API 配额？           │ │
│  │  - 风险评估: 发布可能被拒？内容合规？             │ │
│  │  - 成本估算: 预计耗时 2h，消耗 5000 tokens        │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 执行调度器 (ExecutionScheduler)                    │ │
│  │  - 任务队列: 3 个任务等待中                       │ │
│  │  - 资源分配: 分配 Agent / 工具 / 配额             │ │
│  │  - 优先级管理: 紧急任务优先执行                   │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   执行引擎层                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 自主执行器 (AutonomousExecutor)                    │ │
│  │  - 循环执行: 规划 → 执行 → 验证 → 修复 (直到成功) │ │
│  │  - 工具调用: read/write/exec/search/...           │ │
│  │  - Agent 协作: 调用专业 Agent（设计师、文案师）   │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 验证器 (Validator)                                 │ │
│  │  - 自动测试: 海报是否生成？发布是否成功？         │ │
│  │  - 质量评估: 设计是否美观？文案是否通顺？         │ │
│  │  - 目标检查: 是否达到验收标准？                   │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 产出管理器 (ArtifactManager)                       │ │
│  │  - 文件存储: /artifacts/{task-id}/                │ │
│  │  - 版本控制: v1, v2, v3                           │ │
│  │  - 元数据: 创建时间、类型、状态                   │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   汇报生成层                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 报告生成器 (ReportGenerator)                       │ │
│  │  - 任务总结: 目标 → 执行过程 → 结果               │ │
│  │  - 产出清单: 文件列表 + 预览                      │ │
│  │  - 数据指标: 耗时、成本、质量分数                 │ │
│  │  - 后续建议: 优化方向、下一步行动                 │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 三、核心组件设计

### 3.1 任务规划器 (TaskPlanner)

**职责**：将用户的模糊意图转化为可执行的任务计划

```typescript
// src/main/ai/autonomous/TaskPlanner.ts

export interface TaskPlan {
  /** 任务 ID */
  taskId: string;

  /** 任务类型 */
  type: 'product-launch' | 'code-refactor' | 'research' | 'content-creation' | 'automation';

  /** 任务目标（用户原始输入） */
  userIntent: string;

  /** 解析后的目标 */
  objectives: {
    primary: string; // 主目标: "完成产品宣发"
    secondary: string[]; // 次目标: ["提高品牌知名度", "吸引潜在客户"]
  };

  /** 验收标准（可量化） */
  acceptanceCriteria: {
    dimension: string; // 维度: "覆盖平台数"
    operator: '>=' | '>' | '=' | '<' | '<=';
    threshold: number | string; // 阈值: 3
  }[];

  /** 执行步骤（自动拆解） */
  steps: TaskStep[];

  /** 预估资源 */
  estimatedResources: {
    duration: number; // 预计耗时（分钟）
    tokenUsage: number; // 预计 token 消耗
    toolsNeeded: string[]; // 需要的工具
  };
}

export interface TaskStep {
  id: string;
  name: string;
  description: string;
  type: 'analysis' | 'generation' | 'execution' | 'validation';
  dependencies: string[]; // 依赖的前序步骤
  agent?: string; // 指定的 Agent（可选）
  expectedOutput: string; // 预期产出
}

export class TaskPlanner {
  /**
   * 规划任务（使用 LLM）
   */
  async plan(userIntent: string, context: TaskContext): Promise<TaskPlan> {
    // 调用 LLM，使用专门的 prompt
    const prompt = `
你是一个任务规划专家。用户给出了一个模糊的想法，你需要将其转化为详细的执行计划。

用户意图: ${userIntent}

上下文:
- 可用工具: ${context.availableTools.join(', ')}
- 可用 Agent: ${context.availableAgents.join(', ')}
- 当前时间: ${new Date().toISOString()}

请按以下格式输出任务计划（JSON）:
{
  "type": "任务类型",
  "objectives": {
    "primary": "主目标",
    "secondary": ["次目标1", "次目标2"]
  },
  "acceptanceCriteria": [
    {
      "dimension": "评估维度",
      "operator": ">=",
      "threshold": 3
    }
  ],
  "steps": [
    {
      "id": "step-1",
      "name": "步骤名称",
      "description": "步骤描述",
      "type": "analysis",
      "dependencies": [],
      "agent": "analyst",
      "expectedOutput": "预期产出"
    }
  ],
  "estimatedResources": {
    "duration": 120,
    "tokenUsage": 50000,
    "toolsNeeded": ["read", "write", "exec"]
  }
}

注意：
1. 步骤要具体可执行，不要太抽象
2. 验收标准要可量化
3. 考虑依赖关系，合理排序
4. 预估要准确
`;

    const response = await this.llm.call(prompt);
    const plan = JSON.parse(response);

    return {
      taskId: generateId(),
      userIntent,
      ...plan
    };
  }
}
```

---

### 3.2 可行性分析器 (FeasibilityAnalyzer)

**职责**：评估任务是否可行，提前发现风险

```typescript
// src/main/ai/autonomous/FeasibilityAnalyzer.ts

export interface FeasibilityReport {
  feasible: boolean; // 是否可行
  confidence: number; // 可行性信心（0-1）
  risks: Risk[]; // 风险列表
  missingResources: string[]; // 缺少的资源
  suggestions: string[]; // 建议
}

export interface Risk {
  type: 'technical' | 'resource' | 'permission' | 'cost';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation?: string; // 缓解措施
}

export class FeasibilityAnalyzer {
  async analyze(plan: TaskPlan): Promise<FeasibilityReport> {
    const risks: Risk[] = [];
    const missingResources: string[] = [];

    // 1. 检查工具可用性
    for (const tool of plan.estimatedResources.toolsNeeded) {
      if (!this.isToolAvailable(tool)) {
        missingResources.push(tool);
        risks.push({
          type: 'technical',
          severity: 'high',
          description: `工具 "${tool}" 不可用`
        });
      }
    }

    // 2. 检查 API 配额
    const quotaRemaining = await this.quotaManager.getRemaining();
    if (quotaRemaining < plan.estimatedResources.tokenUsage) {
      risks.push({
        type: 'resource',
        severity: 'critical',
        description: `API 配额不足（需要 ${plan.estimatedResources.tokenUsage}，剩余 ${quotaRemaining}）`,
        mitigation: '等待配额重置或使用备用模型'
      });
    }

    // 3. 检查权限（如需要发布到外部平台）
    const externalActions = this.detectExternalActions(plan);
    for (const action of externalActions) {
      if (!this.hasPermission(action)) {
        risks.push({
          type: 'permission',
          severity: 'high',
          description: `缺少权限: ${action}`,
          mitigation: '需要用户授权或提供 API Key'
        });
      }
    }

    // 4. 成本评估
    const estimatedCost = this.calculateCost(plan);
    if (estimatedCost > 10) {
      // 超过 $10
      risks.push({
        type: 'cost',
        severity: 'medium',
        description: `预计成本较高: $${estimatedCost}`,
        mitigation: '考虑使用更经济的模型'
      });
    }

    // 综合评估
    const criticalRisks = risks.filter((r) => r.severity === 'critical');
    const feasible = criticalRisks.length === 0 && missingResources.length === 0;
    const confidence = this.calculateConfidence(risks);

    return {
      feasible,
      confidence,
      risks,
      missingResources,
      suggestions: this.generateSuggestions(risks)
    };
  }

  private calculateConfidence(risks: Risk[]): number {
    // 根据风险数量和严重程度计算信心
    const weights = { low: 0.05, medium: 0.15, high: 0.3, critical: 0.5 };
    const totalPenalty = risks.reduce((sum, r) => sum + weights[r.severity], 0);
    return Math.max(0, 1 - totalPenalty);
  }
}
```

---

### 3.3 自主执行器 (AutonomousExecutor)

**职责**：完全自主地执行任务，无需人工干预

```typescript
// src/main/ai/autonomous/AutonomousExecutor.ts

export interface ExecutionContext {
  taskId: string;
  plan: TaskPlan;
  artifacts: Map<string, Artifact>;  // 产出物
  logs: ExecutionLog[];              // 执行日志
  state: 'planning' | 'executing' | 'validating' | 'completed' | 'failed';
  currentStep: number;
  maxRetries: number;                // 最大重试次数（默认 3）
}

export interface Artifact {
  id: string;
  type: 'file' | 'url' | 'data';
  path?: string;       // 文件路径
  url?: string;        // 外部链接
  data?: unknown;      // 结构化数据
  metadata: {
    createdAt: string;
    version: number;
    description: string;
  };
}

export class AutonomousExecutor {
  /**
   * 执行任务（自主循环）
   */
  async execute(plan: TaskPlan): Promise<ExecutionResult> {
    const context: ExecutionContext = {
      taskId: plan.taskId,
      plan,
      artifacts: new Map(),
      logs: [],
      state: 'planning',
      currentStep: 0,
      maxRetries: 3
    };

    try {
      // 阶段 1: 规划确认
      this.logProgress(context, 'phase', '开始任务规划...');
      context.state = 'planning';

      // 阶段 2: 逐步执行
      context.state = 'executing';
      for (let i = 0; i < plan.steps.length; i++) {
        context.currentStep = i;
        const step = plan.steps[i];

        this.logProgress(context, 'step', `执行步骤 ${i + 1}/${plan.steps.length}: ${step.name}`);

        // 执行单个步骤（带重试）
        await this.executeStepWithRetry(step, context);
      }

      // 阶段 3: 验证结果
      context.state = 'validating';
      this.logProgress(context, 'phase', '验证任务结果...');
      const validation = await this.validate(context);

      if (!validation.passed) {
        // 自动修复
        this.logProgress(context, 'repair', '结果不达标，尝试自动修复...');
        await this.repair(context, validation);

        // 再次验证
        const revalidation = await this.validate(context);
        if (!revalidation.passed) {
          throw new Error('任务执行失败，即使修复后仍不达标');
        }
      }

      // 阶段 4: 生成报告
      context.state = 'completed';
      this.logProgress(context, 'phase', '生成任务报告...');
      const report = await this.generateReport(context);

      return {
        success: true,
        artifacts: Array.from(context.artifacts.values()),
        report,
        logs: context.logs
      };

    } catch (error) {
      context.state = 'failed';
      this.logProgress(context, 'error', `任务失败: ${error.message}`);

      return {
        success: false,
        error: error.message,
        logs: context.logs
      };
    }
  }

  /**
   * 执行单个步骤（带重试）
   */
  private async executeStepWithRetry(
    step: TaskStep,
    context: ExecutionContext
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= context.maxRetries; attempt++) {
      try {
        await this.executeStep(step, context);
        return;  // 成功
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logProgress(
          context,
          'retry',
          `步骤失败（尝试 ${attempt}/${context.maxRetries}）: ${lastError.message}`
        );

        if (attempt < context.maxRetries) {
          await this.sleep(2000 * attempt);  // 递增等待
        }
      }
    }

    throw lastError;  // 所有重试都失败
  }

  /**
   * 执行单个步骤（核心逻辑）
   */
  private async executeStep(step: TaskStep, context: ExecutionContext): Promise<void> {
    // 根据步骤类型选择执行策略
    switch (step.type) {
      case 'analysis':
        await this.executeAnalysisStep(step, context);
        break;

      case 'generation':
        await this.executeGenerationStep(step, context);
        break;

      case 'execution':
        await this.executeActionStep(step, context);
        break;

      case 'validation':
        await this.executeValidationStep(step, context);
        break;
    }
  }

  /**
   * 执行生成步骤（如生成海报、文案）
   */
  private async executeGenerationStep(
    step: TaskStep,
    context: ExecutionContext
  ): Promise<void> {
    // 调用专业 Agent（如设计师 Agent）
    const agent = step.agent ?? 'default';
    const agentDef = await AgentStore.get(agent);

    if (!agentDef) {
      throw new Error(`Agent "${agent}" not found`);
    }

    // 构建 prompt
    const prompt = `
你是 ${agentDef.name}。当前任务步骤：${step.description}

预期产出：${step.expectedOutput}

已有产出：
${this.formatArtifacts(context.artifacts)}

请完成这个步骤，并将产出保存到文件系统。
`;

    // 执行 Agent
    const runtime = /* 创建 runtime */;
    const result = await runtime.run(prompt, {
      sessionId: context.taskId,
      agentId: agent
    });

    // 收集产出物
    const newArtifacts = this.extractArtifacts(result);
    for (const artifact of newArtifacts) {
      context.artifacts.set(artifact.id, artifact);
    }
  }

  /**
   * 验证任务结果
   */
  private async validate(context: ExecutionContext): Promise<ValidationResult> {
    const plan = context.plan;
    const results: Array<{ dimension: string; passed: boolean; actual: unknown }> = [];

    for (const criterion of plan.acceptanceCriteria) {
      const actualValue = await this.measureDimension(criterion.dimension, context);
      const passed = this.checkCriterion(criterion, actualValue);

      results.push({
        dimension: criterion.dimension,
        passed,
        actual: actualValue
      });
    }

    const allPassed = results.every(r => r.passed);

    return {
      passed: allPassed,
      results,
      score: results.filter(r => r.passed).length / results.length
    };
  }

  /**
   * 自动修复
   */
  private async repair(
    context: ExecutionContext,
    validation: ValidationResult
  ): Promise<void> {
    // 找出未达标的维度
    const failedCriteria = validation.results.filter(r => !r.passed);

    // 使用 LLM 生成修复计划
    const repairPrompt = `
任务验证失败，以下维度未达标：

${failedCriteria.map(f => `- ${f.dimension}: 期望 ${JSON.stringify(f)}, 实际 ${f.actual}`).join('\n')}

已有产出：
${this.formatArtifacts(context.artifacts)}

请分析原因并生成修复计划（JSON 格式）。
`;

    const repairPlan = await this.llm.call(repairPrompt);

    // 执行修复
    // ... (类似 executeStep)
  }

  /**
   * 生成任务报告
   */
  private async generateReport(context: ExecutionContext): Promise<TaskReport> {
    const plan = context.plan;
    const artifacts = Array.from(context.artifacts.values());

    // 使用 LLM 生成总结
    const summaryPrompt = `
任务已完成，请生成一份简洁的汇报。

用户意图：${plan.userIntent}

执行步骤：
${plan.steps.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}

产出物：
${artifacts.map(a => `- ${a.metadata.description} (${a.type})`).join('\n')}

请用自然语言总结：
1. 完成了哪些工作
2. 产出了什么（附文件路径/链接）
3. 有什么值得注意的点
4. 后续建议

保持简洁，用户不需要技术细节。
`;

    const summary = await this.llm.call(summaryPrompt);

    return {
      taskId: context.taskId,
      userIntent: plan.userIntent,
      status: 'completed',
      summary,
      artifacts,
      metrics: {
        duration: this.calculateDuration(context),
        tokenUsage: this.calculateTokenUsage(context),
        cost: this.calculateCost(context)
      },
      logs: context.logs
    };
  }
}
```

---

### 3.4 产出管理器 (ArtifactManager)

**职责**：统一管理任务产出物，提供版本控制

```typescript
// src/main/ai/autonomous/ArtifactManager.ts

export class ArtifactManager {
  private basePath = '.home/artifacts';

  /**
   * 保存产出物
   */
  async save(taskId: string, artifact: ArtifactInput): Promise<Artifact> {
    const taskDir = path.join(this.basePath, taskId);
    await fs.promises.mkdir(taskDir, { recursive: true });

    const id = generateId();
    const version = await this.getNextVersion(taskDir, artifact.name);

    let filePath: string | undefined;

    if (artifact.type === 'file') {
      // 保存文件
      const fileName = `${artifact.name}_v${version}${path.extname(artifact.name)}`;
      filePath = path.join(taskDir, fileName);
      await fs.promises.writeFile(filePath, artifact.content);
    }

    // 保存元数据
    const metadata: Artifact = {
      id,
      type: artifact.type,
      path: filePath,
      url: artifact.url,
      data: artifact.data,
      metadata: {
        createdAt: new Date().toISOString(),
        version,
        description: artifact.description
      }
    };

    const metadataPath = path.join(taskDir, `${id}.json`);
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  /**
   * 获取任务的所有产出物
   */
  async getTaskArtifacts(taskId: string): Promise<Artifact[]> {
    const taskDir = path.join(this.basePath, taskId);

    if (!fs.existsSync(taskDir)) {
      return [];
    }

    const files = await fs.promises.readdir(taskDir);
    const metadataFiles = files.filter((f) => f.endsWith('.json'));

    const artifacts: Artifact[] = [];

    for (const file of metadataFiles) {
      const content = await fs.promises.readFile(path.join(taskDir, file), 'utf-8');
      artifacts.push(JSON.parse(content));
    }

    return artifacts;
  }

  /**
   * 获取产出物的下一个版本号
   */
  private async getNextVersion(taskDir: string, name: string): Promise<number> {
    if (!fs.existsSync(taskDir)) {
      return 1;
    }

    const files = await fs.promises.readdir(taskDir);
    const baseName = path.parse(name).name;
    const versions = files
      .filter((f) => f.startsWith(baseName) && f.includes('_v'))
      .map((f) => {
        const match = f.match(/_v(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });

    return versions.length > 0 ? Math.max(...versions) + 1 : 1;
  }
}
```

---

## 四、前端 UI 设计

### 4.1 任务提交界面

```vue
<!-- src/renderer/src/views/AutonomousTaskView.vue -->
<script setup lang="ts">
import { ref } from 'vue';

const userIntent = ref('');
const taskMode = ref<'autonomous' | 'guided'>('autonomous');

async function submitTask() {
  const response = await fetch('/gateway/tasks/autonomous', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: userIntent.value,
      mode: taskMode.value
    })
  });

  const task = await response.json();

  // 跳转到任务监控页面
  router.push(`/tasks/${task.id}`);
}
</script>

<template>
  <div class="autonomous-task-view">
    <div class="task-input-card">
      <h2>🚀 提交自主任务</h2>

      <div class="mode-selector">
        <label>
          <input type="radio" value="autonomous" v-model="taskMode" />
          完全自主（推荐）
          <span class="mode-desc">Agent 自动完成所有步骤，无需确认</span>
        </label>
        <label>
          <input type="radio" value="guided" v-model="taskMode" />
          引导模式
          <span class="mode-desc">关键步骤需要人工确认</span>
        </label>
      </div>

      <textarea
        v-model="userIntent"
        placeholder="描述你的想法，例如：&#10;- 帮我做产品宣发&#10;- 重构 UserService 代码&#10;- 分析竞品的 SEO 策略"
        rows="6" />

      <button @click="submitTask" class="submit-btn"> 提交任务 </button>
    </div>

    <!-- 任务模板（可选） -->
    <div class="task-templates">
      <h3>快速模板</h3>
      <div class="template-list">
        <div class="template-card" @click="userIntent = '帮我做产品宣发'"> 📢 产品宣发 </div>
        <div class="template-card" @click="userIntent = '重构代码'"> 🔧 代码重构 </div>
        <div class="template-card" @click="userIntent = '竞品分析'"> 📊 竞品分析 </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ... styles ... */
</style>
```

---

### 4.2 任务监控界面

```vue
<!-- src/renderer/src/views/TaskMonitorView.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const taskId = route.params.id as string;

const task = ref<Task | null>(null);
const logs = ref<ExecutionLog[]>([]);

onMounted(async () => {
  // 获取任务信息
  const res = await fetch(`/gateway/tasks/${taskId}`);
  task.value = await res.json();

  // 订阅实时日志
  subscribeToLogs(taskId);
});

function subscribeToLogs(taskId: string) {
  const gateway = useGateway();
  gateway.on('task:log', (data) => {
    if (data.taskId === taskId) {
      logs.value.push(data.log);
    }
  });
}
</script>

<template>
  <div class="task-monitor-view">
    <!-- 任务头部 -->
    <div class="task-header">
      <h2>{{ task?.userIntent }}</h2>
      <div class="status-badge" :class="task?.state">
        {{ task?.state }}
      </div>
    </div>

    <!-- 进度条 -->
    <div class="progress-section">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${(task?.currentStep / task?.plan.steps.length) * 100}%` }" />
      </div>
      <span class="progress-text"> {{ task?.currentStep }}/{{ task?.plan.steps.length }} 步骤完成 </span>
    </div>

    <!-- 执行步骤 -->
    <div class="steps-section">
      <h3>执行步骤</h3>
      <div
        v-for="(step, idx) in task?.plan.steps"
        :key="step.id"
        class="step-item"
        :class="{
          completed: idx < task.currentStep,
          active: idx === task.currentStep,
          pending: idx > task.currentStep
        }">
        <span class="step-icon">
          <span v-if="idx < task.currentStep" class="i-carbon-checkmark" />
          <span v-else-if="idx === task.currentStep" class="i-carbon-hourglass" />
          <span v-else class="i-carbon-circle" />
        </span>
        <span class="step-name">{{ step.name }}</span>
      </div>
    </div>

    <!-- 实时日志 -->
    <div class="logs-section">
      <h3>执行日志</h3>
      <div class="log-list">
        <div v-for="(log, idx) in logs" :key="idx" class="log-item" :class="log.type">
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
    </div>

    <!-- 产出预览 -->
    <div v-if="task?.artifacts.length > 0" class="artifacts-section">
      <h3>已生成产出</h3>
      <div class="artifact-list">
        <div v-for="artifact in task.artifacts" :key="artifact.id" class="artifact-item">
          <span class="artifact-icon">
            <span v-if="artifact.type === 'file'" class="i-carbon-document" />
            <span v-else-if="artifact.type === 'url'" class="i-carbon-link" />
            <span v-else class="i-carbon-data-1" />
          </span>
          <span class="artifact-name">{{ artifact.metadata.description }}</span>
          <button @click="previewArtifact(artifact)">预览</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ... styles ... */
</style>
```

---

### 4.3 任务报告界面

```vue
<!-- src/renderer/src/views/TaskReportView.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const taskId = route.params.id as string;

const report = ref<TaskReport | null>(null);

onMounted(async () => {
  const res = await fetch(`/gateway/tasks/${taskId}/report`);
  report.value = await res.json();
});
</script>

<template>
  <div class="task-report-view">
    <div class="report-header">
      <h1>任务报告</h1>
      <span class="report-status" :class="report?.status">
        {{ report?.status === 'completed' ? '✅ 已完成' : '❌ 失败' }}
      </span>
    </div>

    <!-- 任务总结（LLM 生成） -->
    <div class="report-summary">
      <h2>📋 任务总结</h2>
      <div class="summary-content" v-html="marked(report?.summary || '')" />
    </div>

    <!-- 产出清单 -->
    <div class="report-artifacts">
      <h2>📦 产出清单</h2>
      <div class="artifact-grid">
        <div v-for="artifact in report?.artifacts" :key="artifact.id" class="artifact-card">
          <div class="artifact-preview">
            <img v-if="artifact.type === 'file' && isImage(artifact.path)" :src="artifact.path" />
            <span v-else class="artifact-icon">📄</span>
          </div>
          <div class="artifact-info">
            <h4>{{ artifact.metadata.description }}</h4>
            <span class="artifact-path">{{ artifact.path || artifact.url }}</span>
            <button @click="downloadArtifact(artifact)">下载</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据指标 -->
    <div class="report-metrics">
      <h2>📊 数据指标</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-label">耗时</span>
          <span class="metric-value">{{ report?.metrics.duration }}分钟</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Token 消耗</span>
          <span class="metric-value">{{ report?.metrics.tokenUsage }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">成本</span>
          <span class="metric-value">${{ report?.metrics.cost.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <!-- 后续建议 -->
    <div v-if="report?.suggestions" class="report-suggestions">
      <h2>💡 后续建议</h2>
      <ul>
        <li v-for="(suggestion, idx) in report.suggestions" :key="idx">
          {{ suggestion }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* ... styles ... */
</style>
```

---

## 五、典型使用场景

### 场景 1: 产品宣发（你的例子）

**用户输入**：

```
"帮我做产品宣发"
```

**系统执行**（后台自动，2 小时）：

```
[12:00] 开始任务规划...
[12:01] ✅ 规划完成
  - 步骤 1: 产品分析
  - 步骤 2: 设计海报（3 个方案）
  - 步骤 3: 生成文案（5 条）
  - 步骤 4: 发布到平台（微博/小红书/知乎）
  - 步骤 5: 验证发布结果

[12:05] 执行步骤 1/5: 产品分析
  - 读取产品文档: /docs/product.md
  - 分析目标用户: 25-35 岁，互联网从业者
  - 提取卖点: 高效、智能、易用

[12:15] 执行步骤 2/5: 设计海报
  - 调用设计师 Agent
  - 生成方案 1: 科技风 (poster_v1.png)
  - 生成方案 2: 简约风 (poster_v2.png)
  - 生成方案 3: 插画风 (poster_v3.png)

[12:45] 执行步骤 3/5: 生成文案
  - 调用文案师 Agent
  - 生成 5 条文案 (copywriting.md)

[13:00] 执行步骤 4/5: 发布到平台
  - 发布到微博: ✅ https://weibo.com/xxx
  - 发布到小红书: ✅ https://xiaohongshu.com/xxx
  - 发布到知乎: ✅ https://zhihu.com/xxx

[13:30] 执行步骤 5/5: 验证发布结果
  - 检查微博: ✅ 已发布，浏览 125 次
  - 检查小红书: ✅ 已发布，浏览 89 次
  - 检查知乎: ✅ 已发布，浏览 67 次

[14:00] 生成任务报告...
[14:05] ✅ 任务完成
```

**用户收到的报告**：

```markdown
# 任务报告：产品宣发

## 📋 任务总结

已成功完成产品宣发任务。产出包括：

- **3 个海报方案**（科技风、简约风、插画风）
- **5 条营销文案**
- **已发布到 3 个平台**（微博、小红书、知乎）
- **初步触达 281 人**（前 2 小时数据）

所有产出物已保存到 `/artifacts/task-20260224-xxx/`。

## 📦 产出清单

1. 海报方案
   - poster_v1.png（科技风）
   - poster_v2.png（简约风）
   - poster_v3.png（插画风）

2. 营销文案
   - copywriting.md（5 条文案）

3. 发布链接
   - 微博: https://weibo.com/xxx
   - 小红书: https://xiaohongshu.com/xxx
   - 知乎: https://zhihu.com/xxx

## 📊 数据指标

- 耗时: 125 分钟
- Token 消耗: 45,230
- 成本: $6.78
- 初步触达: 281 人

## 💡 后续建议

1. 监控数据，建议 24 小时后查看完整效果
2. 根据数据反馈，调整文案和海报
3. 考虑增加抖音、B 站等平台
```

**用户体验**：

- ✅ 提交任务后，可以去做其他事情
- ✅ 2 小时后收到通知："任务已完成"
- ✅ 打开报告，看到所有产出和链接
- ✅ 直接去平台查看效果，无需自己操作

---

### 场景 2: 代码重构

**用户输入**：

```
"重构 UserService 代码"
```

**系统执行**：

```
1. 分析现有代码
2. 识别问题（重复代码、性能瓶颈）
3. 设计重构方案
4. 自动重构（保持功能不变）
5. 运行测试验证
6. 提交代码（创建 PR）
```

**用户收到的报告**：

```markdown
# 任务报告：代码重构

## 📋 任务总结

已成功重构 `UserService`。改进包括：

- **提取公共方法**（减少 30% 重复代码）
- **优化数据库查询**（性能提升 2.5x）
- **增加单元测试**（覆盖率从 60% → 95%）

所有测试通过，已创建 Pull Request。

## 📦 产出清单

1. 重构代码
   - src/services/UserService.ts（已更新）
   - src/services/UserService.test.ts（新增测试）

2. Pull Request
   - GitHub: https://github.com/xxx/pull/123

## 📊 数据指标

- 耗时: 45 分钟
- 代码行数: +120 / -85
- 测试覆盖率: 60% → 95%
- 性能提升: 2.5x

## 💡 后续建议

1. Review PR 并合并
2. 部署到测试环境验证
3. 考虑重构其他 Service
```

---

## 六、实施计划

### Phase 1: 核心基础（3-5 天）

- [ ] 实现 `TaskPlanner`（任务规划器）
- [ ] 实现 `FeasibilityAnalyzer`（可行性分析器）
- [ ] 实现 `AutonomousExecutor`（自主执行器）
- [ ] 实现 `ArtifactManager`（产出管理器）
- [ ] 单元测试

### Phase 2: 前端 UI（2-3 天）

- [ ] 任务提交界面（`AutonomousTaskView.vue`）
- [ ] 任务监控界面（`TaskMonitorView.vue`）
- [ ] 任务报告界面（`TaskReportView.vue`）
- [ ] 任务历史列表

### Phase 3: 集成优化（2-3 天）

- [ ] 与现有 Agent 系统集成
- [ ] 与 Swarm/Orchestrator 集成
- [ ] 实时进度推送（WebSocket）
- [ ] 错误恢复机制

### Phase 4: 高级功能（可选，3-5 天）

- [ ] 任务模板系统
- [ ] 任务暂停/恢复
- [ ] 任务优先级调度
- [ ] 成本预算控制
- [ ] 多任务并行执行

---

## 七、关键设计决策

### 1. 为什么不需要 HITL（人工确认）？

**设计原则**：

- ✅ **充分的前置规划**：TaskPlanner 详细拆解任务
- ✅ **可行性验证**：FeasibilityAnalyzer 提前发现风险
- ✅ **自动修复**：Validator + Repairer 自动纠错
- ✅ **产出可回溯**：所有产出都有版本控制

**例外情况**：

- 高风险操作（如删除数据库）→ 仍需确认
- 用户明确要求引导模式 → 关键步骤确认

---

### 2. 如何保证质量？

**质量保证机制**：

1. **验收标准**：任务规划时就定义清晰的标准
2. **自动验证**：每个步骤完成后自动验证
3. **自动修复**：不达标时自动修复（最多 3 次）
4. **人工兜底**：修复仍失败时通知用户

---

### 3. 如何处理长时间任务？

**设计方案**：

- **后台运行**：任务在独立进程中运行
- **持久化状态**：定期保存到文件系统
- **断点续传**：系统重启后可恢复
- **实时推送**：通过 WebSocket 推送进度

---

## 八、与现有系统的集成

### 整合点

```typescript
// 1. 在 Sidebar 添加入口
menuItems.push({
  id: 'autonomous-tasks',
  label: '自主任务',
  icon: 'i-carbon-task-star',
  route: '/autonomous-tasks'
});

// 2. 在 Gateway 注册 HTTP 路由
registerAutonomousTaskRoutes(router);

// 3. 在 AgentExecutor 中集成
if (mode === 'autonomous') {
  const executor = new AutonomousExecutor(...);
  return await executor.execute(plan);
}

// 4. 在 Copilot 中提供快捷入口
showAutonomousTaskButton();
```

---

## 九、总结

### 核心价值

| 维度         | 当前系统   | 自主任务系统 |
| ------------ | ---------- | ------------ |
| **交互方式** | 对话驱动   | 任务驱动     |
| **人工介入** | 频繁确认   | 无需确认     |
| **产出形式** | 对话消息   | 文件/链接    |
| **执行时长** | 受限于对话 | 后台长运行   |
| **可追溯性** | 对话历史   | 任务报告     |
| **自动化度** | 半自动     | 全自动       |

### 适用场景

**推荐使用自主任务系统**：

- ✅ 目标明确，流程可预测
- ✅ 需要长时间运行（> 10 分钟）
- ✅ 产出是具体的文件/产品
- ✅ 不需要频繁确认

**仍使用对话系统**：

- ✅ 探索性任务（不确定目标）
- ✅ 需要人工决策（如设计选择）
- ✅ 快速问答（< 5 分钟）

---

**这个设计解决了你的核心诉求吗？我已准备好开始实施！** 🚀
