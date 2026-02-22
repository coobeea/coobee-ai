# 45. Tavern Worker 与 Channel 扩展：落地执行计划

## 1. 核心目标与思路梳理

经过文档 40~44 的深度探讨，我们将复杂的架构演进需求梳理为**两大主线（Tracks）**：

- **主线 A：Channel 扩展性基建 (Foundation)**
  让系统现有的 `Plugin API` 真正具备对接“外部系统”的能力（不管这个外部系统是在别的服务器上，还是在子进程里）。
- **主线 B：酒馆 Worker 业务落地 (Application)**
  利用现有的 `WorkerManager`，写一个独立的“酒馆扫库侦察兵 (Poller Worker)”，并结合主线 A 的基建，实现任务的自动派发与 Agent 接单。

---

## 2. 分阶段执行计划 (Phased Execution Plan)

我们遵循“先修路（基建），再跑车（业务）”的原则，将工作分为 4 个清晰的阶段。

### 🚩 Phase 1: 基础设施建设 - Channel 扩展能力支持

**目标**：赋能 Plugin 系统，让它能管通道、能开接口。
**预计周期**：2-3 天

1. **扩展 PluginApi 接口**：
   在 `src/main/common/extension/types.ts` 中增加 `registerChannel`, `registerHttpRoute`, `registerService` 等能力。
2. **实现 ChannelManager**：
   新建 `src/main/channels/ChannelManager.ts`，负责管理所有 Channel 的注册、启动和停止。
3. **修复 Gateway 集成**：
   在 `ReadyGatewayHook` 中，确保 Plugin 注册的 HTTP Route 能够正确挂载到系统的 API 路由上（用于接收后面 Worker 的推送）。

---

### 🚩 Phase 2: 侦察兵 - 编写 Tavern Poller Worker

**目标**：把“定时扫数据库、发现新任务”的脏活累活，扔进一个绝对安全、不怕崩溃的独立子进程里。
**预计周期**：1-2 天

1. **创建 Worker 目录与配置**：
   在 `workers/tavern-poller/` 创建 `worker.json`，配置它的启动命令、端口和自动重启策略（交由 `WorkerManager` 托管）。
2. **编写轮询脚本 (Node.js)**：
   写一个死循环脚本 `server.js`。每 5 秒连一次本地数据库（SQLite/JSONL），找出 `status = 'pending'` 的任务。
3. **实现向主进程推送**：
   扫到新任务后，通过 HTTP POST 把任务数据推送到主进程（推给 Phase 3 将要建立的接收口）。

---

### 🚩 Phase 3: 接收站 - 实现 Tavern Channel Plugin

**目标**：在主进程中，把 Worker 推过来的数据包装成标准事件，并提供让 Agent 操作酒馆的工具。
**预计周期**：2-3 天

1. **实现 TavernChannelPlugin**：
   在 `extensions/tavern-integration/` 下创建插件。
2. **开放内部 Webhook 接收口**：
   在 `gateway.start` 钩子中，利用 Phase 1 的能力开一个内部接口 `/internal/tavern/events`。收到 Worker 的推送后，转换成标准事件 `external.tavern.task.created` 扔给全局 EventBus。
3. **注册 Agent 交互工具**：
   注册 `external_tavern_accept_task`，`external_tavern_submit_result` 工具。因为在主进程，这里直接调用酒馆原有的数据库更新 API 即可（Direct 模式，无网络损耗）。

---

### 🚩 Phase 4: 指挥大脑 - 任务智能调度与分配

**目标**：系统听到新任务事件后，自动找最合适的 Agent 去干活，形成闭环。
**预计周期**：3-5 天

1. **扩充 Agent 能力模型**：
   在 `AgentDefinition` (agent.json) 中增加 `capabilities` 字段（如 `coding: level 4`）。
2. **实现 Task Dispatcher 服务**：
   作为一个后台服务启动，专门订阅 `external.tavern.task.created` 事件。
3. **任务分析与匹配**：
   收到事件后，调用 `TaskAnalyzer` 提取任务所需的技能，然后通过 `AgentMatcher` 选出最合适的 Agent。
4. **触发 Agent 执行**：
   调用 `AgentExecutor.run`，把任务 Context 塞给 Agent，并限制它使用 Phase 3 注册的工具进行结果回写。

---

## 3. 架构模块映射关系

为了更清晰地理解这四步，我们看下它们在系统中的位置：

| 模块位置                         | 对应 Phase  | 核心职责                                   |
| :------------------------------- | :---------- | :----------------------------------------- |
| `src/main/channels/`             | **Phase 1** | 提供 Channel 的底层生命周期管理。          |
| `workers/tavern-poller/`         | **Phase 2** | 独立子进程，只干一件事：扫库、推数据。     |
| `extensions/tavern-integration/` | **Phase 3** | 主进程里的转接头：接数据、发事件、注工具。 |
| `src/main/ai/orchestration/`     | **Phase 4** | 调度中心：听事件、挑 Agent、分派任务。     |

---

## 4. 实施建议

如果你觉得同时做这两条线（基建 + 业务）步子迈得太大，我们可以**先切入核心链路，做最小可行性验证（MVP）**：

1. 先不搞复杂的 `TaskDispatcher`（Phase 4），直接指定让某一个默认 Agent（如 `app-copilot`）去接单。
2. 先把 **Phase 1 (Channel 注册口)** -> **Phase 2 (Worker 扫库)** -> **Phase 3 (Channel 转事件)** 这条链路跑通。
3. 当你能在控制台看到：_“Tavern Worker 扫到任务 -> 主进程 Channel 收到推送 -> EventBus 触发 -> Agent 开始思考”_，整个架构的解耦红利就已经吃到了！
