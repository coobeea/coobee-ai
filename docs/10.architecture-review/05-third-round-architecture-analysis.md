# coobee-ai AI 模块 — 第三轮架构分析

> 生成时间：2026-02-15  
> 目的：在完成 P1-P4 改进路线图后，重新审视整个 AI 模块的架构健康度  
> 对标参考：OpenClaw 架构分析文档（10 篇）  
> 关注点：已完成改进的效果验证、遗留问题、新发现的改进空间

---

## 一、改进成效验证

### 1.1 上轮改进清单（04-improvement-roadmap.md）执行结果

| 改进项                   | 目标                          | 实际效果                                              | 评分  |
| ------------------------ | ----------------------------- | ----------------------------------------------------- | ----- |
| P1-1 HITL 独立 SDK       | 两 Runtime 统一 HITL          | tool-approval Extension 实现，比方案更简洁            | ★★★★★ |
| P1-2 path-guard 符号链接 | 补全安全防护                  | 代码已有，补充了 6 个测试                             | ★★★★☆ |
| P1-3 Skill 发现 + 优先级 | 修复 Extension Skill 不被发现 | scanSkills 改用 agentEnv.skillPaths + 后到覆盖        | ★★★★★ |
| P2-1~P2-4 Memory 系统    | 文件驱动记忆                  | MEMORY.md 结构 + 增强搜索 + 自动提取/注入             | ★★★★☆ |
| P3-1~P3-3 自我进化       | 评估→记忆→Skill 闭环          | execution-protocol Skill 化 + 经验沉淀指导            | ★★★★☆ |
| P4-1 Extension 沙箱      | 来源校验                      | 信任校验 + Skill 路径穿越检查                         | ★★★☆☆ |
| P4-2 错误恢复            | 渐进式恢复链                  | ErrorRecoveryChain 3 策略 + AbstractAgentRuntime 集成 | ★★★★☆ |
| P4-3 版本追踪            | write/edit 自动备份           | file-backup.ts + .versions/ 目录                      | ★★★★☆ |

### 1.2 健康度对比（第 2 轮 → 第 3 轮）

| 子系统         | 第 2 轮 | 第 3 轮 | 变化 | 说明                                                         |
| -------------- | ------- | ------- | ---- | ------------------------------------------------------------ |
| 执行链路       | ★★★★☆   | ★★★★☆   | →    | AgentExecutor 简化了 HITL 循环                               |
| 工具系统       | ★★★★☆   | ★★★★★   | ↑    | 新增版本追踪、file-lock 已导出                               |
| 流式输出       | ★★★★☆   | ★★★★☆   | →    | 未变化                                                       |
| Skill 系统     | ★★★☆☆   | ★★★★☆   | ↑    | 修复 Extension Skill 发现、优先级覆盖、执行协议 Skill 化     |
| Extension 系统 | ★★★☆☆   | ★★★★☆   | ↑    | 来源校验、2 个关键 Extension（tool-approval, memory-thread） |
| HITL 系统      | ★★☆☆☆   | ★★★★★   | ↑↑   | SDK 无关、per-call 审批、Extension 驱动                      |
| Memory 系统    | ★★☆☆☆   | ★★★★☆   | ↑↑   | 文件驱动 + 增强搜索 + 自动提取/注入                          |
| 安全体系       | ★★☆☆☆   | ★★★☆☆   | ↑    | path-guard 完整、Extension 校验，但策略层级仍不足            |
| 自我评估       | ★★★★☆   | ★★★★★   | ↑    | 经验沉淀、Skill 生成指导                                     |
| 错误恢复       | ★☆☆☆☆   | ★★★☆☆   | ↑↑   | ErrorRecoveryChain 基础框架                                  |

---

## 二、当前架构全景

### 2.1 核心执行链路（更新后）

```
用户消息
  ↓
Gateway (IPC) → AgentExecutor.execute() / stream()
  ↓
  ├── busy 锁（同 session 串行）
  ├── injectEnv()
  │     ├── buildAgentEnv() — 工作空间、Extension Skill 路径
  │     ├── SkillManager.scanSkills(agentEnv.skillPaths) — 后到覆盖
  │     ├── buildExecutionProtocol(skillManager) — Skill 优先、硬编码兜底
  │     └── formatRuntimePaths() + skillDiscoveryHint
  ├── Extension Hook: message_received → session_start → before_agent_start
  │     └── memory-thread: 注入 MEMORY.md 摘要 + 相关记忆
  ├── Builder.build() → AgentRuntime 实例
  ├── runtime.stream() — ErrorRecoveryChain 包装
  │     ├── doStream() — SDK 特定实现
  │     │     ├── convertTools():
  │     │     │     ├── isToolAllowed() — 工具策略
  │     │     │     ├── before_tool_call Hook — tool-approval 审批
  │     │     │     │     ├── exec: checkExecPolicy → deny/allow/ask
  │     │     │     │     └── needUserConfirm: requestApproval → waitForSingleDecision
  │     │     │     ├── file-backup: backupBeforeWrite (write/edit)
  │     │     │     ├── execute: AsyncGenerator<ToolStreamUpdate, ToolResult>
  │     │     │     ├── after_tool_call Hook
  │     │     │     └── tool_result_persist Hook — 结果截断
  │     │     └── yield StreamChunk → EventBus → 前端
  │     └── 错误时: ErrorRecoveryChain.recover() → retry/throw
  ├── Extension Hook: agent_end → session_end
  │     ├── memory-thread: 检测记忆信号 → 自动保存
  │     └── tool-approval: cleanupSession
  └── runtime.destroy()
```

### 2.2 模块代码量统计

| 模块           | 文件数   | 总行数（约） | 说明                                            |
| -------------- | -------- | ------------ | ----------------------------------------------- |
| runtime/       | 18       | ~4,800       | 双 Runtime + 恢复链 + 快照 + 压缩               |
| tools/         | 18       | ~2,600       | 12 内置工具 + 注册表 + 类型                     |
| hitl/          | 5        | ~1,300       | 审批管理器 + 测试                               |
| sandbox/       | 8        | ~1,300       | 路径守卫 + 执行策略 + Docker 预留               |
| streaming/     | 7        | ~800         | 流式发射器 + 消费者                             |
| skills/        | 3        | ~600         | Skill 管理器                                    |
| memory/        | 9        | ~1,400       | 设计储备（未接入）                              |
| orchestration/ | 9        | ~1,400       | 设计储备（未接入）                              |
| swarm/         | 13       | ~4,100       | 设计储备（未接入）                              |
| teams/         | 3        | ~700         | 设计储备（绑定 OpenAI SDK）                     |
| storage/       | 5        | ~1,100       | Agent/Team 配置 + 会话管理                      |
| 顶层           | 5        | ~1,000       | Executor + EnvInjector + EventWriter + AgentEnv |
| **合计**       | **~103** | **~21,100**  |                                                 |

### 2.3 Extension 生态

| Extension     | 位置                      | 注册 Hook                                    | 功能                                           |
| ------------- | ------------------------- | -------------------------------------------- | ---------------------------------------------- |
| tool-approval | extensions/tool-approval/ | session_start, session_end, before_tool_call | 统一 HITL 审批（ExecPolicy + needUserConfirm） |
| memory-thread | extensions/memory-thread/ | before_agent_start, agent_end                | 记忆自动注入 + 自动提取                        |

### 2.4 Skill 生态

| Skill              | 位置                       | 功能                      |
| ------------------ | -------------------------- | ------------------------- |
| execution-protocol | skills/execution-protocol/ | 五步工作法（可覆盖）      |
| self-reflection    | skills/self-reflection/    | 自我评估方法论 + 经验沉淀 |
| runtime-env        | skills/runtime-env/        | 运行时环境说明            |
| skill-creator      | skills/skill-creator/      | Skill 创建指南            |
| extension-creator  | skills/extension-creator/  | Extension 创建指南        |
| icon-usage         | .cursor/skills/icon-usage/ | Vue 图标使用（应用专用）  |

---

## 三、遗留问题与新发现

### 3.1 死代码 / 设计储备

#### memory/ 模块（~1,400 行）— 未接入

`src/main/ai/memory/` 包含完整的记忆子系统（SessionMemoryStore, ShortTermMemory, WorkingMemoryStore, LongTermMemoryStore, SessionAdapter），但**没有任何业务代码引用**。

当前记忆系统完全通过 `tools/builtin/memory.ts`（文件驱动）+ `extensions/memory-thread/` 实现。

**建议**：

- 方案 A：删除（减少 1,400 行维护负担）
- 方案 B：保留为 "memory 插件槽" 设计储备，但需要文档明确标注

#### orchestration/ 模块（~1,400 行）— 未接入

`Orchestrator`, `Planner`, `PlanVersionManager`, `WorkerCoordinator`, `VerificationGate` 等完整实现。代码完整但没有被 AgentExecutor 或任何入口调用。

**建议**：同上

#### swarm/ 模块（~4,100 行）— 未接入

自研的多 Agent 协作系统。`SwarmCoordinator`, `AgentPool`, `MessageBus`, `HandoffRouter` 等。最大的设计储备模块。

**建议**：这是未来多 Agent 的核心候选，但需要评估是否与 OpenClaw 的 "单级 fan-out" 模式对齐。

#### teams/ 模块（~700 行）— 绑定 OpenAI SDK

`TeamRuntime` 直接依赖 `@openai/agents` SDK 的多 Agent 编排能力。

**建议**：如果要做 SDK 无关的多 Agent，应该基于 swarm/ 改造而非 teams/。

### 3.2 文档过时

| 文件                                                    | 过时内容                                                                 | 建议                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| `sandbox/exec-policy.ts` 头部注释                       | 仍然提到 "SDK needsApproval" 和 "AgentExecutor.computePolicyDecisions()" | 更新注释             |
| `03-comprehensive-architecture-analysis.md` Section 1.1 | 架构图仍展示旧的 HITL 循环                                               | 更新或标注为历史版本 |
| `03-comprehensive-architecture-analysis.md` Section 2.3 | HITL 与 SDK 耦合问题标记为 Critical                                      | 已解决，应更新状态   |

### 3.3 安全策略层级不足

**当前**：只有一层策略（path-guard 路径检查 + exec-policy 命令检查）。

**OpenClaw 对比**：8 层策略过滤（profile → providerProfile → global → globalProvider → agent → agentProvider → group → sandbox → subagent）。

**差距**：

- 没有 per-agent 策略（所有 Agent 共享同一套规则）
- 没有工具分组策略（不能按 `group:fs`, `group:runtime` 等维度控制）
- `tool-policy.ts` 存在但未真正使用
- 没有 provider 级别的策略

### 3.4 工具管线缺乏标准化

**当前**：每个工具自行处理参数验证、路径解析、错误格式化。

**OpenClaw 对比**：工具经过标准化管线（参数归一化 → schema 兼容性 → Hook → abort 信号 → 执行），提供 provider 感知的 schema 适配。

**差距**：

- 无 provider 感知的参数适配（不同 LLM 对参数格式要求不同）
- 每个工具重复 `resolveSandboxPath()` + `pathGuardErrorToToolResult()` 样板代码
- 工具错误处理格式不统一（有的返回 `llmContent`，有的抛异常）

### 3.5 记忆搜索能力上限

**当前**：纯文件遍历 + 关键字 TF 评分。

**OpenClaw 对比**：SQLite FTS5 + sqlite-vec 向量搜索，混合检索（0.7 向量 + 0.3 文本）。

**差距**：

- 当记忆文件 > 100 个时性能可能下降
- 无语义搜索能力
- 无 embedding 向量支持

**但**：当前方案的优势在于零依赖、可调试、Agent 可直接操作文件。短期内够用。

### 3.6 HitlApprovalManager 批量 API 遗留

`waitForDecisions()` / `submitDecision()` 是旧的批量审批 API，仅在测试中使用。生产代码已全部迁移到 per-call 模式（`waitForSingleDecision` / `submitSingleDecision`）。

**建议**：标记为 `@deprecated` 或删除。

### 3.7 PiMono 会话管理不完整

`PiMonoAgentRuntime.clearSession()` 实现为空操作，file-mode 会话可能无法正确清理。

### 3.8 Extension 热重载推断来源不准确

`ExtensionLoader.inferOrigin()` 总是返回 `'workspace'`，对于非 workspace 目录下的热重载无法正确推断来源。

### 3.9 ErrorRecoveryChain 尚未完全覆盖

当前 3 个策略（SimpleRetry, ContextLength, Authentication）只是基础框架：

- 上下文过长恢复只做了 "重试一次"，但没有实际的上下文压缩触发
- 没有模型降级策略
- 没有思考级别降级策略

---

## 四、与 OpenClaw 系统性对比（第 3 轮更新）

### 4.1 关键差距缩小

| 维度           | 第 2 轮差距                   | 第 3 轮差距  | 说明                             |
| -------------- | ----------------------------- | ------------ | -------------------------------- |
| **HITL**       | SDK 绑定，PiMono 不可用       | **已消除**   | tool-approval Extension 统一处理 |
| **记忆**       | 字符串 includes()，无自动注入 | **大幅缩小** | 增强搜索 + 自动提取/注入         |
| **错误恢复**   | 无                            | **初步建立** | ErrorRecoveryChain 基础框架      |
| **Skill 系统** | Extension Skill 不被发现      | **已修复**   | scanSkills + 后到覆盖            |
| **自我进化**   | 反馈循环未闭环                | **基本闭环** | 评估→记忆→Skill 生成             |

### 4.2 仍存在的差距

| 维度               | coobee-ai 现状                     | OpenClaw                 | 差距程度 |
| ------------------ | ---------------------------------- | ------------------------ | -------- |
| **工具策略**       | 1 层（path-guard + exec-policy）   | 8 层过滤                 | 大       |
| **记忆搜索**       | 文件遍历 + 关键字                  | SQLite FTS5 + 向量       | 中       |
| **多 Agent**       | 设计储备（未接入）                 | 单级 fan-out + Lane 队列 | 大       |
| **Extension 能力** | 4 种（tool, hook, gateway, skill） | 12+ 种                   | 中       |
| **并发控制**       | busy 锁（同 session 串行）         | Lane 队列（多级）        | 中       |
| **Provider 适配**  | 双 SDK 硬编码                      | Provider 感知的 schema   | 中       |
| **Extension 沙箱** | P0 来源校验                        | 同样无沙箱               | 平       |
| **Hook 可观测性**  | 无日志/性能监控                    | 无                       | 平       |

### 4.3 coobee-ai 独特优势（持续保持）

1. **执行协议（五步工作法）**：系统级的意图→目标→执行→评估→修复闭环，OpenClaw 无此设计
2. **self-reflection Skill**：详细的自我评估方法论 + 经验沉淀机制
3. **Observability 工具组**：LLM 可内省执行过程（session_status, session_history, context_inspect）
4. **执行协议 Skill 化**：用户/Agent 可覆盖执行协议，OpenClaw 无此机制
5. **ErrorRecoveryChain 模板方法**：在 AbstractAgentRuntime.stream() 中自动恢复，不需要每个 Runtime 单独处理

---

## 五、代码质量与架构异味

### 5.1 PiMonoAgentRuntime 过大（1,059 行）

这是整个项目最大的单文件，包含了：

- SDK 配置与初始化
- 工具转换（convertTools）
- 流式事件转接（ChunkQueue）
- 会话管理
- 上下文压缩

**建议**：拆分为 `PiMonoToolConverter`, `PiMonoSessionManager`, `PiMonoStreamAdapter` 等。

### 5.2 memory.ts 过大（718 行）

工具文件不应该包含 200+ 行的搜索算法实现。

**建议**：将 `searchMemoryFiles()` 和 `resolveMemoryRoots()` 提取到 `memory/MemorySearch.ts`。

### 5.3 重复的工具样板代码

write.ts, edit.ts, read.ts 中重复的模式：

```typescript
const resolved = resolveSandboxPath(filePath, context);
if (resolved.error) return pathGuardErrorToToolResult(resolved.error);
const absolutePath = resolved.path;
```

**建议**：提取 `resolveToolPath(filePath, context)` 统一工具路径解析。

### 5.4 Skill 命名不一致

- `execution-protocol` — kebab-case
- `Self-Reflection` — Title-Case
- `runtime-env` — kebab-case

**建议**：统一使用 kebab-case 作为 Skill name。

### 5.5 Extension 与 Runtime 的双向依赖

`tool-approval` Extension import 了 `src/main/ai/hitl/HitlApprovalManager`（相对路径 `../../src/main/ai/hitl/...`）。Extension 不应该直接 import 核心模块。

**建议**：通过 Extension API 暴露审批管理能力，或将 HitlApprovalManager 注册为全局服务。

---

## 六、总结

### 6.1 整体架构健康度（第 3 轮）

```
┌──────────────────────────────────────────────────────┐
│  子系统              │ 健康度  │ 趋势  │ 下一步优先级 │
├──────────────────────┤─────────┤───────┤──────────────┤
│ 执行链路             │ ★★★★☆  │  →    │ 低          │
│ 工具系统             │ ★★★★★  │  ↑    │ 中（管线化）│
│ 流式输出             │ ★★★★☆  │  →    │ 低          │
│ Skill 系统           │ ★★★★☆  │  ↑    │ 低          │
│ Extension 系统       │ ★★★★☆  │  ↑    │ 中          │
│ HITL 系统            │ ★★★★★  │  ↑↑   │ 低          │
│ Memory 系统          │ ★★★★☆  │  ↑↑   │ 中（索引化）│
│ 安全体系             │ ★★★☆☆  │  ↑    │ 高          │
│ 自我评估 + 进化      │ ★★★★★  │  ↑    │ 低          │
│ 错误恢复             │ ★★★☆☆  │  ↑↑   │ 中          │
│ 多 Agent             │ ★★☆☆☆  │  →    │ 高（路线图）│
│ 代码质量             │ ★★★☆☆  │  →    │ 中          │
└──────────────────────────────────────────────────────┘
```

### 6.2 下一阶段方向

1. **多 Agent 基础**：评估 swarm/ vs 单级 fan-out，确定路线
2. **工具策略分层**：激活 tool-policy.ts，增加 per-agent 和 group 策略
3. **工具管线标准化**：提取公共管线，减少样板代码
4. **大文件拆分**：PiMonoAgentRuntime, memory.ts
5. **死代码清理**：评估 memory/ orchestration/ teams/ 模块去留
6. **ErrorRecoveryChain 增强**：上下文压缩触发、模型降级
7. **记忆索引层**：为大量记忆文件场景引入轻量索引（可选 SQLite）
