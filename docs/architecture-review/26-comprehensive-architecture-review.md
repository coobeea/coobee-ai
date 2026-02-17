# 第二十六轮 — 全维度综合架构审查

> 编号：26 | 日期：2026-02-17 | 类型：全维度综合审查
> 方法：代码走查 + 历史分析回顾 + 子系统深度探查
> 覆盖范围：Backend AI 全栈 + Frontend 全栈 + 构建系统 + 多 Agent 系统

---

## 一、架构全景

### 1.1 系统分层

```
┌──────────────────────────────────────────────────────────┐
│                  Frontend (Renderer)                      │
│  Vue 3 + Pinia + Gateway WebSocket + Tailwind CSS 4      │
├──────────────────────────────────────────────────────────┤
│                  Gateway (RPC + Events)                   │
│  WebSocket Server + Method Router + Event Bridge          │
├──────────────────────────────────────────────────────────┤
│                  AI 执行层                                │
│  AgentExecutor + MessagePipeline + ToolExecutionPipeline │
├──────────────────────────────────────────────────────────┤
│                  AI Runtime 层                            │
│  PiMono (活跃) │ OpenAI (休眠) │ Teams/Swarm (死代码)   │
├──────────────────────────────────────────────────────────┤
│                  基础设施层                               │
│  Config + Provider + Skills + Extensions + Lifecycle     │
├──────────────────────────────────────────────────────────┤
│                  Electron 主进程                          │
│  IPC + Window + Worker + Database                        │
└──────────────────────────────────────────────────────────┘
```

### 1.2 核心数据流

```
用户输入 → chat.send(Gateway)
  → MessagePipeline.submit(sessionId, message)
    → builderFactory(mode) → PiMonoBuilder
    → AgentExecutor.execute(request)
      → injectEnv() → 环境/技能/协议/安全
      → runtime.stream(message)
        → PiMono SDK → LLM API
        → yield StreamChunk
      → consumeAndForward(gen, eventWriter)
        → AgentEventWriter → events.jsonl
        → StreamEmitter → EventBus
          → StreamBridge → Gateway WS → Frontend
            → chatStore.handleStreamMessage()
              → UI 渲染
```

### 1.3 活跃系统 vs 休眠/死代码

| 系统                   | 状态         | 说明                             |
| ---------------------- | ------------ | -------------------------------- |
| PiMono Runtime         | **活跃**     | 唯一正在使用的 Runtime           |
| OpenAI Runtime         | **休眠**     | 实现完整、测试通过，但无产品入口 |
| Teams Runtime          | **死代码**   | 标注 @deprecated，无产品入口     |
| Swarm Runtime          | **死代码**   | 无产品入口                       |
| Orchestration          | **死代码**   | 仅 TeamRuntime 引用              |
| Memory 高级存储        | **设计储备** | 标注 @experimental，未集成       |
| MessagePipeline        | **活跃**     | T-1/T-2/T-3 竞态已修复           |
| Multi-Agent (delegate) | **活跃**     | 新实现，单层委托                 |
| task_plan 工具         | **活跃**     | 新实现，任务计划管理             |

---

## 二、问题发现（按严重程度分级）

### 2.1 P0 — 关键缺陷（必须修复，影响核心功能或稳定性）

#### P0-1: tool-approval 使用不存在的 ConfigStore.getInstance()

**位置**: `extensions/tool-approval/index.ts:236-237`
**现象**: `ConfigStore.getInstance()` 不存在；ConfigStore 导出的是 `configStoreInstance` 全局变量
**后果**: 自定义审批超时配置 `security.approvals.timeoutMs` 永远不会生效，始终使用默认值 300s
**修复**:

```typescript
// 修改为
const { configStoreInstance } = await import('../../src/main/common/config/ConfigStore')
const approvals = configStoreInstance?.get?.('security')?.approvals
return approvals?.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
```

#### P0-2: 前端 selectedDir 未传递给后端

**位置**: `src/renderer/src/views/AgentView.vue` + `src/renderer/src/stores/chat.ts`
**现象**: 用户在 AgentView 的欢迎页选择了工作目录 `selectedDir`，但 `chat.send` 并未将该目录传给后端
**后果**: 后端始终使用 `Env.getAgentWorkspaceDir(sessionId)` 自动生成工作目录，用户选择的目录毫无作用
**修复**: `chat.send` 接口增加 `workspaceDir` 参数；后端 `chat.ts` 接收后传递给 Builder

#### P0-3: WebSocket 重连后不补发历史消息

**位置**: `src/renderer/src/composables/useStreamWs.ts`
**现象**: 重连后只调用 `stream.subscribe`，未调用 `stream.resend` 补发断连期间的消息
**后果**: 断连期间的流式消息永久丢失，用户看到不完整的回复
**修复**: 重连后根据本地最新 sequence 调用 `stream.resend` 补发

#### P0-4: HttpServer 端口占用无 error 监听

**位置**: `src/main/common/server/httpServer.ts`
**现象**: `httpServer.listen()` 只有成功回调，未监听 `error` 事件
**后果**: 端口被占用时 EADDRINUSE 未被捕获，应用闪退无提示
**修复**: 添加 `this.httpServer.on('error', handler)`，提示用户端口冲突

#### P0-5: 配置文件运行中被删除不自动重建

**位置**: `src/main/common/config/ConfigLoader.ts`
**现象**: 配置文件被删除后返回默认配置，不触发自动重建
**后果**: 用户之前的配置永久丢失，且无提示
**修复**: ConfigWatcher 检测到文件删除时调用 `ensureConfigFile()`

---

### 2.2 P1 — 重要问题（应尽快修复，影响可靠性或开发效率）

#### P1-1: Extension 热重载不更新 ToolRegistry

**位置**: `src/main/common/extension/ExtensionLoader.ts`
**现象**: `handleWatchEvent()` 中 `unload()` 只清除 ExtensionRegistry，不更新 ToolRegistry
**后果**: Extension 卸载后其工具仍残留在 ToolRegistry 中

#### P1-2: 全局错误事件 SYSTEM_ERROR 无消费者

**位置**: `src/renderer/src/api/request.ts` → emits `system:error`
**现象**: 前端发出了 `SYSTEM_ERROR` 事件，但无任何组件监听
**后果**: HTTP/IPC 层面的错误对用户完全不可见

#### P1-3: Agent 创建时 agentId 路径绕过 Pipeline

**位置**: `src/main/gateway/methods/chat.ts`
**现象**: 当 `chat.send` 包含 `agentId` 时，直接调用 `submit()` 而非 `submitViaPipeline()`
**后果**: 绕过了消息队列、合并、中断等 Pipeline 能力，行为不一致

#### P1-4: ToolRegistry 命名误导

**位置**: `src/main/ai/tools/ToolRegistry.ts`
**现象**: `ToolRegistry` 只存储 Extension 工具，Built-in 工具在 `builtinTools` 数组中
**后果**: API 名称误导开发者；`getAll()` 返回的不是"所有工具"

#### P1-5: ExtensionLoader 使用 console 而非 logger

**位置**: `src/main/common/extension/ExtensionLoader.ts`
**现象**: 使用 `console.*` 输出日志
**后果**: Extension 加载日志不进入 electron-log，无法持久化和查看

#### P1-6: Error Recovery maxAttempts 不可配置

**位置**: `src/main/ai/runtime/ErrorRecoveryChain.ts`
**现象**: `maxAttempts` 固定为 3，无法通过配置调整
**后果**: 不同使用场景（如弱网环境）无法灵活调整重试策略

#### P1-7: 前端 agents.error 不展示

**位置**: `src/renderer/src/stores/agents.ts`
**现象**: `agents.error` 在 fetch 失败时设置，但 AgentsPanel 不显示该错误
**后果**: Agent 列表加载失败时用户无感知

#### P1-8: LogViewer "返回"按钮链接错误

**位置**: `src/renderer/src/views/LogViewer.vue`
**现象**: "返回"链接到 `/chat` 而不是 `/agent`
**后果**: 点击后 404 或路由不匹配

#### P1-9: ProjectPanel 与 AgentView 目录状态不同步

**位置**: `src/renderer/src/components/agent/ProjectPanel.vue` vs `AgentView.vue`
**现象**: ProjectPanel 用独立的 `projectPath`，AgentView 用 `selectedDir`，两者不共享
**后果**: 两处选择的目录互相不知道，功能割裂

---

### 2.3 P2 — 改进项（可在迭代中逐步处理）

| ID    | 类型     | 问题                                                  | 位置                                          |
| ----- | -------- | ----------------------------------------------------- | --------------------------------------------- |
| P2-1  | 死代码   | Teams/Swarm/Orchestration 约 3000+ 行死代码           | `ai/teams/`, `ai/swarm/`, `ai/orchestration/` |
| P2-2  | 死代码   | OpenAI Runtime 已实现但无产品入口                     | `ai/runtime/openai/`                          |
| P2-3  | 死代码   | Memory 高级存储（SessionMemory, ShortTerm, LongTerm） | `ai/memory/`                                  |
| P2-4  | 功能缺失 | ProjectPanel 文件树未实现                             | `components/agent/ProjectPanel.vue`           |
| P2-5  | 功能缺失 | WorkbenchPanel 文件浏览未实现                         | `components/agent/WorkbenchPanel.vue`         |
| P2-6  | 功能缺失 | Agent 编辑 UI 缺失（后端已有 agents.get）             | `components/agent/AgentsPanel.vue`            |
| P2-7  | 类型安全 | SettingsView 中大量 `as` 强转                         | `views/SettingsView.vue`                      |
| P2-8  | 类型安全 | Stream payload 使用 `as` 强转无校验                   | `composables/useStreamWs.ts`                  |
| P2-9  | 一致性   | stores/index.ts 未导出 useAgentsStore/useWorkerStore  | `stores/index.ts`                             |
| P2-10 | 一致性   | 两套配置系统名称相似（ElectronStore vs ConfigStore）  | `common/config.ts` vs `ConfigStore.ts`        |
| P2-11 | 构建性能 | 主进程热更新 5.5s（12MB 单文件）                      | `electron.vite.config.ts`                     |
| P2-12 | 可观测   | destroyRuntime catch 丢失 stack trace                 | `AgentExecutor.ts`                            |
| P2-13 | 可观测   | ConfigWatcher 回调空 catch 无日志                     | `ConfigWatcher.ts`                            |
| P2-14 | 安全     | exec-policy 使用 require 可能路径解析失败             | `ai/sandbox/exec-policy.ts`                   |
| P2-15 | 功能缺失 | streamResend / streamLatestSequence 已实现但未使用    | `useStreamWs.ts`                              |
| P2-16 | 前端     | HomeView 不在路由中，疑似废弃                         | `views/HomeView.vue`                          |
| P2-17 | 一致性   | configStoreInstance 全局可变导出                      | `ConfigStore.ts`                              |

---

## 三、架构评估

### 3.1 优势

1. **统一的 AgentRuntime 接口** — PiMono/OpenAI 共享抽象，切换成本低
2. **ToolExecutionPipeline** — 集中管理 Hook、策略、审批，单一职责清晰
3. **StreamChunk 事件模型** — 30+ 事件类型，足够表达所有运行时行为
4. **ErrorRecoveryChain** — 分层恢复策略（认证→压缩→降级→重试），设计合理
5. **SkillManager 搜索路径覆盖** — builtin → extension → user → workspace，越后优先级越高
6. **Sandbox 多层防护** — path-guard + tool-policy + exec-policy + docker
7. **Lifecycle Hook 优先级分组** — 初始化顺序可控，critical/non-critical 分离
8. **文件系统即共享状态** — 多 Agent 协作通过目录约定，简单透明

### 3.2 待改进

1. **前后端状态断裂** — 前端选择的工作目录不影响后端，UI 控件形同虚设
2. **死代码体量大** — Teams/Swarm/Orchestration/Memory(advanced)/OpenAI Runtime 占比显著
3. **全局单例管理松散** — configStoreInstance/agentExecutor/hitlApprovalManager 等散落各处
4. **Extension 工具生命周期不完整** — 加载时注册、热重载时不清理
5. **前端错误处理碎片化** — 无全局错误 Toast/Modal，多处 catch 后静默
6. **构建性能** — 主进程 12MB 单文件导致热更新 5.5s

### 3.3 架构成熟度

```
Level 0: 功能实现     ← 第 1-4 轮已完成
Level 1: 基础健康     ← 第 5-8 轮已完成
Level 2: 深层质量     ← 第 9-10 轮已完成
Level 3: 运行时正确   ← 第 11 轮已开始，第 25 轮自我认知分析
Level 4: 生产就绪     ← 目标
```

当前处于 **Level 2 → Level 3 过渡阶段**，核心功能已实现，但前端体验、错误处理、死代码清理等方面距离生产就绪仍有差距。

---

## 四、子系统深度分析

### 4.1 多 Agent 系统（新实现）

**架构设计**:

- `manage_agent`: CRUD Agent 定义 → `.home/agents/{id}.json`
- `delegate_to_agent`: 单层委托 → `{workspace}/tasks/{taskId}/agents/{agentId}/`
- `task_plan`: 结构化计划 → `{workspace}/tasks/{taskId}/plan.md` + `status.json`
- 子 Agent 工具过滤: `delegate_to_agent`, `manage_agent`, `task_plan` 被屏蔽

**评估**:

- 单层限制合理，防止失控递归
- 文件系统共享状态（experiences/、results/）设计简洁
- `<workspace_conventions>` 注入到系统提示词，确保 LLM 知道约定

**问题**:

1. 子 Agent 创建的 session 目录独立于父 Agent 的 session，可能导致目录散落
2. `task_plan` 工具的 `handleUpdateStep` 等不 yield，需 eslint-disable（非最优）
3. 无法从前端可视化查看 task plan 的执行状态（前端未对接 tasks/ 目录）

### 4.2 Provider 系统

**架构设计**:

- ProviderRegistry: 从配置加载，支持多 Provider 并行
- ModelSelector: 4 级优先级（session → agent → global → builtin）
- ApiKeyResolver: 配置值 → ${ENV} 模板 → 已知环境变量 → 通用格式
- ModelFallback: 候选模型列表，逐个尝试

**评估**: 设计完善，支持灵活的模型选择和密钥管理

**问题**:

1. `ProviderRegistry.loadFromConfig` 对 `models` 字段无防御性检查
2. Provider 配置变更通过 ConfigWatcher 热重载，但重载失败无用户提示

### 4.3 前端架构

**架构设计**:

- Gateway WebSocket 作为主通信通道
- Pinia stores 管理各领域状态
- 流式消息通过 EventBus → chatStore 处理

**评估**: 基础架构合理，但多处功能停留在占位符阶段

**关键问题**:

1. AgentView 的"欢迎页 → 工作空间"两态设计存在，但选择的目录未影响后端行为（P0-2）
2. ProjectPanel 和 WorkbenchPanel 都是空壳，仅有占位文本
3. Agent 只能创建和删除，不能编辑
4. 无全局错误提示机制
5. 多个 Store 导出方式不一致

### 4.4 构建系统

**核心问题**: pi-SDK（ESM-only）强制内联打包导致 12MB 单文件，热更新 5.5s

**已识别的优化方案**:
| 方案 | 难度 | 收益 |
| --- | --- | --- |
| A. 开发模式代码分割 | 低 | 中 |
| B. pi-SDK 预编译为 CJS | 中 | 高 |
| C. WASM 复制优化 | 低 | 低 |
| D. esbuild 替代（仅开发） | 高 | 极高 |

---

## 五、与历轮对比

| 轮次   | 维度           | P0    | P1    | P2     | 特征                     |
| ------ | -------------- | ----- | ----- | ------ | ------------------------ |
| 9      | 横切面         | 3     | 7     | 5      | 隐藏 Bug                 |
| 10     | 契约/边界/时序 | 7     | 19    | 35     | 竞态+结构                |
| 11     | 端到端+恢复    | 5     | 7     | 11     | 链路断裂                 |
| 25     | 自我认知       | 0     | 3     | 0      | 认知盲区                 |
| **26** | **全维度综合** | **5** | **9** | **17** | **前后端断裂+死代码+DX** |

**趋势**:

- P0 数量稳定在 5 个左右，但性质从"代码 Bug"转向"架构断裂"（前后端不对接、功能形同虚设）
- 死代码体量是新发现的结构性问题，影响可维护性和构建性能
- 前端从"能用"到"好用"的差距是当前最大的用户体验瓶颈
