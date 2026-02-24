# 29. 系统全量分析开发计划

**创建时间**: 2026-02-22  
**依据**: `28-full-system-analysis.md`  
**计划周期**: 4 个阶段，约 6-8 周  
**策略**: 从简单到复杂，先修复后优化

---

## 计划概览

```
阶段一（第 1 周）：快速修复（P0 + 高影响 P1）
  └─ 7 个任务，预计 3-5 天

阶段二（第 2-3 周）：核心重构（大文件拆分 + 类型安全）
  └─ 6 个任务，预计 5-8 天

阶段三（第 4-5 周）：能力增强（AI 质量 + 前端体验）
  └─ 8 个任务，预计 7-10 天

阶段四（第 6-8 周）：基础设施完善（测试 + 运维 + 发布）
  └─ 6 个任务，预计 5-8 天
```

---

## 阶段一：快速修复（第 1 周）

> 目标：消除所有 P0 问题，修复影响日常使用的 P1 问题

### 任务 1.1：修复 manage_agent 引用脱节（P0）

**问题**：`manage_agent` 工具已从 builtin 移除，但 `AgentEnvInjector` 的 `agent_discovery` 提示和 `agent-creator` Skill 仍引用该工具，导致 Agent 无法正确创建/管理其他 Agent。

**涉及文件**：

- `src/main/ai/AgentEnvInjector.ts` — agent_discovery 中的 manage_agent 引用
- `skills/agent-creator/SKILL.md` — 工具引用

**操作**：

1. 在 `AgentEnvInjector.ts` 中将 `manage_agent(create/list/get)` 替换为当前可用的方式（如 `delegate_to_agent` 或直接说明通过 Gateway API）
2. 更新 `agent-creator` Skill 中的工具引用
3. 编写回归测试

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 四.1]

---

### 任务 1.2：统一日志系统（P1）

**问题**：主进程部分模块直接使用 `console.log/error/warn`，未走 `createLogger`，导致日志格式不统一、无法按级别过滤。

**涉及文件**（主进程高频）：

- `src/main/ai/swarm/SwarmContext.ts`
- `src/main/ai/swarm/MessageBus.ts`
- `src/main/ai/memory/WorkingMemoryStore.ts`
- `src/main/ai/orchestration/PlanVersionManager.ts`
- `src/main/ai/orchestration/VerificationGate.ts`
- `src/main/ai/runtime/openai/SessionCompressor.ts`
- `src/main/ai/runtime/openai/ContextSnapshot.ts`

**操作**：

1. 批量替换主进程中的 `console.log/error/warn` 为 `createLogger` 调用
2. 渲染进程暂不改动（需统一方案，移至阶段三）

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 二.4]

---

### 任务 1.3：BrainMonitorView 接入路由（P1）

**问题**：`BrainMonitorView.vue` 组件已存在，`UIStore` 有 `brain-monitor` tab，但 `router/index.ts` 无对应路由。

**涉及文件**：

- `src/renderer/src/router/index.ts`
- `src/renderer/src/views/BrainMonitorView.vue`

**操作**：

1. 在 router 中添加 `/brain-monitor` 路由
2. 确认 StatusBar 或 Sidebar 有导航入口

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 三.5]

---

### 任务 1.4：Worker 健康检查联动重启（P1）

**问题**：健康检查失败仅上报状态，不触发重启。Worker 可能处于"假活"状态。

**涉及文件**：

- `src/main/common/worker/WorkerManager.ts` — healthCheck 逻辑

**操作**：

1. 添加可配置阈值 `maxHealthCheckFailures`（默认 3）
2. 连续失败超过阈值时触发重启
3. 编写测试

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 五.2]

---

### 任务 1.5：secrets.json5 权限检查（P1）

**问题**：启动时未检查 `secrets.json5` 的文件权限，可能被其他用户读取。

**涉及文件**：

- `src/main/common/config/ConfigSecrets.ts`

**操作**：

1. 加载 secrets 时检查文件权限（Unix: 600，Windows: 仅当前用户）
2. 权限不正确时打印告警日志
3. 编写测试

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 五.3]

---

### 任务 1.6：Skill 注入优化——摘要模式（P1）

**问题**：Agent 的 skills 全量注入到指令中，大 Skill（如 execution-protocol 3000+ 字符）占用大量上下文窗口。

**涉及文件**：

- `src/main/ai/skills/SkillManager.ts` — formatSkills / buildInstructions
- `src/main/ai/AgentEnvInjector.ts` — skill 注入逻辑

**操作**：

1. 修改 Skill 注入为"摘要模式"：仅注入 name、description、路径
2. Agent 需要完整内容时通过 `read` 工具按需加载 SKILL.md
3. 更新 `skill_discovery` 提示，说明按需加载流程
4. 编写测试验证上下文大小减少

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 四.2]

---

### 任务 1.7：质量循环扩展至单 Agent（P1）

**问题**：质量循环（Aggregator/Validator/Repairer）仅在 Swarm 模式生效，单 Agent 模式无自动校验/修复。

**涉及文件**：

- `src/main/ai/quality-loop/` — Validator、Repairer
- `src/main/ai/AgentExecutor.ts` — 单 Agent 执行流程
- `src/main/ai/runtime/` — PiMono/OpenAI Runtime

**操作**：

1. 在 AgentExecutor 的 Pipeline 中增加可选质量校验步骤
2. 通过配置控制是否启用（默认 enabled）
3. 复用 Validator 评分 + Repairer 修复逻辑
4. 编写测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 四.4]

---

## 阶段二：核心重构（第 2-3 周）

> 目标：拆分大文件、提升类型安全、统一架构模式

### 任务 2.1：拆分 AgentView.vue（P0）

**问题**：AgentView.vue 约 1769 行，包含智能体列表、AI 创建、运行弹窗、技能编辑等多个功能。

**涉及文件**：

- `src/renderer/src/views/AgentView.vue`

**操作**：

1. 抽出 `AgentCard.vue`（单个智能体卡片）
2. 抽出 `AiCreateDialog.vue`（AI 创建弹窗）
3. 抽出 `RunAgentDialog.vue`（运行任务弹窗）
4. 抽出 `EditSkillsPopover.vue`（技能编辑弹出层）
5. 抽出 `AgentListToolbar.vue`（搜索/过滤栏）
6. 将 `formatRelativeTime`、`getRunStatusConfig` 等工具函数移到 `utils/`
7. AgentView 仅保留布局和路由逻辑

**预计工时**：2 天  
**原始需求**：[28-full-system-analysis.md 三.1]

---

### 任务 2.2：拆分 AgentExecutor.ts（P1）

**问题**：AgentExecutor 约 1088 行，集中了并发控制、Pipeline、HITL、Provider 注入等职责。

**涉及文件**：

- `src/main/ai/AgentExecutor.ts`

**操作**：

1. 抽出 `ConcurrencyController`（并发控制）
2. 抽出 `ProviderInjector`（Provider 注入逻辑）
3. 抽出 `HITLManager`（人机交互审批流程）
4. AgentExecutor 仅保留 execute 入口和 Pipeline 编排
5. 更新相关 import 和测试

**预计工时**：2 天  
**原始需求**：[28-full-system-analysis.md 二.2]

---

### 任务 2.3：拆分 WindowManager.ts（P1）

**问题**：WindowManager 约 1408 行，混合了窗口创建、Tab 管理、IPC 处理等逻辑。

**涉及文件**：

- `src/main/common/window/WindowManager.ts`

**操作**：

1. 抽出 `TabManager`（Tab 生命周期管理）
2. 抽出 `WindowIpcHandler`（IPC 事件处理）
3. WindowManager 仅保留窗口创建/销毁
4. 更新测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 二.2]

---

### 任务 2.4：减少 any 使用（P1）

**问题**：60+ 处 `any`，集中在流式适配器、Swarm 类型、OpenAI Runtime。

**涉及文件**（优先处理）：

- `src/main/ai/runtime/pimono/PiMonoStreamAdapter.ts`
- `src/main/ai/swarm/types.ts`
- `src/main/ai/runtime/openai/OpenAIAgentRuntime.ts`
- `src/main/ai/runtime/openai/SessionAdapter.ts`
- `src/main/gateway/methods/config.ts`

**操作**：

1. 为 PiMonoStreamAdapter 的 `extractToolOutput`、`extractFullText` 定义明确类型
2. 为 swarm/types 的 `context`、`messageBus` 定义接口
3. 为 OpenAIAgentRuntime 的 `newItems` 定义 StreamItem 类型
4. 为 config.ts 的 `set/get` 增加泛型约束
5. 编写类型测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 二.3]

---

### 任务 2.5：统一 Store 体系（P1）

**问题**：`stores/` 与 `stores/modules/`、`stores/core/` 并存，导入路径不一致。

**涉及文件**：

- `src/renderer/src/stores/index.ts`
- `src/renderer/src/stores/modules/`
- `src/renderer/src/stores/core/`

**操作**：

1. 审计所有 store 的使用情况
2. 将 `modules/` 和 `core/` 下的 store 统一注册和导出
3. 制定 loading 规范（全局 vs 页面级）
4. 清理无用 store

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 三.2]

---

### 任务 2.6：chat.ts 解耦具体 Runtime（P1）

**问题**：`chat.ts` 直接 import `OrchestratorRuntime`、`SwarmRuntime`，Gateway 层与实现耦合。

**涉及文件**：

- `src/main/gateway/methods/chat.ts`

**操作**：

1. 引入 RuntimeFactory，根据 mode 创建对应 Runtime
2. chat.ts 仅依赖 `AgentRuntime` 接口和 RuntimeFactory
3. 各 Runtime 注册到 Factory

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 二.2]

---

## 阶段三：能力增强（第 4-5 周）

> 目标：提升 AI 质量、改善前端体验

### 任务 3.1：消息列表虚拟滚动（P1）

**问题**：ChatMessages 直接 v-for 渲染所有消息，大量消息时性能差。

**涉及文件**：

- `src/renderer/src/components/chat/ChatMessages.vue`

**操作**：

1. 引入 `@vueuse/core` 虚拟滚动或 `vue-virtual-scroller`
2. 保持自动滚动到底部的行为
3. 性能测试（100+ 消息场景）

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 三.4]

---

### 任务 3.2：设计令牌统一（P1）

**问题**：大量硬编码颜色（`text-gray-500`、`bg-red-50` 等），暗色模式下不协调。

**涉及文件**：

- `src/renderer/src/assets/base.css` — 设计令牌定义
- 高频组件：ErrorDisplay、AgentsPanel、ModelSettings、ChatPanel 等

**操作**：

1. 审计并整理所有硬编码颜色
2. 映射到 `base.css` 的设计令牌（`text-muted-foreground`、`bg-surface`、`text-error` 等）
3. 优先处理 ErrorDisplay、AgentsPanel、ModelSettings
4. 编写 Storybook 或截图对比

**预计工时**：2 天  
**原始需求**：[28-full-system-analysis.md 三.3]

---

### 任务 3.3：AgentCreatorService 接入 Provider（P1）

**问题**：仅使用 `createOpenAIClient()`，未接入统一的 Provider 和模型选择。

**涉及文件**：

- `src/main/ai/services/AgentCreatorService.ts`

**操作**：

1. 改用 ProviderRegistry 获取可用模型
2. 支持通过配置指定创建 Agent 使用的模型
3. 编写测试

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 四.1]

---

### 任务 3.4：暴露多 Agent 模式为工具（P1）

**问题**：Agent 无法直接调用 Swarm/Orchestrator 模式，agent_discovery 中标记为 "future"。

**涉及文件**：

- `src/main/ai/tools/builtin/` — 新增工具
- `src/main/ai/AgentEnvInjector.ts` — agent_discovery 更新

**操作**：

1. 实现 `delegate_to_swarm` 工具
2. 实现 `delegate_to_orchestrator` 工具
3. 更新 agent_discovery 说明
4. 编写测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 四.3]

---

### 任务 3.5：SessionCompressor 默认启用 + PiMono 支持（P2）

**问题**：SessionCompressor 默认关闭，且仅 OpenAI 实现。长对话容易超上下文。

**涉及文件**：

- `src/main/ai/runtime/openai/SessionCompressor.ts`
- `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts`

**操作**：

1. 修改默认配置，启用 SessionCompressor
2. 为 PiMono 实现等效压缩逻辑
3. 编写测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 四.4]

---

### 任务 3.6：记忆系统接入（P2）

**问题**：LongTermMemoryStore 设计完备但未与 memory 工具打通，长期记忆能力受限。

**涉及文件**：

- `src/main/ai/memory/` — LongTermMemoryStore
- `src/main/ai/tools/builtin/memory.ts` — memory 工具
- `extensions/memory-auto/` — 自动记忆 Extension

**操作**：

1. 将 LongTermMemoryStore 作为 memory 工具的可选后端
2. 支持语义搜索（如果 Brain Worker 可用）
3. 编写测试

**预计工时**：1.5 天  
**原始需求**：[28-full-system-analysis.md 四.4]

---

### 任务 3.7：快捷键说明与统一（P1）

**问题**：用户难以发现 Meta+Enter 等快捷键，无集中文档。

**涉及文件**：

- `src/renderer/src/views/settings/`
- `src/renderer/src/layout/Sidebar.vue`

**操作**：

1. 在设置页增加"快捷键"分页
2. 收集所有快捷键定义
3. 支持 `?` 快捷键打开帮助
4. 在 Tooltip 中显示快捷键提示

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 三.5]

---

### 任务 3.8：Monaco Editor 暗色模式跟随（P2）

**问题**：Monaco `theme: 'vs'` 固定，未根据暗色模式切换。

**涉及文件**：

- `src/renderer/src/components/agent/WorkbenchPanel.vue`

**操作**：

1. 读取当前主题（dark/light）设置 Monaco theme
2. 监听主题切换事件，动态更新

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 三.4]

---

## 阶段四：基础设施完善（第 6-8 周）

> 目标：补全测试、完善运维、准备发布

### 任务 4.1：补全核心模块测试（P1）

**缺失测试模块**：

- `WorkerManager`（spawn、venv、健康检查、崩溃重启）
- `command-scanner`（敏感路径、危险命令检测）
- `sensitive-paths`（敏感路径定义）
- `ConfigSecrets`（loadSecrets、mergeSecrets）
- `file-backup`（备份、版本清理）
- `WorkspaceManager`（工作空间创建/清理）

**操作**：

1. 为每个模块编写单元测试，覆盖正常路径 + 边界条件 + 错误处理
2. 目标：核心安全/运维模块测试覆盖率 > 80%

**预计工时**：3 天  
**原始需求**：[28-full-system-analysis.md 五.1]

---

### 任务 4.2：工作空间过期清理（P1）

**问题**：长期未使用的工作空间占磁盘，无自动清理。

**涉及文件**：

- `src/main/ai/storage/WorkspaceManager.ts`
- 新增：`src/main/lifecycle/CleanupWorkspaceHook.ts`

**操作**：

1. 添加配置项 `workspace.maxAge`（默认 30 天）
2. 在生命周期 Hook 中定期扫描过期工作空间
3. 提供手动清理 API
4. 编写测试

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 五.5]

---

### 任务 4.3：macOS 公证配置（P1）

**问题**：未配置 Apple 公证，用户安装时 Gatekeeper 可能拦截。

**涉及文件**：

- `electron-builder.yml`

**操作**：

1. 配置 notarize 与 Apple ID
2. 在 CI 中添加公证步骤
3. 验证签名和公证

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 五.4]

---

### 任务 4.4：监控指标保留策略（P2）

**问题**：JSON 指标文件无滚动清理，可能无限增长。

**涉及文件**：

- `src/main/metrics/MetricsCollector.ts`

**操作**：

1. 增加按天滚动或按大小清理策略
2. 可配置保留天数（默认 7 天）
3. 编写测试

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 五.6]

---

### 任务 4.5：渲染进程统一日志方案（P2）

**问题**：渲染进程全用 `console`，无法统一管理和上报。

**涉及文件**：

- `src/renderer/src/` 下多个文件

**操作**：

1. 设计渲染进程 Logger（基于 console 的包装，支持级别、过滤、上报）
2. 批量替换高频使用处
3. 支持将日志通过 IPC 发送到主进程统一存储

**预计工时**：1 天  
**原始需求**：[28-full-system-analysis.md 二.4]

---

### 任务 4.6：Extension 版本与兼容性校验（P2）

**问题**：Extension 无版本和兼容范围定义，升级可能导致兼容问题。

**涉及文件**：

- `src/main/common/extension/ExtensionLoader.ts`

**操作**：

1. 在 Extension manifest 中增加 `version` 和 `compatibleWith` 字段
2. 加载时校验兼容范围
3. 不兼容时跳过并告警

**预计工时**：0.5 天  
**原始需求**：[28-full-system-analysis.md 五.6]

---

## 附录：任务优先级矩阵

| 阶段 | 任务                           | 严重程度 | 预计工时 | 依赖     |
| ---- | ------------------------------ | -------- | -------- | -------- |
| 一   | 1.1 修复 manage_agent 引用     | P0       | 0.5d     | 无       |
| 一   | 1.2 统一日志系统               | P1       | 1d       | 无       |
| 一   | 1.3 BrainMonitor 路由          | P1       | 0.5d     | 无       |
| 一   | 1.4 Worker 健康检查联动        | P1       | 1d       | 无       |
| 一   | 1.5 secrets 权限检查           | P1       | 0.5d     | 无       |
| 一   | 1.6 Skill 摘要注入             | P1       | 1d       | 无       |
| 一   | 1.7 质量循环扩展               | P1       | 1.5d     | 无       |
| 二   | 2.1 拆分 AgentView             | P0       | 2d       | 无       |
| 二   | 2.2 拆分 AgentExecutor         | P1       | 2d       | 无       |
| 二   | 2.3 拆分 WindowManager         | P1       | 1.5d     | 无       |
| 二   | 2.4 减少 any                   | P1       | 1.5d     | 无       |
| 二   | 2.5 统一 Store                 | P1       | 1d       | 无       |
| 二   | 2.6 chat.ts 解耦 Runtime       | P1       | 1d       | 无       |
| 三   | 3.1 消息虚拟滚动               | P1       | 1.5d     | 无       |
| 三   | 3.2 设计令牌统一               | P1       | 2d       | 无       |
| 三   | 3.3 AgentCreator 接入 Provider | P1       | 1d       | 2.6      |
| 三   | 3.4 暴露多 Agent 工具          | P1       | 1.5d     | 1.1      |
| 三   | 3.5 SessionCompressor + PiMono | P2       | 1.5d     | 无       |
| 三   | 3.6 记忆系统接入               | P2       | 1.5d     | 无       |
| 三   | 3.7 快捷键说明                 | P1       | 1d       | 无       |
| 三   | 3.8 Monaco 暗色模式            | P2       | 0.5d     | 无       |
| 四   | 4.1 补全核心测试               | P1       | 3d       | 1.4, 1.5 |
| 四   | 4.2 工作空间清理               | P1       | 1d       | 无       |
| 四   | 4.3 macOS 公证                 | P1       | 0.5d     | 无       |
| 四   | 4.4 指标保留策略               | P2       | 0.5d     | 无       |
| 四   | 4.5 渲染进程日志               | P2       | 1d       | 1.2      |
| 四   | 4.6 Extension 版本校验         | P2       | 0.5d     | 无       |

---

## 总工时估算

| 阶段     | 任务数 | 预计工时  | 时间范围   |
| -------- | ------ | --------- | ---------- |
| 阶段一   | 7      | 6 天      | 第 1 周    |
| 阶段二   | 6      | 9 天      | 第 2-3 周  |
| 阶段三   | 8      | 10.5 天   | 第 4-5 周  |
| 阶段四   | 6      | 6.5 天    | 第 6-8 周  |
| **合计** | **27** | **32 天** | **6-8 周** |

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-22  
**维护者**: Coobee AI 开发团队
