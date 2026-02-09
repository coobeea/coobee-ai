# Orchestration 模块改进方案

## 📊 现状分析

### 当前实现

```
当前角色：
✅ Orchestrator（统筹者）
✅ Planner（计划者）
✅ Workers（工作者）

缺失部分：
❌ Verification Gate / Reflection（评审者/反思）
❌ 文件持久化机制（计划写入文件系统）
❌ 会话目录管理
❌ 审批机制
```

---

## 🎯 目标架构

### 完整的四角色架构

```
┌─────────────────────────────────────────────────────────┐
│                   完整的协作流程                          │
└─────────────────────────────────────────────────────────┘

1️⃣ Orchestrator（统筹者）
   ├─ 协调整个流程
   ├─ 监控执行进度
   └─ 决策是否重新规划

2️⃣ Planner（计划者）
   ├─ 接收任务目标
   ├─ 分解为子任务
   ├─ 生成执行计划
   └─ 写入计划文件 ← 新增

3️⃣ Workers（工作者）
   ├─ 执行具体子任务
   ├─ 调用工具
   ├─ 写入执行日志 ← 新增
   └─ 生成结果

4️⃣ Verification Gate（评审者）← 新增
   ├─ 检查 Worker 输出
   ├─ 评估质量
   ├─ 识别问题
   └─ 生成改进建议
```

### 文件系统结构

```
~/.coobee-ai/sessions/{sessionId}/
├── orchestrator/           # 统筹者目录
│   ├── runtime.json        # 运行时快照（当前计划）
│   ├── progress.json       # 执行进度
│   ├── decisions.jsonl     # 决策日志
│   └── checkpoints/        # 检查点（断点续传）
│
├── planner/                # 计划者目录 ← 新增
│   ├── original_task.json  # 原始任务
│   ├── execution_plan.json # 执行计划
│   └── replans/            # 重新规划历史
│       ├── replan-001.json
│       └── replan-002.json
│
├── workers/                # 工作者目录
│   ├── worker-001/
│   │   ├── status.json     # 状态
│   │   ├── thinking.jsonl  # 思考日志
│   │   ├── actions.jsonl   # 行动日志
│   │   └── output.json     # 输出结果
│   └── worker-002/
│       └── ...
│
├── verification/           # 评审者目录 ← 新增
│   ├── checks/             # 检查记录
│   │   ├── subtask-001-check.json
│   │   └── subtask-002-check.json
│   ├── issues.jsonl        # 发现的问题
│   └── fixes/              # 修复记录
│       ├── fix-001.json
│       └── fix-002.json
│
└── shared/                 # 共享目录
    ├── context.json        # 共享上下文
    └── messages.jsonl      # 消息日志
```

---

## 🔄 完整的执行流程

### 流程图

```
┌────────────────────────────────────────────────────────────┐
│                      任务执行流程                           │
└────────────────────────────────────────────────────────────┘

用户输入任务
    ↓
┌───────────────────┐
│ 1️⃣ Orchestrator   │ 接收任务，初始化会话目录
└─────────┬─────────┘
          │
          ↓ 调用 Planner
┌───────────────────┐
│ 2️⃣ Planner        │ 分解任务，生成计划
│                   │ 写入: planner/execution_plan.json
└─────────┬─────────┘
          │
          ↓ 返回 ExecutionPlan
┌───────────────────┐
│ 3️⃣ Orchestrator   │ 分配任务给 Workers
│                   │ 写入: orchestrator/progress.json
└─────────┬─────────┘
          │
          ↓ 并行/顺序执行
┌───────────────────┐
│ 4️⃣ Workers        │ 执行子任务
│  (worker-001)     │ 写入: workers/worker-001/output.json
│  (worker-002)     │
└─────────┬─────────┘
          │
          ↓ 每个子任务完成后
┌───────────────────┐
│ 5️⃣ Verification   │ 检查输出质量 ← 新增
│  Gate             │
└─────────┬─────────┘
          │
          ├─ ✅ 通过
          │   └─→ 标记子任务完成
          │
          └─ ❌ 失败
              ↓
        ┌───────────────────┐
        │ 6️⃣ 修复循环       │
        │  (Reflection)     │
        └─────────┬─────────┘
                  │
                  ├─ 自动修复？
                  │   ├─ 是 → 重新执行子任务
                  │   └─ 否 ↓
                  │
                  ├─ LLM修复？
                  │   └─→ Worker 执行修复任务
                  │
                  └─ 超过重试次数？
                      └─→ 标记失败，通知 Orchestrator
                          ↓
                    ┌───────────────────┐
                    │ 7️⃣ Orchestrator   │
                    │  决策              │
                    └─────────┬─────────┘
                              │
                              ├─ 重新规划？
                              │   └─→ 调用 Planner 重新生成计划
                              │
                              └─ 任务失败
                                  └─→ 返回失败结果
```

---

## 📦 新增模块设计

### 1. VerificationGate（评审者）

#### 接口定义

```typescript
// src/main/ai/orchestration/VerificationGate.ts

/**
 * 验证规则
 */
export interface VerificationRule {
  id: string
  name: string
  type: 'format' | 'content' | 'structure' | 'logic' | 'custom'
  execute: (output: unknown) => Promise<VerificationResult>
}

/**
 * 验证结果
 */
export interface VerificationResult {
  passed: boolean
  ruleId: string
  ruleName: string
  message?: string
  issues?: VerificationIssue[]
  suggestions?: string[]
}

/**
 * 验证问题
 */
export interface VerificationIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  location?: {
    line?: number
    column?: number
    file?: string
  }
}

/**
 * 评审者接口
 */
export interface IVerificationGate {
  /**
   * 验证子任务输出
   */
  verify(
    subTaskId: string,
    output: unknown,
    rules?: VerificationRule[]
  ): Promise<{
    passed: boolean
    results: VerificationResult[]
  }>

  /**
   * 生成修复建议
   */
  generateFixSuggestions(issues: VerificationIssue[]): Promise<string>
}

/**
 * 评审者实现
 */
export class VerificationGate implements IVerificationGate {
  constructor(
    private sessionManager: SessionFileManager,
    private sessionId: string
  ) {}

  async verify(
    subTaskId: string,
    output: unknown,
    rules: VerificationRule[] = []
  ): Promise<{ passed: boolean; results: VerificationResult[] }> {
    console.log(`[VerificationGate] Verifying subtask: ${subTaskId}`)

    const results: VerificationResult[] = []

    // 执行所有验证规则
    for (const rule of rules) {
      const result = await rule.execute(output)
      results.push(result)

      // 写入验证记录
      await this.sessionManager.writeVerificationCheck(subTaskId, rule.id, result)
    }

    const passed = results.every((r) => r.passed)

    if (!passed) {
      // 收集所有问题
      const allIssues = results.flatMap((r) => r.issues || [])
      await this.sessionManager.writeVerificationIssues(subTaskId, allIssues)
    }

    console.log(`[VerificationGate] Verification ${passed ? 'passed' : 'failed'}: ${subTaskId}`)

    return { passed, results }
  }

  async generateFixSuggestions(issues: VerificationIssue[]): Promise<string> {
    // 根据问题生成修复建议
    const suggestions = issues.map((issue) => {
      return `- ${issue.severity.toUpperCase()}: ${issue.message}`
    })

    return `发现以下问题，需要修复：\n${suggestions.join('\n')}`
  }
}
```

#### 内置验证规则

```typescript
// src/main/ai/orchestration/verification-rules/

/**
 * 格式验证
 */
export const formatValidationRule: VerificationRule = {
  id: 'format-json',
  name: 'JSON格式验证',
  type: 'format',
  execute: async (output) => {
    try {
      if (typeof output === 'string') {
        JSON.parse(output)
      }
      return { passed: true, ruleId: 'format-json', ruleName: 'JSON格式验证' }
    } catch (error) {
      return {
        passed: false,
        ruleId: 'format-json',
        ruleName: 'JSON格式验证',
        message: '输出不是有效的JSON格式',
        issues: [
          {
            severity: 'error',
            code: 'INVALID_JSON',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      }
    }
  }
}

/**
 * 内容完整性验证
 */
export const contentCompletenessRule: VerificationRule = {
  id: 'content-completeness',
  name: '内容完整性验证',
  type: 'content',
  execute: async (output) => {
    // 检查输出是否为空
    if (!output || (typeof output === 'string' && output.trim().length === 0)) {
      return {
        passed: false,
        ruleId: 'content-completeness',
        ruleName: '内容完整性验证',
        message: '输出内容为空',
        issues: [
          {
            severity: 'error',
            code: 'EMPTY_OUTPUT',
            message: '任务输出不能为空'
          }
        ]
      }
    }

    return {
      passed: true,
      ruleId: 'content-completeness',
      ruleName: '内容完整性验证'
    }
  }
}

/**
 * 自定义验证规则工厂
 */
export function createCustomRule(
  id: string,
  name: string,
  validate: (output: unknown) => boolean,
  errorMessage: string
): VerificationRule {
  return {
    id,
    name,
    type: 'custom',
    execute: async (output) => {
      const passed = validate(output)
      return {
        passed,
        ruleId: id,
        ruleName: name,
        message: passed ? undefined : errorMessage,
        issues: passed
          ? []
          : [
              {
                severity: 'error',
                code: 'CUSTOM_VALIDATION_FAILED',
                message: errorMessage
              }
            ]
      }
    }
  }
}
```

### 2. SessionFileManager（会话文件管理器）

```typescript
// src/main/ai/orchestration/SessionFileManager.ts

import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

/**
 * 会话文件管理器
 * 负责管理会话目录和文件读写
 */
export class SessionFileManager {
  private readonly basePath: string

  constructor(private readonly sessionId: string) {
    // ~/.coobee-ai/sessions/{sessionId}/
    this.basePath = join(app.getPath('userData'), 'sessions', sessionId)
  }

  /**
   * 初始化会话目录结构
   */
  async initialize(): Promise<void> {
    const dirs = [
      '',
      'orchestrator',
      'orchestrator/checkpoints',
      'planner',
      'planner/replans',
      'workers',
      'verification',
      'verification/checks',
      'verification/fixes',
      'shared'
    ]

    for (const dir of dirs) {
      await mkdir(join(this.basePath, dir), { recursive: true })
    }

    console.log(`[SessionFileManager] Initialized session directory: ${this.basePath}`)
  }

  // ========== Planner 文件操作 ==========

  /**
   * 写入原始任务
   */
  async writeOriginalTask(task: Task): Promise<void> {
    const path = join(this.basePath, 'planner', 'original_task.json')
    await writeFile(path, JSON.stringify(task, null, 2))
  }

  /**
   * 写入执行计划
   */
  async writeExecutionPlan(plan: ExecutionPlan): Promise<void> {
    const path = join(this.basePath, 'planner', 'execution_plan.json')
    await writeFile(path, JSON.stringify(plan, null, 2))
  }

  /**
   * 写入重新规划
   */
  async writeReplan(replanId: string, plan: ExecutionPlan): Promise<void> {
    const path = join(this.basePath, 'planner', 'replans', `${replanId}.json`)
    await writeFile(path, JSON.stringify(plan, null, 2))
  }

  /**
   * 读取执行计划
   */
  async readExecutionPlan(): Promise<ExecutionPlan | null> {
    try {
      const path = join(this.basePath, 'planner', 'execution_plan.json')
      const content = await readFile(path, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  // ========== Orchestrator 文件操作 ==========

  /**
   * 写入运行时快照
   */
  async writeRuntimeSnapshot(snapshot: Record<string, unknown>): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'runtime.json')
    await writeFile(path, JSON.stringify(snapshot, null, 2))
  }

  /**
   * 写入执行进度
   */
  async writeProgress(progress: {
    totalSubTasks: number
    completedSubTasks: number
    failedSubTasks: number
    currentStage: number
  }): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'progress.json')
    await writeFile(path, JSON.stringify(progress, null, 2))
  }

  /**
   * 追加决策日志
   */
  async appendDecision(decision: {
    timestamp: number
    type: string
    description: string
    data?: unknown
  }): Promise<void> {
    const path = join(this.basePath, 'orchestrator', 'decisions.jsonl')
    await writeFile(path, JSON.stringify(decision) + '\n', { flag: 'a' })
  }

  // ========== Worker 文件操作 ==========

  /**
   * 写入 Worker 状态
   */
  async writeWorkerStatus(
    workerId: string,
    status: { state: string; currentTask?: string }
  ): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'status.json')
    await mkdir(join(this.basePath, 'workers', workerId), { recursive: true })
    await writeFile(path, JSON.stringify(status, null, 2))
  }

  /**
   * 追加 Worker 思考日志
   */
  async appendWorkerThinking(workerId: string, thinking: string): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'thinking.jsonl')
    const entry = { timestamp: Date.now(), content: thinking }
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' })
  }

  /**
   * 写入 Worker 输出
   */
  async writeWorkerOutput(workerId: string, output: unknown): Promise<void> {
    const path = join(this.basePath, 'workers', workerId, 'output.json')
    await writeFile(path, JSON.stringify(output, null, 2))
  }

  // ========== Verification 文件操作 ==========

  /**
   * 写入验证检查记录
   */
  async writeVerificationCheck(
    subTaskId: string,
    ruleId: string,
    result: VerificationResult
  ): Promise<void> {
    const path = join(this.basePath, 'verification', 'checks', `${subTaskId}-${ruleId}.json`)
    await writeFile(path, JSON.stringify(result, null, 2))
  }

  /**
   * 追加验证问题
   */
  async writeVerificationIssues(subTaskId: string, issues: VerificationIssue[]): Promise<void> {
    const path = join(this.basePath, 'verification', 'issues.jsonl')
    const entry = {
      timestamp: Date.now(),
      subTaskId,
      issues
    }
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' })
  }

  /**
   * 写入修复记录
   */
  async writeFixRecord(
    fixId: string,
    record: {
      subTaskId: string
      attempt: number
      method: 'auto' | 'llm'
      success: boolean
      details?: unknown
    }
  ): Promise<void> {
    const path = join(this.basePath, 'verification', 'fixes', `${fixId}.json`)
    await writeFile(path, JSON.stringify(record, null, 2))
  }

  // ========== Shared 文件操作 ==========

  /**
   * 写入共享上下文
   */
  async writeSharedContext(context: Record<string, unknown>): Promise<void> {
    const path = join(this.basePath, 'shared', 'context.json')
    await writeFile(path, JSON.stringify(context, null, 2))
  }

  /**
   * 追加消息日志
   */
  async appendMessage(message: {
    from: string
    to: string
    type: string
    content: unknown
  }): Promise<void> {
    const path = join(this.basePath, 'shared', 'messages.jsonl')
    const entry = { timestamp: Date.now(), ...message }
    await writeFile(path, JSON.stringify(entry) + '\n', { flag: 'a' })
  }
}
```

---

## 🔧 改进后的 Orchestrator

```typescript
// src/main/ai/orchestration/Orchestrator.ts (改进版)

export class Orchestrator implements IOrchestrator {
  private sessionManager!: SessionFileManager
  private verificationGate!: VerificationGate

  constructor(
    private readonly planner: IPlanner,
    private readonly workerCoordinator: IWorkerCoordinator,
    config?: OrchestratorConfig
  ) {
    // ... 初始化配置
  }

  async initialize(sessionId: string): Promise<void> {
    // 初始化文件管理器
    this.sessionManager = new SessionFileManager(sessionId)
    await this.sessionManager.initialize()

    // 初始化评审者
    this.verificationGate = new VerificationGate(this.sessionManager, sessionId)

    console.log(`[Orchestrator] Initialized with session: ${sessionId}`)
  }

  async executeTask(task: Task): Promise<TaskExecutionResult> {
    const startTime = Date.now()

    // 写入原始任务
    await this.sessionManager.writeOriginalTask(task)

    try {
      // 1️⃣ 规划阶段
      const plan = await this.planner.plan(task)
      await this.sessionManager.writeExecutionPlan(plan)
      await this.sessionManager.appendDecision({
        timestamp: Date.now(),
        type: 'plan_created',
        description: '任务规划完成',
        data: { subTasksCount: plan.subTasks.length }
      })

      // 2️⃣ 执行阶段
      const subTaskResults = await this.executePlan(plan)

      // 3️⃣ 聚合阶段
      const finalOutput = this.aggregateResults(subTaskResults)

      return {
        taskId: task.id,
        status: 'success',
        finalOutput,
        subTaskResults,
        stats: {
          /* ... */
        }
      }
    } catch (error) {
      // 记录失败
      await this.sessionManager.appendDecision({
        timestamp: Date.now(),
        type: 'task_failed',
        description: '任务执行失败',
        data: { error: error instanceof Error ? error.message : String(error) }
      })

      throw error
    }
  }

  /**
   * 执行计划（带验证和修复循环）
   */
  private async executePlan(plan: ExecutionPlan): Promise<SubTaskExecutionResult[]> {
    const results: SubTaskExecutionResult[] = []

    for (const subTask of plan.subTasks) {
      // 执行子任务（带修复循环）
      const result = await this.executeSubTaskWithVerification(subTask)
      results.push(result)

      // 更新进度
      await this.sessionManager.writeProgress({
        totalSubTasks: plan.subTasks.length,
        completedSubTasks: results.filter((r) => r.status === 'completed').length,
        failedSubTasks: results.filter((r) => r.status === 'failed').length,
        currentStage: 0 // TODO: 实现阶段管理
      })
    }

    return results
  }

  /**
   * 执行子任务（带验证和修复循环）← 新增
   */
  private async executeSubTaskWithVerification(subTask: SubTask): Promise<SubTaskExecutionResult> {
    const MAX_FIX_ATTEMPTS = 3
    let attempt = 0

    while (attempt <= MAX_FIX_ATTEMPTS) {
      // 执行子任务
      const output = await this.workerCoordinator.executeSubTask(subTask)

      // 写入输出
      await this.sessionManager.writeWorkerOutput(subTask.workerId || 'default', output)

      // 验证输出
      const verification = await this.verificationGate.verify(subTask.id, output, [
        formatValidationRule,
        contentCompletenessRule
      ])

      if (verification.passed) {
        // 验证通过
        return {
          subTaskId: subTask.id,
          status: 'completed',
          result: output
        }
      }

      // 验证失败
      attempt++

      if (attempt > MAX_FIX_ATTEMPTS) {
        // 超过重试次数
        await this.sessionManager.appendDecision({
          timestamp: Date.now(),
          type: 'subtask_failed',
          description: `子任务失败，已达最大重试次数: ${subTask.id}`,
          data: { attempts: attempt }
        })

        return {
          subTaskId: subTask.id,
          status: 'failed',
          error: '超过最大修复尝试次数'
        }
      }

      // 生成修复建议
      const allIssues = verification.results.flatMap((r) => r.issues || [])
      const fixSuggestion = await this.verificationGate.generateFixSuggestions(allIssues)

      // 记录修复尝试
      await this.sessionManager.writeFixRecord(`fix-${subTask.id}-${attempt}`, {
        subTaskId: subTask.id,
        attempt,
        method: 'llm',
        success: false
      })

      // 创建修复任务
      const fixTask: SubTask = {
        ...subTask,
        description: `修复任务: ${subTask.description}\n\n问题:\n${fixSuggestion}`
      }

      // 继续循环，重新执行
    }

    // 不应该到达这里
    throw new Error('Unexpected execution path')
  }
}
```

---

## 📋 实施步骤

### Phase 1: 文件系统基础（1-2天）

1. ✅ 实现 `SessionFileManager`
2. ✅ 集成到 `Orchestrator`
3. ✅ 测试文件读写

### Phase 2: 评审模块（2-3天）

1. ✅ 实现 `VerificationGate`
2. ✅ 实现内置验证规则
3. ✅ 集成到执行流程

### Phase 3: 修复循环（2-3天）

1. ✅ 实现修复循环逻辑
2. ✅ 实现自动修复机制
3. ✅ 实现LLM修复

### Phase 4: 优化和测试（2天）

1. ✅ 完善错误处理
2. ✅ 添加日志和监控
3. ✅ 端到端测试

---

## 🎯 预期收益

### 1. 可靠性提升

- ✅ 计划持久化到文件，可恢复
- ✅ 执行日志完整记录，可追溯

### 2. 质量提升

- ✅ 自动验证输出质量
- ✅ 自动修复常见问题
- ✅ 减少错误输出

### 3. 可观测性提升

- ✅ 完整的文件记录
- ✅ 清晰的执行路径
- ✅ 便于调试和分析

### 4. 可扩展性提升

- ✅ 易于添加新的验证规则
- ✅ 支持自定义修复策略
- ✅ 支持断点续传

---

## 📚 参考资料

- [Tachikoma Orchestrator-Worker 交互机制](./Orchestrator-Worker交互机制深度解析.md)
- [Agentic 设计模式 - Reflection](./Orchestrator-Worker交互机制深度解析.md#reflection---反思模式)
- [文件协调机制](./Orchestrator-Worker交互机制深度解析.md#第二层文件协调共享文件系统)
