# 第二十六轮 — 可执行开发计划

> 编号：27 | 日期：2026-02-17
> 来源：26-comprehensive-architecture-review.md
> 目标：将架构审查发现转化为可执行的开发任务，按优先级排序

---

## 一、开发阶段总览

```
阶段 1: 前后端对接修复（1-2天）   ← 堵住最大的功能漏洞
阶段 2: 关键缺陷修复（1-2天）     ← 消除 P0 问题
阶段 3: 前端体验升级（3-5天）     ← 从"能用"到"好用"
阶段 4: 架构健康治理（2-3天）     ← 清理死代码、统一模式
阶段 5: 构建与 DX 优化（1-2天）   ← 开发效率提升
阶段 6: 多 Agent 体验完善（2-3天）← 可视化和可观测性
```

---

## 二、阶段 1: 前后端对接修复（优先级最高）

> 目标：让前端 UI 控件的操作真正影响后端行为

### 任务 1.1: 工作目录传递 [P0-2]

**问题**: 用户在 AgentView 选择的工作目录未传给后端

**修改文件**:

1. `src/shared/gateway-protocol.ts` — `chat.send` 参数增加 `workspaceDir?: string`
2. `src/renderer/src/stores/chat.ts` — `sendMessage()` 传递 workspaceDir
3. `src/main/gateway/methods/chat.ts` — 接收 workspaceDir，传给 Builder
4. `src/main/ai/AgentExecutor.ts` — `ExecuteRequest` 增加 `workspaceDir`
5. `src/main/ai/AgentEnvInjector.ts` — `injectEnv()` 使用用户指定目录或默认目录

**验收标准**:

- [ ] 用户选择 `/Users/xxx/projects/my-app` 作为工作目录
- [ ] 后端 Agent 的 workspace 实际指向该目录
- [ ] 不选择目录时回退到默认行为 `Env.getAgentWorkspaceDir(sessionId)`

### 任务 1.2: ProjectPanel 与 AgentView 状态统一 [P1-9]

**问题**: ProjectPanel 的 `projectPath` 与 AgentView 的 `selectedDir` 互不关联

**方案**: 将工作目录状态提升到 `chatStore` 或新建 `workspaceStore`

**修改文件**:

1. `src/renderer/src/stores/chat.ts` — 增加 `workspaceDir` 状态
2. `src/renderer/src/views/AgentView.vue` — 使用 store 中的 workspaceDir
3. `src/renderer/src/components/agent/ProjectPanel.vue` — 读取并可修改 store 中的 workspaceDir

**验收标准**:

- [ ] 在欢迎页选择的目录，在 ProjectPanel 中也显示
- [ ] ProjectPanel 切换目录，AgentView 顶栏也更新

---

## 三、阶段 2: 关键缺陷修复

### 任务 2.1: 修复 tool-approval ConfigStore 调用 [P0-1]

**修改文件**: `extensions/tool-approval/index.ts`
**预计**: 30 分钟

```typescript
// Before (L236-237)
const { ConfigStore } = await import('../../src/main/common/config/ConfigStore')
const store = ConfigStore.getInstance()

// After
const { configStoreInstance } = await import('../../src/main/common/config/ConfigStore')
const approvals = configStoreInstance?.get?.('security')?.approvals
return approvals?.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
```

**验收标准**:

- [ ] 修改 `coobee.json5` 中 `security.approvals.timeoutMs` 后生效
- [ ] 未配置时使用默认值 300s

### 任务 2.2: WebSocket 重连消息补发 [P0-3]

**修改文件**: `src/renderer/src/composables/useStreamWs.ts`
**预计**: 1-2 小时

**方案**:

1. 在 `handleStreamMessage` 中维护 `lastSeq` 变量
2. 重连回调中调用 `gateway.request('stream.resend', { sessionId, fromSeq: lastSeq })`
3. 处理补发的消息时去重（基于 seq）

**验收标准**:

- [ ] 模拟网络断连后重连，流式消息不丢失
- [ ] 不产生重复消息

### 任务 2.3: HttpServer error 监听 [P0-4]

**修改文件**: `src/main/common/server/httpServer.ts`
**预计**: 30 分钟

**验收标准**:

- [ ] 端口被占用时给出明确错误提示，不闪退

### 任务 2.4: 配置文件删除自动重建 [P0-5]

**修改文件**: `src/main/common/config/ConfigWatcher.ts`
**预计**: 1 小时

**方案**: 在 `onFileChange('unlink')` 事件中调用 `ensureConfigFile()` 重建默认配置

**验收标准**:

- [ ] 手动删除 `coobee.json5` 后自动重建并写入默认配置
- [ ] 日志中有警告信息

---

## 四、阶段 3: 前端体验升级

### 任务 3.1: 全局错误提示机制 [P1-2]

**问题**: 无全局 Toast/Modal；SYSTEM_ERROR 事件无消费者

**方案**: 创建 `ErrorToast.vue` 全局组件 + `useGlobalError` composable

**修改文件**:

1. `src/renderer/src/components/common/ErrorToast.vue` — 新建
2. `src/renderer/src/composables/useGlobalError.ts` — 新建，监听 eventBus
3. `src/renderer/src/App.vue` — 挂载 ErrorToast
4. `src/renderer/src/stores/agents.ts` — 错误传播到全局

**验收标准**:

- [ ] Gateway 连接断开时显示错误提示
- [ ] Agent 加载失败时显示错误提示
- [ ] 错误提示可自动消失（5s）或手动关闭

### 任务 3.2: ProjectPanel 文件树 [P2-4]

**方案**: 递归读取用户选择的工作目录，显示为可折叠的文件树

**修改文件**:

1. `src/main/gateway/methods/filesystem.ts` — 新建，提供 `fs.readdir` 方法
2. `src/renderer/src/components/agent/ProjectPanel.vue` — 实现树形组件

**验收标准**:

- [ ] 显示用户选择目录的文件树
- [ ] 支持展开/折叠
- [ ] 点击文件可在 WorkbenchPanel 中预览

### 任务 3.3: WorkbenchPanel 基础功能 [P2-5]

**方案**: 将当前的静态目录列表替换为实际的文件内容查看器

**修改文件**:

1. `src/renderer/src/components/agent/WorkbenchPanel.vue` — 集成 Monaco Editor
2. `src/main/gateway/methods/filesystem.ts` — 增加 `fs.readFile` 方法

**验收标准**:

- [ ] 从 ProjectPanel 点击文件后在 WorkbenchPanel 显示内容
- [ ] 支持语法高亮（基于文件扩展名）

### 任务 3.4: Agent 编辑功能 [P2-6]

**修改文件**:

1. `src/main/gateway/methods/agents.ts` — 增加 `agents.update` 方法
2. `src/renderer/src/stores/agents.ts` — 增加 `updateAgent` action
3. `src/renderer/src/components/agent/AgentsPanel.vue` — 增加编辑模式

**验收标准**:

- [ ] 点击 Agent 可编辑其 name、description、instructions
- [ ] 保存后立即生效

### 任务 3.5: LogViewer 路由修复 [P1-8]

**修改文件**: `src/renderer/src/views/LogViewer.vue`
**预计**: 5 分钟

```html
<!-- Before -->
<router-link to="/chat">
  <!-- After -->
  <router-link to="/agent"></router-link
></router-link>
```

---

## 五、阶段 4: 架构健康治理

### 任务 4.1: 死代码清理

**方案**: 将死代码移到 `src/main/ai/_deprecated/` 目录，保留但不参与构建

**涉及**:

1. `src/main/ai/teams/` → `_deprecated/teams/`
2. `src/main/ai/swarm/` → `_deprecated/swarm/`
3. `src/main/ai/orchestration/` → `_deprecated/orchestration/`
4. `src/main/ai/memory/index.ts` + 高级存储 → `_deprecated/memory-advanced/`

**验收标准**:

- [ ] 移动后 `pnpm typecheck` 通过
- [ ] 移动后 `pnpm dev` 正常启动
- [ ] 主进程 bundle 大小减少（预计减少 200-500KB）

### 任务 4.2: 统一全局单例访问

**问题**: configStoreInstance 是可变全局导出，部分代码假设有 getInstance()

**方案**: 封装为 `getConfigStore()` 函数，内部懒初始化

**修改文件**:

1. `src/main/common/config/ConfigStore.ts` — 增加 `getConfigStore()` 导出
2. 全部消费者迁移到 `getConfigStore()`
3. 废弃 `configStoreInstance` 直接导出

**验收标准**:

- [ ] 所有 `configStoreInstance` 引用替换为 `getConfigStore()`
- [ ] 消除 `ConfigStore.getInstance()` 的误用风险

### 任务 4.3: Extension 工具生命周期修复 [P1-1]

**修改文件**: `src/main/common/extension/ExtensionLoader.ts`
**方案**: `unload()` 时调用 `ToolRegistry.unregister()` 清理该 Extension 注册的工具

**验收标准**:

- [ ] Extension 卸载后，其工具不再出现在可用工具列表中

### 任务 4.4: agentId 路径走 Pipeline [P1-3]

**修改文件**: `src/main/gateway/methods/chat.ts`
**方案**: agentId 场景也通过 `submitViaPipeline()`，Builder 创建使用 Agent Definition

**验收标准**:

- [ ] 使用 agentId 的 chat 也支持消息队列、合并、中断

### 任务 4.5: ToolRegistry 重构 [P1-4]

**方案**: ToolRegistry 同时管理 builtin 和 extension 工具，消除 chat.ts 中的手动合并

**修改文件**:

1. `src/main/ai/tools/ToolRegistry.ts` — 支持 `registerBuiltin()` 和 `registerExtension()`
2. `src/main/ai/tools/builtin/index.ts` — 启动时注册 builtin tools
3. `src/main/gateway/methods/chat.ts` — 简化为 `ToolRegistry.getInstance().getAll()`

---

## 六、阶段 5: 构建与 DX 优化

### 任务 5.1: 开发模式代码分割 [P2-11]

**修改文件**: `electron.vite.config.ts`

```typescript
output: {
  inlineDynamicImports: process.env.NODE_ENV === 'production'
}
```

**验收标准**:

- [ ] `pnpm dev` 热更新从 5.5s 降至 2s 以内
- [ ] `pnpm build:mac` 仍正常工作

### 任务 5.2: WASM 复制优化 [P2-11]

**修改文件**: `electron.vite.config.ts`（copyWasmAssetsPlugin）
**方案**: writeBundle 中增加 mtime 比对，跳过未变更文件

### 任务 5.3: ExtensionLoader 日志统一 [P1-5]

**修改文件**: `src/main/common/extension/ExtensionLoader.ts`
**方案**: 将所有 `console.*` 替换为 `createLogger('extension')`

---

## 七、阶段 6: 多 Agent 体验完善

### 任务 6.1: Task Plan 前端可视化

**方案**: 在 WorkbenchPanel 或独立面板中显示当前活跃任务的 plan.md + status.json

**修改文件**:

1. `src/main/gateway/methods/tasks.ts` — 新建，提供 `tasks.list`、`tasks.getStatus` 方法
2. `src/renderer/src/components/agent/TaskPanel.vue` — 新建，显示任务状态
3. `src/renderer/src/stores/tasks.ts` — 新建

**验收标准**:

- [ ] 前端实时显示 LLM 创建的任务计划
- [ ] 每个步骤显示状态（pending/in_progress/done/failed/skipped）
- [ ] 子 Agent 的执行结果可查看

### 任务 6.2: 子 Agent 执行可视化

**方案**: 在 ChatPanel 中增强 `delegate:start` / `delegate:done` 事件的展示

**修改文件**:

1. `src/renderer/src/stores/chat.ts` — 扩展 DelegateInfo 类型
2. `src/renderer/src/components/agent/ChatPanel.vue` — 增加委托状态卡片

**验收标准**:

- [ ] 委托给子 Agent 时显示进度卡片
- [ ] 子 Agent 完成时显示结果摘要
- [ ] 子 Agent 失败时显示错误信息

### 任务 6.3: Agent 自我认知注入完善 [来源: 25 轮分析]

**修改文件**:

1. `src/main/ai/AgentEnv.ts` — 确保 `security` 和 `model` 信息已注入（部分已完成）
2. `src/main/ai/AgentEnvInjector.ts` — 增强 skill discovery hint

**验收标准**:

- [ ] Agent 可通过系统提示词获知当前沙箱模式和审批策略
- [ ] Agent 可知道当前使用的模型和 thinking level

---

## 八、优先级矩阵

| 阶段          | 工作量 | 用户价值 | 技术价值 | 建议排期 |
| ------------- | ------ | -------- | -------- | -------- |
| 1. 前后端对接 | 1-2天  | **极高** | 中       | **立即** |
| 2. 关键缺陷   | 1-2天  | **高**   | 高       | **立即** |
| 3. 前端体验   | 3-5天  | **极高** | 中       | 本周     |
| 4. 架构治理   | 2-3天  | 低       | **极高** | 下周     |
| 5. 构建优化   | 1-2天  | 中       | **高**   | 随时     |
| 6. 多Agent    | 2-3天  | **高**   | 高       | 阶段3后  |

**总计**: 约 10-17 天工作量

---

## 九、快速修复清单（30 分钟内可完成）

这些问题修改量极小，建议在开始上述阶段之前一并处理：

| 任务                          | 文件                 | 修改量   |
| ----------------------------- | -------------------- | -------- |
| LogViewer 路由修复            | `LogViewer.vue`      | 1 行     |
| stores/index.ts 补全导出      | `stores/index.ts`    | 2 行     |
| destroyRuntime 错误日志修复   | `AgentExecutor.ts`   | 1 行     |
| ConfigWatcher 空 catch 加日志 | `ConfigWatcher.ts`   | 1 行     |
| ExtensionLoader console→log   | `ExtensionLoader.ts` | ~10 行   |
| HomeView 确认并移除           | `HomeView.vue`       | 删除文件 |

---

## 十、风险与注意事项

1. **阶段 1 的 workspaceDir 传递**涉及 Gateway 协议变更，需确保前后端版本兼容
2. **死代码清理（阶段 4.1）**需确认 Teams/Swarm 是否有未来计划，如有则保留但标注
3. **构建优化（阶段 5.1）**的代码分割可能影响 Electron 主进程模块加载，需充分测试
4. **ToolRegistry 重构（阶段 4.5）**影响面较大，建议单独分支开发，充分测试后合并
5. **前端文件系统 Gateway 方法（阶段 3.2/3.3）**需注意安全性，仅允许访问用户选择的目录
