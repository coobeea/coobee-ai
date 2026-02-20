# 第三十四轮 — 四维度架构安全与并发问题深度分析

> 编号：34 | 日期：2026-02-20 | 类型：多智能体多维度系统分析
> 方法：启用 4 个专门智能体（Explore Subagents）并发进行代码走查
> 覆盖维度：Frontend 架构、Backend AI 调度、Main IPC/网关、System/Sandbox 安全

---

## 总体分析摘要

本轮通过多维度并发分析，深入挖掘了系统的潜在 Bug 和架构隐患，特别是高并发、生命周期管理以及安全边界上的问题。

**发现问题总计：** 12 个 P0 级（严重/安全/阻塞），20 个 P1 级（高优/功能缺失），22 个 P2 级（中低优/边界情况）。

---

## 维度一：Frontend UI 与状态管理

智能体关注点：Vue 3, Pinia, WebSockets, 组件生命周期

### P0 级问题

- **F-P0-1: Thread 切换竞态导致历史错乱**
  - `ThreadView.vue` 频繁切换线程时，异步的 `loadHistory` 无取消机制，导致后返回的历史记录可能覆盖当前激活的视图。
- **F-P0-2: Chat 与 Copilot 全局流式订阅冲突**
  - 两者共用后端的单路 `stream.subscribe`，一方发起消息会覆盖另一方的流监听，导致之前活跃的一方断流。

### P1 级问题

- **F-P1-1: workerCleanup 未调用导致 Worker 监听泄漏**
  - `App.vue` 卸载时清理了 Stream 和 Thread，遗漏了 `workerCleanup`。
- **F-P1-2: LayerManager ESC 快捷键监听泄漏**
  - 注册的第一层组件绑定了 `keydown`，但 `reset()` 清空栈时未 `removeEventListener`。
- **F-P1-3: Store 状态直接被外部修改**
  - `ChatPanel` 与 `CopilotBubble` 直接向 `messages` 数组 push 数据，破坏了单一数据流原则。
- **F-P1-4: EventBus `once` 包装导致 `off` 清理失效**
  - `once` 内部对 callback 做了匿名封装，导致组件卸载时调用 `off(原始回调)` 无法成功解绑。

---

## 维度二：Backend AI 执行层与多智能体调度

智能体关注点：MessagePipeline, AgentExecutor, Orchestrator, Swarm

### P0 级问题

- **B-P0-1: AgentPool 代理对象泄漏**
  - `SwarmCoordinator` 的 handoff 循环获取代理后，从未调用 `releaseAgent` 或 `retireAgent`，导致池无限增长且旧运行时驻留。
- **B-P0-2: SwarmCoordinator 共享状态无并发控制**
  - `coordinate()` 与 `coordinateParallel()` 直接并发修改实例的 `this.state`，导致状态损坏、进度汇报错乱。
- **B-P0-3: ToolExecutionPipeline 审批计数器竞态**
  - 针对同一 Session 的并发审批请求使用非原子操作累加 ID，导致产生重复的 `approvalId`，阻碍 Hitl 恢复。
- **B-P0-4: 队列状态与 Busy 状态不一致**
  - `MessagePipeline.isRunning` 与 `AgentExecutor.busySessions` 的设置存在时间差，导致重复入队判定失效。
- **B-P0-5: SessionQueue Message ID 生成器非线程安全**
  - 全局的计数器生成机制并发下产生重复的消息 ID。

### P1 级问题

- B-P1-1: WorkerCoordinator 遇到 error 状态的 worker 不会回收，导致 Worker 泄漏。
- B-P1-2: AgentEventWriter 在异常退出时无法 unregister。
- B-P1-3: Orchestrator `subTaskResults.clear()` 误删并发任务的结果。
- B-P1-4: ConcurrencyManager 在异常时漏减 `runningCount` 导致容量耗尽。
- B-P1-5: HitlApprovalManager 的清理操作在遍历中变异 Map，易触发错误。

---

## 维度三：Main Process、网关与 IPC 边界

智能体关注点：Electron 进程安全, Gateway Server, IPC Bridge

### P0 级问题

- **M-P0-1: Gateway Files API 任意文件读取漏洞**
  - `isPathSafe` 仅检查了 `..`，但 `path` 来自 query 参数且未限制在 `workspacesDir` 内，可读取 `/etc/passwd` 等敏感文件。
- **M-P0-2: Skills 导入 API 路径穿越漏洞**
  - `sourcePath` 缺乏根目录校验，`copyDirSync` 可被利用写入恶意文件或拉取越界目录。
- **M-P0-3: 跨窗口 Tab IPC 越权**
  - 允许调用方传入任意 `windowId`，使得一个窗口内的渲染进程可以恶意关闭或控制其他独立窗口的 Tab。

### P1 级问题

- M-P1-1: `HttpServer` 在应用退出时未调用 `close` 释放端口。
- M-P1-2: 网关配置接口 `config.set` 允许写入任意 key，存在配置注入风险。
- M-P1-3: GatewayServer `wss.close()` 未安全等待活动连接断开。
- M-P1-4: `EventBridgeInit` (Thread/Stream/Worker) 在网关关闭时未清理 eventBus 监听器。

---

## 维度四：System、Sandbox 与测试覆盖

智能体关注点：exec-policy, path-guard, 测试覆盖率

### P0 级问题

- **S-P0-1: Exec Policy `getAllowlistPath` 模块引用错误**
  - 错误 require 了 `common/config`，实际上 `Env` 位于 `common/env`。导致学习到的白名单**永远无法写入磁盘**（重启即丢）。
- **S-P0-2: `sed` 位于 `SAFE_BINS` 存在越权修改文件隐患**
  - `sed -i` 可以直接修改文件，如果将其列入绝对安全的白名单，LLM 可借此绕过 Write/Replace 工具的拦截审批。

### P1 级问题

- S-P1-1: `path-guard` 完全没有针对 Windows 驱动器和 UNC 路径的检测防御。
- S-P1-2: 若 Workspace 根目录不存在，`path-guard` 会跳过 symlink 检查，存在边界利用可能。
- S-P1-3: Docker 沙箱中依靠 Node 的 `timeout` 来杀除 spawn 进程并不完全可靠。
- S-P1-4: 核心模块 (AgentEnvInjector, ToolExecutionPipeline, DB 服务) 缺乏单元测试。
