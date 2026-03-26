# 实时分析模块 — 架构设计

> **撰写时间**: 2026-03-06
> **版本**: 1.0
> **模块名称**: LiveInsight（实时洞察）

---

## 1. 系统架构全景

```
┌──────────────────────────────────── 前端（Renderer）─────────────────────────────────┐
│                                                                                      │
│  ┌──────────────────┐   ┌─────────────────────┐   ┌──────────────────────────────┐  │
│  │  LiveInsightView  │   │  TemplateManager     │   │  SnapshotTimeline             │  │
│  │  (主视图)         │   │  (模板管理)           │   │  (快照时间线)                  │  │
│  │  ┌──────────────┐│   │  - 创建/编辑模板      │   │  - 快照列表                    │  │
│  │  │ 录音控制面板 ││   │  - 内置模板选择       │   │  - 素材 vs 结果对照            │  │
│  │  │ ASR 文字流   ││   │  - LLM 辅助生成       │   │  - 变化趋势标记               │  │
│  │  │ 分析结果卡片 ││   └─────────────────────┘   └──────────────────────────────┘  │
│  │  │ 操作工具栏   ││                                                                │
│  │  └──────────────┘│   ┌─────────────────────┐   ┌──────────────────────────────┐  │
│  └──────────────────┘   │  SessionList         │   │  SessionDetail                │  │
│                          │  (历史会话列表)       │   │  (会话详情/回顾)              │  │
│                          └─────────────────────┘   └──────────────────────────────┘  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
                               │ IPC / HTTP API
┌──────────────────────────────────── 后端（Main）──────────────────────────────────────┐
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐              │
│  │  LiveInsight 核心                                                   │              │
│  │                                                                     │              │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐    │              │
│  │  │  SessionManager │  │ TemplateStore  │  │ SnapshotStore       │    │              │
│  │  │  (会话管理)     │  │ (模板存储)     │  │ (快照存储)          │    │              │
│  │  └───────────────┘  └───────────────┘  └─────────────────────┘    │              │
│  │                                                                     │              │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐    │              │
│  │  │  TranscriptBuf │  │ AnalysisTrigger│  │ InsightAnalyzer     │    │              │
│  │  │  (文本缓冲)    │  │ (触发控制)     │  │ (分析执行)          │    │              │
│  │  └───────────────┘  └───────────────┘  └─────────────────────┘    │              │
│  │                                                                     │              │
│  └─────────────────────────────────────────────────────────────────────┘              │
│                                                                                      │
│  ┌────────────────┐        ┌────────────────────┐                                    │
│  │  ASR Worker     │        │  ChannelRuntime     │                                    │
│  │  (ws://18100)   │        │  → insight-analyst   │                                    │
│  │  已有，直接复用  │        │    Agent 分析执行    │                                    │
│  └────────────────┘        └────────────────────┘                                    │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 分层架构

### 2.1 层次划分

```
Layer 4: 前端展示层（Vue 3 组件）
    └─ LiveInsightView / TemplateManager / SnapshotTimeline / SessionList

Layer 3: API 网关层（HTTP 路由 + IPC）
    └─ src/main/gateway/http/insight.ts
    └─ src/main/gateway/ipc/insight.ts

Layer 2: 业务逻辑层（核心模块）
    └─ SessionManager / TemplateStore / InsightAnalyzer / SnapshotStore

Layer 1: 基础设施层（已有能力复用）
    └─ ASR Worker / ChannelRuntime / Agent 系统 / 文件存储
```

### 2.2 后端模块职责

| 模块                 | 文件路径                               | 职责                           |
| -------------------- | -------------------------------------- | ------------------------------ |
| **TemplateStore**    | `src/main/insight/TemplateStore.ts`    | 分析模板的 CRUD、内置模板加载  |
| **SessionManager**   | `src/main/insight/SessionManager.ts`   | 洞察会话生命周期管理           |
| **TranscriptBuffer** | `src/main/insight/TranscriptBuffer.ts` | ASR 文本累积、分段管理         |
| **AnalysisTrigger**  | `src/main/insight/AnalysisTrigger.ts`  | 分析触发策略（静音/定时/手动） |
| **InsightAnalyzer**  | `src/main/insight/InsightAnalyzer.ts`  | 调用 Agent 执行分析，解析结果  |
| **SnapshotStore**    | `src/main/insight/SnapshotStore.ts`    | 快照存储与查询                 |
| **InsightReporter**  | `src/main/insight/InsightReporter.ts`  | 会话结束后生成汇总报告         |

---

## 3. 核心类型定义

```typescript
// ============= 分析模板 =============

interface AnalysisTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: 'sales' | 'service' | 'meeting' | 'interview' | 'custom';
  dimensions: AnalysisDimension[];
  analysisPrompt: string; // 总体分析系统提示词
  refreshStrategy: RefreshStrategy;
  outputFormat?: 'card' | 'table' | 'timeline';
  builtIn: boolean; // 是否内置模板
  createdAt: number;
  updatedAt: number;
}

interface AnalysisDimension {
  key: string; // 唯一标识，如 "purchase_intent"
  label: string; // 展示名称，如 "购买意愿"
  type: DimensionType;
  prompt: string; // 该维度的分析提示词
  icon?: string; // 展示图标
  options?: string[]; // enum 类型的选项
  maxItems?: number; // list 类型的最大条目数
  stages?: string[]; // progress 类型的阶段列表
  showTrend?: boolean; // 是否展示与上次的变化趋势
  required?: boolean; // 是否必须输出
}

type DimensionType =
  | 'enum' // 枚举选择
  | 'score' // 数值评分 (0-100)
  | 'text' // 自由文本
  | 'list' // 列表
  | 'boolean' // 是/否
  | 'tags' // 标签组
  | 'progress' // 阶段进度
  | 'comparison'; // 对比变化

interface RefreshStrategy {
  trigger: 'silence' | 'interval' | 'manual' | 'hybrid';
  intervalSeconds?: number; // interval/hybrid 模式的间隔
  minNewChars?: number; // 最少新增字符数才触发
  silenceMs?: number; // silence 模式的静音时长阈值
}

// ============= 洞察会话 =============

interface InsightSession {
  id: string;
  templateId: string;
  templateName: string;
  status: 'recording' | 'paused' | 'analyzing' | 'completed';
  startTime: number;
  endTime?: number;
  transcript: string; // 完整转写文本（持续追加）
  snapshotCount: number; // 快照总数
  latestResult?: AnalysisResult; // 最新分析结果（方便展示）
  metadata?: Record<string, unknown>;
}

// ============= 分析快照 =============

interface AnalysisSnapshot {
  id: string;
  sessionId: string;
  sequence: number; // 快照序号（1, 2, 3...）
  timestamp: number;
  trigger: 'silence' | 'interval' | 'manual';

  // 原始素材
  transcriptRange: {
    start: number; // 起始字符位置
    end: number; // 结束字符位置
  };
  fullTranscript: string; // 截至此刻的完整文本
  newText: string; // 本次新增文本

  // 分析结果
  result: AnalysisResult;
  changes?: DimensionChange[]; // 与上次快照的变化

  // 元信息
  tokenUsage?: { prompt: number; completion: number };
  latencyMs: number; // 分析耗时
}

interface AnalysisResult {
  dimensions: Record<string, DimensionValue>;
  summary?: string; // 总体摘要
  confidence?: number; // 整体置信度 (0-1)
}

interface DimensionValue {
  key: string;
  label: string;
  type: DimensionType;
  value: unknown; // 根据 type 不同：string | number | string[] | boolean
  rawText?: string; // LLM 原始输出文本
}

interface DimensionChange {
  key: string;
  label: string;
  previousValue: unknown;
  currentValue: unknown;
  direction: 'up' | 'down' | 'stable' | 'changed';
}
```

---

## 4. 模块详细设计

### 4.1 TemplateStore — 分析模板管理

**存储路径**：`~/.coobee-data/insight/templates/`

```
~/.coobee-data/insight/
├── templates/
│   ├── _builtin/               ← 内置模板（只读，随应用更新）
│   │   ├── sales-analysis.json
│   │   ├── meeting-notes.json
│   │   ├── interview-eval.json
│   │   └── service-consult.json
│   └── user/                   ← 用户自定义模板
│       ├── my-custom.json
│       └── ...
├── sessions/                   ← 会话数据
│   ├── 2026-03-06/
│   │   ├── session-xxx.json    ← 会话元数据
│   │   └── session-xxx/
│   │       ├── snapshots.json  ← 所有快照
│   │       └── transcript.txt  ← 完整转写文本
│   └── ...
└── reports/                    ← 汇总报告
```

**核心 API**：

```typescript
class TemplateStore {
  listTemplates(): Promise<AnalysisTemplate[]>;
  getTemplate(id: string): Promise<AnalysisTemplate | null>;
  createTemplate(template: Omit<AnalysisTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<AnalysisTemplate>;
  updateTemplate(id: string, updates: Partial<AnalysisTemplate>): Promise<AnalysisTemplate>;
  deleteTemplate(id: string): Promise<void>;
  getBuiltinTemplates(): Promise<AnalysisTemplate[]>;
  generateTemplateWithLLM(description: string): Promise<AnalysisTemplate>;
}
```

### 4.2 TranscriptBuffer — 文本缓冲区

管理从 ASR 接收的文本流，负责累积和分段。

```typescript
class TranscriptBuffer {
  private fullText: string = '';
  private lastAnalyzedPos: number = 0;

  append(text: string): void;
  getFullText(): string;
  getNewTextSinceLastAnalysis(): string;
  getNewCharCount(): number;
  markAnalyzed(): void;
  reset(): void;
}
```

### 4.3 AnalysisTrigger — 分析触发控制

根据配置的刷新策略，决定何时触发一次分析。

```typescript
class AnalysisTrigger {
  private strategy: RefreshStrategy;
  private isAnalyzing: boolean = false;

  constructor(strategy: RefreshStrategy, onTrigger: () => Promise<void>);

  // 外部事件通知
  onSilenceDetected(): void; // ASR 检测到静音
  onNewTextReceived(): void; // 收到新文本
  onManualTrigger(): void; // 用户手动触发

  setAnalyzing(v: boolean): void; // 分析开始/结束通知
  destroy(): void; // 清理定时器
}
```

**触发策略逻辑**：

```
silence 模式：
  当 ASR 检测到静音 && 新字符数 >= minNewChars → 触发

interval 模式：
  每 intervalSeconds 秒检查一次 → 如果新字符数 >= minNewChars → 触发

manual 模式：
  仅用户手动点击触发

hybrid 模式（推荐）：
  (静音检测 OR 定时器) && 新字符数 >= minNewChars → 触发
  同时支持手动触发
```

### 4.4 InsightAnalyzer — 分析执行

调用 Agent 执行分析，解析 LLM 输出为结构化结果。

```typescript
class InsightAnalyzer {
  constructor(private runtime: ChannelRuntime)

  async analyze(params: {
    template: AnalysisTemplate
    fullTranscript: string
    newText: string
    previousResult?: AnalysisResult
    snapshotSequence: number
  }): Promise<{
    result: AnalysisResult
    changes?: DimensionChange[]
    tokenUsage?: { prompt: number; completion: number }
  }>
}
```

**分析 Prompt 构建策略**：

```
System Prompt:
  {template.analysisPrompt}

  你需要分析以下维度：
  {foreach dimension in template.dimensions}
    - {dimension.label}({dimension.key}): {dimension.prompt}
      类型: {dimension.type}
      {if dimension.options} 选项: {dimension.options.join(', ')} {/if}
  {/foreach}

  输出格式要求（严格 JSON）：
  {
    "dimensions": {
      "{key}": { "value": ..., "rawText": "分析依据..." },
      ...
    },
    "summary": "一句话总结当前对话状态",
    "confidence": 0.85
  }

User Message:
  === 完整对话记录 ===
  {fullTranscript}

  === 本次新增内容 ===
  {newText}

  {if previousResult}
  === 上次分析结果（参考） ===
  {JSON.stringify(previousResult)}
  {/if}

  请根据以上对话内容进行分析。
```

### 4.5 SessionManager — 会话管理

```typescript
class SessionManager {
  private activeSessions: Map<string, InsightSession> = new Map();

  async startSession(templateId: string): Promise<InsightSession>;
  async pauseSession(sessionId: string): Promise<void>;
  async resumeSession(sessionId: string): Promise<void>;
  async completeSession(sessionId: string): Promise<InsightSession>;

  async listSessions(filter?: { date?: string; templateId?: string }): Promise<InsightSession[]>;
  async getSession(sessionId: string): Promise<InsightSession | null>;
  async deleteSession(sessionId: string): Promise<void>;

  getActiveSession(): InsightSession | null;
}
```

### 4.6 SnapshotStore — 快照管理

```typescript
class SnapshotStore {
  async saveSnapshot(snapshot: AnalysisSnapshot): Promise<void>;
  async getSnapshots(sessionId: string): Promise<AnalysisSnapshot[]>;
  async getSnapshot(sessionId: string, snapshotId: string): Promise<AnalysisSnapshot | null>;
  async getSnapshotBySequence(sessionId: string, sequence: number): Promise<AnalysisSnapshot | null>;
  async compareSnapshots(sessionId: string, seq1: number, seq2: number): Promise<DimensionChange[]>;
}
```

---

## 5. API 设计

### 5.1 HTTP 路由

```
# 模板管理
GET    /api/insight/templates              → 列出所有模板
GET    /api/insight/templates/:id          → 获取模板详情
POST   /api/insight/templates              → 创建自定义模板
PUT    /api/insight/templates/:id          → 更新模板
DELETE /api/insight/templates/:id          → 删除模板
POST   /api/insight/templates/generate     → LLM 辅助生成模板

# 会话管理
POST   /api/insight/sessions              → 开始新会话（选择模板）
GET    /api/insight/sessions              → 列出历史会话
GET    /api/insight/sessions/:id          → 获取会话详情
PUT    /api/insight/sessions/:id/pause    → 暂停会话
PUT    /api/insight/sessions/:id/resume   → 恢复会话
PUT    /api/insight/sessions/:id/complete → 结束会话
DELETE /api/insight/sessions/:id          → 删除会话

# 分析控制
POST   /api/insight/sessions/:id/analyze  → 手动触发分析
GET    /api/insight/sessions/:id/result   → 获取最新分析结果

# 快照管理
GET    /api/insight/sessions/:id/snapshots          → 获取快照列表
GET    /api/insight/sessions/:id/snapshots/:snapId  → 获取快照详情
GET    /api/insight/sessions/:id/snapshots/compare   → 对比两个快照
```

### 5.2 IPC 通道（实时通信）

```typescript
// 前端 → 后端
'insight:start-session'       → { templateId: string }
'insight:append-transcript'   → { sessionId: string, text: string }
'insight:trigger-analysis'    → { sessionId: string }
'insight:pause-session'       → { sessionId: string }
'insight:complete-session'    → { sessionId: string }

// 后端 → 前端（事件推送）
'insight:analysis-started'    → { sessionId: string, snapshotSequence: number }
'insight:analysis-completed'  → { sessionId: string, snapshot: AnalysisSnapshot }
'insight:analysis-error'      → { sessionId: string, error: string }
'insight:session-updated'     → { session: InsightSession }
```

---

## 6. 前端设计

### 6.1 路由规划

```typescript
// src/renderer/src/router/index.ts 新增
{
  path: '/insight',
  name: 'Insight',
  component: () => import('@/views/InsightView.vue'),
  meta: { title: '实时洞察', icon: 'i-lucide-scan-eye' }
},
{
  path: '/insight/session/:id',
  name: 'InsightSession',
  component: () => import('@/views/InsightSessionView.vue'),
  meta: { title: '洞察详情' }
}
```

### 6.2 主视图布局（InsightView.vue）

```
┌────────────────────────────────────────────────────────────────────┐
│  实时洞察                                    [+ 新会话]  [历史]   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─── 录音区 ──────────────────────────────────────────────────┐  │
│  │  [🔴 录音中]  00:05:32   模板: 销售对话分析   📊 快照: #5   │  │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━ 音量条 ━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │  [⏸ 暂停] [⏹ 结束] [🔄 立即分析]                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─── 实时文字流（左）──────┐  ┌─── 分析结果卡片（右）────────┐  │
│  │                           │  │                                │  │
│  │  你好，今天来看看你们的    │  │  ┌── 🎯 购买意愿 ──────────┐  │  │
│  │  产品...                  │  │  │  一般 → 偏强 ↑            │  │  │
│  │                           │  │  └──────────────────────────┘  │  │
│  │  我们目前用的是 XX 产品， │  │  ┌── 📋 核心需求 ──────────┐  │  │
│  │  但觉得...               │  │  │  · 降低运维成本           │  │  │
│  │                           │  │  │  · 实现自动化              │  │  │
│  │  价格方面能不能优惠...    │  │  │  · 对比竞品方案            │  │  │
│  │                           │  │  └──────────────────────────┘  │  │
│  │  如果能解决 XX 问题，     │  │  ┌── 💰 价格敏感度 ─────────┐  │  │
│  │  可以考虑...              │  │  │  中等                      │  │  │
│  │                           │  │  └──────────────────────────┘  │  │
│  │  ▌ (光标闪烁)             │  │  ┌── 💡 下一步建议 ─────────┐  │  │
│  │                           │  │  │  强调 ROI 数据，展示案例   │  │  │
│  │                           │  │  └──────────────────────────┘  │  │
│  └───────────────────────────┘  └────────────────────────────────┘  │
│                                                                    │
│  ┌─── 快照时间线 ──────────────────────────────────────────────┐  │
│  │  #1 (00:30)  #2 (01:05)  #3 (01:42)  #4 (02:30)  [#5 ●]   │  │
│  │                                                    (当前)    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 6.3 关键前端组件

| 组件                     | 路径                  | 职责                           |
| ------------------------ | --------------------- | ------------------------------ |
| `InsightView.vue`        | `views/`              | 主视图，集成录音+分析          |
| `InsightSessionView.vue` | `views/`              | 历史会话回顾                   |
| `RecordingPanel.vue`     | `components/insight/` | 录音控制面板                   |
| `TranscriptStream.vue`   | `components/insight/` | 实时文字流展示                 |
| `AnalysisResultCard.vue` | `components/insight/` | 分析结果卡片（动态渲染维度）   |
| `DimensionRenderer.vue`  | `components/insight/` | 单维度渲染器（根据 type 展示） |
| `SnapshotTimeline.vue`   | `components/insight/` | 快照时间线导航                 |
| `SnapshotDiff.vue`       | `components/insight/` | 快照对比视图                   |
| `TemplateSelector.vue`   | `components/insight/` | 模板选择/创建对话框            |
| `TemplateEditor.vue`     | `components/insight/` | 模板编辑器（维度配置）         |
| `SessionListPanel.vue`   | `components/insight/` | 历史会话列表                   |

### 6.4 DimensionRenderer 组件（核心渲染器）

根据维度类型动态渲染不同 UI：

```
enum     → 彩色标签 + 趋势箭头       "购买意愿: [偏强 ↑]"
score    → 进度条 + 数值               "匹配度: ━━━━━━━━━━ 78/100"
text     → 文本段落                    "总结: 客户对方案有兴趣..."
list     → 有序列表                    "· 降低成本  · 自动化  · 对比方案"
boolean  → 图标指示                    "决策者在场: ✅"
tags     → 标签组                      "[价格] [品质] [服务]"
progress → 步骤条                      "了解 → [对比] → 谈判 → 签约"
comparison → 对比箭头                  "从 '观望' 变为 '偏强' ↑"
```

---

## 7. 智能体设计

### 7.1 insight-analyst Agent

负责执行实时分析的专业 Agent。

```yaml
id: insight-analyst
name: 实时洞察分析师
description: >
  根据分析模板和对话文本，执行结构化的实时洞察分析。
  能够从对话内容中提取关键信息，判断情感倾向，
  识别业务意图，并以结构化格式输出分析结果。

instructions: |
  你是一个专业的实时对话分析师。你的任务是根据给定的分析模板，
  对对话内容进行结构化分析。

  核心原则：
  1. 严格按照模板定义的维度进行分析
  2. 区分口语化闲聊和业务相关内容
  3. 关注上下文变化和趋势
  4. 输出必须是严格的 JSON 格式
  5. 对于信息不足的维度，使用"信息不足"标注而非猜测

model:
  primary: gpt-4o-mini
  fallback: [deepseek-chat]

skills: []
tools: []
```

### 7.2 template-designer Agent

辅助用户设计分析模板的 Agent。

```yaml
id: template-designer
name: 模板设计师
description: >
  根据用户的场景描述，自动设计合适的分析模板，
  包括维度定义、分析提示词和刷新策略。

instructions: |
  你是一个分析模板设计专家。用户会描述一个场景，
  你需要设计出完整的分析模板，包括：
  1. 3-8 个关键分析维度
  2. 每个维度的类型、提示词、展示配置
  3. 合适的刷新策略
  4. 总体分析提示词

  输出格式必须是 AnalysisTemplate 的 JSON 结构。

model:
  primary: gpt-4o
  fallback: [deepseek-chat]
```

---

## 8. 内置模板示例

### 8.1 销售对话分析

```json
{
  "id": "sales-analysis",
  "name": "销售对话分析",
  "description": "分析销售场景中的客户意向、需求和购买信号",
  "icon": "💼",
  "category": "sales",
  "dimensions": [
    {
      "key": "purchase_intent",
      "label": "购买意愿",
      "type": "enum",
      "options": ["强烈", "偏强", "一般", "观望", "拒绝"],
      "icon": "🎯",
      "prompt": "综合对话中的语气、措辞和提问，判断客户购买意愿。区分礼貌性表达和真实意图。",
      "showTrend": true,
      "required": true
    },
    {
      "key": "core_needs",
      "label": "核心需求",
      "type": "list",
      "maxItems": 5,
      "icon": "📋",
      "prompt": "提取客户直接或间接表达的业务需求，过滤闲聊内容。",
      "required": true
    },
    {
      "key": "price_sensitivity",
      "label": "价格敏感度",
      "type": "enum",
      "options": ["高", "中", "低", "未提及"],
      "icon": "💰",
      "prompt": "根据客户是否主动询价、对价格的反应、预算相关话题判断。",
      "showTrend": true
    },
    {
      "key": "decision_stage",
      "label": "决策阶段",
      "type": "progress",
      "stages": ["了解", "对比", "评估", "谈判", "签约"],
      "icon": "🔄",
      "prompt": "根据对话深度和客户关注点，判断客户处于哪个决策阶段。"
    },
    {
      "key": "competitor_mentions",
      "label": "竞品提及",
      "type": "tags",
      "icon": "⚠️",
      "prompt": "提取对话中提到的竞争对手产品或方案名称。"
    },
    {
      "key": "next_action",
      "label": "下一步建议",
      "type": "text",
      "icon": "💡",
      "prompt": "基于当前对话进展，给销售人员最紧急的 1-2 条建议。",
      "required": true
    }
  ],
  "analysisPrompt": "你是一位资深销售分析专家。你正在实时监听一场销售对话。对话内容可能包含口语化表达、闲聊和离题内容，你需要从中提取有价值的销售信号。请保持客观，基于事实分析，不要过度推断。",
  "refreshStrategy": {
    "trigger": "hybrid",
    "intervalSeconds": 45,
    "minNewChars": 80,
    "silenceMs": 2000
  },
  "builtIn": true
}
```

### 8.2 会议纪要

```json
{
  "id": "meeting-notes",
  "name": "会议纪要",
  "description": "实时提取会议要点、决策和行动项",
  "icon": "📝",
  "category": "meeting",
  "dimensions": [
    {
      "key": "current_topic",
      "label": "当前议题",
      "type": "text",
      "icon": "🗣️",
      "prompt": "识别当前正在讨论的主题或议题。",
      "required": true
    },
    {
      "key": "decisions",
      "label": "已做决定",
      "type": "list",
      "maxItems": 10,
      "icon": "✅",
      "prompt": "提取对话中明确达成一致的决定。"
    },
    {
      "key": "action_items",
      "label": "行动项",
      "type": "list",
      "maxItems": 10,
      "icon": "📌",
      "prompt": "提取待办事项，尽量包含负责人和截止时间。"
    },
    {
      "key": "open_issues",
      "label": "待解决问题",
      "type": "list",
      "icon": "❓",
      "prompt": "提取尚未达成一致或需要后续跟进的问题。"
    },
    {
      "key": "summary",
      "label": "进展摘要",
      "type": "text",
      "icon": "📄",
      "prompt": "用 2-3 句话概括到目前为止的会议进展。",
      "required": true
    }
  ],
  "analysisPrompt": "你是一位专业的会议记录员。你正在实时记录一场会议。请从对话中提取关键信息，忽略寒暄和重复内容。对于行动项，尽量标注提到的负责人。",
  "refreshStrategy": {
    "trigger": "hybrid",
    "intervalSeconds": 60,
    "minNewChars": 120,
    "silenceMs": 3000
  },
  "builtIn": true
}
```

---

## 9. 数据存储设计

### 9.1 会话数据结构

```json
// ~/.coobee-data/insight/sessions/2026-03-06/session-abc123.json
{
  "id": "session-abc123",
  "templateId": "sales-analysis",
  "templateName": "销售对话分析",
  "status": "completed",
  "startTime": 1709715600000,
  "endTime": 1709719200000,
  "snapshotCount": 12,
  "latestResult": { ... },
  "metadata": {
    "duration": "01:00:00",
    "totalChars": 8500,
    "totalTokens": 4200,
    "totalSnapshots": 12,
    "passedSnapshots": 10
  }
}
```

### 9.2 快照数据结构

```json
// ~/.coobee-data/insight/sessions/2026-03-06/session-abc123/snapshots.json
{
  "sessionId": "session-abc123",
  "snapshots": [
    {
      "id": "snap-001",
      "sequence": 1,
      "timestamp": 1709715630000,
      "trigger": "silence",
      "transcriptRange": { "start": 0, "end": 500 },
      "newText": "你好，今天来看看你们的产品...",
      "result": {
        "dimensions": {
          "purchase_intent": { "key": "purchase_intent", "label": "购买意愿", "type": "enum", "value": "观望" },
          "core_needs": { "key": "core_needs", "label": "核心需求", "type": "list", "value": ["了解产品"] }
        },
        "summary": "客户处于初步了解阶段",
        "confidence": 0.7
      },
      "latencyMs": 2300
    }
  ]
}
```

---

## 10. 实现路线图

### Phase 1：核心闭环（MVP）

**目标**：实现"录音 → 转写 → 分析 → 展示"的基本闭环

| 任务                                           | 预估工作量 |
| ---------------------------------------------- | ---------- |
| 后端：TemplateStore（内置模板加载）            | 0.5 天     |
| 后端：SessionManager + SnapshotStore           | 1 天       |
| 后端：TranscriptBuffer + AnalysisTrigger       | 0.5 天     |
| 后端：InsightAnalyzer（Agent 调用 + 结果解析） | 1 天       |
| 后端：HTTP API 路由                            | 0.5 天     |
| 后端：insight-analyst Agent 定义               | 0.5 天     |
| 前端：InsightView 主视图                       | 1.5 天     |
| 前端：录音面板 + 文字流                        | 0.5 天     |
| 前端：AnalysisResultCard + DimensionRenderer   | 1 天       |
| 前端：SnapshotTimeline                         | 0.5 天     |
| 测试                                           | 1 天       |
| **Phase 1 合计**                               | **~8 天**  |

### Phase 2：模板系统 + 历史回顾

| 任务                                              | 预估工作量  |
| ------------------------------------------------- | ----------- |
| 前端：模板编辑器 UI                               | 1.5 天      |
| 后端：自定义模板 CRUD                             | 0.5 天      |
| 后端：LLM 辅助生成模板（template-designer Agent） | 1 天        |
| 前端：历史会话列表 + 详情页                       | 1 天        |
| 前端：快照对比视图                                | 1 天        |
| 后端：InsightReporter（汇总报告）                 | 0.5 天      |
| **Phase 2 合计**                                  | **~5.5 天** |

### Phase 3：进阶能力

| 任务                            | 预估工作量 |
| ------------------------------- | ---------- |
| 增量分析 + 混合模式             | 1 天       |
| 多维度并行分析                  | 0.5 天     |
| 流式分析结果展示                | 1 天       |
| 会话导出（Markdown / PDF）      | 0.5 天     |
| 与 Brain 知识库集成（经验沉淀） | 1 天       |
| **Phase 3 合计**                | **~4 天**  |

---

## 11. 技术决策总结

| 决策点       | 选择                         | 理由                             |
| ------------ | ---------------------------- | -------------------------------- |
| 模块名称     | LiveInsight（实时洞察）      | 语义清晰，通用性强               |
| 分析引擎     | Agent（insight-analyst）     | 复用现有 Agent 体系，可配置模型  |
| 存储方式     | JSON 文件                    | 轻量、与现有 training/brain 一致 |
| 前端通信     | IPC 事件推送                 | 实时性好，避免轮询               |
| 默认刷新策略 | hybrid（静音+定时）          | 平衡实时性和成本                 |
| 分析模式     | Phase 1 全量，Phase 3 混合   | MVP 优先可靠性                   |
| ASR          | 复用现有 Worker              | 已有且稳定                       |
| 模板管理     | 内置 + 自定义 + LLM 辅助生成 | 三种方式覆盖不同用户需求         |
