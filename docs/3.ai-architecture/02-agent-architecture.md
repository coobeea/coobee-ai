# Coobee AI 智能体底层架构设计

> 基于 `@openai/agents` 框架的智能体系统架构规划
>
> 创建时间：2026-02-04
> 版本：v1.0.0

---

## 📋 目录

- [1. 架构概览](#1-架构概览)
- [2. 核心模块设计](#2-核心模块设计)
- [3. 目录结构](#3-目录结构)
- [4. 智能体系统](#4-智能体系统)
- [5. Skills 技能系统](#5-skills-技能系统)
- [6. 多智能体构建系统](#6-多智能体构建系统)
- [7. 工具系统](#7-工具系统)
- [8. 会话管理](#8-会话管理)
- [9. MCP 集成](#9-mcp-集成)
- [10. 工具审批最佳实践](#10-工具审批最佳实践)
- [11. 数据流设计](#11-数据流设计)
- [12. 消息推送方案设计](#12-消息推送方案设计)
- [13. 长时任务与质量保障系统](#13-长时任务与质量保障系统)
- [14. 实现路线图](#14-实现路线图)

---

## 1. 架构概览

### 1.1 设计原则

- **模块化**：各模块职责清晰，低耦合高内聚
- **可扩展**：支持新智能体、新工具的快速接入
- **类型安全**：完整的 TypeScript 类型定义
- **性能优先**：流式输出、异步处理、资源复用
- **后台优先**：⭐ 聚焦后台实现，前台 UI 暂缓开发
- **非阻塞**：工具审批不阻塞主流程，采用智能决策 + 异步队列

### 1.2 技术栈

```typescript
{
  "core": "@openai/agents",        // OpenAI Agents 框架
  "llm": "@anthropic-ai/sdk",      // Claude SDK
  "mcp": "@modelcontextprotocol",  // MCP 协议
  "database": ["better-sqlite3", "duckdb"],
  "validation": "zod",
  "runtime": "Electron + Node.js"
}
```

### 1.3 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process (前端)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Chat UI    │  │  Task UI     │  │  Settings    │      │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘      │
│         └─────────────────┴──────────────────┘              │
│                           │                                 │
│                    IPC 通信 (ipcMain/ipcRenderer)          │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                     Main Process (后端)                      │
│                           │                                 │
│  ┌────────────────────────▼──────────────────────────┐     │
│  │              Agent Runtime Layer                   │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │     │
│  │  │ Session  │  │  Agent   │  │  Tool        │   │     │
│  │  │ Manager  │  │  Manager │  │  Registry    │   │     │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │     │
│  └───────┼─────────────┼────────────────┼───────────┘     │
│          │             │                │                 │
│  ┌───────▼─────────────▼────────────────▼───────────┐     │
│  │              Core Services Layer                   │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │     │
│  │  │ LLM      │  │  Memory  │  │  MCP         │   │     │
│  │  │ Client   │  │  Service │  │  Integration │   │     │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │     │
│  └───────┼─────────────┼────────────────┼───────────┘     │
│          │             │                │                 │
│  ┌───────▼─────────────▼────────────────▼───────────┐     │
│  │              Data & Storage Layer                  │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │     │
│  │  │ SQLite   │  │  DuckDB  │  │  File        │   │     │
│  │  │ (会话)   │  │ (分析)   │  │  System      │   │     │
│  │  └──────────┘  └──────────┘  └──────────────┘   │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块设计

### 2.1 Agent Runtime Layer (智能体运行时层)

**职责**：管理智能体的生命周期、会话状态、工具调用

**核心组件**：

1. **SessionManager** - 会话管理器
   - 创建/恢复/销毁会话
   - 维护对话历史
   - 会话持久化（SQLite）

2. **AgentManager** - 智能体管理器
   - 智能体注册/发现
   - 智能体路由（Triage Agent）
   - 智能体交接（Handoff）

3. **ToolRegistry** - 工具注册表
   - 工具注册/查询
   - 工具权限管理
   - 工具执行追踪

4. **SkillManager** - 技能管理器
   - 技能注册/发现
   - 技能执行编排
   - 技能版本管理

5. **MultiAgentBuilder** - 多智能体构建器
   - 智能体模板管理
   - 动态智能体创建
   - 智能体编排与协作

### 2.2 Core Services Layer (核心服务层)

**职责**：提供底层能力支持

**核心组件**：

1. **LLMClient** - 大模型客户端
   - 统一的 LLM 调用接口
   - 支持多模型切换（Claude, GPT, DeepSeek）
   - 流式输出处理
   - Token 计数与限流

2. **MemoryService** - 记忆服务
   - 短期记忆（当前会话）
   - 长期记忆（跨会话检索）
   - 向量化存储（可选）
   - 记忆压缩策略

3. **MCPIntegration** - MCP 集成
   - MCP Server 管理
   - 工具动态发现
   - 协议适配

### 2.3 Data & Storage Layer (数据存储层)

**职责**：数据持久化与查询

**核心组件**：

1. **SQLite** - 结构化数据存储
   - 会话历史
   - 用户配置
   - 工具调用记录

2. **DuckDB** - 分析型数据库
   - Token 使用统计
   - 性能分析
   - 日志查询

3. **FileSystem** - 文件系统
   - 上传文件管理
   - 临时文件清理
   - 文件索引

---

## 3. 目录结构

```
src/main/ai/                    # AI 智能体核心模块（推荐名称）
├── agents/                     # 智能体定义
│   ├── triage/                # 分发智能体
│   │   ├── TriageAgent.ts    # 主分发逻辑
│   │   └── types.ts
│   ├── chat/                  # 对话智能体
│   │   ├── ChatAgent.ts
│   │   └── prompts.ts
│   ├── research/              # 研究智能体
│   │   ├── ResearchAgent.ts
│   │   └── tools.ts
│   ├── code/                  # 代码智能体
│   │   ├── CodeAgent.ts
│   │   └── executors.ts
│   └── index.ts              # 智能体统一导出
│
├── skills/                    # 技能系统
│   ├── registry/             # 技能注册表
│   │   ├── SkillRegistry.ts
│   │   └── types.ts
│   ├── executor/             # 技能执行器
│   │   ├── SkillExecutor.ts
│   │   └── context.ts
│   ├── builtin/              # 内置技能
│   │   ├── research/         # 研究技能
│   │   ├── coding/           # 编程技能
│   │   ├── writing/          # 写作技能
│   │   └── analysis/         # 分析技能
│   ├── custom/               # 自定义技能
│   │   └── README.md
│   └── index.ts
│
├── tools/                     # 工具集合
│   ├── web-search/           # 联网搜索
│   │   ├── WebSearchTool.ts
│   │   └── providers.ts
│   ├── file-ops/             # 文件操作
│   │   ├── FileReadTool.ts
│   │   ├── FileWriteTool.ts
│   │   └── FileSearchTool.ts
│   ├── code-exec/            # 代码执行
│   │   ├── CodeInterpreterTool.ts
│   │   └── sandbox.ts
│   ├── database/             # 数据库查询
│   │   ├── SQLQueryTool.ts
│   │   └── DuckDBTool.ts
│   └── index.ts              # 工具统一导出
│
├── builder/                   # 多智能体构建器
│   ├── templates/            # 智能体模板
│   │   ├── TeamTemplate.ts   # 团队模板
│   │   ├── PipelineTemplate.ts # 流水线模板
│   │   └── types.ts
│   ├── orchestrator/         # 编排器
│   │   ├── TeamOrchestrator.ts
│   │   ├── WorkflowEngine.ts
│   │   └── types.ts
│   ├── factory/              # 工厂模式
│   │   ├── AgentFactory.ts
│   │   └── types.ts
│   └── index.ts
│
├── runtime/                   # 运行时管理
│   ├── SessionManager.ts     # 会话管理
│   ├── AgentManager.ts       # 智能体管理
│   ├── ToolRegistry.ts       # 工具注册表
│   ├── SkillManager.ts       # 技能管理
│   ├── MultiAgentBuilder.ts  # 多智能体构建
│   └── index.ts
│
├── services/                  # 核心服务
│   ├── llm/                  # LLM 服务
│   │   ├── LLMClient.ts
│   │   ├── ClaudeProvider.ts
│   │   ├── GPTProvider.ts
│   │   └── types.ts
│   ├── memory/               # 记忆服务
│   │   ├── MemoryService.ts
│   │   ├── ShortTermMemory.ts
│   │   ├── LongTermMemory.ts
│   │   └── types.ts
│   └── mcp/                  # MCP 集成
│       ├── MCPManager.ts
│       ├── ServerRegistry.ts
│       └── types.ts
│
├── storage/                   # 数据存储
│   ├── SessionStore.ts       # 会话存储
│   ├── MemoryStore.ts        # 记忆存储
│   ├── schemas.sql           # 数据库 Schema
│   └── types.ts
│
├── types/                     # 类型定义
│   ├── agent.ts              # 智能体类型
│   ├── session.ts            # 会话类型
│   ├── tool.ts               # 工具类型
│   └── index.ts
│
├── utils/                     # 工具函数
│   ├── streaming.ts          # 流式处理
│   ├── validation.ts         # 参数验证
│   ├── retry.ts              # 重试逻辑
│   └── index.ts
│
└── index.ts                   # 模块统一导出
```

---

## 4. 智能体系统

### 4.1 智能体分类

```typescript
// 智能体类型定义
export enum AgentType {
  TRIAGE = 'triage', // 分发智能体（路由）
  CHAT = 'chat', // 通用对话智能体
  RESEARCH = 'research', // 研究智能体（联网搜索）
  CODE = 'code', // 代码智能体（代码生成/执行）
  ANALYSIS = 'analysis', // 数据分析智能体
  CREATIVE = 'creative' // 创意智能体（写作/绘画）
}

// 智能体配置
export interface AgentConfig {
  type: AgentType
  name: string
  description: string
  instructions: string
  tools: string[] // 工具 ID 列表
  handoffs: string[] // 可交接的智能体 ID
  modelSettings?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
}
```

### 4.2 智能体协作模式

#### 模式 1：Triage 分发模式 ⭐ 推荐

```
用户请求 → Triage Agent → 识别意图 → 分发到专业 Agent
                ↓
          [Chat Agent]
          [Research Agent]
          [Code Agent]
```

**优点**：

- 清晰的职责划分
- 易于扩展新智能体
- 用户无需手动选择

**示例代码结构**：

```typescript
// Triage Agent 负责路由
const triageAgent = new Agent({
  name: 'Triage Agent',
  instructions: `根据用户请求，判断应该使用哪个专业智能体：
    - 普通对话 → Chat Agent
    - 需要搜索信息 → Research Agent  
    - 代码相关 → Code Agent`,
  handoffs: [chatAgent, researchAgent, codeAgent]
})

// 专业智能体可以交接回 Triage
chatAgent.handoffs = [triageAgent]
researchAgent.handoffs = [triageAgent]
codeAgent.handoffs = [triageAgent]
```

#### 模式 2：直接调用模式

```
用户明确指定 → 直接调用对应 Agent → 执行任务
```

**适用场景**：

- 用户明确知道要用哪个智能体
- 通过 UI 按钮直接选择

### 4.3 智能体生命周期

```typescript
// 1. 创建阶段
agent = AgentManager.createAgent(config)

// 2. 运行阶段
session = SessionManager.createSession()
result = await agent.run(input, { session })

// 3. 交接阶段（可选）
if (result.handoff) {
  nextAgent = result.handoff.targetAgent
  result = await nextAgent.run(result.history, { session })
}

// 4. 结束阶段
session.save()
```

---

## 5. Skills 技能系统

### 5.1 什么是 Skill？

**Skill（技能）**是一个封装了**特定能力的可复用单元**，它比单个工具更高级，可以包含：

- 多个工具的组合调用
- 特定的执行逻辑和流程
- 领域专业知识和提示词
- 上下文管理和状态维护

**举例**：

```typescript
// ❌ 工具：单一功能
WebSearchTool - 只负责搜索

// ✅ 技能：完整能力
ResearchSkill - 包含：
  1. 搜索多个来源
  2. 内容提取与整理
  3. 信息验证与交叉对比
  4. 生成结构化报告
```

### 5.2 Skill vs Tool 对比

| 维度         | Tool（工具） | Skill（技能）    |
| ------------ | ------------ | ---------------- |
| **粒度**     | 原子操作     | 复合能力         |
| **复杂度**   | 简单         | 复杂             |
| **组合性**   | 被组合       | 组合工具         |
| **示例**     | `web_search` | `research_skill` |
| **适用场景** | 单一操作     | 完整任务         |

### 5.3 Skill 架构设计

```typescript
// Skill 定义接口
export interface Skill {
  id: string // 技能 ID
  name: string // 技能名称
  category: SkillCategory // 技能分类
  description: string // 技能描述
  version: string // 版本号

  // 技能依赖
  dependencies: {
    tools: string[] // 依赖的工具
    skills?: string[] // 依赖的其他技能
    agents?: AgentType[] // 依赖的智能体类型
  }

  // 技能配置
  config: {
    prompts: SkillPrompts // 专用提示词
    parameters: ZodSchema // 输入参数定义
    settings?: SkillSettings // 技能设置
  }

  // 执行器
  executor: SkillExecutor // 技能执行逻辑

  // 元数据
  metadata: {
    author?: string
    tags?: string[]
    examples?: SkillExample[]
  }
}

// 技能分类
export enum SkillCategory {
  RESEARCH = 'research', // 研究类
  CODING = 'coding', // 编程类
  WRITING = 'writing', // 写作类
  ANALYSIS = 'analysis', // 分析类
  CREATIVE = 'creative', // 创意类
  CUSTOM = 'custom' // 自定义类
}
```

### 5.4 内置技能示例

#### 5.4.1 研究技能（Research Skill）

```typescript
export const ResearchSkill: Skill = {
  id: 'research_skill',
  name: '深度研究助手',
  category: SkillCategory.RESEARCH,
  description: '执行深度主题研究，整合多源信息',
  version: '1.0.0',

  dependencies: {
    tools: ['web_search', 'web_scrape', 'file_write'],
    agents: [AgentType.RESEARCH]
  },

  config: {
    prompts: {
      system: `你是一个专业的研究助手，擅长：
        1. 多角度信息收集
        2. 来源可信度评估
        3. 信息交叉验证
        4. 结构化报告生成`,
      workflow: [
        '1. 理解研究主题和目标',
        '2. 制定研究计划（关键词、来源）',
        '3. 执行搜索并收集信息',
        '4. 分析和验证信息',
        '5. 生成研究报告'
      ]
    },
    parameters: z.object({
      topic: z.string(),
      depth: z.enum(['basic', 'intermediate', 'deep']),
      sources: z.array(z.string()).optional(),
      outputFormat: z.enum(['markdown', 'pdf', 'json']).default('markdown')
    })
  },

  executor: async (input, context) => {
    const { topic, depth, sources } = input

    // 1. 制定研究计划
    const plan = await context.agent.run(`制定研究计划：${topic}`)

    // 2. 执行搜索
    const searchResults = await context.tools.web_search({
      query: topic,
      maxResults: depth === 'deep' ? 20 : 10
    })

    // 3. 提取内容
    const contents = await Promise.all(
      searchResults.map((url) => context.tools.web_scrape({ url }))
    )

    // 4. 分析整合
    const report = await context.agent.run(`整合以下信息，生成研究报告：\n${contents.join('\n\n')}`)

    // 5. 保存报告
    await context.tools.file_write({
      path: `research_${topic}_${Date.now()}.md`,
      content: report
    })

    return { report, sources: searchResults }
  },

  metadata: {
    author: 'Coobee AI Team',
    tags: ['research', 'analysis', 'reporting'],
    examples: [
      {
        name: '技术研究',
        input: {
          topic: 'Rust 内存安全机制',
          depth: 'deep'
        }
      }
    ]
  }
}
```

#### 5.4.2 编程技能（Coding Skill）

```typescript
export const CodingSkill: Skill = {
  id: 'coding_skill',
  name: '全栈开发助手',
  category: SkillCategory.CODING,
  description: '从需求到实现的完整开发流程',
  version: '1.0.0',

  dependencies: {
    tools: ['code_execute', 'file_write', 'file_read'],
    agents: [AgentType.CODE]
  },

  config: {
    prompts: {
      system: `你是一个专业的全栈开发工程师，擅长：
        1. 需求分析与设计
        2. 代码实现与优化
        3. 测试用例编写
        4. 文档生成`,
      workflow: ['1. 理解需求', '2. 设计架构', '3. 实现代码', '4. 编写测试', '5. 生成文档']
    },
    parameters: z.object({
      requirement: z.string(),
      language: z.enum(['typescript', 'python', 'rust']),
      includeTests: z.boolean().default(true),
      outputPath: z.string()
    })
  },

  executor: async (input, context) => {
    // 实现逻辑...
  }
}
```

### 5.5 Skill 管理器

```typescript
class SkillManager {
  private skills: Map<string, Skill>

  // 注册技能
  register(skill: Skill): void {
    // 验证依赖
    this.validateDependencies(skill)
    // 注册技能
    this.skills.set(skill.id, skill)
  }

  // 执行技能
  async execute(skillId: string, input: any, context: SkillContext): Promise<any> {
    const skill = this.skills.get(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)

    // 验证输入参数
    const validated = skill.config.parameters.parse(input)

    // 准备执行上下文
    const execContext = {
      ...context,
      tools: this.prepareTools(skill.dependencies.tools),
      agent: this.prepareAgent(skill.dependencies.agents)
    }

    // 执行技能
    return await skill.executor(validated, execContext)
  }

  // 获取技能列表
  list(filter?: SkillFilter): Skill[] {
    let skills = Array.from(this.skills.values())

    if (filter?.category) {
      skills = skills.filter((s) => s.category === filter.category)
    }

    return skills
  }

  // 技能组合执行
  async executeChain(skillIds: string[], initialInput: any): Promise<any> {
    let result = initialInput

    for (const skillId of skillIds) {
      result = await this.execute(skillId, result, context)
    }

    return result
  }
}
```

### 5.6 自定义 Skill 开发

用户可以通过配置文件创建自定义技能：

```typescript
// custom-skills/my-skill.ts
import { defineSkill } from '@/ai/skills'

export default defineSkill({
  id: 'my_custom_skill',
  name: '我的自定义技能',
  category: SkillCategory.CUSTOM,
  description: '...',

  dependencies: {
    tools: ['web_search']
  },

  config: {
    prompts: {
      system: '...'
    },
    parameters: z.object({
      // ...
    })
  },

  executor: async (input, context) => {
    // 自定义执行逻辑
  }
})
```

---

## 6. 多智能体构建系统

### 6.1 为什么需要多智能体？

**单智能体的局限性**：

- 能力单一，无法处理复杂任务
- 上下文过长，性能下降
- 难以实现专业分工

**多智能体的优势**：

- ✅ **分工协作** - 每个智能体专注特定领域
- ✅ **并行处理** - 多个任务同时执行
- ✅ **可扩展性** - 易于添加新能力
- ✅ **容错性** - 单个智能体失败不影响整体

### 6.2 多智能体协作模式

#### 模式 1：Team 团队模式

```
Manager Agent (管理者)
    ↓
    ├─→ Research Agent (研究员)
    ├─→ Code Agent (开发者)
    └─→ Writer Agent (文档专员)
```

**特点**：

- 有明确的管理者
- 任务分配由管理者决定
- 适合项目型任务

**示例**：构建一个完整的应用

```typescript
const appDevTeam = createTeam({
  manager: new Agent({
    name: 'Project Manager',
    instructions: '协调团队完成应用开发'
  }),
  members: [
    {
      agent: researchAgent,
      role: '需求分析'
    },
    {
      agent: codeAgent,
      role: '代码实现'
    },
    {
      agent: testAgent,
      role: '测试验证'
    },
    {
      agent: writerAgent,
      role: '文档编写'
    }
  ]
})

const result = await appDevTeam.execute({
  task: '开发一个 Todo 应用'
})
```

#### 模式 2：Pipeline 流水线模式

```
Input → Agent A → Agent B → Agent C → Output
```

**特点**：

- 线性执行流程
- 前一个智能体的输出是后一个的输入
- 适合有明确步骤的任务

**示例**：文章生成流水线

```typescript
const articlePipeline = createPipeline([
  {
    agent: researchAgent,
    task: '研究主题，收集资料'
  },
  {
    agent: outlineAgent,
    task: '生成文章大纲'
  },
  {
    agent: writerAgent,
    task: '根据大纲撰写文章'
  },
  {
    agent: editorAgent,
    task: '审阅和优化文章'
  }
])

const article = await articlePipeline.run({
  topic: 'AI 技术发展趋势'
})
```

#### 模式 3：Parallel 并行模式

```
         Input
           ↓
    ┌──────┼──────┐
    ↓      ↓      ↓
Agent A  Agent B  Agent C
    ↓      ↓      ↓
    └──────┼──────┘
           ↓
      Aggregator
           ↓
        Output
```

**特点**：

- 多个智能体并行执行
- 结果汇总合并
- 适合需要多角度分析的任务

**示例**：多语言翻译

```typescript
const translationTeam = createParallel({
  agents: [
    { agent: chineseAgent, language: 'zh' },
    { agent: englishAgent, language: 'en' },
    { agent: frenchAgent, language: 'fr' }
  ],
  aggregator: (results) => {
    // 合并翻译结果
    return results
  }
})

const translations = await translationTeam.execute({
  text: 'Hello World'
})
```

#### 模式 4：Dynamic 动态模式

```
Router Agent → 动态选择 → [Agent Pool] → 执行
```

**特点**：

- 根据任务特征动态选择智能体
- 智能体池动态扩展
- 适合任务类型多变的场景

### 6.3 多智能体构建器

```typescript
class MultiAgentBuilder {
  // 创建团队
  createTeam(config: TeamConfig): AgentTeam {
    return new AgentTeam({
      manager: config.manager,
      members: config.members,
      strategy: 'hierarchical' // 层级式管理
    })
  }

  // 创建流水线
  createPipeline(stages: PipelineStage[]): AgentPipeline {
    return new AgentPipeline({
      stages,
      strategy: 'sequential' // 顺序执行
    })
  }

  // 创建并行组
  createParallel(config: ParallelConfig): ParallelAgents {
    return new ParallelAgents({
      agents: config.agents,
      aggregator: config.aggregator,
      strategy: 'concurrent' // 并发执行
    })
  }

  // 创建动态路由
  createRouter(config: RouterConfig): AgentRouter {
    return new AgentRouter({
      router: config.routerAgent,
      pool: config.agentPool,
      strategy: 'dynamic' // 动态路由
    })
  }
}
```

### 6.4 智能体模板系统

```typescript
// 预定义模板
export const AgentTemplates = {
  // 软件开发团队
  SOFTWARE_DEV_TEAM: {
    name: 'Software Development Team',
    agents: {
      pm: { type: AgentType.CHAT, role: 'Product Manager' },
      dev: { type: AgentType.CODE, role: 'Developer' },
      qa: { type: AgentType.CODE, role: 'QA Engineer' }
    },
    workflow: 'hierarchical'
  },

  // 内容创作流水线
  CONTENT_PIPELINE: {
    name: 'Content Creation Pipeline',
    stages: [
      { agent: AgentType.RESEARCH, task: 'research' },
      { agent: AgentType.CREATIVE, task: 'writing' },
      { agent: AgentType.CHAT, task: 'editing' }
    ],
    workflow: 'sequential'
  },

  // 多语言翻译组
  TRANSLATION_GROUP: {
    name: 'Translation Group',
    agents: {
      zh: { type: AgentType.CHAT, language: 'zh' },
      en: { type: AgentType.CHAT, language: 'en' },
      ja: { type: AgentType.CHAT, language: 'ja' }
    },
    workflow: 'parallel'
  }
}

// 使用模板
const team = MultiAgentBuilder.fromTemplate(AgentTemplates.SOFTWARE_DEV_TEAM, {
  /* 自定义配置 */
})
```

### 6.5 智能体编排引擎

```typescript
class AgentOrchestrator {
  // 执行团队任务
  async executeTeam(team: AgentTeam, task: any): Promise<any> {
    // 1. 管理者分解任务
    const subtasks = await team.manager.run(`分解任务：${task}`)

    // 2. 分配给团队成员
    const assignments = this.assignTasks(subtasks, team.members)

    // 3. 并行执行
    const results = await Promise.all(assignments.map(({ agent, task }) => agent.run(task)))

    // 4. 管理者汇总结果
    const final = await team.manager.run(`汇总结果：${JSON.stringify(results)}`)

    return final
  }

  // 执行流水线
  async executePipeline(pipeline: AgentPipeline, input: any): Promise<any> {
    let result = input

    for (const stage of pipeline.stages) {
      result = await stage.agent.run(result)
    }

    return result
  }

  // 执行并行任务
  async executeParallel(parallel: ParallelAgents, input: any): Promise<any> {
    const results = await Promise.all(parallel.agents.map((agent) => agent.run(input)))

    return parallel.aggregator(results)
  }
}
```

### 6.6 实战案例：研究报告生成系统

```typescript
// 创建研究团队
const researchTeam = MultiAgentBuilder.createTeam({
  manager: new Agent({
    name: 'Research Lead',
    instructions: '协调团队完成研究任务'
  }),
  members: [
    {
      agent: new Agent({
        name: 'Data Collector',
        instructions: '收集相关资料',
        tools: ['web_search', 'web_scrape']
      }),
      role: '数据收集'
    },
    {
      agent: new Agent({
        name: 'Analyzer',
        instructions: '分析数据并提取洞察',
        tools: ['duckdb_analyze']
      }),
      role: '数据分析'
    },
    {
      agent: new Agent({
        name: 'Report Writer',
        instructions: '撰写研究报告',
        tools: ['file_write']
      }),
      role: '报告撰写'
    }
  ]
})

// 执行研究任务
const report = await researchTeam.execute({
  topic: 'AI 在医疗领域的应用',
  depth: 'deep',
  outputFormat: 'pdf'
})
```

---

## 7. 工具系统

### 7.1 工具分类

```typescript
export enum ToolCategory {
  WEB = 'web', // 联网工具（搜索、爬虫）
  FILE = 'file', // 文件操作（读写、搜索）
  CODE = 'code', // 代码工具（执行、调试）
  DATABASE = 'database', // 数据库工具（查询、分析）
  SYSTEM = 'system', // 系统工具（截图、剪贴板）
  CUSTOM = 'custom' // 自定义工具
}

export interface ToolConfig {
  id: string
  name: string
  category: ToolCategory
  description: string
  parameters: ZodSchema // Zod Schema 定义参数
  execute: ToolExecutor // 执行函数
  requiresApproval?: boolean // 是否需要人工审批
  dangerous?: boolean // 是否为危险操作
}
```

### 7.2 核心工具列表

#### 7.2.1 联网工具

```typescript
// 1. 网页搜索
WebSearchTool {
  name: 'web_search',
  description: '搜索互联网获取最新信息',
  parameters: {
    query: string,
    maxResults?: number
  }
}

// 2. 网页抓取
WebScrapeTool {
  name: 'web_scrape',
  description: '抓取指定网页内容',
  parameters: {
    url: string,
    selector?: string
  }
}
```

#### 7.2.2 文件工具

```typescript
// 1. 读取文件
FileReadTool {
  name: 'file_read',
  description: '读取文件内容',
  parameters: {
    path: string,
    encoding?: string
  }
}

// 2. 写入文件
FileWriteTool {
  name: 'file_write',
  description: '写入内容到文件',
  parameters: {
    path: string,
    content: string,
    mode?: 'write' | 'append'
  },
  requiresApproval: true  // 需要用户确认
}

// 3. 文件搜索
FileSearchTool {
  name: 'file_search',
  description: '搜索文件内容',
  parameters: {
    pattern: string,
    directory: string
  }
}
```

#### 7.2.3 代码工具

```typescript
// 1. 代码执行
CodeExecuteTool {
  name: 'code_execute',
  description: '在沙箱环境执行代码',
  parameters: {
    code: string,
    language: 'python' | 'javascript' | 'typescript'
  },
  requiresApproval: true,
  dangerous: true
}

// 2. 代码分析
CodeAnalyzeTool {
  name: 'code_analyze',
  description: '分析代码结构和问题',
  parameters: {
    code: string,
    language: string
  }
}
```

#### 7.2.4 数据库工具

```typescript
// SQLite 查询
SQLQueryTool {
  name: 'sql_query',
  description: '执行 SQLite 查询',
  parameters: {
    sql: string,
    database?: string
  }
}

// DuckDB 分析
DuckDBAnalyzeTool {
  name: 'duckdb_analyze',
  description: '使用 DuckDB 分析数据',
  parameters: {
    query: string
  }
}
```

### 7.3 工具权限与审批系统 ⭐ 重要

#### 7.3.1 设计原则

❌ **不好的方式**：每次工具调用都 Promise 阻塞等待审批

```typescript
// 阻塞主流程，用户体验差
const approved = await requestUserApproval(tool, args)
if (!approved) return { error: 'User denied' }
```

✅ **更好的方式**：多层权限控制 + 智能决策

#### 7.3.2 权限矩阵设计

```typescript
// 三维权限矩阵：用户 × 智能体 × 工具
export interface PermissionMatrix {
  // 用户级别权限
  user: {
    id: string
    role: 'admin' | 'user' | 'guest'
    allowedTools: string[] // 白名单
    deniedTools: string[] // 黑名单
  }

  // 智能体级别权限
  agent: {
    type: AgentType
    trustLevel: 'high' | 'medium' | 'low'
    maxRiskScore: number // 允许的最大风险分
  }

  // 工具级别配置
  tool: {
    name: string
    riskLevel: 'safe' | 'moderate' | 'dangerous'
    riskScore: number // 1-10 分
    autoApprove: boolean // 是否自动批准
    requiresConfirmation: boolean
  }
}
```

#### 7.3.3 智能决策引擎

```typescript
class ToolPermissionEngine {
  /**
   * 智能决策：是否需要用户确认
   */
  async shouldRequestApproval(
    tool: Tool,
    user: User,
    agent: Agent,
    context: ExecutionContext
  ): Promise<ApprovalDecision> {
    // 1. 检查用户白名单（最高优先级）
    if (this.isInWhitelist(user, tool)) {
      return {
        approved: true,
        reason: 'User whitelist',
        requiresConfirmation: false
      }
    }

    // 2. 检查黑名单
    if (this.isInBlacklist(user, tool)) {
      return {
        approved: false,
        reason: 'User blacklist'
      }
    }

    // 3. 计算风险分数
    const riskScore = this.calculateRiskScore(tool, context)

    // 4. 根据风险等级决策
    if (riskScore <= 3) {
      // 低风险：自动批准
      return {
        approved: true,
        reason: 'Low risk',
        requiresConfirmation: false
      }
    } else if (riskScore <= 7) {
      // 中风险：检查智能体信任度
      if (agent.trustLevel === 'high') {
        return {
          approved: true,
          reason: 'Trusted agent',
          requiresConfirmation: false
        }
      } else {
        // 需要确认，但不阻塞
        return {
          approved: false,
          reason: 'Moderate risk',
          requiresConfirmation: true,
          canProceedAfterTimeout: false
        }
      }
    } else {
      // 高风险：必须人工确认
      return {
        approved: false,
        reason: 'High risk',
        requiresConfirmation: true,
        canProceedAfterTimeout: false
      }
    }
  }

  /**
   * 风险评分算法
   */
  private calculateRiskScore(tool: Tool, context: ExecutionContext): number {
    let score = tool.riskScore

    // 根据上下文调整分数
    if (context.isFileSystem && context.path.includes('/System')) {
      score += 3 // 系统路径风险更高
    }

    if (context.isNetwork && !context.url.startsWith('https://')) {
      score += 2 // HTTP 比 HTTPS 风险高
    }

    if (context.isCodeExecution) {
      score += 2 // 代码执行风险高
    }

    return Math.min(score, 10)
  }
}
```

#### 7.3.4 异步审批队列（不阻塞方案）

```typescript
class ApprovalQueue {
  private queue: Map<string, PendingApproval> = new Map()

  /**
   * 添加到审批队列（不阻塞）
   */
  async requestApproval(tool: Tool, args: any, context: ExecutionContext): Promise<string> {
    const requestId = generateId()

    const pending: PendingApproval = {
      id: requestId,
      tool,
      args,
      context,
      status: 'pending',
      createdAt: Date.now()
    }

    this.queue.set(requestId, pending)

    // 发送通知到前端（不等待）
    this.notifyUI({
      type: 'approval_request',
      requestId,
      tool: tool.name,
      args,
      riskScore: context.riskScore
    })

    return requestId
  }

  /**
   * 用户审批（异步）
   */
  async approve(requestId: string, approved: boolean): Promise<void> {
    const pending = this.queue.get(requestId)
    if (!pending) return

    pending.status = approved ? 'approved' : 'rejected'
    pending.resolvedAt = Date.now()

    // 继续执行工具
    if (approved) {
      await this.executeToolAfterApproval(pending)
    }
  }

  /**
   * 批量审批（预授权模式）
   */
  async approvePattern(pattern: ApprovalPattern): Promise<void> {
    // 例如：批准所有 web_search 调用
    // 或：批准所有读取 ~/Documents 的 file_read 调用
    this.patterns.push(pattern)
  }
}
```

#### 7.3.5 工具执行流程（优化后）

```typescript
async function executeToolWithPermission(
  tool: Tool,
  args: any,
  context: ExecutionContext
): Promise<ToolResult> {
  // 1. 参数验证
  const validated = tool.parameters.parse(args)

  // 2. 智能权限决策
  const decision = await PermissionEngine.shouldRequestApproval(
    tool,
    context.user,
    context.agent,
    context
  )

  // 3. 根据决策处理
  if (decision.approved) {
    // 直接执行，不阻塞
    return await tool.execute(validated, context)
  }

  if (decision.requiresConfirmation) {
    // 加入审批队列（异步，不阻塞主流程）
    const requestId = await ApprovalQueue.requestApproval(tool, validated, context)

    // 返回等待状态
    return {
      status: 'pending_approval',
      requestId,
      message: `工具 ${tool.name} 需要确认，已加入审批队列`
    }
  }

  // 4. 拒绝执行
  return {
    status: 'denied',
    reason: decision.reason
  }
}
```

#### 7.3.6 配置化权限管理

```typescript
// 用户配置文件
export interface UserPermissionConfig {
  // 全局设置
  global: {
    autoApproveLevel: 'none' | 'low' | 'medium' | 'all'
    defaultTimeout: number // 审批超时时间（秒）
  }

  // 工具白名单
  whitelist: {
    tools: string[] // 永远允许的工具
    patterns: string[] // 允许的模式（如 'file_read:/Users/lifeng/**'）
  }

  // 工具黑名单
  blacklist: {
    tools: string[] // 永远禁止的工具
    patterns: string[]
  }

  // 智能体信任列表
  trustedAgents: {
    [agentId: string]: {
      trustLevel: 'high' | 'medium' | 'low'
      allowedTools: string[]
    }
  }
}

// 示例配置
const userConfig: UserPermissionConfig = {
  global: {
    autoApproveLevel: 'medium', // 中低风险自动批准
    defaultTimeout: 300 // 5 分钟超时
  },

  whitelist: {
    tools: ['web_search', 'file_read'],
    patterns: [
      'file_read:~/Documents/**', // 允许读取 Documents
      'web_search:https://**' // 允许 HTTPS 搜索
    ]
  },

  blacklist: {
    tools: [],
    patterns: [
      'file_write:/System/**', // 禁止写系统目录
      'code_execute:**' // 禁止代码执行
    ]
  },

  trustedAgents: {
    chat_agent: {
      trustLevel: 'high',
      allowedTools: ['web_search', 'file_read', 'file_write']
    }
  }
}
```

#### 7.3.7 工具风险等级定义

```typescript
// 工具风险配置
export const TOOL_RISK_CONFIG: Record<string, ToolRiskConfig> = {
  // 低风险（自动批准）
  web_search: {
    riskLevel: 'safe',
    riskScore: 2,
    autoApprove: true
  },
  file_read: {
    riskLevel: 'safe',
    riskScore: 3,
    autoApprove: true,
    contextualRisks: {
      '/System/**': 8, // 系统目录风险高
      '~/.ssh/**': 9 // SSH 密钥风险极高
    }
  },

  // 中风险（视智能体信任度）
  file_write: {
    riskLevel: 'moderate',
    riskScore: 5,
    autoApprove: false,
    contextualRisks: {
      '/System/**': 10,
      '~/.config/**': 7
    }
  },
  web_scrape: {
    riskLevel: 'moderate',
    riskScore: 4,
    autoApprove: false
  },

  // 高风险（必须确认）
  code_execute: {
    riskLevel: 'dangerous',
    riskScore: 8,
    autoApprove: false,
    requiresConfirmation: true
  },
  file_delete: {
    riskLevel: 'dangerous',
    riskScore: 9,
    autoApprove: false,
    requiresConfirmation: true
  },
  shell: {
    riskLevel: 'dangerous',
    riskScore: 10,
    autoApprove: false,
    requiresConfirmation: true
  }
}
```

#### 7.3.8 智能学习机制（可选）

```typescript
class PermissionLearningEngine {
  /**
   * 从用户历史决策中学习
   */
  async learnFromHistory(userId: string): Promise<void> {
    const history = await this.getApprovalHistory(userId)

    // 分析用户总是批准的模式
    const alwaysApproved = this.findPatterns(history.filter((h) => h.approved))

    // 自动添加到白名单
    for (const pattern of alwaysApproved) {
      if (pattern.confidence > 0.9) {
        await this.addToWhitelist(userId, pattern)
      }
    }

    // 分析用户总是拒绝的模式
    const alwaysDenied = this.findPatterns(history.filter((h) => !h.approved))

    // 自动添加到黑名单
    for (const pattern of alwaysDenied) {
      if (pattern.confidence > 0.9) {
        await this.addToBlacklist(userId, pattern)
      }
    }
  }
}
```

---

## 8. 会话管理

### 8.1 会话数据结构

```typescript
export interface Session {
  id: string // 会话 ID
  userId: string // 用户 ID
  agentId: string // 当前智能体 ID
  history: AgentInputItem[] // 对话历史
  context: SessionContext // 会话上下文
  metadata: SessionMetadata // 元数据
  createdAt: Date
  updatedAt: Date
}

export interface SessionContext {
  variables: Record<string, any> // 上下文变量
  memory: {
    short: Message[] // 短期记忆（当前会话）
    long: MemoryItem[] // 长期记忆（相关历史）
  }
}

export interface SessionMetadata {
  title?: string // 会话标题
  tags?: string[] // 标签
  tokenUsage: {
    input: number
    output: number
    total: number
  }
}
```

### 6.2 会话管理操作

```typescript
class SessionManager {
  // 创建会话
  async createSession(userId: string, agentId: string): Promise<Session>

  // 恢复会话
  async loadSession(sessionId: string): Promise<Session>

  // 保存会话
  async saveSession(session: Session): Promise<void>

  // 添加消息到历史
  async appendMessage(sessionId: string, message: Message): Promise<void>

  // 获取会话列表
  async listSessions(userId: string, filter?: SessionFilter): Promise<Session[]>

  // 删除会话
  async deleteSession(sessionId: string): Promise<void>

  // 压缩历史（超出 Token 限制时）
  async compressHistory(session: Session, maxTokens: number): Promise<Session>
}
```

### 6.3 会话持久化

```sql
-- sessions 表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  context JSON,
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- messages 表
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'tool'
  content TEXT,
  tool_calls JSON,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 索引
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_messages_session_id ON messages(session_id);
```

---

## 9. MCP 集成

### 9.1 MCP 架构

```
┌─────────────────────────────────────────┐
│         Coobee AI (MCP Client)          │
│  ┌──────────────────────────────────┐   │
│  │        MCPManager                │   │
│  │  - 管理 MCP Server 连接          │   │
│  │  - 工具发现与注册                │   │
│  │  - 协议适配                      │   │
│  └──────────────┬───────────────────┘   │
│                 │                        │
└─────────────────┼────────────────────────┘
                  │ MCP Protocol
      ┌───────────┼───────────┐
      │           │           │
┌─────▼────┐ ┌────▼────┐ ┌───▼──────┐
│  File    │ │  Git    │ │  Search  │
│  MCP     │ │  MCP    │ │  MCP     │
│  Server  │ │  Server │ │  Server  │
└──────────┘ └─────────┘ └──────────┘
```

### 7.2 MCP Server 管理

```typescript
class MCPManager {
  private servers: Map<string, MCPServer>

  // 注册 MCP Server
  async registerServer(config: MCPServerConfig): Promise<void> {
    const server = await MCPServer.connect(config)
    this.servers.set(config.id, server)

    // 发现工具
    const tools = await server.listTools()
    tools.forEach((tool) => ToolRegistry.register(tool))
  }

  // 调用 MCP 工具
  async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    const server = this.servers.get(serverId)
    return await server.callTool(toolName, args)
  }

  // 断开连接
  async disconnect(serverId: string): Promise<void> {
    const server = this.servers.get(serverId)
    await server.disconnect()
    this.servers.delete(serverId)
  }
}
```

### 7.3 MCP 工具适配

```typescript
// 将 MCP 工具转换为 Agent 工具格式
function adaptMCPTool(mcpTool: MCPToolDefinition): ToolConfig {
  return {
    id: `mcp_${mcpTool.name}`,
    name: mcpTool.name,
    category: ToolCategory.CUSTOM,
    description: mcpTool.description,
    parameters: convertMCPSchema(mcpTool.inputSchema),
    execute: async (args, context) => {
      const result = await MCPManager.callTool(mcpTool.serverId, mcpTool.name, args)
      return result
    }
  }
}
```

---

## 10. 工具审批最佳实践 ⭐ 重点

### 10.1 问题背景

**传统方案的问题**：

- 使用 Promise 阻塞等待用户审批
- 主流程被挂起，无法继续执行
- 用户体验差，智能体"卡住"

### 10.2 解决方案对比

| 方案             | 优点     | 缺点       | 适用场景          |
| ---------------- | -------- | ---------- | ----------------- |
| **Promise 阻塞** | 简单直接 | 阻塞主流程 | ❌ 不推荐         |
| **配置化白名单** | 无需确认 | 需要预配置 | ✅ 常用工具       |
| **异步审批队列** | 不阻塞   | 实现复杂   | ✅ 偶发高风险操作 |
| **智能风险评估** | 自动决策 | 需要调优   | ✅ 智能化场景     |

### 10.3 推荐方案：混合模式

**设计思路**：

```
工具调用请求
    ↓
┌───────────────────┐
│ 1. 检查白名单      │ → 在白名单 → ✅ 直接执行
└────────┬──────────┘
         ↓ 不在白名单
┌───────────────────┐
│ 2. 风险评分        │
└────────┬──────────┘
         ↓
    风险等级？
    ├─ 低风险 (1-3分) → ✅ 自动批准，直接执行
    ├─ 中风险 (4-7分) → 检查智能体信任度
    │                   ├─ 高信任 → ✅ 直接执行
    │                   └─ 低信任 → 加入审批队列 ⏳
    └─ 高风险 (8-10分) → 加入审批队列 ⏳（必须确认）
```

### 10.4 实现细节

#### 10.4.1 工具调用流程（不阻塞）

```typescript
async function handleToolCall(
  toolCall: ToolCall,
  context: ExecutionContext
): Promise<ToolCallResult> {
  // 步骤 1: 智能决策
  const decision = await PermissionEngine.decide(
    toolCall.tool,
    context.user,
    context.agent,
    toolCall.args
  )

  // 步骤 2: 根据决策处理
  switch (decision.action) {
    case 'approve':
      // 直接执行
      return await executeTool(toolCall)

    case 'defer':
      // 加入队列，不阻塞
      const requestId = await ApprovalQueue.add(toolCall)

      // 通知智能体等待
      return {
        status: 'pending',
        requestId,
        message: `等待用户确认工具 ${toolCall.tool.name}`
      }

    case 'deny':
      // 直接拒绝
      return {
        status: 'denied',
        reason: decision.reason
      }
  }
}

// 用户确认后，从队列恢复执行
async function handleUserApproval(requestId: string, approved: boolean): Promise<void> {
  const pending = ApprovalQueue.get(requestId)

  if (approved) {
    // 执行工具
    const result = await executeTool(pending.toolCall)

    // 继续智能体运行
    await resumeAgentExecution(pending.context, result)
  } else {
    // 拒绝，告知智能体
    await resumeAgentExecution(pending.context, {
      status: 'denied',
      message: '用户拒绝执行该工具'
    })
  }
}
```

#### 10.4.2 智能体感知审批状态

```typescript
// 智能体需要知道工具调用的结果
class Agent {
  async run(input: string, options: RunOptions) {
    // ...

    // 工具调用
    const toolResult = await this.callTool(toolName, args)

    if (toolResult.status === 'pending') {
      // 工具等待审批，智能体先返回提示
      return {
        output: `正在等待用户确认工具调用：${toolName}`,
        status: 'paused',
        pendingRequestId: toolResult.requestId
      }
    }

    // 继续处理...
  }

  // 从暂停状态恢复
  async resume(sessionId: string, toolResult: ToolResult) {
    // 从之前的状态继续执行
    const session = await SessionManager.load(sessionId)

    // 将工具结果加入历史
    session.history.push({
      role: 'tool',
      content: JSON.stringify(toolResult)
    })

    // 继续运行
    return await this.run(session.history, { session })
  }
}
```

#### 10.4.3 用户配置示例

```typescript
// ~/.coobee-ai/permissions.json
{
  "version": "1.0",
  "user": {
    "autoApproveLevel": "medium",  // 自动批准中低风险

    // 白名单：这些工具永远允许
    "whitelist": {
      "tools": [
        "web_search",
        "web_scrape",
        "file_read"
      ],
      "patterns": [
        "file_read:~/Documents/**",
        "file_read:~/Downloads/**",
        "file_write:~/Documents/coobee-output/**"
      ]
    },

    // 黑名单：这些操作永远禁止
    "blacklist": {
      "patterns": [
        "file_write:/System/**",
        "file_delete:/System/**",
        "shell:rm -rf *"
      ]
    },

    // 智能体信任配置
    "trustedAgents": {
      "chat_agent": {
        "trustLevel": "high",
        "allowedTools": ["*"],  // 允许所有工具
        "deniedTools": ["shell", "code_execute"]
      },
      "research_agent": {
        "trustLevel": "medium",
        "allowedTools": ["web_search", "web_scrape", "file_write"]
      }
    }
  }
}
```

### 10.5 优势总结

| 维度         | Promise 阻塞方案 | 智能决策方案 ⭐  |
| ------------ | ---------------- | ---------------- |
| **用户体验** | 差（频繁打断）   | 好（低风险自动） |
| **主流程**   | 阻塞             | 不阻塞           |
| **灵活性**   | 低               | 高（可配置）     |
| **安全性**   | 高               | 高（智能评分）   |
| **学习能力** | 无               | 有（历史学习）   |
| **适用场景** | 简单场景         | 复杂生产环境 ✅  |

---

## 11. 数据流设计

### 11.1 用户消息处理流程

```
1. 用户输入
   ↓
2. IPC 传递到 Main Process
   ↓
3. SessionManager.appendMessage(userMessage)
   ↓
4. AgentManager.route(session)
   ↓
5. Agent.run(session.history)
   ↓
6. [流式输出] → 实时传递到 Renderer
   ↓
7. 工具调用？
   ├─ 是 → ToolRegistry.execute(tool) → 返回步骤5
   └─ 否 → 继续
   ↓
8. 智能体交接？
   ├─ 是 → 切换到新 Agent → 返回步骤5
   └─ 否 → 继续
   ↓
9. 生成最终输出
   ↓
10. SessionManager.saveSession()
    ↓
11. 返回结果到 Renderer
```

### 8.2 流式输出处理

```typescript
// 流式运行
const result = await agent.run(input, {
  stream: true,
  session
})

// 监听流式事件
for await (const event of result) {
  switch (event.type) {
    case 'raw_model_stream_event':
      // 文本增量
      if (event.data.type === 'output_text_delta') {
        sendToRenderer({ type: 'text_delta', delta: event.data.delta })
      }
      break

    case 'tool_call_item':
      // 工具调用
      sendToRenderer({
        type: 'tool_call',
        tool: event.tool.name,
        args: event.args
      })
      break

    case 'handoff_output_item':
      // 智能体交接
      sendToRenderer({
        type: 'handoff',
        from: event.sourceAgent.name,
        to: event.targetAgent.name
      })
      break
  }
}
```

---

## 12. 消息推送方案设计 ⭐⭐⭐ 重点

### 12.1 问题分析

#### 12.1.1 SSE 方案的问题

**场景描述**：

```
1. 用户发起对话，智能体开始执行
2. 后台通过 SSE 推送消息到前端
3. 用户关闭窗口（但主进程仍在运行）
4. 智能体继续在后台执行...
5. 用户重新打开窗口
6. ❌ 问题：窗口关闭期间的消息丢失了！
```

**SSE 方案的致命缺陷**：

- ❌ 连接依赖窗口生命周期
- ❌ 窗口关闭 = 连接断开 = 消息丢失
- ❌ 重新打开时无法恢复中间状态
- ❌ 需要额外实现消息缓冲和重放机制

### 12.2 方案对比

| 方案          | 实时推送 | 窗口关闭后  | 重新打开恢复 | 多窗口同步 | 复杂度 | 推荐度          |
| ------------- | -------- | ----------- | ------------ | ---------- | ------ | --------------- |
| **SSE**       | ✅       | ❌ 连接断开 | ❌ 无法恢复  | ❌         | 中     | ❌ 不推荐       |
| **WebSocket** | ✅       | ❌ 连接断开 | ❌ 无法恢复  | ✅         | 中     | ❌ 不推荐       |
| **IPC + DB**  | ✅       | ✅ 继续运行 | ✅ 完整恢复  | ✅         | 低     | ✅✅✅ 强烈推荐 |
| **轮询**      | ⚠️ 延迟  | ✅          | ✅           | ✅         | 低     | ⚠️ 备选         |

### 12.3 推荐方案：IPC + 数据库持久化

#### 12.3.1 核心思路

```
主进程（后台持续运行）
    ↓
智能体执行 → 消息生成 → 立即存储到 SQLite
    ↓                    ↓
    ├─→ 窗口打开？ → 是 → IPC 推送到前端（实时）
    └─→ 窗口关闭？ → 否 → 只存储，不推送

渲染进程（窗口重新打开）
    ↓
从数据库加载历史消息 → 显示完整对话
    ↓
订阅 IPC 事件 → 接收新消息（实时）
```

**关键特性**：

- ✅ **双重保障**：消息既推送（实时）又存储（持久）
- ✅ **窗口无关**：窗口关闭不影响后台执行
- ✅ **完整恢复**：重新打开时从数据库恢复所有历史
- ✅ **多窗口同步**：所有窗口都能接收同一会话的更新

#### 12.3.2 数据库 Schema

```sql
-- 会话消息表
CREATE TABLE session_messages (
  id TEXT PRIMARY KEY,              -- 消息 ID
  session_id TEXT NOT NULL,         -- 会话 ID
  role TEXT NOT NULL,               -- 'user' | 'assistant' | 'tool'
  content TEXT,                     -- 消息内容
  type TEXT,                        -- 消息类型
  metadata JSON,                    -- 额外信息
  created_at INTEGER NOT NULL,      -- 创建时间
  sequence INTEGER NOT NULL,        -- 消息序号（用于排序）

  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 索引
CREATE INDEX idx_messages_session_sequence
  ON session_messages(session_id, sequence);

-- 流式消息片段表（可选，用于更细粒度的恢复）
CREATE TABLE message_chunks (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (message_id) REFERENCES session_messages(id)
);

CREATE INDEX idx_chunks_message
  ON message_chunks(message_id, chunk_index);
```

#### 12.3.3 实现代码

**后台：消息处理器**

```typescript
class MessageBroadcaster {
  /**
   * 处理智能体输出的消息
   */
  async handleAgentMessage(sessionId: string, message: AgentMessage): Promise<void> {
    // 1. 立即存储到数据库（关键！）
    await this.saveToDatabase(sessionId, message)

    // 2. 尝试推送到前端（如果窗口打开）
    const window = windowManager.getWindowBySessionId(sessionId)

    if (window && !window.isDestroyed()) {
      // 窗口存在，实时推送
      window.webContents.send('agent:message', {
        sessionId,
        message
      })

      log.debug(`[Broadcaster] 消息已推送: sessionId=${sessionId}`)
    } else {
      // 窗口不存在，只存储
      log.debug(`[Broadcaster] 窗口未打开，消息已存储: sessionId=${sessionId}`)
    }
  }

  /**
   * 处理流式消息片段
   */
  async handleStreamChunk(sessionId: string, messageId: string, chunk: string): Promise<void> {
    // 1. 累积到数据库
    await this.appendChunkToDatabase(sessionId, messageId, chunk)

    // 2. 实时推送（如果窗口打开）
    const window = windowManager.getWindowBySessionId(sessionId)

    if (window && !window.isDestroyed()) {
      window.webContents.send('agent:stream-chunk', {
        sessionId,
        messageId,
        chunk
      })
    }
  }

  /**
   * 存储到数据库
   */
  private async saveToDatabase(sessionId: string, message: AgentMessage): Promise<void> {
    const db = await DatabaseService.getConnection()

    await db.execute(
      `
      INSERT INTO session_messages (
        id, session_id, role, content, type, metadata, created_at, sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        message.id,
        sessionId,
        message.role,
        message.content,
        message.type,
        JSON.stringify(message.metadata),
        Date.now(),
        message.sequence
      ]
    )
  }
}
```

**前台：消息加载器**

```typescript
// 窗口打开时的初始化逻辑
async function initializeSession(sessionId: string): Promise<void> {
  // 1. 从数据库加载完整历史消息
  const history = await window.api.session.loadHistory(sessionId)

  // 2. 渲染到 UI
  messageStore.setMessages(history)

  // 3. 订阅实时更新
  window.api.on('agent:message', (event) => {
    if (event.sessionId === sessionId) {
      messageStore.appendMessage(event.message)
    }
  })

  // 4. 订阅流式片段
  window.api.on('agent:stream-chunk', (event) => {
    if (event.sessionId === sessionId) {
      messageStore.appendChunk(event.messageId, event.chunk)
    }
  })

  console.log(`[Session] 已加载 ${history.length} 条历史消息`)
}
```

#### 12.3.4 完整执行流程

**场景 1：窗口一直打开**

```
用户发送消息
    ↓
主进程接收 (IPC)
    ↓
智能体开始执行
    ↓
生成流式输出
    ├─→ 存储到数据库 ✅
    └─→ IPC 推送到前端 ✅
    ↓
前端实时显示 ✅
```

**场景 2：窗口中途关闭**

```
用户发送消息
    ↓
主进程接收 (IPC)
    ↓
智能体开始执行
    ↓
生成流式输出
    ├─→ 存储到数据库 ✅
    └─→ IPC 推送失败（窗口已关闭）❌
    ↓
后台继续执行... ✅
    ↓
用户重新打开窗口
    ↓
从数据库加载完整历史 ✅
    ↓
显示完整对话（包括窗口关闭期间的消息）✅
```

**场景 3：多窗口同步**

```
会话 A 在窗口 1 中打开
    ↓
用户打开窗口 2，也查看会话 A
    ↓
智能体生成新消息
    ├─→ 存储到数据库 ✅
    ├─→ 推送到窗口 1 ✅
    └─→ 推送到窗口 2 ✅
    ↓
两个窗口都实时同步 ✅
```

#### 12.3.5 实现细节

**主进程：智能体执行与广播**

```typescript
class AgentExecutor {
  async executeWithSession(sessionId: string, input: string): Promise<void> {
    const session = await SessionManager.load(sessionId)
    const agent = AgentManager.get(session.agentId)

    // 流式执行
    const result = await agent.run(input, {
      stream: true,
      session
    })

    let currentMessageId = generateId()
    let currentMessage = ''

    // 处理流式事件
    for await (const event of result) {
      if (event.type === 'output_text_delta') {
        // 文本增量
        currentMessage += event.delta

        // 存储 + 推送
        await MessageBroadcaster.handleStreamChunk(sessionId, currentMessageId, event.delta)
      } else if (event.type === 'tool_call_item') {
        // 工具调用
        const toolMessage = {
          id: generateId(),
          role: 'assistant',
          type: 'tool_call',
          content: JSON.stringify(event),
          sequence: session.messageCount++
        }

        await MessageBroadcaster.handleAgentMessage(sessionId, toolMessage)
      } else if (event.type === 'tool_call_output_item') {
        // 工具返回
        const toolResultMessage = {
          id: generateId(),
          role: 'tool',
          type: 'tool_result',
          content: event.output,
          sequence: session.messageCount++
        }

        await MessageBroadcaster.handleAgentMessage(sessionId, toolResultMessage)
      }
    }

    // 保存会话
    await SessionManager.save(session)
  }
}
```

**IPC 接口定义**

```typescript
// preload/index.ts
export const api = {
  session: {
    // 加载会话历史（从数据库）
    loadHistory: (sessionId: string) => ipcRenderer.invoke('session:load-history', sessionId),

    // 发送消息
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke('session:send-message', { sessionId, content }),

    // 订阅实时消息
    onMessage: (callback: (message: AgentMessage) => void) =>
      ipcRenderer.on('agent:message', (_, message) => callback(message)),

    // 订阅流式片段
    onStreamChunk: (callback: (chunk: StreamChunk) => void) =>
      ipcRenderer.on('agent:stream-chunk', (_, chunk) => callback(chunk))
  }
}
```

**主进程：IPC 处理器**

```typescript
// ipc handlers
ipcMain.handle('session:load-history', async (_, sessionId: string) => {
  const db = await DatabaseService.getConnection()

  const messages = await db.query<Message>(
    `
    SELECT * FROM session_messages
    WHERE session_id = ?
    ORDER BY sequence ASC
  `,
    [sessionId]
  )

  return messages
})

ipcMain.handle('session:send-message', async (_, { sessionId, content }) => {
  // 保存用户消息
  await MessageStore.save({
    sessionId,
    role: 'user',
    content,
    sequence: await MessageStore.getNextSequence(sessionId)
  })

  // 异步执行智能体（不阻塞响应）
  AgentExecutor.executeWithSession(sessionId, content).catch((error) => {
    log.error('[Agent] 执行失败:', error)
  })

  return { success: true }
})
```

### 12.4 方案优势总结

#### ✅ IPC + 数据库方案优势

**1. 窗口生命周期无关**

```typescript
// 后台持续运行，不受窗口影响
while (agent.isRunning) {
  const message = await agent.nextMessage()
  await saveToDatabase(message) // 持久化
  await tryPushToWindow(message) // 尝试推送（窗口打开时才推送）
}
```

**2. 完整的历史恢复**

```typescript
// 窗口打开时
onWindowOpen(sessionId) {
  // 从数据库加载完整历史
  const history = await loadFromDatabase(sessionId)

  // 显示所有消息（包括窗口关闭期间的）
  renderMessages(history)

  // 订阅新消息
  subscribeToRealtime(sessionId)
}
```

**3. 多窗口同步**

```typescript
// 广播到所有打开的窗口
function broadcastMessage(sessionId: string, message: Message) {
  const windows = windowManager.getAllWindows()

  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('agent:message', {
        sessionId,
        message
      })
    }
  })
}
```

**4. 断点续传**

```typescript
// 智能体可以从任意断点恢复
async function resumeSession(sessionId: string): Promise<void> {
  // 加载历史
  const history = await MessageStore.load(sessionId)

  // 检查是否有未完成的执行
  const lastMessage = history[history.length - 1]

  if (lastMessage.status === 'executing') {
    // 继续执行
    await agent.resume(sessionId, history)
  }
}
```

### 12.5 SSE 的合理使用场景

虽然不推荐作为主要方案，但 SSE 仍可用于：

**场景 1：日志流式输出**

```typescript
// 实时日志查看（不需要持久化）
app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')

  const listener = (log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`)
  }

  logger.on('log', listener)

  req.on('close', () => {
    logger.off('log', listener)
  })
})
```

**场景 2：系统状态监控**

```typescript
// 控制台窗口实时监控（丢失无所谓）
app.get('/system/monitor', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(getSystemStats())}\n\n`)
  }, 1000)

  req.on('close', () => clearInterval(interval))
})
```

### 12.6 混合方案（可选）

如果确实需要 SSE 作为补充：

```typescript
// 主方案：IPC + DB（核心对话）
// 辅助方案：SSE（实时监控、日志等非关键数据）

class HybridCommunication {
  // 关键消息：IPC + DB
  async sendCriticalMessage(sessionId: string, message: Message): Promise<void> {
    // 存储
    await this.saveToDatabase(message)

    // IPC 推送
    await this.sendViaIPC(message)
  }

  // 非关键数据：SSE
  streamNonCritical(endpoint: string, dataStream: Observable<any>): void {
    // SSE 流式推送（丢失不影响核心功能）
    this.sseServer.stream(endpoint, dataStream)
  }
}
```

### 12.7 推荐架构

```
┌─────────────────────────────────────────────┐
│          Renderer Process (前端)             │
│                                             │
│  初始化:                                     │
│  1. 从 DB 加载历史消息 ✅                    │
│  2. 订阅 IPC 实时消息 ✅                     │
│                                             │
│  运行时:                                     │
│  - 显示完整历史 ✅                           │
│  - 接收实时更新 ✅                           │
│  - 窗口关闭不影响后台 ✅                      │
└──────────────┬──────────────────────────────┘
               │ IPC 双向通信
┌──────────────▼──────────────────────────────┐
│          Main Process (后台)                 │
│                                             │
│  智能体持续运行:                              │
│  ┌──────────┐      ┌──────────┐            │
│  │ Agent    │ ───→ │ Message  │            │
│  │ Executor │      │ Store    │            │
│  └──────────┘      └─────┬────┘            │
│                          │                 │
│                    ┌─────▼─────┐           │
│                    │  SQLite   │           │
│                    │  (持久化) │           │
│                    └───────────┘           │
│                          │                 │
│                    ┌─────▼─────┐           │
│                    │ IPC Push  │           │
│                    │ (实时推送) │           │
│                    └───────────┘           │
└─────────────────────────────────────────────┘
```

**核心优势**：

- ✅ 数据库作为唯一真相来源（Single Source of Truth）
- ✅ IPC 作为实时通道（窗口打开时）
- ✅ 窗口关闭不影响后台执行
- ✅ 重新打开时完整恢复
- ✅ 多窗口天然同步

---

## 13. 长时任务与质量保障系统

> 设计支持长时任务的持久化、恢复与结果验证机制

### 13.1 背景与需求

#### 核心问题

**问题 1：长时任务的持久化与恢复**

```
场景：Agent 执行长时间任务（如"研究微镜头历史"）
问题：
  1. 任务执行过程中系统关闭/崩溃
  2. 重启后无法从中断点继续
  3. 需要从头开始，浪费时间和资源

需求：
  ✅ 任务状态持久化
  ✅ 断点续传机制
  ✅ 执行进度追踪
  ✅ 中断恢复
```

**问题 2：任务结果的质量保障**

```
场景：Agent 完成任务并返回结果
问题：
  1. Agent 认为任务完成，但结果不符合预期
  2. 可能存在部分完成、逻辑错误、遗漏信息
  3. 缺乏独立的验证机制

需求：
  ✅ 独立验证机制（Validator Agent）
  ✅ 质量评估标准
  ✅ 自动重试/修正
  ✅ 人工复核选项
```

---

### 13.2 长时任务管理系统设计

#### 13.2.1 任务状态机

```typescript
// 任务生命周期状态
enum TaskStatus {
  PENDING = 'pending', // 待执行
  RUNNING = 'running', // 执行中
  PAUSED = 'paused', // 暂停（手动）
  INTERRUPTED = 'interrupted', // 中断（系统故障）
  VALIDATING = 'validating', // 验证中
  VALIDATION_FAILED = 'validation_failed', // 验证失败
  COMPLETED = 'completed', // 已完成
  FAILED = 'failed', // 失败
  CANCELLED = 'cancelled' // 已取消
}

// 任务定义
interface LongRunningTask {
  id: string // 任务 ID
  sessionId: string // 关联的会话
  name: string // 任务名称
  description: string // 任务描述

  // 执行计划
  plan: TaskPlan // 任务计划（拆解的步骤）
  currentStepIndex: number // 当前执行到第几步

  // 状态管理
  status: TaskStatus
  progress: number // 进度百分比 0-100

  // 检查点
  checkpoints: Checkpoint[] // 历史检查点
  lastCheckpoint?: Checkpoint // 最近的检查点

  // 验证相关
  validationStrategy: ValidationStrategy // 验证策略
  validationResults?: ValidationResult[] // 验证结果历史

  // 时间追踪
  startedAt?: number
  pausedAt?: number
  completedAt?: number
  estimatedDuration?: number // 预估时长（秒）

  // 元数据
  createdAt: number
  updatedAt: number
}

// 任务计划（拆解成多个步骤）
interface TaskPlan {
  steps: TaskStep[]
  totalSteps: number
  estimatedDuration: number // 预估总时长
}

// 单个任务步骤
interface TaskStep {
  id: string
  order: number // 步骤顺序
  name: string // 步骤名称
  description: string

  // 执行相关
  agentId?: string // 使用哪个 Agent
  toolCalls?: string[] // 需要调用的工具
  dependencies?: string[] // 依赖的前置步骤

  // 状态
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  result?: any // 步骤执行结果
  error?: string // 错误信息

  // 时间
  startedAt?: number
  completedAt?: number
  duration?: number // 实际耗时（秒）
}

// 检查点（Checkpoint）
interface Checkpoint {
  id: string
  taskId: string
  stepIndex: number // 执行到第几步
  timestamp: number

  // 快照数据
  snapshot: {
    taskState: any // 任务状态快照
    agentMemory: any // Agent 记忆快照
    intermediateResults: any // 中间结果
    context: any // 上下文信息
  }

  // 元数据
  reason: 'manual' | 'auto' | 'step_completed' | 'before_critical_operation'
}
```

#### 13.2.2 任务执行器（TaskExecutor）

```typescript
// 长时任务执行器
class TaskExecutor {
  private taskStore: TaskStore
  private checkpointManager: CheckpointManager
  private sessionManager: SessionManager
  private agentManager: AgentManager

  /**
   * 创建并启动长时任务
   */
  async createTask(config: {
    sessionId: string
    name: string
    description: string
    plan: TaskPlan
    validationStrategy?: ValidationStrategy
  }): Promise<string> {
    const taskId = generateId()

    const task: LongRunningTask = {
      id: taskId,
      sessionId: config.sessionId,
      name: config.name,
      description: config.description,
      plan: config.plan,
      currentStepIndex: 0,
      status: TaskStatus.PENDING,
      progress: 0,
      checkpoints: [],
      validationStrategy: config.validationStrategy || { type: 'auto' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    // 持久化任务
    await this.taskStore.save(task)

    // 立即开始执行
    await this.executeTask(taskId)

    return taskId
  }

  /**
   * 执行任务（支持断点续传）
   */
  async executeTask(taskId: string): Promise<void> {
    const task = await this.taskStore.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    try {
      // 1. 更新状态为运行中
      task.status = TaskStatus.RUNNING
      task.startedAt = task.startedAt || Date.now()
      await this.taskStore.update(task)

      // 2. 从当前步骤开始执行（支持断点续传）
      const startIndex = task.currentStepIndex

      for (let i = startIndex; i < task.plan.steps.length; i++) {
        const step = task.plan.steps[i]

        // 2.1 检查是否被中断/暂停
        const latestTask = await this.taskStore.get(taskId)
        if (latestTask.status === TaskStatus.PAUSED) {
          log.info(`[TaskExecutor] 任务已暂停: ${taskId}`)
          return
        }

        // 2.2 执行单个步骤
        try {
          log.info(`[TaskExecutor] 执行步骤 ${i + 1}/${task.plan.steps.length}: ${step.name}`)

          step.status = 'running'
          step.startedAt = Date.now()

          // 执行步骤逻辑
          const result = await this.executeStep(task.sessionId, step)

          step.status = 'completed'
          step.result = result
          step.completedAt = Date.now()
          step.duration = (step.completedAt - step.startedAt) / 1000

          // 2.3 更新进度
          task.currentStepIndex = i + 1
          task.progress = Math.round(((i + 1) / task.plan.steps.length) * 100)
          await this.taskStore.update(task)

          // 2.4 创建检查点（每完成一个步骤）
          await this.checkpointManager.create(task, 'step_completed')

          log.info(`[TaskExecutor] 步骤完成: ${step.name}, 进度: ${task.progress}%`)
        } catch (stepError) {
          log.error(`[TaskExecutor] 步骤执行失败:`, stepError)

          step.status = 'failed'
          step.error = stepError.message

          // 整个任务失败
          task.status = TaskStatus.FAILED
          await this.taskStore.update(task)

          throw stepError
        }
      }

      // 3. 所有步骤完成，进入验证阶段
      task.status = TaskStatus.VALIDATING
      task.progress = 100
      await this.taskStore.update(task)

      log.info(`[TaskExecutor] 任务执行完成，开始验证: ${taskId}`)

      // 4. 执行验证
      await this.validateTask(task)
    } catch (error) {
      log.error(`[TaskExecutor] 任务执行失败:`, error)

      // 标记为中断（可恢复）
      task.status = TaskStatus.INTERRUPTED
      await this.taskStore.update(task)

      // 创建中断检查点
      await this.checkpointManager.create(task, 'auto')
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(sessionId: string, step: TaskStep): Promise<any> {
    const session = await this.sessionManager.getSession(sessionId)

    // 选择 Agent
    const agent = step.agentId
      ? await this.agentManager.getAgent(step.agentId)
      : await this.agentManager.getDefaultAgent()

    // 构建输入
    const input = `执行任务步骤: ${step.name}\n描述: ${step.description}`

    // 执行 Agent
    const result = await agent.run({
      input,
      sessionId,
      context: {
        stepId: step.id,
        stepOrder: step.order
      }
    })

    return result
  }

  /**
   * 恢复中断的任务
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = await this.taskStore.get(taskId)

    if (!task) throw new Error(`Task not found: ${taskId}`)

    if (task.status !== TaskStatus.INTERRUPTED && task.status !== TaskStatus.PAUSED) {
      throw new Error(`Task cannot be resumed, current status: ${task.status}`)
    }

    log.info(`[TaskExecutor] 恢复任务: ${taskId}, 从步骤 ${task.currentStepIndex} 开始`)

    // 恢复最近的检查点（可选）
    if (task.lastCheckpoint) {
      await this.checkpointManager.restore(task.lastCheckpoint.id)
    }

    // 继续执行
    await this.executeTask(taskId)
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = await this.taskStore.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    task.status = TaskStatus.PAUSED
    task.pausedAt = Date.now()
    await this.taskStore.update(task)

    // 创建检查点
    await this.checkpointManager.create(task, 'manual')

    log.info(`[TaskExecutor] 任务已暂停: ${taskId}`)
  }
}
```

#### 13.2.3 检查点管理器（CheckpointManager）

```typescript
class CheckpointManager {
  private db: SQLiteService

  /**
   * 创建检查点
   */
  async create(task: LongRunningTask, reason: Checkpoint['reason']): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: generateId(),
      taskId: task.id,
      stepIndex: task.currentStepIndex,
      timestamp: Date.now(),
      snapshot: {
        taskState: task,
        agentMemory: await this.captureAgentMemory(task.sessionId),
        intermediateResults: this.extractIntermediateResults(task),
        context: this.captureContext(task)
      },
      reason
    }

    // 持久化检查点
    await this.db.execute(
      `
      INSERT INTO task_checkpoints (
        id, task_id, step_index, timestamp, snapshot, reason
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        checkpoint.id,
        checkpoint.taskId,
        checkpoint.stepIndex,
        checkpoint.timestamp,
        JSON.stringify(checkpoint.snapshot),
        checkpoint.reason
      ]
    )

    // 更新任务的最近检查点
    task.lastCheckpoint = checkpoint
    task.checkpoints.push(checkpoint)

    log.info(`[Checkpoint] 创建检查点: ${checkpoint.id}, 步骤: ${checkpoint.stepIndex}`)

    return checkpoint
  }

  /**
   * 恢复检查点
   */
  async restore(checkpointId: string): Promise<void> {
    const checkpoint = await this.db.query(
      `
      SELECT * FROM task_checkpoints WHERE id = ?
    `,
      [checkpointId]
    )

    if (!checkpoint || checkpoint.length === 0) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    const snapshot = JSON.parse(checkpoint[0].snapshot)

    // 恢复任务状态
    // 恢复 Agent 记忆
    // 恢复中间结果
    // ...

    log.info(`[Checkpoint] 检查点已恢复: ${checkpointId}`)
  }

  /**
   * 捕获 Agent 记忆快照
   */
  private async captureAgentMemory(sessionId: string): Promise<any> {
    // 从 MemoryService 获取当前会话的记忆
    const memoryService = getMemoryService()
    return await memoryService.exportMemory(sessionId)
  }

  /**
   * 提取中间结果
   */
  private extractIntermediateResults(task: LongRunningTask): any {
    return task.plan.steps
      .filter((step) => step.status === 'completed')
      .map((step) => ({
        stepId: step.id,
        stepName: step.name,
        result: step.result
      }))
  }

  /**
   * 捕获上下文
   */
  private captureContext(task: LongRunningTask): any {
    return {
      sessionId: task.sessionId,
      taskId: task.id,
      currentStep: task.currentStepIndex,
      progress: task.progress,
      timestamp: Date.now()
    }
  }
}
```

---

### 13.3 任务验证与质量保障系统

#### 13.3.1 验证策略定义

```typescript
// 验证策略
interface ValidationStrategy {
  type: 'auto' | 'agent' | 'human' | 'hybrid'

  // 自动验证规则（基于规则引擎）
  autoRules?: ValidationRule[]

  // 使用 Validator Agent（AI 验证）
  validatorAgent?: {
    agentId: string
    instructions: string // 验证指令
    minScore: number // 最低通过分数（0-100）
  }

  // 人工审核
  humanReview?: {
    required: boolean // 是否必须人工审核
    reviewers?: string[] // 审核人列表
    timeout?: number // 审核超时时间（秒）
  }

  // 混合模式（先 AI，必要时人工）
  hybrid?: {
    aiFirst: boolean // 先 AI 验证
    humanThreshold: number // AI 评分低于此值时触发人工审核
  }
}

// 验证规则（自动验证）
interface ValidationRule {
  id: string
  name: string
  description: string

  // 规则类型
  type: 'output_length' | 'contains_keywords' | 'format_check' | 'custom'

  // 规则配置
  config: {
    minLength?: number // 最小长度
    maxLength?: number // 最大长度
    requiredKeywords?: string[] // 必须包含的关键词
    forbiddenKeywords?: string[] // 不能包含的关键词
    formatPattern?: string // 格式正则表达式
    customValidator?: (result: any) => boolean // 自定义验证函数
  }

  // 权重（用于计算总分）
  weight: number
}

// 验证结果
interface ValidationResult {
  id: string
  taskId: string
  timestamp: number

  // 验证类型
  validationType: 'auto' | 'agent' | 'human'

  // 验证结果
  passed: boolean // 是否通过
  score: number // 评分（0-100）

  // 详细信息
  details: {
    ruleResults?: {
      // 规则验证结果
      ruleId: string
      passed: boolean
      message: string
    }[]
    agentFeedback?: string // Validator Agent 反馈
    humanFeedback?: string // 人工审核反馈
    issues?: string[] // 发现的问题
    suggestions?: string[] // 改进建议
  }

  // 操作建议
  action: 'accept' | 'retry' | 'manual_fix' | 'reject'

  // 验证者信息
  validatedBy: string // Agent ID 或用户 ID
}
```

#### 13.3.2 Validator Agent（验证智能体）

```typescript
// Validator Agent 配置
const validatorAgent = new Agent({
  name: 'Validator Agent',
  model: 'gpt-4-turbo',
  instructions: `
你是一个专业的任务结果验证专家。你的职责是：

1. 仔细检查任务的执行结果
2. 评估结果是否满足原始需求
3. 识别潜在的问题和遗漏
4. 提供客观的质量评分（0-100）
5. 给出具体的改进建议

评分标准：
- 90-100: 优秀，完全满足需求
- 70-89: 良好，基本满足需求但有改进空间
- 50-69: 及格，部分满足需求但有明显不足
- 0-49: 不及格，不满足需求，需要重新执行

请以 JSON 格式返回验证结果：
{
  "passed": boolean,
  "score": number,
  "issues": string[],
  "suggestions": string[],
  "feedback": string
}
  `,
  tools: [
    // 可以给 Validator Agent 提供工具
    // 比如：检查文件是否存在、验证数据格式等
  ]
})

// 验证器实现
class TaskValidator {
  private validatorAgent: Agent

  /**
   * 验证任务结果
   */
  async validateTask(task: LongRunningTask): Promise<ValidationResult> {
    const strategy = task.validationStrategy

    switch (strategy.type) {
      case 'auto':
        return await this.autoValidate(task, strategy.autoRules || [])

      case 'agent':
        return await this.agentValidate(task, strategy.validatorAgent!)

      case 'human':
        return await this.humanValidate(task, strategy.humanReview!)

      case 'hybrid':
        return await this.hybridValidate(task, strategy)

      default:
        throw new Error(`Unknown validation strategy: ${strategy.type}`)
    }
  }

  /**
   * 自动验证（基于规则）
   */
  private async autoValidate(
    task: LongRunningTask,
    rules: ValidationRule[]
  ): Promise<ValidationResult> {
    const ruleResults: any[] = []
    let totalScore = 0
    let totalWeight = 0

    // 提取任务的最终输出
    const taskOutput = this.extractTaskOutput(task)

    // 执行每个规则
    for (const rule of rules) {
      const passed = this.executeRule(rule, taskOutput)

      ruleResults.push({
        ruleId: rule.id,
        passed,
        message: passed ? `通过规则: ${rule.name}` : `未通过规则: ${rule.name}`
      })

      if (passed) {
        totalScore += rule.weight * 100
      }
      totalWeight += rule.weight
    }

    // 计算总分
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0
    const passed = finalScore >= 70 // 70分及格

    return {
      id: generateId(),
      taskId: task.id,
      timestamp: Date.now(),
      validationType: 'auto',
      passed,
      score: finalScore,
      details: {
        ruleResults,
        issues: ruleResults.filter((r) => !r.passed).map((r) => r.message)
      },
      action: passed ? 'accept' : 'retry',
      validatedBy: 'AutoValidator'
    }
  }

  /**
   * Agent 验证（AI 验证）
   */
  private async agentValidate(
    task: LongRunningTask,
    config: NonNullable<ValidationStrategy['validatorAgent']>
  ): Promise<ValidationResult> {
    // 准备验证输入
    const input = this.prepareValidationInput(task)

    // 调用 Validator Agent
    const result = await this.validatorAgent.run({
      input,
      sessionId: task.sessionId
    })

    // 解析 Agent 返回的 JSON
    let validationData: any
    try {
      validationData = JSON.parse(result.finalOutput)
    } catch {
      // 如果不是 JSON，使用默认解析
      validationData = {
        passed: false,
        score: 0,
        issues: ['Validator Agent 返回格式错误'],
        suggestions: [],
        feedback: result.finalOutput
      }
    }

    return {
      id: generateId(),
      taskId: task.id,
      timestamp: Date.now(),
      validationType: 'agent',
      passed: validationData.passed && validationData.score >= config.minScore,
      score: validationData.score,
      details: {
        agentFeedback: validationData.feedback,
        issues: validationData.issues || [],
        suggestions: validationData.suggestions || []
      },
      action: validationData.passed ? 'accept' : 'retry',
      validatedBy: config.agentId
    }
  }

  /**
   * 人工验证
   */
  private async humanValidate(
    task: LongRunningTask,
    config: NonNullable<ValidationStrategy['humanReview']>
  ): Promise<ValidationResult> {
    // 发送人工审核请求
    const reviewRequest = await this.sendReviewRequest(task, config)

    // 等待审核结果（通过 IPC 或轮询数据库）
    const reviewResult = await this.waitForReview(reviewRequest.id, config.timeout)

    return {
      id: generateId(),
      taskId: task.id,
      timestamp: Date.now(),
      validationType: 'human',
      passed: reviewResult.approved,
      score: reviewResult.score || 0,
      details: {
        humanFeedback: reviewResult.feedback,
        issues: reviewResult.issues || [],
        suggestions: reviewResult.suggestions || []
      },
      action: reviewResult.approved ? 'accept' : reviewResult.action || 'retry',
      validatedBy: reviewResult.reviewerId
    }
  }

  /**
   * 混合验证（先 AI，必要时人工）
   */
  private async hybridValidate(
    task: LongRunningTask,
    strategy: ValidationStrategy
  ): Promise<ValidationResult> {
    // 先 AI 验证
    const aiResult = await this.agentValidate(task, strategy.validatorAgent!)

    // 如果 AI 评分足够高，直接通过
    if (aiResult.score >= (strategy.hybrid?.humanThreshold || 80)) {
      return aiResult
    }

    // 否则，触发人工审核
    log.info(`[Validator] AI 评分 ${aiResult.score} 低于阈值，触发人工审核`)

    const humanResult = await this.humanValidate(task, strategy.humanReview!)

    // 合并结果
    return {
      ...humanResult,
      details: {
        ...humanResult.details,
        agentFeedback: aiResult.details.agentFeedback,
        issues: [...(aiResult.details.issues || []), ...(humanResult.details.issues || [])]
      }
    }
  }

  /**
   * 执行单个验证规则
   */
  private executeRule(rule: ValidationRule, output: any): boolean {
    const { config } = rule

    switch (rule.type) {
      case 'output_length':
        const length = output?.toString().length || 0
        if (config.minLength && length < config.minLength) return false
        if (config.maxLength && length > config.maxLength) return false
        return true

      case 'contains_keywords':
        const text = output?.toString().toLowerCase() || ''
        return config.requiredKeywords?.every((kw) => text.includes(kw.toLowerCase())) || false

      case 'format_check':
        if (!config.formatPattern) return true
        const regex = new RegExp(config.formatPattern)
        return regex.test(output?.toString() || '')

      case 'custom':
        if (!config.customValidator) return true
        return config.customValidator(output)

      default:
        return true
    }
  }

  /**
   * 提取任务的最终输出
   */
  private extractTaskOutput(task: LongRunningTask): any {
    // 提取所有完成步骤的结果
    const completedSteps = task.plan.steps.filter((s) => s.status === 'completed')

    // 返回最后一个步骤的结果，或所有结果的聚合
    if (completedSteps.length === 0) return null

    return completedSteps[completedSteps.length - 1].result
  }

  /**
   * 准备验证输入
   */
  private prepareValidationInput(task: LongRunningTask): string {
    const output = this.extractTaskOutput(task)

    return `
请验证以下任务的执行结果：

**任务名称**: ${task.name}
**任务描述**: ${task.description}

**执行步骤**:
${task.plan.steps.map((s, i) => `${i + 1}. ${s.name} - ${s.status}`).join('\n')}

**最终输出**:
${JSON.stringify(output, null, 2)}

请评估此结果是否满足任务需求，并给出验证结果。
    `
  }
}
```

#### 13.3.3 重试与修正策略

```typescript
class TaskExecutor {
  // ... 之前的代码

  /**
   * 验证任务结果
   */
  private async validateTask(task: LongRunningTask): Promise<void> {
    const validator = new TaskValidator()

    let attempt = 0
    const maxAttempts = 3 // 最多重试 3 次

    while (attempt < maxAttempts) {
      attempt++

      log.info(`[TaskExecutor] 验证任务 (尝试 ${attempt}/${maxAttempts}): ${task.id}`)

      // 执行验证
      const validationResult = await validator.validateTask(task)

      // 保存验证结果
      task.validationResults = task.validationResults || []
      task.validationResults.push(validationResult)

      if (validationResult.passed) {
        // 验证通过，任务完成
        task.status = TaskStatus.COMPLETED
        task.completedAt = Date.now()
        await this.taskStore.update(task)

        log.info(`[TaskExecutor] 任务验证通过: ${task.id}, 评分: ${validationResult.score}`)

        // 发送完成通知
        eventBus.emit('task:completed', {
          taskId: task.id,
          score: validationResult.score
        })

        return
      }

      // 验证失败
      log.warn(`[TaskExecutor] 任务验证失败: ${task.id}, 评分: ${validationResult.score}`)

      if (validationResult.action === 'reject') {
        // 拒绝，不重试
        task.status = TaskStatus.FAILED
        await this.taskStore.update(task)

        log.error(`[TaskExecutor] 任务被拒绝，不再重试: ${task.id}`)
        return
      }

      if (validationResult.action === 'manual_fix') {
        // 需要人工修复
        task.status = TaskStatus.VALIDATION_FAILED
        await this.taskStore.update(task)

        log.info(`[TaskExecutor] 任务需要人工修复: ${task.id}`)

        // 发送通知
        eventBus.emit('task:needs_manual_fix', {
          taskId: task.id,
          issues: validationResult.details.issues
        })

        return
      }

      if (validationResult.action === 'retry' && attempt < maxAttempts) {
        // 重试
        log.info(`[TaskExecutor] 准备重试任务: ${task.id}`)

        // 根据反馈调整执行策略
        await this.adjustTaskPlan(task, validationResult)

        // 重置任务状态
        task.currentStepIndex = 0
        task.status = TaskStatus.RUNNING

        // 重新执行
        await this.executeTask(task.id)

        // 重新验证（递归）
        return
      }
    }

    // 达到最大重试次数
    task.status = TaskStatus.VALIDATION_FAILED
    await this.taskStore.update(task)

    log.error(`[TaskExecutor] 任务验证失败，已达到最大重试次数: ${task.id}`)
  }

  /**
   * 根据验证反馈调整任务计划
   */
  private async adjustTaskPlan(
    task: LongRunningTask,
    validationResult: ValidationResult
  ): Promise<void> {
    // 根据验证反馈，智能调整执行策略
    // 例如：
    // - 如果输出太短，增加详细描述的步骤
    // - 如果缺少关键信息，添加补充搜索步骤
    // - 如果格式错误，添加格式化步骤

    const suggestions = validationResult.details.suggestions || []

    // 使用 AI 生成改进的任务计划
    const triageAgent = await this.agentManager.getAgent('triage')

    const result = await triageAgent.run({
      input: `
根据以下验证反馈，调整任务执行计划：

**原任务**: ${task.name}
**验证问题**: ${validationResult.details.issues?.join(', ')}
**改进建议**: ${suggestions.join(', ')}

请生成改进的任务步骤。
      `,
      sessionId: task.sessionId
    })

    // 解析并更新任务计划
    // task.plan = parseImprovedPlan(result.finalOutput)

    log.info(`[TaskExecutor] 任务计划已调整: ${task.id}`)
  }
}
```

---

### 13.4 数据库设计

```sql
-- 长时任务表
CREATE TABLE IF NOT EXISTS long_running_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- 任务计划（JSON）
  plan TEXT NOT NULL,
  current_step_index INTEGER DEFAULT 0,

  -- 状态
  status TEXT NOT NULL,  -- pending, running, paused, interrupted, validating, completed, failed
  progress INTEGER DEFAULT 0,  -- 0-100

  -- 验证
  validation_strategy TEXT,  -- JSON

  -- 时间
  started_at INTEGER,
  paused_at INTEGER,
  completed_at INTEGER,
  estimated_duration INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

-- 任务步骤表（可选，也可以直接存在 plan JSON 中）
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- 执行
  agent_id TEXT,
  status TEXT NOT NULL,  -- pending, running, completed, failed, skipped
  result TEXT,  -- JSON
  error TEXT,

  -- 时间
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,

  FOREIGN KEY (task_id) REFERENCES long_running_tasks(id) ON DELETE CASCADE
);

-- 检查点表
CREATE TABLE IF NOT EXISTS task_checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,

  -- 快照数据（JSON）
  snapshot TEXT NOT NULL,

  -- 元数据
  reason TEXT NOT NULL,  -- manual, auto, step_completed, before_critical_operation

  FOREIGN KEY (task_id) REFERENCES long_running_tasks(id) ON DELETE CASCADE
);

-- 验证结果表
CREATE TABLE IF NOT EXISTS task_validation_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,

  -- 验证类型
  validation_type TEXT NOT NULL,  -- auto, agent, human

  -- 结果
  passed INTEGER NOT NULL,  -- 0 or 1
  score INTEGER NOT NULL,   -- 0-100

  -- 详细信息（JSON）
  details TEXT,

  -- 操作建议
  action TEXT NOT NULL,  -- accept, retry, manual_fix, reject

  -- 验证者
  validated_by TEXT NOT NULL,

  FOREIGN KEY (task_id) REFERENCES long_running_tasks(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_tasks_session ON long_running_tasks(session_id);
CREATE INDEX idx_tasks_status ON long_running_tasks(status);
CREATE INDEX idx_checkpoints_task ON task_checkpoints(task_id);
CREATE INDEX idx_validations_task ON task_validation_results(task_id);
```

---

### 13.5 使用示例

#### 示例 1: 创建长时任务

```typescript
// 创建一个研究任务
const taskId = await taskExecutor.createTask({
  sessionId: 'session_123',
  name: '深度研究微镜头拍摄技术',
  description: '全面研究微镜头的历史、技术、应用案例',
  plan: {
    steps: [
      {
        id: 'step1',
        order: 1,
        name: '搜索微镜头历史资料',
        description: '搜索并整理微镜头的发展历史',
        agentId: 'research',
        status: 'pending'
      },
      {
        id: 'step2',
        order: 2,
        name: '分析技术细节',
        description: '深入分析微镜头的拍摄技术和设备要求',
        agentId: 'research',
        dependencies: ['step1'],
        status: 'pending'
      },
      {
        id: 'step3',
        order: 3,
        name: '收集应用案例',
        description: '收集电影、广告等领域的微镜头应用案例',
        agentId: 'research',
        dependencies: ['step1', 'step2'],
        status: 'pending'
      },
      {
        id: 'step4',
        order: 4,
        name: '生成总结报告',
        description: '整合所有资料，生成结构化的研究报告',
        agentId: 'chat',
        dependencies: ['step1', 'step2', 'step3'],
        status: 'pending'
      }
    ],
    totalSteps: 4,
    estimatedDuration: 300 // 预估 5 分钟
  },
  validationStrategy: {
    type: 'hybrid',
    validatorAgent: {
      agentId: 'validator',
      instructions: '验证研究报告的完整性和准确性',
      minScore: 70
    },
    hybrid: {
      aiFirst: true,
      humanThreshold: 80 // AI 评分低于 80 时触发人工审核
    }
  }
})

console.log(`任务已创建: ${taskId}`)
```

#### 示例 2: 监听任务进度

```typescript
// 监听任务事件
eventBus.on('task:progress', (data) => {
  console.log(`任务进度: ${data.taskId}, ${data.progress}%`)

  // 推送到前端
  windowManager.sendToSession(data.sessionId, 'task:progress', data)
})

eventBus.on('task:step_completed', (data) => {
  console.log(`步骤完成: ${data.stepName}`)
})

eventBus.on('task:completed', (data) => {
  console.log(`任务完成: ${data.taskId}, 评分: ${data.score}`)
})

eventBus.on('task:needs_manual_fix', (data) => {
  console.log(`任务需要人工修复: ${data.taskId}`)
  console.log(`问题: ${data.issues.join(', ')}`)

  // 弹出通知或打开审核界面
})
```

#### 示例 3: 系统重启后恢复任务

```typescript
// 系统启动时，恢复中断的任务
class AppManager {
  async initialize() {
    // ... 其他初始化

    // 恢复中断的任务
    await this.recoverInterruptedTasks()
  }

  private async recoverInterruptedTasks() {
    const taskStore = new TaskStore()

    // 查找所有中断或暂停的任务
    const interruptedTasks = await taskStore.findByStatus([
      TaskStatus.INTERRUPTED,
      TaskStatus.PAUSED
    ])

    log.info(`[App] 发现 ${interruptedTasks.length} 个中断任务`)

    // 恢复执行
    for (const task of interruptedTasks) {
      log.info(`[App] 恢复任务: ${task.name}`)
      await taskExecutor.resumeTask(task.id)
    }
  }
}
```

---

### 13.6 核心优势总结

#### 长时任务管理

- ✅ **持久化状态** - 所有任务状态存储在数据库
- ✅ **断点续传** - 系统重启后从中断点继续
- ✅ **检查点机制** - 每完成一步自动保存
- ✅ **进度追踪** - 实时监控任务进度
- ✅ **灵活暂停/恢复** - 支持手动暂停和恢复

#### 质量保障系统

- ✅ **多层验证** - 自动规则 + AI 验证 + 人工审核
- ✅ **智能重试** - 根据反馈自动调整执行策略
- ✅ **质量评分** - 客观的 0-100 分评分机制
- ✅ **问题追溯** - 详细记录验证历史和问题
- ✅ **非阻塞验证** - 验证过程不阻塞其他任务

#### 与现有架构集成

- ✅ **复用 Session 系统** - 任务关联到会话
- ✅ **复用 Agent 系统** - 任务步骤使用现有 Agent
- ✅ **复用数据库** - 使用现有 SQLite 服务
- ✅ **复用事件系统** - 任务事件通过 EventBus 传递

---

## 14. 实现路线图

> 注：聚焦后台实现，前台 UI 暂缓

### Phase 1: 基础框架搭建 (Week 1-2)

- [ ] 创建 `src/main/ai` 目录结构
- [ ] 设计消息数据库 Schema（sessions、messages、chunks）
- [ ] 实现 `MessageStore`（消息持久化）
- [ ] 实现 `MessageBroadcaster`（IPC 推送 + DB 存储）
- [ ] 实现 `SessionManager` 基础功能
- [ ] 实现 `AgentManager` 基础功能
- [ ] 实现 `ToolRegistry` 基础功能
- [ ] IPC 通信接口设计（session:load-history, agent:message 等）

### Phase 2: 核心智能体实现 (Week 3-4)

- [ ] 实现 `TriageAgent`（分发智能体）
- [ ] 实现 `ChatAgent`（通用对话）
- [ ] 实现智能体交接逻辑
- [ ] 实现流式输出处理
- [ ] IPC 通信接口设计

### Phase 2.5: Skills 系统实现 (Week 4-5)

- [ ] 实现 `SkillManager`
- [ ] 实现技能注册与发现机制
- [ ] 实现内置技能（Research、Coding）
- [ ] 技能执行上下文管理
- [ ] 自定义技能开发接口

### Phase 3: 多智能体构建 (Week 6-7)

- [ ] 实现 `MultiAgentBuilder`
- [ ] 实现团队模式（Team）
- [ ] 实现流水线模式（Pipeline）
- [ ] 实现并行模式（Parallel）
- [ ] 实现智能体编排引擎
- [ ] 智能体模板系统

### Phase 4: 工具系统搭建 (Week 8-9)

- [ ] 实现文件工具（读/写/搜索）
- [ ] 实现联网工具（搜索/爬虫）
- [ ] 实现代码工具（执行/分析）
- [ ] 工具权限与审批机制
- [ ] 工具执行追踪

### Phase 5: MCP 集成 (Week 10-11)

- [ ] 实现 `MCPManager`
- [ ] 支持本地 MCP Server
- [ ] MCP 工具自动发现
- [ ] MCP 工具适配器

### Phase 6: 记忆系统 (Week 12-13)

- [ ] 实现 `MemoryService`
- [ ] 短期记忆管理
- [ ] 长期记忆检索
- [ ] 记忆压缩策略

### Phase 7: 工具权限系统 (Week 14-15)

- [ ] 实现 `ToolPermissionEngine`（智能决策）
- [ ] 实现 `ApprovalQueue`（异步审批队列）
- [ ] 实现风险评分算法
- [ ] 实现配置化权限管理
- [ ] 工具白名单/黑名单机制
- [ ] 智能体信任级别管理

### Phase 8: 长时任务与验证系统 (Week 16-17)

- [ ] 实现 `LongRunningTask` 数据模型
- [ ] 实现 `TaskStore`（数据库操作）
- [ ] 实现 `TaskExecutor`（任务执行器）
- [ ] 实现 `CheckpointManager`（检查点管理）
- [ ] 实现任务状态机（状态转换）
- [ ] 实现 `TaskValidator`（验证器）
- [ ] 实现 Validator Agent（AI 验证智能体）
- [ ] 实现自动验证规则引擎
- [ ] 实现重试与修正策略
- [ ] 系统启动时恢复中断任务
- [ ] 任务进度事件推送
- [ ] 数据库表创建（tasks、checkpoints、validations）

### Phase 9: 基础 UI 集成 (Week 18) - 可选，暂缓

> 注：前台 UI 暂缓开发，先专注后台核心实现

- [ ] 前端对话 UI 开发（基础版）- 暂缓
- [ ] 工具审批通知 UI - 暂缓
- [ ] 会话管理 UI（基础版）- 暂缓
- [ ] 权限设置界面 - 暂缓
- [ ] 长时任务监控 UI - 暂缓
- [ ] 任务验证结果展示 UI - 暂缓

### Phase 10: 优化与测试 (Week 19-20)

- [ ] 性能优化
- [ ] 错误处理完善
- [ ] Skills 系统测试
- [ ] 多智能体协作测试
- [ ] 工具权限系统测试
- [ ] 单元测试
- [ ] 集成测试
- [ ] 文档完善

---

## 附录

### A. 关键类型定义

```typescript
// Agent 输入项
export type AgentInputItem =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; tool_call_id: string; content: string }

// Agent 运行结果
export interface RunResult {
  finalOutput: string
  history: AgentInputItem[]
  currentAgent: Agent
  newItems: RunItem[]
  usage: TokenUsage
}

// 工具定义
export interface Tool {
  name: string
  description: string
  parameters: ZodSchema
  execute: (args: any, context?: RunContext) => Promise<any>
}
```

### B. 配置示例

```typescript
// agent-config.ts
export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  [AgentType.TRIAGE]: {
    type: AgentType.TRIAGE,
    name: 'Triage Agent',
    description: '智能分发助手',
    instructions: '根据用户请求，判断应该使用哪个专业智能体',
    tools: [],
    handoffs: ['chat', 'research', 'code'],
    modelSettings: {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.1
    }
  },
  [AgentType.CHAT]: {
    type: AgentType.CHAT,
    name: 'Chat Agent',
    description: '通用对话助手',
    instructions: '你是一个友好、专业的 AI 助手',
    tools: ['web_search'],
    handoffs: ['triage'],
    modelSettings: {
      temperature: 0.7
    }
  }
  // ... 其他智能体配置
}
```

### C. 参考资源

- [OpenAI Agents 文档](https://github.com/openai/openai-agents-js)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [Claude SDK](https://docs.anthropic.com/claude/reference)
- [Electron IPC 通信](https://www.electronjs.org/docs/latest/api/ipc-main)

---

## 总结

本架构设计基于 `@openai/agents` 框架，结合 Coobee AI 的实际需求，提供了一个**模块化、可扩展、高性能**的智能体系统解决方案。

**核心优势**：

1. ✅ **清晰的分层架构** - Runtime / Services / Storage 三层分离
2. ✅ **灵活的智能体协作** - Triage 分发 + Handoff 交接
3. ✅ **Skills 技能系统** - 封装复杂能力，可复用可扩展
4. ✅ **多智能体构建** - Team/Pipeline/Parallel 多种协作模式
5. ✅ **强大的工具系统** - 文件/联网/代码/数据库全覆盖
6. ✅ **智能权限控制** - 三维权限矩阵 + 异步审批队列（不阻塞）⭐
7. ✅ **完善的会话管理** - 历史持久化 + 上下文维护
8. ✅ **消息推送优化** - IPC + DB 双保障，窗口关闭后可恢复 ⭐⭐
9. ✅ **长时任务管理** - 状态持久化 + 断点续传 + 检查点机制 ⭐⭐⭐
10. ✅ **质量保障系统** - 多层验证 + 智能重试 + 自动修正 ⭐⭐
11. ✅ **MCP 生态集成** - 支持外部工具无缝接入

**开发重点**：

- 🎯 **后台优先** - 聚焦 `src/main/ai` 的底层实现
- 🚫 **前台暂缓** - UI 展示逻辑暂不关注，先把核心能力做扎实
- ⚡ **非阻塞设计** - 工具审批采用智能决策 + 异步队列，不阻塞主流程

**下一步行动**：

1. 确认架构设计，调整细节
2. 开始 Phase 1 实现（基础框架）
3. 逐步迭代，持续优化

**新增核心能力**：

- 🎯 **Skills 技能系统** - 将复杂能力封装为可复用的技能单元
- 🤖 **多智能体构建** - 支持 Team、Pipeline、Parallel 等多种协作模式
- 🔐 **智能权限系统** - 三维权限矩阵 + 风险评分 + 异步审批队列（不阻塞）⭐
- 📦 **模板化开发** - 预定义智能体模板，快速构建复杂系统
- ⏱️ **长时任务管理** - 任务状态持久化 + 断点续传 + 系统重启后自动恢复 ⭐⭐⭐
- 🔍 **质量保障系统** - 多层验证（规则/AI/人工）+ 智能重试 + 自动修正 ⭐⭐

**工具审批优化方案**：

#### ❌ 旧方案：Promise 阻塞等待

```typescript
// 阻塞主流程，用户体验差
const approved = await requestUserApproval(tool, args)
if (!approved) return { error: 'User denied' }
```

#### ✅ 新方案：智能决策 + 异步队列

**核心思路**：

1. **智能决策引擎** - 根据用户配置 + 工具风险 + 智能体信任度自动决策
2. **三层权限控制** - 白名单/风险评分/黑名单
3. **异步审批队列** - 需要确认的操作加入队列，不阻塞主流程
4. **配置化管理** - 用户可预先配置自动批准规则

**优势**：

- ✅ 低风险操作（如 `web_search`）自动批准，无需等待
- ✅ 可信智能体（如 `chat_agent`）拥有更多权限
- ✅ 高风险操作（如 `code_execute`）加入异步队列
- ✅ 用户可配置白名单，实现"一次授权，永久使用"
- ✅ 智能学习机制，根据历史决策优化规则

---

_本文档持续更新中..._
