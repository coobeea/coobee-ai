# 多智能体设计借鉴 - Tachikoma 项目精华

> 从 Tachikoma 项目和 Agentic 设计模式中学习的宝贵经验
>
> 创建时间：2026-02-04

---

## 目录

1. [核心借鉴点总览](#1-核心借鉴点总览)
2. [架构模式对比](#2-架构模式对比)
3. [详细借鉴设计](#3-详细借鉴设计)
4. [融合到 Coobee AI 的方案](#4-融合到-coobee-ai-的方案)
5. [实施建议](#5-实施建议)

---

## 1. 核心借鉴点总览

### 1.1 最有价值的设计理念

| 领域                    | Tachikoma 的设计                             | 为什么值得借鉴                | 我们的应用                                   |
| ----------------------- | -------------------------------------------- | ----------------------------- | -------------------------------------------- |
| **双系统架构**          | Orchestrator (慢思考) + Worker (快执行)      | System 2 规划 + System 1 执行 | ✅ 已采纳（Agent Runtime + Agent Instances） |
| **任务完成判定**        | LLM 不再调用工具 = 任务完成                  | 简单有效的完成信号            | ⭐ **值得借鉴**                              |
| **目标传播**            | parentObjective 贯穿整个任务链               | 防止子任务偏离总目标          | ⭐ **值得借鉴**                              |
| **偏离检测**            | 定期检查执行是否偏离计划                     | 主动纠偏机制                  | ⭐ **值得借鉴**                              |
| **项目类型模板**        | Greenfield / Feature / BugFix / Refactoring  | 标准化不同场景的最佳实践      | ⭐ **值得借鉴**                              |
| **Worker 角色分工**     | Frontend / Backend / Testing / DevOps 等专家 | 专业化分工提高质量            | ⭐ **值得借鉴**                              |
| **上下文预算管理**      | 分层阈值 + 智能缩减策略                      | 避免上下文"腐烂"              | ⭐ **非常值得借鉴**                          |
| **进度评估系统**        | 健康度评分 + 重规划触发                      | 主动识别问题并调整            | ⭐ **值得借鉴**                              |
| **风险缓解矩阵**        | 常见失败模式 + 恢复策略                      | 系统化的异常处理              | ⭐ **值得借鉴**                              |
| **Orchestrator Skills** | 规划层专用技能系统                           | 提升规划质量，填补业界空白    | ⭐⭐⭐ **核心创新**                          |

---

## 2. 架构模式对比

### 2.1 多智能体协作模式 (来自 Agentic Design Patterns)

#### 模式 1: Sequential Handoffs (顺序交接)

```
任务流: Agent A → 完成 → Agent B → 完成 → Agent C

优点:
  ✅ 清晰的依赖关系
  ✅ 易于追踪
  ✅ 适合流水线式任务

缺点:
  ❌ 无法并行
  ❌ 瓶颈明显
```

**Coobee AI 应用场景**:

- 研究 → 写作 → 编辑的文档生成流程
- 设计 → 实现 → 测试的代码开发流程

#### 模式 2: Parallel Processing (并行处理)

```
         ┌─ Agent A ─┐
Task ─→  ├─ Agent B ─┤ ─→ Merge
         └─ Agent C ─┘

优点:
  ✅ 高效利用资源
  ✅ 缩短总时间
  ✅ 适合独立子任务

缺点:
  ❌ 需要合并策略
  ❌ 资源竞争风险
```

**Coobee AI 应用场景**:

- 同时搜索多个数据源
- 并行处理前端和后端任务
- 多模块测试

#### 模式 3: Hierarchical (层级结构)

```
      Manager Agent
         /    \
    Agent A  Agent B
    /  \      /  \
  W1  W2    W3  W4

优点:
  ✅ 清晰的管理结构
  ✅ 易于扩展
  ✅ 分布式决策

缺点:
  ❌ 可能有单点瓶颈
  ❌ 层级过深影响效率
```

**Coobee AI 应用场景**:

- Triage Agent → 专业 Agent → Tool Executor
- Project Manager → Module Leader → Task Worker

#### 模式 4: Critic-Reviewer (评审者模式) ⭐

```
Creator Agent → Draft
                 ↓
Reviewer Agent → Feedback
                 ↓
Refiner Agent → Final Output

优点:
  ✅ 内建质量保障
  ✅ 减少幻觉
  ✅ 多角度验证

缺点:
  ❌ 增加 Token 消耗
  ❌ 增加延迟
```

**Coobee AI 应用场景**:

- 代码生成 → 代码审查 → 代码优化
- 文档撰写 → 逻辑检查 → 修订
- **与我们的任务验证系统完美契合！**

---

### 2.2 Tachikoma 架构核心

```typescript
// Tachikoma 的执行流程
┌─────────────────────────────────────────────────┐
│  用户目标: "创建音乐播放器应用"                    │
└───────────────┬─────────────────────────────────┘
                ↓
┌───────────────▼─────────────────────────────────┐
│  Orchestrator (统筹者)                           │
│  - 维护整体目标                                   │
│  - 监控执行进度                                   │
│  - 偏离检测                                      │
└───────────────┬─────────────────────────────────┘
                ↓
┌───────────────▼─────────────────────────────────┐
│  Planner (规划者)                                │
│  - 任务分解 (WBS)                                │
│  - 依赖分析 (DAG)                                │
│  - 项目类型匹配 (Archetype)                      │
└───────────────┬─────────────────────────────────┘
                ↓
        ┌───────┴───────┐
        ↓               ↓
┌───────▼─────┐  ┌──────▼──────┐
│ Worker 1    │  │ Worker 2     │
│ (Frontend)  │  │ (Backend)    │
│             │  │              │
│ LLM 循环:   │  │ LLM 循环:    │
│ 1. 思考     │  │ 1. 思考      │
│ 2. 调工具   │  │ 2. 调工具    │
│ 3. 看结果   │  │ 3. 看结果    │
│ 4. 重复     │  │ 4. 重复      │
│ 直到不再    │  │ 直到不再     │
│ 调用工具    │  │ 调用工具     │
└─────────────┘  └──────────────┘
```

**关键设计点**:

1. **目标传播**:

```typescript
Task.objective → SubTask.parentObjective → WorkerTask.parentObjective
                                                  ↓
                                          System Prompt 中
```

2. **完成判定**:

```typescript
// Worker 内部
while (!done && round < maxRounds) {
  const response = await llm.chat(context);
  const toolCalls = parseToolCalls(response);

  if (toolCalls.length === 0) {
    done = true; // ✅ 没有工具调用 = 任务完成
  } else {
    // 执行工具，继续循环
  }
}
```

3. **偏离检测**:

```typescript
// Orchestrator 定期检查
setInterval(() => {
  // 1. 子任务是否超时
  // 2. Worker 是否无响应
  // 3. 资源消耗是否异常
}, deviationCheckInterval);
```

---

## 3. 详细借鉴设计

### 3.1 任务分解模式 (Task Decomposition)

#### WBS (Work Breakdown Structure) 原则

```markdown
# Tachikoma 的 WBS 三原则

1. **100% 规则**: 子任务之和 = 父任务的全部工作量
2. **互斥性**: 子任务之间不重叠
3. **可交付物导向**: 每个叶子节点有可验证的产出

# 分解层级

Phase (阶段) → Deliverable (交付物) → Work Package (工作包)
```

**借鉴到 Coobee AI**:

```typescript
// src/main/ai/agents/planner/decomposition.ts
interface TaskDecomposition {
  // 应用 MECE 原则 (Mutually Exclusive, Collectively Exhaustive)
  checklist: {
    mutuallyExclusive: boolean; // 子任务互不重叠
    collectivelyExhaustive: boolean; // 覆盖完整
    noBoundaryCases: boolean; // 无遗漏边界
    noCrossDependencies: boolean; // 无隐含依赖
  };

  // 依赖类型
  dependencies: {
    type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish';
    from: string;
    to: string;
  }[];

  // 关键路径
  criticalPath: string[]; // 最长依赖链
}

// 复杂度评估
interface ComplexityEstimation {
  dimensions: {
    codeSize: 'small' | 'medium' | 'large'; // <100 / 100-500 / >500 lines
    dependencies: number; // 0-1 / 2-3 / >3
    uncertainty: 'clear' | 'partial' | 'high';
    techRisk: 'familiar' | 'learning' | 'new';
  };

  // 估时公式
  estimatedTime: number; // 基准时间 × (1 + 复杂度系数 × 0.2) × 风险因子
}
```

---

### 3.2 项目类型模板 (Project Archetypes) ⭐⭐⭐

```typescript
// src/main/ai/agents/planner/archetypes.ts

enum ProjectType {
  GREENFIELD = 'greenfield',      // 新建项目
  FEATURE = 'feature_addition',   // 功能添加
  BUGFIX = 'bugfix',              // 问题修复
  REFACTORING = 'refactoring'     // 重构优化
}

interface ProjectArchetype {
  type: ProjectType;

  // 特征识别
  triggers: string[];  // 关键词匹配

  // 标准阶段（带百分比）
  phases: {
    name: string;
    percentage: number;
    tasks: string[];
  }[];
}

// 示例：新建项目模板
const GREENFIELD_ARCHETYPE: ProjectArchetype = {
  type: 'greenfield',
  triggers: ['创建', '新建', '从零开始', 'bootstrap', 'initialize'],
  phases: [
    {
      name: 'Scaffolding',
      percentage: 10,
      tasks: [
        '初始化项目结构',
        '配置开发环境',
        '设置 CI/CD 基础'
      ]
    },
    {
      name: 'Core Architecture',
      percentage: 25,
      tasks: [
        '设计系统架构',
        '定义核心接口',
        '搭建基础设施'
      ]
    },
    {
      name: 'Feature Implementation',
      percentage: 45,
      tasks: [
        '实现核心功能',
        '并行开发多模块',
        '持续集成验证'
      ]
    },
    {
      name: 'Integration & Testing',
      percentage: 15,
      tasks: [
        '模块集成',
        '端到端测试',
        '性能优化'
      ]
    },
    {
      name: 'Documentation',
      percentage: 5,
      tasks: [
        '编写文档',
        '代码审查',
        '最终验收'
      ]
    }
  ]
};

// Bug Fix 模板（不同的阶段分布）
const BUGFIX_ARCHETYPE: ProjectArchetype = {
  type: 'bugfix',
  triggers: ['修复', '解决', 'bug', 'fix', 'issue'],
  phases: [
    { name: 'Reproduction', percentage: 20, tasks: [...] },
    { name: 'Root Cause Analysis', percentage: 30, tasks: [...] },
    { name: 'Fix Implementation', percentage: 25, tasks: [...] },
    { name: 'Regression Testing', percentage: 20, tasks: [...] },
    { name: 'Documentation', percentage: 5, tasks: [...] }
  ]
};
```

**价值**:

- 自动识别任务类型
- 提供标准化的阶段模板
- 不同类型有不同的时间分配

---

### 3.3 Worker 角色系统 (Worker Roles)

```typescript
// src/main/ai/agents/roles.ts

interface AgentRole {
  id: string;
  name: string;
  description: string;

  // 能力领域
  capabilities: string[];

  // 关键词匹配
  keywords: string[];

  // 工具集
  tools: string[];

  // 推荐的 System Prompt
  instructions: string;
}

const PREDEFINED_ROLES: AgentRole[] = [
  {
    id: 'frontend-specialist',
    name: '前端专家',
    capabilities: ['React/Vue/Angular 组件开发', 'CSS/样式系统', '用户界面交互', '响应式设计'],
    keywords: ['UI', '组件', '页面', '样式', 'CSS', '前端', '界面'],
    tools: ['file_write', 'web_search', 'browser_preview'],
    instructions: '你是一个前端开发专家，擅长...'
  },
  {
    id: 'backend-specialist',
    name: '后端专家',
    capabilities: ['API 设计与实现', '数据库操作', '服务端逻辑', '认证授权'],
    keywords: ['API', '服务', '数据库', '后端', '接口', '服务器'],
    tools: ['file_write', 'shell_execute', 'database_query'],
    instructions: '你是一个后端开发专家，擅长...'
  },
  {
    id: 'testing-specialist',
    name: '测试专家',
    capabilities: ['单元测试', '集成测试', 'E2E 测试', 'Mock 策略'],
    keywords: ['测试', 'test', '验证', '覆盖率'],
    tools: ['shell_execute', 'file_read', 'file_write'],
    instructions: '你是一个测试专家，擅长...'
  }
];

// 角色匹配算法
function matchRole(subtask: SubTask): RoleMatch[] {
  const objective = subtask.objective.toLowerCase();
  const matches: RoleMatch[] = [];

  for (const role of PREDEFINED_ROLES) {
    let score = 0;
    const reasons: string[] = [];

    for (const keyword of role.keywords) {
      if (objective.includes(keyword)) {
        score += keyword.length; // 长关键词权重更高
        reasons.push(`匹配关键词: ${keyword}`);
      }
    }

    if (score > 0) {
      matches.push({ roleId: role.id, score, reasons });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
```

---

### 3.4 上下文预算管理 ⭐⭐⭐

```typescript
// src/main/ai/core/context-budget.ts

// Tachikoma 的阈值体系
const CONTEXT_THRESHOLDS = {
  HARD_LIMIT: 1_000_000, // 模型物理限制
  ROT_THRESHOLD: 200_000, // 性能下降点
  SUMMARIZATION_TRIGGER: 150_000, // 强制摘要
  COMPACTION_TRIGGER: 128_000, // 触发压缩
  COMFORT_ZONE: 100_000 // 最佳性能区
};

// 预算分配（Orchestrator）
const ORCHESTRATOR_BUDGET: Record<string, number> = {
  systemPrompt: 0.1, // 10% - 角色定义 + Skills
  taskDescription: 0.15, // 15% - 目标 + 约束
  planState: 0.2, // 20% - 当前 DAG + 进度
  workerReports: 0.35, // 35% - 子任务结果摘要
  historyDecisions: 0.1, // 10% - 关键决策记录
  buffer: 0.1 // 10% - 预留响应生成
};

// 预算分配（Worker）
const WORKER_BUDGET: Record<string, number> = {
  systemPrompt: 0.1, // 10% - 角色 + 指南 + Skills
  subtaskDesc: 0.15, // 15% - 目标 + 约束
  codeContext: 0.45, // 45% - 相关文件内容
  toolHistory: 0.2, // 20% - 最近操作记录
  buffer: 0.1 // 10% - 预留响应生成
};

// 缩减策略决策树
interface ReductionStrategy {
  currentTokens: number;
  action: 'none' | 'compact' | 'summarize' | 'offload';
  reason: string;
}

function selectReductionStrategy(tokens: number): ReductionStrategy {
  if (tokens < CONTEXT_THRESHOLDS.COMPACTION_TRIGGER) {
    return { currentTokens: tokens, action: 'none', reason: '在舒适区' };
  }

  if (tokens < CONTEXT_THRESHOLDS.SUMMARIZATION_TRIGGER) {
    return {
      currentTokens: tokens,
      action: 'compact',
      reason: '执行压缩（可逆）'
    };
  }

  if (tokens < CONTEXT_THRESHOLDS.ROT_THRESHOLD) {
    return {
      currentTokens: tokens,
      action: 'summarize',
      reason: '执行摘要（优先旧消息）'
    };
  }

  return {
    currentTokens: tokens,
    action: 'offload',
    reason: '强制摘要 + 卸载工具输出到文件'
  };
}

// 信息优先级（保留 vs 卸载）
const RETENTION_PRIORITY = [
  '当前任务目标和约束',
  '最近 5 次工具调用',
  '未解决的阻塞问题',
  '关键决策记录',
  '修改的文件列表',
  '历史对话摘要',
  '旧工具调用详情' // 最先卸载
];

const OFFLOAD_CANDIDATES = [
  '大型文件内容 (> 5k tokens)',
  '命令输出 (> 2k tokens)',
  '已完成子任务的详细结果',
  '调试日志'
];
```

---

### 3.5 进度评估与健康度 ⭐

```typescript
// src/main/ai/core/progress-evaluation.ts

interface ProgressHealth {
  score: number; // 0-100
  status: 'healthy' | 'warning' | 'critical';
  factors: HealthFactor[];
}

interface HealthFactor {
  name: string;
  weight: number; // 权重
  value: number; // 0-100
  reason: string;
}

function calculateHealth(subtask: SubTask, execution: ExecutionState): ProgressHealth {
  const factors: HealthFactor[] = [];

  // 1. 时间因素 (30%)
  const timeRatio = execution.elapsed / subtask.estimatedMinutes;
  factors.push({
    name: '时间进度',
    weight: 0.3,
    value: timeRatio <= 1 ? 100 : Math.max(0, 100 - (timeRatio - 1) * 50),
    reason: timeRatio <= 1 ? '按时推进' : `超时 ${((timeRatio - 1) * 100).toFixed(0)}%`
  });

  // 2. 错误因素 (30%)
  const errorPenalty = Math.min(execution.errorCount * 20, 100);
  factors.push({
    name: '错误频率',
    weight: 0.3,
    value: 100 - errorPenalty,
    reason: execution.errorCount === 0 ? '无错误' : `${execution.errorCount} 次错误`
  });

  // 3. 工具调用效率 (20%)
  const toolEfficiency = (execution.successfulToolCalls / execution.totalToolCalls) * 100;
  factors.push({
    name: '工具效率',
    weight: 0.2,
    value: toolEfficiency,
    reason: `${toolEfficiency.toFixed(0)}% 成功率`
  });

  // 4. 循环检测 (20%)
  const loopPenalty = Math.min(execution.duplicateToolCalls * 30, 100);
  factors.push({
    name: '循环风险',
    weight: 0.2,
    value: 100 - loopPenalty,
    reason: execution.duplicateToolCalls === 0 ? '无循环' : `${execution.duplicateToolCalls} 次重复`
  });

  const score = factors.reduce((sum, f) => sum + f.value * f.weight, 0);

  return {
    score,
    status: score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'critical',
    factors
  };
}

// 重规划触发条件
const REPLAN_TRIGGERS = {
  healthScoreLow: 40, // 健康度 < 40
  consecutiveFails: 3, // 连续失败 3 次
  timeoutMultiplier: 3, // 超时 > 3x 估时
  dependencyChanged: true, // 依赖项变更
  resourceConflict: true // 资源冲突检测
};
```

---

### 3.6 风险缓解矩阵 ⭐

```typescript
// src/main/ai/core/risk-mitigation.ts

// 常见失败模式
enum FailurePattern {
  // 技术类
  TOKEN_EXHAUSTION = 'token_exhaustion',
  TOOL_TIMEOUT = 'tool_timeout',
  PARSE_ERROR = 'parse_error',
  DEPENDENCY_MISSING = 'dependency_missing',

  // 逻辑类
  DOOM_LOOP = 'doom_loop',
  TASK_DRIFT = 'task_drift',
  RESOURCE_CONFLICT = 'resource_conflict',

  // 环境类
  NETWORK_ERROR = 'network_error',
  API_RATE_LIMIT = 'api_rate_limit',
  SANDBOX_CRASH = 'sandbox_crash'
}

interface RecoveryAction {
  type: 'retry' | 'escalate' | 'abort' | 'alternative';
  retryable: boolean;
  maxAttempts?: number;
  backoffMs?: number;
  handler: (ctx: Context, error: Error) => Promise<RecoveryResult>;
}

const AUTO_RECOVERY_ACTIONS: Record<FailurePattern, RecoveryAction> = {
  [FailurePattern.TOKEN_EXHAUSTION]: {
    type: 'retry',
    retryable: true,
    maxAttempts: 1,
    handler: async (ctx) => {
      await ctx.promptEngine.autoReduce();
      return { retry: true };
    }
  },

  [FailurePattern.DOOM_LOOP]: {
    type: 'abort',
    retryable: false,
    handler: async (ctx, error) => {
      return {
        abort: true,
        reason: `工具重复调用检测`,
        suggestion: '请尝试不同的方法'
      };
    }
  },

  [FailurePattern.NETWORK_ERROR]: {
    type: 'retry',
    retryable: true,
    maxAttempts: 3,
    backoffMs: 1000, // 指数退避
    handler: async (ctx, error) => {
      await sleep(ctx.attempt * 1000);
      return { retry: true };
    }
  }
};

// 风险评估矩阵
interface RiskAssessment {
  impact: 'low' | 'medium' | 'high' | 'critical';
  probability: 'low' | 'medium' | 'high';
  action: 'accept' | 'monitor' | 'mitigate' | 'must_handle';
}

function assessRisk(impact: string, probability: string): RiskAssessment['action'] {
  const matrix = {
    'low-low': 'accept',
    'low-medium': 'accept',
    'low-high': 'monitor',
    'medium-low': 'accept',
    'medium-medium': 'monitor',
    'medium-high': 'mitigate',
    'high-low': 'monitor',
    'high-medium': 'mitigate',
    'high-high': 'must_handle',
    'critical-low': 'mitigate',
    'critical-medium': 'must_handle',
    'critical-high': 'must_handle'
  };

  return matrix[`${impact}-${probability}`] || 'monitor';
}
```

---

## 4. 融合到 Coobee AI 的方案

### 4.1 与现有架构的映射

| Tachikoma 概念        | Coobee AI 对应组件              | 融合方式          |
| --------------------- | ------------------------------- | ----------------- |
| Orchestrator          | `AgentRuntimeManager`           | 扩展增强          |
| Planner               | 新增 `TaskPlanner`              | 独立模块          |
| Worker                | `Agent` (from `@openai/agents`) | 扩展配置          |
| Skills (Worker)       | `SkillManager`                  | 已实现            |
| Skills (Orchestrator) | ⭐ **新增设计**                 | 规划层技能        |
| Context Management    | `MemoryService`                 | 扩展预算管理      |
| Progress Monitoring   | ⭐ **新增模块**                 | `ProgressMonitor` |
| Risk Mitigation       | ⭐ **新增模块**                 | `RiskManager`     |

### 4.2 新增模块设计

```
src/main/ai/
├── core/
│   ├── AgentRuntime.ts          # 已规划
│   ├── SessionManager.ts        # 已规划
│   ├── TaskPlanner.ts           # ⭐ 新增（借鉴 Tachikoma Planner）
│   ├── ProgressMonitor.ts       # ⭐ 新增（进度评估）
│   ├── RiskManager.ts           # ⭐ 新增（风险缓解）
│   └── ContextBudget.ts         # ⭐ 新增（上下文预算）
│
├── agents/
│   ├── triage/                  # 已规划
│   ├── chat/                    # 已规划
│   ├── research/                # 已规划
│   └── validator/               # 已规划（与 Critic-Reviewer 模式契合）
│
├── planning/                    # ⭐ 新增模块
│   ├── decomposition.ts         # 任务分解（WBS + MECE）
│   ├── archetypes.ts            # 项目类型模板
│   ├── roles.ts                 # Worker 角色定义
│   └── index.ts
│
├── monitoring/                  # ⭐ 新增模块
│   ├── health-checker.ts        # 健康度评估
│   ├── deviation-detector.ts    # 偏离检测
│   ├── metrics.ts               # 监控指标
│   └── index.ts
│
├── recovery/                    # ⭐ 新增模块
│   ├── failure-patterns.ts      # 失败模式库
│   ├── recovery-actions.ts      # 恢复动作
│   ├── checkpoint.ts            # 检查点管理
│   └── index.ts
│
└── skills/                      # 已规划
    ├── builtin/
    │   ├── research.ts
    │   └── coding.ts
    ├── orchestrator/            # ⭐ 新增（规划层技能）
    │   ├── task-decomposition/
    │   ├── context-budget/
    │   └── progress-evaluation/
    └── manager/
        └── SkillManager.ts
```

### 4.3 关键集成点

#### 1. TaskPlanner 集成

```typescript
// src/main/ai/core/TaskPlanner.ts
import { TaskDecomposition } from '../planning/decomposition';
import { ProjectArchetype, matchArchetype } from '../planning/archetypes';

export class TaskPlanner {
  async plan(task: LongRunningTask): Promise<TaskPlan> {
    // 1. 识别项目类型
    const archetype = matchArchetype(task.name, task.description);

    // 2. 应用 WBS 分解
    const decomposition = await this.decompose(task, archetype);

    // 3. 生成执行计划
    return {
      steps: decomposition.steps,
      criticalPath: decomposition.criticalPath,
      archetype: archetype.type
    };
  }
}
```

#### 2. ProgressMonitor 集成

```typescript
// src/main/ai/monitoring/health-checker.ts
export class HealthChecker {
  async evaluateProgress(task: LongRunningTask, execution: ExecutionState): Promise<ProgressHealth> {
    // 使用 Tachikoma 的健康度算法
    const health = calculateHealth(task, execution);

    // 触发重规划
    if (health.status === 'critical') {
      await this.triggerReplan(task, health);
    }

    return health;
  }
}
```

#### 3. ContextBudget 集成

```typescript
// src/main/ai/core/ContextBudget.ts
export class ContextBudgetManager {
  private thresholds = CONTEXT_THRESHOLDS;
  private budget = ORCHESTRATOR_BUDGET;

  async checkAndReduce(context: AgentContext): Promise<void> {
    const tokens = this.countTokens(context);
    const strategy = selectReductionStrategy(tokens);

    switch (strategy.action) {
      case 'compact':
        await this.compact(context);
        break;
      case 'summarize':
        await this.summarize(context);
        break;
      case 'offload':
        await this.offload(context);
        break;
    }
  }
}
```

---

## 5. 实施建议

### 5.1 优先级排序

| 优先级 | 功能模块            | 价值 | 复杂度 | 建议时间 |
| ------ | ------------------- | ---- | ------ | -------- |
| ⭐⭐⭐ | 项目类型模板        | 极高 | 低     | Week 1   |
| ⭐⭐⭐ | 任务分解 (WBS)      | 极高 | 中     | Week 1-2 |
| ⭐⭐⭐ | 上下文预算管理      | 极高 | 中     | Week 2-3 |
| ⭐⭐   | Worker 角色系统     | 高   | 低     | Week 3   |
| ⭐⭐   | 进度健康度评估      | 高   | 中     | Week 4   |
| ⭐⭐   | 风险缓解矩阵        | 高   | 中     | Week 4-5 |
| ⭐     | 偏离检测            | 中   | 低     | Week 5   |
| ⭐     | Orchestrator Skills | 高   | 高     | Week 6+  |

### 5.2 快速验证方案 (MVP)

**第 1 周目标**: 验证核心价值

```typescript
// 1. 实现简化版项目类型模板
const SIMPLE_ARCHETYPES = {
  'new_project': { phases: [...] },
  'bug_fix': { phases: [...] },
  'feature': { phases: [...] }
};

// 2. 实现基础任务分解
function decomposeTask(task: string): SubTask[] {
  const type = detectType(task);
  return SIMPLE_ARCHETYPES[type].phases.map(phase => ({
    objective: phase.name,
    estimatedMinutes: phase.percentage * totalTime
  }));
}

// 3. 测试端到端流程
const task = createTask({
  name: '创建博客系统',
  description: '从零开始创建一个简单的博客'
});

const plan = await taskPlanner.plan(task);
console.log('计划:', plan);
// 输出:
// Phase 1: Scaffolding (10%)
// Phase 2: Core Architecture (25%)
// Phase 3: Feature Implementation (45%)
// ...
```

### 5.3 与长时任务系统的融合

```typescript
// src/main/ai/core/TaskExecutor.ts (扩展)

class TaskExecutor {
  private planner: TaskPlanner; // ⭐ 新增
  private monitor: ProgressMonitor; // ⭐ 新增

  async createTask(config: CreateTaskConfig): Promise<string> {
    // 1. 使用 Planner 生成执行计划
    const plan = await this.planner.plan({
      name: config.name,
      description: config.description
    });

    // 2. 创建任务（集成 Tachikoma 的 Archetype）
    const task: LongRunningTask = {
      id: generateId(),
      sessionId: config.sessionId,
      name: config.name,
      description: config.description,
      plan: plan, // ⭐ 使用增强的计划
      archetype: plan.archetype, // ⭐ 记录项目类型
      currentStepIndex: 0,
      status: TaskStatus.PENDING,
      progress: 0,
      checkpoints: [],
      validationStrategy: config.validationStrategy,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.taskStore.save(task);

    // 3. 开始执行（增强监控）
    await this.executeTask(task.id);

    return task.id;
  }

  async executeTask(taskId: string): Promise<void> {
    const task = await this.taskStore.get(taskId);

    try {
      task.status = TaskStatus.RUNNING;
      await this.taskStore.update(task);

      for (let i = task.currentStepIndex; i < task.plan.steps.length; i++) {
        const step = task.plan.steps[i];

        // ⭐ 执行前健康度检查
        const health = await this.monitor.checkHealth(task);
        if (health.status === 'critical') {
          log.warn('[TaskExecutor] 健康度低，触发重规划');
          await this.replan(task);
          continue;
        }

        // 执行步骤
        const result = await this.executeStep(task.sessionId, step);

        step.status = 'completed';
        step.result = result;
        task.currentStepIndex = i + 1;
        task.progress = Math.round(((i + 1) / task.plan.steps.length) * 100);

        await this.taskStore.update(task);
        await this.checkpointManager.create(task, 'step_completed');
      }

      // 进入验证阶段
      task.status = TaskStatus.VALIDATING;
      await this.validateTask(task);
    } catch (error) {
      // ⭐ 使用风险缓解系统
      const recovery = await this.riskManager.handleFailure(task, error);

      if (recovery.retry) {
        await this.executeTask(taskId); // 重试
      } else {
        task.status = TaskStatus.INTERRUPTED;
        await this.taskStore.update(task);
      }
    }
  }
}
```

---

## 总结

### 最值得立即借鉴的 TOP 5

1. ⭐⭐⭐ **项目类型模板 (Archetypes)** - 立即可用，价值极高
2. ⭐⭐⭐ **上下文预算管理** - 解决实际痛点，防止性能下降
3. ⭐⭐⭐ **任务分解 (WBS + MECE)** - 提升规划质量
4. ⭐⭐ **进度健康度评估** - 主动发现问题
5. ⭐⭐ **Worker 角色系统** - 专业化分工

### 与现有设计的完美契合点

1. **Critic-Reviewer 模式** ← 我们的 `Validator Agent`
2. **目标传播机制** ← 我们的 `LongRunningTask.parentObjective`
3. **完成判定逻辑** ← `@openai/agents` 的工具调用机制
4. **风险缓解** ← 我们的验证系统和重试策略

### 下一步行动

1. **本周**: 实现项目类型模板 + 基础任务分解
2. **下周**: 集成上下文预算管理
3. **第 3 周**: 实现进度监控和健康度评估
4. **第 4 周**: 完善风险缓解系统

---

**参考资料**:

- Tachikoma: `/Users/lifeng/git/git_agents/tachikoma/`
- Agentic Design Patterns: `docs/agentic-design-patterns/`
- Orchestrator Skills Design: `docs/orchestrator-skills-design.md`

_持续更新中..._
