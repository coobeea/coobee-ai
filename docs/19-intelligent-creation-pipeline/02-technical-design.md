# 智能创建流水线 — 技术方案

> 版本：v1.0 | 日期：2026-03-06 | 状态：方案设计

## 1. 架构总览

### 1.1 核心架构：编排 Agent + 专业 Agent 协作

```
用户                   前端                        后端
 │                      │                           │
 │  "创建一个销售 Skill" │                           │
 │ ──────────────────→  │  POST /creation/start     │
 │                      │ ──────────────────────→   │
 │                      │                    ┌──────┴──────────────────────┐
 │                      │                    │   CreationPipeline          │
 │                      │                    │   (流程调度 + 状态持久化)    │
 │                      │                    │                             │
 │                      │                    │   Phase 1:                  │
 │                      │                    │   executeAgent(              │
 │                      │                    │     'requirements-analyst') │
 │                      │                    │                             │
 │   ←── SSE 事件流 ────┤←── eventBus ──────│   Phase 2:                  │
 │  (进度/中间结果/      │                    │   executeAgent(              │
 │   需要用户确认)       │                    │     'solution-designer')    │
 │                      │                    │   ...                       │
 │                      │                    └─────────────────────────────┘
```

### 1.2 两层架构

| 层         | 职责                               | 实现方式                                      |
| ---------- | ---------------------------------- | --------------------------------------------- |
| **流程层** | Phase 调度、状态机、检查点、持久化 | TypeScript 代码（`CreationPipeline`）         |
| **执行层** | 每个 Phase 的具体业务逻辑          | 专业 Agent 通过 `ChannelRuntime.executeAgent` |

流程层是「骨架」，执行层是「肌肉」。骨架固定且稳定，肌肉（Agent）可以独立升级和替换。

## 2. 专业 Agent 定义

每个 Phase 对应一个专业 Agent。这些 Agent 的定义放在 `agents/` 目录下。

### 2.1 Agent 清单

| Agent ID                | 名称         | 负责 Phase       | 核心能力                                                     |
| ----------------------- | ------------ | ---------------- | ------------------------------------------------------------ |
| `creation-orchestrator` | 创建编排师   | 总调度           | 理解用户需求类型、决定流程走向、汇总各阶段产出               |
| `requirements-analyst`  | 需求分析师   | Phase 1          | 多轮对话引导、意图提取、边界定义、生成验收标准               |
| `solution-designer`     | 方案设计师   | Phase 2          | 生成多方案、优劣分析、方案对比                               |
| `skill-builder`         | Skill 构建师 | Phase 3（Skill） | 根据方案生成 SKILL.md、references、scripts                   |
| `agent-builder`         | Agent 构建师 | Phase 3（Agent） | 根据方案生成 Agent JSON + Home 文件（IDENTITY/SOUL/USER 等） |
| `quality-validator`     | 质量验证师   | Phase 4          | 基于验收标准评分、场景模拟测试、生成验证报告                 |
| `iteration-optimizer`   | 迭代优化师   | Phase 5          | 分析薄弱点、提出优化策略、指导重新生成                       |

### 2.2 Agent 定义示例：`requirements-analyst`

````json
{
  "id": "requirements-analyst",
  "name": "需求分析师",
  "description": "通过结构化的对话引导，深度分析用户的创建需求，明确意图、边界和验收标准",
  "instructions": [
    "你是一个专业的需求分析师，专注于 AI Skill 和 Agent 的需求分析。",
    "",
    "## 工作流程",
    "",
    "### 第一轮：意图识别",
    "1. 判断用户要创建的是 Skill 还是 Agent（或两者）",
    "2. 提取核心目标：这个 Skill/Agent 要解决什么问题？",
    "3. 识别目标用户和使用场景",
    "",
    "### 第二轮：场景细化",
    "1. 确定输入格式和数据来源",
    "2. 确定输出格式和结构",
    "3. 列出典型使用场景（3-5 个）",
    "",
    "### 第三轮：边界定义",
    "1. 明确做什么、不做什么",
    "2. 异常场景如何处理",
    "3. 性能和规模要求",
    "",
    "### 第四轮：验收标准",
    "根据前三轮收集的信息，使用 dimension-architect 技能生成量化的验收维度。",
    "每个维度包含：key、label、weight、standard（具体达标线）。",
    "",
    "## 输出格式",
    "",
    "最终输出严格 JSON 格式的需求文档：",
    "```json",
    "{",
    "  \"targetType\": \"skill\" | \"agent\",",
    "  \"name\": \"产物名称\",",
    "  \"goal\": \"核心目标描述\",",
    "  \"scenarios\": [\"场景1\", \"场景2\", ...],",
    "  \"input\": { \"format\": \"...\", \"source\": \"...\" },",
    "  \"output\": { \"format\": \"...\", \"structure\": \"...\" },",
    "  \"boundaries\": { \"includes\": [...], \"excludes\": [...] },",
    "  \"criteria\": [",
    "    { \"key\": \"...\", \"label\": \"...\", \"weight\": 0.3, \"standard\": \"...\" }",
    "  ],",
    "  \"skillCount\": 1,",
    "  \"skills\": [{ \"name\": \"...\", \"purpose\": \"...\" }]",
    "}",
    "```"
  ],
  "skills": ["dimension-architect"],
  "tools": ["read", "search", "glob"],
  "modelConfig": {
    "primary": "dashscope/qwen3.5-plus",
    "fallbacks": ["deepseek/deepseek-v3"]
  }
}
````

### 2.3 Agent 定义示例：`quality-validator`

````json
{
  "id": "quality-validator",
  "name": "质量验证师",
  "description": "基于验收标准对 Skill/Agent 产物进行量化评估和场景测试",
  "instructions": [
    "你是一个严格的质量验证专家。你的任务是根据预设的验收标准，对创建产物进行客观评估。",
    "",
    "## 评估流程",
    "",
    "1. 读取验收标准（criteria）",
    "2. 读取待验证的产物（Skill/Agent 文件）",
    "3. 逐维度评分（0-100）",
    "4. 模拟 2-3 个典型场景进行测试",
    "5. 生成验证报告",
    "",
    "## 输出格式",
    "",
    "```json",
    "{",
    "  \"overallScore\": 85,",
    "  \"passed\": true,",
    "  \"dimensionScores\": [",
    "    { \"key\": \"accuracy\", \"score\": 90, \"comment\": \"...\" }",
    "  ],",
    "  \"scenarioTests\": [",
    "    { \"scenario\": \"...\", \"passed\": true, \"output\": \"...\", \"comment\": \"...\" }",
    "  ],",
    "  \"weaknesses\": [\"...\"],",
    "  \"suggestions\": [\"...\"]",
    "}",
    "```",
    "",
    "## 评判标准",
    "- 总分 ≥ 80 且无维度低于 60 → passed: true",
    "- 否则 → passed: false，并在 weaknesses 中标注需改进的维度"
  ],
  "skills": ["eval-refine-loop", "self-reflection"],
  "tools": ["read", "search", "glob"]
}
````

## 3. 数据模型

### 3.1 创建会话（CreationSession）

```typescript
interface CreationSession {
  id: string;
  targetType: 'skill' | 'agent';
  userRequirement: string; // 用户原始需求文本
  status: CreationStatus;
  currentPhase: PhaseId;
  phases: Record<PhaseId, PhaseState>;
  requirements?: RequirementsOutput; // Phase 1 产出
  designs?: DesignOutput; // Phase 2 产出
  artifacts?: ArtifactOutput; // Phase 3 产出
  validation?: ValidationOutput; // Phase 4 产出
  iterations: IterationRecord[]; // Phase 5 迭代记录
  finalVersion?: string; // 最终采用的版本号
  createdAt: number;
  updatedAt: number;
}

type CreationStatus =
  | 'requirements' // Phase 1 进行中
  | 'design' // Phase 2 进行中
  | 'implementing' // Phase 3 进行中
  | 'validating' // Phase 4 进行中
  | 'iterating' // Phase 5 进行中
  | 'releasing' // Phase 6 进行中
  | 'completed' // 完成
  | 'paused' // 用户暂停（等待确认）
  | 'failed'; // 失败

type PhaseId = 'requirements' | 'design' | 'implement' | 'validate' | 'iterate' | 'release';

interface PhaseState {
  status: 'pending' | 'running' | 'awaiting_user' | 'completed' | 'skipped' | 'failed';
  startedAt?: number;
  completedAt?: number;
  agentSessionId?: string; // 执行该 Phase 的 Agent 会话 ID
  output?: unknown; // Phase 产出数据
  error?: string;
}
```

### 3.2 Phase 产出类型

```typescript
interface RequirementsOutput {
  targetType: 'skill' | 'agent';
  name: string;
  goal: string;
  scenarios: string[];
  input: { format: string; source: string };
  output: { format: string; structure: string };
  boundaries: { includes: string[]; excludes: string[] };
  criteria: CriterionDimension[];
  skillPlan?: SkillPlanItem[]; // 当 targetType='agent' 时，规划需要的 Skill
}

interface CriterionDimension {
  key: string;
  label: string;
  weight: number; // 0-1，所有维度权重之和 = 1
  standard: string; // 达标线的文字描述
  passThreshold: number; // 达标分数线（0-100）
}

interface SkillPlanItem {
  name: string;
  purpose: string;
  exists: boolean; // 系统中是否已有
  priority: 'required' | 'optional';
}

interface DesignOutput {
  selectedPlan: string; // 选中的方案 ID
  plans: DesignPlan[];
  comparison?: string; // 对比分析文本
}

interface DesignPlan {
  id: string; // plan-a, plan-b, plan-c
  name: string;
  approach: string; // 方案描述
  pros: string[];
  cons: string[];
  suitableFor: string;
  outline: string; // 方案大纲（将用于 Phase 3）
}

interface ArtifactOutput {
  version: string; // v1, v2...
  files: ArtifactFile[]; // 生成的文件列表
  selfCheckScore?: number; // 生成时的自检分数
}

interface ArtifactFile {
  path: string; // 相对路径
  content: string; // 文件内容
  role: string; // 'main' | 'reference' | 'test' | 'config'
}

interface ValidationOutput {
  version: string;
  overallScore: number;
  passed: boolean;
  dimensionScores: { key: string; score: number; comment: string }[];
  scenarioTests: { scenario: string; passed: boolean; output: string; comment: string }[];
  weaknesses: string[];
  suggestions: string[];
}

interface IterationRecord {
  fromVersion: string;
  toVersion: string;
  reason: string; // 为什么需要迭代
  changes: string[]; // 做了哪些改动
  validationBefore: ValidationOutput;
  validationAfter: ValidationOutput;
}
```

## 4. 流程引擎设计

### 4.1 CreationPipeline 核心逻辑

```typescript
class CreationPipeline {
  // 固定的流程步骤顺序
  private static PHASES: PhaseId[] = ['requirements', 'design', 'implement', 'validate', 'iterate', 'release'];

  // 每个 Phase 对应的 Agent ID
  private static PHASE_AGENTS: Record<PhaseId, string> = {
    requirements: 'requirements-analyst',
    design: 'solution-designer',
    implement: 'skill-builder', // 或 agent-builder，根据 targetType
    validate: 'quality-validator',
    iterate: 'iteration-optimizer',
    release: 'creation-orchestrator' // 发布由编排 Agent 处理
  };

  async start(userRequirement: string, targetType: 'skill' | 'agent'): Promise<string>;
  async advanceToNextPhase(sessionId: string): Promise<void>;
  async userConfirm(sessionId: string, choice: UserChoice): Promise<void>;
  async rerunPhase(sessionId: string, phaseId: PhaseId): Promise<void>;
  async goBackToPhase(sessionId: string, phaseId: PhaseId): Promise<void>;
  async getSession(sessionId: string): Promise<CreationSession>;
}
```

### 4.2 Phase 执行流程

每个 Phase 的执行遵循统一模式：

```
1. 更新 session 状态 → phase.status = 'running'
2. 构建 Agent 消息（包含前序 Phase 的产出作为上下文）
3. 调用 ChannelRuntime.executeAgent({ agentId, sessionId, message, context })
4. 解析 Agent 输出为结构化数据
5. 存储 Phase 产出到 session
6. 判断是否需要用户确认：
   - Phase 1（需求分析）→ 需要用户确认需求文档
   - Phase 2（方案设计）→ 需要用户选择方案
   - Phase 4（验证测试）→ 展示结果，用户决定是否迭代
   - 其他 Phase → 自动推进
7. 更新 session 状态 → phase.status = 'awaiting_user' 或 'completed'
8. 广播事件 → eventBus.emit('creation:phase-complete', ...)
```

### 4.3 Agent 消息构建

每个 Phase 的 Agent 收到的消息需要包含前序阶段的上下文：

```typescript
function buildPhaseMessage(session: CreationSession, phaseId: PhaseId): string {
  let message = `## 创建任务\n\n`;
  message += `**目标类型**：${session.targetType}\n`;
  message += `**用户需求**：${session.userRequirement}\n\n`;

  // Phase 2+ 包含需求分析结果
  if (session.requirements) {
    message += `## 需求分析结果\n\n${JSON.stringify(session.requirements, null, 2)}\n\n`;
  }

  // Phase 3+ 包含选定方案
  if (session.designs) {
    const selected = session.designs.plans.find((p) => p.id === session.designs!.selectedPlan);
    message += `## 确定方案\n\n${selected?.outline}\n\n`;
  }

  // Phase 4+ 包含生成产物
  if (session.artifacts) {
    message += `## 当前产物\n\n`;
    for (const file of session.artifacts.files) {
      message += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }
  }

  // Phase 5 包含验证结果
  if (session.validation) {
    message += `## 验证结果\n\n${JSON.stringify(session.validation, null, 2)}\n\n`;
  }

  // Phase-specific 指令
  message += getPhaseSpecificPrompt(phaseId, session);

  return message;
}
```

## 5. 持久化设计

### 5.1 存储路径

```
.home/creation/
├── sessions/
│   ├── {sessionId}.json              # 会话元数据
│   └── {sessionId}/
│       ├── requirements.json         # Phase 1 产出
│       ├── designs.json              # Phase 2 产出
│       ├── artifacts/                # Phase 3 产出
│       │   ├── v1/                   # 版本 1
│       │   │   ├── SKILL.md
│       │   │   └── ...
│       │   └── v2/                   # 版本 2（迭代后）
│       ├── validations/              # Phase 4 产出
│       │   ├── report-v1.json
│       │   └── report-v2.json
│       └── iterations.json           # Phase 5 迭代记录
└── templates/                        # 可复用的创建模板（未来扩展）
```

### 5.2 与最终产物的关系

Phase 6（发布）将 `artifacts/v{final}/` 中的文件复制到正式目录：

- Skill → `skills/{skill-name}/SKILL.md`（+ references/ 等）
- Agent → `agents/{agentId}.json` + `homes/{agentId}/`（IDENTITY.md 等）

同时在正式产物目录下创建 `.creation/` 链接或摘要，方便追溯创建过程。

## 6. HTTP API 设计

### 6.1 路由

```
POST   /gateway/creation/start          # 开始创建（传入需求文本 + 目标类型）
GET    /gateway/creation/sessions        # 列出所有创建会话
GET    /gateway/creation/sessions/:id    # 获取会话详情
POST   /gateway/creation/sessions/:id/confirm   # 用户确认（选择方案、确认需求等）
POST   /gateway/creation/sessions/:id/rerun     # 重跑当前 Phase
POST   /gateway/creation/sessions/:id/back      # 回退到指定 Phase
POST   /gateway/creation/sessions/:id/skip      # 跳过当前 Phase
DELETE /gateway/creation/sessions/:id    # 取消/删除创建会话
```

### 6.2 实时事件（通过 eventBus → WebSocket）

```
creation:phase-started    { sessionId, phaseId, agentId }
creation:phase-progress   { sessionId, phaseId, message }        // Agent 中间输出
creation:phase-complete   { sessionId, phaseId, output }
creation:awaiting-user    { sessionId, phaseId, question, options }  // 需要用户输入
creation:completed        { sessionId, artifacts }
creation:failed           { sessionId, phaseId, error }
```

## 7. 前端交互设计

### 7.1 创建向导视图（CreationWizardView）

左侧：Phase 时间线（固定 6 步，高亮当前步骤）
右侧：当前 Phase 的交互区域

```
┌──────────────────────────────────────────────────┐
│  创建向导 — 销售话术分析 Skill                      │
├──────────┬───────────────────────────────────────┤
│          │                                       │
│  ① 需求  │   [当前 Phase 的交互区域]              │
│  ● 进行中│                                       │
│          │   Phase 1: 对话式界面                  │
│  ② 方案  │   ┌─────────────────────────────┐     │
│  ○ 待执行│   │ AI: 你想分析什么类型的话术？ │     │
│          │   │ 用户: 销售场景的...          │     │
│  ③ 生成  │   │ AI: 输出需要什么格式？       │     │
│  ○ 待执行│   └─────────────────────────────┘     │
│          │                                       │
│  ④ 验证  │   Phase 2: 方案对比卡片               │
│  ○ 待执行│   ┌──────┐ ┌──────┐ ┌──────┐         │
│          │   │方案 A │ │方案 B│ │方案 C│         │
│  ⑤ 迭代  │   └──────┘ └──────┘ └──────┘         │
│  ○ 待执行│   [选择方案] [合并方案]                │
│          │                                       │
│  ⑥ 发布  │   Phase 3-4: 进度条 + 结果展示        │
│  ○ 待执行│   Phase 5: 版本对比 + 迭代按钮         │
│          │                                       │
├──────────┴───────────────────────────────────────┤
│  [返回上一步]  [跳过]  [重新生成]  [继续]          │
└──────────────────────────────────────────────────┘
```

### 7.2 各 Phase 的交互组件

| Phase      | 组件                    | 交互模式          | 用户操作                       |
| ---------- | ----------------------- | ----------------- | ------------------------------ |
| 1 需求分析 | `RequirementsChat.vue`  | 对话式            | 回答 AI 提问，确认需求文档     |
| 2 方案设计 | `DesignComparison.vue`  | 卡片对比          | 选择方案 / 合并 / 提出修改意见 |
| 3 实施生成 | `ImplementProgress.vue` | 进度条 + 实时预览 | 等待，查看中间产物             |
| 4 验证测试 | `ValidationReport.vue`  | 报告展示          | 查看评分，决定是否迭代         |
| 5 迭代优化 | `IterationPanel.vue`    | 版本对比 + 操作   | 选择迭代/接受当前版本          |
| 6 发布存档 | `ReleaseConfirm.vue`    | 确认面板          | 确认发布位置和名称             |

## 8. 实施计划

### 8.1 阶段划分

**Phase A：核心框架（MVP）**

- [ ] 定义 `CreationSession` 类型和 `CreationStore`
- [ ] 实现 `CreationPipeline` 流程引擎（状态机 + Phase 调度）
- [ ] 创建 `requirements-analyst` Agent 定义
- [ ] 创建 `skill-builder` Agent 定义
- [ ] 实现 Phase 1（需求分析）+ Phase 3（生成）+ Phase 6（发布）的最小闭环
- [ ] HTTP API 路由注册
- [ ] 前端 `CreationWizardView` 骨架 + Phase 1 对话组件
- [ ] 打通端到端：用户输入需求 → 对话分析 → 生成 Skill → 写入文件

**Phase B：质量保障**

- [ ] 创建 `solution-designer` Agent 定义
- [ ] 创建 `quality-validator` Agent 定义
- [ ] 实现 Phase 2（方案设计）— 多方案生成和对比
- [ ] 实现 Phase 4（验证测试）— 基于验收标准评分
- [ ] 前端方案对比组件 + 验证报告组件

**Phase C：迭代能力**

- [ ] 创建 `iteration-optimizer` Agent 定义
- [ ] 实现 Phase 5（迭代优化）— 多版本生成和对比
- [ ] 前端迭代面板 + 版本对比
- [ ] 完善 Phase 6 的存档逻辑（过程文档完整归档）

**Phase D：Agent 创建**

- [ ] 创建 `agent-builder` Agent 定义
- [ ] 实现 Agent 创建的差异化逻辑（人格文件、Skill 编排、Home 目录）
- [ ] 实现 Skill 子任务嵌套（创建 Agent 时自动创建所需 Skill）
- [ ] 前端适配 Agent 创建流程

### 8.2 优先级原则

1. **先 Skill 后 Agent** — Skill 流程更简单，验证 MVP 后再扩展到 Agent
2. **先闭环后质量** — Phase A 先跑通 1→3→6 最小闭环，再加入 2（方案）、4（验证）、5（迭代）
3. **先后端后前端** — Agent 定义和流程引擎先行，前端可以从简单的进度展示逐步丰富

## 9. 风险与应对

| 风险                                              | 影响                 | 应对策略                                            |
| ------------------------------------------------- | -------------------- | --------------------------------------------------- |
| Agent 输出不符合预期的结构化格式                  | Phase 间无法传递数据 | Agent 指令中强制 JSON 格式 + 后端 fallback 解析     |
| 单次创建消耗过多 Token（6 个 Phase × 长 context） | 成本高、速度慢       | Phase 间只传递摘要，不传全文；允许跳过可选 Phase    |
| 需求分析对话轮次过多，用户失去耐心                | 体验差               | 提供"快速模式"跳过详细分析；AI 主动提供默认选项     |
| 多版本迭代导致创建时间过长                        | 用户放弃             | 限制最大迭代次数（默认 2 次）；允许随时接受当前版本 |
