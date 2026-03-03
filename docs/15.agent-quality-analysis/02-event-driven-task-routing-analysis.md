# 事件驱动任务分发机制：现状分析与改进方案

> 创建时间：2026-03-03
> 状态：分析文档，未做代码改动

---

## 一、用户核心诉求

当前 `task-router` Extension 使用静态 JSON 规则匹配的方式分发任务，这种方式存在根本缺陷：

1. **规则太死板** — 需要预先定义"哪个智能体完成什么任务后触发哪个智能体"，无法应对动态场景
2. **缺少智能判断** — 应该由一个"任务分发员"智能体来判断哪些智能体对事件感兴趣，而不是写死规则
3. **事件信息不充分** — 当前 `agent:done` 事件只携带 `summary`（500 字截断），分发员无法深入了解任务成果
4. **缺少完整闭环** — 应该是：智能体写网盘 → 通过 Skill 发事件 → 分发员判断 → 拉起感兴趣的智能体 → 新智能体从网盘拉取数据

---

## 二、现有机制深度分析

### 2.1 智能体拉起方式总览

系统中目前有 **5 种方式** 可以触发一个智能体执行任务：

| 方式                  | 入口          | 阻塞/异步               | 有无 Thread  | 场景                          |
| --------------------- | ------------- | ----------------------- | ------------ | ----------------------------- |
| `delegate_to_agent`   | LLM tool call | 阻塞（submitAndWait）   | 否（子会话） | 主智能体委派子任务            |
| `submitViaPipeline`   | 代码调用      | 异步（排队）            | 取决于调用方 | 酒馆调度、Pipeline 提交       |
| `submit()`            | 代码调用      | 异步（fire-and-forget） | 取决于调用方 | tavern-integration、chat.send |
| `submitAndWait()`     | 代码调用      | 阻塞                    | 否           | CronJob 执行、集成测试        |
| `stream()` / 链式 API | 代码调用      | 流式                    | 否           | 轻量 LLM 交互                 |

### 2.2 `delegate_to_agent` 详细流程（最完整的智能体拉起方式）

```
用户请求 → 主智能体 → LLM 决定 delegate_to_agent(agentId, task)
  ↓
1. AgentStore.get(agentId)  — 加载目标智能体配置
2. WorkspaceManager.getOrCreateSubAgentWorkspace()  — 创建子工作空间
   → {parentWorkspace}/tasks/{taskId}/agents/{agentId}/
3. 收集 experiences/*.md  — 从 tasks/{taskId}/experiences/ 加载历史经验
4. 构建 message = task + context + experiences
5. agentExecutor.submitAndWait()  — 阻塞执行
   → sessionId = {parentSessionId}:delegate:{agentId}
6. 写入 tasks/{taskId}/results/{agentId}.md  — 保存结果
7. 返回结果给主智能体
```

**关键约束**：子智能体不能再 delegate（禁止递归）、有 5 分钟超时、需要用户确认。

### 2.3 酒馆任务调度流程

```
创建任务 → TavernStore(pending) → TaskScheduler 轮询
  ↓
1. TaskScheduler.poll()  — 每 30s 检查 pending 任务
2. ThreadStore.create()  — 创建 Thread
3. 预填 GOAL.md  — 包含任务目标和酒馆状态更新指引
4. agentExecutor.submitViaPipeline()  — 通过 Pipeline 异步执行
5. 监听 stream:end / stream:error  — 感知任务完成/失败
6. TavernStore.updateTask()  — 更新任务状态
```

### 2.4 task-router Extension（当前的事件驱动分发）

```
智能体完成 → AgentExecutor.emitAgentLifecycleEvent('agent:done', payload)
  ↓
task-router Extension 监听 agent:done
  ↓
遍历 task-routes.json 中的静态规则
  ↓
matchRoute(route, payload)  — agentId 匹配 + success 检查 + summary 关键词匹配
  ↓
延迟 N ms 后 agentExecutor.submitViaPipeline(sessionId, taskMessage)
```

**问题**：

1. 匹配逻辑是静态的（JSON 规则），无法做语义理解
2. `submitViaPipeline` 时没有创建 Thread，后续无法追踪
3. sessionId = `task-router:{nanoid}` 没有关联到任何 agentId，Pipeline 会使用默认模式
4. 事件 payload 中的 `summary` 仅有 500 字，信息有限

### 2.5 `emit_event` 工具（智能体主动发事件）

当前的 `emit_event` 工具只能发送前端 UI 事件（open-preview、open-file、notify），**不能用于智能体间通信**。事件走的是 `agent:event` → `AgentEventBridge` → WebSocket → 前端。

### 2.6 `agent:done` 事件 Payload

```typescript
// 成功
{
  sessionId: string;
  agentId: string; // runtime.id（可能是智能体 ID 也可能是 "piMono"）
  agentName: string; // runtime.name
  success: true;
  durationMs: number;
  summary: string; // result.output?.substring(0, 500)  ← 只有 500 字！
  timestamp: number;
}

// 失败
{
  sessionId: string;
  agentId: string;
  agentName: string;
  success: false;
  durationMs: number;
  error: string;
  timestamp: number;
}
```

---

## 三、问题诊断

### 3.1 当前 task-router 的根本问题

| 问题                         | 描述                                                    |
| ---------------------------- | ------------------------------------------------------- |
| **静态规则无法处理动态场景** | 每次新增智能体或任务类型，都需要修改 `task-routes.json` |
| **缺少语义理解**             | `summaryMatch` 只是字符串包含匹配，无法理解任务内容     |
| **事件信息不足**             | `summary` 仅 500 字，且没有附带网盘条目信息             |
| **无 Thread/追踪**           | 分发的任务没有 Thread，无法在前端查看或追踪             |
| **无 agentId 指定**          | `submitViaPipeline` 没有传入目标 agentId，使用默认模式  |

### 3.2 完整闭环中的断点

理想流程：

```
智能体完成任务
  → 将成果写入 SharedDrive
  → 发送事件（包含任务概述 + 网盘条目引用）
  → "任务分发员" 监听事件
  → 分发员查看网盘内容 + 了解所有智能体能力
  → 分发员判断哪些智能体感兴趣
  → 拉起感兴趣的智能体，传入网盘数据引用
  → 新智能体从网盘拉取数据，开始处理
```

当前的断点：

| 步骤             | 当前状态                                | 缺失                                              |
| ---------------- | --------------------------------------- | ------------------------------------------------- |
| 写入 SharedDrive | ✅ 有 Skill + HTTP API                  | -                                                 |
| 发送事件         | ⚠️ `agent:done` 自动发，但信息不足      | 缺少网盘条目 ID、缺少自定义事件内容               |
| 分发员监听       | ❌ task-router 是静态规则匹配           | 需要改为 LLM 驱动的智能判断                       |
| 分发员判断       | ❌ 没有这个能力                         | 需要访问 AgentStore 了解所有智能体 + 读取网盘内容 |
| 拉起智能体       | ⚠️ 有 `submitViaPipeline` 但缺少 Thread | 需要创建 Thread + 指定 agentId                    |
| 新智能体拉取数据 | ✅ 有 SharedDrive Skill                 | -                                                 |

---

## 四、改进方案

### 方案核心思路

将 `task-router` 从**静态规则引擎**改为**LLM 驱动的任务分发员**：

1. 智能体完成任务后，在网盘中写入成果，然后通过 Skill 中约定的流程发送事件
2. 事件中包含：任务概述、网盘条目 ID/路径、相关标签
3. 一个专门的**"任务分发员"智能体**（或使用 `app-copilot`）监听事件
4. 分发员通过 LLM 判断哪些智能体对此任务感兴趣
5. 分发员通过 `delegate_to_agent` 或新的 dispatch 机制拉起目标智能体

### 方案 A：利用现有 Skill + 酒馆 模式（推荐，改动最小）

#### 核心思路

不改 task-router 的代码逻辑，而是改变**事件的消费方式**：

1. **SharedDrive Skill 中增加"发布事件"步骤** — 智能体写完网盘后，在 Skill 流程中约定要发一个通知（通过 `emit_event` 工具或往酒馆发布一个任务）
2. **task-router 收到 `agent:done` 后，不做静态匹配，而是创建一个酒馆任务** — 任务内容是"分析以下智能体完成的成果，判断需要通知哪些智能体"
3. **TaskScheduler 自动调度 app-copilot 处理这个酒馆任务** — app-copilot 有 `delegate_to_agent` + SharedDrive Skill + Agent Discovery 能力，可以自主判断和分发

```
智能体完成 → agent:done 事件
  ↓
task-router Extension
  ↓
创建酒馆任务: "分析智能体 {agentName} 完成的成果，判断哪些智能体需要跟进处理"
  附带: { summary, agentId, sessionId, sharedDriveEntryId (如有) }
  ↓
TaskScheduler 自动调度 → app-copilot 接单
  ↓
app-copilot 的执行流程:
  1. 读取 SharedDrive 中该智能体的最新条目
  2. 查看 <agent_discovery> 中所有已注册智能体
  3. 判断哪些智能体的描述/能力与此成果相关
  4. 对相关智能体使用 delegate_to_agent，传入网盘数据引用
```

**优点**：

- 零代码改动（只改 task-router 的规则处理逻辑 + SharedDrive Skill 文档）
- 利用现有的酒馆 + TaskScheduler + app-copilot 完整链路
- app-copilot 天然拥有系统所有能力（Agent Discovery、Skill、Tools）

**缺点**：

- 多了一跳（agent:done → 酒馆任务 → TaskScheduler → app-copilot → delegate_to_agent）
- 延迟较大（TaskScheduler 轮询间隔 30s + LLM 判断时间）

#### 具体改动清单

| 改动                           | 文件                              | 内容                                                                   |
| ------------------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| 1. 增强 `agent:done` payload   | `AgentExecutor.ts`                | 添加 `sharedDriveEntryId` 字段（如果智能体在运行中使用了 SharedDrive） |
| 2. 修改 task-router 逻辑       | `extensions/task-router/index.ts` | 收到 `agent:done` 后，不做静态匹配，而是创建酒馆任务                   |
| 3. 更新 SharedDrive Skill      | `skills/shared-drive/SKILL.md`    | 增加"完成后发布通知"的标准流程                                         |
| 4. 更新 app-copilot 的系统提示 | Agent 配置或 Skill                | 告知 app-copilot 它会收到"分析成果并分发"类型的任务                    |

### 方案 B：专门的"任务分发员"智能体（中等改动）

#### 核心思路

创建一个专门的 `task-dispatcher` 智能体，它的唯一职责是：

1. 监听所有 `agent:done` 事件
2. 通过 SharedDrive 查看成果详情
3. 通过 Agent Discovery 了解所有智能体能力
4. 判断并分发后续任务

```
智能体完成 → agent:done 事件
  ↓
task-router Extension
  ↓
直接拉起 task-dispatcher 智能体（不经过酒馆，直接 submit）
  message = "智能体 {agentName} 完成了任务，概述: {summary}，网盘条目: {entryId}，请判断并分发"
  ↓
task-dispatcher 的执行流程:
  1. GET /gateway/shared-drive/entries/{entryId}  — 查看成果详情
  2. 查看 <agent_discovery> 中所有智能体
  3. 对每个可能感兴趣的智能体，用 delegate_to_agent 分发
```

#### 具体改动清单

| 改动                           | 文件                                | 内容                                                                                 |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| 1. 创建 task-dispatcher 智能体 | `.home/agents/task-dispatcher.json` | 定义：名称、描述、工具（delegate_to_agent、SharedDrive 相关）、Skill（shared-drive） |
| 2. 修改 task-router            | `extensions/task-router/index.ts`   | 收到 `agent:done` 后，直接 `agentExecutor.submit()` 拉起 task-dispatcher             |
| 3. 创建 Thread                 | task-router 中                      | 为每次分发创建 Thread，便于追踪                                                      |
| 4. 增强 `agent:done` payload   | `AgentExecutor.ts`                  | 添加 `sharedDriveEntryId`                                                            |

**优点**：

- 专职智能体，提示词可以高度优化
- 延迟低（不需要经过酒馆 + TaskScheduler 轮询）
- 职责清晰，和 app-copilot 分离

**缺点**：

- 新增一个智能体配置
- 需要修改 task-router 的 dispatch 逻辑

### 方案 C：完全由 Skill 驱动的事件发送（改动最多但最灵活）

#### 核心思路

不依赖 `agent:done` 系统事件，而是在 SharedDrive Skill 中定义一个完整的"发布 + 通知"流程，智能体通过 Skill 主动发送结构化事件。

```
智能体完成任务
  ↓
按照 SharedDrive Skill 的流程:
  1. POST /gateway/shared-drive/entries  — 写入网盘
  2. 使用 emit_event 发送自定义事件:
     event: "shared-drive:entry-created"
     payload: { entryId, agentId, topic, tags, summary }
  ↓
task-router 监听 agent:event（而非 agent:done）
  ↓
过滤出 shared-drive:entry-created 事件
  ↓
拉起 task-dispatcher / app-copilot 处理
```

#### 需要的改动

| 改动                                | 文件                              | 内容                                                        |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| 1. 扩展 `emit_event` 工具           | `emit-event.ts`                   | 除了前端事件，也支持发送系统内部事件（新的 event 类型前缀） |
| 2. task-router 监听 `agent:event`   | `extensions/task-router/index.ts` | 除了 `agent:done`，也监听 `agent:event` 并过滤特定事件      |
| 3. SharedDrive Skill 增加发事件步骤 | `skills/shared-drive/SKILL.md`    | 标准化流程：写网盘 → 发事件                                 |
| 4. 拉起分发员                       | task-router 或新 Extension        | 同方案 B                                                    |

**优点**：

- 事件内容完全由智能体控制，信息最充分
- Skill 定义了标准流程，任何智能体都可以参与
- 不局限于 `agent:done` 时机，智能体可以在任意时刻发事件

**缺点**：

- 依赖智能体"记住"按 Skill 流程发事件（可能遗忘）
- 需要修改 `emit_event` 工具的定位（从纯前端通知变为通用事件）

---

## 五、现有"拉起智能体"参考：酒馆任务的完整链路

酒馆系统是目前最完整的"创建任务 → 调度 → 执行 → 完成"链路：

```
                                ┌─────────────────────┐
                                │     用户/智能体       │
                                │  POST /tavern/tasks  │
                                └──────────┬──────────┘
                                           │ 创建 pending 任务
                                           ▼
                                ┌─────────────────────┐
                                │     TavernStore      │
                                │  (文件系统 JSONL)     │
                                └──────────┬──────────┘
                                           │ TaskScheduler 轮询
                                           ▼
                        ┌──────────────────────────────────┐
                        │          TaskScheduler            │
                        │  1. getPendingTasks()             │
                        │  2. ThreadStore.create()          │
                        │  3. writeTaskGoalFile()           │
                        │  4. submitViaPipeline()           │
                        └──────────────────┬───────────────┘
                                           │
                                           ▼
                        ┌──────────────────────────────────┐
                        │         AgentExecutor             │
                        │    (Pipeline → Builder → Run)     │
                        └──────────────────┬───────────────┘
                                           │ stream:end / stream:error
                                           ▼
                        ┌──────────────────────────────────┐
                        │     TaskScheduler 回调            │
                        │  1. handleTaskCompletion()        │
                        │  2. TavernStore.updateTask()      │
                        │  3. 发送 Notification             │
                        └──────────────────────────────────┘
```

**关键**：TaskScheduler 创建了 Thread，所以任务执行全程可追踪。task-router 目前没有创建 Thread。

---

## 六、`delegate_to_agent` vs `submit()` vs `submitViaPipeline()` 对比

| 维度       | delegate_to_agent        | submit()             | submitViaPipeline()     |
| ---------- | ------------------------ | -------------------- | ----------------------- |
| 调用方式   | LLM tool call            | 代码直接调用         | 代码直接调用            |
| 阻塞       | 是（submitAndWait）      | 否                   | 否                      |
| 有 Thread  | 否（子会话）             | 取决于调用方         | 取决于调用方            |
| 有 agentId | 是（从 AgentStore 加载） | 可选（通过 builder） | 否（Pipeline 默认模式） |
| 工作空间   | 子工作空间               | 取决于 builder       | Pipeline 默认           |
| 结果可获取 | 是（返回给主智能体）     | 否                   | 否                      |
| 适用场景   | 主智能体委派子任务       | 后台异步执行         | 排队处理                |

**对于任务分发场景的选择建议**：

- 如果分发员需要等待结果（如判断是否需要二次分发）→ 用 `delegate_to_agent`
- 如果只需要 fire-and-forget → 用 `submit()` + 创建 Thread
- 如果需要排队控制 → 用 `submitViaPipeline()` + 创建 Thread

---

## 七、推荐实施路径

### Phase 1：最小可用（推荐先做）

采用**方案 A 的简化版**：

1. **修改 task-router**：收到 `agent:done` 后，不做静态规则匹配，而是创建一个酒馆任务，交给 TaskScheduler 调度
2. **酒馆任务内容**：包含 `agent:done` 的 summary + agentId + sessionId，明确要求 app-copilot "分析成果，判断是否需要通知其他智能体"
3. **更新 SharedDrive Skill**：增加"完成后通知"的标准流程步骤

### Phase 2：增强信息密度

1. **增强 `agent:done` payload**：如果智能体使用了 SharedDrive，在 payload 中附带 `sharedDriveEntryId`
2. **增强 SharedDrive Skill**：写网盘 → 自动生成结构化摘要 → 作为事件附加信息

### Phase 3：专职分发员

1. **创建 `task-dispatcher` 智能体**：专门处理任务分发，提示词高度优化
2. **修改 task-router**：直接拉起 `task-dispatcher`，跳过酒馆（减少延迟）
3. **创建 Thread**：每次分发都创建 Thread，保证可追踪

---

## 八、关键设计决策点（需要确认）

| 决策点       | 选项 A                   | 选项 B                      | 建议                                       |
| ------------ | ------------------------ | --------------------------- | ------------------------------------------ |
| 分发员角色   | 使用 app-copilot         | 新建 task-dispatcher        | Phase 1 用 app-copilot，Phase 3 拆分       |
| 分发触发方式 | `agent:done` 系统事件    | 智能体通过 Skill 主动发事件 | 两者并用：`agent:done` 兜底 + Skill 主动发 |
| 任务交接方式 | 酒馆任务 + TaskScheduler | 直接 submit() 拉起          | Phase 1 走酒馆，Phase 3 直接拉起           |
| 事件信息来源 | agent:done 的 summary    | SharedDrive 条目详情        | 两者结合：summary 做初筛，详情做深度判断   |
| Thread 追踪  | 有 Thread                | 无 Thread                   | 必须有 Thread，否则无法追踪                |
