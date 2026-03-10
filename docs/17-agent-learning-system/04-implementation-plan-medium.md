# 训练模式实施方案 - 中策（平衡方案）

> **定位**：功能完善、性能平衡的方案，在基础版上增加 UI、动态数据生成、训练教练。

---

## 方案概述

### 目标

在下策（基础方案）的基础上，提供更好的用户体验和更智能的训练机制：

1. 可视化的训练管理界面
2. Agent 动态生成训练数据
3. 训练教练给出改进建议
4. 支持暂停和恢复

### 在下策基础上新增

| 功能      | 下策                   | 中策                  |
| --------- | ---------------------- | --------------------- |
| 启动方式  | 命令行                 | UI 界面               |
| 数据生成  | 静态（手动准备 50 个） | 动态（Agent 生成）    |
| 改进机制  | 简单重试               | 训练教练给建议        |
| 进度监控  | 命令行日志             | 实时 UI 更新          |
| 暂停/恢复 | ❌ 不支持              | ✅ 支持               |
| 训练报告  | 纯文本 Markdown        | Markdown + 简单图表   |
| 并行训练  | ❌ 不支持              | ❌ 不支持（留给上策） |

---

## 新增功能设计

### 1. Training View UI

**路由**：`/training`

**主要组件**：

```
src/renderer/src/views/TrainingView.vue
src/renderer/src/components/training/
  ├── TrainingDashboard.vue       ← 训练仪表板
  ├── TrainingList.vue            ← 训练列表
  ├── TrainingDetail.vue          ← 训练详情（实时进度）
  ├── CreateTrainingDialog.vue    ← 创建训练对话框
  └── TrainingReport.vue          ← 训练报告展示
```

**核心功能**：

1. **训练仪表板**
   - 显示进行中的训练（实时进度）
   - 显示历史训练（可查看报告）
   - 创建新训练按钮

2. **创建训练流程**
   - 步骤 1：选择智能体（下拉列表）
   - 步骤 2：选择训练目标（目前只有"代码生成能力"）
   - 步骤 3：配置参数（轮次、达标线）
   - 步骤 4：确认开始

3. **训练详情页**
   - 实时进度条
   - 当前得分和平均得分
   - 最近 10 轮的得分列表
   - 暂停/恢复/停止按钮

---

### 2. 动态数据生成（training-data-generator Agent）

**Agent 定义**：`agents/training-data-generator.json`

```json
{
  "id": "training-data-generator",
  "name": "训练数据生成器",
  "description": "根据基础数据集和当前训练进度，生成新的训练任务",
  "instructions": [
    "你是一个专业的训练数据生成专家。根据基础数据集，生成新的、多样化的训练任务。",
    "",
    "生成要求：",
    "1. 与基础数据集保持一致的风格和难度",
    "2. 避免与已有任务重复",
    "3. 确保任务有明确的评估标准",
    "4. 难度递进（如果智能体表现好，生成稍难的任务）",
    "",
    "输出格式（严格 JSON）：",
    "{",
    "  \"id\": \"task-051\",",
    "  \"description\": \"用 TypeScript 实现...\",",
    "  \"difficulty\": 3,",
    "  \"testCase\": \"...\",",
    "  \"tags\": [...]",
    "}",
    "",
    "注意：",
    "- 任务描述要清晰、具体",
    "- 避免过于简单或过于复杂",
    "- 每次只生成 1 个任务"
  ],
  "skills": ["dimension-architect"],
  "tools": ["read"]
}
```

**触发时机**（基于决策讨论）：

- **方案 B**（推荐）：基础数据集用完后才生成
  - 前 50 轮：使用基础数据集（手动准备）
  - 第 51 轮起：每轮生成 1 个新任务

**实现**：

```typescript
class TrainingDatasetManager {
  async getTask(session: TrainingSession, round: number): Promise<TrainingTask> {
    // 如果还有基础数据集，优先使用
    if (round <= session.baseDataset.length) {
      return session.baseDataset[round - 1];
    }

    // 基础数据集用完，通过 Agent 生成新任务
    const newTask = await this.generateTaskByAgent(session);
    session.generatedTasks.push(newTask);
    return newTask;
  }

  private async generateTaskByAgent(session: TrainingSession): Promise<TrainingTask> {
    // 分析当前训练进度
    const recentResults = session.results.slice(-10);
    const avgScore = recentResults.reduce((sum, r) => sum + r.evaluation.score, 0) / recentResults.length;

    const prompt = `
基于以下信息生成 1 个新的代码生成训练任务：

**基础数据集示例**：
${JSON.stringify(session.baseDataset.slice(0, 3), null, 2)}

**当前训练进度**：
- 已完成轮次：${session.results.length}
- 近 10 轮平均分：${avgScore.toFixed(1)}

**生成要求**：
- 风格与基础数据集一致
- 难度适中（${avgScore >= 80 ? '可稍微提高难度' : '保持当前难度'}）
- 避免重复

输出 JSON 格式的任务定义。
    `.trim();

    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-data-generator',
      userMessage: prompt,
      sessionId: `training-datagen-${Date.now()}`,
      metadata: { isTrainingDataGeneration: true }
    });

    return JSON.parse(result.content);
  }
}
```

---

### 3. 训练教练（training-coach Agent）

**Agent 定义**：`agents/training-coach.json`

```json
{
  "id": "training-coach",
  "name": "训练教练",
  "description": "分析训练结果，给出具体的改进建议",
  "instructions": [
    "你是一个经验丰富的训练教练，负责分析智能体的表现并给出改进建议。",
    "",
    "分析内容：",
    "1. 任务要求和实际输出的差距",
    "2. 评估结果中失分的原因",
    "3. 常见错误模式",
    "",
    "建议要求：",
    "1. 具体、可操作（不要泛泛而谈）",
    "2. 针对性强（针对本次任务的具体问题）",
    "3. 3-5 条建议（不要太多）",
    "",
    "输出格式：",
    "纯文本，每条建议一行，用 - 开头。",
    "",
    "示例：",
    "- 增加对空数组的边界检查",
    "- 优化时间复杂度，使用二分查找代替线性查找",
    "- 添加输入参数的类型校验"
  ],
  "skills": ["self-reflection", "eval-refine-loop"],
  "tools": []
}
```

**使用方式**：

```typescript
// 在 TrainingExecutor 中
if (evaluation.score < session.goal.threshold) {
  // 1. 获取教练建议
  const advice = await this.getCoachAdvice(task, output, evaluation);

  // 2. 基于建议重新执行
  const refinedPrompt = `
${task.description}

**改进建议**（参考以下建议优化输出）：
${advice}
  `.trim();

  const refinedOutput = await this.executeTask(session.agentId, {
    ...task,
    description: refinedPrompt
  });

  // 3. 重新评估
  evaluation = await this.evaluateOutput(task, refinedOutput);
}
```

---

### 4. 训练会话持久化

**存储位置**：`{userHome}/training-sessions/`

**数据结构**：

```typescript
// training-sessions/{sessionId}.json
{
  "id": "training-1710057600000",
  "agentId": "app-copilot",
  "goal": { "name": "代码生成能力", "threshold": 80 },
  "status": "running" | "paused" | "completed",
  "progress": {
    "currentRound": 450,
    "totalRounds": 1000,
    "startTime": 1710057600000,
    "pausedAt": null
  },
  "results": [...],
  "baseDataset": [...],
  "generatedTasks": [...]
}
```

**恢复机制**：

```typescript
class TrainingExecutor {
  async resumeTraining(sessionId: string): Promise<void> {
    // 1. 加载训练会话
    const session = await this.loadSession(sessionId);

    if (session.status !== 'paused') {
      throw new Error('只能恢复已暂停的训练');
    }

    // 2. 从当前轮次继续
    session.status = 'running';
    for (let round = session.progress.currentRound + 1; round <= session.progress.totalRounds; round++) {
      // ... 执行训练
    }
  }
}
```

---

### 5. 实时进度更新

**事件机制**：

```typescript
// TrainingExecutor 触发事件
class TrainingExecutor {
  private async updateProgress(session: TrainingSession): Promise<void> {
    // 保存到文件
    await this.saveSession(session);

    // 触发事件（通知前端更新）
    eventBus.emit('training:progress', {
      sessionId: session.id,
      currentRound: session.results.length,
      totalRounds: session.maxRounds,
      currentScore: session.results[session.results.length - 1]?.evaluation.score,
      avgScore: this.calculateAvgScore(session.results)
    });
  }
}
```

**前端监听**：

```typescript
// TrainingDetail.vue
import { gateway } from '@/api/gateway';

onMounted(() => {
  gateway.on('training.progress', (data) => {
    // 更新 UI
    progress.value = {
      currentRound: data.currentRound,
      totalRounds: data.totalRounds,
      currentScore: data.currentScore,
      avgScore: data.avgScore
    };
  });
});
```

---

## 实施计划

### Week 1-2：基础功能（复用下策）

- [x] 准备基础数据集（50 个任务）
- [x] 创建 training-evaluator Agent
- [x] 实现 TrainingExecutor 基础版
- [x] 实现类型定义

### Week 3：新增 Agent

- [ ] 创建 training-data-generator Agent
- [ ] 创建 training-coach Agent
- [ ] 测试 Agent 功能（独立测试）

### Week 4：增强执行器

- [ ] 实现 TrainingDatasetManager（数据集管理）
- [ ] 实现 AgentDelegator（Agent 委托层）
- [ ] 集成训练教练到训练循环
- [ ] 实现训练会话持久化

### Week 5-6：UI 开发

- [ ] 实现 TrainingView 路由和基础布局
- [ ] 实现 TrainingDashboard（仪表板）
- [ ] 实现 CreateTrainingDialog（创建对话框）
- [ ] 实现 TrainingDetail（详情页，实时更新）

### Week 7：事件桥接

- [ ] 实现 TrainingBridge（后端事件 → 前端）
- [ ] 集成 WebSocket 实时推送
- [ ] 实现暂停/恢复功能

### Week 8：测试和优化

- [ ] 端到端测试
- [ ] 性能优化
- [ ] Bug 修复

---

## 技术实现细节

### 1. Agent 委托层（统一封装）

**文件**：`src/main/training/AgentDelegator.ts`

```typescript
/**
 * Agent 委托层
 *
 * 统一封装所有训练相关的 Agent 调用，提供：
 * - 统一的超时和重试机制
 * - 统一的错误处理
 * - 统一的日志记录
 */

export class AgentDelegator {
  private readonly timeout = 30000; // 30s 超时
  private readonly maxRetries = 3; // 最多重试 3 次

  /**
   * 执行训练任务
   */
  async executeTask(agentId: string, task: TrainingTask): Promise<string> {
    return await this.callAgentWithRetry(agentId, task.description, { isTrainingExecution: true });
  }

  /**
   * 评估输出
   */
  async evaluateOutput(task: TrainingTask, output: string): Promise<Evaluation> {
    const prompt = this.buildEvaluationPrompt(task, output);
    const result = await this.callAgentWithRetry('training-evaluator', prompt, { isTrainingEvaluation: true });

    return this.parseEvaluation(result);
  }

  /**
   * 获取教练建议
   */
  async getCoachAdvice(task: TrainingTask, output: string, evaluation: Evaluation): Promise<string> {
    const prompt = this.buildCoachPrompt(task, output, evaluation);
    return await this.callAgentWithRetry('training-coach', prompt, { isTrainingCoach: true });
  }

  /**
   * 生成训练数据
   */
  async generateTask(baseDataset: TrainingTask[], context: any): Promise<TrainingTask> {
    const prompt = this.buildDataGenPrompt(baseDataset, context);
    const result = await this.callAgentWithRetry('training-data-generator', prompt, { isTrainingDataGeneration: true });

    return this.parseTask(result);
  }

  /**
   * 统一的 Agent 调用（带超时和重试）
   */
  private async callAgentWithRetry(
    agentId: string,
    userMessage: string,
    metadata: Record<string, any>,
    retries = 0
  ): Promise<string> {
    try {
      const result = await this.callAgentWithTimeout(agentId, userMessage, metadata);
      return result;
    } catch (err) {
      if (retries < this.maxRetries) {
        console.warn(`[AgentDelegator] Agent 调用失败，重试 ${retries + 1}/${this.maxRetries}:`, err);
        return await this.callAgentWithRetry(agentId, userMessage, metadata, retries + 1);
      }
      throw err;
    }
  }

  /**
   * 带超时的 Agent 调用
   */
  private async callAgentWithTimeout(
    agentId: string,
    userMessage: string,
    metadata: Record<string, any>
  ): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Agent 调用超时')), this.timeout)
    );

    const callPromise = ChannelRuntime.getInstance().executeAgent({
      agentId,
      userMessage,
      sessionId: `training-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      metadata
    });

    const result = await Promise.race([callPromise, timeoutPromise]);
    return result.content || '';
  }

  // ... 其他辅助方法（buildPrompt, parse 等）
}
```

---

### 2. 训练会话管理

**文件**：`src/main/training/TrainingSessionStore.ts`

```typescript
/**
 * 训练会话持久化
 */

export class TrainingSessionStore {
  private readonly sessionsDir: string;

  constructor(userHome: string) {
    this.sessionsDir = path.join(userHome, 'training-sessions');
    this.ensureDir();
  }

  async create(params: CreateTrainingParams): Promise<TrainingSession> {
    const session: TrainingSession = {
      id: `training-${Date.now()}`,
      agentId: params.agentId,
      goal: params.goal,
      baseDataset: params.dataset,
      generatedTasks: [],
      maxRounds: params.maxRounds,
      status: 'running',
      progress: {
        currentRound: 0,
        totalRounds: params.maxRounds,
        startTime: Date.now()
      },
      results: []
    };

    await this.save(session);
    return session;
  }

  async save(session: TrainingSession): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<TrainingSession | null> {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  async list(): Promise<TrainingSession[]> {
    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const raw = fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8');
      return JSON.parse(raw);
    });
  }
}
```

---

### 3. HTTP API 设计

**文件**：`src/main/gateway/http/training.ts`

```typescript
/**
 * 训练相关 HTTP 路由
 */

export function registerTrainingRoutes(router: Router) {
  // 创建训练
  router.post('/training/sessions', async (ctx) => {
    const { agentId, goalName, maxRounds } = ctx.request.body;

    // 加载数据集
    const dataset = loadDataset(goalName);

    // 创建训练会话
    const session = await trainingStore.create({
      agentId,
      goal: { name: goalName, threshold: 80 },
      dataset,
      maxRounds
    });

    // 异步启动训练
    trainingExecutor.executeTraining(session).catch((err) => {
      console.error('[Training] 训练失败:', err);
    });

    ctx.body = { session };
  });

  // 获取训练列表
  router.get('/training/sessions', async (ctx) => {
    const sessions = await trainingStore.list();
    ctx.body = { sessions };
  });

  // 获取训练详情
  router.get('/training/sessions/:id', async (ctx) => {
    const session = await trainingStore.load(ctx.params.id);
    ctx.body = { session };
  });

  // 暂停训练
  router.post('/training/sessions/:id/pause', async (ctx) => {
    await trainingExecutor.pause(ctx.params.id);
    ctx.body = { success: true };
  });

  // 恢复训练
  router.post('/training/sessions/:id/resume', async (ctx) => {
    await trainingExecutor.resume(ctx.params.id);
    ctx.body = { success: true };
  });

  // 停止训练
  router.post('/training/sessions/:id/stop', async (ctx) => {
    await trainingExecutor.stop(ctx.params.id);
    ctx.body = { success: true };
  });
}
```

---

## 实施优先级

### P0（必须实现）

1. ✅ 3 个 Agent 定义（data-generator, evaluator, coach）
2. ✅ AgentDelegator（统一委托层）
3. ✅ TrainingExecutor（增强版，支持教练）
4. ✅ TrainingSessionStore（会话持久化）
5. ✅ 基础 UI（TrainingView）

### P1（重要但可延后）

1. 实时进度推送（training:progress 事件）
2. 暂停/恢复功能
3. 简单的图表（得分曲线）

### P2（可选）

1. 训练模板功能
2. 自定义训练目标
3. 数据集管理界面

---

## 预期成果

### 功能性

- ✅ 可通过 UI 创建和管理训练
- ✅ 实时查看训练进度
- ✅ 动态数据生成（数据集用完后自动生成）
- ✅ 训练教练提供改进建议
- ✅ 支持暂停和恢复

### 性能

- 单轮训练耗时：~10-15 秒（3-5 次 Agent 调用）
- 100 轮训练耗时：~20-25 分钟
- 成本：~$0.1-0.3（使用 deepseek-chat）

### 体验

- ✅ 可视化界面，易于操作
- ✅ 实时反馈，训练过程可观测
- ✅ 报告详细，效果可追溯

---

## 与下策对比

| 功能       | 下策（基础） | 中策（平衡） |
| ---------- | ------------ | ------------ |
| 启动方式   | 命令行       | UI + API     |
| 数据生成   | 静态 50 个   | 动态生成     |
| 改进机制   | 简单重试     | 训练教练     |
| 进度监控   | 日志         | 实时 UI      |
| 暂停/恢复  | ❌           | ✅           |
| 预期工作量 | 2 周         | 6-8 周       |
| 用户体验   | 基础         | 良好         |

---

## 风险和缓解

### 风险 1：Agent 调用链过长

- **风险**：3-5 个 Agent 串行调用，失败率高
- **缓解**：统一的超时和重试机制（AgentDelegator）

### 风险 2：动态生成的任务质量不稳定

- **风险**：training-data-generator 可能生成不合理的任务
- **缓解**：前 50 轮使用手动数据集，后续才生成；定期人工审查生成的任务

### 风险 3：UI 开发工作量可能超预期

- **风险**：实时更新、图表等功能复杂
- **缓解**：简化 UI，先实现核心功能，图表可用简单的 ASCII 图或第三方库

---

**方案状态**：设计完成，待实施
**预期工作量**：6-8 周
**预期成本**：~$5（API 调用 + 测试）
**风险等级**：中
**推荐指数**：⭐⭐⭐⭐（平衡性价比）
