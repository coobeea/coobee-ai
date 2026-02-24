# Orchestrator-Worker 交互机制深度解析

> 深入剖析 Tachikoma 多智能体系统的核心设计：Orchestrator 和 Worker 之间的三层交互架构

## 📖 目录

1. [核心设计理念](#核心设计理念)
2. [三层交互架构](#三层交互架构)
3. [第一层：内存通信（直接调用）](#第一层内存通信直接调用)
4. [第二层：文件协调（共享文件系统）](#第二层文件协调共享文件系统)
5. [第三层：消息流（实时监控）](#第三层消息流实时监控)
6. [完整交互流程示例](#完整交互流程示例)
7. [任务传递与上下文工程](#任务传递与上下文工程)
8. [任务层次结构详解](#任务层次结构详解)
9. [验证门机制深度解析](#验证门机制深度解析)
10. [Session 与多任务管理](#session与多任务管理)
11. [两种运行模式对比](#两种运行模式对比)
12. [文件协议规范](#文件协议规范)
13. [Agentic 设计模式在 Tachikoma 中的应用](#agentic-设计模式在-tachikoma-中的应用)
    - [核心设计模式概览](#核心设计模式概览)
    - [Prompt Chaining - 提示词链](#prompt-chaining---提示词链)
    - [Routing - 路由模式](#routing---路由模式)
    - [Parallelization - 并行化](#parallelization---并行化)
    - [Reflection - 反思模式](#reflection---反思模式)
    - [Tool Use - 工具使用](#tool-use---工具使用)
    - [Planning - 规划模式](#planning---规划模式)
    - [Multi-Agent Collaboration - 多智能体协作](#multi-agent-collaboration---多智能体协作)
    - [Memory Management - 记忆管理](#memory-management---记忆管理)
    - [Goal Setting and Monitoring - 目标设置与监控](#goal-setting-and-monitoring---目标设置与监控)
    - [Evaluation and Monitoring - 评估与监控](#evaluation-and-monitoring---评估与监控)
    - [Resource-Aware Optimization - 资源感知优化](#resource-aware-optimization---资源感知优化)
    - [Exception Handling - 异常处理](#exception-handling---异常处理)
    - [Human-in-the-Loop - 人机协作](#human-in-the-loop---人机协作)
14. [设计优势分析](#设计优势分析)
15. [实现细节与代码导读](#实现细节与代码导读)

---

## 核心设计理念

Tachikoma 采用了**混合式多智能体协作架构**，核心思想是：

```
🎯 目标：让 Orchestrator 和 Worker 既能高效协作，又能容错恢复

💡 设计哲学：
   - 快速路径（Fast Path）：内存通信，直接调用，低延迟
   - 可靠路径（Reliable Path）：文件协调，持久化状态，可恢复
   - 监控路径（Observable Path）：消息流，实时监控，可观测
```

### 核心角色

| 角色           | 类名                             | 职责                       | 运行模式 |
| -------------- | -------------------------------- | -------------------------- | -------- |
| **统筹者**     | `Orchestrator`                   | 任务规划、分配、监控、聚合 | 持续运行 |
| **规划者**     | `Planner`                        | 将高层任务分解为子任务     | 按需调用 |
| **工作者**     | `Worker` (通过 `WorkerExecutor`) | 执行具体子任务，调用工具   | 并发执行 |
| **会话管理器** | `SessionFileManager`             | 管理共享文件系统协调       | 后台服务 |

---

## 三层交互架构

Tachikoma 的 Orchestrator-Worker 交互采用**三层架构**，每一层负责不同的职责：

```
┌─────────────────────────────────────────────────────────────────┐
│                     三层交互架构全景                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: 内存通信 (Memory Communication)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Orchestrator ←─直接调用─→ WorkerPool ←─引用─→ Worker    │  │
│  │  • 任务分配                                               │  │
│  │  • 结果收集                                               │  │
│  │  • 快速响应（毫秒级）                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           ↕                                     │
│  Layer 2: 文件协调 (File-based Coordination)                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  .tachikoma/sessions/{sessionId}/                         │  │
│  │  ├─ orchestrator/  (统筹者目录)                          │  │
│  │  ├─ workers/       (工作者目录)                          │  │
│  │  └─ shared/        (共享目录)                            │  │
│  │  • 审批流程                                               │  │
│  │  • 干预指令                                               │  │
│  │  • 状态持久化                                             │  │
│  │  • Worker间协作                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           ↕                                     │
│  Layer 3: 消息流 (Message Stream)                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  AsyncIterable<WorkerMessage>                             │  │
│  │  • 思考过程 (thinking)                                    │  │
│  │  • 工具调用 (tool_call)                                   │  │
│  │  • 执行结果 (tool_result)                                 │  │
│  │  • 实时监控（流式输出）                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 层级职责对比

| 特性         | Layer 1 (内存)    | Layer 2 (文件)     | Layer 3 (消息流) |
| ------------ | ----------------- | ------------------ | ---------------- |
| **通信延迟** | <1ms              | 10-100ms           | 实时流式         |
| **持久化**   | ❌ 否             | ✅ 是              | ❌ 否            |
| **可恢复**   | ❌ 否             | ✅ 是              | ❌ 否            |
| **可观测**   | ⚠️ 弱             | ✅ 强              | ✅ 强            |
| **跨进程**   | ❌ 否             | ✅ 是              | ⚠️ 弱            |
| **适用场景** | 任务分配/结果收集 | 审批/干预/状态同步 | 进度监控/调试    |

---

## 第一层：内存通信（直接调用）

### 设计原理

内存通信是**最快的交互方式**，适用于：

- ✅ 任务分配
- ✅ 结果收集
- ✅ Worker 池管理

**核心思想**：Orchestrator 通过 WorkerPool 管理 Worker 实例的引用，直接调用其方法。

### 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                 Orchestrator (统筹者)                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  run(task: Task): Promise<TaskResult>                  │  │
│  │    ├─ 1. 规划：planner.plan(task)                      │  │
│  │    ├─ 2. 分配：workerPool.assign(subtask)             │  │
│  │    ├─ 3. 执行：worker.execute(subtask, tools)         │  │
│  │    └─ 4. 聚合：aggregateResults()                     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ 内存引用
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    WorkerPool (Worker池)                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  • workers: Map<workerId, WorkerInfo>                  │  │
│  │  • register(worker): boolean                           │  │
│  │  • assign(subtask): { workerId, success }              │  │
│  │  • findIdleByCapability(cap): Worker?                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ 引用
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Worker (工作者实例)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  • id: string                                          │  │
│  │  • status: 'idle' | 'busy' | 'error'                   │  │
│  │  • capabilities: string[]                              │  │
│  │  • agent: WorkerAgent                                  │  │
│  │  • execute(subtask, tools): Promise<TaskResult>        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 关键代码流程

#### 1. Orchestrator 初始化 WorkerPool

```typescript
// packages/core/src/orchestrator/orchestrator.ts
class Orchestrator {
  constructor(id: string, options: OrchestratorOptions) {
    // 创建 WorkerPool
    this.workerPool = options.workerPool ?? new DefaultWorkerPool(orchestratorConfig.workerPool);
  }
}
```

#### 2. 分配任务给 Worker

```typescript
// packages/core/src/orchestrator/runner/worker-manager.ts
class WorkerManager {
  async findOrCreateWorkerForRole(roleId: string): Promise<string | null> {
    const roleCap = `role:${roleId}`;

    // 1️⃣ 尝试找到空闲的 Worker（内存查找，O(n)）
    const idleWorker = this.workerPool.findIdleByCapability(roleCap);
    if (idleWorker) {
      console.debug(`Reusing idle worker ${idleWorker.id}`);
      return idleWorker.id; // 直接返回 Worker ID
    }

    // 2️⃣ 如果没有空闲 Worker，创建新的
    const newWorkerId = await this.createWorkerForRole(roleId);
    return newWorkerId;
  }

  async createWorkerForRole(roleId: string): Promise<string | null> {
    // 3️⃣ 创建 Worker 实例
    const agent = new WorkerAgent(workerId, agentConfig, options);

    // 4️⃣ 注册到 WorkerPool（内存操作）
    const ok = this.workerPool.register({
      id: workerId,
      status: 'idle',
      agent,
      capabilities
    });

    return ok ? workerId : null;
  }
}
```

#### 3. 执行任务（直接调用）

```typescript
// packages/core/src/orchestrator/runner/execution-loop.ts
class ExecutionLoop {
  private async executeSubtask(subtask: SubTask, workerId: string): Promise<TaskResult> {
    // 1️⃣ 从 WorkerPool 获取 Worker 实例（内存引用）
    const workerInfo = this.workerPool.getWorker(workerId);
    if (!workerInfo) {
      throw new Error(`Worker ${workerId} not found`);
    }

    // 2️⃣ 获取可用工具列表
    const tools = await this.getAvailableTools();

    // 3️⃣ 直接调用 Worker 的 execute 方法（内存调用）
    const result = await workerInfo.agent.execute(subtask, tools);

    return result;
  }
}
```

### 性能优势

| 操作            | 延迟     | 说明                |
| --------------- | -------- | ------------------- |
| 查找空闲 Worker | <0.1ms   | Map 查找 O(n)       |
| 分配任务        | <0.5ms   | 更新状态 + 引用传递 |
| 方法调用        | <0.01ms  | 直接函数调用        |
| **总延迟**      | **<1ms** | 几乎无开销          |

---

## 第二层：文件协调（共享文件系统）

### 设计原理

文件协调是 Tachikoma 的**创新之处**，解决了多智能体系统的核心挑战：

🎯 **核心问题**：

- ❌ 如何让 Orchestrator 在 Worker 执行危险操作前进行审批？
- ❌ 如何在检测到 Worker 偏离目标时及时干预？
- ❌ 如何在系统崩溃后恢复到正确状态？
- ❌ 如何让多个 Worker 协作共享信息？

💡 **解决方案**：**共享文件系统 + 文件监控**

类比：就像团队协作使用"共享文档"，Orchestrator 和 Worker 通过读写共享文件来协调。

### 文件目录结构

```
.tachikoma/sessions/{sessionId}/
│
├── orchestrator/                    # 🎯 统筹者目录（全局视角）
│   ├── runtime.json                 # 运行时快照（规划信息）
│   ├── progress.json                # 执行进度（当前阶段/完成率）
│   ├── decisions.jsonl              # 决策日志（审批记录）
│   └── checkpoints/                 # 检查点目录（断点续传）
│       ├── checkpoint-001.json
│       └── checkpoint-002.json
│
├── workers/                         # 👷 工作者目录（每个Worker独立）
│   ├── worker-001/
│   │   ├── status.json              # 🔴 Worker状态（idle/thinking/acting）
│   │   ├── thinking.jsonl           # 💭 思考日志（推理过程）
│   │   ├── actions.jsonl            # ⚡ 行动日志（工具调用记录）
│   │   ├── pending_approval.json    # ⏸️  审批请求（需要Orchestrator批准）
│   │   ├── approval_response.json   # ✅ 审批响应（Orchestrator的决策）
│   │   ├── intervention.json        # 🚨 干预指令（Orchestrator发送）
│   │   └── artifacts/               # 📦 产出物（生成的文件/代码）
│   │       ├── code.py
│   │       └── result.json
│   │
│   └── worker-002/
│       └── ...
│
└── shared/                          # 🌐 共享区域（所有角色可访问）
    ├── context.json                 # 共享上下文（目标/约束/共享知识）
    └── messages.jsonl               # 消息日志（跨角色通信）
```

### 核心交互场景

#### 场景 1: 审批流程（Worker 请求 → Orchestrator 批准）

**问题**：Worker 需要执行危险操作（如删除文件），需要得到批准。

**流程图**：

```
Worker                    文件系统                    Orchestrator
  │                          │                            │
  │  1️⃣ 检测到需要审批       │                            │
  │  (删除文件操作)          │                            │
  │                          │                            │
  │  ─────写入───────────>   │                            │
  │  pending_approval.json   │                            │
  │  {                       │                            │
  │    requestId: "001",     │                            │
  │    type: "file_deletion",│                            │
  │    affectedFiles: [...]  │                            │
  │  }                       │                            │
  │                          │                            │
  │  2️⃣ 暂停执行，等待响应   │                            │
  │  (轮询 approval_response)│                            │
  │                          │                            │
  │                          │  <───────监听到文件变化──── │
  │                          │  (fs.watch 触发事件)       │
  │                          │                            │
  │                          │                     3️⃣ 评估决策
  │                          │                     - 分析影响范围
  │                          │                     - 应用审批策略
  │                          │                     - 做出决定
  │                          │                            │
  │                          │  <───────写入响应───────── │
  │                          │  approval_response.json    │
  │                          │  {                         │
  │                          │    requestId: "001",       │
  │                          │    approved: true,         │
  │                          │    reason: "低影响操作"    │
  │                          │  }                         │
  │                          │                            │
  │  <───────读取响应────    │                            │
  │  (轮询检测到文件存在)    │                            │
  │                          │                            │
  │  4️⃣ 继续执行             │                            │
  │  (执行删除操作)          │                            │
  │                          │                            │
  │  ─────删除审批文件───>   │                            │
  │  (清理 pending_approval) │                            │
  │                          │                            │
```

**Worker 端代码**：

```typescript
// packages/core/src/worker/worker-executor.ts
class WorkerExecutor {
  async execute(subtask: SubTask, tools: Tool[]) {
    // ... 执行过程中 ...

    // 检测到需要审批的操作
    if (needsApproval(toolCall)) {
      // 1️⃣ 写入审批请求
      await this.sessionManager.writePendingApproval(this.workerId, {
        requestId: generateId(),
        workerId: this.workerId,
        subtaskId: subtask.id,
        requestedAt: Date.now(),
        type: 'file_deletion',
        description: '删除旧配置文件',
        details: {
          affectedFiles: ['config/old.json'],
          impactScope: 'low',
          reversible: true
        },
        timeout: 30000,
        defaultDecision: 'approve'
      });

      // 2️⃣ 等待审批响应（轮询）
      const response = await this.waitForApproval(this.workerId, 30000);

      if (response.approved) {
        // 3️⃣ 批准，继续执行
        await executeTool(toolCall);
      } else {
        // 3️⃣ 拒绝，跳过操作
        throw new Error(`审批被拒绝: ${response.reason}`);
      }
    }
  }

  // 轮询等待审批响应
  private async waitForApproval(workerId: string, timeout: number): Promise<ApprovalResponseFile> {
    const startTime = Date.now();
    const pollInterval = 500; // 500ms 轮询一次

    while (Date.now() - startTime < timeout) {
      const response = await this.sessionManager.readApprovalResponse(workerId);
      if (response) {
        return response;
      }
      await sleep(pollInterval);
    }

    throw new Error('审批超时');
  }
}
```

**Orchestrator 端代码**：

```typescript
// packages/core/src/orchestrator/services/approval-arbitration.ts
class ApprovalArbitrationService {
  async handlePendingApproval(event: SessionFileEvent<PendingApprovalFile>): Promise<void> {
    const approval = event.data;
    const workerId = event.workerId!;

    // 1️⃣ 评估决策
    const decision = await this.evaluateApproval(approval);

    // 2️⃣ 写入审批响应
    await this.sessionManager.writeApprovalResponse(workerId, {
      requestId: approval.requestId,
      respondedAt: Date.now(),
      approved: decision.approved,
      respondedBy: 'orchestrator',
      reason: decision.reason
    });

    // 3️⃣ 记录决策日志
    await this.sessionManager.appendDecision({
      type: 'approval',
      workerId,
      decision: {
        approved: decision.approved,
        reason: decision.reason
      }
    });
  }

  private async evaluateApproval(approval: PendingApprovalFile): Promise<{ approved: boolean; reason: string }> {
    // 应用审批策略
    const policy = this.config.approval;

    // 1. 检查是否在自动批准列表
    if (policy.autoApproveTypes?.includes(approval.type)) {
      return { approved: true, reason: '自动批准类型' };
    }

    // 2. 检查是否是低影响操作
    if (policy.lowImpactAutoApprove && approval.details.impactScope === 'low') {
      return { approved: true, reason: '低影响操作' };
    }

    // 3. 检查是否可逆
    if (policy.reversibleAutoApprove && approval.details.reversible === true) {
      return { approved: true, reason: '可逆操作' };
    }

    // 4. 默认决策
    return {
      approved: policy.defaultDecision === 'approve',
      reason: '应用默认策略'
    };
  }
}
```

**文件监控代码**：

```typescript
// packages/core/src/orchestrator/session/session-file-manager.watch.ts
class SessionWatcher {
  async watchWorker(workerId: string): Promise<void> {
    const workerDir = this.paths.workerDir(workerId);

    // 使用 Node.js fs.watch 监控目录
    const watcher = watch(workerDir, { persistent: false }, (eventType, filename) => {
      if (filename === 'pending_approval.json') {
        // 检测到审批请求文件变化
        void this.handleApprovalRequest(workerId);
      }
    });

    this.watchers.set(workerId, watcher);
  }

  private async handleApprovalRequest(workerId: string): Promise<void> {
    // 读取审批请求
    const approval = await this.readPendingApproval(workerId);
    if (!approval) return;

    // 触发事件
    this.emit('pending_approval_created', approval, workerId);
  }
}
```

#### 场景 2: 偏离检测与干预（Orchestrator 主动 → Worker 响应）

**问题**：Worker 执行过程中偏离了任务目标，Orchestrator 需要及时干预。

**流程图**：

```
Orchestrator              文件系统                    Worker
  │                          │                            │
  │  1️⃣ 定期检测偏离         │                            │
  │  (读取 thinking.jsonl)   │                            │
  │  ─────读取思考日志───>   │                            │
  │                          │                            │
  │  2️⃣ 分析思考过程         │                            │
  │  - 是否偏离目标？        │                            │
  │  - 是否陷入循环？        │                            │
  │  - 是否效率低下？        │                            │
  │                          │                            │
  │  3️⃣ 检测到偏离！         │                            │
  │  severity: high          │                            │
  │                          │                            │
  │  ─────写入干预指令───>   │                            │
  │  intervention.json       │                            │
  │  {                       │                            │
  │    type: "guidance",     │                            │
  │    reason: "偏离目标",   │                            │
  │    instructions: "..."   │                            │
  │  }                       │                            │
  │                          │                            │
  │                          │  <────Worker轮询检查─────  │
  │                          │  (每轮思考前检查)          │
  │                          │                            │
  │                          │  ────────读取干预──────>   │
  │                          │                            │
  │                          │                     4️⃣ 收到干预
  │                          │                     - 停止当前工作
  │                          │                     - 重新评估方向
  │                          │                     - 调整策略
  │                          │                            │
  │                          │  <────写入确认───────────  │
  │                          │  intervention.json         │
  │                          │  { acknowledged: true }    │
  │                          │                            │
  │  <───────监听到确认──── │                            │
  │                          │                            │
  │  5️⃣ 记录干预成功         │                            │
  │                          │                            │
```

**Orchestrator 端代码（偏离检测）**：

```typescript
// packages/core/src/orchestrator/engines/deviation-detector.ts
class DeviationDetector {
  async detectDeviation(workerId: string): Promise<DeviationResult> {
    // 1️⃣ 读取 Worker 的思考日志
    const thinkingLogs = await this.sessionManager.readThinkingLogs(
      workerId,
      20 // 最近20条
    );

    // 2️⃣ 分析思考模式
    const analysis = this.analyzeThinkingPattern(thinkingLogs);

    // 检测偏离的多种模式
    const deviations: DeviationType[] = [];

    // 模式1: 重复相同的思考
    if (analysis.repeatCount > 3) {
      deviations.push({
        type: 'repetition',
        severity: 'high',
        description: '重复相同的思考模式'
      });
    }

    // 模式2: 思考内容与目标不相关
    if (analysis.relevanceScore < 0.5) {
      deviations.push({
        type: 'off-topic',
        severity: 'high',
        description: '思考内容偏离任务目标'
      });
    }

    // 模式3: 长时间无进展
    if (analysis.progressScore < 0.3) {
      deviations.push({
        type: 'stuck',
        severity: 'medium',
        description: 'Worker似乎卡住了'
      });
    }

    return {
      hasDeviation: deviations.length > 0,
      deviations,
      analysis
    };
  }

  private analyzeThinkingPattern(logs: ThinkingRecord[]): Analysis {
    // 计算重复度
    const contents = logs.map((l) => l.content);
    const repeatCount = this.countRepeats(contents);

    // 计算相关性（与任务目标的相关度）
    const relevanceScore = this.calculateRelevance(logs, this.taskObjective);

    // 计算进展度
    const progressScore = this.calculateProgress(logs);

    return { repeatCount, relevanceScore, progressScore };
  }
}
```

**Orchestrator 发送干预**：

```typescript
// packages/core/src/orchestrator/orchestrator.ts
class Orchestrator {
  private async checkAndIntervene(workerId: string): Promise<void> {
    // 1️⃣ 检测偏离
    const deviation = await this.deviationDetector.detectDeviation(workerId);

    if (!deviation.hasDeviation) return;

    const severity = this.getMaxSeverity(deviation.deviations);

    // 2️⃣ 如果严重度足够高，发送干预
    if (severity === 'high' || severity === 'critical') {
      await this.sessionManager.writeIntervention(workerId, {
        interventionId: generateId(),
        createdAt: Date.now(),
        type: 'guidance',
        reason: '检测到偏离',
        detectedIssue: {
          type: 'deviation',
          description: deviation.deviations[0].description,
          severity
        },
        instructions: this.buildInterventionInstructions(deviation),
        suggestedNextSteps: ['重新阅读任务目标和约束', '检查是否偏离了主要目标', '考虑更直接的解决方案'],
        acknowledged: false
      });

      // 3️⃣ 触发事件
      this.emit('deviation:intervention', {
        workerId,
        severity,
        reason: deviation.deviations[0].description
      });
    }
  }
}
```

**Worker 端代码（响应干预）**：

```typescript
// packages/core/src/worker/backends/generic-agent-backend.ts
class GenericAgentBackend {
  async *execute(task: WorkerTask, tools: Tool[]): AsyncIterable<WorkerMessage> {
    let round = 0;

    while (!done && round < maxThinkingRounds) {
      // 🚨 每轮思考前检查干预指令
      const intervention = await this.checkIntervention();
      if (intervention && !intervention.acknowledged) {
        // 收到干预，立即处理
        yield {
          type: 'status',
          status: 'intervention_received',
          timestamp: Date.now()
        };

        // 将干预指令注入到上下文
        this.context.addSystemMessage({
          role: 'system',
          content: `
🚨 统筹者干预通知：
原因：${intervention.reason}
问题：${intervention.detectedIssue?.description}
指示：${intervention.instructions}

建议的下一步：
${intervention.suggestedNextSteps?.map((s, i) => `${i + 1}. ${s}`).join('\n')}

请立即停止当前方向，重新评估任务目标，调整策略。
          `
        });

        // 确认干预
        intervention.acknowledged = true;
        intervention.acknowledgedAt = Date.now();
        await this.sessionManager.writeIntervention(this.workerId, intervention);

        // 重置某些状态（如果需要）
        // this.resetState();
      }

      // 继续正常的 LLM 循环
      const response = await this.llm.complete({
        messages: this.context.getMessages(),
        tools: this.tools
      });

      // ... 处理响应 ...
      round++;
    }
  }

  private async checkIntervention(): Promise<InterventionFile | null> {
    if (!this.sessionManager) return null;

    try {
      const intervention = await this.sessionManager.readIntervention(this.workerId);
      return intervention;
    } catch {
      return null;
    }
  }
}
```

#### 场景 3: Worker 间协作（Peer Reading）

**问题**：多个 Worker 并行工作时，Worker A 需要了解 Worker B 的进展。

**流程图**：

```
Worker A                  文件系统                    Worker B
  │                          │                            │
  │  1️⃣ 执行任务中           │                     1️⃣ 执行任务中
  │                          │                            │
  │                          │  <────写入状态──────────── │
  │                          │  status.json               │
  │                          │  { status: "acting",       │
  │                          │    progress: 60% }         │
  │                          │                            │
  │                          │  <────写入产出物────────── │
  │                          │  artifacts/api-spec.json   │
  │                          │                            │
  │  2️⃣ 需要B的产出物        │                            │
  │                          │                            │
  │  ─────列出Peer Workers>  │                            │
  │  (读取 workers/ 目录)    │                            │
  │                          │                            │
  │  <─────返回列表─────     │                            │
  │  [worker-001, worker-002]│                            │
  │                          │                            │
  │  ─────读取B的状态───>    │                            │
  │  (readPeerStatus)        │                            │
  │                          │                            │
  │  <─────返回状态─────     │                            │
  │  { status: "acting",     │                            │
  │    progress: 60% }       │                            │
  │                          │                            │
  │  ─────读取B的产出物──>   │                            │
  │  (readPeerArtifact)      │                            │
  │                          │                            │
  │  <─────返回文件内容──    │                            │
  │  { endpoints: [...] }    │                            │
  │                          │                            │
  │  3️⃣ 基于B的产出物继续    │                            │
  │                          │                            │
```

**Worker 端代码（Peer Reading）**：

```typescript
// packages/core/src/worker/worker-executor.ts
class WorkerExecutor {
  async execute(subtask: SubTask, tools: Tool[]) {
    // 检查是否有依赖其他 Worker 的任务
    if (subtask.dependencies?.length > 0) {
      // 1️⃣ 列出所有 Peer Workers
      const peerWorkers = await this.sessionManager.listPeerWorkers();
      console.log('可用的 Peer Workers:', peerWorkers);

      // 2️⃣ 读取依赖 Worker 的状态
      for (const depId of subtask.dependencies) {
        const peerStatus = await this.sessionManager.readPeerStatus(depId, {
          retries: 3,
          backoffDelay: 100
        });

        if (peerStatus) {
          console.log(`Worker ${depId} 状态: ${peerStatus.status}`);
          console.log(`进度: ${peerStatus.progress}%`);
        }

        // 3️⃣ 读取 Peer 的产出物
        const artifacts = await this.sessionManager.listPeerArtifacts(depId);
        console.log(`Worker ${depId} 产出物:`, artifacts);

        for (const artifact of artifacts) {
          const content = await this.sessionManager.readPeerArtifact(depId, artifact);

          // 4️⃣ 将产出物注入到当前任务上下文
          this.context.addKnowledge({
            source: `worker-${depId}`,
            type: 'artifact',
            content
          });
        }
      }
    }

    // 继续执行任务（可以使用 Peer 的产出物）
    // ...
  }
}
```

**SessionFileManager 实现（Peer Reading）**：

```typescript
// packages/core/src/orchestrator/session/session-file-manager.peer.ts
class SessionPeerReader {
  async listPeerWorkers(): Promise<string[]> {
    const workersDir = this.paths.workersDir;
    const entries = await readdir(workersDir);

    // 过滤出所有 worker-* 目录
    return entries.filter((name) => name.startsWith('worker-'));
  }

  async readPeerStatus(workerId: string, options?: PeerReadOptions): Promise<WorkerStatusFile | null> {
    const statusFile = this.paths.workerStatusFile(workerId);

    // 重试机制（处理原子写入的短暂窗口期）
    return await safeReadJsonFileWithRetry(statusFile, options?.retries ?? 2, options?.backoffDelay ?? 50);
  }

  async listPeerArtifacts(workerId: string): Promise<string[]> {
    const artifactsDir = this.paths.workerArtifactsDir(workerId);

    if (!(await fileExists(artifactsDir))) {
      return [];
    }

    return await readdir(artifactsDir);
  }

  async readPeerArtifact(workerId: string, filename: string): Promise<string> {
    const filePath = path.join(this.paths.workerArtifactsDir(workerId), filename);

    return await readFile(filePath, 'utf-8');
  }
}
```

### 文件监控机制详解

#### 监控实现方式

Tachikoma 使用**双重监控机制**：

1. **fs.watch** - 事件驱动（主要方式）
2. **轮询检查** - 定时扫描（补充方式）

```typescript
// packages/core/src/orchestrator/session/session-file-manager.watch.ts
class SessionWatcher {
  async start(): Promise<void> {
    // 1️⃣ 启动 fs.watch 监控
    for (const workerId of this.registeredWorkers) {
      await this.watchWorker(workerId);
    }

    // 2️⃣ 启动轮询检查（作为 fs.watch 的补充）
    this.startPolling();
  }

  // fs.watch 监控
  async watchWorker(workerId: string): Promise<void> {
    const workerDir = this.paths.workerDir(workerId);

    const watcher = watch(workerDir, { persistent: false }, (eventType, filename) => {
      if (filename) {
        void this.handleFileChange(workerId, filename, eventType);
      }
    });

    this.watchers.set(workerId, watcher);
  }

  // 轮询检查（补充）
  private startPolling(): void {
    const interval = this.config.watchPollInterval ?? 1000;

    this.pollTimer = setInterval(() => {
      void this.pollCheck();
    }, interval);
  }

  private async pollCheck(): Promise<void> {
    for (const workerId of this.registeredWorkers) {
      // 检查是否有新的审批请求
      await this.checkPendingApproval(workerId);

      // 检查 Worker 状态
      await this.checkWorkerStatus(workerId);
    }
  }
}
```

#### 为什么需要双重机制？

| 问题             | fs.watch          | 轮询                |
| ---------------- | ----------------- | ------------------- |
| **文件系统延迟** | ⚠️ 可能漏掉事件   | ✅ 定期检查         |
| **网络文件系统** | ❌ 不可靠         | ✅ 可靠             |
| **高频写入**     | ⚠️ 可能合并事件   | ✅ 不会漏           |
| **性能开销**     | ✅ 低（事件驱动） | ⚠️ 中等（定期扫描） |

**最佳实践**：fs.watch 为主，轮询为辅。

---

## 第三层：消息流（实时监控）

### 设计原理

消息流提供**实时的、细粒度的执行过程可观测性**，适用于：

- ✅ 实时监控 Worker 的思考过程
- ✅ 调试工具调用问题
- ✅ 展示进度给用户
- ✅ 记录审计日志

**核心思想**：Worker 执行任务时，通过 AsyncIterable 流式返回消息。

### 消息类型定义

```typescript
// packages/core/src/worker/types.ts
type WorkerMessage =
  | StatusMessage // 状态变化
  | ThinkingMessage // 思考过程
  | ToolCallMessage // 工具调用
  | ToolResultMessage // 工具结果
  | OutputMessage // 最终输出
  | ErrorMessage; // 错误信息

interface StatusMessage {
  type: 'status';
  status: 'initializing' | 'thinking' | 'acting' | 'completed' | 'failed';
  timestamp: number;
}

interface ThinkingMessage {
  type: 'thinking';
  content: string; // LLM 的思考内容
  timestamp: number;
}

interface ToolCallMessage {
  type: 'tool_call';
  tool: string; // 工具名称
  input: unknown; // 工具输入
  callId: string; // 调用 ID
  timestamp: number;
}

interface ToolResultMessage {
  type: 'tool_result';
  tool: string;
  callId: string;
  result: unknown; // 工具输出
  success: boolean; // 是否成功
  duration: number; // 执行时长（毫秒）
  timestamp: number;
}

interface OutputMessage {
  type: 'output';
  content: string; // 最终输出
  timestamp: number;
}

interface ErrorMessage {
  type: 'error';
  error: string;
  code: string;
  retryable: boolean;
  timestamp: number;
}
```

### 消息流处理示例

#### Orchestrator 消费消息流

```typescript
// packages/core/src/orchestrator/runner/execution-loop.ts
class ExecutionLoop {
  private async executeSubtask(subtask: SubTask, workerId: string): Promise<TaskResult> {
    const worker = this.workerPool.getWorker(workerId);
    const tools = await this.getAvailableTools();

    const messages: WorkerMessage[] = [];
    let output = '';
    let error: string | undefined;

    // 消费消息流
    for await (const msg of worker.agent.execute(subtask, tools)) {
      messages.push(msg);

      // 根据消息类型处理
      switch (msg.type) {
        case 'status':
          console.log(`[${workerId}] 状态: ${msg.status}`);

          // 更新 Worker 状态到文件
          await this.sessionManager?.writeWorkerStatus(workerId, {
            workerId,
            status: msg.status,
            currentSubtask: {
              id: subtask.id,
              objective: subtask.objective,
              startedAt: Date.now()
            },
            progress: this.calculateProgress(messages),
            lastHeartbeat: Date.now()
          });
          break;

        case 'thinking':
          console.log(`[${workerId}] 思考: ${msg.content.slice(0, 100)}...`);

          // 写入思考日志
          await this.sessionManager?.appendThinking(workerId, {
            id: generateId(),
            timestamp: msg.timestamp,
            subtaskId: subtask.id,
            content: msg.content,
            stage: 'analysis'
          });
          break;

        case 'tool_call':
          console.log(`[${workerId}] 调用工具: ${msg.tool}`);

          // 写入行动日志
          await this.sessionManager?.appendAction(workerId, {
            id: msg.callId,
            timestamp: msg.timestamp,
            subtaskId: subtask.id,
            type: 'tool_call',
            description: `调用 ${msg.tool}`,
            params: msg.input
          });
          break;

        case 'tool_result':
          console.log(`[${workerId}] 工具结果: ${msg.success ? '成功' : '失败'}`);

          // 更新行动日志（添加结果）
          await this.sessionManager?.updateActionResult(workerId, msg.callId, {
            success: msg.success,
            output: msg.result,
            duration: msg.duration
          });
          break;

        case 'output':
          output = msg.content;
          console.log(`[${workerId}] 完成: ${output.slice(0, 100)}...`);
          break;

        case 'error':
          error = msg.error;
          console.error(`[${workerId}] 错误: ${error}`);
          break;
      }

      // 触发事件（供外部监听）
      this.emit(`worker:${msg.type}`, {
        workerId,
        subtaskId: subtask.id,
        message: msg
      });
    }

    return {
      success: !error,
      output: output || error || '',
      messages
    };
  }
}
```

#### Worker 生成消息流

```typescript
// packages/core/src/worker/backends/generic-agent-backend.ts
class GenericAgentBackend {
  async *execute(task: WorkerTask, tools: Tool[]): AsyncIterable<WorkerMessage> {
    // 发送初始化状态
    yield {
      type: 'status',
      status: 'initializing',
      timestamp: Date.now()
    };

    // 构建上下文
    const context = new ContextManager();
    context.addSystemMessage(this.buildSystemPrompt());
    context.addUserMessage(this.buildTaskPrompt(task));

    let done = false;
    let round = 0;

    // 发送思考状态
    yield {
      type: 'status',
      status: 'thinking',
      timestamp: Date.now()
    };

    while (!done && round < this.maxThinkingRounds) {
      // 调用 LLM
      const response = await this.llm.complete({
        messages: context.getMessages(),
        tools: this.convertTools(tools)
      });

      // 发送思考消息
      if (response.content) {
        yield {
          type: 'thinking',
          content: response.content,
          timestamp: Date.now()
        };
      }

      // 处理工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        // 发送行动状态
        yield {
          type: 'status',
          status: 'acting',
          timestamp: Date.now()
        };

        for (const toolCall of response.toolCalls) {
          // 发送工具调用消息
          yield {
            type: 'tool_call',
            tool: toolCall.name,
            input: toolCall.arguments,
            callId: toolCall.id,
            timestamp: Date.now()
          };

          // 执行工具
          const startTime = Date.now();
          const result = await this.executeTool(toolCall.name, toolCall.arguments);
          const duration = Date.now() - startTime;

          // 发送工具结果消息
          yield {
            type: 'tool_result',
            tool: toolCall.name,
            callId: toolCall.id,
            result: result.output,
            success: result.success,
            duration,
            timestamp: Date.now()
          };

          // 将结果加入上下文
          context.addToolResult(toolCall.id, result.output);
        }

        // 回到思考状态
        yield {
          type: 'status',
          status: 'thinking',
          timestamp: Date.now()
        };
      } else {
        // 没有工具调用，任务完成
        done = true;
      }

      round++;
    }

    // 发送完成状态
    yield {
      type: 'status',
      status: 'completed',
      timestamp: Date.now()
    };

    // 发送最终输出
    yield {
      type: 'output',
      content: this.extractFinalOutput(context),
      timestamp: Date.now()
    };
  }
}
```

### 消息流的优势

| 优势       | 说明                    |
| ---------- | ----------------------- |
| **实时性** | 毫秒级延迟，立即可见    |
| **细粒度** | 每个思考/工具调用都可见 |
| **无侵入** | 不影响执行流程          |
| **易调试** | 可以在任意点观察状态    |
| **可扩展** | 容易添加新的消息类型    |

---

## 完整交互流程示例

### 场景：实现一个 TODO 应用

让我们通过一个完整的例子，展示三层架构如何协同工作。

#### 步骤 1: 用户提交任务

```typescript
const orchestrator = new Orchestrator('orch-001', {
  config: {
    planner: { maxSubtasks: 5 },
    workerPool: { maxWorkers: 3 },
    session: {
      rootDir: '.tachikoma',
      enableWatch: true
    }
  }
});

const task: Task = {
  id: 'task-001',
  type: 'development',
  objective: '创建一个 React + Flask 的 TODO 应用',
  constraints: ['使用 React 18 + TypeScript', '使用 Flask + SQLAlchemy', '实现 CRUD 功能']
};

const result = await orchestrator.run(task);
```

#### 步骤 2: Planner 分解任务

```
规划结果：
├─ subtask-1: 搭建 Flask 后端 API
│  ├─ roleId: backend-developer
│  ├─ dependencies: []
│  └─ estimatedMinutes: 30
│
├─ subtask-2: 创建 React 前端界面
│  ├─ roleId: frontend-developer
│  ├─ dependencies: []
│  └─ estimatedMinutes: 45
│
└─ subtask-3: 集成前后端并测试
   ├─ roleId: fullstack-developer
   ├─ dependencies: [subtask-1, subtask-2]
   └─ estimatedMinutes: 20

执行计划：
Phase 1: 并行执行 subtask-1 和 subtask-2
Phase 2: 顺序执行 subtask-3
```

#### 步骤 3: Orchestrator 分配任务（Layer 1: 内存通信）

```typescript
// Orchestrator 内部
for (const phase of executionPlan.phases) {
  if (phase.parallel) {
    // 并行分配
    const promises = phase.subtaskIds.map(async (subtaskId) => {
      const subtask = subtasks.find((s) => s.id === subtaskId);

      // 1️⃣ 找到或创建 Worker（内存操作）
      const workerId = await workerManager.findOrCreateWorkerForRole(subtask.roleId);

      // 2️⃣ 直接调用 Worker（内存调用）
      return await this.executeSubtask(subtask, workerId);
    });

    await Promise.all(promises);
  }
}
```

**文件系统变化**：

```
.tachikoma/sessions/session-001/
├── orchestrator/
│   ├── runtime.json  (创建)
│   │   {
│   │     "kind": "tachikoma",
│   │     "taskId": "task-001",
│   │     "plannerOutput": { ... }
│   │   }
│   └── progress.json  (创建)
│       {
│         "status": "executing",
│         "currentStep": 1,
│         "totalSteps": 2
│       }
│
└── workers/
    ├── worker-backend-developer/  (创建)
    │   └── status.json
    │       { "status": "idle", ... }
    │
    └── worker-frontend-developer/  (创建)
        └── status.json
            { "status": "idle", ... }
```

#### 步骤 4: Worker 执行任务（Layer 3: 消息流）

**Worker-backend-developer 执行 subtask-1**：

```typescript
// Worker 执行流程（简化）
for await (const msg of worker.execute(subtask1, tools)) {
  console.log(msg);
}

// 输出的消息流：
{
  type: 'status',
  status: 'initializing',
  timestamp: 1700000000000
}

{
  type: 'thinking',
  content: '我需要创建一个 Flask 应用，包含 TODO 模型和 CRUD API...',
  timestamp: 1700000001000
}

{
  type: 'tool_call',
  tool: 'file_write',
  input: {
    path: 'backend/app.py',
    content: 'from flask import Flask...'
  },
  callId: 'call-001',
  timestamp: 1700000002000
}

{
  type: 'tool_result',
  tool: 'file_write',
  callId: 'call-001',
  result: { success: true },
  success: true,
  duration: 15,
  timestamp: 1700000002015
}

// ... 更多工具调用 ...

{
  type: 'output',
  content: '已完成 Flask 后端 API，包含 CRUD 端点',
  timestamp: 1700000030000
}
```

**文件系统变化**：

```
.tachikoma/sessions/session-001/workers/worker-backend-developer/
├── status.json  (更新)
│   {
│     "status": "acting",
│     "progress": 60,
│     "lastHeartbeat": 1700000015000
│   }
│
├── thinking.jsonl  (追加)
│   {"id":"t-001","content":"我需要创建Flask应用...","stage":"planning"}
│   {"id":"t-002","content":"首先创建app.py文件...","stage":"decision"}
│
├── actions.jsonl  (追加)
│   {"id":"call-001","type":"tool_call","description":"写入app.py","params":{...}}
│   {"id":"call-002","type":"tool_call","description":"写入models.py","params":{...}}
│
└── artifacts/  (创建产出物)
    ├── app.py
    ├── models.py
    └── requirements.txt
```

#### 步骤 5: 审批流程（Layer 2: 文件协调）

假设 Worker-backend-developer 需要安装依赖：

```typescript
// Worker 检测到需要执行 pip install
const toolCall = {
  name: 'shell_run',
  arguments: {
    command: 'pip install flask sqlalchemy',
  },
};

// 判断是否需要审批
if (isHighRiskCommand(toolCall.arguments.command)) {
  // 写入审批请求
  await sessionManager.writePendingApproval(workerId, {
    requestId: 'approval-001',
    type: 'external_api_call',
    description: '安装 Python 依赖包',
    details: {
      affectedFiles: ['venv/'],
      impactScope: 'medium',
      reversible: true,
    },
    timeout: 30000,
    defaultDecision: 'approve',
  });

  // 更新状态为等待审批
  await sessionManager.writeWorkerStatus(workerId, {
    status: 'waiting_approval',
    ...
  });
}
```

**文件系统变化**：

```
workers/worker-backend-developer/
├── status.json  (更新)
│   {
│     "status": "waiting_approval",  ← 状态变化
│     ...
│   }
│
└── pending_approval.json  (创建)
    {
      "requestId": "approval-001",
      "type": "external_api_call",
      "description": "安装 Python 依赖包",
      "timeout": 30000
    }
```

**Orchestrator 监听到文件变化**：

```typescript
// SessionWatcher 触发事件
sessionManager.on('pending_approval_created', async (event) => {
  const approval = event.data;

  // ApprovalArbitrationService 处理
  const decision = await approvalService.evaluate(approval);

  // 写入审批响应
  await sessionManager.writeApprovalResponse(workerId, {
    requestId: approval.requestId,
    approved: true,
    reason: '可逆操作，自动批准'
  });
});
```

**文件系统变化**：

```
workers/worker-backend-developer/
├── pending_approval.json  (删除)
└── approval_response.json  (创建)
    {
      "requestId": "approval-001",
      "approved": true,
      "reason": "可逆操作，自动批准"
    }
```

**Worker 读取审批响应，继续执行**：

```typescript
// Worker 轮询检测到响应
const response = await waitForApproval(workerId, 30000);

if (response.approved) {
  // 执行 pip install
  await executeTool(toolCall);
}
```

#### 步骤 6: 偏离检测与干预（Layer 2: 文件协调）

假设 Worker-frontend-developer 开始偏离目标：

```typescript
// Orchestrator 定期检测偏离
const deviation = await deviationDetector.detectDeviation('worker-frontend-developer');

if (deviation.hasDeviation && deviation.severity === 'high') {
  // 写入干预指令
  await sessionManager.writeIntervention('worker-frontend-developer', {
    type: 'guidance',
    reason: '检测到偏离',
    detectedIssue: {
      type: 'off-topic',
      description: 'Worker 正在实现不必要的动画效果',
      severity: 'high'
    },
    instructions: '请专注于核心 CRUD 功能，暂时忽略动画',
    acknowledged: false
  });
}
```

**文件系统变化**：

```
workers/worker-frontend-developer/
├── intervention.json  (创建)
│   {
│     "type": "guidance",
│     "reason": "检测到偏离",
│     "instructions": "请专注于核心CRUD功能...",
│     "acknowledged": false
│   }
│
└── thinking.jsonl  (最近的思考记录)
    {"content":"我应该添加一些漂亮的动画..."}  ← 偏离信号
    {"content":"使用 framer-motion 实现..."}   ← 偏离信号
```

**Worker 收到干预并调整**：

```typescript
// Worker 在下一轮思考前检查干预
const intervention = await sessionManager.readIntervention(workerId);

if (intervention && !intervention.acknowledged) {
  // 将干预注入到上下文
  context.addSystemMessage(`
    🚨 统筹者干预：${intervention.instructions}
  `);

  // 确认干预
  intervention.acknowledged = true;
  await sessionManager.writeIntervention(workerId, intervention);
}
```

#### 步骤 7: Worker 间协作（Layer 2: 文件协调）

subtask-3 依赖 subtask-1 和 subtask-2，需要读取它们的产出物：

```typescript
// Worker-fullstack-developer 执行 subtask-3
const subtask3 = {
  id: 'subtask-3',
  objective: '集成前后端并测试',
  dependencies: ['subtask-1', 'subtask-2']
};

// 1️⃣ 列出 Peer Workers
const peerWorkers = await sessionManager.listPeerWorkers();
// 返回: ['worker-backend-developer', 'worker-frontend-developer']

// 2️⃣ 读取后端 Worker 的产出物
const backendArtifacts = await sessionManager.listPeerArtifacts('worker-backend-developer');
// 返回: ['app.py', 'models.py', 'requirements.txt']

const appPy = await sessionManager.readPeerArtifact('worker-backend-developer', 'app.py');

// 3️⃣ 读取前端 Worker 的产出物
const frontendArtifacts = await sessionManager.listPeerArtifacts('worker-frontend-developer');
// 返回: ['App.tsx', 'TodoList.tsx', 'package.json']

// 4️⃣ 基于这些产出物进行集成
// Worker 现在知道后端有哪些 API，前端有哪些组件
```

#### 步骤 8: 聚合结果（Layer 1: 内存通信）

```typescript
// Orchestrator 收集所有结果
const results = {
  'subtask-1': {
    success: true,
    output: '已完成 Flask 后端 API'
  },
  'subtask-2': {
    success: true,
    output: '已完成 React 前端界面'
  },
  'subtask-3': {
    success: true,
    output: '已集成前后端，测试通过'
  }
};

// 聚合策略：合并所有输出
const finalResult = aggregationEngine.aggregate(results, {
  strategy: 'merge'
});

return {
  success: true,
  output: `
任务完成！已创建 TODO 应用：
- 后端：Flask + SQLAlchemy，提供 CRUD API
- 前端：React + TypeScript，实现用户界面
- 集成：前后端已连接，功能正常
  `
};
```

**最终文件系统状态**：

```
.tachikoma/sessions/session-001/
├── orchestrator/
│   ├── runtime.json
│   ├── progress.json
│   │   { "status": "completed", "currentStep": 2, "totalSteps": 2 }
│   ├── decisions.jsonl
│   │   {"type":"approval","workerId":"worker-backend-developer",...}
│   │   {"type":"intervention","workerId":"worker-frontend-developer",...}
│   └── checkpoints/
│       └── checkpoint-final.json
│
├── workers/
│   ├── worker-backend-developer/
│   │   ├── status.json  { "status": "idle", "progress": 100 }
│   │   ├── thinking.jsonl  (20+ 条记录)
│   │   ├── actions.jsonl  (15+ 条记录)
│   │   └── artifacts/
│   │       ├── app.py
│   │       ├── models.py
│   │       └── requirements.txt
│   │
│   ├── worker-frontend-developer/
│   │   ├── status.json  { "status": "idle", "progress": 100 }
│   │   ├── thinking.jsonl  (25+ 条记录)
│   │   ├── actions.jsonl  (18+ 条记录)
│   │   └── artifacts/
│   │       ├── App.tsx
│   │       ├── TodoList.tsx
│   │       └── package.json
│   │
│   └── worker-fullstack-developer/
│       ├── status.json  { "status": "idle", "progress": 100 }
│       └── artifacts/
│           └── integration-test-report.md
│
└── shared/
    ├── context.json
    │   { "objective": "创建TODO应用", ... }
    └── messages.jsonl
        (跨 Worker 通信记录)
```

---

## 任务传递与上下文工程

### 核心问题

**Planner 和 Worker 是两个独立的大模型，它们如何传递上下文？**

```
┌──────────────┐         ┌──────────────┐
│ Planner 大模型 │  ???   │ Worker 大模型 │
│  (规划任务)   │ ────→  │  (执行任务)   │
└──────────────┘         └──────────────┘
```

### 三层上下文传递机制

#### 层次 1: Planner 的输入上下文

**代码位置**: `packages/core/src/planner/planner.ts` (第527-577行)

```typescript
async plan(input: PlannerInput): Promise<PlanResult> {
  // 1️⃣ 构建 Planner 的上下文
  const additionalContext = await this.buildAdditionalContext(task, preferences);

  const userPrompt = generatePlanningUserPrompt({
    objective: task.objective,        // ← 任务目标
    constraints: task.constraints,    // ← 约束条件
    availableTools,                   // ← 可用工具列表
    maxSubtasks,
    additionalContext,                // ← 额外上下文（记忆等）
  });

  // 2️⃣ 调用 Planner 专用的大模型
  const request: LLMRequest = {
    systemPrompt: PLANNING_SYSTEM_PROMPT,  // ← Planner 专用角色定义
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: this.config.agent.maxTokens,
    temperature: this.config.agent.temperature,
  };

  const response = await this.llmClient.complete(request);  // ← 调用大模型

  // 3️⃣ 解析生成的计划
  return { subtasks, executionPlan, roles, roleAssignments };
}
```

**Planner 的上下文来源**:

```
┌─────────────────────────────────────┐
│ Planner 输入                        │
├─────────────────────────────────────┤
│ 1. task.objective（用户需求）       │
│ 2. task.constraints（全局约束）     │
│ 3. availableTools（工具列表）       │
│ 4. additionalContext（记忆、历史）  │
│ 5. PLANNING_SYSTEM_PROMPT（角色）   │
└───────────────┬─────────────────────┘
                ↓
          调用 Planner 大模型
                ↓
┌─────────────────────────────────────┐
│ Planner 输出                        │
├─────────────────────────────────────┤
│ 1. subtasks[]（子任务列表）         │
│ 2. executionPlan（执行顺序）        │
│ 3. roles[]（角色定义）              │
│ 4. roleAssignments（任务-角色映射） │
└─────────────────────────────────────┘
```

#### 层次 2: 共享文件系统（中转站）

Orchestrator 将 Planner 的输出写入文件系统：

```
.tachikoma/sessions/{sessionId}/
├─ orchestrator/
│  ├─ runtime.json     ← Planner 输出的计划
│  │   {
│  │     "executionPlan": [...],
│  │     "roles": [...],
│  │     "roleAssignments": {...}
│  │   }
│  │
│  └─ progress.json    ← 执行进度
│
└─ shared/
   ├─ context.json     ← 共享上下文
   └─ messages.jsonl   ← 跨角色通信
```

#### 层次 3: Worker 的输入上下文

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第579-600行)

```typescript
// Orchestrator 为每个 Worker 构建任务
const workerTask: Task = {
  id: activeSubtask.id,
  type: 'atomic',
  objective: activeSubtask.objective,        // ← 从 Planner 的 subtask
  parentObjective: activeSubtask.parentObjective,  // ← 父任务目标
  constraints: [
    ...activeSubtask.constraints,           // ← Planner 分配的约束
    ...roleConstraints                      // ← 根据角色派生的约束
  ],
  context: {
    parentTaskId: taskId,
    sessionId: this.state.sessionId,
    metadata: { workDir, ... }
  },
};

// 调用 Worker 执行
result = await agent.run(workerTask);  // ← Worker 接收任务
```

**代码位置**: `packages/core/src/worker/backends/generic-agent-backend.ts` (第450-509行)

```typescript
async *execute(task: WorkerTask, options) {

  // 1️⃣ 注入项目上下文（TACHIKOMA.md等）
  const projectMessage = await this.skillsManager.injectProjectContext([], workDir);
  context.addMessage(projectMessage);

  // 2️⃣ 构建任务 Prompt（包含子任务目标和约束）
  const taskPrompt = buildTaskPrompt(task, tools, { useNativeToolCalls });
  context.addMessage(createUserMessage(taskPrompt));

  // 3️⃣ 注入 Identity（Agent 身份）
  const identityContext = await updater.getCoreMemoryForPrompt(agentId);

  // 4️⃣ 构建 System Prompt（使用 parentObjective 激活技能）
  const systemPromptWithSkills = await this.skillsManager.renderSystemPromptSection(
    baseSystemPrompt,
    task.objective,        // ← 子任务目标
    {
      autoActivate: true,
      parentObjective: task.parentObjective  // ← 父任务目标！
    }
  );

  // 5️⃣ 注入失败记忆
  let effectiveSystemPrompt = systemPromptWithSkills;
  if (this.failureMemory) {
    const failureWarnings = this.failureMemory.generateWarnings();
    effectiveSystemPrompt = `${systemPromptWithSkills}\n\n${failureWarnings}`;
  }

  // 6️⃣ 调用 Worker 的大模型
  const response = await this.llmClient.complete({
    systemPrompt: effectiveSystemPrompt,
    messages: contextToLLMMessages(context.getContext()),
    tools: nativeToolSet
  });
}
```

### 完整的上下文流转图

```
┌────────────────────────────────────────────────────────┐
│ 用户输入: "实现用户登录功能"                           │
└──────────────────┬─────────────────────────────────────┘
                   ↓
┌───────────────────────────────────────────────────────┐
│ 【Planner 大模型】                                    │
├───────────────────────────────────────────────────────┤
│ 输入上下文:                                           │
│ ┌───────────────────────────────────────────────────┐ │
│ │ System: "你是任务规划专家..."                     │ │
│ │ User: "目标: 实现用户登录功能                     │ │
│ │       约束: 使用JWT、bcrypt加密                   │ │
│ │       工具: bash, edit_file, read_file...        │ │
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│ 输出:                                                 │
│ {                                                     │
│   "subtasks": [                                       │
│     {                                                 │
│       id: "1.1",                                      │
│       objective: "设计登录API接口",                  │
│       parentObjective: "实现用户登录功能"            │
│     },                                                │
│     {                                                 │
│       id: "1.2",                                      │
│       objective: "实现JWT token生成",                │
│       parentObjective: "实现用户登录功能"            │
│     }                                                 │
│   ],                                                  │
│   "roles": [                                          │
│     { id: "backend-dev", capabilities: [...] }       │
│   ]                                                   │
│ }                                                     │
└───────────────────┬───────────────────────────────────┘
                    ↓
         【写入共享文件系统】
         runtime.json, shared/context.json
                    ↓
┌───────────────────────────────────────────────────────┐
│ 【Worker 大模型】（执行 subtask 1.2）                │
├───────────────────────────────────────────────────────┤
│ 输入上下文:                                           │
│                                                       │
│ System Prompt（第一部分 - 隐式上下文）:              │
│ ┌───────────────────────────────────────────────────┐ │
│ │ 你是 backend-dev 角色，负责后端开发。             │ │
│ │                                                   │ │
│ │ 【Agent Identity】                                │ │
│ │ Agent ID: agent-001                               │ │
│ │ Name: Tachikoma Backend Developer                │ │
│ │                                                   │ │
│ │ 【Project Context】                               │ │
│ │ [TACHIKOMA.md 内容...]                            │ │
│ │                                                   │ │
│ │ 【Activated Skills】                              │ │
│ │ 基于上下文: "实现用户登录功能 | 实现JWT token生成" │ │
│ │            ^^^^^^^^^^^^^^^^     ^^^^^^^^^^^       │ │
│ │            parentObjective      objective         │ │
│ │                                                   │ │
│ │ 激活的技能:                                       │ │
│ │ ├─ jwt_token_generation                           │ │
│ │ │  (匹配 "JWT token生成")                        │ │
│ │ ├─ bcrypt_password_hashing                        │ │
│ │ │  (匹配 "登录功能" - 来自 parentObjective!)     │ │
│ │ └─ express_auth_middleware                        │ │
│ │    (匹配 "登录功能" - 来自 parentObjective!)     │ │
│ │                                                   │ │
│ │ 【Failure Memory】                                │ │
│ │ 上次在类似任务中忘记设置token过期时间，请注意!    │ │
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│ User Prompt（第二部分 - 明确任务）:                  │
│ ┌───────────────────────────────────────────────────┐ │
│ │ Task: 实现JWT token生成                           │ │
│ │                                                   │ │
│ │ Constraints:                                      │ │
│ │ - 使用jsonwebtoken库                              │ │
│ │ - token有效期设置为24小时                         │ │
│ │ - 只能修改 backend/ 目录                          │ │
│ │                                                   │ │
│ │ Available tools:                                  │ │
│ │ - bash: 执行shell命令                             │ │
│ │ - edit_file: 编辑文件                             │ │
│ │ - read_file: 读取文件                             │ │
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│ 执行循环 (Agent Loop):                                │
│ Round 1: 思考 → read_file(backend/utils/) → 结果     │
│ Round 2: 思考 → edit_file(jwt-utils.js) → 结果       │
│ Round 3: 思考 → bash(npm test) → 结果                │
│ Round 4: 思考 → 完成                                  │
│                                                       │
│ 输出:                                                 │
│ {                                                     │
│   status: "success",                                  │
│   output: "已实现JWT token生成功能",                │
│   artifacts: ["backend/utils/jwt-utils.js"]          │
│ }                                                     │
└───────────────────────────────────────────────────────┘
```

### 关键设计点

#### 1. 上下文分层策略

**User Prompt（明确任务）**：

- 只包含子任务目标 (`objective`)
- 只包含约束条件 (`constraints`)
- 只包含工具列表 (`tools`)
- **不包含** `parentObjective`

**代码**: `packages/core/src/worker/prompts/task-prompt.ts` (第78-92行)

```typescript
export function buildTaskPrompt(task: WorkerTask, tools: Tool[], options?) {
  return `Task: ${task.objective}  // ← 只用 objective！

Constraints:
${task.constraints.map((c) => `- ${c}`).join('\n')}

Available tools:
${formatToolDescriptions(tools)}

Please accomplish this task step by step.`;
}
```

**System Prompt（隐式上下文）**：

- 包含身份 (Identity)
- 包含项目上下文 (TACHIKOMA.md)
- 包含激活的技能（基于 `parentObjective + objective`）
- 包含失败记忆 (Failure Memory)

**代码**: `packages/core/src/worker/backends/generic-agent-backend.ts` (第505-509行)

```typescript
const systemPromptWithSkills = await this.skillsManager.renderSystemPromptSection(
  baseSystemPrompt,
  task.objective, // ← 子任务目标
  {
    autoActivate: true,
    parentObjective: task.parentObjective // ← 父任务目标！
  }
);
```

#### 2. parentObjective 的妙用

**代码**: `packages/core/src/worker/engines/skills-manager.ts` (第191-213行)

```typescript
// 合并上下文用于技能匹配（父任务目标 + 子任务描述）
const matchContext = [
  options?.parentObjective, // ← "实现用户登录功能"
  taskDescription // ← "实现JWT token生成"
]
  .filter((s) => typeof s === 'string' && s.length > 0)
  .join(' | ');
// 结果: "实现用户登录功能 | 实现JWT token生成"

// 使用合并后的上下文激活技能
const { section, activated } = renderSkillsSectionWithActivation(
  this.skills,
  matchContext, // ← 用合并的上下文匹配技能！
  renderOptions
);
```

**效果对比**：

```
【没有 parentObjective】
matchContext = "实现JWT token生成"
激活技能:
└─ jwt_token_generation (匹配 "JWT")

丢失了:
✗ bcrypt_password_hashing (需要匹配 "登录")
✗ express_auth_middleware (需要匹配 "登录")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【有 parentObjective】
matchContext = "实现用户登录功能 | 实现JWT token生成"
激活技能:
├─ jwt_token_generation (匹配 "JWT token")
├─ bcrypt_password_hashing (匹配 "登录功能") ✓
└─ express_auth_middleware (匹配 "登录功能") ✓

保留了父任务的领域关键词！
```

### 完整示例：子任务到提示词

#### 输入：Planner 生成的子任务

```json
{
  "id": "1.2",
  "parentId": "1",
  "objective": "实现JWT token生成功能",
  "parentObjective": "实现用户登录系统",
  "constraints": ["使用jsonwebtoken库", "token有效期设置为24小时", "只能修改 backend/ 目录"],
  "roleId": "backend-dev"
}
```

#### 转换：构建 WorkerTask

**代码**: `packages/core/src/worker/worker-executor.ts` (第191-202行)

```typescript
const workerTask: WorkerTask = {
  id: '1.2',
  type: 'atomic',
  objective: '实现JWT token生成功能', // ← 子任务目标
  parentObjective: '实现用户登录系统', // ← 父任务目标
  constraints: ['使用jsonwebtoken库', 'token有效期设置为24小时', '只能修改 backend/ 目录'],
  parentTaskId: '1'
};
```

#### 输出1：User Prompt（发送给 Worker LLM）

```
Task: 实现JWT token生成功能

Constraints:
- 使用jsonwebtoken库
- token有效期设置为24小时
- 只能修改 backend/ 目录下的文件

Hard rules:
- Constraints are hard requirements; do not change language/framework/stack unless explicitly allowed.
- If constraints conflict or block progress, stop and ask for clarification.

Available tools:
- bash: 执行shell命令
  Input schema: {"command": "string"}

- edit_file: 编辑文件
  Input schema: {"path": "string", "content": "string"}

- read_file: 读取文件内容
  Input schema: {"path": "string"}

Please accomplish this task step by step. Use the available tools when needed.

When the task is complete, provide a final summary of what was accomplished.
```

**注意**：`parentObjective` **不在这里**！保持 User Prompt 简洁清晰。

#### 输出2：System Prompt（发送给 Worker LLM）

```
You are a backend-dev role agent, specialized in backend development tasks.

【Agent Identity】
Agent ID: agent-001
Name: Tachikoma Backend Developer
Persona: Expert in Node.js, Express, authentication systems, and JWT

【Project Context】
Project: User Management System
Tech Stack: Node.js, Express, MongoDB, JWT
File Structure:
  backend/
    ├── routes/
    ├── middleware/
    └── utils/

【Activated Skills】
Based on context: "实现用户登录系统 | 实现JWT token生成功能"
                  ^^^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^^^^^^^^
                  parentObjective      objective

The following skills have been activated for you:

1. jwt_token_generation
   - Matched keywords: "JWT", "token生成"
   - Usage: Generate and verify JWT tokens
   - Example code: [...]

2. bcrypt_password_hashing
   - Matched keywords: "登录系统", "用户"  ← 来自 parentObjective!
   - Usage: Hash and verify passwords securely
   - Example code: [...]

3. express_auth_middleware
   - Matched keywords: "登录系统"  ← 来自 parentObjective!
   - Usage: Create authentication middleware
   - Example code: [...]

【Failure Memory】
In previous similar tasks:
- Remember to set token expiration time
- Don't forget to handle token refresh logic
```

**注意**：`parentObjective` **在这里**！用于激活相关技能。

### 设计哲学

```
【为什么不直接把 parentObjective 放在 User Prompt？】

原因1: 保持任务描述简洁清晰
  ✓ User Prompt: "Task: 实现JWT token生成"（清晰）
  ✗ "父任务: 登录系统, 子任务: JWT生成"（混乱）

原因2: 避免 LLM 混淆当前目标
  ✓ 当前任务是什么？→ JWT token生成
  ✗ 当前任务是什么？→ 登录系统还是JWT生成？

原因3: 通过技能系统传递上下文更优雅
  ✓ 父任务影响 → 激活相关技能 → 提供正确工具和知识
  ✗ 父任务直接写入 → LLM 需要自己理解关联关系

原因4: 符合人类沟通习惯
  人类协作时：
  - 明确告诉你"做什么"（User Prompt）
  - 隐式提供"背景知识"（System Prompt）
```

### 两个大模型的上下文差异

```
┌───────────────────────────────────────────────────────┐
│ Planner 大模型（规划专家）                            │
├───────────────────────────────────────────────────────┤
│ 角色定位: "任务规划专家，负责分解复杂任务"           │
│                                                       │
│ 输入:                                                 │
│ ├─ 用户总目标（高层次、抽象）                         │
│ ├─ 全局约束                                           │
│ ├─ 可用工具列表                                       │
│ └─ 历史对话（Session messages）                      │
│                                                       │
│ 输出:                                                 │
│ └─ subtasks + executionPlan + roles + roleAssignments │
│                                                       │
│ 不关心:                                               │
│ └─ 具体实现细节、代码编写、工具执行                   │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ Worker 大模型（执行专家）                             │
├───────────────────────────────────────────────────────┤
│ 角色定位: "{roleId} 角色，负责执行具体任务"          │
│                                                       │
│ 输入:                                                 │
│ ├─ 单个子任务目标（具体、可执行）                     │
│ ├─ 子任务约束 + 角色约束                              │
│ ├─ 父任务目标（通过技能激活传递）                     │
│ ├─ 项目上下文（TACHIKOMA.md）                         │
│ ├─ Agent 身份（Identity）                             │
│ ├─ 激活的技能（Skills）                               │
│ ├─ 失败记忆（Failure Memory）                         │
│ └─ 工具集合                                           │
│                                                       │
│ 输出:                                                 │
│ └─ 执行结果 + 修改的文件 + 工具调用轨迹              │
│                                                       │
│ 不关心:                                               │
│ └─ 整体规划、任务分配、其他 Worker 的工作            │
└───────────────────────────────────────────────────────┘
```

### 职责划分总结

```
Planner（规划）:
├─ 输入: 用户需求（高层次）
├─ 处理: 分解任务、定义角色、规划顺序
└─ 输出: subtasks[]

共享文件系统（中转）:
├─ 存储: runtime.json, shared/context.json
└─ 作用: 解耦 Planner 和 Worker

Worker（执行）:
├─ 输入: 单个 subtask（低层次）+ 丰富的上下文
├─ 处理: Agent Loop（思考→工具→结果→再思考）
└─ 输出: 执行结果

Orchestrator（协调）:
├─ 调用: Planner 生成计划
├─ 分配: 任务分配给 Worker
├─ 监控: 接收结果并评估
└─ 决策: 修复、重试或重新规划
```

---

## 任务层次结构详解

### SubTask 数据结构

**代码位置**: `packages/core/src/orchestrator/types.ts` (第44-86行)

```typescript
export interface SubTask {
  id: string; // 子任务ID，如 "1.2"
  parentId: string; // 父任务ID，如 "1"
  objective: string; // 子任务目标
  parentObjective?: string; // 父任务目标（用于上下文传递）
  constraints: string[]; // 约束条件
  roleId?: string; // 期望的执行角色
  requiredCapabilities?: string[]; // 需要的能力标签
  dependencies?: string[]; // 依赖的其他子任务ID
  status: SubTaskStatus; // 执行状态
  assignedWorkerId?: string; // 分配给的 Worker ID
  result?: TaskResult; // 执行结果
}
```

### 层次结构示例

```
【场景】实现一个完整的用户认证系统

┌───────────────────────────────────────────────────────┐
│ 任务 1: "实现用户认证系统"                            │
│ id: "1"                                                │
│ parentId: undefined                                    │
├───────────────────────────────────────────────────────┤
│                                                       │
│ ├─ 子任务 1.1: "设计认证API接口"                     │
│ │  id: "1.1"                                          │
│ │  parentId: "1"                                      │
│ │  parentObjective: "实现用户认证系统"                │
│ │  roleId: "backend-dev"                              │
│ │  dependencies: []                                   │
│ │                                                     │
│ ├─ 子任务 1.2: "实现JWT token生成"                   │
│ │  id: "1.2"                                          │
│ │  parentId: "1"                                      │
│ │  parentObjective: "实现用户认证系统"                │
│ │  roleId: "backend-dev"                              │
│ │  dependencies: ["1.1"]  ← 依赖 1.1                 │
│ │                                                     │
│ ├─ 子任务 1.3: "实现密码加密存储"                    │
│ │  id: "1.3"                                          │
│ │  parentId: "1"                                      │
│ │  parentObjective: "实现用户认证系统"                │
│ │  roleId: "backend-dev"                              │
│ │  dependencies: []                                   │
│ │                                                     │
│ └─ 子任务 1.4: "编写登录路由"                        │
│    id: "1.4"                                          │
│    parentId: "1"                                      │
│    parentObjective: "实现用户认证系统"                │
│    roleId: "backend-dev"                              │
│    dependencies: ["1.1", "1.2", "1.3"]  ← 依赖前三个 │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 层次信息的传递路径

```
Planner 生成 subtask
    ↓ (包含 parentId, parentObjective)
ExecutionLoop 构建 workerTask
    ↓ (继承 parentObjective)
WorkerExecutor 转换为 WorkerTask
    ↓ (保留 parentObjective)
GenericAgentBackend 构建上下文
    ↓
Skills 激活 (使用 parentObjective + objective)
    ↓
System Prompt (包含激活的技能)
    ↓
调用 Worker 的 LLM
```

### 为什么需要层次结构？

```
1️⃣ 保持上下文连贯性
   子任务需要理解"为什么做这件事"（父任务目标）

2️⃣ 激活相关技能
   父任务的领域关键词帮助激活更多相关技能

3️⃣ 依赖管理
   通过 dependencies[] 确保执行顺序正确

4️⃣ 角色分配
   通过 roleId 将子任务路由到合适的 Worker

5️⃣ 可追溯性
   通过 parentId 可以追溯整个任务树
```

---

## 验证门机制深度解析

### 核心问题

**Worker 执行完成后，谁负责评估？什么时候评估？**

### 答案：Orchestrator 负责，时机取决于执行模式！

#### 评估机制的三层检查

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第621-720行)

```typescript
// Worker 执行完成，返回 result
result = await agent.run(workerTask);  // 第600行

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Orchestrator 启动三层评估
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 【评估层1】状态检查（第621-625行）
if (result.status !== 'success') {
  const errMsg = ...;
  throw new Error(errMsg);
}

// 【评估层2】关键工具失败检查（第627-638行）
const criticalFailures = checkCriticalToolFailures(result);
if (criticalFailures.length > 0) {
  // 即使 Worker 报告成功，也要检查工具是否真正成功
  // 例如：npm install 失败但 agent 继续执行
  throw new ReplanNeededError(
    subtaskId,
    `Critical tool failures: ${failureMessages}`,
    ...
  );
}

// 【评估层3】Verification Gate（第640-720行）
if (this.verificationGateService && !isParallelStep) {
  // 修复-验证循环
  while (buildGateFixAttempts <= MAX_BUILD_GATE_FIX_ATTEMPTS) {

    // 🔍 执行7层验证
    const verifyResult = await this.verificationGateService.verify(
      effectiveWorkDir,
      { preset: 'fast', changedFiles }
    );

    if (verifyResult.passed) break;  // ✅ 验证通过

    if (buildGateFixAttempts >= MAX_BUILD_GATE_FIX_ATTEMPTS) {
      // ❌ 超过最大尝试次数，重新规划
      throw new ReplanNeededError(...);
    }

    buildGateFixAttempts++;

    // 🛠️ 尝试修复
    // 1. 自动修复（例如 eslint --fix）
    const autoFixResult = await this.tryAutoFix(effectiveWorkDir, verifyResult);
    if (autoFixResult.fixed > 0) continue;  // 重新验证

    // 2. LLM 修复（创建修复任务，让 Worker 再次执行）
    await this.runVerificationFixTask(taskId, fixSummary, verifyCommand, ...);
  }
}
```

### Verification Gate 的7层检查

**代码位置**: `packages/core/src/orchestrator/services/verification-gate.ts` (第23-26行)

```typescript
export interface VerificationLayerResult {
  layer: 'deps' | 'type' | 'build' | 'test' | 'lint' | 'e2e' | 'smoke';
  passed: boolean;
  // ...
}
```

| 层级 | 名称    | 检查内容   | 示例命令                  |
| ---- | ------- | ---------- | ------------------------- |
| 1    | `deps`  | 依赖完整性 | `npm install` 是否成功    |
| 2    | `type`  | 类型检查   | `tsc --noEmit`, `pyright` |
| 3    | `build` | 构建过程   | `npm run build`           |
| 4    | `test`  | 单元测试   | `vitest`, `jest`          |
| 5    | `lint`  | 代码风格   | `eslint`, `prettier`      |
| 6    | `e2e`   | 端到端测试 | Playwright 浏览器测试     |
| 7    | `smoke` | 冒烟测试   | 启动服务并验证基本功能    |

### 验证时机：取决于执行模式

#### 模式1：顺序执行（Sequential）

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第406-410行)

```typescript
// Sequential execution: each subtask gets its own build gate check
for (const id of step.subtaskIds) {
  if (signal.aborted) break;
  await this.executeSubtask(taskId, id, subtaskMap, timeout, retryPolicy, signal, false);
  // ↑ 每个子任务执行完后，内部立即进行验证（第644行）
}
```

**验证时机**：**每个子任务完成后立即验证！**

```
【顺序执行流程】

子任务 1.1 执行
    ↓ Worker 返回结果
Orchestrator 评估
    ├─ 状态检查 ✓
    ├─ 关键工具检查 ✓
    └─ Verification Gate ✓
    ↓ 验证通过
标记 1.1 完成
    ↓
子任务 1.2 执行
    ↓ Worker 返回结果
Orchestrator 评估
    ├─ 状态检查 ✓
    ├─ 关键工具检查 ✗ (发现类型错误)
    └─ Verification Gate
        ├─ 验证失败
        ├─ 自动修复（eslint --fix）
        ├─ 重新验证 ✗ 还是失败
        ├─ LLM 修复（创建修复任务）
        ├─ Worker 执行修复
        └─ 重新验证 ✓ 通过！
    ↓ 验证通过
标记 1.2 完成
    ↓
子任务 1.3 执行...
```

#### 模式2：并行执行（Parallel）

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第321-403行)

```typescript
if (step.parallel) {
  // 1️⃣ 并行执行所有子任务
  await Promise.all(
    step.subtaskIds.map(
      (id) => this.executeSubtask(taskId, id, subtaskMap, timeout, retryPolicy, signal, true)
      // ↑ isParallelStep=true，子任务内部跳过验证！
    )
  );

  // 2️⃣ 所有子任务完成后，执行一次统一验证（第325-403行）
  if (this.verificationGateService) {
    // 收集所有并行子任务修改的文件
    const changedFiles = this.collectModifiedFiles(
      step.subtaskIds.map((id) => this.state.executionState?.completedSubtasks.get(id))
    );

    // 统一验证
    const verifyResult = await this.verificationGateService.verify(
      effectiveWorkDir,
      { preset: 'fast', changedFiles } // ← 验证所有修改的文件
    );
  }
}
```

**关键代码**: 第644行的条件判断

```typescript
// NOTE: For parallel steps, this is SKIPPED - gate runs at step level instead
if (this.verificationGateService && !isParallelStep) {
  // ↑ 并行子任务内部不验证（!isParallelStep 跳过）
  // 验证在 step 层级统一进行
}
```

**验证时机**：**所有并行子任务完成后，统一验证一次！**

```
【并行执行流程】

┌─ 子任务 1.1 执行（并行）
├─ 子任务 1.2 执行（并行）
└─ 子任务 1.3 执行（并行）
    ↓ 全部完成
    ↓ 收集所有修改的文件
Orchestrator 统一评估
    ├─ Verification Gate
    │  ├─ 验证范围: 1.1 + 1.2 + 1.3 的所有修改
    │  ├─ 类型检查（所有文件）
    │  ├─ 构建检查（整个项目）
    │  └─ 测试检查（相关测试）
    │
    ├─ 验证失败？
    │  ├─ 自动修复
    │  ├─ LLM 修复（创建修复任务）
    │  └─ 重新验证
    │
    └─ 验证通过 ✓
    ↓
标记所有子任务完成
```

### 为什么并行任务要统一验证？

```
【原因】避免验证冲突和资源浪费

场景：并行修改多个文件

子任务1: 修改 auth.ts
子任务2: 修改 user.ts
子任务3: 修改 index.ts

如果每个子任务单独验证：
❌ 问题1: auth.ts 验证时，user.ts 还没修改 → 类型错误（假阳性）
❌ 问题2: 构建命令运行3次 → 资源浪费
❌ 问题3: 测试运行3次 → 时间浪费

统一验证：
✓ 优势1: 所有文件修改完成后再验证 → 避免假阳性
✓ 优势2: 构建命令只运行1次 → 节省资源
✓ 优势3: 测试只运行1次 → 节省时间
✓ 优势4: 发现跨文件的集成问题
```

### 修复循环 vs 重新执行

**关键设计**：修复循环**不会**重新执行原始任务！

**代码位置**: 第648行注释

```typescript
// Inner fix-verify loop: only runs fix tasks, doesn't re-run original subtask
```

```
【错误理解 ❌】
验证失败 → 重新执行整个子任务 → 验证 → 失败 → 再重新执行...

【正确实现 ✓】
原始任务: "实现JWT token生成"（执行完成，不再执行）
    ↓
验证失败: 类型错误 "Property 'expiresIn' does not exist"
    ↓
修复任务: "修复类型错误"（只执行这个）
    ↓ Worker 执行修复
修复完成: 添加了类型定义
    ↓
重新验证: 类型检查 ✓ 通过！
    ↓
标记原始任务完成

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

好处:
✓ 不会重复执行已完成的工作
✓ 只修复问题，不重做整个任务
✓ 提高效率，避免资源浪费
```

### 职责划分

```
Worker（执行者）:
├─ 接收任务
├─ 执行 Agent Loop
├─ 返回结果
└─ 不知道自己被评估了！

Orchestrator（评估者）:
├─ 接收 Worker 结果
├─ 三层评估检查
│  ├─ 层1: 状态检查
│  ├─ 层2: 关键工具检查
│  └─ 层3: Verification Gate
├─ 决定是否需要修复
├─ 创建修复任务
├─ 分配给 Worker 执行
└─ 决定是否需要重新规划

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

核心理念:
"Worker 只负责执行，Orchestrator 负责质量保证"
```

---

## Session 与多任务管理

### 核心问题

**一个 Session 中有多轮对话，每轮对话产生一个任务，如何管理？**

### Session vs Task 的关系

**代码位置**: `packages/core/src/conversation/conversational-runner.ts` (第1088-1138行)

```typescript
private async *runWithOrchestrator(session: SessionState, objective: string, ...) {

  // 每次对话生成一个新的 taskId
  const taskId = `task-${randomUUID().substring(0, 8)}`;  // ← 第1099行

  const task: Task = {
    id: taskId,  // ← 每轮对话有独立的 taskId
    objective,
    context: {
      parentTaskId: session.sessionId,  // ← 关联到 session
      sessionId: session.sessionId,
      metadata: {
        workDir: resolve(this.config.workDir),
        taskmaster: {
          enabled: true,
          tag: session.sessionId,  // ← 使用 sessionId 作为 tag
        }
      }
    }
  };

  // 调用 Orchestrator 执行这个 task
  yield* orchestrator.run(task);
}
```

### 文件组织策略：覆盖式 + 追加式

```
.tachikoma/sessions/{sessionId}/  ← 一个 Session 一个目录
│
├─ conversation/
│  └─ session.json  ← Session 状态（追加式）
│     {
│       "sessionId": "sess-001",
│       "messages": [
│         { id: "msg-001", role: "user", content: "任务1: 实现登录" },
│         { id: "msg-002", role: "assistant", executionSummary: {...} },
│         { id: "msg-003", role: "user", content: "任务2: 添加注册" },
│         { id: "msg-004", role: "assistant", executionSummary: {...} }
│       ],
│       "checkpoints": [
│         { id: "cp-001", description: "任务1完成" },
│         { id: "cp-002", description: "任务2完成" }
│       ]
│     }
│
├─ orchestrator/
│  ├─ runtime.json     ← 当前任务的计划（覆盖式）
│  │   任务1 执行时: { taskId: "task-001", ... }
│  │   任务2 开始时: { taskId: "task-002", ... }  ← 覆盖！
│  │
│  ├─ progress.json    ← 当前任务的进度（覆盖式）
│  │   始终是当前任务的进度
│  │
│  ├─ decisions.jsonl  ← 决策日志（追加式）
│  │   {"taskId": "task-001", "decision": "..."}
│  │   {"taskId": "task-002", "decision": "..."}
│  │   {"taskId": "task-001", "decision": "..."}
│  │
│  └─ checkpoints/     ← 检查点（追加式）
│
├─ workers/
│  └─ worker-001/
│     ├─ thinking.jsonl  ← 思考日志（追加式）
│     │   {"taskId": "task-001", "content": "..."}
│     │   {"taskId": "task-002", "content": "..."}
│     │
│     └─ actions.jsonl   ← 动作日志（追加式）
│         {"taskId": "task-001", "tool": "edit_file", ...}
│         {"taskId": "task-002", "tool": "bash", ...}
│
└─ shared/
   ├─ context.json    ← 共享上下文（覆盖式）
   └─ messages.jsonl  ← 消息日志（追加式）
```

### 多任务协调流程

```
第1轮对话: "实现登录功能"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ 生成 taskId = "task-abc123"

2️⃣ 写入文件:
   ├─ runtime.json（覆盖）
   │   { taskId: "task-abc123", executionPlan: [...] }
   ├─ progress.json（覆盖）
   │   { taskId: "task-abc123", status: "executing" }
   └─ conversation/session.json（追加消息）
       messages.push({
         id: "msg-001",
         role: "user",
         content: "实现登录功能"
       })

3️⃣ Workers 执行:
   ├─ worker-001/thinking.jsonl（追加）
   │   {"taskId": "task-abc123", ...}
   └─ worker-001/actions.jsonl（追加）
       {"taskId": "task-abc123", ...}

4️⃣ 完成后:
   └─ session.json 追加 assistant 消息

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

第2轮对话: "添加注册功能"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ 生成 taskId = "task-def456"（新的！）

2️⃣ 写入文件:
   ├─ runtime.json（覆盖！）
   │   { taskId: "task-def456", ... }  ← 旧的 task-abc123 被覆盖
   │
   ├─ progress.json（覆盖！）
   │   { taskId: "task-def456", status: "executing" }
   │
   ├─ decisions.jsonl（追加！）
   │   保留 task-abc123 的决策
   │   追加 task-def456 的决策
   │
   ├─ worker-001/thinking.jsonl（追加！）
   │   保留 task-abc123 的思考
   │   追加 task-def456 的思考
   │
   └─ conversation/session.json（追加！）
       messages.push({
         id: "msg-003",
         role: "user",
         content: "添加注册功能"
       })

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

结论:

覆盖的文件（只保留当前任务）:
├─ runtime.json
├─ progress.json
└─ shared/context.json

追加的文件（保留所有历史）:
├─ decisions.jsonl
├─ worker-{id}/thinking.jsonl
├─ worker-{id}/actions.jsonl
└─ conversation/session.json
```

### 设计理由

```
【为什么 runtime.json 覆盖？】

✓ Orchestrator 只需要关注"当前任务"
✓ 文件小、读取快
✓ 避免文件膨胀

【为什么 Worker 日志追加？】

✓ 可以追溯完整执行轨迹
✓ 用于调试、分析、学习
✓ 通过 taskId 区分不同任务
✓ 评估 Worker 行为模式

【为什么 Session 追加？】

✓ 保持多轮对话的上下文
✓ 用户可以回顾历史
✓ 支持 /checkpoints、/continue
✓ 累积式管理
```

### Session 状态结构

**代码位置**: `packages/core/src/conversation/types.ts` (第84-116行)

```typescript
export interface SessionState {
  sessionId: string;
  createdAt: number;
  lastActiveAt: number;
  workDir: string;

  // 对话历史（追加式）
  messages: ConversationMessage[]; // ← 所有轮次的消息
  compressedHistory?: string;

  // 当前执行状态（覆盖式）
  currentPlan?: {
    subtasks: SubTask[];
    executionOrder: string[];
  };
  completedSubtasks: string[]; // ← 累积
  pendingSubtasks: string[]; // ← 动态更新

  // 检查点（追加式）
  checkpoints: Checkpoint[];
}
```

### 类比理解

```
Session = 聊天记录本
├─ messages[] = 所有对话历史（不删除）
├─ checkpoints[] = 重要节点标记（不删除）
└─ completedSubtasks[] = 完成的任务累积（不删除）

runtime.json = 白板
├─ 每次新任务: 擦掉旧的，写上新的
└─ 只显示"当前工作"

Worker 日志 = 工作日记
├─ 每次新任务: 翻页继续写
├─ 保留完整历史
└─ 可以往回查看任何时间点的记录
```

---

## 两种运行模式对比

### 模式 1: 主动协调模式（当前实现）

**特点**：Orchestrator **持续运行**，主动分配任务 + 被动监听文件。

```
┌──────────────────────────────────────────────────────────┐
│              Orchestrator (持续运行)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  while (任务未完成) {                              │  │
│  │    // 1. 主动分配任务                              │  │
│  │    if (有待分配的子任务) {                        │  │
│  │      worker = workerPool.assign(subtask);         │  │
│  │      result = await worker.execute(subtask);      │  │
│  │    }                                              │  │
│  │                                                   │  │
│  │    // 2. 同时，后台线程监听文件变化               │  │
│  │    // (SessionWatcher在后台运行)                 │  │
│  │  }                                                │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
       │                                   ▲
       │ 直接调用                          │ 事件触发
       ▼                                   │
   Worker 执行  ──写文件──>  .tachikoma/  ─┘
```

**代码示例**：

```typescript
// packages/core/src/orchestrator/orchestrator.ts
class Orchestrator {
  async run(task: Task): Promise<TaskResult> {
    // 1️⃣ 启动会话（创建文件系统）
    await this.session.start(task);

    // 2️⃣ 启动文件监控（后台线程）
    await this.session.getManager()?.startWatching();

    try {
      // 3️⃣ 主循环（阻塞等待）
      const plan = await this.planner.plan(task);

      // 4️⃣ 执行所有子任务（同步等待）
      for (const phase of plan.executionPlan.phases) {
        if (phase.parallel) {
          // 并行执行
          await Promise.all(phase.subtaskIds.map((id) => this.executeSubtask(subtasks.find((s) => s.id === id))));
        } else {
          // 顺序执行
          for (const id of phase.subtaskIds) {
            await this.executeSubtask(subtasks.find((s) => s.id === id));
          }
        }
      }

      // 5️⃣ 聚合结果
      return await this.aggregationEngine.aggregate(results);
    } finally {
      // 6️⃣ 关闭会话（停止监控）
      await this.session.stop();
    }
  }
}
```

**优势**：

- ✅ **低延迟** - 任务分配立即执行
- ✅ **简单直观** - 代码逻辑清晰
- ✅ **易调试** - 单进程，易于追踪
- ✅ **实时响应** - 审批/干预立即生效

**劣势**：

- ❌ **资源占用** - 必须持续运行
- ❌ **单点故障** - Orchestrator 崩溃则任务失败
- ❌ **不适合超长任务** - 运行几天的任务不现实

### 模式 2: 完全被动模式（理论设计）

**特点**：Orchestrator **间歇性唤醒**，完全通过文件系统协调。

```
┌──────────────────────────────────────────────────────────┐
│            Orchestrator (间歇性唤醒)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  while (true) {                                    │  │
│  │    // 1. 读取文件系统状态                          │  │
│  │    state = loadStateFromFiles();                   │  │
│  │                                                    │  │
│  │    // 2. 检查是否有工作要做                        │  │
│  │    if (state.hasPendingSubtasks) {                 │  │
│  │      assignNextSubtask(); // 写文件分配任务        │  │
│  │    }                                               │  │
│  │                                                    │  │
│  │    if (state.hasPendingApprovals) {                │  │
│  │      processApprovals(); // 写文件响应审批         │  │
│  │    }                                               │  │
│  │                                                    │  │
│  │    if (state.allComplete) {                        │  │
│  │      aggregateAndFinish();                         │  │
│  │      break;                                        │  │
│  │    }                                               │  │
│  │                                                    │  │
│  │    // 3. 睡眠                                      │  │
│  │    await sleep(5000); // 5秒后再检查              │  │
│  │  }                                                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
       │                                   ▲
       │ 写任务文件                        │ 读状态文件
       ▼                                   │
   .tachikoma/  <──轮询检查──  Worker (自主运行)
```

**Worker 也需要自主模式**：

```
┌──────────────────────────────────────────────────────────┐
│               Worker (自主运行)                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  while (true) {                                    │  │
│  │    // 1. 检查是否有分配给我的任务                  │  │
│  │    task = readMyAssignedTask();                    │  │
│  │                                                    │  │
│  │    if (task) {                                     │  │
│  │      // 2. 执行任务                                │  │
│  │      result = await executeTask(task);             │  │
│  │                                                    │  │
│  │      // 3. 写入结果                                │  │
│  │      writeTaskResult(result);                      │  │
│  │    }                                               │  │
│  │                                                    │  │
│  │    // 4. 睡眠                                      │  │
│  │    await sleep(1000);                              │  │
│  │  }                                                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**代码示例（理论设计）**：

```typescript
// 理论设计：StatelessOrchestrator
class StatelessOrchestrator {
  async patrol(sessionId: string): Promise<void> {
    while (true) {
      // 1️⃣ 从文件加载状态
      const state = await this.loadStateFromFiles(sessionId);

      // 2️⃣ 检查是否有待分配的子任务
      if (state.pendingSubtasks.length > 0) {
        const subtask = state.pendingSubtasks[0];

        // 找到可用的 Worker（通过读取 worker/*/status.json）
        const workerId = await this.findIdleWorker(sessionId);

        if (workerId) {
          // 写入任务分配文件
          await this.assignTaskToWorker(sessionId, workerId, subtask);
        }
      }

      // 3️⃣ 检查是否有待处理的审批
      const approvals = await this.findPendingApprovals(sessionId);
      for (const approval of approvals) {
        const decision = await this.evaluateApproval(approval);
        await this.writeApprovalResponse(sessionId, approval.workerId, decision);
      }

      // 4️⃣ 检查是否需要干预
      for (const workerId of state.activeWorkers) {
        const deviation = await this.detectDeviation(sessionId, workerId);
        if (deviation.needsIntervention) {
          await this.sendIntervention(sessionId, workerId, deviation);
        }
      }

      // 5️⃣ 检查是否全部完成
      if (state.completedSubtasks.length === state.totalSubtasks) {
        await this.aggregateAndFinish(sessionId);
        break;
      }

      // 6️⃣ 睡眠
      await sleep(5000);
    }
  }

  private async loadStateFromFiles(sessionId: string): Promise<SessionState> {
    // 读取 runtime.json、progress.json、所有 worker/*/status.json
    const runtime = await readJson(`sessions/${sessionId}/orchestrator/runtime.json`);
    const progress = await readJson(`sessions/${sessionId}/orchestrator/progress.json`);
    const workerStates = await this.readAllWorkerStates(sessionId);

    return {
      taskId: runtime.taskId,
      totalSubtasks: runtime.plannerOutput.subtasks.length,
      completedSubtasks: progress.completedSubtasks,
      pendingSubtasks: this.findPendingSubtasks(runtime, progress),
      activeWorkers: workerStates.filter((w) => w.status !== 'idle').map((w) => w.workerId)
    };
  }
}

// Worker 自主模式
class AutonomousWorker {
  async patrol(sessionId: string, workerId: string): Promise<void> {
    while (true) {
      // 1️⃣ 检查是否有分配给我的任务
      const assignment = await this.readMyAssignment(sessionId, workerId);

      if (assignment) {
        // 2️⃣ 更新状态为忙碌
        await this.updateStatus(sessionId, workerId, 'busy');

        // 3️⃣ 执行任务
        const result = await this.executeTask(assignment.subtask);

        // 4️⃣ 写入结果
        await this.writeResult(sessionId, workerId, result);

        // 5️⃣ 删除任务分配文件
        await this.deleteAssignment(sessionId, workerId);

        // 6️⃣ 更新状态为空闲
        await this.updateStatus(sessionId, workerId, 'idle');
      }

      // 7️⃣ 睡眠
      await sleep(1000);
    }
  }
}
```

**优势**：

- ✅ **节省资源** - 不需要持续运行
- ✅ **容错性强** - Orchestrator 崩溃可以重启恢复
- ✅ **分布式友好** - 可以多个 Orchestrator 实例轮流检查
- ✅ **适合超长任务** - 任务运行几天/几周都没问题
- ✅ **易扩展** - 可以独立扩展 Orchestrator 和 Worker

**劣势**：

- ❌ **延迟高** - 轮询间隔导致响应延迟（秒级）
- ❌ **实现复杂** - 需要处理竞态条件、锁机制
- ❌ **调试困难** - 多进程异步交互难以追踪
- ❌ **文件系统压力** - 频繁读写文件

### 对比总结

| 特性           | 主动协调模式     | 完全被动模式      |
| -------------- | ---------------- | ----------------- |
| **运行方式**   | 持续运行         | 间歇性唤醒        |
| **任务分配**   | 直接调用         | 写入文件          |
| **响应延迟**   | <1ms             | 1-5秒             |
| **资源占用**   | 持续占用         | 按需占用          |
| **容错性**     | 依赖进程         | 无状态恢复        |
| **适用场景**   | 短期任务（小时） | 长期任务（天/周） |
| **实现复杂度** | 简单             | 复杂              |
| **当前状态**   | ✅ 已实现        | 🚧 理论设计       |

### 未来演进路径

Tachikoma 的设计已经**埋下了伏笔**，可以平滑过渡到完全被动模式：

```
Phase 1: 主动协调（当前）
   ↓
Phase 2: 混合模式（未来）
   - Orchestrator 可以暂停/恢复
   - Worker 保持自主运行
   ↓
Phase 3: 完全被动（远期）
   - Orchestrator 间歇性运行
   - Worker 完全自主
   - 分布式多 Orchestrator
```

**为什么设计得如此灵活？**

因为 Tachikoma 的核心设计理念是：

```
🎯 快速路径（Fast Path） + 可靠路径（Reliable Path）

快速路径（当前主要使用）：
  内存通信 → 低延迟 → 适合交互式场景

可靠路径（已实现，备用）：
  文件协调 → 持久化 → 适合长期任务

灵活切换：
  可以根据任务特点选择合适的模式
```

---

## 文件协议规范

### 文件命名规范

| 文件                       | 路径                                  | 格式  | 用途                      |
| -------------------------- | ------------------------------------- | ----- | ------------------------- |
| **runtime.json**           | `orchestrator/runtime.json`           | JSON  | 运行时快照（规划信息）    |
| **progress.json**          | `orchestrator/progress.json`          | JSON  | 执行进度                  |
| **decisions.jsonl**        | `orchestrator/decisions.jsonl`        | JSONL | 决策日志（审批/干预记录） |
| **checkpoint-{id}.json**   | `orchestrator/checkpoints/`           | JSON  | 检查点（断点续传）        |
| **status.json**            | `workers/{id}/status.json`            | JSON  | Worker 状态               |
| **thinking.jsonl**         | `workers/{id}/thinking.jsonl`         | JSONL | 思考日志                  |
| **actions.jsonl**          | `workers/{id}/actions.jsonl`          | JSONL | 行动日志                  |
| **pending_approval.json**  | `workers/{id}/pending_approval.json`  | JSON  | 审批请求                  |
| **approval_response.json** | `workers/{id}/approval_response.json` | JSON  | 审批响应                  |
| **intervention.json**      | `workers/{id}/intervention.json`      | JSON  | 干预指令                  |
| **context.json**           | `shared/context.json`                 | JSON  | 共享上下文                |
| **messages.jsonl**         | `shared/messages.jsonl`               | JSONL | 消息日志                  |

### 文件格式定义

#### runtime.json

```typescript
interface RuntimeFile {
  kind: 'tachikoma';
  sessionId: string;
  taskId: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  plannerOutput: {
    taskId: string;
    subtasks: SubTask[];
    executionPlan: {
      isParallel: boolean;
      phases: Array<{
        name: string;
        subtaskIds: string[];
        parallel: boolean;
      }>;
    };
    delegation: {
      mode: 'parallel' | 'sequential';
      workerCount: number;
      timeout: number;
    };
  };
}
```

#### status.json

```typescript
interface WorkerStatusFile {
  workerId: string;
  status: 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'error';
  currentSubtask?: {
    id: string;
    objective: string;
    startedAt: number;
  };
  progress: number; // 0-100
  lastHeartbeat: number;
  error?: {
    code: string;
    message: string;
    timestamp: number;
  };
}
```

#### pending_approval.json

```typescript
interface PendingApprovalFile {
  requestId: string;
  workerId: string;
  subtaskId: string;
  requestedAt: number;
  type: 'file_deletion' | 'multi_file_refactor' | 'external_api_call' | 'dangerous_operation' | 'resource_intensive';
  description: string;
  details: {
    affectedFiles?: string[];
    impactScope?: 'low' | 'medium' | 'high';
    reversible?: boolean;
    metadata?: Record<string, unknown>;
  };
  timeout: number; // 毫秒
  defaultDecision: 'approve' | 'reject';
}
```

#### approval_response.json

```typescript
interface ApprovalResponseFile {
  requestId: string;
  respondedAt: number;
  approved: boolean;
  respondedBy: 'orchestrator' | 'human';
  reason?: string;
  instructions?: string;
  modifiedParams?: Record<string, unknown>;
}
```

#### intervention.json

```typescript
interface InterventionFile {
  interventionId: string;
  createdAt: number;
  type: 'redirect' | 'pause' | 'resume' | 'abort' | 'guidance';
  reason: string;
  detectedIssue?: {
    type: 'deviation' | 'inefficiency' | 'error' | 'stuck';
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
  instructions: string;
  suggestedNextSteps?: string[];
  acknowledged: boolean;
  acknowledgedAt?: number;
}
```

### 原子写入协议

为了保证文件一致性，所有文件写入都使用**原子写入**：

```typescript
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  // 1️⃣ 写入临时文件
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(data, null, 2));

  // 2️⃣ 原子性重命名（操作系统保证原子性）
  await rename(tempPath, filePath);

  // 3️⃣ 如果重命名失败，清理临时文件
  // (rename 会自动覆盖目标文件，所以不需要手动删除)
}
```

**为什么需要原子写入？**

假设不使用原子写入：

```typescript
// ❌ 错误的写入方式
async function badWrite(filePath: string, data: unknown): Promise<void> {
  // 直接覆盖文件
  await writeFile(filePath, JSON.stringify(data));

  // 问题：如果写入到一半进程崩溃，文件会损坏！
  // 读取方会得到不完整的 JSON，导致解析失败
}
```

使用原子写入后：

```typescript
// ✅ 正确的写入方式
// 1. 先写入 .tmp 文件
// 2. 写入完成后，rename（原子操作）
// 3. 即使崩溃，要么看到旧文件，要么看到新文件，不会看到半成品
```

### 读取重试协议

由于原子写入有短暂的窗口期（.tmp 文件存在，目标文件不存在），读取方需要支持重试：

```typescript
async function safeReadJsonFileWithRetry<T>(
  filePath: string,
  retries: number = 2,
  backoffDelay: number = 50
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      if (attempt === retries) {
        // 最后一次尝试失败，返回 null
        return null;
      }

      // 等待后重试
      await sleep(backoffDelay * (attempt + 1));
    }
  }

  return null;
}
```

### JSONL 格式规范

JSONL (JSON Lines) 用于追加式日志文件：

```
{"id":"001","timestamp":1700000000,"content":"第一条记录"}
{"id":"002","timestamp":1700000001,"content":"第二条记录"}
{"id":"003","timestamp":1700000002,"content":"第三条记录"}
```

**特点**：

- ✅ 每行一条 JSON 记录
- ✅ 可以高效追加（不需要重写整个文件）
- ✅ 可以逐行读取（不需要一次加载全部）

**追加操作**：

```typescript
async function appendJsonlRecord(filePath: string, record: unknown): Promise<void> {
  const line = JSON.stringify(record) + '\n';

  // 追加模式打开文件
  await appendFile(filePath, line);
}
```

**读取操作**：

```typescript
async function readJsonlRecords<T>(filePath: string, limit?: number): Promise<T[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  // 取最后 limit 条（如果指定）
  const targetLines = limit ? lines.slice(-limit) : lines;

  return targetLines.filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}
```

---

## Agentic 设计模式在 Tachikoma 中的应用

本章节整合了现代 Agentic 系统的核心设计模式，并说明 Tachikoma 如何应用这些模式来构建生产级多智能体系统。这些设计模式是 Agent 开发的**理论基础和实践指南**。

### 核心设计模式概览

```
┌────────────────────────────────────────────────────────────┐
│         Agentic Design Patterns Landscape                  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 【控制流模式】                                              │
│ ├─ Prompt Chaining    : 顺序执行，管道式处理              │
│ ├─ Routing            : 条件分支，动态路径选择            │
│ └─ Parallelization    : 并行执行，加速处理                │
│                                                            │
│ 【质量保证模式】                                            │
│ ├─ Reflection         : 自我评估，迭代改进                │
│ ├─ Evaluation         : 系统性评估，性能优化              │
│ └─ Exception Handling : 异常处理，容错恢复                │
│                                                            │
│ 【能力扩展模式】                                            │
│ ├─ Tool Use           : 工具调用，扩展能力                │
│ ├─ Planning           : 动态规划，自主决策                │
│ └─ Reasoning          : 推理技术，深度思考                │
│                                                            │
│ 【协作模式】                                                │
│ ├─ Multi-Agent        : 多智能体协作，专业分工            │
│ ├─ Human-in-the-Loop  : 人机协作，监督干预                │
│ └─ Inter-Agent Comm   : Agent间通信，分布式协作           │
│                                                            │
│ 【资源管理模式】                                            │
│ ├─ Memory Management  : 短期/长期/状态记忆                │
│ ├─ Resource-Aware     : 动态资源优化，成本控制            │
│ └─ Prioritization     : 任务优先级，智能调度              │
│                                                            │
│ 【监控治理模式】                                            │
│ ├─ Goal Setting       : 目标设定，持续监控                │
│ ├─ Evaluation         : 多维度评估，轨迹分析              │
│ └─ Guardrails         : 安全护栏，行为约束                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

### Prompt Chaining - 提示词链

#### 核心概念

**定义**：将复杂任务分解为一系列顺序执行的步骤，每一步的输出作为下一步的输入。

```
步骤1 → 输出1 → 步骤2 → 输出2 → 步骤3 → 输出3 → 最终结果
```

#### 关键特征

- **顺序执行**：严格的执行顺序，步骤间有依赖关系
- **数据流动**：前一步的输出是后一步的输入
- **结构化输出**：强调使用 JSON 等结构化格式
- **固定流程**：流程是预定义的，不是动态生成的

#### Tachikoma 中的应用

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第406-410行)

```typescript
// Sequential execution: each subtask gets its own build gate check
for (const id of step.subtaskIds) {
  await this.executeSubtask(taskId, id, subtaskMap, timeout, retryPolicy, signal, false);
  // ↑ 顺序执行，一个接一个
}
```

**实现方式**：

```
Planner 生成 executionPlan:
{
  steps: [
    { subtaskIds: ["1.1"], parallel: false },  ← 步骤1
    { subtaskIds: ["1.2"], parallel: false },  ← 步骤2（依赖1.1）
    { subtaskIds: ["1.3"], parallel: false }   ← 步骤3（依赖1.2）
  ]
}

ExecutionLoop 执行:
for (const step of executionPlan.steps) {
  await executeStep(step);  // 顺序执行每个步骤
}
```

**典型场景**：

```
场景: 实现用户注册功能

步骤1: 设计数据库Schema
  输出: user 表结构定义
  ↓
步骤2: 实现注册API
  输入: user 表结构（从步骤1）
  输出: /api/register 接口代码
  ↓
步骤3: 编写单元测试
  输入: 注册API代码（从步骤2）
  输出: register.test.js
  ↓
步骤4: 集成到主应用
  输入: API和测试（从步骤2、3）
  输出: 集成完成
```

#### 设计要点

```
✓ 确保步骤间的输入输出清晰定义
✓ 使用结构化输出（JSON）便于解析
✓ 每个步骤应该是单一职责的
✓ 通过 dependencies 字段显式声明依赖
✗ 避免步骤过多（建议 ≤ 5步）
✗ 避免循环依赖
```

---

### Routing - 路由模式

#### 核心概念

**定义**：引入条件逻辑，根据输入特征动态选择执行路径。

```
           ┌─→ 路径A
输入 → 路由器 ─┼─→ 路径B
           └─→ 路径C
```

#### 路由类型

```
【单选路由】（Select-One）
├─ 输入: 一个请求
├─ 决策: 选择一条路径
└─ 输出: 该路径的结果

【多选路由】（Multi-Select / Multicast）
├─ 输入: 一个请求
├─ 决策: 选择多条路径
└─ 输出: 多个路径的结果（可能并行执行）
```

#### Tachikoma 中的应用

**1. 角色路由**

**代码位置**: `packages/core/src/orchestrator/types.ts` (第89-100行)

```typescript
export interface PlannerRole {
  id: string; // 角色ID
  name: string; // 角色名称（如 "backend-dev"）
  responsibilities: string; // 角色职责
  capabilities: string[]; // 能力标签
}

// Planner 根据任务特征分配角色
subtask.roleId = 'backend-dev'; // ← 路由到后端开发 Worker
```

**2. Worker 选择路由**

**代码位置**: `packages/core/src/orchestrator/worker-pool/default-pool.ts` (第161-180行)

```typescript
selectWorker(capabilities?: string[]): string | undefined {
  const availableWorkers = this.getAvailableWorkers(capabilities);

  switch (this._config.selectionStrategy) {
    case 'round-robin':           // 轮询路由
      return this.selectRoundRobin(availableWorkers);
    case 'least-loaded':          // 负载最低路由
      return this.selectLeastLoaded(availableWorkers);
    case 'capability-match':      // 能力匹配路由
      return this.selectCapabilityMatch(availableWorkers, capabilities);
    default:
      return this.selectLeastLoaded(availableWorkers);
  }
}
```

**3. 执行模式路由**

```typescript
// 根据 step.parallel 决定执行路径
if (step.parallel) {
  // 路径A: 并行执行
  await Promise.all(...);
} else {
  // 路径B: 顺序执行
  for (const id of step.subtaskIds) {
    await executeSubtask(id);
  }
}
```

#### 路由机制

| 机制                 | 说明             | Tachikoma 应用              |
| -------------------- | ---------------- | --------------------------- |
| **LLM-based**        | 大模型分析后决策 | Planner 分配角色            |
| **Rule-based**       | 基于规则的路由   | Worker 选择策略             |
| **Capability-based** | 基于能力标签匹配 | `requiredCapabilities` 匹配 |

#### 设计要点

```
✓ 路由决策应该是确定性的（给定输入→固定输出）
✓ 路由条件应该互斥（避免歧义）
✓ 支持 fallback 机制（路由失败时的备选）
✓ 多选路由 + 独立任务 = 可以并行执行
✗ 避免过深的路由嵌套（建议 ≤ 3层）
```

---

### Parallelization - 并行化

#### 核心概念

**定义**：识别可以同时执行的独立任务，并行处理以加速执行。

```
前提条件: 任务间无依赖关系

任务A ┐
任务B ├→ 并行执行 → 全部完成 → 汇总结果
任务C ┘
```

#### 关键要素

```
1️⃣ 任务独立性
   ├─ 无共享状态
   ├─ 无数据依赖
   └─ 无执行顺序要求

2️⃣ 前置任务检查
   ├─ 通过 dependencies[] 声明依赖
   ├─ 执行前验证依赖已完成
   └─ 避免循环依赖（DAG）

3️⃣ 资源管理
   ├─ 限制并发数（避免资源耗尽）
   ├─ 负载均衡
   └─ 错误隔离
```

#### Tachikoma 中的应用

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第321-323行)

```typescript
if (step.parallel) {
  // Parallel execution: run all subtasks then do ONE verification gate check
  await Promise.all(
    step.subtaskIds.map((id) => this.executeSubtask(taskId, id, subtaskMap, timeout, retryPolicy, signal, true))
  );
}
```

**依赖检查**：

**代码位置**: 第429-446行

```typescript
if (subtask.dependencies && execState) {
  for (const depId of subtask.dependencies) {
    if (!execState.completedSubtasks.has(depId)) {
      console.warn(`DEPENDENCY VIOLATION: Subtask ${subtaskId} requires ${depId}`);
      this.state.markSubtaskFailed(subtaskId, `Dependency ${depId} not completed`);
      return; // ← 阻止执行
    }
  }
}
```

**实现示例**：

```
Planner 生成并行计划:
{
  steps: [
    {
      subtaskIds: ["1.1", "1.2", "1.3"],  // 三个独立任务
      parallel: true                       // 并行执行标志
    },
    {
      subtaskIds: ["1.4"],                 // 依赖前三个任务
      parallel: false,
      dependencies: ["1.1", "1.2", "1.3"] // 显式依赖
    }
  ]
}

执行流程:
1.1, 1.2, 1.3 → Promise.all() 并行
    ↓ 全部完成
    ↓ 统一验证
1.4 → 顺序执行（依赖检查通过后）
```

#### 并行化的特殊处理

```
【Verification Gate 的时机差异】

顺序执行:
├─ 每个子任务完成 → 立即验证
└─ 验证范围: 单个子任务的修改

并行执行:
├─ 所有子任务完成 → 统一验证
└─ 验证范围: 所有子任务的修改

原因:
✓ 避免验证冲突（文件交叉修改）
✓ 节省资源（构建/测试只运行一次）
✓ 发现集成问题（跨文件的类型错误）
```

#### 设计要点

```
✓ 明确声明依赖关系（dependencies[]）
✓ 使用 DAG（有向无环图）避免循环依赖
✓ 并行数量要合理（根据资源限制）
✓ 错误隔离（一个失败不影响其他）
✗ 避免共享可变状态
✗ 避免隐式依赖
```

---

### Reflection - 反思模式

#### 核心概念

**定义**：Agent 评估自己的工作输出，使用评估结果改进性能的反馈循环。

```
目标 → 执行 → 结果 → 评估 → 识别差异 → 改进 → 重新执行
  ↑                                              ↓
  └──────────────── 反馈循环 ────────────────────┘
```

#### 反思的核心循环

```
1️⃣ 设定目标（Goal）
   ├─ 明确的成功标准
   └─ 可度量的指标

2️⃣ 执行任务（Execute）
   └─ 生成输出/结果

3️⃣ 评估结果（Evaluate）
   ├─ 与目标对比
   └─ 识别差异和不足

4️⃣ 生成改进方案（Improve）
   ├─ 分析失败原因
   └─ 制定修复策略

5️⃣ 重新执行（Re-execute）
   └─ 应用改进方案

6️⃣ 迭代直到达标
```

#### Tachikoma 中的应用

**核心实现：Verification Gate + 修复循环**

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第640-720行)

```
【反思循环的 Tachikoma 实现】

目标: 通过 Verification Gate（类型检查、构建、测试）

执行: Worker 完成子任务
    ↓
结果: 生成代码文件
    ↓
评估: Verification Gate 检查
    ├─ 类型检查: ❌ 发现错误
    ├─ 构建检查: ⏭️ 跳过（类型先失败）
    └─ 测试检查: ⏭️ 跳过
    ↓
识别差异:
    "Property 'expiresIn' does not exist on type 'SignOptions'"
    ↓
改进: 创建修复任务
    目标: "修复类型错误: 添加 expiresIn 属性定义"
    上下文: 错误详情 + 验证命令
    ↓
重新执行: Worker 执行修复任务
    ├─ 添加类型定义
    └─ 返回结果
    ↓
重新评估: Verification Gate 再次检查
    ├─ 类型检查: ✅ 通过
    ├─ 构建检查: ✅ 通过
    └─ 测试检查: ✅ 通过
    ↓
达标: 标记任务完成
```

**代码示例**：

```typescript
// 修复-验证循环（反思循环的实现）
while (buildGateFixAttempts <= MAX_BUILD_GATE_FIX_ATTEMPTS) {

  // 评估: 执行验证
  const verifyResult = await this.verificationGateService.verify(...);

  if (verifyResult.passed) {
    break;  // 达标，退出循环
  }

  // 识别差异: 格式化错误信息
  const errorSummary = VerificationGateService.formatErrorsForWorker(verifyResult);

  // 改进: 尝试自动修复
  const autoFixResult = await this.tryAutoFix(effectiveWorkDir, verifyResult);
  if (autoFixResult.fixed > 0) {
    continue;  // 重新评估
  }

  // 改进: 创建 LLM 修复任务
  await this.runVerificationFixTask(taskId, fixSummary, verifyCommand, ...);

  // 重新评估（下一轮循环）
  buildGateFixAttempts++;
}
```

#### Producer-Critic 模型

```
【Tachikoma 的实现】

Producer（生产者）: Worker
├─ 角色: 执行任务，生成代码
└─ 不负责评估自己的输出

Critic（评审者）: Verification Gate
├─ 角色: 评估代码质量
├─ 7层检查机制
└─ 提供改进建议

优势:
✓ 避免自我确认偏差（Worker 不评估自己）
✓ 客观评估（基于工具: tsc, eslint, test）
✓ 可重复性（验证标准固定）
```

#### 设计要点

```
✓ 设定清晰的评估标准（Verification layers）
✓ 分离生产者和评审者角色
✓ 限制反思次数（避免无限循环）
✓ 提供具体的改进指导（不是泛泛而谈）
✗ 避免过度反思（成本高昂）
✗ 避免主观评估（使用客观工具）
```

---

### Tool Use - 工具使用

#### 核心概念

**定义**：Agent 通过工具调用与外部环境交互，突破 LLM 的静态知识限制。

```
Agent Loop:
┌─→ 思考 → 决定工具 → 调用工具 → 获取结果 → 思考 ─┐
│                                                   │
└───────────────── 循环直到完成 ────────────────────┘
```

#### Agent Loop 的输入输出

```
【输入】
├─ System Prompt: 角色定义 + 工具定义
├─ User Prompt: 任务目标 + 约束
└─ Context: 历史对话 + 工具结果

【输出】
├─ Chain of Thought: 思考过程（可选）
├─ Content: 纯文本内容
└─ Tool Call: 工具调用意图
    {
      "name": "edit_file",
      "input": {"path": "auth.js", "content": "..."}
    }
```

#### Tachikoma 中的应用

**代码位置**: `packages/core/src/worker/backends/generic-agent-backend.ts` (第523-700行)

```typescript
while (!done && round < limits.maxThinkingRounds) {
  round++;

  // 1️⃣ 思考阶段: 调用 LLM
  const response = await this.llmClient.complete({
    systemPrompt: effectiveSystemPrompt,
    messages: contextToLLMMessages(context.getContext()),
    tools: nativeToolSet  // ← 工具定义
  });

  yield { type: 'thinking', content: response.content };

  // 2️⃣ 解析工具调用
  const toolCalls = parseToolCalls(response.content, response.toolCalls);

  if (toolCalls.length === 0) {
    done = true;  // 没有工具调用，任务完成
    break;
  }

  // 3️⃣ 执行工具
  for (const call of toolCalls) {
    const result = await this.executeTool(call, tools, options);
    totalToolCalls++;

    // 4️⃣ 将结果添加到上下文
    context.addMessage(createToolMessage(call.name, result.output));
  }

  // 5️⃣ 循环继续（LLM 会看到工具结果，继续思考）
}
```

**工具调用流程**：

```
Round 1:
  LLM 思考 → "我需要先查看现有代码"
  → 工具调用: read_file("backend/auth/")
  → 执行工具 → 返回: [文件内容]
  → 添加到上下文

Round 2:
  LLM 思考（看到文件内容）→ "我需要添加JWT函数"
  → 工具调用: edit_file("backend/auth/jwt.js", content)
  → 执行工具 → 返回: "文件已修改"
  → 添加到上下文

Round 3:
  LLM 思考（看到修改成功）→ "我需要运行测试"
  → 工具调用: bash("npm test")
  → 执行工具 → 返回: "测试通过"
  → 添加到上下文

Round 4:
  LLM 思考 → "任务完成"
  → 无工具调用
  → 循环结束
```

#### 工具类型

| 类型         | 用途      | Tachikoma 工具                         |
| ------------ | --------- | -------------------------------------- |
| **文件操作** | 读写文件  | `read_file`, `edit_file`, `write_file` |
| **命令执行** | 运行命令  | `bash`, `shell_run`                    |
| **代码分析** | 理解代码  | `grep`, `list_files`                   |
| **外部服务** | API调用   | MCP 工具                               |
| **协作工具** | Agent通信 | `peer_assist`                          |

#### 设计要点

```
✓ 工具定义清晰（名称、描述、参数Schema）
✓ 工具结果结构化（便于解析）
✓ 限制工具调用次数（避免无限循环）
✓ 工具调用去重（防止重复失败）
✗ 避免工具过多（建议 ≤ 20个）
✗ 避免工具职责重叠
```

---

### Planning - 规划模式

#### 核心概念

**定义**：Agent 根据目标和约束，动态生成执行步骤序列的能力。

```
对比:
Prompt Chaining: 人类定义流程 → AI 执行固定步骤
Planning:        人类定义目标 → AI 决定如何实现
```

#### AI 的决策空间

```
输入抽象程度越高 → AI 的规划自由度越大

【Level 1】具体步骤（最小自由度）
输入: "第1步读取文件，第2步修改代码，第3步测试"
AI: 只需按步骤执行

【Level 2】目标 + 约束（中等自由度）
输入: "实现JWT token生成，使用jsonwebtoken库"
AI: 决定具体步骤（读哪些文件、怎么修改、如何测试）

【Level 3】抽象目标（最大自由度）
输入: "实现用户认证"
AI: 决定技术方案（JWT? Session? OAuth?）+ 具体步骤
```

#### Tachikoma 中的应用

**核心组件：Planner**

**代码位置**: `packages/core/src/planner/planner.ts` (第527-577行)

```typescript
async plan(input: PlannerInput): Promise<PlanResult> {
  const { task, availableTools, contextConstraints, maxSubtasks } = input;

  // 构建规划请求
  const userPrompt = generatePlanningUserPrompt({
    objective: task.objective,      // ← 用户目标（抽象）
    constraints: task.constraints,  // ← 约束条件
    availableTools,                 // ← 可用工具
    maxSubtasks,
  });

  const request: LLMRequest = {
    systemPrompt: PLANNING_SYSTEM_PROMPT,  // ← "你是任务规划专家..."
    messages: [{ role: 'user', content: userPrompt }],
  };

  // Planner LLM 自主决策如何分解任务
  const response = await this.llmClient.complete(request);

  // 返回: subtasks[], executionPlan, roles[]
  return plannerOutput;
}
```

**Planning 的层次**：

```
【高层次规划】Orchestrator's Planner
输入: "实现用户认证系统"
输出:
  ├─ subtask 1.1: "设计认证API"
  ├─ subtask 1.2: "实现JWT生成"
  ├─ subtask 1.3: "实现密码加密"
  └─ executionPlan: 顺序或并行策略

【低层次规划】Worker 内部
输入: "实现JWT生成"
输出:
  ├─ 步骤1: 读取现有代码
  ├─ 步骤2: 安装 jsonwebtoken
  ├─ 步骤3: 编写 JWT 工具函数
  └─ 步骤4: 编写单元测试

两层规划都是 AI 自主决策！
```

#### 动态重新规划

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第666行)

```typescript
// 验证失败超过最大尝试次数
throw new ReplanNeededError(subtaskId, failureMessage, errorSummary);

// Orchestrator 捕获后触发重新规划
// 调用 Planner 生成新的 executionPlan
```

```
【场景】动态重新规划

初始计划:
1.1: 使用 Express 实现 API
1.2: 使用 JWT 认证

执行 1.1:
  ↓ Worker 执行
  ↓ 发现: Express 未安装，npm install 失败（权限问题）
  ↓ Verification Gate: 构建失败
  ↓ 修复尝试: 3次都失败
  ↓ throw ReplanNeededError

重新规划:
Planner 输入:
  ├─ 原目标: "实现 API"
  ├─ 错误信息: "npm install 失败，权限不足"
  └─ 约束: "不能安装新依赖"

Planner 输出（新计划）:
1.1': 使用 Node.js 内置 http 模块实现 API（无需安装）
1.2': 使用简单的 Base64 编码替代 JWT（无需安装）

重新执行新计划...
```

#### 设计要点

```
✓ 给 AI 足够的决策空间
✓ 提供清晰的约束和目标
✓ 支持动态调整（重新规划）
✓ 记录规划决策（decisions.jsonl）
✗ 避免过度抽象（AI 无法理解）
✗ 避免约束矛盾
```

---

### Multi-Agent Collaboration - 多智能体协作

#### 核心概念

**定义**：通过多个专业化 Agent 协作，以专业分工和协同方式解决复杂任务。

#### 协作形式（6种）

```
1️⃣ Sequential（顺序接力）
   Agent A → Agent B → Agent C

2️⃣ Parallel（并行处理）
   Agent A ┐
   Agent B ├→ 汇总
   Agent C ┘

3️⃣ Routing（路由分发）
           ┌→ Agent A
   Router ─┼→ Agent B
           └→ Agent C

4️⃣ Hierarchical（层次结构）
   Manager
   ├→ Worker A
   ├→ Worker B
   └→ Worker C

5️⃣ Debate（对等辩论）
   Agent A ⇄ Agent B
   (平等关系，共创方案)

6️⃣ Critic-Reviewer（评审）
   Creator → Reviewer
   (非对等，质量把关)
```

#### Tachikoma 的协作架构

```
【层次结构】Hierarchical + Critic-Reviewer

Orchestrator（统筹者）
├─ Planner（内部组件 - 规划）
│
├─ Worker 1（backend-dev）
├─ Worker 2（frontend-dev）
└─ Worker 3（tester）
│
└─ Verification Gate（评审者）

协作流程:
1. Orchestrator 调用 Planner 生成计划
2. Orchestrator 分配任务给 Workers（并行或顺序）
3. Workers 执行并返回结果
4. Verification Gate 评审结果
5. 决定通过、修复或重新规划
```

**代码支撑**：

```
【角色定义】
代码: orchestrator/types.ts 第89-100行

interface PlannerRole {
  id: "backend-dev",
  name: "后端开发",
  responsibilities: "实现后端API和数据库操作",
  capabilities: ["nodejs", "express", "mongodb"]
}

【角色分配】
代码: planner/planner.ts

Planner 分析任务 → 分配角色:
├─ subtask 1.1 → roleId: "backend-dev"
├─ subtask 1.2 → roleId: "frontend-dev"
└─ subtask 1.3 → roleId: "tester"

【Worker 创建】
代码: orchestrator/workers-manager.ts

根据 roleId 创建或复用 Worker:
await this.workers.findOrCreateWorkerForRole(roleId);
```

#### 多智能体的优势

```
【模块化】
├─ 每个 Worker 专注一个领域
├─ 工具集合更精简
└─ 知识库更专业

【可扩展】
├─ 添加新角色: 定义新的 role 配置
├─ 移除角色: 不影响其他 Workers
└─ 动态调整: 根据任务需求增减 Workers

【鲁棒性】
├─ 故障隔离: 一个 Worker 失败不影响其他
├─ 认知鲁棒性: 多个视角避免自我确认偏差
└─ 优雅降级: Worker 不可用时可以重新分配
```

#### 设计要点

```
✓ 清晰的角色划分（按领域专业化）
✓ 明确的通信协议（共享文件系统）
✓ 避免自我确认偏差（分离执行和评审）
✓ 支持动态团队组建（根据任务特征）
✗ 避免角色职责重叠
✗ 避免过度分工（通信成本）
```

---

### Memory Management - 记忆管理

#### 核心概念

**定义**：Agent 保留和利用历史信息的能力，维持上下文、学习和个性化。

#### 记忆的四个层次

```
1️⃣ Session（会话）
   ├─ 定义: 单次对话线程的完整记录
   ├─ 类比: 流水账记事本
   ├─ 范围: 单次会话的所有消息
   └─ Tachikoma: conversation/session.json

2️⃣ Short-Term Memory（短期记忆）
   ├─ 定义: LLM 上下文窗口内的记忆
   ├─ 类比: 滑动窗口
   ├─ 范围: 最近 N 条消息（受窗口限制）
   └─ Tachikoma: messages[] 数组（API调用时传递）

3️⃣ State（状态）
   ├─ 定义: 当前会话的临时变量
   ├─ 类比: 临时便签
   ├─ 范围: 重要的中间信息（任务ID、进度等）
   └─ Tachikoma: session.variables, progress.json

4️⃣ Long-Term Memory（长期记忆）
   ├─ 定义: 跨会话的持久化知识
   ├─ 类比: 精华笔记本
   ├─ 范围: 用户偏好、经验教训、方法论
   └─ Tachikoma: MemoryService + 向量数据库
```

#### 长期记忆的三种类型（What-Why-How）

```
【Semantic Memory】（语义记忆 - What）
├─ 内容: 事实、概念、通用知识
├─ 示例: "JWT 的默认算法是 HS256"
└─ 框架: 回答 "是什么"

【Episodic Memory】（情景记忆 - Why）
├─ 内容: 具体事件、经历、因果关系
├─ 示例: "2024年1月的项目中，因为忘记设置token过期时间导致安全漏洞"
└─ 框架: 回答 "为什么"

【Procedural Memory】（程序记忆 - How）
├─ 内容: 技能、方法、流程
├─ 示例: "生成JWT token的步骤: 1) 准备payload 2) 签名 3) 返回token"
└─ 框架: 回答 "怎么做"
```

#### Tachikoma 中的应用

**1. 短期记忆：LLM Context**

**代码位置**: `packages/core/src/worker/backends/generic-agent-backend.ts` (第596-604行)

```typescript
const request: LLMRequest = {
  systemPrompt: effectiveSystemPrompt,
  messages: contextToLLMMessages(context.getContext()), // ← 短期记忆
  tools: nativeToolSet
};
```

**2. 状态管理：Session Variables**

**代码位置**: `packages/core/src/conversation/types.ts` (第84-116行)

```typescript
export interface SessionState {
  sessionId: string;
  messages: ConversationMessage[];  // ← 会话记录
  currentPlan?: {...};              // ← 当前计划（临时状态）
  completedSubtasks: string[];      // ← 完成任务（状态）
  pendingSubtasks: string[];        // ← 待执行任务（状态）
  checkpoints: Checkpoint[];        // ← 检查点（状态快照）
  variables: Record<string, unknown>;  // ← 自定义状态变量
}
```

**3. 长期记忆：MemoryService**

**代码位置**: `packages/core/src/memory/memory-service.ts`

```typescript
class MemoryService {
  // 保存记忆（带语义向量）
  async save(entry: {
    content: string;
    scope: 'semantic' | 'episodic' | 'procedural';  // ← 三种类型
    metadata: {...}
  }): Promise<void>

  // 检索记忆（语义搜索）
  async retrieve(query: string, topK: number): Promise<Memory[]>
}
```

**应用示例**：

```
【保存到长期记忆】

代码: worker/backends/base-backend.ts (第109-130行)

await memoryManager.save(
  taskObjective: "实现JWT token生成",
  result: "成功实现，使用了 jsonwebtoken 库，设置24小时过期",
  metadata: {
    type: 'task_result',     // ← Procedural Memory
    backend: 'generic',
    success: true
  }
);

【从长期记忆检索】

代码: worker/backends/generic-agent-backend.ts (第564-577行)

// 自动检索相关记忆
await this.memoryRetriever.retrieve({
  getContext: () => context.getContext(),
  injectRetrievedMemories: (memories) => {
    context.injectRetrievedMemories(memories);
    // 注入到上下文: "之前类似任务的经验..."
  }
});
```

**4. 失败记忆系统**

**代码位置**: `packages/core/src/worker/failure-memory.ts`

```typescript
class FailureMemory {
  // 记录失败模式
  recordFailure(tool: string, input: unknown, error: string): void;

  // 生成警告（注入到 System Prompt）
  generateWarnings(): string {
    return `
【Previous Failures - Learn from these mistakes】
- Avoid calling npm install without sudo (failed 3 times)
- Remember to check file permissions before editing
- Token expiration must be set explicitly
    `;
  }
}
```

#### 记忆管理策略

```
【短期记忆管理】
问题: 上下文窗口有限
策略:
├─ 压缩历史（保留摘要）
├─ 滑动窗口（保留最近N条）
└─ 关键信息优先（重要消息不删除）

【长期记忆管理】
问题: 检索效率
策略:
├─ 向量化（语义搜索）
├─ 分类存储（semantic/episodic/procedural）
└─ 定期清理（删除过时记忆）

【状态管理】
问题: 跨任务污染
策略:
├─ 任务级隔离（每个任务独立状态）
├─ 会话级共享（全局变量）
└─ 及时清理（任务完成后重置）
```

#### 设计要点

```
✓ 区分短期和长期记忆的用途
✓ 使用向量数据库存储长期记忆
✓ 自动检索相关记忆（不要手动）
✓ 记录失败经验（Failure Memory）
✗ 避免记忆过载（选择性存储）
✗ 避免跨任务状态污染
```

---

### Goal Setting and Monitoring - 目标设置与监控

#### 核心概念

**定义**：给 Agent 明确的目标和追踪进度的手段。

#### 需求 vs 目标

```
【需求】（Needs）
├─ 用户想要什么
├─ 通常模糊、抽象
└─ 示例: "我想要一个登录功能"

【目标】（Goals）
├─ 具体的可达成状态
├─ 包含成功标准
└─ 示例: "实现登录API，支持JWT认证，通过单元测试"
```

#### SMART 目标原则

```
S - Specific（具体的）
  ✓ "实现JWT token生成功能"
  ✗ "改进认证系统"

M - Measurable（可度量的）
  ✓ "通过所有单元测试"
  ✗ "代码质量好"

A - Achievable（可达成的）
  ✓ "添加一个登录接口"
  ✗ "重写整个后端架构"（对单个子任务）

R - Relevant（相关的）
  ✓ 子任务目标与父任务目标相关

T - Time-bound（有时限的）
  ✓ estimatedDuration: 300000 (5分钟)
```

#### Tachikoma 中的应用

**1. 目标设定**

**代码位置**: `packages/core/src/orchestrator/types.ts` (第44-86行)

```typescript
export interface SubTask {
  id: string;
  objective: string; // ← 明确的目标
  parentObjective?: string; // ← 父目标（上下文）
  constraints: string[]; // ← 约束条件（成功标准）
  dependencies?: string[]; // ← 依赖关系
  estimatedDuration?: number; // ← 预估时间
  outputSchema?: JSONSchema; // ← 期望输出格式
}
```

**2. 进度监控**

**代码位置**: `packages/core/src/orchestrator/session/types/runtime.ts` (第70-100行)

```typescript
export interface ProgressFile {
  sessionId: string;
  taskId: string;
  status: 'planning' | 'executing' | 'paused' | 'completed' | 'failed';
  currentStep: number; // ← 当前步骤
  totalSteps: number; // ← 总步骤数
  completedSubtasks: string[]; // ← 已完成
  failedSubtasks: string[]; // ← 失败的
  runningSubtasks: string[]; // ← 进行中
  startTime: number;
  lastUpdateTime: number;
  progress: number; // ← 进度百分比
}
```

**3. 状态监控**

**代码位置**: `packages/core/src/orchestrator/session/types/worker.ts`

```typescript
export interface WorkerStatusFile {
  workerId: string;
  status: 'idle' | 'thinking' | 'acting' | 'waiting' | 'error';
  progress: number; // ← 0-100
  currentSubtask?: {
    id: string;
    objective: string;
    startedAt: number;
  };
  lastHeartbeat: number; // ← 心跳检测
  error?: {
    code: string;
    message: string;
    timestamp: number;
  };
}
```

**4. 监控机制**

```
【两个维度的监控】

运行状态监控:
├─ Worker 状态（idle/thinking/acting）
├─ 任务进度（currentStep/totalSteps）
├─ 心跳检测（lastHeartbeat）
└─ 文件: workers/worker-001/status.json

运行质量监控:
├─ 验证结果（Verification Gate）
├─ 工具调用成功率
├─ Token 使用量
└─ 文件: decisions.jsonl, actions.jsonl
```

**监控流程**：

```
ExecutionLoop 监控流程:
├─ 开始执行 → 写入 progress.json (status: 'executing')
├─ 每个子任务:
│  ├─ 开始 → 更新 progress.currentStep
│  ├─ 完成 → 添加到 completedSubtasks[]
│  └─ 失败 → 添加到 failedSubtasks[]
├─ Worker 心跳:
│  ├─ 每30秒更新 lastHeartbeat
│  └─ 超时检测（Worker 可能卡住）
└─ 全部完成 → progress.json (status: 'completed')
```

#### 设计要点

```
✓ 目标要有明确的成功标准（不是主观判断）
✓ 实时更新进度（不要等到最后）
✓ 多维度监控（状态 + 质量）
✓ 异常检测（心跳超时、工具失败）
✗ 避免过度监控（性能开销）
✗ 避免主观目标（"做得好" → 具体标准）
```

---

### Evaluation and Monitoring - 评估与监控

#### 核心概念

**定义**：系统性地评估 Agent 性能，从多个维度分析执行质量。

#### 评估的三个维度

```
【维度1】成本评估（Cost）
├─ Token 使用量
│  ├─ Input tokens
│  └─ Output tokens
├─ 执行时间
│  ├─ 总耗时
│  └─ 各阶段耗时
└─ 资源消耗
   ├─ CPU使用率
   └─ 内存使用量

【维度2】质量评估（Quality）
├─ 目标达成度
│  ├─ 任务是否完成
│  └─ 输出是否符合要求
├─ 验证结果
│  ├─ 类型检查
│  ├─ 构建检查
│  └─ 测试检查
└─ 主观质量（LLM-as-a-Judge）
   ├─ 代码质量
   └─ 文档完整性

【维度3】轨迹评估（Trajectory）
├─ 工具调用序列
│  ├─ 是否高效
│  └─ 是否有冗余
├─ 思考路径
│  ├─ 是否合理
│  └─ 是否有死循环
└─ 错误和重试
   ├─ 失败率
   └─ 修复策略
```

#### Tachikoma 中的应用

**1. 成本评估**

**代码位置**: `packages/core/src/worker/worker-executor.ts` (第347-525行)

```typescript
// 指标收集
const startTime = Date.now();
let toolCallCount = 0;
let thinkingRounds = 0;
let tokensUsed = 0;

for await (const msg of this.backend.execute(workerTask, tools, execOptions)) {
  switch (msg.type) {
    case 'thinking':
      thinkingRounds++;
      this.metrics.increment(WORKER_METRICS.THINKING_ROUNDS, 1, { workerId });
      break;
    case 'tool_call':
      toolCallCount++;
      break;
    case 'status':
      if (typeof msg.tokensUsed === 'number') {
        tokensUsed = msg.tokensUsed;
        this.metrics.gauge(WORKER_METRICS.TOKENS_USED, tokensUsed, { workerId });
      }
      break;
  }
}

const duration = Date.now() - startTime;
this.metrics.timing(WORKER_METRICS.EXECUTION_DURATION, duration, { workerId });
```

**2. 质量评估：Verification Gate**

**代码位置**: `packages/core/src/orchestrator/services/verification-gate.ts`

```typescript
export interface VerificationResult {
  passed: boolean; // ← 总体是否通过
  summary: string; // ← 摘要信息
  layers: VerificationLayerResult[]; // ← 各层结果
  totalDuration: number; // ← 总耗时
}

export interface VerificationLayerResult {
  layer: 'deps' | 'type' | 'build' | 'test' | 'lint' | 'e2e' | 'smoke';
  passed: boolean;
  errors: string[]; // ← 具体错误
  warnings: string[]; // ← 警告信息
  command?: string; // ← 验证命令
  duration: number; // ← 该层耗时
}
```

**3. 轨迹评估**

**代码位置**: `packages/core/src/orchestrator/session/types/worker.ts`

```typescript
// Worker 的思考记录
export interface ThinkingRecord {
  workerId: string;
  subtaskId: string;
  taskId: string;
  round: number; // ← 第几轮思考
  content: string; // ← 思考内容
  timestamp: number;
}

// Worker 的动作记录
export interface ActionRecord {
  workerId: string;
  subtaskId: string;
  taskId: string;
  actionId: string;
  description: string;
  tool: string; // ← 调用的工具
  input: unknown; // ← 工具输入
  output?: unknown; // ← 工具输出
  success: boolean; // ← 是否成功
  duration: number; // ← 执行耗时
  timestamp: number;
}
```

**保存轨迹**：

**代码位置**: `packages/core/src/worker/worker-executor.ts` (第461-464行)

```typescript
// 持久化消息到审计日志
if (sessionManager) {
  await this.persistMessage(sessionManager, workerId, subtask.id, msg);
}

// 写入: workers/worker-001/thinking.jsonl
// 写入: workers/worker-001/actions.jsonl
```

#### 评估 vs 反思

```
【Reflection】（第4章 - 战术级改进）
├─ 时机: 执行过程中，实时
├─ 目的: 修复当前任务的问题
├─ 方法: Verification Gate + 修复循环
└─ 示例: "类型错误 → 修复 → 重新验证"

【Evaluation】（第19章 - 战略级改进）
├─ 时机: 任务完成后，离线
├─ 目的: 优化系统整体性能
├─ 方法: 分析轨迹、统计指标、优化模型
└─ 示例: "发现某类任务平均需要5轮思考 → 优化 prompt"
```

#### 设计要点

```
✓ 多维度评估（成本、质量、轨迹）
✓ 客观指标优先（工具验证 > 主观判断）
✓ 记录完整轨迹（便于离线分析）
✓ 区分战术改进和战略改进
✗ 避免过度评估（影响性能）
✗ 避免只看结果不看过程
```

---

### Resource-Aware Optimization - 资源感知优化

#### 核心概念

**定义**：动态监控和管理计算、时间、成本资源，在质量、成本、速度间权衡。

```
核心权衡:
质量 ⚖️ 成本 ⚖️ 速度

高质量 = 高成本 + 慢速度
低成本 = 低质量 或 慢速度
高速度 = 低质量 或 高成本
```

#### 优化技术

```
【技术1】动态模型切换
├─ 简单任务 → 快速便宜的模型（gpt-4o-mini）
├─ 复杂任务 → 强大昂贵的模型（claude-3.5-sonnet）
└─ 根据任务复杂度自动选择

【技术2】Router Agent（复杂度分类）
├─ 分析任务特征
├─ 评估复杂度（simple/moderate/complex）
└─ 路由到合适的模型

【技术3】Critique Agent（质量评估）
├─ 评估输出质量
├─ 不满意 → 重试更强大的模型
└─ 满意 → 记录路由策略（学习）

【技术4】Fallback 机制
├─ 主模型不可用 → 切换到备用模型
├─ API 限流 → 等待或切换
└─ 成本超限 → 降级到便宜模型
```

#### Tachikoma 中的应用

**1. 角色级模型配置**

**代码位置**: Planner 可以为每个角色分配不同的模型

```typescript
roles: [
  {
    id: 'planner',
    capabilities: ['planning'],
    backend: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022' // ← 强大模型做规划
    }
  },
  {
    id: 'worker',
    capabilities: ['coding'],
    backend: {
      provider: 'openai',
      model: 'gpt-4o-mini' // ← 便宜模型做执行
    }
  },
  {
    id: 'reviewer',
    capabilities: ['review'],
    backend: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022' // ← 强大模型做审查
    }
  }
];
```

**2. Token 使用监控**

**代码位置**: Worker 执行时收集 Token 使用量

```typescript
// 每次 LLM 调用后记录
totalTokens.input += response.usage.inputTokens;
totalTokens.output += response.usage.outputTokens;

// 发出 status 消息
yield {
  type: 'status',
  tokensUsed: totalTokens.input + totalTokens.output
};
```

**3. 超时和资源限制**

**代码位置**: `packages/core/src/worker/types.ts` (第84-94行)

```typescript
export const DEFAULT_RESOURCE_LIMITS = {
  maxThinkingRounds: 20, // ← 最大思考轮次
  maxToolCalls: 50, // ← 最大工具调用次数
  maxTokensPerRound: 4096, // ← 每轮最大 Token
  maxTotalTokens: 100000, // ← 总 Token 上限
  timeoutMs: 300000 // ← 超时时间（5分钟）
};
```

#### 资源监控流程

```
任务开始
    ↓
ExecutionLoop 设置资源限制
    ├─ timeout = 300000ms (5分钟)
    ├─ maxThinkingRounds = 20
    └─ retryPolicy = { maxAttempts: 3 }
    ↓
Worker 执行（监控资源使用）
    ├─ 每轮思考: round++
    ├─ 每次工具调用: toolCallCount++
    ├─ 每次 LLM 调用: tokensUsed += tokens
    └─ 检查是否超限
    ↓
超限处理:
├─ 超时 → abort 信号 → Worker 中断
├─ 轮次超限 → 强制结束
└─ Token 超限 → 压缩上下文或降级模型
```

#### 设计要点

```
✓ 设置合理的资源上限
✓ 监控资源使用情况
✓ 支持动态模型切换
✓ 提供 fallback 机制
✗ 避免资源无限制（防止失控）
✗ 避免过度优化（增加复杂度）
```

---

### Exception Handling - 异常处理

#### 核心概念

**定义**：管理异常情况、错误和故障，确保系统鲁棒性。

#### 三个阶段

```
【阶段1】错误检测（Detection）
├─ Worker 执行失败
├─ 工具调用失败
├─ 验证不通过
└─ 超时、资源耗尽

【阶段2】错误处理（Handling）
├─ 记录日志
├─ 重试机制
├─ 降级策略
└─ 通知机制

【阶段3】恢复（Recovery）
├─ 状态回滚
├─ 重新规划
├─ 人工干预
└─ 优雅降级
```

#### Tachikoma 中的应用

**1. 错误检测**

```
【检测层1】Worker 状态检查
代码: execution-loop.ts 第621-625行

if (result.status !== 'success') {
  throw new Error(errMsg);
}

【检测层2】关键工具失败检查
代码: execution-loop.ts 第627-638行

const criticalFailures = checkCriticalToolFailures(result);
if (criticalFailures.length > 0) {
  throw new ReplanNeededError(...);
}

【检测层3】Verification Gate
代码: execution-loop.ts 第640-720行

const verifyResult = await verificationGateService.verify(...);
if (!verifyResult.passed) {
  // 进入修复流程
}
```

**2. 错误处理**

**重试机制**：

**代码位置**: `packages/core/src/orchestrator/runner/execution-loop.ts` (第493-555行)

```typescript
let retryCount = 0;
let lastError: string | undefined;

while (true) {
  try {
    // 尝试执行
    const assignment = await this.workerPool.assign(subtask, timeout, retryPolicy, ...);

    if (!assignment.success) {
      lastError = assignment.error;

      // 判断是否应该重试
      if (shouldRetry(retryPolicy, retryCount)) {
        retryCount++;
        this.emit('subtask:retrying', taskId, { retryCount, error: lastError });

        // 指数退避
        await this.sleep(calculateRetryDelay(retryPolicy, retryCount), signal);
        continue;  // 重试
      }

      throw new Error(lastError);  // 超过最大重试次数
    }

    // 执行成功
    break;
  } catch (error) {
    // 错误处理
  }
}
```

**Fallback 策略**：

```
【修复策略层次】

Level 1: 自动工具修复
├─ eslint --fix（自动格式化）
├─ prettier --write（代码美化）
└─ 成本: 低，速度: 快

Level 2: LLM 修复任务
├─ 创建修复任务
├─ Worker 执行修复
└─ 成本: 中，速度: 中

Level 3: 重新规划
├─ Planner 生成新计划
├─ 可能改变技术方案
└─ 成本: 高，速度: 慢

Level 4: 人工干预
├─ 写入 intervention.json
├─ Orchestrator 读取并应用
└─ 成本: 最高，速度: 最慢
```

**3. 恢复机制**

**检查点系统**：

```
每个关键节点保存检查点:
├─ 任务开始
├─ 每个子任务完成
├─ 验证通过
└─ 重新规划后

恢复流程:
失败 → 选择检查点 → 恢复状态 → 重新执行
```

#### 多层容错

```
┌────────────────────────────────────────┐
│ 多层容错机制                            │
├────────────────────────────────────────┤
│                                        │
│ Layer 1: Worker 内部重试               │
│ ├─ LLM API 失败 → 重试 3 次            │
│ └─ 工具调用失败 → 记录并继续           │
│                                        │
│ Layer 2: Orchestrator 重试             │
│ ├─ Worker 分配失败 → 重新分配          │
│ └─ 子任务失败 → 重试或跳过             │
│                                        │
│ Layer 3: 修复循环                      │
│ ├─ 验证失败 → 自动修复                 │
│ ├─ 还失败 → LLM 修复                   │
│ └─ 还失败 → 重新规划                   │
│                                        │
│ Layer 4: 检查点恢复                    │
│ ├─ 系统崩溃 → 从检查点恢复             │
│ └─ 用户中断 → /retry 从检查点继续      │
│                                        │
│ Layer 5: 人工干预                      │
│ └─ 写入 intervention.json → 强制修正   │
│                                        │
└────────────────────────────────────────┘
```

#### 设计要点

```
✓ 多层容错机制（不依赖单一层）
✓ 明确的重试策略（次数、间隔、条件）
✓ 优雅降级（部分失败不影响整体）
✓ 完整的错误日志（便于诊断）
✗ 避免无限重试（设置上限）
✗ 避免掩盖错误（记录所有异常）
```

---

### Human-in-the-Loop - 人机协作

#### 核心概念

**定义**：将人类判断和洞察整合到 AI 工作流中，形成人机协同系统。

#### 人类参与的三个层次

```
【层次1】环境准备（Pre-Execution）
├─ 提供需求和目标
├─ 配置工具和知识库
├─ 定义规则和约束
└─ 时机: 执行前

【层次2】执行反馈（During-Execution）
├─ 实时审批（approval）
├─ 干预指令（intervention）
├─ 信息提供（clarification）
└─ 时机: 执行中

【层次3】会话反馈（Post-Execution）
├─ 结果评估
├─ 偏好反馈
├─ 经验记录
└─ 时机: 执行后
```

#### 监督的两个维度

```
【维度1】运行状况监督
├─ 任务进度（currentStep/totalSteps）
├─ Worker 状态（idle/thinking/acting）
├─ 资源使用（tokens, duration）
└─ 心跳检测（lastHeartbeat）

【维度2】运行质量监督
├─ 验证结果（Verification Gate）
├─ 工具调用质量（成功率、错误模式）
├─ 输出质量（是否符合要求）
└─ 最终结果审查
```

#### Tachikoma 中的应用

**1. 关键决策审批**

**代码位置**: `packages/core/src/orchestrator/session/types/worker.ts`

```typescript
export interface PendingApprovalFile {
  requestId: string;
  workerId: string;
  subtaskId: string;
  type: 'key_decision' | 'high_risk' | 'unknown_tool';
  description: string; // ← 需要审批的原因
  details: {
    action: string; // ← 工具名称
    input: unknown; // ← 工具参数
    estimatedRisk?: string;
  };
  requestedAt: number;
  timeout: number;
  defaultDecision: 'approve' | 'reject';
}

export interface ApprovalResponseFile {
  requestId: string;
  approved: boolean; // ← 人类的决策
  reason?: string;
  respondedAt: number;
}
```

**审批流程**：

```
Worker 准备执行关键操作
    ↓
判断: 是否需要审批？
    ├─ 删除文件 → 是
    ├─ 修改配置 → 是
    └─ 读取文件 → 否
    ↓
写入: workers/worker-001/pending_approval.json
    ↓
Worker 暂停，等待响应
    ↓
Orchestrator 监听文件变化
    ↓ 检测到 pending_approval.json
发出事件: 'pending_approval_created'
    ↓
UI 展示审批请求
    ↓
人类做决策: 批准 / 拒绝
    ↓
写入: workers/worker-001/approval_response.json
    ↓
Worker 读取响应
    ├─ 批准 → 执行工具
    └─ 拒绝 → 跳过或修改方案
```

**2. 干预机制**

**代码位置**: `packages/core/src/orchestrator/session/types/worker.ts`

```typescript
export interface InterventionFile {
  workerId: string;
  command: 'pause' | 'resume' | 'abort' | 'redirect';
  reason: string;
  instructions?: string; // ← 人类的具体指示
  createdAt: number;
  acknowledged?: boolean;
}
```

**干预流程**：

```
Worker 执行过程中
    ↓
人类发现问题（通过监控）
    ↓
写入: workers/worker-001/intervention.json
{
  command: "redirect",
  instructions: "不要使用 Express，改用 Fastify"
}
    ↓
Worker 每轮开始前检查 intervention
    ↓
读取到 intervention
    ↓
应用指令:
├─ pause → 暂停执行
├─ abort → 中止任务
└─ redirect → 修改方案
    ↓
确认: 写入 acknowledged = true
```

**3. 监控界面**

```
【监控内容】

实时状态:
├─ 读取: workers/worker-001/status.json
├─ 显示: "Worker-001 正在执行 subtask 1.2 (思考中)"
└─ 进度: 45%

执行轨迹:
├─ 读取: workers/worker-001/thinking.jsonl
├─ 显示: 最近5轮思考内容
└─ 读取: workers/worker-001/actions.jsonl
    显示: 工具调用列表

质量指标:
├─ 读取: orchestrator/progress.json
└─ 显示: 完成3/5个子任务，2个失败
```

#### 设计要点

```
✓ 关键操作需要审批（删除、部署等）
✓ 提供实时监控界面
✓ 支持紧急干预
✓ 记录人类决策（便于学习）
✗ 避免过度审批（影响效率）
✗ 避免监控过载（信息过多）
```

---

### Context Engineering - 上下文工程

#### 核心概念

**定义**：系统性地设计、构建和传递完整的信息环境给 AI 模型，是 Prompt Engineering 的升级版。

```
Prompt Engineering（提示词工程）
├─ 关注: 如何写好一个 prompt
└─ 范围: 单次交互

Context Engineering（上下文工程）
├─ 关注: 如何构建完整的信息环境
└─ 范围: 多轮交互 + 多模态信息
```

#### 上下文的六个维度

```
1️⃣ Task Context（任务上下文）
   ├─ 任务目标（objective）
   ├─ 约束条件（constraints）
   ├─ 父任务目标（parentObjective）
   └─ 输出格式（outputSchema）

2️⃣ Tool Context（工具上下文）
   ├─ 可用工具列表
   ├─ 工具描述和Schema
   └─ 工具使用示例

3️⃣ Project Context（项目上下文）
   ├─ 项目结构
   ├─ 技术栈
   ├─ 代码规范
   └─ 文件: TACHIKOMA.md, AGENTS.md

4️⃣ Identity Context（身份上下文）
   ├─ Agent ID
   ├─ 角色定义（roleId）
   ├─ 能力标签（capabilities）
   └─ Persona（个性化描述）

5️⃣ Memory Context（记忆上下文）
   ├─ 相关的历史任务
   ├─ 失败经验教训
   └─ 用户偏好

6️⃣ Skill Context（技能上下文）
   ├─ 激活的技能
   ├─ 技能使用示例
   └─ 领域知识
```

#### Tachikoma 中的上下文分层

```
【System Prompt】（隐式上下文）
├─ Identity Context
│  └─ "你是 Agent-001, backend-dev 角色..."
├─ Project Context
│  └─ "[TACHIKOMA.md 内容]"
├─ Skill Context
│  └─ "激活的技能: jwt_utils, bcrypt..."
└─ Memory Context
   └─ "相关记忆: 上次忘记设置过期时间..."

【User Prompt】（显式任务）
├─ Task Context
│  ├─ "Task: 实现JWT token生成"
│  └─ "Constraints: 使用jsonwebtoken库..."
└─ Tool Context
   └─ "Available tools: bash, edit_file..."

【Message History】（对话历史）
├─ 用户消息
├─ Assistant 回复
└─ 工具调用结果
```

**代码实现**：

**代码位置**: `packages/core/src/worker/backends/generic-agent-backend.ts` (第450-509行)

```typescript
// 1. 注入项目上下文
const projectMessage = await skillsManager.injectProjectContext([], workDir);
context.addMessage(projectMessage);

// 2. 构建任务 Prompt
const taskPrompt = buildTaskPrompt(task, tools, options);
context.addMessage(createUserMessage(taskPrompt));

// 3. 注入 Identity
const identityContext = await updater.getCoreMemoryForPrompt(agentId);
const baseSystemPrompt = buildWorkerSystemPrompt({ identityContext, ... });

// 4. 注入 Skills（使用 parentObjective + objective）
const systemPromptWithSkills = await skillsManager.renderSystemPromptSection(
  baseSystemPrompt,
  task.objective,
  { autoActivate: true, parentObjective: task.parentObjective }
);

// 5. 注入失败记忆
let effectiveSystemPrompt = systemPromptWithSkills;
if (failureMemory) {
  const warnings = failureMemory.generateWarnings();
  effectiveSystemPrompt = `${systemPromptWithSkills}\n\n${warnings}`;
}

// 6. 调用 LLM（完整上下文）
const response = await llmClient.complete({
  systemPrompt: effectiveSystemPrompt,
  messages: contextToLLMMessages(context.getContext()),
  tools: nativeToolSet
});
```

#### parentObjective 的妙用

**问题**：子任务如何继承父任务的领域知识？

**解决方案**：通过 `parentObjective` 扩展技能匹配上下文

**代码位置**: `packages/core/src/worker/engines/skills-manager.ts` (第191-213行)

```typescript
// 合并父子目标用于技能匹配
const matchContext = [
  options?.parentObjective, // ← "实现用户登录功能"
  taskDescription // ← "实现JWT token生成"
]
  .filter((s) => typeof s === 'string' && s.length > 0)
  .join(' | ');

// matchContext = "实现用户登录功能 | 实现JWT token生成"

// 使用合并上下文激活技能
const { section, activated } = renderSkillsSectionWithActivation(
  this.skills,
  matchContext, // ← 父+子目标合并
  renderOptions
);
```

**效果对比**：

```
【没有 parentObjective】
子任务: "实现JWT token生成"
激活技能:
└─ jwt_token_generation (匹配 "JWT token")

丢失:
✗ bcrypt_password_hashing (需要 "登录" 关键词)
✗ express_auth_middleware (需要 "登录" 关键词)

【有 parentObjective】
合并上下文: "实现用户登录功能 | 实现JWT token生成"
激活技能:
├─ jwt_token_generation (匹配 "JWT token")
├─ bcrypt_password_hashing (匹配 "登录功能") ✓
└─ express_auth_middleware (匹配 "登录功能") ✓

保留了父任务的领域关键词！
```

#### 上下文管理策略

```
【问题】上下文窗口有限

【策略1】上下文压缩
├─ 保留最近 N 条消息
├─ 压缩旧消息为摘要
└─ 关键信息不删除

【策略2】选择性注入
├─ 只注入相关的项目上下文
├─ 只激活匹配的技能
└─ 只检索相关的记忆

【策略3】分层管理
├─ System Prompt: 静态、全局
├─ User Prompt: 动态、任务特定
└─ Message History: 增量、对话历史
```

**代码位置**: `packages/core/src/prompt/engines/context-manager.ts`

```typescript
// 上下文压缩
async manageContext(context: Context): Promise<{success: boolean}> {
  const currentTokens = estimateTokens(context.getContext());

  if (currentTokens > limits.maxTotalTokens * 0.8) {
    // 达到80%阈值，开始压缩
    const compressed = await this.compressOldMessages(context);
    return { success: true };
  }

  return { success: true };
}
```

#### 设计要点

```
✓ 分层管理上下文（System/User/History）
✓ parentObjective 用于扩展匹配范围
✓ 动态注入相关信息（不是全部）
✓ 监控上下文大小（避免超限）
✗ 避免上下文污染（清理过时信息）
✗ 避免信息过载（选择性注入）
```

---

### 设计模式应用总结

#### Tachikoma 的模式组合

```
┌──────────────────────────────────────────────────────┐
│ Tachikoma 如何组合使用这些设计模式                   │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 【任务规划阶段】                                      │
│ ├─ Planning: Planner 动态生成计划                   │
│ ├─ Routing: 根据角色路由到合适的 Worker             │
│ └─ Memory: 检索相关历史经验                         │
│                                                      │
│ 【任务执行阶段】                                      │
│ ├─ Prompt Chaining: 顺序执行子任务                  │
│ ├─ Parallelization: 并行执行独立子任务              │
│ ├─ Tool Use: Worker 的 Agent Loop                   │
│ └─ Context Engineering: 分层上下文管理               │
│                                                      │
│ 【质量保证阶段】                                      │
│ ├─ Reflection: Verification Gate + 修复循环         │
│ ├─ Evaluation: 多维度评估（成本、质量、轨迹）        │
│ └─ Multi-Agent: Producer-Critic 模型                │
│                                                      │
│ 【异常处理阶段】                                      │
│ ├─ Exception Handling: 多层容错机制                 │
│ ├─ Human-in-the-Loop: 审批和干预                    │
│ └─ Resource-Aware: 超时和资源限制                   │
│                                                      │
│ 【监控治理】                                          │
│ ├─ Goal Setting: 目标定义和追踪                     │
│ ├─ Monitoring: 状态和质量监控                       │
│ └─ Memory: 记录经验教训（长期改进）                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 完整的执行流程（应用所有模式）

```
1️⃣ 用户输入
   "实现用户认证系统"
   ↓
   【Goal Setting】定义 SMART 目标

2️⃣ Orchestrator 启动
   ↓
   【Planning】调用 Planner LLM
   ├─ 【Memory】检索相关历史经验
   ├─ 【Context Engineering】构建规划上下文
   └─ 生成计划: subtasks[], roles[], executionPlan
   ↓
   【Routing】根据 roleId 分配任务

3️⃣ Worker 执行
   ├─ 【Parallelization】并行执行独立任务
   │  ├─ Worker 1: subtask 1.1, 1.2 (并行)
   │  └─ Worker 2: subtask 1.3
   │
   ├─ 【Tool Use】Agent Loop
   │  ├─ Round 1: 思考 → read_file → 结果
   │  ├─ Round 2: 思考 → edit_file → 结果
   │  └─ Round 3: 思考 → bash(test) → 结果
   │
   ├─ 【Context Engineering】分层上下文
   │  ├─ System: Identity + Project + Skills + Memory
   │  └─ User: Objective + Constraints + Tools
   │
   └─ 【Human-in-the-Loop】审批机制
      └─ 关键操作 → pending_approval.json → 等待批准

4️⃣ 质量保证
   ├─ 【Reflection】Verification Gate
   │  ├─ 类型检查
   │  ├─ 构建检查
   │  └─ 测试检查
   │
   ├─ 验证失败?
   │  ├─ 【Exception Handling】修复循环
   │  │  ├─ 自动修复 (eslint --fix)
   │  │  └─ LLM 修复任务
   │  └─ 还失败? → 【Planning】重新规划
   │
   └─ 验证通过 → 标记完成

5️⃣ 监控评估
   ├─ 【Monitoring】实时监控
   │  ├─ 运行状况: progress, status, heartbeat
   │  └─ 运行质量: verification, tool success rate
   │
   ├─ 【Evaluation】多维度评估
   │  ├─ 成本: tokens, duration
   │  ├─ 质量: verification passed, goal achieved
   │  └─ 轨迹: thinking rounds, tool calls
   │
   └─ 【Memory】保存经验
      ├─ 成功模式 → Procedural Memory
      ├─ 失败教训 → Failure Memory
      └─ 用于未来任务改进

6️⃣ 资源管理
   ├─ 【Resource-Aware】监控资源使用
   │  ├─ Token 用量
   │  ├─ 执行时间
   │  └─ 工具调用次数
   │
   └─ 超限处理:
      ├─ 压缩上下文
      ├─ 切换便宜模型
      └─ 或中止任务
```

#### 设计模式的组合效应

```
【场景】复杂的多步骤任务

单独使用 Prompt Chaining:
└─ 只能按固定流程执行，无法应对异常

+ Planning:
└─ 可以动态调整步骤，但执行可能不高效

+ Parallelization:
└─ 加速执行，但可能出错

+ Reflection + Verification Gate:
└─ 发现问题并自动修复，但可能修复失败

+ Exception Handling + Replan:
└─ 修复失败后重新规划，但可能重复失败

+ Memory + Failure Memory:
└─ 从历史失败中学习，避免重复错误

+ Human-in-the-Loop:
└─ 关键决策人类把关，确保正确

+ Resource-Aware:
└─ 控制成本，防止资源耗尽

+ Goal Setting + Monitoring:
└─ 明确目标，实时追踪，确保达成

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

结论: 所有模式组合 = 生产级 Agent 系统！
```

#### 开发指导原则

```
【原则1】明确职责分离
├─ Planner: 只规划，不执行
├─ Worker: 只执行，不评估
└─ Orchestrator: 协调、监控、评估

【原则2】使用文件系统解耦
├─ 不要紧耦合的函数调用
├─ 通过文件传递信息
└─ 支持异步、分布式、可恢复

【原则3】分层上下文管理
├─ System Prompt: 静态、全局、隐式
├─ User Prompt: 动态、任务特定、显式
└─ 不要混在一起

【原则4】多层容错机制
├─ 不依赖单一层
├─ 每层有独立的容错策略
└─ 最后有人工干预兜底

【原则5】客观评估优先
├─ 使用工具验证（tsc, test）
├─ 不依赖主观判断
└─ 评估标准要清晰可度量

【原则6】记录所有轨迹
├─ 思考过程（thinking.jsonl）
├─ 工具调用（actions.jsonl）
├─ 决策记录（decisions.jsonl）
└─ 用于离线分析和改进

【原则7】支持人机协作
├─ 关键操作需要审批
├─ 提供监控界面
├─ 支持实时干预
└─ 人类是最后一道防线
```

---

## 设计优势分析

### 1. 分层设计的优势

```
优势：职责分离，灵活组合

Layer 1 (内存通信)
  ↓ 快速路径
  优势：低延迟、高效率
  劣势：无持久化、不可恢复

Layer 2 (文件协调)
  ↓ 可靠路径
  优势：持久化、可恢复、可观测
  劣势：延迟高、文件IO开销

Layer 3 (消息流)
  ↓ 监控路径
  优势：实时、细粒度
  劣势：不持久化

组合使用：
  ✅ 快速路径 + 可靠路径 = 既快又可靠
  ✅ 可以根据场景灵活选择
```

### 2. 文件协调的优势

| 优势         | 说明                                | 示例                                  |
| ------------ | ----------------------------------- | ------------------------------------- |
| **解耦**     | Orchestrator 和 Worker 无需直接通信 | Worker 崩溃不影响 Orchestrator        |
| **持久化**   | 状态持久化到文件系统                | 可以随时恢复                          |
| **可观测**   | 所有交互都有文件记录                | 可以查看完整执行历史                  |
| **可审计**   | 每次审批/干预都有记录               | 满足合规要求                          |
| **易调试**   | 可以直接查看/修改文件               | 手动干预 Worker                       |
| **跨进程**   | 支持分布式部署                      | Orchestrator 和 Worker 可以在不同机器 |
| **人机协作** | 人类可以直接编辑文件                | 手动批准审批请求                      |

### 3. 消息流的优势

| 优势         | 说明                      |
| ------------ | ------------------------- |
| **实时性**   | 立即可见执行过程          |
| **细粒度**   | 每个思考/工具调用都可观测 |
| **流式输出** | 适合前端实时展示          |
| **易调试**   | 可以在任意点暂停观察      |
| **可扩展**   | 容易添加新的消息类型      |

### 4. 混合模式的优势

```
🎯 快速 + 可靠 + 可观测 = 三位一体

快速（内存通信）：
  - 任务分配
  - 结果收集
  - 延迟 <1ms

可靠（文件协调）：
  - 审批流程
  - 干预机制
  - 状态持久化
  - 可恢复

可观测（消息流）：
  - 思考过程
  - 工具调用
  - 实时进度

三者协同：
  ✅ 高性能
  ✅ 高可靠
  ✅ 高可观测
```

### 5. 容错性分析

| 故障场景              | 应对策略           | 恢复方式                |
| --------------------- | ------------------ | ----------------------- |
| **Orchestrator 崩溃** | 文件系统有完整状态 | 重启后从文件恢复        |
| **Worker 崩溃**       | 任务状态写入文件   | 重新分配任务给新 Worker |
| **网络分区**          | 文件系统本地访问   | 网络恢复后自动同步      |
| **文件损坏**          | 原子写入 + 检查点  | 从最近的检查点恢复      |
| **审批超时**          | defaultDecision    | 自动应用默认决策        |
| **Worker 卡住**       | 偏离检测 + 干预    | 自动发送干预指令        |

### 6. 扩展性分析

```
横向扩展（Scale Out）：
  ├─ 增加 Worker 数量 → 提高并发度
  ├─ 多个 Orchestrator 实例 → 负载均衡（未来）
  └─ 分布式文件系统 → 跨机器协作（未来）

纵向扩展（Scale Up）：
  ├─ 增加 Worker 资源 → 处理更复杂任务
  ├─ 增加文件系统性能 → 提高IO吞吐
  └─ 优化监控频率 → 降低延迟
```

### 7. 与其他系统的对比

| 系统                 | 架构     | 交互方式         | 优势             | 劣势     |
| -------------------- | -------- | ---------------- | ---------------- | -------- |
| **Tachikoma**        | 混合式   | 内存+文件+消息流 | 快速+可靠+可观测 | 实现复杂 |
| **LangChain Agents** | 单体式   | 内存调用         | 简单             | 不可恢复 |
| **AutoGPT**          | 循环式   | 内存调用         | 简单             | 不可控   |
| **MetaGPT**          | 消息队列 | RabbitMQ/Redis   | 分布式           | 重依赖   |
| **CrewAI**           | 直接调用 | 内存调用         | 简单             | 不可恢复 |

---

## 实现细节与代码导读

### 核心模块代码位置

| 模块                    | 文件路径                                                               | 说明           |
| ----------------------- | ---------------------------------------------------------------------- | -------------- |
| **Orchestrator**        | `packages/core/src/orchestrator/orchestrator.ts`                       | 统筹者主类     |
| **ExecutionLoop**       | `packages/core/src/orchestrator/runner/execution-loop.ts`              | 执行循环       |
| **WorkerManager**       | `packages/core/src/orchestrator/runner/worker-manager.ts`              | Worker 管理器  |
| **SessionFileManager**  | `packages/core/src/orchestrator/session/session-file-manager.ts`       | 会话文件管理器 |
| **SessionWatcher**      | `packages/core/src/orchestrator/session/session-file-manager.watch.ts` | 文件监控       |
| **SessionPeerReader**   | `packages/core/src/orchestrator/session/session-file-manager.peer.ts`  | Peer 读取      |
| **WorkerExecutor**      | `packages/core/src/worker/worker-executor.ts`                          | Worker 执行器  |
| **GenericAgentBackend** | `packages/core/src/worker/backends/generic-agent-backend.ts`           | 通用后端       |
| **ApprovalArbitration** | `packages/core/src/orchestrator/services/approval-arbitration.ts`      | 审批仲裁       |
| **DeviationDetector**   | `packages/core/src/orchestrator/engines/deviation-detector.ts`         | 偏离检测       |

### 关键流程追踪

#### 1. 任务执行完整流程

```
用户调用
  ↓
Orchestrator.run(task)
  ↓
1. session.start() → 创建文件系统目录
  ↓
2. sessionManager.startWatching() → 启动文件监控
  ↓
3. planner.plan(task) → 分解任务
  ↓
4. execution.executeAll(subtasks) → 执行所有子任务
  ├─ 对每个 subtask:
  │   ├─ workers.findOrCreateWorkerForRole() → 找到/创建 Worker
  │   ├─ worker.execute(subtask, tools) → 执行任务
  │   │   ├─ GenericAgentBackend.execute() → LLM 循环
  │   │   │   ├─ yield { type: 'thinking' } → 思考消息
  │   │   │   ├─ executeTool() → 执行工具
  │   │   │   └─ yield { type: 'output' } → 输出结果
  │   │   └─ sessionManager.appendThinking/Action() → 写日志
  │   └─ 收集结果
  └─ 返回所有结果
  ↓
5. aggregationEngine.aggregate(results) → 聚合结果
  ↓
6. session.stop() → 停止监控，清理资源
  ↓
返回最终结果
```

#### 2. 审批流程追踪

```
Worker 检测到需要审批
  ↓
sessionManager.writePendingApproval()
  ├─ 写入 pending_approval.json
  └─ 原子写入（.tmp → rename）
  ↓
Worker 进入等待状态
  ├─ status: 'waiting_approval'
  └─ 轮询 approval_response.json
  ↓
SessionWatcher 检测到文件变化
  ├─ fs.watch 触发事件
  └─ emit('pending_approval_created')
  ↓
ApprovalArbitrationService.handle()
  ├─ 读取 pending_approval.json
  ├─ 评估决策（应用策略）
  └─ sessionManager.writeApprovalResponse()
      ├─ 写入 approval_response.json
      └─ 原子写入
  ↓
Worker 读取到响应
  ├─ approved: true → 继续执行
  └─ approved: false → 跳过操作
  ↓
Worker 删除审批文件
  ├─ 删除 pending_approval.json
  └─ 删除 approval_response.json
```

#### 3. 偏离检测追踪

```
Orchestrator 定期检测
  ↓
DeviationDetector.detect(workerId)
  ├─ sessionManager.readThinkingLogs() → 读取思考日志
  ├─ analyzePattern() → 分析模式
  │   ├─ 检测重复
  │   ├─ 计算相关性
  │   └─ 计算进展度
  └─ 返回偏离结果
  ↓
如果检测到偏离 (severity >= high)
  ↓
sessionManager.writeIntervention()
  ├─ 写入 intervention.json
  └─ 包含干预指令
  ↓
Worker 下一轮思考前检查
  ↓
sessionManager.readIntervention()
  ├─ 读取 intervention.json
  └─ acknowledged: false → 收到新干预
  ↓
Worker 处理干预
  ├─ 将干预注入到上下文
  ├─ 调整策略
  └─ 确认干预
      ├─ intervention.acknowledged = true
      └─ sessionManager.writeIntervention()
  ↓
Orchestrator 监听到确认
  └─ 记录干预成功
```

### 调试技巧

#### 1. 查看文件系统状态

```bash
# 查看会话目录结构
ls -R .tachikoma/sessions/session-001/

# 查看运行时信息
cat .tachikoma/sessions/session-001/orchestrator/runtime.json

# 查看 Worker 状态
cat .tachikoma/sessions/session-001/workers/worker-001/status.json

# 查看思考日志（最后10条）
tail -n 10 .tachikoma/sessions/session-001/workers/worker-001/thinking.jsonl

# 监控文件变化
watch -n 1 'ls -lt .tachikoma/sessions/session-001/workers/worker-001/'
```

#### 2. 手动干预

```bash
# 手动发送干预指令
cat > .tachikoma/sessions/session-001/workers/worker-001/intervention.json << EOF
{
  "interventionId": "manual-001",
  "createdAt": $(date +%s)000,
  "type": "guidance",
  "reason": "手动干预",
  "instructions": "请停止当前工作，重新思考",
  "acknowledged": false
}
EOF

# 手动批准审批请求
cat > .tachikoma/sessions/session-001/workers/worker-001/approval_response.json << EOF
{
  "requestId": "approval-001",
  "respondedAt": $(date +%s)000,
  "approved": true,
  "respondedBy": "human",
  "reason": "手动批准"
}
EOF
```

#### 3. 日志分析

```bash
# 分析思考模式
jq -r '.content' .tachikoma/sessions/session-001/workers/worker-001/thinking.jsonl

# 统计工具调用
jq -r '.description' .tachikoma/sessions/session-001/workers/worker-001/actions.jsonl | sort | uniq -c

# 查看决策历史
jq -r '.decision' .tachikoma/sessions/session-001/orchestrator/decisions.jsonl
```

### 性能优化建议

1. **文件监控优化**
   - 使用 `persistent: false` 避免阻止进程退出
   - 轮询间隔不要太短（建议 ≥ 1000ms）
   - 批量处理文件变化事件

2. **文件IO优化**
   - 使用原子写入避免损坏
   - 批量追加 JSONL 记录
   - 定期清理旧日志文件

3. **Worker池优化**
   - 设置合理的 maxWorkers（建议 3-5）
   - 优先复用空闲 Worker
   - 及时回收失败的 Worker

4. **监控优化**
   - 异步处理文件事件
   - 避免阻塞主循环
   - 使用事件驱动而非轮询

---

## 总结

Tachikoma 的 Orchestrator-Worker 交互机制是一个**精心设计的混合式架构**：

### 核心创新点

1. **三层交互架构**
   - Layer 1: 内存通信（快速路径）
   - Layer 2: 文件协调（可靠路径）
   - Layer 3: 消息流（监控路径）

2. **文件协调机制**
   - 审批流程
   - 偏离检测与干预
   - Worker 间协作
   - 状态持久化

3. **灵活运行模式**
   - 当前：主动协调模式
   - 未来：完全被动模式
   - 平滑过渡

### 设计优势

| 优势         | 说明                |
| ------------ | ------------------- |
| **高性能**   | 内存通信，<1ms 延迟 |
| **高可靠**   | 文件持久化，可恢复  |
| **高可观测** | 完整审计日志        |
| **易扩展**   | 横向/纵向扩展       |
| **易调试**   | 可直接查看文件      |
| **容错性强** | 崩溃可恢复          |

### 适用场景

- ✅ **短期交互式任务**（小时级） → 主动协调模式
- ✅ **中期后台任务**（天级） → 混合模式
- ✅ **长期分布式任务**（周级） → 完全被动模式（未来）

### 核心设计哲学

```
🎯 快速 + 可靠 + 可观测 = 生产级多智能体系统

快速：内存通信，低延迟
可靠：文件协调，可恢复
可观测：消息流 + 审计日志

三位一体，缺一不可！
```

---

**文档版本**: v1.0  
**最后更新**: 2025-01-XX  
**维护者**: Tachikoma Team

如有疑问，请参考：

- 项目主README: `/README.md`
- 架构详解: `/docs/Tachikoma架构与执行流程详解.md`
- API文档: `/docs/api/`
