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

## 3. 设计原则：一切皆 Markdown 文件

### 3.1 文件落地原则

**所有产出都以 Markdown 文件落地**，不使用数据库、不使用 JSON 数据文件。

- 每个 Phase 的产出是**一组 .md 文件**
- 会话状态用一个 `00-session.md` 文件记录（YAML frontmatter + Markdown 正文）
- 用户可以在界面上**看到所有自动产生的文件**，点击即可查看内容
- 文件使用**统一的编号命名规范**：`{编号}-{名称}.md`

### 3.2 统一命名规范

所有文件按照 `{编号}-{名称}.md` 格式命名，编号按 Phase 分段：

| Phase             | 编号范围 | 示例                                                          |
| ----------------- | -------- | ------------------------------------------------------------- |
| 会话信息          | `00-`    | `00-session.md`                                               |
| Phase 1: 需求分析 | `01-`    | `01-requirements.md`, `01-input-spec.md`, `01-output-spec.md` |
| Phase 2: 方案设计 | `02-`    | `02-plan-a.md`, `02-plan-b.md`, `02-comparison.md`            |
| Phase 3: 实施生成 | `03-`    | `03-v1-SKILL.md`, `03-v1-references.md`                       |
| Phase 4: 验证测试 | `04-`    | `04-v1-validation-report.md`                                  |
| Phase 5: 迭代优化 | `05-`    | `05-iteration-v1-to-v2.md`                                    |
| Phase 6: 发布     | `06-`    | `06-release-summary.md`                                       |

### 3.3 完整的会话目录结构

```
.home/creation/sessions/{sessionId}/
│
├── 00-session.md                      # 会话元信息（状态、进度、时间线）
│
├── 01-requirements.md                 # 【标准】需求文档
├── 01-input-spec.md                   # 【标准】输入规范
├── 01-output-spec.md                  # 【标准】输出规范
├── 01-criteria.md                     # 【标准】验收标准（量化维度）
├── 01-chat-history.md                 # Phase 1 对话记录
├── 01-glossary.md                     # 【可选】术语表
├── 01-examples.md                     # 【可选】示例数据集
├── 01-skill-plan.md                   # 【可选】Skill 编排计划（Agent 创建时）
│
├── 02-plan-a.md                       # 方案 A
├── 02-plan-b.md                       # 方案 B
├── 02-plan-c.md                       # 方案 C
├── 02-comparison.md                   # 方案对比分析
├── 02-selection.md                    # 方案选择及理由
│
├── 03-v1-SKILL.md                     # V1 版本产物（主文件）
├── 03-v1-references.md                # V1 参考资料
├── 03-v1-test-cases.md                # V1 测试用例
│
├── 04-v1-validation-report.md         # V1 验证报告
│
├── 05-iteration-v1-to-v2.md           # 迭代记录（V1→V2 的改动和原因）
│
├── 03-v2-SKILL.md                     # V2 版本产物（迭代后）
├── 03-v2-references.md                # V2 参考资料
├── 03-v2-test-cases.md                # V2 测试用例
│
├── 04-v2-validation-report.md         # V2 验证报告
│
├── 06-release-summary.md              # 发布摘要（最终产物清单 + 创建报告）
│
└── knowledge/                         # 用户提供的知识库文件（原始副本）
    ├── sales-manual.md
    └── talk-templates.txt
```

### 3.4 `00-session.md` 格式

会话状态也用 Markdown 文件记录：

```markdown
---
id: 'creation-20260306-001'
targetType: skill
name: '销售话术分析'
status: autopilot
currentPhase: implement
createdAt: 2026-03-06T10:30:00Z
updatedAt: 2026-03-06T10:35:00Z
---

# 创建会话：销售话术分析 Skill

## 进度

| Phase      | 状态      | 开始时间 | 完成时间 | 耗时  |
| ---------- | --------- | -------- | -------- | ----- |
| ① 需求分析 | ✅ 完成   | 10:30    | 10:33    | 3分钟 |
| ② 方案设计 | ✅ 完成   | 10:33    | 10:34    | 1分钟 |
| ③ 实施生成 | 🔄 进行中 | 10:34    | -        | -     |
| ④ 验证测试 | ○ 等待    | -        | -        | -     |
| ⑤ 迭代优化 | ○ 等待    | -        | -        | -     |
| ⑥ 发布     | ○ 等待    | -        | -        | -     |

## 知识库

- `knowledge/sales-manual.md` — 销售手册
- `knowledge/talk-templates.txt` — 话术模板

## 需求摘要

创建一个销售话术分析技能，能够从客户沟通录音文本中提取话术质量、客户意图...
```

后端通过解析 YAML frontmatter 获取结构化数据，通过 Markdown 正文展示人类可读的状态信息。

### 3.5 各 Phase 产出文件示例

#### `01-criteria.md` — 验收标准

```markdown
# 验收标准

## 评估维度

| 维度     | 权重 | 达标线 | 说明                       |
| -------- | ---- | ------ | -------------------------- |
| 准确性   | 30%  | ≥ 85分 | 核心功能覆盖率达到预期     |
| 完整度   | 25%  | ≥ 80分 | 所有定义的场景均有处理逻辑 |
| 格式规范 | 15%  | ≥ 90分 | 符合 SKILL.md 结构规范     |
| 可用性   | 20%  | ≥ 80分 | 无需额外说明即可使用       |
| 鲁棒性   | 10%  | ≥ 70分 | 边界情况有明确处理         |

## 总分达标线

总分 ≥ 80 且无单维度低于 60 → 通过
```

#### `04-v1-validation-report.md` — 验证报告

```markdown
---
version: v1
overallScore: 72
passed: false
---

# 验证报告 — V1

## 评分

| 维度     | 得分 | 达标线 | 结果 | 说明                 |
| -------- | ---- | ------ | ---- | -------------------- |
| 准确性   | 80   | ≥ 85   | ❌   | 缺少对复杂场景的覆盖 |
| 完整度   | 70   | ≥ 80   | ❌   | 异常处理逻辑不完整   |
| 格式规范 | 95   | ≥ 90   | ✅   | 格式符合标准         |
| 可用性   | 65   | ≥ 80   | ❌   | 部分指令描述模糊     |
| 鲁棒性   | 50   | ≥ 70   | ❌   | 无边界处理说明       |

## 场景测试

### 场景 1：标准销售对话分析

- **结果**：✅ 通过
- **输出**：正确识别了购买意愿和主要关注点

### 场景 2：包含闲聊的混合对话

- **结果**：❌ 未通过
- **输出**：未能正确过滤无关内容

## 薄弱点

1. 异常处理逻辑不完整
2. 边界情况未覆盖
3. 部分指令描述模糊

## 改进建议

1. 补充边界情况处理
2. 优化指令描述的清晰度
3. 增加混合内容过滤逻辑
```

### 3.6 知识库

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

用户在 Phase 1 对话中可以随时添加知识库条目。知识库文件存储在 `knowledge/` 子目录下。

## 4. 流程引擎设计

### 4.1 CreationPipeline 核心逻辑

```typescript
class CreationPipeline {
  private static PHASES: PhaseId[] = ['requirements', 'design', 'implement', 'validate', 'iterate', 'release'];

  private static PHASE_AGENTS: Record<PhaseId, string> = {
    requirements: 'requirements-analyst',
    design: 'solution-designer',
    implement: 'skill-builder', // 或 agent-builder，根据 targetType
    validate: 'quality-validator',
    iterate: 'iteration-optimizer',
    release: 'creation-orchestrator'
  };

  // 所有状态通过读写 00-session.md 的 YAML frontmatter 维护
  async start(userRequirement: string, targetType: 'skill' | 'agent'): Promise<string>;
  async launchAutopilot(sessionId: string): Promise<void>; // Phase 1 完成后启动
  async pause(sessionId: string): Promise<void>;
  async resume(sessionId: string): Promise<void>;
  async rerunPhase(sessionId: string, phaseId: PhaseId): Promise<void>;
  async goBackToPhase(sessionId: string, phaseId: PhaseId): Promise<void>;

  // 文件操作
  async listFiles(sessionId: string): Promise<FileInfo[]>; // 扫描目录
  async readFile(sessionId: string, filename: string): Promise<string>;
}

interface FileInfo {
  filename: string; // 如 '01-requirements.md'
  phase: PhaseId; // 根据编号前缀推断
  status: 'completed' | 'writing' | 'pending';
  size: number;
  updatedAt: number;
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

每个 Phase 的 Agent 收到的上下文 = 读取前序 Phase 的 Markdown 文件，拼接成消息：

```typescript
async function buildPhaseMessage(sessionDir: string, phaseId: PhaseId): Promise<string> {
  const files = await fs.readdir(sessionDir);
  let message = '';

  // 读取 00-session.md 获取基本信息
  const sessionMd = await fs.readFile(path.join(sessionDir, '00-session.md'), 'utf-8');
  message += `${sessionMd}\n\n---\n\n`;

  // 按编号顺序读取前序 Phase 的文件
  const currentPhaseNum = PHASE_NUM_MAP[phaseId]; // design=2, implement=3, ...
  const priorFiles = files
    .filter((f) => f.endsWith('.md') && f !== '00-session.md')
    .filter((f) => parseInt(f.split('-')[0]) < currentPhaseNum)
    .sort();

  for (const file of priorFiles) {
    const content = await fs.readFile(path.join(sessionDir, file), 'utf-8');
    message += `## 📄 ${file}\n\n${content}\n\n---\n\n`;
  }

  // 知识库摘要
  const knowledgeDir = path.join(sessionDir, 'knowledge');
  if (await exists(knowledgeDir)) {
    const kFiles = await fs.readdir(knowledgeDir);
    message += `## 📁 知识库（${kFiles.length} 个文件）\n\n`;
    for (const kf of kFiles) {
      const kContent = await fs.readFile(path.join(knowledgeDir, kf), 'utf-8');
      message += `### ${kf}\n\n${kContent.slice(0, 2000)}\n\n`; // 截断防止 context 过长
    }
  }

  // Phase-specific 指令
  message += getPhaseSpecificPrompt(phaseId);

  return message;
}
```

核心思路：**一切数据来源于文件，一切产出写入文件**。Agent 读文件获取上下文，Agent 产出写成新的文件。

## 5. 持久化设计

### 5.1 纯文件存储

所有数据存储在文件系统中，**不使用任何数据库**。

```
.home/creation/sessions/
├── {sessionId}/                       # 每个创建会话一个目录
│   ├── 00-session.md                  # 会话元信息（YAML frontmatter）
│   ├── 01-*.md                        # Phase 1 产出文件
│   ├── 02-*.md                        # Phase 2 产出文件
│   ├── 03-*.md                        # Phase 3 产出文件
│   ├── 04-*.md                        # Phase 4 产出文件
│   ├── 05-*.md                        # Phase 5 产出文件
│   ├── 06-*.md                        # Phase 6 产出文件
│   └── knowledge/                     # 知识库文件
└── {sessionId2}/
    └── ...
```

后端通过文件系统操作（`fs.readdir`、`fs.readFile`、`fs.writeFile`）完成所有持久化。

会话列表 = 扫描 `sessions/` 目录下的子目录，读取每个 `00-session.md` 的 YAML frontmatter。

### 5.2 与最终产物的关系

Phase 6（发布）将最终版本的产物文件复制到正式目录：

- Skill → `skills/{skill-name}/SKILL.md`（+ references/ 等）
- Agent → `agents/{agentId}.json` + `homes/{agentId}/`（IDENTITY.md 等）

同时在正式产物目录下创建 `.creation/` 目录，存放创建过程的摘要引用。

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

# 文件浏览（所有产出都是文件，前端需要读取和展示）
GET    /gateway/creation/sessions/:id/files          # 列出会话下所有文件（名称+状态）
GET    /gateway/creation/sessions/:id/files/:name    # 读取单个文件内容（渲染 Markdown）

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
creation:chat-response      { sessionId, message, isComplete }      // AI 回复（流式）
creation:requirements-ready { sessionId, files[] }                  // 标准化文件集生成完毕

# 文件事件（前端文件树实时更新的关键）
creation:file-created       { sessionId, filename, phase }          // 新文件生成
creation:file-updated       { sessionId, filename }                 // 文件内容更新
creation:file-writing       { sessionId, filename, progress }       // 文件正在写入（大文件）

# 自动执行事件
creation:phase-started      { sessionId, phaseId, agentId }
creation:phase-progress     { sessionId, phaseId, message }         // Agent 中间状态
creation:phase-complete     { sessionId, phaseId, summary }
creation:needs-attention    { sessionId, phaseId, reason }          // 失败或需要干预
creation:completed          { sessionId, files[], report }
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

### 7.3 阶段 B：自动执行面板 + 文件浏览器

Phase 1 完成后，界面切换为三栏布局：左侧文件树、中间进度/预览、右侧详情。

```
┌──────────────────────────────────────────────────────────────────────┐
│  创建 Skill — 销售话术分析                              [暂停] [×]    │
├──────────┬──────────────────────────────────┬────────────────────────┤
│          │                                  │                        │
│  📁 文件  │   进度 & 预览                     │   文件内容              │
│          │                                  │                        │
│  ✅ 00-  │  ┌─ Phase 进度 ──────────────┐   │  # 01-requirements.md  │
│  session │  │ ✅ ① 需求分析   3分钟      │   │                        │
│          │  │ ✅ ② 方案设计   1分钟      │   │  ## 核心目标            │
│  ✅ 01-  │  │ 🔄 ③ 实施生成  进行中...  │   │  分析销售场景中的       │
│  require │  │ ○  ④ 验证测试              │   │  客户沟通话术质量...    │
│  ments   │  │ ○  ⑤ 迭代优化              │   │                        │
│  ✅ 01-  │  │ ○  ⑥ 发布                  │   │  ## 使用场景            │
│  input-  │  └────────────────────────────┘   │  1. 电话销售录音分析    │
│  spec    │                                  │  2. 在线客服对话分析    │
│  ✅ 01-  │  ┌─ 当前阶段 ────────────────┐   │  ...                    │
│  output- │  │ ③ 正在生成：               │   │                        │
│  spec    │  │ ✅ 03-v1-SKILL.md          │   │                        │
│  ✅ 01-  │  │ 🔄 03-v1-references.md     │   │                        │
│  criteria│  │ ○  03-v1-test-cases.md     │   │                        │
│          │  └────────────────────────────┘   │                        │
│  ✅ 02-  │                                  │                        │
│  plan-a  │  实时预览：                       │                        │
│  ✅ 02-  │  ┌──────────────────────────┐    │                        │
│  plan-b  │  │ # 销售话术分析            │    │                        │
│  ✅ 02-  │  │ ## 使用场景              │    │                        │
│  compari │  │ 当需要分析客户沟通...    │    │                        │
│  son     │  └──────────────────────────┘    │                        │
│  🔄 03-  │                                  │                        │
│  v1-SKIL │                                  │                        │
│  L       │                                  │                        │
│          │                                  │                        │
│  📁 know │                                  │                        │
│  ledge/  │                                  │                        │
│          │                                  │                        │
├──────────┴──────────────────────────────────┴────────────────────────┤
│  [暂停]  [返回上一步]  全部文件 12 个，已生成 8 个                      │
└──────────────────────────────────────────────────────────────────────┘
```

**文件浏览器的 UX 关键点**：

1. **实时更新** — 每当 Agent 生成一个新文件，文件树自动刷新，新文件出现并带有动画
2. **状态图标** — ✅ 已完成、🔄 生成中、○ 等待生成
3. **点击查看** — 点击任意文件，右侧面板渲染 Markdown 内容
4. **按编号排序** — 文件天然按 `01-`, `02-`, `03-`... 排序，清晰展示创建流程
5. **knowledge/ 目录** — 知识库文件独立展示，用户上传的参考资料一目了然

### 7.4 创建完成界面

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✅ 创建完成 — 销售话术分析 Skill                                      │
├──────────┬───────────────────────────────────────────────────────────┤
│          │                                                           │
│  📁 全部  │  📊 创建报告                                              │
│  文件     │                                                           │
│  (16个)   │  验证评分：87/100 (✅ 通过)                                │
│          │  迭代次数：1（V1 72分 → V2 87分）                          │
│  00-...  │  总耗时：8分钟                                             │
│  01-...  │  选用方案：B "渐进式分析"                                  │
│  01-...  │                                                           │
│  01-...  │  ┌─ 最终产物 ─────────────────────────────────────────┐   │
│  01-...  │  │  📄 03-v2-SKILL.md              → skills/目标目录   │   │
│  02-...  │  │  📄 03-v2-references.md         → skills/目标目录   │   │
│  02-...  │  │  📄 03-v2-test-cases.md         → skills/目标目录   │   │
│  02-...  │  └────────────────────────────────────────────────────┘   │
│  03-...  │                                                           │
│  03-...  │  ┌─ 全流程文件 ───────────────────────────────────────┐   │
│  04-...  │  │  ← 点击左侧文件树查看任意阶段的完整产出             │   │
│  05-...  │  └────────────────────────────────────────────────────┘   │
│  06-...  │                                                           │
│          │  [发布到技能库] [继续训练] [重新创建]                       │
│  📁 know │                                                           │
│  ledge/  │                                                           │
│          │                                                           │
└──────────┴───────────────────────────────────────────────────────────┘
```

### 7.5 前端组件结构

| 组件                      | 用途                           | 所在阶段      |
| ------------------------- | ------------------------------ | ------------- |
| `CreationWizardView.vue`  | 主视图，管理阶段切换和整体布局 | 全局          |
| `RequirementsChat.vue`    | 对话界面 + 消息列表            | 阶段 A        |
| `KnowledgePanel.vue`      | 知识库管理（上传/删除）        | 阶段 A        |
| `RequirementsSummary.vue` | 已确认信息的实时摘要           | 阶段 A        |
| `FileTree.vue`            | 文件浏览器树形结构             | 阶段 B + 完成 |
| `FileViewer.vue`          | Markdown 文件内容渲染          | 阶段 B + 完成 |
| `AutopilotProgress.vue`   | Phase 2-6 进度 + 实时预览      | 阶段 B        |
| `CreationReport.vue`      | 创建完成后的报告               | 完成          |

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
