# coobee-ai 系统架构全面分析报告

**分析日期**：2026-02-23  
**分析范围**：整体架构、Gateway、Worker、AI引擎、Extension、前端、数据存储、配置日志

---

## 执行摘要

coobee-ai 是一个基于 Electron + Vue 3 的本地 AI Agent 应用，采用微服务化的架构设计，具备以下特点：

- **分层清晰**：Main/Preload/Renderer 三层隔离，Gateway 统一 API 入口
- **可扩展**：Extension 插件系统、Tool 工具注册、多 Runtime 支持
- **AI 能力完整**：单 Agent、Orchestrator、Swarm 三种模式，完善的沙箱和审批机制
- **数据本地化**：SQLite + 文件系统混合存储，支持崩溃恢复

**核心问题识别**：12个关键问题，4个高优先级、5个中优先级、3个低优先级

**改进方向**：数据一致性、资源管理、监控可观测性、错误处理统一化

---

## 一、整体架构评估

### 1.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RENDERER 层（Vue 3 多窗口）                            │
│  Shell 窗口 │ Console 窗口 │ Browser 窗口                                 │
│  ├─ Views: Agent, Thread, Tavern, Brain, Skills, Settings              │
│  ├─ Stores: chat, threads, agents, skills, worker (Pinia)              │
│  └─ GatewayClient: WebSocket RPC + 事件订阅                              │
└─────────────────────────────────────────────────────────────────────────┘
                                 │ IPC + WebSocket
┌─────────────────────────────────────────────────────────────────────────┐
│                        MAIN 层（Electron 主进程）                          │
│  ┌─ Gateway ─────────────────────────────────────────────────────────┐  │
│  │  WS /gateway/ws (RPC) + HTTP /gateway/* (REST)                    │  │
│  │  ├─ Methods: chat, stream, thread, worker, brain, hitl            │  │
│  │  ├─ Events: StreamBridge, ThreadBridge, WorkerBridge              │  │
│  │  └─ HTTP: agents, threads, skills, files, tavern                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─ AI 核心 ─────────────────────────────────────────────────────────┐  │
│  │  AgentExecutor → PiMono / OpenAI / Orchestrator / Swarm          │  │
│  │  ├─ MessagePipeline (队列、DrainStrategy、Abort)                  │  │
│  │  ├─ ToolRegistry + ToolExecutionPipeline + Sandbox               │  │
│  │  ├─ ThreadStore + SessionMemory + CheckpointManager              │  │
│  │  └─ SkillManager + Extension Hooks                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─ 基础设施 ────────────────────────────────────────────────────────┐  │
│  │  HttpServer (Koa) │ WorkerManager │ ExtensionLoader              │  │
│  │  SQLiteService │ ConfigStore │ EventBus │ LifecycleManager       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                 │ HTTP
┌─────────────────────────────────────────────────────────────────────────┐
│                    WORKERS 层（Python 子进程）                             │
│  brain │ tavern │ tts │ asr │ ocr  (独立 HTTP 服务)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈评分

| 层级       | 技术选型                             | 评分 | 说明                       |
| ---------- | ------------------------------------ | ---- | -------------------------- |
| **前端**   | Vue 3 + Vite + TypeScript + Tailwind | 9/10 | 现代化栈，HMR 体验好       |
| **主进程** | Electron + Node.js + TypeScript      | 8/10 | 类型覆盖完整，架构清晰     |
| **AI引擎** | pi-coding-agent + OpenAI SDK         | 8/10 | 双 Runtime 支持灵活        |
| **存储**   | SQLite + 文件系统                    | 7/10 | 混合存储策略有优化空间     |
| **Worker** | Python + Flask/FastAPI               | 8/10 | 进程隔离好，依赖管理待优化 |

### 1.3 设计模式应用

| 模式               | 应用场景                               | 评价         |
| ------------------ | -------------------------------------- | ------------ |
| **单例**           | AppManager, Gateway, WorkerManager     | 合理         |
| **工厂 + Builder** | AgentRuntime 创建                      | 扩展性强     |
| **观察者**         | EventBus + Gateway 事件桥接            | 解耦良好     |
| **注册表**         | Extension, Tool, Provider              | 插件化完善   |
| **管道**           | MessagePipeline, ToolExecutionPipeline | 流程控制清晰 |
| **策略**           | DrainStrategy, ExecPolicy              | 灵活可配置   |

---

## 二、关键问题汇总

### 2.1 高优先级问题（需立即处理）

| #   | 模块                                  | 问题                                                  | 影响                 | 优先级 |
| --- | ------------------------------------- | ----------------------------------------------------- | -------------------- | ------ |
| 1   | **tavern-integration**                | API 使用错误：`api.events` 为 undefined，事件监听失效 | 酒馆集成功能完全失效 | 🔴 高  |
| 2   | **Gateway brain** vs **Brain Worker** | 双写路径不一致：Gateway 读文件，Worker 写文件         | 数据可能不同步       | 🔴 高  |
| 3   | **ThreadStore / CheckpointManager**   | 无锁并发写，JSON 覆盖可能损坏                         | 数据丢失风险         | 🔴 高  |
| 4   | **WorkerBridge**                      | 未返回 cleanup，`worker:status` 监听泄漏              | 内存泄漏             | 🔴 高  |

### 2.2 中优先级问题（计划优化）

| #   | 模块                           | 问题                                                           | 影响                        | 优先级 |
| --- | ------------------------------ | -------------------------------------------------------------- | --------------------------- | ------ |
| 5   | **stream 方法组**              | 错误处理不一致：返回 `{ok: false}` 而非抛 `GatewayMethodError` | API 风格不统一              | 🟡 中  |
| 6   | **Extension Gateway 方法**     | 注册后未生效：`scanGatewayMethods` 未读 Registry               | Extension 的 RPC 方法不可用 | 🟡 中  |
| 7   | **WorkerManager 依赖安装**     | 每次启动都 `uv pip install`，未做变更检测                      | 启动慢 5-10 秒              | 🟡 中  |
| 8   | **Worker 健康检查**            | 仅启动时检查，运行期假死无法发现                               | Worker 挂起无感知           | 🟡 中  |
| 9   | **events.jsonl / tasks.jsonl** | 无轮转/归档，长期运行无限增长                                  | 磁盘空间风险                | 🟡 中  |

### 2.3 低优先级问题（可延后）

| #   | 模块           | 问题                                        | 影响         | 优先级 |
| --- | -------------- | ------------------------------------------- | ------------ | ------ |
| 10  | **监控指标**   | StreamMonitor、CostTracker 分散，无统一聚合 | 可观测性不足 | 🟢 低  |
| 11  | **日志系统**   | 非结构化，无 traceId/sessionId 字段         | 日志分析困难 | 🟢 低  |
| 12  | **前端数据流** | 直接改 `chatStore.sessionId`，绕过 action   | 数据流不规范 | 🟢 低  |

---

## 三、模块深度分析

### 3.1 Gateway 网关层

**优点**：

- 双通道（WS + HTTP）职责清晰
- 方法组与事件桥接自动发现
- 协议类型和错误码体系完整

**问题**：

- ✅ **问题5**：`stream.*` 方法错误处理不一致
- ✅ **问题4**：WorkerBridge 无 cleanup

**建议**：

1. 统一 `stream.*` 错误处理为 `GatewayMethodError`
2. WorkerBridge 返回 cleanup 函数，Gateway.close() 时调用
3. HTTP 错误格式增加 `code` 字段

### 3.2 Worker 管理系统

**优点**：

- 生命周期管理完整（venv、spawn、health、restart）
- 配置热重载支持
- 崩溃恢复策略合理

**问题**：

- ✅ **问题7**：每次启动都 pip install
- ✅ **问题8**：无运行期健康检查

**建议**：

1. 用 `requirements.txt` 的 hash 或 mtime 判断是否需要重装
2. 增加周期性健康检查（每分钟 `/health`）
3. 端口冲突检测（启动前 `net.connect` 探测）
4. `restartCount` 在成功运行 5 分钟后重置

### 3.3 AI Agent 执行引擎

**优点**：

- 架构清晰：AgentExecutor → Builder → Runtime
- 三种模式（PiMono / Orchestrator / Swarm）职责明确
- 工具系统完善（12 个 builtin + Extension 可扩展）
- 沙箱机制多层防护（path-guard + exec-policy + command-scanner）

**问题**：

- `consumeAndForward` 中 Promise.race + gen.next() 的竞态
- Orchestrator 的 `eventQueue` 用 setTimeout 轮询效率低
- `sessionApprovalCounters` 长期运行可能堆积

**建议**：

1. Orchestrator 改用 EventEmitter 或异步队列替代轮询
2. `sessionApprovalCounters` 增加 TTL 或定期清理
3. 补充 `delegate_to_agent` 的单元测试

### 3.4 Extension 扩展系统

**优点**：

- 扩展点丰富：17 种 Hook + tools + gatewayMethods + httpRoutes + services
- void/modifying 区分合理
- 错误隔离较好
- 热插拔支持

**问题**：

- ✅ **问题1**：tavern-integration 使用 `api.events` 错误
- ✅ **问题6**：Extension 的 Gateway 方法未生效

**建议**：

1. **立即修复 tavern-integration**：改用 `api.eventBus`，在 `stop()` 中 off 监听
2. Gateway 启动后从 `registry.getGatewayMethods()` 注册 Extension 方法
3. HTTP 路由时机调整：Gateway(45) 与 Extension(50) 顺序调换，或延迟挂载
4. manifest 增加 `dependencies` 字段，支持拓扑排序

### 3.5 前端架构

**优点**：

- 多窗口架构清晰（Shell / Console / Browser）
- Pinia Stores 职责划分合理
- GatewayClient 单例，重连恢复机制完善
- Composables 复用性高（useStreamHandler 等）

**问题**：

- ✅ **问题12**：`ThreadView` 直接改 `chatStore.sessionId`
- `stream.resend_batch` payload 缺 sessionId，广播给所有 handler

**建议**：

1. 为 `sessionId` 和 `messages` 增加 action，统一入口
2. 后端 `stream.resend_batch` payload 附带 sessionId
3. `workerStore` 在 `workerCleanup` 中显式取消监听
4. 重连策略设置 `MAX_RECONNECT_ATTEMPTS` 上限（如 10 次）

### 3.6 数据存储与持久化

**优点**：

- SQLite WAL + 事务设计合理
- ConfigStore 原子写（tmp + rename）完善
- CheckpointManager 支持崩溃恢复

**问题**：

- ✅ **问题2**：Gateway brain 读文件，Worker brain 写文件
- ✅ **问题3**：ThreadStore、CheckpointManager 无锁并发写
- ✅ **问题9**：events.jsonl、tasks.jsonl 无限增长

**建议**：

1. **统一 Brain 数据访问**：Gateway `brain.*` 改为代理到 Brain Worker HTTP API
2. **ThreadStore 并发控制**：加文件锁或通过队列串行化写入
3. **Tavern 原子写**：tasks.jsonl 先写 tmp 再 rename
4. **events.jsonl 轮转**：按大小（10MB）或时间（每天）轮转归档
5. **SessionMemoryStore.clearHistory**：实现清空逻辑

### 3.7 配置系统与日志

**优点**：

- ConfigStore 原子写 + Zod 校验完善
- 配置热重载支持 Diff + ReloadPlan
- electron-log 支持命名 logger
- DevTools 集成便利

**问题**：

- ✅ **问题10**：监控指标分散无聚合
- ✅ **问题11**：日志非结构化

**建议**：

1. **统一监控**：增加 `GET /metrics` 端点，聚合 StreamMonitor、CostTracker、Worker 状态
2. **日志结构化**：可选 JSON 格式，增加 `traceId`、`sessionId`、`module` 字段
3. **成本暴露**：CostTracker 提供 HTTP API 或 UI 展示
4. **配置双轨统一**：梳理 electron-store 与 coobee.json5 职责

---

## 四、数据流分析

### 4.1 消息发送完整链路

```
用户输入 → ChatInput
  → chatStore.sendMessage()
  → GatewayClient.request('chat.send', params)
  → WebSocket → Gateway.handleRequest()
  → chatMethods.send
  → AgentExecutor.execute()
  → PiMonoBuilder / OpenAIBuilder
  → AgentRuntime.stream()
  → StreamEmitter.emit('stream.message')
  → EventBus → StreamBridge
  → Gateway.broadcastEventIf('stream.message')
  → WebSocket → 订阅客户端
  → useStreamHandler → chatStore.addMessage()
  → Vue 响应式更新 UI
```

### 4.2 Worker 状态流转

```
用户点击"启动" → WorkersSettings.vue
  → gateway.request('worker.start', {name})
  → WebSocket → workerMethods.start
  → WorkerManager.start(name)
  → ensureVenv() → spawnWorker() → waitForHealth()
  → WorkerManager.emit('worker:status')
  → EventBus → WorkerBridge
  → Gateway.broadcastEventIf('worker.status')
  → WebSocket → useWorkerWs
  → workerStore.updateWorkerStatus()
  → UI 更新
```

### 4.3 Extension 注册流转

```
ReadyExtensionHook
  → ExtensionLoader.loadAll([builtin, user, workspace])
  → load(extDir) → require(index.ts).default
  → extension.register(ExtensionApi)
  → registerTool() → ToolRegistry + ExtensionRegistry
  → registerGatewayMethod() → ExtensionRegistry
  → registerHttpRoute() → ExtensionRegistry
  → Gateway.start()
    → mountExtensionHttpRoutes(router) ✅
    → scanGatewayMethods() ❌ 未读 ExtensionRegistry
```

---

## 五、性能与可靠性评估

### 5.1 性能瓶颈

| 模块                          | 瓶颈点               | 影响                     | 缓解措施                    |
| ----------------------------- | -------------------- | ------------------------ | --------------------------- |
| **brain.list**                | 全量读目录并过滤     | 大数据量时慢（>1000 包） | 增量索引 + 分页优化         |
| **Tavern PATCH**              | 重写整个 tasks.jsonl | 任务多时 I/O 压力        | 按任务 ID 分文件或增量更新  |
| **files/tree**                | 递归构建目录树       | 深层目录慢               | 已有 depth≤5、每层≤200 限制 |
| **WorkerManager pip install** | 每次启动都执行       | 启动慢 5-10 秒           | 缓存检测（问题7）           |
| **Orchestrator eventQueue**   | setTimeout 轮询      | CPU 浪费                 | 改用 EventEmitter（建议）   |

### 5.2 并发安全

| 场景                       | 现状                       | 风险           | 建议             |
| -------------------------- | -------------------------- | -------------- | ---------------- |
| ThreadStore 并发写         | 无锁                       | 数据损坏       | 文件锁或队列     |
| Tavern 读写竞争            | Worker 与 Gateway 同时访问 | 不一致         | 加锁或统一数据源 |
| FileSession popItem        | 重写文件                   | 与 append 竞态 | 锁或队列         |
| SQLite                     | WAL 单连接                 | ✅ 安全        | -                |
| AgentExecutor busySessions | 单 session 串行            | ✅ 安全        | -                |

### 5.3 内存泄漏风险

| 组件                    | 风险点             | 现状                 | 建议            |
| ----------------------- | ------------------ | -------------------- | --------------- |
| busySessions            | 异常未清理         | ✅ finally 中 delete | -               |
| pendingApprovalSessions | 长期未审批         | ✅ TTL 2 小时        | -               |
| sessionApprovalCounters | 长期会话堆积       | ⚠️ 无 TTL            | 增加清理策略    |
| WorkerBridge            | worker:status 监听 | ❌ 无 cleanup        | 问题4：增加清理 |
| MessagePipeline queues  | 空闲队列           | ✅ 30 分钟 TTL       | -               |
| GatewayClient on        | 事件监听           | ✅ 返回取消函数      | -               |

### 5.4 容错与恢复

| 场景              | 机制                      | 评价            |
| ----------------- | ------------------------- | --------------- |
| Worker 崩溃       | 指数退避重启，maxRestarts | ✅ 完善         |
| JSON 损坏         | ConfigStore 有 tmp+rename | ✅ 部分覆盖     |
| SQLite 崩溃       | WAL 自动恢复              | ✅ 完善         |
| CheckpointManager | findPending 恢复          | ✅ 支持崩溃恢复 |
| events.jsonl 中断 | 无校验                    | ⚠️ 可能损坏     |

---

## 六、安全性评估

### 6.1 沙箱机制

| 层级         | 措施                     | 覆盖率 | 评价                               |
| ------------ | ------------------------ | ------ | ---------------------------------- |
| **路径安全** | path-guard 防穿越        | 95%    | ✅ 读操作 readOnly=true 不检查边界 |
| **命令安全** | exec-policy 黑/白名单    | 90%    | ✅ 动态学习需防篡改                |
| **命令扫描** | command-scanner 敏感路径 | 80%    | ✅ 补充防护                        |
| **工具权限** | tool-policy allow/deny   | 85%    | ✅ 可配置                          |
| **委托限制** | SUB_AGENT_BLOCKED_TOOLS  | 100%   | ✅ 防止递归                        |

### 6.2 Extension 安全

- **无沙箱**：Extension 在主进程运行，与核心代码同权限
- **信任模型**：builtin 免检，user/workspace 有警告但允许
- **命名空间保护**：chat、stream、worker、hitl 不可注册 ✅
- **路径检查**：Skill 目录禁止 `..` 穿越 ✅

### 6.3 API Key 管理

- `secrets.json5` 独立目录，权限 600 ✅
- ConfigStore 写入前 `stripSecretsApiKeys` 脱敏 ✅
- 环境变量 `${VAR_NAME}` 支持 ✅
- ⚠️ **问题**：前端 UI 中 API Key 输入无显隐切换，易被肩窥

---

## 七、测试覆盖分析

### 7.1 单元测试覆盖率（估算）

| 模块              | 测试文件数 | 覆盖率估算 | 评价                        |
| ----------------- | ---------- | ---------- | --------------------------- |
| **Gateway**       | 7          | 85%        | ✅ 核心路径覆盖完整         |
| **AI Runtime**    | 15+        | 75%        | ✅ PiMono、Pipeline 有测    |
| **Extension**     | 7          | 80%        | ✅ 核心逻辑有测             |
| **WorkerManager** | 3          | 70%        | ⚠️ 健康检查、重启逻辑可加强 |
| **ThreadStore**   | 2          | 60%        | ⚠️ 并发写、损坏恢复未测     |
| **前端**          | 0          | 0%         | ❌ 无自动化测试             |

### 7.2 集成测试

- ✅ `real-integration.test.ts`：单 Agent、工具调用、委托、Orchestrator、Swarm 全流程
- ✅ Brain Worker：`test_integration.py` HTTP API 测试
- ✅ Tavern Worker：`test_integration.py` HTTP API 测试
- ❌ Gateway + Worker 端到端测试：缺失
- ❌ 前端 + Gateway 集成测试：缺失

### 7.3 测试盲点

1. **并发场景**：ThreadStore、CheckpointManager 并发写未测
2. **故障恢复**：JSON 损坏、Worker 假死恢复未测
3. **前端**：无 Vue Test Utils 测试
4. **Extension 集成**：Gateway 方法、HTTP 路由挂载未测

---

## 八、改进方案优先级矩阵

```
影响 ↑
高   │ ① tavern-integration      ② Brain 双写路径
     │ ③ 并发写锁                ④ WorkerBridge 泄漏
     │
中   │ ⑤ stream 错误一致性       ⑥ Extension Gateway 方法
     │ ⑦ Worker 依赖检测         ⑧ Worker 健康检查
     │ ⑨ 文件无限增长
     │
低   │ ⑩ 监控聚合                ⑪ 日志结构化
     │ ⑫ 前端数据流
     │
     └────────────────────────────────────→ 实施难度
       低                中                高
```

### 8.1 Q1（2026-Q1）优先项

**立即修复（1 周内）**：

1. ✅ **问题1**：修复 tavern-integration API 错误
2. ✅ **问题4**：WorkerBridge 增加 cleanup

**计划优化（2-4 周）**：3. ✅ **问题2**：统一 Brain 数据访问路径 4. ✅ **问题3**：ThreadStore / Tavern 原子写 + 并发控制 5. ✅ **问题5**：统一 stream 方法错误处理 6. ✅ **问题6**：Extension Gateway 方法生效

### 8.2 Q2（2026-Q2）优化项

7. ✅ **问题7**：Worker 依赖缓存检测
8. ✅ **问题8**：Worker 运行期健康检查
9. ✅ **问题9**：events.jsonl / tasks.jsonl 轮转归档
10. ✅ Orchestrator eventQueue 改用 EventEmitter
11. ✅ 补充并发写、故障恢复测试

### 8.3 Q3（2026-Q3）增强项

12. ✅ **问题10**：统一监控指标聚合（/metrics 端点）
13. ✅ **问题11**：日志结构化（可选 JSON + traceId）
14. ✅ **问题12**：前端数据流规范化
15. ✅ 前端 Vue Test Utils 测试覆盖
16. ✅ Gateway + Worker 端到端测试

---

## 九、详细改进建议

### 9.1 问题1：tavern-integration API 错误【高优先级】

**现状**：

- 使用 `api.events?.on` / `api.events?.emit`，但 `ExtensionApi` 只有 `api.eventBus` 和 `api.services.events`
- `api.events` 为 undefined，所有事件监听和发送失效

**影响**：酒馆集成功能完全不可用

**改进方案**：

```typescript
// extensions/tavern-integration/index.ts

// ❌ 旧代码
api.events?.emit('external.tavern.task.created', body.task);
api.events?.on('external.tavern.task.created', async (task: unknown) => {

// ✅ 新代码
api.eventBus.emit('external.tavern.task.created', body.task);

// 在 stop() 或 unregister() 中清理
const offListener = api.eventBus.on('external.tavern.task.created', async (task: unknown) => {
  // ...
});

// 存储清理函数
let cleanupListeners: Array<() => void> = [];
cleanupListeners.push(offListener);

// unregister 中调用
unregister: () => {
  cleanupListeners.forEach(fn => fn());
  cleanupListeners = [];
}
```

**测试验证**：

- 创建任务 → 验证 Extension 能收到 `external.tavern.task.created` 事件
- unload Extension → 验证 EventBus 监听器已移除

**预计工时**：2 小时

---

### 9.2 问题2：Brain 双写路径不一致【高优先级】

**现状**：

- Gateway `brain.*` 方法直接读 `.home/brain/packages/`
- Brain Worker HTTP API 写入同一目录
- 索引可能不同步（Worker 维护 `index/`，Gateway 不读）

**影响**：数据不一致，Gateway 看到的经验包可能不完整

**改进方案（方案A - 推荐）**：

**Gateway 代理到 Brain Worker**

```typescript
// src/main/gateway/methods/brain.ts

async function forwardToBrainWorker<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const worker = WorkerManager.getInstance().get('brain');
  if (!worker || worker.status !== 'ready') {
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Brain Worker not ready');
  }

  const url = `http://127.0.0.1:${worker.config.port}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!res.ok) {
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, await res.text());
  }

  return res.json();
}

export const brainMethods: MethodGroup = {
  namespace: 'brain',
  methods: {
    stats: async () => {
      return forwardToBrainWorker('/api/brain/stats');
    },
    list: async (params) => {
      const query = new URLSearchParams(params as Record<string, string>);
      return forwardToBrainWorker(`/api/brain/packages?${query}`);
    },
    get: async (params) => {
      const { packageId } = params;
      return forwardToBrainWorker(`/api/brain/packages/${packageId}`);
    },
    delete: async (params) => {
      const { packageId } = params;
      return forwardToBrainWorker(`/api/brain/packages/${packageId}`, { method: 'DELETE' });
    }
  }
};
```

**优点**：

- 数据访问路径统一
- 索引由 Worker 维护，保证一致性
- Gateway 无需关心文件格式变更

**缺点**：

- 依赖 Worker 启动（需 autoStart: true 或提前启动）

**测试验证**：

- Worker 未启动 → Gateway 返回错误
- Worker 启动 → Gateway 能正常读取
- Worker 发布新包 → Gateway 立即能 list 到

**预计工时**：4 小时

---

### 9.3 问题3：并发写锁【高优先级】

**现状**：

- `ThreadStore.update()`、`CheckpointManager.write()` 直接 `fs.writeFileSync` 覆盖
- 多请求并发写同一 thread 或 checkpoint，可能数据损坏

**影响**：高并发场景数据丢失

**改进方案**：

**方案A：文件锁（推荐）**

```typescript
import lockfile from 'proper-lockfile';

class ThreadStore {
  async update(id: string, updates: Partial<Thread>): Promise<void> {
    const filePath = path.join(this.threadsDir, `${id}.json`);

    // 获取锁
    const release = await lockfile.lock(filePath, { retries: 10 });

    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };

      // 原子写入（先写 tmp 再 rename）
      const tmpPath = `${filePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2));
      fs.renameSync(tmpPath, filePath);

      // 更新内存索引
      this.updateIndex(id, updated);
    } finally {
      await release();
    }
  }
}
```

**方案B：队列串行化**

```typescript
import PQueue from 'p-queue';

class ThreadStore {
  private writeQueue = new PQueue({ concurrency: 1 });

  async update(id: string, updates: Partial<Thread>): Promise<void> {
    return this.writeQueue.add(async () => {
      // ... 写入逻辑
    });
  }
}
```

**同理应用到**：

- `CheckpointManager.write()`
- Tavern Worker `write_tasks_index()`

**测试验证**：

- 并发 10 个 `thread.update` 请求 → 数据完整，无损坏
- 写入中断（kill -9） → 重启后读取到完整或旧数据（无半成品）

**预计工时**：6 小时

---

### 9.4 问题4：WorkerBridge 泄漏【高优先级】

**现状**：

- `WorkerBridge` 在 EventBus 上注册 `worker:status` 监听
- Gateway.close() 时未清理

**影响**：热重载或测试场景下内存泄漏

**改进方案**：

```typescript
// src/main/gateway/events/WorkerBridge.ts

export function createWorkerBridge(gateway: Gateway): EventBridgeCleanup {
  const offListener = eventBus.on('worker:status', (data: WorkerStatus) => {
    gateway.broadcastEventIf('worker.status', data);
  });

  return () => {
    offListener();
  };
}

// src/main/gateway/Gateway.ts
class Gateway {
  private cleanups: Array<() => void> = [];

  async start() {
    // ...
    this.cleanups.push(createWorkerBridge(this));
  }

  async close() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    // ...
  }
}
```

**测试验证**：

- Gateway 启动 → WorkerBridge 注册监听
- Gateway 关闭 → EventBus 上无残留监听器

**预计工时**：1 小时

---

### 9.5 问题6：Extension Gateway 方法生效【中优先级】

**现状**：

- Extension 通过 `registerGatewayMethod` 注册
- Gateway 的 `scanGatewayMethods` 只扫描文件系统，未读 ExtensionRegistry

**影响**：Extension 的 RPC 方法注册后不可用

**改进方案**：

```typescript
// src/main/gateway/Gateway.ts

private async discoverMethods(): Promise<void> {
  // 1. 扫描文件系统（builtin）
  const builtinMethods = await scanGatewayMethods();
  for (const [namespace, group] of Object.entries(builtinMethods)) {
    this.registerMethodGroup(namespace, group);
  }

  // 2. 读取 ExtensionRegistry（Extension）
  const extMethods = ExtensionManager.getInstance().getRegistry().getGatewayMethods();
  for (const [namespace, group] of extMethods.entries()) {
    this.registerMethodGroup(namespace, group);
  }
}

// 支持动态注册（热插拔）
public registerMethodGroup(namespace: string, group: MethodGroup): void {
  if (this.protectedNamespaces.has(namespace)) {
    throw new Error(`Namespace ${namespace} is protected`);
  }
  this.methods.set(namespace, group);
  group.onInit?.(this.getApiForMethodGroup(namespace));
}

public unregisterMethodGroup(namespace: string): void {
  this.methods.delete(namespace);
}
```

**ExtensionLoader 集成**：

```typescript
// src/main/common/extension/ExtensionLoader.ts

async load(dir: string, origin: ExtensionOrigin): Promise<void> {
  // ... 加载逻辑

  // 注册 Gateway 方法
  const gateway = await import('@main/gateway').then(m => m.gateway);
  for (const [namespace, group] of registry.getGatewayMethods().entries()) {
    if (gateway.isStarted()) {
      gateway.registerMethodGroup(namespace, group);
    }
  }
}

async unload(manifestId: string): Promise<void> {
  // ... 卸载逻辑

  // 注销 Gateway 方法
  const gateway = await import('@main/gateway').then(m => m.gateway);
  const methods = this.registry.getGatewayMethods();
  for (const [namespace, group] of methods.entries()) {
    if (group.extensionId === manifestId && gateway.isStarted()) {
      gateway.unregisterMethodGroup(namespace);
    }
  }
}
```

**测试验证**：

- Extension 注册方法 → 前端能调用
- Extension unload → 方法不可用

**预计工时**：3 小时

---

### 9.6 问题7：Worker 依赖缓存【中优先级】

**现状**：

- 每次 `WorkerManager.start()` 都执行 `uv pip install`
- 即使依赖未变更，仍需 5-10 秒

**影响**：启动慢，用户体验差

**改进方案**：

```typescript
// src/main/common/worker/WorkerManager.ts

private async shouldReinstallDeps(worker: ManagedWorker): Promise<boolean> {
  const { dir, config } = worker;
  const requirementsPath = path.join(dir, config.requirementsFile || 'requirements.txt');
  const lockPath = path.join(dir, '.deps.lock');

  // 无 requirements.txt
  if (!fs.existsSync(requirementsPath)) return false;

  // 无 lock 文件，首次安装
  if (!fs.existsSync(lockPath)) return true;

  // 比对 requirements.txt 的 hash
  const currentHash = await hashFile(requirementsPath);
  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));

  return currentHash !== lockData.hash;
}

private async ensureVenv(worker: ManagedWorker): Promise<void> {
  // ... 创建 venv 逻辑

  if (await this.shouldReinstallDeps(worker)) {
    log.info(`Installing dependencies for ${name}...`);
    const result = await this.runCommand(/* uv pip install */);

    // 写入 lock
    const hash = await hashFile(requirementsPath);
    fs.writeFileSync(lockPath, JSON.stringify({ hash, timestamp: Date.now() }));
  } else {
    log.info(`Dependencies up-to-date for ${name}, skipping install`);
  }
}

function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
```

**效果**：

- 依赖未变更：启动 < 2 秒
- 依赖变更：正常安装 5-10 秒

**测试验证**：

- 首次启动 → 安装依赖
- 再次启动 → 跳过安装
- 修改 requirements.txt → 重新安装

**预计工时**：3 小时

---

### 9.7 问题8：Worker 运行期健康检查【中优先级】

**现状**：

- 仅启动时 `waitForHealth()`
- Worker 运行期假死或挂起无法发现

**影响**：Worker 不可用但前端仍显示"运行中"

**改进方案**：

```typescript
// src/main/common/worker/WorkerManager.ts

private healthCheckIntervals = new Map<string, NodeJS.Timeout>();

private startPeriodicHealthCheck(worker: ManagedWorker): void {
  const interval = 60000; // 每分钟检查

  const timer = setInterval(async () => {
    if (worker.status !== 'ready') return;

    try {
      const url = `http://127.0.0.1:${worker.config.port}${worker.config.healthCheckPath || '/health'}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (!res.ok) {
        log.warn(`[WorkerManager] Health check failed for ${worker.name}: ${res.status}`);
        this.handleHealthCheckFailure(worker);
      }
    } catch (err) {
      log.error(`[WorkerManager] Health check error for ${worker.name}:`, err);
      this.handleHealthCheckFailure(worker);
    }
  }, interval);

  this.healthCheckIntervals.set(worker.name, timer);
}

private handleHealthCheckFailure(worker: ManagedWorker): void {
  this.updateWorkerStatus(worker.name, 'error', 'Health check failed');

  // 可选：自动重启
  if (worker.config.autoRestart !== false) {
    log.info(`[WorkerManager] Restarting ${worker.name} due to health check failure...`);
    this.restart(worker.name);
  }
}

private stopPeriodicHealthCheck(name: string): void {
  const timer = this.healthCheckIntervals.get(name);
  if (timer) {
    clearInterval(timer);
    this.healthCheckIntervals.delete(name);
  }
}

async stop(name: string): Promise<void> {
  this.stopPeriodicHealthCheck(name);
  // ...
}
```

**配置**：

```json
// workers/brain/worker.json
{
  "healthCheckInterval": 60000,
  "healthCheckTimeout": 5000,
  "autoRestartOnHealthFail": true
}
```

**测试验证**：

- Worker 运行正常 → 状态保持 ready
- 手动 kill Worker 进程 → 1 分钟内检测到并重启

**预计工时**：4 小时

---

### 9.8 问题9：文件轮转归档【中优先级】

**现状**：

- `events.jsonl`、`tasks.jsonl` 无限增长
- 长期运行磁盘空间风险

**影响**：磁盘占满、读取变慢

**改进方案**：

```typescript
// src/main/ai/runtime/shared/AgentEventWriter.ts

class AgentEventWriter {
  private maxSize = 10 * 1024 * 1024; // 10MB

  private async checkRotate(): Promise<void> {
    const stats = fs.statSync(this.eventPath);
    if (stats.size > this.maxSize) {
      await this.rotate();
    }
  }

  private async rotate(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const archivePath = this.eventPath.replace('.jsonl', `.${timestamp}.jsonl`);

    fs.renameSync(this.eventPath, archivePath);
    fs.writeFileSync(this.eventPath, ''); // 新文件

    log.info(`[AgentEventWriter] Rotated ${this.eventPath} to ${archivePath}`);

    // 可选：压缩旧文件
    // await gzip(archivePath);
  }

  emit(event: StreamEvent): void {
    // ...
    this.checkRotate();
  }
}
```

**Tavern Worker 同理**：

```python
# workers/tavern/tavern/storage.py

MAX_INDEX_SIZE = 10 * 1024 * 1024  # 10MB

def write_tasks_index(tasks: List[dict]):
    index_path = get_tasks_index_path()

    # 检查大小
    if os.path.exists(index_path) and os.path.getsize(index_path) > MAX_INDEX_SIZE:
        rotate_index()

    # 写入
    with open(index_path, 'w') as f:
        for task in tasks:
            f.write(json.dumps(task, ensure_ascii=False) + '\n')

def rotate_index():
    index_path = get_tasks_index_path()
    timestamp = datetime.now().isoformat().replace(':', '-')
    archive_path = index_path.replace('.jsonl', f'.{timestamp}.jsonl')

    os.rename(index_path, archive_path)
    log.info(f"Rotated {index_path} to {archive_path}")
```

**清理策略**：

- 保留最近 N 个归档（如 10 个）
- 或保留最近 M 天（如 30 天）
- 定期清理超出限制的归档

**测试验证**：

- 写入超过 10MB → 自动轮转
- 轮转后新文件从空开始

**预计工时**：4 小时

---

### 9.9 问题10：统一监控聚合【低优先级】

**现状**：

- `StreamMonitor`、`SwarmMonitor`、`CostTracker` 各自维护指标
- 无统一入口，无 UI 展示

**影响**：可观测性不足，问题排查困难

**改进方案**：

**增加 /metrics 端点**

```typescript
// src/main/gateway/http/metrics.ts

export function registerMetricsRoutes(router: Router): void {
  router.get('/gateway/metrics', async (ctx) => {
    const metrics = {
      streams: StreamMonitor.getAllStats(),
      swarm: SwarmMonitor.getGlobalStats(),
      cost: CostTracker.getSummary(),
      workers: WorkerManager.getInstance()
        .list()
        .map((w) => ({
          name: w.name,
          status: w.status,
          pid: w.pid,
          uptime: w.process ? Date.now() - w.startedAt : 0,
          restartCount: w.restartCount
        })),
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      }
    };

    ctx.body = metrics;
  });
}
```

**前端集成**：

在 SettingsView 增加"监控"面板，展示：

- 当前活跃会话数
- 工具调用总数
- API 成本统计
- Worker 状态
- 系统资源

**预计工时**：6 小时

---

### 9.10 问题11：日志结构化【低优先级】

**现状**：

- 日志格式为 `[时间] [级别] 文本`
- 无 JSON、无 traceId/sessionId

**影响**：日志分析、聚合、检索困难

**改进方案**：

**可选 JSON 格式**

```typescript
// src/main/common/logger.ts

export interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  traceId?: string;
  sessionId?: string;
  data?: unknown;
}

export class Log {
  private jsonMode = Env.main.logFormat === 'json';

  info(message: string, data?: { traceId?: string; sessionId?: string; [key: string]: unknown }): void {
    if (this.jsonMode) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        module: this.name,
        message,
        ...data
      };
      this.logger.info(JSON.stringify(entry));
    } else {
      this.logger.info(`[${this.name}] ${message}`, data);
    }
  }
}
```

**配置**：

```json5
// coobee.json5
{
  logging: {
    level: 'info',
    format: 'json', // or "text"
    includeTraceId: true
  }
}
```

**traceId 传播**：

- Gateway 收到请求时生成 `traceId`
- 传递到 AgentExecutor、ToolExecutionPipeline
- 日志中自动附加

**预计工时**：5 小时

---

## 十、总结与展望

### 10.1 核心优势

1. **架构清晰**：分层职责明确，模块解耦良好
2. **可扩展性强**：Extension、Tool、Provider 插件化完善
3. **AI 能力完整**：三种运行模式、沙箱、审批、记忆系统
4. **开发体验好**：TypeScript 全链路、HMR、测试覆盖核心路径

### 10.2 主要不足

1. **数据层**：并发控制不足，文件写入缺少原子性
2. **可观测性**：监控分散，日志非结构化
3. **资源管理**：Worker 依赖安装、健康检查待优化
4. **一致性**：Brain 双写路径、Extension 集成有缺陷

### 10.3 改进路线图

```
2026-Q1：【稳定性】修复 4 个高优先级问题
  - tavern-integration API 错误
  - Brain 双写路径统一
  - 并发写锁
  - WorkerBridge 泄漏

2026-Q2：【性能】优化 5 个中优先级问题
  - stream 错误一致性
  - Extension Gateway 方法
  - Worker 依赖缓存
  - Worker 健康检查
  - 文件轮转归档

2026-Q3：【可观测性】增强监控与测试
  - 统一监控聚合
  - 日志结构化
  - 前端测试覆盖
  - 端到端测试
```

### 10.4 长期演进方向

1. **多租户支持**：用户隔离、配额管理
2. **分布式部署**：Worker 远程化、负载均衡
3. **数据湖集成**：DuckDB + Parquet 深度分析
4. **插件市场**：Extension 生态建设
5. **AI 自优化**：根据使用数据自动调优参数

---

**报告生成时间**：2026-02-23  
**生成方式**：多智能体并行分析 + 人工汇总  
**下一步行动**：请确认改进方案优先级，我们开始实施
