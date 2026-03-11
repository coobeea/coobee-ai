# 智能体训练系统设计（基于技能包数据积累）

> **撰写时间**: 2026-03-10  
> **版本**: 2.0  
> **核心理念**: 训练智能体（使用技能包），成果是技能包数据积累

---

## 🎯 核心认知

### 训练对象 = 智能体 + 技能包（组合）

```
智能体（Agent）
  ├─ 无状态执行者
  ├─ 平时运行不产生额外数据（只有临时数据）
  ├─ 训练时也不产生数据（本身无状态）
  └─ 必须配备技能包才能产生训练成果

技能包（Skill）
  ├─ 有明确的数据产生规则
  ├─ 智能体使用技能包时产生数据
  ├─ 数据存储在 skill-data/（跨会话持久化）
  └─ 数据越多，技能包越"强"

可训练对象 = 智能体 + 技能包
  ├─ 训练：智能体使用技能包执行任务
  ├─ 成果：技能包产生数据
  └─ 复用：任何智能体使用该技能包都能读取数据
```

### 训练的本质

**训练 = 让智能体使用技能包**  
**成果 = 技能包数据积累**

```
训练流程：
  1. 选择智能体（如 app-copilot）
  2. 选择技能包（如 experience-manager）
  3. 智能体使用技能包执行大量任务
  4. 技能包按规则产生数据，存储到 skill-data/
  5. 其他智能体使用该技能包时，可读取这些数据
```

---

## 🏗️ 架构设计

### 数据存储约定

```
{agentHome}/
├── skill-data/                    # 技能包数据根目录
│   ├── experience-manager/        # experience-manager 技能的数据
│   │   ├── problems/              # 按技能规则组织
│   │   │   ├── P001-xxx/
│   │   │   │   ├── problem.md
│   │   │   │   └── solutions/
│   │   │   │       └── S001-xxx.md
│   │   │   └── ...
│   │   └── _index.md
│   │
│   ├── dimension-architect/       # dimension-architect 技能的数据
│   │   ├── templates/             # 按技能规则组织
│   │   │   ├── code-quality.json
│   │   │   └── ...
│   │   └── best-practices.md
│   │
│   └── {其他技能包}/
│       └── （按该技能包的规则组织）
```

### 核心约定

**约定 1**：技能包数据位置

- 所有技能包的数据统一存储在 `{agentHome}/skill-data/{skillName}/`
- 目录名必须与技能包名称一致

**约定 2**：数据格式由技能包定义

- 每个技能包在 SKILL.md 中说明数据格式
- 例如 experience-manager 使用三层结构
- 例如 dimension-architect 使用 templates/ 目录

**约定 3**：大模型自动读取

- 使用技能包时，大模型从 skill-data/ 读取
- SKILL.md 中说明读取规则
- 大模型自动理解和使用数据

---

## 🔄 完整训练流程

### 阶段 0：用户发起训练

#### 前端界面（CreateTrainingDialog.vue）

```
┌─────────────────────────────────────────────┐
│ 创建训练                                     │
├─────────────────────────────────────────────┤
│                                              │
│ 【选择智能体】                               │
│   下拉选择: app-copilot ▼                    │
│                                              │
│ 【使用技能包】                               │
│   下拉选择: experience-manager ▼             │
│   说明：只有配备技能包才能产生训练数据        │
│                                              │
│ 【训练目标】（口述）                         │
│   输入框: "提升经验管理的准确性和完整性"      │
│                                              │
│ 【数据源】                                   │
│   类型: ● 知识库  ○ 历史会话  ○ 自动生成    │
│   路径: brain/problem-solving                │
│                                              │
│ 【训练配置】                                 │
│   轮次: 100                                  │
│   策略: sequential ▼                         │
│                                              │
│ [取消]  [开始训练]                           │
└─────────────────────────────────────────────┘
```

#### 发送到后端

```json
{
  "agentId": "app-copilot",
  "skillName": "experience-manager",
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

#### 后端处理

```typescript
// 1. 调用 dimension-architect 生成目标
const goalGenerator = new GoalGenerator();
const trainingGoal = await goalGenerator.generate({
  agentId: 'app-copilot',
  skillName: 'experience-manager',
  goalDescription: '提升经验管理的准确性和完整性'
});

// 2. 保存目标（可选）
await saveGoal(trainingGoal, 'app-copilot-experience-manager.json');

// 结果：
// {
//   name: "经验管理能力",
//   agentId: "app-copilot",
//   skillName: "experience-manager",
//   dimensions: [
//     { name: "format-compliance", weight: 30, ... },
//     { name: "completeness", weight: 25, ... },
//     ...
//   ],
//   threshold: 75
// }
```

---

### 阶段 2：生成训练数据

#### 后端处理

```typescript
// 1. 创建知识库数据源
const dataSource = new KnowledgeBaseDataSource({
  path: 'brain/problem-solving',
  trainingGoal,
  agentId: 'app-copilot',
  skillName: 'experience-manager'
});

// 2. 生成训练数据（分批）
const dataset = await dataSource.generate({
  totalCount: 100,
  trainTestRatio: 0.8, // 训练集:测试集 = 80:20
  batchSize: 30 // 每次生成 30 个
});

// 内部实现：
// - 第 1 次调用 training-data-generator Agent: 30 个任务
// - 第 2 次调用: 30 个任务
// - 第 3 次调用: 40 个任务
// - 汇总：trainSet (80) + testSet (20)

// 任务格式：
// {
//   id: "task-001",
//   description: "场景：用户需要读取 5GB 日志文件...",
//   expectedAction: "使用 experience-manager 技能记录此问题的解决方案",
//   knowledgeContext: "...从 brain/problem-solving 提取的内容...",
//   difficulty: 3,
//   category: "file-processing"
// }
```

---

### 阶段 3：执行训练

#### 单条数据的训练（最多 3 次尝试）

```
任务：处理大文件读取问题

┌───────────────────────────────────────────────────────────────┐
│ 尝试 1                                                         │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│ 调用智能体（app-copilot）：                                    │
│   输入："使用 experience-manager 技能，记录以下问题和解决方案..." │
│   智能体行为：                                                 │
│     1. 读取智能体的 skills 配置，找到 experience-manager      │
│     2. 读取 SKILL.md（experience-manager 的规则）             │
│     3. 按照三层结构创建文件：                                  │
│        → {agentHome}/skill-data/experience-manager/           │
│            problems/P101-大文件读取/                          │
│              problem.md                                        │
│              solutions/S001-流式读取.md                       │
│     4. 返回："已创建经验记录 P101"                             │
│                                                                │
│ 调用质检员（training-evaluator Agent）：                      │
│   输入：                                                       │
│     - 训练目标（含维度定义）                                   │
│     - 智能体输出的文件路径                                     │
│   检查：                                                       │
│     - 读取 app-copilot 生成的文件                             │
│     - 验证格式是否符合 experience-manager 规则                │
│     - 验证内容完整性                                           │
│   结果：                                                       │
│     score: 68, passed: false                                  │
│     问题：缺少"推导过程"章节                                   │
│                                                                │
│ → 未达标，进入尝试 2                                           │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│ 尝试 2                                                         │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│ 调用教练（training-coach Agent）：                            │
│   输入：                                                       │
│     - 训练目标                                                 │
│     - 质检反馈                                                 │
│   建议："在 solution.md 中补充'为什么选择这个方案'的推导"      │
│                                                                │
│ 调用智能体（app-copilot，带教练建议）：                       │
│   → 读取之前生成的文件                                         │
│   → 补充推导过程章节                                           │
│   → 更新文件                                                   │
│                                                                │
│ 质检：                                                         │
│   score: 78, passed: true ✅                                  │
│                                                                │
│ → 达标，记录成功                                              │
└───────────────────────────────────────────────────────────────┘

训练记录：
  {
    round: 1,
    taskId: "task-001",
    agentId: "app-copilot",
    skillName: "experience-manager",
    attempts: [
      { attemptNo: 1, score: 68, passed: false },
      { attemptNo: 2, score: 78, passed: true }
    ],
    finalScore: 78,
    finalPassed: true,
    totalAttempts: 2,
    generatedFiles: [
      "skill-data/experience-manager/problems/P101-大文件读取/problem.md",
      "skill-data/experience-manager/problems/P101-大文件读取/solutions/S001-流式读取.md"
    ]
  }
```

#### 100 轮训练后

```
训练智能体：app-copilot
使用技能包：experience-manager

成果：
{agentHome}/skill-data/experience-manager/
├── problems/
│   ├── P101-大文件读取/          ← 由 app-copilot 生成
│   ├── P102-数据库查询优化/       ← 由 app-copilot 生成
│   ├── P103-异步并发控制/         ← 由 app-copilot 生成
│   ├── ...
│   └── P180-WebSocket断线重连/    ← 共 82 个问题（82% 通过率）
└── _index.md

说明：
- 智能体：app-copilot（本身无变化）
- 技能包数据：experience-manager 的 skill-data/ 增加了 82 个问题
- 复用：任何智能体使用 experience-manager 技能都能读取这些数据

testSet（20 个）用于验证，不产生新数据
```

---

### 阶段 4：训练报告生成

#### 报告内容

```markdown
# 训练报告：app-copilot 智能体训练

**训练时间**：2026-03-10 15:00 - 17:30
**训练智能体**：app-copilot
**使用技能包**：experience-manager
**训练轮次**：100
**数据源**：brain/problem-solving（知识库）

## 训练数据统计

- 训练集：80 条
- 测试集：20 条（仅验证，不生成数据）
- 数据源类型：知识库提取

## 训练结果

### 整体表现

- 总通过率：82% (82/100)
- 首次通过率：45% (45/100)
- 二次通过率：30% (30/100)
- 三次通过率：7% (7/100)
- 最终失败：18% (18/100)

### 各维度表现

| 维度              | 平均分 | 通过率 | 评价      |
| ----------------- | ------ | ------ | --------- |
| format-compliance | 85     | 88%    | ✅ 优秀   |
| completeness      | 76     | 78%    | ✅ 良好   |
| usefulness        | 79     | 81%    | ✅ 优秀   |
| categorization    | 72     | 73%    | ⚠️ 需改进 |

### 每条数据详情

#### task-001: 大文件读取问题

- 尝试次数：2
- 最终得分：78
- 生成文件：
  - P101-大文件读取/problem.md
  - P101-大文件读取/solutions/S001-流式读取.md

#### task-002: 数据库查询优化

- 尝试次数：1
- 最终得分：82
- 生成文件：
  - P102-数据库查询优化/problem.md
  - P102-数据库查询优化/solutions/S001-索引优化.md

...（100条记录）

## 训练成果

### 技能包数据增长

训练前：
skill-data/experience-manager/problems/ → 0 个问题

训练后：
skill-data/experience-manager/problems/ → 82 个问题
（82 个通过质检的，18 个失败未生成）

### 数据质量

- 格式规范性：85 分（优秀）
- 内容完整性：76 分（良好）
- 实用性：79 分（优秀）
- 分类合理性：72 分（需改进）

### 弱点分析

**最弱维度**：categorization（分类合理性）

**改进建议**：

1. 加强标签体系训练
2. 补充分类标准知识
3. 增加分类相关的训练任务

### 下次使用效果预测

当智能体使用 experience-manager 技能时：

- 可查询 82 个已知问题的解决方案
- 命中率预计：70%+（大部分常见问题已覆盖）
- 响应速度：更快（直接复用经验，无需重新思考）
```

---

## 🤖 涉及的智能体

### 训练前（准备）

1. **dimension-architect 技能**（1 次调用）
   - 生成训练目标的维度体系

2. **training-data-generator Agent**（3-5 次调用）
   - 从知识库提取内容
   - 生成训练任务
   - 分批生成，直到达到目标数量

### 训练中（执行）

3. **执行智能体**（如 app-copilot，每条 1-3 次）
   - 使用被训练的技能包执行任务
   - 产生数据，写入 skill-data/

4. **training-evaluator**（质检员，每条 1-3 次）
   - 检查生成的数据质量
   - 验证是否符合技能包规则

5. **training-coach**（教练，失败时调用，每条 0-2 次）
   - 分析失败原因
   - 给出改进建议

### 训练后（报告）

6. **training-reporter Agent**（新增，1 次调用）
   - 分析训练记录
   - 生成训练报告
   - 统计成果数据

**总计**：1 技能 + 5 Agent

---

## 📊 与原设计的对比

### 核心差异

| 维度           | 原设计              | 新设计（基于技能包）       |
| -------------- | ------------------- | -------------------------- |
| **训练对象**   | 智能体（Agent）     | 技能包（Skill）            |
| **训练目标**   | 硬编码              | dimension-architect 生成   |
| **数据源**     | 固定 JSON 文件      | 知识库动态提取             |
| **成果形式**   | agent.json 版本快照 | skill-data/ 数据积累       |
| **成果持久性** | 版本切换才生效      | 自动生效（技能包读取数据） |
| **成果可见性** | 不可见（只是备份）  | 可见（文件系统）           |
| **成果可复用** | 仅限该 Agent        | 所有使用该技能包的 Agent   |

### 关键优势

**新设计的优势**：

1. **成果真实**
   - 技能包的 skill-data/ 真正增加了数据
   - 可以直接查看训练成果

2. **自动生效**
   - 不需要切换版本
   - 下次使用技能包时，数据自动生效

3. **可复用**
   - 技能包的数据可被多个 Agent 使用
   - 一次训练，多个 Agent 受益

4. **易验证**
   - 训练前：skill-data/experience-manager/problems/ → 0 个
   - 训练后：skill-data/experience-manager/problems/ → 82 个
   - 成果清晰可见

---

## 🎯 训练目标示例

### 示例 1：训练 app-copilot（使用 experience-manager 技能包）

```json
{
  "agentId": "app-copilot",
  "skillName": "experience-manager",
  "trainingGoal": {
    "name": "经验管理能力",
    "description": "评估 app-copilot 使用 experience-manager 技能的表现",
    "dimensions": [
      {
        "name": "format-compliance",
        "label": "格式规范性",
        "description": "生成的经验是否符合三层结构",
        "weight": 30,
        "criteria": "problem.md 和 solution.md 格式完整，包含所有必需章节"
      },
      {
        "name": "completeness",
        "label": "内容完整性",
        "description": "问题、解决方案、推导过程是否完整",
        "weight": 25,
        "criteria": "包含场景描述、核心困惑、解决思路、具体实现、推导逻辑"
      },
      {
        "name": "usefulness",
        "label": "实用性",
        "description": "经验是否真正可复用",
        "weight": 25,
        "criteria": "解决方案具体可执行，推导逻辑清晰，可直接应用"
      },
      {
        "name": "categorization",
        "label": "分类合理性",
        "description": "问题和方案的分类标签是否合理",
        "weight": 20,
        "criteria": "标签准确，类别清晰，便于检索"
      }
    ],
    "threshold": 75
  }
}
```

### 示例 2：训练 app-copilot（使用 dimension-architect 技能包）

```json
{
  "agentId": "app-copilot",
  "skillName": "dimension-architect",
  "trainingGoal": {
    "name": "维度设计能力",
    "description": "评估 app-copilot 使用 dimension-architect 技能的表现",
    "dimensions": [
      {
        "name": "comprehensiveness",
        "label": "全面性",
        "description": "维度是否全面覆盖评估目标",
        "weight": 30,
        "criteria": "维度数量3-5个，覆盖目标的主要方面"
      },
      {
        "name": "measurability",
        "label": "可量化性",
        "description": "评估标准是否清晰可量化",
        "weight": 30,
        "criteria": "每个维度有明确的评分规则和判断标准"
      },
      {
        "name": "weight-rationality",
        "label": "权重合理性",
        "description": "权重分配是否合理",
        "weight": 20,
        "criteria": "权重总和100%，重点维度权重高"
      },
      {
        "name": "applicability",
        "label": "适用性",
        "description": "维度体系是否实用",
        "weight": 20,
        "criteria": "可实际用于评估，标准具体可操作"
      }
    ],
    "threshold": 75
  }
}
```

---

## 📁 技能包数据格式规范

### experience-manager 技能包

**数据位置**：`{agentHome}/skill-data/experience-manager/`

**目录结构**（由技能包定义）：

```
experience-manager/
├── problems/                     # 问题库
│   ├── P001-xxx/
│   │   ├── problem.md            # 问题描述
│   │   └── solutions/            # 解决方案
│   │       ├── S001-xxx.md       # 方案1
│   │       └── S002-xxx.md       # 方案2
│   └── ...
└── _index.md                     # 索引
```

**文件格式**：见 experience-manager/SKILL.md

---

### dimension-architect 技能包

**数据位置**：`{agentHome}/skill-data/dimension-architect/`

**目录结构**（由技能包定义）：

```
dimension-architect/
├── templates/                    # 优秀的维度模板
│   ├── code-quality.json
│   ├── user-experience.json
│   └── ...
├── best-practices.md             # 最佳实践总结
└── dimension-library.json        # 维度库（常用维度定义）
```

---

## 🔧 需要实现的组件

### 1. GoalGenerator（训练目标生成器）

**位置**：`src/main/training/GoalGenerator.ts`

**职责**：

- 接收用户口述的训练目标
- 调用 dimension-architect 技能生成维度体系
- 返回完整的训练目标定义

**使用的技能**：

- dimension-architect（已存在）

---

### 2. KnowledgeBaseDataSource（知识库数据源）

**位置**：`src/main/training/data-sources/KnowledgeBaseDataSource.ts`

**职责**：

- 从指定知识库路径读取内容
- 调用 training-data-generator Agent
- 分批生成训练任务（如果一次生成不完）
- 返回 trainSet + testSet

**使用的 Agent**：

- training-data-generator（需增强）

---

### 3. SkillTrainingExecutor（技能包训练执行器）

**位置**：`src/main/training/SkillTrainingExecutor.ts`

**职责**：

- 执行技能包训练
- 让智能体使用指定技能包执行任务
- 质检生成的数据（是否符合技能包规则）
- 最多重试 3 次

**特点**：

- 与 TrainingExecutor 类似
- 但任务是"使用技能包"而非"直接执行"

---

### 4. TrainingReporter（训练报告生成器）

**位置**：`src/main/training/TrainingReporter.ts`

**职责**：

- 分析训练记录
- 统计成果数据（生成了多少文件）
- 生成 Markdown 训练报告

**使用的 Agent**：

- training-reporter（新增）

---

### 5. 修改 CreateTrainingDialog（前端）

**新增字段**：

- 训练类型：智能体 / 技能包
- 选择技能包（下拉）
- 训练目标（文本输入，口述）
- 数据源类型：知识库 / 历史会话 / 自动生成
- 知识库路径（如果选择知识库）

**移除字段**：

- 预估信息（删除）

---

## 🎯 关键设计决策

### 决策 1：训练对象

**选项**：

- A. 只训练技能包（Skill）
- B. 只训练智能体（Agent）
- C. 训练智能体（使用技能包）

**推荐**：**C. 训练智能体（使用技能包）**

**理由**：

- 训练对象是智能体（Agent）
- 但智能体必须配备技能包（Skill）
- 成果是技能包的 skill-data/ 数据增加
- 架构清晰：智能体执行，技能包产生数据

---

### 决策 2：成果积累方式

**选项**：

- A. 更新 agent.json 的 instructions
- B. 技能包 skill-data/ 数据积累
- C. 混合（instructions + skill-data）

**推荐**：**B. 技能包 skill-data/ 数据积累**

**理由**：

- 智能体本身不产生数据（除临时数据）
- 只有技能包产生数据（按规则）
- 数据格式由技能包规则定义，规范化
- 成果可复用（任何智能体使用该技能包都能读取）
- 成果可见、可验证

---

### 决策 3：重试次数

**选项**：

- A. 无限重试（直到达标）
- B. 最多 3 次尝试
- C. 可配置次数

**推荐**：**B. 最多 3 次尝试**

**理由**：

- 避免无限循环浪费资源
- 3 次已足够（首次 + 2 次改进）
- 如果 3 次都失败，说明任务可能不合理

---

### 决策 4：数据生成方式

**选项**：

- A. 用户手动准备 JSON 数据集
- B. 从知识库自动提取
- C. 完全由 Agent 自动生成（无知识库）

**推荐**：**B. 从知识库自动提取**

**理由**：

- 数据有意义（来自真实知识库）
- 用户不需要手动准备
- 知识库可以很零散（Agent 自己整理）

---

## 📋 实施计划

### Phase 1：核心功能（必须）

#### 1.1 训练目标动态生成

- [ ] GoalGenerator.ts（调用 dimension-architect）
- [ ] GET /training/goals API（列出已有目标）
- [ ] 前端：训练目标输入框

#### 1.2 知识库数据源

- [ ] KnowledgeBaseDataSource.ts
- [ ] 增强 training-data-generator Agent（支持读取知识库）
- [ ] 分批生成逻辑（batchSize: 30）
- [ ] 前端：数据源类型选择器

#### 1.3 技能包训练

- [ ] SkillTrainingExecutor.ts
- [ ] 修改任务执行逻辑（使用技能包）
- [ ] 质检：验证生成的数据是否符合技能包规则

#### 1.4 重试次数限制

- [ ] 修改 TrainingExecutor.executeRound()
- [ ] 增加 maxAttempts: 3 配置
- [ ] 记录每次尝试的结果

#### 1.5 训练报告

- [ ] TrainingReporter.ts
- [ ] training-reporter Agent
- [ ] 生成 Markdown 报告

#### 1.6 前端优化

- [ ] 移除预估信息卡片
- [ ] 添加训练类型选择（智能体/技能包）
- [ ] 添加技能包选择下拉
- [ ] 添加数据源配置

**预计工作量**：6-8 小时

---

### Phase 2：增强功能（可选）

- [ ] 支持历史会话作为数据源
- [ ] 完全自动生成（无知识库）
- [ ] 训练进度更详细（显示当前尝试次数）
- [ ] 技能包数据可视化（生成了多少文件）

**预计工作量**：4-6 小时

---

## ✅ 架构验证

### 问题：当前架构是否支持"训练智能体（使用技能包）"？

**回答**：**✅ 完全支持！**

**证据**：

1. ✅ **skill-data/ 目录已设计**
   - 位置：`{agentHome}/skill-data/`
   - 说明：Structured data from skills
   - 持久化：跨会话保留

2. ✅ **智能体可以使用技能包**
   - 智能体配置中有 skills 字段
   - 智能体读取 SKILL.md 执行

3. ✅ **技能包可以产生数据**
   - 技能包可以使用 write 工具
   - 可以写入 skill-data/{skillName}/

4. ✅ **技能包可以读取数据**
   - 技能包可以使用 read/search 工具
   - 可以读取 skill-data/{skillName}/

5. ✅ **数据按技能包规则组织**
   - 每个技能包定义自己的数据格式
   - 例如 experience-manager 定义了 problems/ 结构

6. ✅ **大模型自动理解**
   - SKILL.md 中说明数据格式
   - 大模型读取 SKILL.md 后理解如何使用数据

### 结论

**当前架构完全支持"训练智能体（使用技能包）"！**

核心设计：

- ✅ 训练对象：智能体（Agent）
- ✅ 必须配备：技能包（Skill）
- ✅ 成果形式：技能包的 skill-data/ 数据增加
- ✅ 成果复用：任何智能体使用该技能包都能读取数据

---

## 🚀 下一步

### 立即行动

1. ✅ **设计文档已更新**
   - 基于"训练智能体（使用技能包）"的理念
   - 完整描述训练流程
   - 明确训练对象和成果形式

2. **开始实施 Phase 1**
   - 训练目标动态生成（GoalGenerator）
   - 知识库数据源（KnowledgeBaseDataSource）
   - 智能体训练执行（SkillTrainingExecutor）
   - 重试次数限制（maxAttempts: 3）
   - 训练报告生成（TrainingReporter）
   - 前端界面优化（智能体 + 技能包选择）

3. **预计工作量**
   - 6-8 小时完成核心功能

---

**核心理解确认**：

✅ 训练对象 = 智能体（Agent）  
✅ 必须配备 = 技能包（Skill）  
✅ 成果形式 = 技能包的 skill-data/ 数据增加  
✅ 成果复用 = 任何智能体使用该技能包都能读取  
✅ 智能体本身 = 不产生数据（除临时数据）

现在开始实施！
