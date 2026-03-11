# 技能包训练架构设计 v2.0

> **撰写时间**: 2026-03-10  
> **版本**: 2.0（架构重构）  
> **核心转变**: 从"训练智能体"到"训练技能包"

---

## 🎯 核心认知转变

### 原来的设计（v1.0）

```
训练对象：智能体（如 app-copilot）
训练目的：提升智能体能力
训练成果：更新 agent.json 的 instructions

问题：
  ❌ 智能体是无状态的（每次调用大模型都是独立的）
  ❌ instructions 只是"提示词"，不是真正的"能力"
  ❌ 训练成果很难量化和验证
```

### 新的设计（v2.0）

```
训练对象：技能包（如 experience-manager）
训练目的：让技能包按其规则积累数据
训练成果：skill-data/{skill-name}/ 目录下的结构化数据

优势：
  ✅ 技能包有明确的数据格式和规则
  ✅ 数据积累是可见的、可量化的
  ✅ 任何使用该技能包的智能体都受益
  ✅ 符合系统已有的 skill-data/ 架构
```

---

## 🏗️ 架构设计

### 核心概念

**技能包（Skill）**：

- 一套操作规则和数据格式定义
- 例如：experience-manager 定义了"问题-解决方案"的三层结构
- 技能包会产生数据（按其规则）

**技能包数据（skill-data/）**：

- 存储位置：`{agentHome}/skill-data/{skill-name}/`
- 按技能包的规则组织
- 跨会话持久化
- 任何智能体使用该技能包时都可以访问

**训练 = 让技能包积累更多数据**：

- 不是改变智能体，而是丰富技能包的数据库
- 数据越多，技能包"能力"越强

---

## 🔄 完整训练流程

### 阶段 0：用户发起训练

**用户界面（CreateTrainingDialog.vue）**：

```
┌─────────────────────────────────────────┐
│  创建技能包训练                          │
├─────────────────────────────────────────┤
│                                          │
│  选择技能包：                            │
│    [v] experience-manager               │
│                                          │
│  训练目标（口述）：                      │
│    [ 提升经验管理的准确性和完整性 ]      │
│                                          │
│  使用智能体（执行者）：                  │
│    [v] app-copilot                      │
│                                          │
│  数据源类型：                            │
│    ( ) 静态数据集                        │
│    (•) 知识库  ← 选中                   │
│    ( ) 历史会话                          │
│                                          │
│  知识库路径：                            │
│    [v] brain/problem-solving            │
│                                          │
│  训练轮次：                              │
│    [ 100 ]                              │
│                                          │
│  训练策略：                              │
│    [v] sequential（串行）               │
│                                          │
│  [ 取消 ]  [ 开始训练 ]                 │
└─────────────────────────────────────────┘
```

**发送到后端**：

```json
{
  "targetType": "skill",
  "skillName": "experience-manager",
  "executorAgentId": "app-copilot",
  "goalDescription": "提升经验管理的准确性和完整性",
  "dataSource": {
    "type": "knowledge-base",
    "path": "brain/problem-solving"
  },
  "maxRounds": 100,
  "strategy": "sequential"
}
```

---

### 阶段 1：生成训练目标

**后端处理**（`src/main/training/GoalGenerator.ts`）：

```typescript
class GoalGenerator {
  /**
   * 基于用户口述生成训练目标
   */
  async generateGoal(description: string, skillName: string): Promise<TrainingGoal> {
    // 1. 读取技能包定义，了解其数据格式
    const skillDef = await this.loadSkillDefinition(skillName);

    // 2. 调用 dimension-architect 技能
    const prompt = `
为技能包"${skillName}"生成训练目标。

用户描述：${description}

技能包说明：
${skillDef.description}

技能包产生的数据格式：
${this.extractDataFormat(skillDef)}

请生成完整的训练目标定义，包括：
- 评估维度（基于技能包的数据格式）
- 每个维度的量化标准
- 权重分配
- 达标阈值

输出 JSON 格式。
    `;

    const result = await this.callDimensionArchitect(prompt);
    return JSON.parse(result);
  }
}
```

**输出示例**：

```json
{
  "name": "经验管理能力（experience-manager）",
  "skillName": "experience-manager",
  "dimensions": [
    {
      "name": "format-correctness",
      "label": "格式正确性",
      "description": "生成的经验是否符合技能包定义的三层结构",
      "weight": 30,
      "criteria": "problem.md + solutions/*.md 格式规范，包含必需的元数据"
    },
    {
      "name": "solution-quality",
      "label": "解决方案质量",
      "description": "方案是否可行、详细、可复现",
      "weight": 40,
      "criteria": "包含具体实现步骤、推导过程、代码示例"
    },
    {
      "name": "categorization",
      "label": "分类准确性",
      "description": "问题分类和标签是否合理",
      "weight": 20,
      "criteria": "类别选择恰当，标签覆盖关键概念"
    },
    {
      "name": "reusability",
      "label": "可复用性",
      "description": "经验是否具有通用性，可应用到类似场景",
      "weight": 10,
      "criteria": "场景描述清晰，解决方案可迁移"
    }
  ],
  "threshold": 75
}
```

---

### 阶段 2：生成训练数据（从知识库）

**后端处理**（`src/main/training/data-sources/KnowledgeBaseDataSource.ts`）：

```typescript
class KnowledgeBaseDataSource {
  /**
   * 从知识库生成训练任务（分批）
   */
  async generate(params: {
    knowledgeBasePath: string;
    skillName: string;
    goal: TrainingGoal;
    totalCount: number;
  }): Promise<TrainingDataset> {
    const trainCount = Math.floor(params.totalCount * 0.8); // 80%
    const testCount = params.totalCount - trainCount; // 20%

    const trainSet: TrainingTask[] = [];
    const testSet: TrainingTask[] = [];

    // 分批生成（每次 30 个）
    const batchSize = 30;
    let generated = 0;

    while (generated < params.totalCount) {
      const count = Math.min(batchSize, params.totalCount - generated);
      const isTestSet = generated >= trainCount;

      const batch = await this.generateBatch({
        knowledgeBasePath: params.knowledgeBasePath,
        skillName: params.skillName,
        goal: params.goal,
        count,
        existingTasks: [...trainSet, ...testSet], // 避免重复
        isTestSet
      });

      if (isTestSet) {
        testSet.push(...batch);
      } else {
        trainSet.push(...batch);
      }

      generated += batch.length;

      if (batch.length === 0) {
        // Agent 无法继续生成，终止
        break;
      }
    }

    return {
      name: `${params.skillName} 训练集（从 ${params.knowledgeBasePath}）`,
      version: '1.0.0',
      category: params.skillName,
      sourceType: 'knowledge-base',
      sourcePath: params.knowledgeBasePath,
      trainSet,
      testSet
    };
  }

  /**
   * 调用 Agent 生成一批任务
   */
  private async generateBatch(params: {
    knowledgeBasePath: string;
    skillName: string;
    goal: TrainingGoal;
    count: number;
    existingTasks: TrainingTask[];
    isTestSet: boolean;
  }): Promise<TrainingTask[]> {
    const prompt = `
请从知识库"${params.knowledgeBasePath}"中提取内容，生成 ${params.count} 个训练任务。

训练对象：${params.skillName} 技能包
训练目标：${params.goal.name}
评估维度：${params.goal.dimensions.map((d) => `${d.name}(${d.weight}%)`).join(', ')}

任务类型：${params.isTestSet ? '测试集' : '训练集'}

要求：
1. 每个任务是一个"使用 ${params.skillName} 技能包的场景"
2. 任务描述清晰，包含：
   - 场景背景
   - 具体要求（使用技能包生成符合格式的数据）
   - 期望输出格式
3. 难度分布：简单 30% / 中等 50% / 困难 20%
4. 避免与已有任务重复（已有 ${params.existingTasks.length} 个）

使用 read 工具读取知识库内容，然后生成任务列表（JSON 格式）。
    `;

    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-data-generator',
      userMessage: prompt,
      metadata: {
        isTrainingDataGen: true,
        skillName: params.skillName
      }
    });

    return this.parseTasksFromResult(result.content);
  }
}
```

---

### 阶段 3：执行训练（每条最多 3 次）

**核心逻辑**（`src/main/training/TrainingExecutor.ts` 修改）：

```typescript
class SkillTrainingExecutor {
  /**
   * 执行单轮训练（重试逻辑）
   */
  private async executeRound(session: SkillTrainingSession, round: number): Promise<TrainingRoundResult> {
    const task = session.dataset.trainSet[round - 1];
    const maxAttempts = 3; // 最多 3 次尝试

    const attempts: AttemptRecord[] = [];
    let finalOutput: string = '';
    let finalEvaluation: TrainingEvaluation | null = null;

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
      logger.info(`[Training] 第 ${round} 轮，第 ${attemptNo} 次尝试`);

      // 1. 执行任务（使用技能包）
      const output = await this.executeWithSkill(
        session.executorAgentId,
        session.skillName,
        task,
        attemptNo > 1 ? attempts[attemptNo - 2].coachAdvice : undefined
      );

      // 2. 质检
      const evaluation = await this.evaluator.evaluate(task, output, session.goal);

      // 3. 如果达标，保存技能包数据
      if (evaluation.passed) {
        await this.saveSkillData(session.agentHome, session.skillName, task, output, evaluation);
      }

      // 4. 记录本次尝试
      attempts.push({
        attemptNo,
        output,
        evaluation,
        coachAdvice: null
      });

      // 5. 如果达标，结束本轮
      if (evaluation.passed) {
        finalOutput = output;
        finalEvaluation = evaluation;
        break;
      }

      // 6. 如果未达标且未达最大次数，获取教练建议
      if (attemptNo < maxAttempts) {
        const advice = await this.coach.getAdvice(task, output, evaluation);
        attempts[attemptNo - 1].coachAdvice = advice;
      }
    }

    // 如果 3 次都失败，使用最后一次的结果
    if (!finalEvaluation) {
      finalOutput = attempts[attempts.length - 1].output;
      finalEvaluation = attempts[attempts.length - 1].evaluation;
    }

    return {
      round,
      taskId: task.id,
      attempts,
      finalScore: finalEvaluation.score,
      finalPassed: finalEvaluation.passed,
      totalAttempts: attempts.length,
      usedCoach: attempts.some((a) => a.coachAdvice !== null)
    };
  }

  /**
   * 执行任务时使用技能包
   */
  private async executeWithSkill(
    agentId: string,
    skillName: string,
    task: TrainingTask,
    coachAdvice?: CoachAdvice
  ): Promise<string> {
    let prompt = task.description;

    if (coachAdvice) {
      prompt += `\n\n**改进建议**：\n${coachAdvice.suggestions.join('\n')}`;
    }

    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId,
      userMessage: prompt,
      metadata: {
        isSkillTraining: true,
        skillName, // 标记使用的技能包
        taskId: task.id
      }
    });

    return result.content;
  }

  /**
   * 保存技能包数据到 skill-data/ 目录
   */
  private async saveSkillData(
    agentHome: string,
    skillName: string,
    task: TrainingTask,
    output: string,
    evaluation: TrainingEvaluation
  ): Promise<void> {
    const skillDataDir = path.join(agentHome, 'skill-data', skillName);

    // 根据技能包的规则保存数据
    if (skillName === 'experience-manager') {
      // experience-manager 的数据格式：problems/{id}/
      await this.saveExperienceManagerData(skillDataDir, task, output);
    } else if (skillName === 'dimension-architect') {
      // dimension-architect 的数据格式：templates/
      await this.saveDimensionArchitectData(skillDataDir, task, output);
    } else {
      // 通用格式
      await this.saveGenericSkillData(skillDataDir, task, output);
    }

    logger.info(`[Training] 技能包数据已保存: ${skillDataDir}`);
  }
}
```

---

### 阶段 4：训练报告生成

**报告内容**：

```markdown
# 技能包训练报告：experience-manager

**训练时间**：2026-03-10 14:30 - 16:15
**训练轮次**：100
**数据源**：brain/problem-solving（知识库）
**执行智能体**：app-copilot

## 训练配置

**训练目标**：提升经验管理的准确性和完整性

**评估维度**：

- format-correctness (30%): 格式正确性
- solution-quality (40%): 解决方案质量
- categorization (20%): 分类准确性
- reusability (10%): 可复用性

**达标阈值**：75 分

## 训练结果概览

- **总数据量**：100 条
- **成功数量**：82 条 (82%)
  - 首次成功：45 条 (45%)
  - 二次成功：30 条 (30%)
  - 三次成功：7 条 (7%)
- **失败数量**：18 条 (18%)

## 各维度表现

| 维度               | 平均分 | 通过率 | 评级    |
| ------------------ | ------ | ------ | ------- |
| format-correctness | 85     | 88%    | ✅ 优秀 |
| solution-quality   | 78     | 80%    | ✅ 良好 |
| categorization     | 82     | 85%    | ✅ 优秀 |
| reusability        | 75     | 75%    | ⚠️ 及格 |

## 技能包数据积累

**训练前**：

- skill-data/experience-manager/problems/ → 0 个问题

**训练后**：

- skill-data/experience-manager/problems/ → 82 个问题
- 每个问题包含：
  - problem.md（问题描述）
  - solutions/（1-3 个解决方案）

**数据增长**：+82 个可复用经验

## 每条数据详细结果

### task-001: 提取大文件处理经验

- 尝试次数：2
- 最终得分：82
- 结果：✅ 成功
- 问题：第 1 次缺少推导过程（第3层）
- 改进：第 2 次补充了"为什么选择流式读取"的推导
- 保存位置：skill-data/experience-manager/problems/P001-如何处理大文件/

### task-002: 提取查询优化经验

- 尝试次数：3
- 最终得分：72
- 结果：❌ 失败
- 问题：解决方案不够详细，缺少代码示例
- 建议：需要加强"solution-quality"维度训练

...（100 条记录）

## 弱点分析

**最弱维度**：reusability（平均 75 分，刚及格）

**失败原因分析**：

- 12 条：场景描述过于具体，缺乏通用性
- 6 条：解决方案依赖特定工具，可移植性差

**改进建议**：

- 针对 reusability 维度进行增量训练
- 补充"通用化经验提取"的知识库内容
- 增加"场景抽象能力"的训练

## 训练价值评估

**技能包能力提升**：

- 训练前：experience-manager 无历史数据
- 训练后：82 个问题的解决方案库
- 提升效果：从"空白"到"丰富"

**后续使用价值**：

- 任何智能体使用 experience-manager 时
- 可以参考这 82 个已有经验
- 提升经验提取的准确性和完整性
```

---

## 💾 数据存储约定

### skill-data/ 目录结构

```
{agentHome}/skill-data/
├── experience-manager/         # 技能包名称
│   ├── problems/               # 按技能包规则组织
│   │   ├── P001-xxx/
│   │   │   ├── problem.md
│   │   │   └── solutions/
│   │   │       └── S001-xxx.md
│   │   ├── P002-xxx/
│   │   └── ...
│   └── _index.md               # 自动生成的索引
│
├── dimension-architect/        # 另一个技能包
│   ├── templates/
│   │   ├── code-quality.json
│   │   └── ...
│   └── best-practices.md
│
└── {其他技能包}/
```

### 命名规范约定

**技能包 → 智能体约定**：

```
训练会话元数据：
  {
    "skillName": "experience-manager",
    "executorAgentId": "app-copilot",
    "agentHome": "~/coobee-data/homes/app-copilot"
  }

数据保存位置：
  {agentHome}/skill-data/{skillName}/

  即：~/coobee-data/homes/app-copilot/skill-data/experience-manager/
```

**关键点**：

- 技能包数据存在"执行者智能体"的 home 下
- 但按"技能包名称"分目录
- 任何智能体使用该技能包时，都访问自己 home 下的 skill-data/

---

## 🤖 智能体与技能包的关系

### 架构理解

```
智能体（Agent）：
  - 无状态的"执行者"
  - 定义：instructions + tools + skills
  - 每次调用都是独立的

技能包（Skill）：
  - 有状态的"知识库"
  - 定义：操作规则 + 数据格式
  - skill-data/ 目录持久化

关系：
  智能体"使用"技能包
    ↓
  智能体读取 skill-data/{skill-name}/ 的数据
    ↓
  根据技能包的规则处理
    ↓
  产生新的数据，保存回 skill-data/{skill-name}/
```

### 训练的本质

```
训练 = 批量使用技能包 → 产生大量数据 → 积累到 skill-data/

训练前：
  skill-data/experience-manager/ → 空目录

训练 100 轮后：
  skill-data/experience-manager/
  └── problems/
      ├── P001/
      ├── P002/
      └── ...（82个问题）

效果：
  下次任何智能体使用 experience-manager 时
    → 可以查询这 82 个已有经验
    → 提升经验提取的准确性
```

---

## ✅ 架构满足度分析

### 你的需求 vs 当前架构

| 需求                     | 当前架构                          | 满足度 |
| ------------------------ | --------------------------------- | ------ |
| 训练技能包（而非智能体） | ✅ skill-data/ 目录已存在         | 90%    |
| 技能包数据按规则存储     | ✅ 每个技能包独立目录             | 100%   |
| 大模型知道从哪读数据     | ⚠️ 需要在技能包指令中说明         | 80%    |
| 数据跨会话持久化         | ✅ skill-data/ 跨会话             | 100%   |
| 训练成果可量化           | ⚠️ 当前只有"评分"，需要统计数据量 | 70%    |

**总体满足度**：88%

**需要补充**：

1. 技能包的 SKILL.md 中明确说明数据存储路径
2. 训练报告中统计 skill-data/ 的数据增长
3. 提供"查看技能包数据"的 UI

---

## 🎯 设计优势

### 1. 架构自洽

✅ 完全符合系统已有的 skill-data/ 设计  
✅ 不需要创造新的存储机制  
✅ 与 experience-manager 等技能包无缝集成

### 2. 成果可见

✅ 训练前：`ls skill-data/experience-manager/` → 空  
✅ 训练后：`ls skill-data/experience-manager/` → 82 个问题  
✅ 成果量化：目录文件数量 = 训练成果

### 3. 自动生效

✅ 无需手动配置  
✅ 智能体使用技能包时自动读取 skill-data/  
✅ 数据越多，技能包"能力"越强

### 4. 通用性强

✅ 任何技能包都可以训练  
✅ 只要技能包有明确的数据格式  
✅ 训练逻辑可复用

---

## 🆚 关键差异对比

### v1.0 设计（旧）

```
训练对象：智能体（app-copilot）
成果位置：agent.json 的 instructions
成果形式：追加的文本
成果限制：instructions 会越来越长
使用方式：LLM 每次都读取 instructions

问题：
  ❌ 智能体是无状态的
  ❌ instructions 膨胀
  ❌ 成果不结构化
```

### v2.0 设计（新）

```
训练对象：技能包（experience-manager）
成果位置：skill-data/{skill-name}/
成果形式：结构化数据文件
成果限制：无限制（文件系统容量）
使用方式：技能包读取 skill-data/，按需查询

优势：
  ✅ 技能包有明确的数据格式
  ✅ 数据结构化存储
  ✅ 成果可量化（文件数量）
  ✅ 符合系统架构
```

---

## 🚀 实施建议

### 核心修改点

1. **训练对象改为技能包**
   - 前端：选择"技能包"而非"智能体"
   - 后端：trainSkill(skillName, executorAgent, ...)

2. **成果保存到 skill-data/**
   - 按技能包规则组织
   - 自动更新索引

3. **训练报告统计数据增长**
   - 训练前：X 个数据
   - 训练后：X + 82 个数据

4. **技能包指令中说明数据位置**
   - SKILL.md 中明确：数据存储在 skill-data/{skill-name}/
   - 指导 LLM 如何读取和保存

---

## ❓ 待讨论的问题

### 问题 1：技能包的数据格式

不同技能包的数据格式不同：

- experience-manager: problems/ + solutions/
- dimension-architect: templates/
- 其他技能包：？

**如何处理**：

- 方案 A：为每个技能包硬编码保存逻辑
- 方案 B：技能包在 SKILL.md 中定义数据格式，系统自动适配
- 方案 C：让 Agent 自己决定如何保存（调用 write 工具）

我推荐**方案 C**：

- 训练任务描述中包含"保存要求"
- Agent 自己使用 write 工具保存到 skill-data/
- 系统只负责验证格式

### 问题 2：多个智能体共享技能包数据？

场景：

- app-copilot 训练了 experience-manager
- 数据在：~/coobee-data/homes/app-copilot/skill-data/experience-manager/
- 问题：code-reviewer 也使用 experience-manager，但它的数据在自己的 home 下

**如何处理**：

- 方案 A：每个智能体独立训练（数据不共享）
- 方案 B：技能包数据放在全局位置（如 ~/coobee-data/skills-data/）
- 方案 C：训练时选择"个人"或"共享"模式

我推荐**方案 A**（当前架构）：

- 每个智能体有自己的 skill-data/
- 避免冲突和污染
- 如需共享，通过 brain/shared-drive 同步

### 问题 3：如何验证训练成果？

**指标**：

1. **数据量增长**：skill-data/ 目录的文件数量
2. **质量提升**：训练后期的平均分是否提高
3. **实际应用**：下次使用技能包时的表现

**验证方法**：

- 训练前后对比测试集得分
- 统计 skill-data/ 的文件数量
- 实际使用技能包，观察效果

---

## 📋 实施清单

### 需要修改的部分

1. **前端界面**（CreateTrainingDialog.vue）
   - ✅ 改为选择"技能包"
   - ✅ 添加"执行智能体"选择器
   - ✅ 添加"知识库路径"选择器
   - ❌ 删除"预估信息"

2. **后端 API**（training.ts）
   - ✅ 接收 skillName, executorAgentId
   - ✅ 调用 GoalGenerator 生成目标
   - ✅ 调用 KnowledgeBaseDataSource 生成数据
   - ❌ 删除硬编码

3. **训练执行器**（TrainingExecutor.ts）
   - ✅ 增加最多 3 次重试逻辑
   - ✅ 记录每次尝试的详情
   - ✅ 保存数据到 skill-data/

4. **数据生成器**（training-data-generator Agent）
   - ✅ 支持从知识库读取（使用 read 工具）
   - ✅ 支持分批生成
   - ✅ 生成的任务包含"使用技能包"的要求

5. **成果保存器**（新增）
   - ✅ SkillDataSaver
   - ✅ 根据技能包规则保存数据
   - ✅ 自动更新索引

6. **训练报告**（增强）
   - ✅ 统计 skill-data/ 数据增长
   - ✅ 每条数据的详细尝试记录
   - ✅ 技能包能力提升评估

---

## 🎊 设计完成度

**v2.0 架构设计**：✅ 完成

**满足用户需求**：

- ✅ 训练对象是技能包
- ✅ 数据源是知识库
- ✅ 最多重试 3 次
- ✅ 完整训练报告
- ✅ 成果积累到 skill-data/

**符合系统架构**：

- ✅ 利用已有的 skill-data/ 设计
- ✅ 配合 experience-manager 等技能包
- ✅ 不破坏现有结构

**待确认**：

- 技能包数据格式如何处理（推荐方案 C）
- 是否需要共享技能包数据（推荐方案 A）

---

**文档状态**：架构设计完成，待用户确认后开始实施
