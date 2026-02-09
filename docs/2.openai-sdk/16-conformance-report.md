# OpenAI Agents JS SDK 合规差距报告

> 生成日期：2026-02-04
> 更新日期：2026-02-04（完成短期+中期全部改进）
> 项目：coobee-ai
> SDK 版本：@openai/agents 0.4.6
> 分析范围：`src/main/ai/` 全部模块

---

## 1. 总览

本报告对 coobee-ai 项目的 AI 模块与 OpenAI Agents JS SDK 的功能覆盖度进行系统评估。

### 合规概览（改进后）

| 维度       | SDK 特性总数 | 已采用 | 自定义替代 | 未覆盖 |
| ---------- | ------------ | ------ | ---------- | ------ |
| 核心执行   | 3            | 3 ✅   | 0          | 0      |
| 工具系统   | 4            | 3 ✅   | 1          | 0      |
| 智能路由   | 2            | 2      | 0          | 0      |
| 输出控制   | 2            | 1 ✅   | 0          | 1      |
| 流式处理   | 4            | 3 ✅   | 1          | 0      |
| 记忆与会话 | 3            | 1 ✅   | 2          | 0      |
| 生命周期   | 2            | 0      | 1          | 1      |
| 安全与治理 | 3            | 2 ✅   | 0          | 1      |
| 可观测性   | 2            | 0      | 1          | 1      |
| **合计**   | **25**       | **15** | **6**      | **4**  |

**合规率（直接采用）**：60%（改进前 24%，提升 **+36%**）
**功能覆盖率（含自定义替代）**：84%（改进前 64%，提升 **+20%**）

### 改进摘要

| 改进项                                 | 类型     | 涉及文件                        | 状态    |
| -------------------------------------- | -------- | ------------------------------- | ------- |
| Planner `outputType` 结构化输出        | 短期优化 | `Planner.ts`                    | ✅ 完成 |
| AgentRuntime `stream: true` 流式 API   | 短期优化 | `AgentRuntime.ts`               | ✅ 完成 |
| 全部 `run()` 调用添加 `maxTurns`       | 短期优化 | 6 个文件                        | ✅ 完成 |
| SDK `Session` 适配器                   | 中期增强 | `SessionAdapter.ts`（新增）     | ✅ 完成 |
| `modelSettings` 支持                   | 中期增强 | `presets.ts`, `AgentFactory.ts` | ✅ 完成 |
| `inputGuardrails` / `outputGuardrails` | 中期增强 | `guardrails/`（新增模块）       | ✅ 完成 |

---

## 2. 已采用的 SDK 特性

### 2.1 `Agent` — 核心 Agent 类 ✅

**使用位置**：

| 文件                        | 用途                                     |
| --------------------------- | ---------------------------------------- |
| `agents/AgentFactory.ts`    | 通过 `new Agent(config)` 创建 Agent 实例 |
| `swarm/SwarmCoordinator.ts` | 创建 Triage Agent 和 Specialist Agent    |
| `orchestration/Planner.ts`  | 创建规划专用 Agent（含 `outputType`）    |

**评估**：完全采用 SDK 的 Agent 构造方式，支持 `name`、`instructions`、`model`、`tools`、`handoffs`、`outputType`、`modelSettings` 等配置。

### 2.2 `run()` — Agent 执行函数 ✅

**使用位置**：

| 文件                                 | 用途                      |
| ------------------------------------ | ------------------------- |
| `runtime/AgentRuntime.ts`            | 单 Agent 同步/流式执行    |
| `runtime/TeamRuntime.ts`             | Team 成员顺序/并行执行    |
| `swarm/SwarmCoordinator.ts`          | Triage 和 Decomposer 执行 |
| `swarm/ConcurrencyManager.ts`        | 并行 Agent 执行           |
| `orchestration/Planner.ts`           | 规划 Agent 执行           |
| `orchestration/WorkerCoordinator.ts` | Worker Agent 执行         |

**评估**：`run()` 是项目中使用最广泛的 SDK 函数，覆盖了所有执行场景。

**改进**：

- ✅ 所有 `run()` 调用均传入 `maxTurns` 参数防止无限工具调用循环
- ✅ `AgentRuntime.runStream()` 使用 `stream: true` 获取 `StreamedRunResult`
- ✅ `AgentRuntime.run()` 支持 `previousResponseId` 多轮对话延续

### 2.3 `tool()` — 工具定义函数 ✅

**使用位置**：

| 文件                     | 用途                                   |
| ------------------------ | -------------------------------------- |
| `tools/builtin/index.ts` | 定义 `readFileTool` 和 `webSearchTool` |
| `swarm/tools.ts`         | 定义 7 个 Swarm 通信工具               |

**评估**：使用 `zod` 定义参数 schema，配合 `tool()` 函数创建类型安全的工具。与 SDK 最佳实践一致。

### 2.4 `handoff()` — Agent 移交函数 ✅

**使用位置**：

| 文件                        | 用途                    |
| --------------------------- | ----------------------- |
| `swarm/HandoffRouter.ts`    | 构建 Agent 间移交配置   |
| `swarm/SwarmCoordinator.ts` | Triage Agent 的移交路由 |

**评估**：使用 `onHandoff` 回调跟踪移交事件，支持 `toolNameOverride` 和 `toolDescriptionOverride`。

### 2.5 Agent `tools` 属性 ✅

**评估**：通过 `AgentFactory` 动态注册工具到 Agent 的 `tools` 数组中。

### 2.6 Agent `model` 属性 ✅

**评估**：通过预设配置（`presets.ts`）和数据库配置设置 Agent 使用的模型（默认 `gpt-4o`）。

### 2.7 `outputType` — 结构化输出 ✅ 🆕

**使用位置**：

| 文件                       | 用途                                                  |
| -------------------------- | ----------------------------------------------------- |
| `orchestration/Planner.ts` | 使用 Zod schema（`PlanOutputSchema`）定义规划输出格式 |

**实现**：

```typescript
const PlanOutputSchema = z.object({
  subTasks: z.array(SubTaskSchema),
  stages: z.array(StageSchema)
})

this.plannerAgent = new Agent({
  name: 'Planner',
  outputType: PlanOutputSchema
  // ...
})
```

**效果**：

- ✅ 消除了 `parsePlanningResult()` 中脆弱的 JSON 正则提取
- ✅ `result.finalOutput` 直接为类型安全的 `PlanOutput` 对象
- ✅ SDK 自动验证输出格式，无效输出优雅降级

### 2.8 `maxTurns` — 循环保护 ✅ 🆕

**使用位置**：所有 `run()` 调用（6 个文件）

| 文件                                 | maxTurns 值 |
| ------------------------------------ | ----------- |
| `runtime/AgentRuntime.ts`            | 25（默认）  |
| `runtime/TeamRuntime.ts`             | 25          |
| `swarm/SwarmCoordinator.ts`          | 25 / 10     |
| `swarm/ConcurrencyManager.ts`        | 25          |
| `orchestration/Planner.ts`           | 5           |
| `orchestration/WorkerCoordinator.ts` | 25          |

**效果**：防止 Agent 陷入无限工具调用循环，Planner 使用更低的值因为规划任务不需要多轮调用。

### 2.9 `stream: true` — SDK 原生流式处理 ✅ 🆕

**使用位置**：

| 文件                      | 用途                                           |
| ------------------------- | ---------------------------------------------- |
| `runtime/AgentRuntime.ts` | `runStream()` 使用 `stream: true` 获取流式结果 |

**实现**：

```typescript
const streamResult = await run(this.agent, input, {
  stream: true,
  maxTurns: DEFAULT_MAX_TURNS
})

for await (const event of streamResult) {
  switch (event.type) {
    case 'raw_model_stream_event': // 文本增量
    case 'run_item_stream_event': // 工具调用
    case 'agent_updated_stream_event': // Agent 切换
  }
}
```

**效果**：

- ✅ 获得实时文本增量（`response.output_text.delta`）
- ✅ 实时工具调用通知
- ✅ Agent 切换（handoff）事件
- ✅ 将 SDK 原生事件映射到自定义 `StreamEmitter`

### 2.10 `modelSettings` — 模型参数控制 ✅ 🆕

**使用位置**：

| 文件                     | 用途                            |
| ------------------------ | ------------------------------- |
| `agents/presets.ts`      | 预设配置中定义 modelSettings    |
| `agents/AgentFactory.ts` | 创建 Agent 时合并 modelSettings |

**实现**：

- `chatAgentPreset`: `temperature: 0.7, topP: 0.9`
- `codeAgentPreset`: `temperature: 0.3, topP: 0.85`（代码生成更确定性）
- `researchAgentPreset`: `temperature: 0.5, parallelToolCalls: true`
- 支持三层合并：预设 → 自定义配置 → 运行时选项

### 2.11 `previousResponseId` — 多轮对话延续 ✅ 🆕

**使用位置**：

| 文件                      | 用途                                |
| ------------------------- | ----------------------------------- |
| `runtime/AgentRuntime.ts` | run/runStream 传入上一次 responseId |

**效果**：利用 API 端的对话缓存，减少 token 消耗，提高多轮对话一致性。

### 2.12 `InputGuardrail` / `OutputGuardrail` ✅ 🆕

**使用位置**：

| 文件                             | 用途                         |
| -------------------------------- | ---------------------------- |
| `guardrails/inputGuardrails.ts`  | 内容安全、注入检测、长度限制 |
| `guardrails/outputGuardrails.ts` | 敏感数据检测、格式合规检查   |

**提供的护栏**：

| 护栏名称                          | 类型   | 功能                           | tripwire |
| --------------------------------- | ------ | ------------------------------ | -------- |
| `contentSafetyInputGuardrail`     | Input  | 敏感词、长度、URL 检查         | 阻断     |
| `injectionDetectionGuardrail`     | Input  | Prompt injection 检测          | 阻断     |
| `maxLengthInputGuardrail`         | Input  | 输入长度限制                   | 阻断     |
| `sensitiveDataOutputGuardrail`    | Output | 信用卡、身份证、API Key 等检测 | 阻断     |
| `formatComplianceOutputGuardrail` | Output | 空输出、模型幻觉标记检测       | 仅记录   |

---

## 3. 自定义替代实现（功能等效但非 SDK 原生）

### 3.1 流式消息持久化与广播 — 自定义增强 🔄

**SDK 特性**：SDK 提供流式事件但不含持久化和 WebSocket 广播。

**项目实现**：

- `StreamStore`：持久化流消息到 SQLite
- `WebSocketBroadcaster`：通过 WebSocket 推送到客户端
- `StreamMonitor`：统计和监控流式会话

**评估**：这些是超越 SDK 的自定义增强，与 SDK 流式 API 配合使用。

### 3.2 会话管理 — 自定义三层记忆 + SDK Session 适配器 🔄

**SDK 特性**：`Session` 接口

**项目实现**：

- `SessionMemoryStore`：基于文件系统的消息历史存储
- `ShortTermMemory`：`TrimmingSession` 和 `SummarizingSession`
- `WorkingMemoryStore`：变量、计划状态、检查点管理
- 🆕 `SessionAdapter`：将 `SessionMemoryStore` 包装为 SDK `Session` 接口

**改进**：

- ✅ 新增 `SessionAdapter` 实现 SDK `Session` 接口（`getSessionId`、`getItems`、`addItems`、`popItem`、`clearSession`）
- ✅ 可直接传入 `run()` 的 `session` 选项
- ✅ 自定义三层记忆系统保持不变（远超 SDK 原生能力）

### 3.3 工具启用/禁用 — 自定义实现 🔄

**SDK 特性**：`isEnabled` 属性、`toolChoice` 参数

**项目实现**：

- `ToolRegistry` 管理工具注册和获取
- `IExecutable.setToolEnabled()` 接口方法

**改进**：

- ✅ 通过 `modelSettings.toolChoice` 支持工具选择策略（`'auto'` | `'required'` | `'none'`）
- ❌ 仍未使用 SDK 的 `isEnabled` 属性（自定义注册表模式满足需求）

### 3.4 生命周期钩子 — 自定义 EventBus 事件 🔄

**SDK 特性**：`agent.on('toolStart' | 'toolEnd' | 'handoff', handler)`

**项目实现**：EventBus 事件系统 + `onHandoff` 回调

**评估**：通过 `onHandoff` 回调和 EventBus 部分覆盖了 handoff 场景。

### 3.5 可观测性 — 自定义监控 🔄

**SDK 特性**：`withTrace()` / `setTracingDisabled()`

**项目实现**：`StreamMonitor` 会话级别统计 + EventBus 追踪

---

## 4. 未覆盖的 SDK 特性

### 4.1 `agent.asTool()` ❌

**说明**：允许将 Agent 转换为 Tool，实现 Agent 间调用（调用方保持控制权）。

**优先级**：⭐ 低 — 现有 handoff 机制可满足需求

### 4.2 `user()` 辅助函数 ❌

**说明**：构造用户消息的辅助函数。

**优先级**：⭐ 低 — 影响微小

### 4.3 `extractAllTextOutput()` ❌

**说明**：从 RunResult 中提取所有文本输出（含中间步骤）。

**优先级**：⭐ 低

### 4.4 SDK 追踪 (`withTrace` / `setTracingDisabled`) ❌

**说明**：SDK 内置 OpenAI 追踪集成。

**优先级**：⭐ 低 — 自定义监控已覆盖基本需求

---

## 5. 架构建议（剩余改进）

### 5.1 可选增强

1. **SDK 追踪集成**：当需要使用 OpenAI 平台追踪功能时，通过 `Runner` 配置 `tracingDisabled: false` 和 `traceIncludeSensitiveData`。

2. **`agent.asTool()` 探索**：在特定场景下（如需要调用方保持控制权），评估是否比 handoff 更合适。

3. **SDK 生命周期钩子**：考虑在 `AgentRuntime` 中监听 `agent.on('toolStart' | 'toolEnd')` 事件，获得比 EventBus 更精细的工具执行追踪。

4. **`extractAllTextOutput()`**：在需要获取包含中间步骤文本的完整输出时使用。

---

## 6. 测试覆盖总结

### 测试统计

| 模块          | 测试文件                                                                     | 测试用例数   |
| ------------- | ---------------------------------------------------------------------------- | ------------ |
| agents        | AgentFactory, presets                                                        | 27           |
| tools         | registry, builtin                                                            | 18           |
| swarm         | HandoffRouter, tools, SwarmContext, MessageBus, ConcurrencyManager           | 75           |
| streaming     | StreamEmitter, StreamMonitor, StreamStore, WebSocketBroadcaster              | 39           |
| memory        | SessionMemoryStore, ShortTermMemory, WorkingMemoryStore, LongTermMemoryStore | 68           |
| runtime       | AgentRuntime, TeamRuntime, RuntimeFactory                                    | 55           |
| orchestration | VerificationGate, PlanVersionManager, Planner, WorkerCoordinator             | 29           |
| **合计**      | **24 文件**                                                                  | **311 用例** |

- 通过率：**100%**（311/311）
- 执行时间：< 1 秒
- Mock 策略：所有外部依赖（SDK API、数据库、文件系统、EventBus）均已 mock
- 改进后新增/更新测试：Planner（outputType）、AgentRuntime（stream:true）、WorkerCoordinator（maxTurns）

---

## 7. 结论

### 改进前后对比

| 指标               | 改进前 | 改进后 | 变化           |
| ------------------ | ------ | ------ | -------------- |
| SDK 直接采用特性数 | 6/25   | 15/25  | +9 (**+150%**) |
| 合规率             | 24%    | 60%    | **+36%**       |
| 功能覆盖率         | 64%    | 84%    | **+20%**       |
| 未覆盖特性数       | 9      | 4      | -5             |
| 测试用例数         | 310    | 311    | +1             |

### 核心改进

1. **结构化输出**（`outputType`）：消除 Planner 中脆弱的 JSON 正则提取，获得类型安全的输出
2. **SDK 原生流式处理**（`stream: true`）：获得实时文本增量和工具调用事件
3. **循环保护**（`maxTurns`）：所有 `run()` 调用均有上限保护
4. **Session 适配器**：桥接自定义记忆系统与 SDK Session 接口
5. **模型参数控制**（`modelSettings`）：支持 temperature、topP、toolChoice 等精细参数
6. **安全护栏**（Guardrails）：提供输入/输出安全检查框架

### 剩余差距

仅剩 4 个低优先级特性未覆盖（`asTool()`、`user()`、`extractAllTextOutput()`、SDK 追踪），均为非核心功能，可按需引入。

**项目 AI 模块在核心执行层、工具系统、流式处理、安全治理等维度上与 SDK 保持高度对齐，同时通过三层记忆、WebSocket 广播、流消息持久化等自定义实现超越了 SDK 原生能力。**
