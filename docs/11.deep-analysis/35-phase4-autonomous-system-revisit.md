# 阶段四重新审视：自主任务执行系统

> **背景**：基于 `docs/8.strategic-planning/27-autonomous-system-feasibility-analysis.md` 的分析，结合系统最新状态重新评估。
> **日期**：2026-02-25
> **目标**：站在当前代码基础上，重新审视阶段四的可行性和最佳实现路径。

---

## 一、与 2 月 22 日分析相比，系统发生了哪些变化

### 1.1 新增能力

| 能力                    | 新增时间 | 影响                                                                             |
| ----------------------- | -------- | -------------------------------------------------------------------------------- |
| **emit_event 工具**     | 2/24     | Agent 可向前端发送事件（通知、打开文件等），为任务进度推送提供了基础设施         |
| **AgentEventBridge**    | 2/24     | 事件从 eventBus → Gateway WebSocket 的桥接已打通                                 |
| **useAgentEvents**      | 2/24     | 前端已具备监听 Agent 事件的能力                                                  |
| **终端集成**            | 2/24     | Agent 可在终端面板中执行命令并实时显示输出                                       |
| **安全加固**            | 2/25     | path-guard 敏感文件黑名单、files.copy 源路径校验、HMAC 签名、PTY 环境过滤        |
| **Process-Thread 绑定** | 2/25     | `ProcessRegistry` 支持 `threadId` 和 `cleanupByThread`，可按 Thread 清理关联进程 |
| **approval-done 清理**  | 2/25     | ThreadWaker 统一为 `tool-done`，代码更清晰                                       |
| **exec 超时增大**       | 2/25     | 默认超时从 30s 调整到 120s，更适合构建/测试场景                                  |

### 1.2 核心差距的变化

| 差距         | 原始评估 | 当前评估 | 变化原因                                       |
| ------------ | -------- | -------- | ---------------------------------------------- |
| **后台执行** | 🔴 极高  | 🟠 高    | Checkpoint 恢复 + CronJobExecutor 先例证明可行 |
| **任务创建** | 🟡 中等  | 🟡 中等  | 未变化                                         |
| **产物管理** | 🟡 中等  | 🟢 低    | emit_event + 文件预览已打通                    |
| **进度通知** | 🟡 中等  | 🟢 低    | emit_event 可直接用于推送                      |
| **外部发布** | 🔴 极高  | 🔴 极高  | 未变化（不在近期目标内）                       |

---

## 二、核心思维转变

### 2.1 原始思路的局限

原始分析将 "自主运行" 定义为：**用户说一句话 → 系统全自动完成 → 通知用户**。这个定义本身没有问题，但方案过于聚焦在 **"一种新的 Worker 类型"** 上，忽略了一个关键事实：

> **当前系统已经具备了几乎所有核心组件，缺的不是组件，而是"胶水"。**

### 2.2 新的认知

经过这几天的开发，我们发现：

1. **AgentExecutor 已经支持非对话 session**（CronJobExecutor 先例）
2. **ThreadWaker + Checkpoint 已经支持恢复**（审批恢复、重启恢复）
3. **Tavern HTTP API 已经完备**（CRUD + 状态管理）
4. **emit_event 已经打通了 Agent → 前端的事件链路**
5. **Process-Thread 绑定让资源清理有了抓手**

### 2.3 新的方案思路：**方案 C — 轻量化主进程 TaskScheduler**

不再需要方案 A（独立 Worker）或方案 B（完整的 BackgroundThreadManager），而是：

```
方案 C：在现有基础上，增加一个轻量级 TaskScheduler

核心改动：
  1. TaskScheduler：监听 Tavern accepted 任务，调用 agentExecutor.submitViaPipeline
  2. Thread 增加 source 字段：区分 'chat'（对话发起）和 'task'（任务发起）
  3. 前端 TaskView：展示任务执行状态和产物
  4. Gateway HTTP API：为 Tavern 补一个轻量的 `/chat/send` HTTP 端点

不需要新增的：
  ✅ 不需要新的 Worker 进程
  ✅ 不需要新的 Checkpoint 机制
  ✅ 不需要新的流式通信方式
  ✅ 不需要新的事件系统
```

---

## 三、方案 C 详细设计

### 3.1 架构

```
                     ┌─────────────────────┐
                     │     TaskScheduler   │
                     │ (主进程中的轻量服务) │
                     │                     │
                     │ 1. 监听 Tavern tasks│
                     │ 2. 自动分配 Agent   │
                     │ 3. 调度执行         │
                     └──────────┬──────────┘
                                │
                  ┌─────────────┼──────────────┐
                  │             │              │
                  ▼             ▼              ▼
          ┌──────────┐  ┌──────────┐  ┌──────────┐
          │ Session 1│  │ Session 2│  │ Session 3│
          │ task-001 │  │ task-002 │  │ task-003 │
          │ (Agent A)│  │ (Agent B)│  │ (Agent A)│
          └──────────┘  └──────────┘  └──────────┘
               │             │              │
               └─────────────┼──────────────┘
                             │
               ┌─────────────┼──────────────┐
               │             │              │
               ▼             ▼              ▼
        AgentExecutor  Orchestrator  Quality Loop
        (复用现有)     (复用现有)    (复用现有)
```

### 3.2 关键组件

#### 3.2.1 TaskScheduler（新增，~200 行）

```typescript
class TaskScheduler {
  private pollingInterval: NodeJS.Timeout | null = null;
  private activeTasks = new Map<string, { sessionId: string; status: string }>();
  private maxConcurrent = 3;

  start() {
    // 每 10 秒轮询 Tavern 任务
    this.pollingInterval = setInterval(() => this.poll(), 10_000);
  }

  async poll() {
    // 1. 查询 accepted 状态的任务
    const tasks = await tavernStore.listByStatus('accepted');

    // 2. 过滤已在执行中的
    const pending = tasks.filter((t) => !this.activeTasks.has(t.id));

    // 3. 按并发限制分发
    for (const task of pending.slice(0, this.maxConcurrent - this.activeTasks.size)) {
      await this.executeTask(task);
    }
  }

  async executeTask(task: TavernTask) {
    const sessionId = `task-${task.id}-${Date.now()}`;

    // 创建 Thread（标记为任务来源）
    const threadStore = await ThreadStore.getInstance();
    await threadStore.create({
      id: sessionId,
      title: `Task: ${task.title}`,
      agentId: task.assignedAgent || 'default',
      source: 'task',
      taskId: task.id,
      runStatus: 'running'
    });

    // 调用 AgentExecutor
    agentExecutor.submitViaPipeline(sessionId, `Execute Tavern task:\n${task.description}`, 'agent');

    this.activeTasks.set(task.id, { sessionId, status: 'running' });

    // 监听完成事件
    eventBus.on('session:complete', (evt) => {
      if (evt.sessionId === sessionId) {
        this.handleTaskComplete(task.id, evt);
      }
    });
  }

  async handleTaskComplete(taskId: string, result: unknown) {
    // 更新 Tavern 任务状态
    await tavernStore.updateStatus(taskId, 'completed');
    this.activeTasks.delete(taskId);

    // 发送系统通知
    const { Notification } = require('electron');
    new Notification({
      title: 'Tavern 任务完成',
      body: `任务已完成`
    }).show();
  }
}
```

#### 3.2.2 Thread source 字段（扩展 Thread 类型）

```typescript
interface ThreadMeta {
  // ...现有字段
  source?: 'chat' | 'task' | 'cron';
  taskId?: string; // 关联的 Tavern 任务 ID
}
```

#### 3.2.3 Gateway HTTP chat/send（补充 HTTP 端点）

```typescript
// 用于外部触发 Agent 执行（如 CLI、定时任务、Task Worker 等）
router.post('/chat/send', async (ctx) => {
  const { sessionId, message, model, agentId } = ctx.request.body;
  // 调用 agentExecutor.submitViaPipeline
  // 返回 sessionId 供后续查询
});
```

### 3.3 执行流程

```
用户在对话中说 "做产品宣发"
    │
    ▼
Agent 识别为任务意图（通过 System Prompt 引导）
    │
    ▼
Agent 调用 emit_event({ event: 'notify', payload: { message: '正在创建任务...' } })
Agent 调用 exec 执行 curl 创建 Tavern 任务（或用内置 tavern 工具）
    │
    ▼
TaskScheduler.poll() 检测到新的 accepted 任务
    │
    ▼
TaskScheduler 创建独立 Thread（source: 'task'）
    │
    ▼
AgentExecutor 在新 Thread 中执行
    ├── Orchestrator 拆解子任务
    ├── Sub-Agent 并行执行
    ├── Quality Loop 自动检查
    └── emit_event 推送进度
    │
    ▼
执行完成 → TaskScheduler 更新 Tavern 状态 → 系统通知
```

### 3.4 与方案 A/B 的对比

| 维度               | 方案 A（Worker）  | 方案 B（主进程 Thread） | **方案 C（轻量 TaskScheduler）** |
| ------------------ | ----------------- | ----------------------- | -------------------------------- |
| **后台执行**       | ✅ 独立进程       | ⚠️ 主进程内             | ⚠️ 主进程内                      |
| **应用关闭后继续** | ✅ 可以           | ❌ 不可以               | ❌ 不可以（但 Checkpoint 恢复）  |
| **工作量**         | 7 天              | 4 天                    | **2-3 天**                       |
| **复用程度**       | 中（需新 Worker） | 中（需新 Manager）      | **高（复用 90% 现有代码）**      |
| **稳定性**         | ✅ 进程隔离       | ⚠️ 影响主进程           | ⚠️ 主进程内（但复用成熟组件）    |
| **并发任务**       | ✅ 可控           | ⚠️ 受限                 | ⚠️ 受限（3 并发足够）            |
| **代码改动量**     | ~2000 行          | ~800 行                 | **~400 行**                      |

### 3.5 为什么方案 C 更合适

1. **最小改动**：复用 AgentExecutor、Checkpoint、ThreadWaker、emit_event 等现有组件
2. **实际需求匹配**：应用作为 Electron 桌面应用，用户使用时应用是打开的；Checkpoint + ThreadWaker 已经支持应用重启恢复
3. **渐进演进**：先实现方案 C，验证流程后，若确实需要"应用关闭后继续"，再增加 Worker（从方案 C 升级到方案 A 只需增量 3-4 天）

---

## 四、实施路线图

### 第 1 步：TaskScheduler 核心（1 天）

- [ ] 创建 `src/main/ai/task/TaskScheduler.ts`
- [ ] 实现轮询 Tavern + 分发任务 + 状态跟踪
- [ ] 在 `lifecycle/ReadyHook` 中启动 TaskScheduler
- [ ] Thread 类型增加 `source` 和 `taskId` 字段

### 第 2 步：Gateway HTTP 端点 + 前端（1 天）

- [ ] 新增 `POST /gateway/chat/send` HTTP 端点
- [ ] 前端 TavernView 展示任务执行状态（复用 Thread 状态）
- [ ] 任务完成时系统通知（Electron Notification）

### 第 3 步：意图理解 + 产物关联（0.5-1 天）

- [ ] 在对话 Agent 的 System Prompt 中增加任务意图识别引导
- [ ] Tavern 任务增加 `artifacts` 字段
- [ ] 提交任务时关联输出文件

### 第 4 步：测试与稳定（0.5 天）

- [ ] TaskScheduler 单元测试
- [ ] 集成测试：创建任务 → 自动执行 → 完成通知
- [ ] 并发和错误处理测试

**总计：约 3 天**

---

## 五、长期演进路径

```
当前         →  方案 C（3 天）  →  方案 A 升级（+4 天）  →  外部发布（未来）
Level 2          Level 2.5           Level 3                Level 3+
对话中执行    →  主进程后台执行  →  独立 Worker 后台执行  →  + 外部平台集成
              →  Checkpoint 恢复 →  应用关闭后继续
              →  系统通知       →  进度面板
```

方案 C 是从 Level 2 到 Level 3 的**最佳跳板**，而不是终点。

---

## 六、与原始分析的关键差异总结

| 维度               | 原始分析（2/22）       | 重新审视（2/25）                               |
| ------------------ | ---------------------- | ---------------------------------------------- |
| **推荐方案**       | 方案 A（Worker，7 天） | **方案 C（轻量 TaskScheduler，3 天）**         |
| **核心理由**       | 需要"真正的后台执行"   | 先实现 80% 的能力，再渐进增强                  |
| **事件通知**       | 需要新建               | **已有 emit_event + AgentEventBridge**         |
| **Checkpoint**     | 需要增强               | **已有审批恢复 + 重启恢复**                    |
| **非对话 Session** | 需要新建               | **已有 CronJobExecutor 先例**                  |
| **资源清理**       | 需要新建               | **已有 Process-Thread 绑定 + cleanupByThread** |
| **工作量**         | 7 天                   | **3 天**（节省 57%）                           |

**结论**：系统在过去 3 天的迭代中已经补齐了大量基础设施，原本需要从零构建的能力现在大多可以复用。方案 C 是当前最务实的选择。
