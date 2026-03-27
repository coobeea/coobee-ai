# 智能创建流水线 — 技术方案

> 版本：v1.1 | 日期：2026-03-06 | 状态：方案设计

## 1. 架构总览

### 1.1 核心理念：用户只需对话一次，后续全自动

```
┌──────────────────────────────────────────────────────────────────┐
│                         创建流水线                                 │
│                                                                  │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐ │
│  │   Phase 1            │    │  Phase 2 → 3 → 4 → 5 → 6       │ │
│  │   需求分析            │    │  全自动执行                      │ │
│  │                     │    │                                  │ │
│  │   用户 ←→ AI 对话    │ ─→ │  方案 → 生成 → 验证 → 迭代 → 发布│ │
│  │   + 上传知识库       │    │  (用户观察进度，无需操作)         │ │
│  │                     │    │                                  │ │
│  │   产出：标准化文件集  │    │  产出：最终 Skill/Agent           │ │
│  └─────────────────────┘    └──────────────────────────────────┘ │
│                                                                  │
│  ◉ 交互区（用户参与）         ○ 自动区（用户可观察、可干预）       │
└──────────────────────────────────────────────────────────────────┘
```

**核心体验**：用户只需要完成 Phase 1 的多轮对话，后续 5 个阶段全部自动化运行。用户可以实时观察进度，在关键节点**可选择**干预（回退、重跑），但默认情况下不需要任何操作。

### 1.2 两层架构

| 层         | 职责                               | 实现方式                                      |
| ---------- | ---------------------------------- | --------------------------------------------- |
| **流程层** | Phase 调度、状态机、检查点、持久化 | TypeScript 代码（`CreationPipeline`）         |
| **执行层** | 每个 Phase 的具体业务逻辑          | 专业 Agent 通过 `ChannelRuntime.executeAgent` |

流程层是「骨架」，执行层是「肌肉」。骨架固定且稳定，肌肉（Agent）可以独立升级和替换。

### 1.3 知识库支持

用户可以在 Phase 1 过程中提供**知识库**——一组参考文档。这些文档会：

1. 在 Phase 1 中被 `requirements-analyst` 阅读，辅助需求理解
2. 作为上下文传递给后续所有 Phase 的 Agent，确保生成产物与知识库内容一致
3. 最终存储在创建会话的 `knowledge/` 目录下，供追溯

知识库的来源可以是：

- 用户上传的文件（txt、md、pdf 等）
- 用户指定的本地目录路径
- 粘贴的文本片段

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
  knowledgeBase: KnowledgeItem[]; // 用户提供的知识库
  requirements?: RequirementsOutput; // Phase 1 产出（标准化文件集）
  designs?: DesignOutput; // Phase 2 产出
  artifacts?: ArtifactOutput; // Phase 3 产出
  validation?: ValidationOutput; // Phase 4 产出
  iterations: IterationRecord[]; // Phase 5 迭代记录
  finalVersion?: string; // 最终采用的版本号
  createdAt: number;
  updatedAt: number;
}

type CreationStatus =
  | 'requirements' // Phase 1 进行中（用户交互）
  | 'autopilot' // Phase 2-6 自动执行中（用户可观察）
  | 'completed' // 完成
  | 'paused' // 用户主动暂停 / 需要干预
  | 'failed'; // 失败

type PhaseId = 'requirements' | 'design' | 'implement' | 'validate' | 'iterate' | 'release';

interface PhaseState {
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  startedAt?: number;
  completedAt?: number;
  agentSessionId?: string; // 执行该 Phase 的 Agent 会话 ID
  output?: unknown; // Phase 产出数据
  error?: string;
}
```

### 3.2 知识库

```typescript
interface KnowledgeItem {
  id: string;
  type: 'file' | 'directory' | 'text';
  name: string; // 显示名称
  path?: string; // type='file'|'directory' 时的路径
  content?: string; // type='text' 时的文本内容
  addedAt: number;
}
```

用户在 Phase 1 对话过程中可以随时添加知识库条目。知识库对后续所有 Phase 可见——Agent 收到的上下文中会包含知识库的摘要和引用。

### 3.3 Phase 1 产出：标准化文件集

Phase 1 结束后，`requirements-analyst` 将多轮对话的成果输出为**一组标准化文件**。这些文件是后续所有 Phase 的输入。

```
.home/creation/sessions/{sessionId}/requirements/
├── requirements.md      # 【标准】需求文档 — 目标、场景、边界、约束
├── input-spec.md        # 【标准】输入规范 — 数据格式、来源、示例
├── output-spec.md       # 【标准】输出规范 — 格式、结构、示例
├── criteria.json        # 【标准】验收标准 — 量化维度 + 达标线
├── knowledge/           # 【可选】用户提供的知识库文件副本
│   ├── doc1.md
│   └── doc2.txt
└── extras/              # 【可选】额外文件（根据对话中的需求动态生成）
    ├── glossary.md      # 例：术语表
    ├── examples.md      # 例：示例数据集
    └── constraints.md   # 例：特殊约束说明
```

**标准文件**（每次创建必定生成）：

| 文件              | 内容                                                      | 格式     |
| ----------------- | --------------------------------------------------------- | -------- |
| `requirements.md` | 核心需求文档：目标、使用场景（3-5个）、边界定义、目标用户 | Markdown |
| `input-spec.md`   | 输入规范：数据格式、来源、字段说明、示例数据              | Markdown |
| `output-spec.md`  | 输出规范：结果格式、结构定义、字段说明、示例输出          | Markdown |
| `criteria.json`   | 验收标准：量化的评估维度，贯穿后续所有 Phase              | JSON     |

**可选文件**（由 `requirements-analyst` 根据对话内容判断是否需要生成）：

- 术语表（领域内有专业术语时）
- 示例数据集（用户提供了样例时）
- 特殊约束说明（有非常规限制时）
- Skill 编排计划（创建 Agent 且涉及多个 Skill 时）

### 3.4 标准化文件的结构化类型

```typescript
interface RequirementsOutput {
  targetType: 'skill' | 'agent';
  name: string;
  files: RequirementsFile[]; // 生成的文件列表
  summary: string; // 需求摘要（一段话，用于传递给后续 Phase）
  skillPlan?: SkillPlanItem[]; // 当 targetType='agent' 时
}

interface RequirementsFile {
  filename: string; // 如 'requirements.md'
  category: 'standard' | 'extra'; // 标准文件 vs 额外文件
  content: string; // 文件内容
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
```

### 3.5 Phase 2-6 产出类型

```typescript
interface DesignOutput {
  selectedPlan: string; // 自动选择的最优方案 ID
  plans: DesignPlan[];
  comparison: string; // 对比分析文本
  selectionReason: string; // 为什么选择该方案
}

interface DesignPlan {
  id: string; // plan-a, plan-b, plan-c
  name: string;
  approach: string; // 方案描述
  pros: string[];
  cons: string[];
  score: number; // 方案综合评分（0-100）
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
  role: 'main' | 'reference' | 'test' | 'config';
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

### 4.2 两种执行模式

#### Phase 1：交互模式（用户参与）

Phase 1 是唯一需要用户参与的阶段。执行流程：

```
1. 用户发送消息（或上传知识库文件）
2. 路由到 requirements-analyst Agent
3. Agent 分析后返回追问或确认
4. 重复 1-3 直到 Agent 认为信息充足
5. Agent 输出标准化文件集（requirements.md + input-spec.md + output-spec.md + criteria.json + 可选文件）
6. 文件写入 sessions/{id}/requirements/
7. Phase 1 完成 → 自动触发 autopilot
```

用户在对话中可以随时：

- 上传/添加知识库文件
- 修改之前的回答
- 让 AI 重新分析

当 Agent 输出最终文件集后，Phase 1 结束，后续自动开始。

#### Phase 2-6：自动模式（Autopilot）

Phase 1 完成后，系统自动依次执行 Phase 2→3→4→5→6：

```
for phase in [design, implement, validate, iterate, release]:
  1. 广播事件 → creation:phase-started
  2. 构建上下文（前序 Phase 产出 + 知识库摘要）
  3. 调用 executeAgent(phaseAgent, context)
  4. 实时广播中间输出 → creation:phase-progress
  5. 解析并存储 Phase 产出
  6. 广播事件 → creation:phase-complete

  // Phase 4 特殊逻辑：自动决定是否迭代
  if phase == 'validate' && !validation.passed && iterations < maxIterations:
    自动回到 Phase 3 重新生成（Phase 5 迭代逻辑）

  // 任何 Phase 失败 → 暂停，等待用户干预
  if phase.failed:
    session.status = 'paused'
    广播 → creation:needs-attention
    break
```

**用户可选干预**（非必须）：

- **暂停** → 暂停自动执行，查看当前状态
- **回退** → 回到某个 Phase 重新执行
- **跳过** → 跳过当前 Phase 继续
- 如果用户不做任何操作，流水线会自动跑完

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
│   ├── {sessionId}.json              # 会话元数据（CreationSession）
│   └── {sessionId}/
│       ├── requirements/             # Phase 1 产出（标准化文件集）
│       │   ├── requirements.md       # 【标准】需求文档
│       │   ├── input-spec.md         # 【标准】输入规范
│       │   ├── output-spec.md        # 【标准】输出规范
│       │   ├── criteria.json         # 【标准】验收标准
│       │   ├── extras/               # 【可选】额外文件
│       │   │   └── ...
│       │   └── knowledge/            # 用户提供的知识库副本
│       │       └── ...
│       ├── designs/                  # Phase 2 产出
│       │   ├── plan-a.md
│       │   ├── plan-b.md
│       │   ├── comparison.md
│       │   └── selection.json        # 选中方案及理由
│       ├── artifacts/                # Phase 3 产出
│       │   ├── v1/                   # 版本 1
│       │   │   ├── SKILL.md
│       │   │   └── ...
│       │   └── v2/                   # 版本 2（迭代后）
│       ├── validations/              # Phase 4 产出
│       │   ├── report-v1.json
│       │   └── report-v2.json
│       ├── iterations.json           # Phase 5 迭代记录
│       └── chat-history.json         # Phase 1 对话历史（用于追溯）
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
# Phase 1：对话交互
POST   /gateway/creation/start                       # 开始创建（传入需求文本 + 目标类型）
POST   /gateway/creation/sessions/:id/chat           # 发送对话消息（SSE 响应）
POST   /gateway/creation/sessions/:id/knowledge      # 添加知识库条目
DELETE /gateway/creation/sessions/:id/knowledge/:kid  # 删除知识库条目

# 通用
GET    /gateway/creation/sessions                    # 列出所有创建会话
GET    /gateway/creation/sessions/:id                # 获取会话详情
DELETE /gateway/creation/sessions/:id                # 取消/删除创建会话

# 自动执行控制（Phase 2-6）
POST   /gateway/creation/sessions/:id/launch         # Phase 1 完成后，启动自动执行
POST   /gateway/creation/sessions/:id/pause          # 暂停自动执行
POST   /gateway/creation/sessions/:id/resume         # 恢复自动执行
POST   /gateway/creation/sessions/:id/rerun/:phase   # 重跑指定 Phase
POST   /gateway/creation/sessions/:id/back/:phase    # 回退到指定 Phase
```

### 6.2 实时事件（通过 eventBus → WebSocket）

```
# Phase 1 对话事件
creation:chat-response    { sessionId, message, isComplete }     // AI 回复（流式）
creation:requirements-ready { sessionId, files }                 // 标准化文件集生成完毕

# 自动执行事件
creation:phase-started    { sessionId, phaseId, agentId }
creation:phase-progress   { sessionId, phaseId, message, detail } // Agent 中间输出（文件生成进度等）
creation:phase-complete   { sessionId, phaseId, summary }
creation:needs-attention  { sessionId, phaseId, reason }          // 失败或需要干预
creation:completed        { sessionId, artifacts, report }
```

## 7. 前端交互设计

### 7.1 核心 UX 原则

**用户只需要做一件事**：和 AI 对话，把需求说清楚。剩下的全自动。

界面分为两个阶段，切换清晰：

```
阶段 A（交互）                       阶段 B（自动）
┌─────────────────────┐            ┌─────────────────────┐
│  "告诉我你的需求"    │  ────→    │  "正在为你创建..."    │
│                     │  用户确认  │                     │
│  对话 + 知识库上传   │            │  进度面板 + 实时日志  │
└─────────────────────┘            └─────────────────────┘
```

### 7.2 阶段 A：需求对话界面

```
┌──────────────────────────────────────────────────────────────┐
│  创建 Skill — 需求分析                                [最小化] │
├─────────────────────────────────┬────────────────────────────┤
│                                 │                            │
│   对话区域                       │   知识库 & 已确认信息       │
│                                 │                            │
│   ┌───────────────────────┐     │   📋 需求摘要              │
│   │ 🤖 你想创建什么？      │     │   · 目标：销售话术分析     │
│   │    请描述你的需求...   │     │   · 场景：客户沟通分析     │
│   │                       │     │   · 状态：收集中...        │
│   │ 👤 我想做一个销售话术  │     │                            │
│   │    分析的技能...       │     │   📁 知识库 (2)            │
│   │                       │     │   · 销售手册.md            │
│   │ 🤖 了解。请问：       │     │   · 话术模板.txt           │
│   │    1. 分析什么类型？   │     │   [+ 添加文件/文本]        │
│   │    2. 输入是什么格式？ │     │                            │
│   │                       │     │   📊 进度                  │
│   │ 👤 ...                │     │   ██████░░░░ 60%           │
│   └───────────────────────┘     │   还需确认：输出格式、边界  │
│                                 │                            │
│   [输入框...            ] [发送] │                            │
│                                 │                            │
├─────────────────────────────────┴────────────────────────────┤
│  完成对话后，系统将自动执行方案设计→生成→验证→发布（预计5-10分钟）│
└──────────────────────────────────────────────────────────────┘
```

**关键 UX 细节**：

1. **右侧面板实时更新**：随着对话推进，AI 已确认的信息（目标、场景、输入、输出）实时展示在右侧，让用户清楚看到"还缺什么"
2. **知识库上传区域**：随时可以拖拽文件或粘贴文本
3. **底部提示**：明确告知用户"对话完成后全自动"，降低心理预期
4. **进度指示**：显示需求收集的完整度百分比（基于标准文件所需信息）

### 7.3 阶段 B：自动执行面板

Phase 1 完成后，界面自动切换为进度展示面板：

```
┌──────────────────────────────────────────────────────────────┐
│  创建 Skill — 自动执行中                            [暂停] [×] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Phase 进度 ──────────────────────────────────────────┐   │
│  │  ✅ ① 需求分析    完成 (3分钟)                         │   │
│  │  ✅ ② 方案设计    完成 — 选择方案 B "渐进式分析"        │   │
│  │  🔄 ③ 实施生成    进行中... (已 2 分钟)                │   │
│  │  ○  ④ 验证测试    等待                                 │   │
│  │  ○  ⑤ 迭代优化    等待                                 │   │
│  │  ○  ⑥ 发布        等待                                 │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 当前阶段详情 ────────────────────────────────────────┐   │
│  │                                                       │   │
│  │  ③ 实施生成                                           │   │
│  │                                                       │   │
│  │  正在生成文件：                                        │   │
│  │  ✅ SKILL.md          — 主文件                         │   │
│  │  🔄 references/       — 参考资料目录                    │   │
│  │  ○  test-cases/       — 测试用例                       │   │
│  │                                                       │   │
│  │  ┌─ 实时预览 ───────────────────────────────────────┐ │   │
│  │  │  # 销售话术分析                                  │ │   │
│  │  │                                                  │ │   │
│  │  │  ## 使用场景                                     │ │   │
│  │  │  当需要分析客户沟通记录中的话术质量时...          │ │   │
│  │  │  ...                                             │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  [暂停] [查看需求文档] [查看方案] [返回上一步]                 │
└──────────────────────────────────────────────────────────────┘
```

**自动执行完成后**：

```
┌──────────────────────────────────────────────────────────────┐
│  ✅ 创建完成 — 销售话术分析 Skill                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 验证评分：87/100 (通过)                                   │
│                                                              │
│  ┌─ 产物清单 ────────────────────────────────────────────┐   │
│  │  📄 skills/sales-analysis/SKILL.md       [查看] [编辑] │   │
│  │  📁 skills/sales-analysis/references/    [查看]        │   │
│  │  📁 skills/sales-analysis/test-cases/    [查看]        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 创建报告 ────────────────────────────────────────────┐   │
│  │  · 迭代次数：1（V1 评分 72 → V2 评分 87）             │   │
│  │  · 总耗时：8分钟                                       │   │
│  │  · 方案：B "渐进式分析"（优于 A/C）                    │   │
│  │  [查看完整报告]                                        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  [开始使用] [继续训练] [重新创建]                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.4 前端组件结构

| 组件                      | 用途                        | 所在阶段 |
| ------------------------- | --------------------------- | -------- |
| `CreationWizardView.vue`  | 主视图，管理阶段切换        | 全局     |
| `RequirementsChat.vue`    | 对话界面 + 消息列表         | 阶段 A   |
| `KnowledgePanel.vue`      | 知识库管理（上传/删除）     | 阶段 A   |
| `RequirementsSummary.vue` | 已确认信息的实时摘要        | 阶段 A   |
| `AutopilotProgress.vue`   | Phase 2-6 进度展示          | 阶段 B   |
| `PhaseDetail.vue`         | 单个 Phase 的详情和实时预览 | 阶段 B   |
| `CreationReport.vue`      | 创建完成后的报告            | 完成     |

## 8. 实施计划

### 8.1 阶段划分

**Phase A：需求对话（MVP 核心）**

- [ ] 定义 `CreationSession`、`RequirementsOutput`、`KnowledgeItem` 等类型
- [ ] 实现 `CreationStore`（会话持久化 + 文件存储）
- [ ] 创建 `requirements-analyst` Agent 定义（含标准化文件输出指令）
- [ ] 实现 Phase 1 对话路由（`/chat` SSE 接口）
- [ ] 实现知识库上传/管理接口
- [ ] 前端 `CreationWizardView` + `RequirementsChat` + `KnowledgePanel` + `RequirementsSummary`
- [ ] 验证：用户可以通过对话 + 知识库生成标准化文件集

**Phase B：自动流水线**

- [ ] 实现 `CreationPipeline` 自动执行引擎
- [ ] 创建 `solution-designer` Agent 定义
- [ ] 创建 `skill-builder` Agent 定义
- [ ] 创建 `quality-validator` Agent 定义
- [ ] 实现 Phase 2→3→4→6 自动流水线
- [ ] 实现验证不通过时自动迭代（Phase 5）
- [ ] 前端 `AutopilotProgress` + `PhaseDetail`（实时进度 + 预览）
- [ ] 验证：Phase 1 完成后，自动跑完到发布

**Phase C：完善体验**

- [ ] 创建 `iteration-optimizer` Agent 定义
- [ ] 完善迭代逻辑（多版本对比、智能优化建议）
- [ ] 前端 `CreationReport`（创建完成报告）
- [ ] 用户干预功能（暂停/回退/重跑）
- [ ] 完善 Phase 6 存档逻辑（过程文档归档到产物目录）

**Phase D：Agent 创建**

- [ ] 创建 `agent-builder` Agent 定义
- [ ] 实现 Agent 创建差异化逻辑（人格文件、Skill 编排、Home 目录）
- [ ] 实现 Skill 子任务嵌套（创建 Agent 时自动创建所需 Skill）
- [ ] 前端适配 Agent 创建流程

### 8.2 优先级原则

1. **Phase 1 最重要** — 对话质量决定一切，优先打磨 `requirements-analyst` 的引导能力
2. **先 Skill 后 Agent** — Skill 流程更简单，验证后再扩展
3. **先闭环后打磨** — Phase B 先跑通自动流水线，Phase C 再优化体验细节

## 9. 风险与应对

| 风险                             | 影响                 | 应对策略                                           |
| -------------------------------- | -------------------- | -------------------------------------------------- |
| Agent 输出不符合预期的结构化格式 | Phase 间无法传递数据 | Agent 指令中强制格式 + 后端 fallback 解析 + 重试   |
| 单次创建消耗过多 Token           | 成本高、速度慢       | Phase 间只传递摘要和关键文件；知识库做摘要而非全文 |
| Phase 1 对话轮次过多             | 用户失去耐心         | AI 主动提供默认选项；右侧显示"已收集/还缺什么"进度 |
| 自动阶段某个 Phase 失败          | 流水线中断           | 自动重试 1 次；仍失败则暂停并通知用户              |
| 自动执行时间过长                 | 用户离开             | 支持后台执行 + 完成通知；前端可随时查看进度        |
| 迭代循环不收敛                   | 无限迭代             | 硬性限制最大迭代次数（默认 2 次）                  |
