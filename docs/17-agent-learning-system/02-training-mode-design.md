# 智能体训练模式 - 需求分析与设计文档

> **核心理念**：训练是专门的、独立的、程序驱动的智能体强化过程，与日常使用完全解耦。

---

## 讨论记录

### 讨论时间

2026-03-10

### 关键决策

#### 决策 1：架构原则 - 不直接调用 LLM API

**原则**：所有涉及 LLM 的操作，都必须通过 Agent（long time 模式，即 Agent 模式）来完成，不允许直接调用 LLM API。

**理由**：

1. **统一性**：所有 LLM 交互走同一套流程，避免混乱
2. **可追溯性**：每次 LLM 调用都是一个 Thread，有完整的会话记录
3. **可控性**：每个 Agent 都有明确的 instructions，行为可控
4. **可扩展性**：需要新能力时，创建新 Agent 即可

**影响**：

- 训练循环中的所有 LLM 操作（数据生成、评估、教练建议）都需要委托给专门的 Agent
- 需要设计多个专职 Agent 来支撑训练流程

#### 决策 2：训练数据生成策略

**策略**：用户提供基础数据集（种子数据），需要扩充时通过 Agent 生成更多训练数据。

**理由**：

1. 用户提供的基础数据集质量高、有代表性
2. Agent 可以基于基础数据集生成变体，保持一致性
3. 灵活性强，可以根据训练进度动态生成针对性任务

**影响**：

- 需要创建"训练数据生成 Agent"（training-data-generator）
- 基础数据集需要设计合理的格式和结构

---

## 1. 核心概念

### 1.1 什么是训练模式？

**训练模式**是一个独立的功能模块，让智能体在一个**受控的环境**中，通过**大量重复练习**和**持续优化**，提升特定能力。

**类比**：

- ❌ **不是**：边工作边学习（日常使用中顺便积累经验）
- ✅ **而是**：专门的训练课程（集中时间、专项训练、量化评估）

### 1.2 训练 vs 日常使用

| 维度         | 日常使用          | 训练模式                 |
| ------------ | ----------------- | ------------------------ |
| **目的**     | 完成用户任务      | 提升智能体能力           |
| **触发方式** | 用户发起          | 程序驱动                 |
| **执行次数** | 1 次              | 1000+ 次                 |
| **评估方式** | 用户满意度        | 量化指标（分数、错误率） |
| **数据存储** | Workspace（临时） | Agent Home（持久）       |
| **失败处理** | 返回错误给用户    | 分析原因，自动改进       |

### 1.3 训练的价值

1. **可控性**：程序驱动，不依赖 LLM 主动性
2. **可重复**：同样的训练任务可以重复执行成千上万次
3. **可量化**：每次训练都有明确的分数和改进方向
4. **可追溯**：完整记录训练过程和效果曲线
5. **专注性**：不受日常任务干扰，专心提升某一项能力

---

## 2. 训练模式的核心要素

### 2.1 训练目标（What to train）

**定义方式**：基于 `dimension-architect` Skill

**示例**：训练"代码生成"能力

```yaml
训练目标：代码生成能力
评估维度：
- 代码质量 (40%)
- 正确性：代码能否正确运行 (15%)
- 可读性：命名规范、注释清晰 (10%)
- 效率：时间复杂度、空间复杂度 (10%)
- 安全性：是否有安全漏洞 (5%)

- 响应速度 (20%)
- 首次响应时间 < 3s (10%)
- 完整输出时间 < 10s (10%)

- 用户体验 (20%)
- 代码结构清晰 (10%)
- 错误处理完善 (10%)

- 知识运用 (20%)
- 技术选型合理 (10%)
- 最佳实践应用 (10%)

总分：100 分
达标线：80 分
```

**特点**：

- ✅ 量化、可评估
- ✅ 有权重、有优先级
- ✅ 有达标线

---

### 2.2 训练数据集（What to practice）

**来源**：

#### 方案 A：合成数据集

- 程序生成训练任务
- 例如："实现一个快速排序算法"、"实现一个 LRU 缓存"
- 优点：可控、无限量
- 缺点：可能不够真实

#### 方案 B：真实任务回放

- 从历史任务中提取
- 例如：用户曾经问过的问题
- 优点：真实场景
- 缺点：数量有限、可能有隐私问题

#### 方案 C：混合模式（推荐）

- 基础训练：合成数据集（大量、覆盖基础能力）
- 高级训练：真实任务回放（少量、针对性强）

**数据集结构**：

```typescript
interface TrainingTask {
  id: string;
  type: 'synthetic' | 'real';
  category: string; // 'code-generation' | 'problem-solving' | 'debugging'
  difficulty: 1 | 2 | 3 | 4 | 5; // 难度等级
  description: string; // 任务描述
  expectedOutput?: string; // 期望输出（如果有标准答案）
  evaluationCriteria: DimensionCriteria; // 评估标准
  tags: string[]; // 标签（用于过滤和检索）
}
```

---

### 2.3 训练循环（How to train）

**核心流程**：基于 `eval-refine-loop` Skill

```
第 i 轮训练：
  1. 从数据集中抽取训练任务
  2. 让智能体执行任务
  3. 基于评估维度打分
  4. 如果未达标：
     a. 分析差距（哪些维度不足）
     b. 生成优化指令
     c. 让智能体改进
     d. 重新评估
  5. 记录本轮结果
  6. 判断是否继续：
     - 如果达到总训练次数 → 结束
     - 如果连续 N 轮达标 → 提前结束
     - 否则 → 继续下一轮
```

**伪代码**：

```typescript
async function trainAgent(agentId: string, trainingGoal: TrainingGoal, dataset: TrainingTask[], maxRounds: number) {
  const results: TrainingResult[] = [];
  let consecutiveSuccess = 0;

  for (let round = 1; round <= maxRounds; round++) {
    // 1. 抽取训练任务
    const task = selectTask(dataset, round);

    // 2. 执行任务
    const output = await executeAgent(agentId, task.description);

    // 3. 评估（基于 dimension-architect 的维度）
    const evaluation = await evaluateOutput(output, task.evaluationCriteria);

    // 4. 如果未达标，触发改进循环
    if (evaluation.score < trainingGoal.threshold) {
      const refinedOutput = await evalRefineLoop(output, evaluation, task);
      evaluation = await evaluateOutput(refinedOutput, task.evaluationCriteria);
      consecutiveSuccess = 0;
    } else {
      consecutiveSuccess++;
    }

    // 5. 记录结果
    results.push({
      round,
      taskId: task.id,
      score: evaluation.score,
      dimensions: evaluation.dimensions,
      passed: evaluation.score >= trainingGoal.threshold
    });

    // 6. 提前终止条件：连续 10 轮达标
    if (consecutiveSuccess >= 10) {
      console.log(`训练提前结束：连续 ${consecutiveSuccess} 轮达标`);
      break;
    }

    // 7. 进度报告
    reportProgress(round, maxRounds, results);
  }

  // 8. 生成训练报告
  return generateTrainingReport(results);
}
```

---

### 2.4 训练结果固化（How to persist）

**目标**：将训练成果永久保存到 Agent 定义和 Agent Home

#### 固化内容

1. **Agent 定义更新**（`agents/{agentId}.json`）
   - 更新 `instructions`：根据训练中发现的有效模式，优化指令
   - 更新 `skills`：添加训练中证明有用的 skills
   - 更新 `metadata`：记录训练历史

2. **Agent Home 数据**（`homes/{agentId}/`）
   - `training-history/`：训练记录
     - `{date}_{goal}.json`：每次训练的详细数据
     - `progress.json`：能力进化曲线
   - `knowledge/`：训练中积累的知识
     - `best-practices.md`：最佳实践
     - `common-mistakes.md`：常见错误
     - `optimization-patterns.md`：优化模式

3. **Brain/Tavern 同步**（可选）
   - 将训练中的优秀案例写入智库
   - 供其他智能体学习

#### 固化时机

- ✅ **训练完成后**：立即固化
- ✅ **达到阶段性目标**：每完成 100 轮，固化一次
- ✅ **手动触发**：用户可以随时保存当前状态

---

## 3. 训练模式的 UI 设计

### 3.1 训练视图（Training View）

**路由**：`/training`

**主要区域**：

```
┌─────────────────────────────────────────────────────────┐
│  Training Dashboard                        [New Training]│
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ 进行中训练   │  │ 历史训练     │  │ 训练模板     │     │
│  │   2 个      │  │   15 个      │  │   5 个       │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                           │
│  训练列表：                                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │ [运行中] 代码生成能力训练                           │  │
│  │   进度: 450/1000 (45%)                             │  │
│  │   当前得分: 78/100                                  │  │
│  │   预计剩余: 2h 30m                                  │  │
│  │   [查看详情] [暂停] [停止]                          │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ [已完成] 问题分析能力训练                           │  │
│  │   完成时间: 2026-03-09 18:30                       │  │
│  │   最终得分: 85/100                                  │  │
│  │   训练轮次: 800/1000 (提前达标)                     │  │
│  │   [查看报告]                                        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

### 3.2 创建训练（New Training）

**步骤**：

#### 步骤 1：选择智能体

- 从列表中选择要训练的智能体
- 显示智能体当前的能力评分（如果有）

#### 步骤 2：定义训练目标

- **方式 A：使用模板**
  - 代码生成能力
  - 问题分析能力
  - 调试能力
  - 文档编写能力
- **方式 B：自定义**
  - 调用 `dimension-architect` Skill
  - 输入训练目标描述
  - 生成评估维度和权重

#### 步骤 3：选择数据集

- 合成数据集（推荐新手训练）
- 真实任务数据集（高级训练）
- 自定义数据集（上传）

#### 步骤 4：配置训练参数

- 训练轮次：1000（默认）
- 并发度：1（串行）或 2（并行）
- 达标线：80 分（默认）
- 提前终止条件：连续 10 轮达标

#### 步骤 5：开始训练

- 显示确认对话框
- 预估训练时间
- 点击"开始训练"

---

### 3.3 训练详情（Training Detail）

**实时显示**：

```
┌─────────────────────────────────────────────────────────┐
│  训练详情: 代码生成能力训练                   [暂停] [停止]│
├─────────────────────────────────────────────────────────┤
│                                                           │
│  基本信息:                                                │
│    智能体: app-copilot                                    │
│    训练目标: 代码生成能力                                 │
│    开始时间: 2026-03-10 10:00:00                         │
│    当前轮次: 450/1000 (45%)                              │
│    预计完成: 2026-03-10 16:30:00                         │
│                                                           │
│  实时指标:                                                │
│    当前得分: 78/100                                       │
│    平均得分: 72/100                                       │
│    最高得分: 92/100 (第 380 轮)                          │
│    达标率: 35% (158/450)                                 │
│                                                           │
│  能力曲线:                                                │
│  100 ┤                  ╭─╮                              │
│   90 ┤              ╭───╯ ╰╮                             │
│   80 ┤          ╭───╯      ╰─╮  ╭─                       │
│   70 ┤     ╭────╯            ╰──╯                        │
│   60 ┤ ╭───╯                                             │
│   50 ┼─────────────────────────────────────> 轮次        │
│       0   100  200  300  400  500                        │
│                                                           │
│  维度得分:                                                │
│    代码质量:   80/100  ████████░░ (↑ +5)                 │
│    响应速度:   85/100  ████████▌░ (↑ +2)                 │
│    用户体验:   70/100  ███████░░░ (↓ -3)                 │
│    知识运用:   75/100  ███████▌░░ (→  0)                 │
│                                                           │
│  最近任务:                                                │
│    #450: 实现二叉树层序遍历 → 78分 ✓                     │
│    #449: 实现快速排序 → 65分 ✗                           │
│    #448: 实现LRU缓存 → 88分 ✓                            │
│                                                           │
│  [查看完整日志]                                           │
└─────────────────────────────────────────────────────────┘
```

---

### 3.4 训练报告（Training Report）

**训练完成后生成**：

```markdown
# 训练报告：代码生成能力训练

## 基本信息

- 智能体: app-copilot
- 训练目标: 代码生成能力
- 开始时间: 2026-03-10 10:00:00
- 结束时间: 2026-03-10 14:30:00
- 总耗时: 4h 30m

## 训练结果

- 训练轮次: 800/1000（提前达标）
- 最终得分: 85/100
- 平均得分: 76/100
- 达标率: 68% (544/800)

## 能力提升

| 维度     | 初始 | 最终 | 提升  |
| -------- | ---- | ---- | ----- |
| 代码质量 | 60   | 82   | +22 ↑ |
| 响应速度 | 70   | 85   | +15 ↑ |
| 用户体验 | 55   | 78   | +23 ↑ |
| 知识运用 | 65   | 80   | +15 ↑ |

## 关键发现

1. **优势能力**：响应速度表现优异，平均 85 分
2. **待提升**：用户体验初期较弱（55 分），后期明显改善
3. **稳定性**：第 300 轮后，得分波动减小，趋于稳定

## 优秀案例（Top 5）

1. #380: 实现红黑树 → 92分
2. #521: 实现Trie树 → 91分
3. #648: 实现B+树 → 90分
4. #712: 实现并查集 → 89分
5. #755: 实现KMP算法 → 88分

## 常见错误（Top 3）

1. 边界条件处理不当（出现 45 次）
2. 时间复杂度未优化（出现 32 次）
3. 错误处理缺失（出现 28 次）

## 优化建议

- ✅ 已固化：将"边界检查清单"加入 instructions
- ✅ 已固化：优化算法选择逻辑
- 📋 建议：增加更多关于错误处理的训练任务
```

---

## 4. Agent 分工体系（基于决策 1）

基于"不直接调用 LLM API"的原则，训练系统中所有涉及 LLM 的操作都委托给专门的 Agent。

### 4.1 Agent 角色设计

```
训练系统 (程序驱动，负责调度和流程控制)
  ↓
  ├─ 训练数据生成 Agent (training-data-generator)
  │    职责：根据基础数据集，生成更多训练任务
  │    输入：基础数据集 + 生成规则 + 当前轮次
  │    输出：新的训练任务（JSON 格式）
  │    技能：dimension-architect
  │
  ├─ 被训练的 Agent (如 app-copilot)
  │    职责：执行训练任务（这就是我们要训练的目标）
  │    输入：任务描述
  │    输出：任务结果
  │    技能：根据 Agent 定义
  │
  ├─ 评估 Agent (training-evaluator)
  │    职责：客观评估任务执行结果
  │    输入：任务描述 + 执行结果 + 评估标准
  │    输出：分数 + 各维度评分 + 详细反馈（JSON 格式）
  │    技能：dimension-architect, eval-refine-loop
  │    工具：exec（用于运行代码测试）, read
  │
  └─ 训练教练 Agent (training-coach)
       职责：分析评估结果，给出优化建议
       输入：任务 + 执行结果 + 评估结果
       输出：改进建议（具体、可操作）
       技能：self-reflection, eval-refine-loop
```

### 4.2 Agent 调用流程

```typescript
// 伪代码：完全基于 Agent 的训练流程
class TrainingExecutor {
  async executeTrainingRound(session: TrainingSession, round: number): Promise<TrainingResult> {
    // 1. 获取或生成训练任务（通过 Agent）
    const task = await this.getTask(session, round);

    // 2. 执行任务（通过被训练的 Agent）
    const output = await this.executeTask(session.agentId, task);

    // 3. 评估结果（通过评估 Agent）
    const evaluation = await this.evaluateOutput(task, output);

    // 4. 如果未达标，获取改进建议（通过教练 Agent）
    if (evaluation.score < session.goal.threshold) {
      const advice = await this.getCoachAdvice(task, output, evaluation);

      // 5. 基于建议重新执行（通过被训练的 Agent）
      const refinedOutput = await this.refineTask(session.agentId, task, advice);

      // 6. 重新评估
      evaluation = await this.evaluateOutput(task, refinedOutput);
    }

    return { round, task, evaluation };
  }

  // ==================== Agent 委托方法 ====================

  /**
   * 通过"数据生成 Agent"生成训练任务
   */
  private async generateTaskByAgent(baseDataset: any): Promise<TrainingTask> {
    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-data-generator',
      userMessage: `基于基础数据集生成 1 个新训练任务：\n${JSON.stringify(baseDataset)}`,
      metadata: { isTrainingTask: true }
    });
    return JSON.parse(result.content);
  }

  /**
   * 通过"被训练的 Agent"执行任务
   */
  private async executeTask(agentId: string, task: TrainingTask): Promise<string> {
    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId,
      userMessage: task.description,
      metadata: { isTrainingExecution: true }
    });
    return result.content;
  }

  /**
   * 通过"评估 Agent"评估结果
   */
  private async evaluateOutput(task: TrainingTask, output: string): Promise<Evaluation> {
    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-evaluator',
      userMessage: `评估任务：\n任务：${task.description}\n输出：${output}\n标准：${JSON.stringify(task.criteria)}`,
      metadata: { isTrainingEvaluation: true }
    });
    return JSON.parse(result.content);
  }

  /**
   * 通过"训练教练 Agent"获取优化建议
   */
  private async getCoachAdvice(task: TrainingTask, output: string, evaluation: Evaluation): Promise<string> {
    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-coach',
      userMessage: `分析并给出改进建议：\n任务：${task.description}\n输出：${output}\n评估：${JSON.stringify(evaluation)}`,
      metadata: { isTrainingCoach: true }
    });
    return result.content;
  }
}
```

### 4.3 需要创建的 Agent 定义

#### Agent 1: training-data-generator (训练数据生成器)

```json
{
  "id": "training-data-generator",
  "name": "训练数据生成器",
  "description": "根据基础数据集和规则，生成新的、多样化的训练任务",
  "instructions": "详见后续方案设计",
  "skills": ["dimension-architect"],
  "tools": ["read", "write"]
}
```

#### Agent 2: training-evaluator (训练评估器)

```json
{
  "id": "training-evaluator",
  "name": "训练评估器",
  "description": "客观评估训练任务的执行结果，给出量化分数和反馈",
  "instructions": "详见后续方案设计",
  "skills": ["dimension-architect", "eval-refine-loop"],
  "tools": ["exec", "read"]
}
```

#### Agent 3: training-coach (训练教练)

```json
{
  "id": "training-coach",
  "name": "训练教练",
  "description": "分析训练结果，给出具体的改进建议",
  "instructions": "详见后续方案设计",
  "skills": ["self-reflection", "eval-refine-loop"],
  "tools": []
}
```

---

## 5. 待讨论的关键问题

### 5.1 数据生成 Agent 的触发时机

**问题**：什么时候需要生成新数据？

**方案**：

- **方案 A**：每轮都生成（最灵活，但慢，成本高）
- **方案 B**：基础数据集用完后才生成（高效）
- **方案 C**：根据表现动态生成（智能，如连续多轮在某个维度失败，生成针对性任务）

**待决策**：选择哪个方案？

---

### 5.2 评估 Agent 如何保证客观性

**问题**：LLM 作为评审可能存在主观性或不一致

**方案**：

- **代码类任务**：评估 Agent 使用 `exec` 工具运行测试用例（客观）
- **文本类任务**：
  - 多次评估取平均值
  - 使用更强的模型作为 judge（如 GPT-4o）
  - 结合自动化指标（长度、关键词覆盖率）

**待决策**：如何平衡客观性和成本？

---

### 5.3 训练教练 Agent 的建议如何应用

**问题**：教练给出建议后，如何让被训练的 Agent 真正改进？

**方案 A**：在 refinement 时，将建议放入 prompt

```typescript
userMessage: `
  重新执行任务：${task.description}
  
  教练的改进建议：
  ${coachAdvice}
  
  请基于建议改进输出。
`;
```

**方案 B**：根据建议，动态修改被训练 Agent 的 instructions（更激进，但效果可能更持久）

**待决策**：短期改进（方案 A）还是长期改进（方案 B）？

---

### 5.4 如何避免 Agent 调用链过长导致的问题

**问题**：

```
训练系统 → 数据生成 Agent → 被训练 Agent → 评估 Agent → 教练 Agent → 被训练 Agent (refine)
```

调用链长，中间任何环节失败都会影响训练。

**风险**：

- 某个 Agent 超时
- 某个 Agent 输出格式错误（JSON 解析失败）
- 某个 Agent 工具调用失败

**方案**：

- 每个 Agent 调用都有**超时机制**（如 30s）
- 每个 Agent 调用都有**重试机制**（最多 3 次）
- 记录每个环节的结果，便于调试
- 提供"快速失败"选项（某个环节失败直接跳过这一轮，不阻塞后续训练）

**待决策**：超时时间、重试次数？

---

### 5.5 训练成本控制

**问题**：1000 轮训练，每轮可能涉及 3-5 次 Agent 调用，总成本可能很高。

**估算**（以 deepseek-chat 为例）：

- 单次 Agent 调用：~1000 tokens 输入 + 500 tokens 输出
- 每轮训练：3-5 次调用 = 4500-7500 tokens
- 1000 轮训练：450 万 - 750 万 tokens
- 成本：约 $0.6 - $1.0（deepseek-chat）
- 如果用 GPT-4：约 $30 - $50

**方案**：

1. 使用成本低的模型（如 deepseek-chat）作为默认
2. 提供"快速训练模式"（100 轮）和"完整训练模式"（1000 轮）
3. 设置预算上限（如每次训练最多 $10）
4. 支持暂停和恢复（避免一次性消耗太多）

**待决策**：默认模型选择？预算上限？

---

### 5.6 训练结果固化策略

**问题**：训练完成后，如何将成果应用到 Agent？

**方案 A：直接修改 instructions**（激进）

- 优点：立即生效
- 缺点：可能破坏原有能力，不可回滚

**方案 B：版本化管理**（推荐）

- 训练完成后创建新版本：`app-copilot-v2`
- 保留旧版本，可随时切换
- 优点：安全、可回滚
- 缺点：需要版本管理机制

**方案 C：只记录不修改**（保守）

- 训练数据存到 Agent Home
- 不修改 Agent 定义
- 用户手动决定是否应用
- 优点：最安全
- 缺点：训练效果不会自动生效

**待决策**：选择哪个方案？

---

## 6. 技术实现方案

### 6.1 核心模块

### 4.2 关键类型

```typescript
// 训练会话
interface TrainingSession {
  id: string;
  agentId: string;
  goal: TrainingGoal;
  dataset: TrainingTask[];
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress: {
    currentRound: number;
    totalRounds: number;
    startTime: number;
    estimatedEndTime?: number;
  };
  results: TrainingResult[];
  metadata: Record<string, unknown>;
}

// 训练目标
interface TrainingGoal {
  name: string;
  description: string;
  dimensions: DimensionCriteria; // from dimension-architect
  threshold: number; // 达标分数线
  earlyStopCondition?: {
    consecutiveSuccess: number; // 连续达标 N 轮提前结束
  };
}

// 训练结果
interface TrainingResult {
  round: number;
  taskId: string;
  startTime: number;
  endTime: number;
  output: string;
  evaluation: {
    score: number;
    dimensions: Record<string, number>;
    passed: boolean;
    feedback: string;
  };
  refinementAttempts?: number; // 改进尝试次数
}
```

### 4.3 执行流程

```typescript
class TrainingExecutor {
  async executeTraining(session: TrainingSession): Promise<void> {
    for (let round = 1; round <= session.progress.totalRounds; round++) {
      // 1. 选择任务
      const task = this.selectTask(session.dataset, round);

      // 2. 执行任务
      const output = await this.executeAgent(session.agentId, task);

      // 3. 评估
      const evaluation = await this.evaluate(output, task);

      // 4. 如果未达标，触发改进
      if (evaluation.score < session.goal.threshold) {
        await this.refineAndReevaluate(output, evaluation, task);
      }

      // 5. 记录结果
      session.results.push({
        round,
        taskId: task.id,
        startTime: Date.now(),
        endTime: Date.now(),
        output,
        evaluation
      });

      // 6. 更新进度
      await this.updateProgress(session);

      // 7. 检查提前终止
      if (this.shouldStop(session)) {
        break;
      }
    }

    // 8. 生成报告
    await this.generateReport(session);

    // 9. 固化结果
    await this.persistResults(session);
  }
}
```

---

## 5. 关键技术挑战

### 5.1 如何评估输出质量？

**问题**：如何客观评估智能体的输出？

**方案**：

1. **代码类任务**：
   - 运行测试用例（单元测试）
   - 静态代码分析（ESLint、TypeScript）
   - 性能基准测试

2. **文本类任务**：
   - 使用另一个 LLM 作为评审（judge LLM）
   - 基于 dimension-architect 的维度打分
   - 关键词匹配、长度检查

3. **复合任务**：
   - 混合评估（自动化 + LLM 评审）

---

### 5.2 如何防止过拟合？

**问题**：训练数据集有限，智能体可能只是记住答案，而不是真正学会

**方案**：

1. **数据集多样化**
   - 同一类型任务，生成多个变体
   - 定期更新数据集

2. **测试集验证**
   - 训练集 vs 测试集（80% vs 20%）
   - 定期在测试集上评估泛化能力

3. **难度递进**
   - 从简单到复杂
   - 根据表现动态调整难度

---

### 5.3 如何平衡训练速度和质量？

**问题**：1000 轮训练可能需要很长时间

**方案**：

1. **并行训练**
   - 简单任务可以并行（N=2 或 N=3）
   - 复杂任务串行（N=1）

2. **智能采样**
   - 前 100 轮：覆盖所有类型
   - 中期：重点训练弱项
   - 后期：随机抽样保持能力

3. **增量训练**
   - 不是每次从零开始
   - 基于上次训练结果继续

---

## 6. 待讨论的关键问题

### 6.1 训练目标的粒度？

- **粗粒度**：通用能力（如"代码生成"）
- **细粒度**：特定技能（如"React 组件开发"）

**建议**：先从粗粒度开始，逐步细化

---

### 6.2 训练数据从何而来？

- **方案 A**：手动编写（高质量，但工作量大）
- **方案 B**：LLM 生成（快速，但质量不稳定）
- **方案 C**：爬取公开数据集（如 LeetCode）

**建议**：混合模式（手动 + LLM 生成 + 公开数据）

---

### 6.3 训练的计算资源如何控制？

- 训练可能消耗大量 API 调用
- 如何限制成本？

**方案**：

- 设置预算上限（如每次训练最多 $10）
- 提供"快速训练模式"（100 轮）和"完整训练模式"（1000 轮）

---

### 6.4 如何衡量"训练效果"？

- 绝对分数提升？（从 60 → 80）
- 稳定性提升？（波动从 ±20 → ±5）
- 达标率提升？（从 30% → 70%）

**建议**：综合评估（所有指标都考虑）

---

### 6.5 训练结果如何固化到 Agent？

- 直接修改 `instructions`？（可能破坏原有能力）
- 创建新版本 Agent？（保留历史）
- 只记录训练数据，不修改 Agent？（保守）

**建议**：版本化管理（`v1` → `v2`），可回滚

---

## 7. 实施路线图

### 阶段 1：MVP（最小可行产品）

- [ ] 实现基础训练循环（100 轮）
- [ ] 支持 1 种训练目标（代码生成）
- [ ] 合成数据集（50 个任务）
- [ ] 简单评估器（基于测试用例）
- [ ] 文本报告（Markdown）

**预期时间**：2-3 周

---

### 阶段 2：功能完善

- [ ] UI 界面（Training View）
- [ ] 支持多种训练目标（3-5 个）
- [ ] 数据集扩充（500+ 任务）
- [ ] 高级评估器（LLM judge）
- [ ] 可视化报告（图表）

**预期时间**：4-6 周

---

### 阶段 3：高级特性

- [ ] 并行训练
- [ ] 增量训练
- [ ] 测试集验证
- [ ] 训练历史对比
- [ ] 自动数据集生成

**预期时间**：6-8 周

---

## 8. 参考资料

### 技能包

- `dimension-architect`：定义训练目标
- `eval-refine-loop`：评估-改良循环
- `self-reflection`：自我评估

### 类似系统

- OpenAI Fine-tuning
- Anthropic Constitutional AI
- Google RLHF (Reinforcement Learning from Human Feedback)

---

## 9. 实施方案（上策、中策、下策）

基于上述讨论和分析，我们设计了三个实施方案，供决策选择：

### 📄 [下策（基础方案）](./05-implementation-plan-basic.md)

- **定位**：最简单、最快实现，验证核心概念
- **工作量**：2 周
- **功能**：命令行启动、静态数据集（50 个任务）、基础评估、文本报告
- **适用场景**：快速验证可行性、概念验证
- **推荐指数**：⭐⭐⭐

### 📄 [中策（平衡方案）](./04-implementation-plan-medium.md)

- **定位**：功能完善、性能平衡
- **工作量**：6-8 周
- **功能**：UI 界面、动态数据生成、训练教练、暂停/恢复
- **适用场景**：实际应用、长期使用
- **推荐指数**：⭐⭐⭐⭐（**推荐**）

### 📄 [上策（完整方案）](./03-implementation-plan-best.md)

- **定位**：功能最全、自动化程度最高
- **工作量**：15-20 周
- **功能**：并行训练、测试集验证、增量训练、版本管理、分布式（可选）
- **适用场景**：大规模训练、企业级需求
- **推荐指数**：⭐⭐⭐⭐⭐（功能最全，但需要充足资源）

### 推荐决策路径

```
阶段 1：下策（2 周）
  ↓ 验证核心概念可行性
  ↓ 获得真实训练数据

阶段 2：评估
  ↓ 效果明显？成本可控？

阶段 3：中策（6-8 周）
  ↓ 提供完整体验
  ↓ 验证动态数据生成和训练教练

阶段 4：再次评估
  ↓ 需要更大规模？

阶段 5：上策（15-20 周）
  ✓ 企业级训练平台
```

---

**文档状态**：需求分析完成，三个方案已设计
**创建时间**：2026-03-10
**最后更新**：2026-03-10（讨论记录和实施方案）
