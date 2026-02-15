# coobee-ai 第四轮架构深度分析

> 生成时间：2026-02-15
> 分析方式：多智能体并行深度探索（6 个专项分析 Agent）
> 覆盖范围：AI 核心子系统全部模块 + OpenClaw 全量文档对标
> 参考资料：OpenClaw docs/ 及 docs/analysis/ 全部 20+ 文档

---

## 一、分析方法论

本轮分析采用以下方法：

1. **代码级全扫描**：逐文件阅读 `src/main/ai/` 及 `src/main/common/extension/` 下所有源码
2. **OpenClaw 全量对标**：阅读 OpenClaw 16 篇 analysis 文档 + 10+ 篇参考文档
3. **历史回顾**：阅读 01-06 号文档，追踪问题演进
4. **多维度交叉验证**：Runtime/工具/安全/扩展/记忆/流式 六个维度独立分析后交叉比对

---

## 二、系统全景（文件级）

### 2.1 模块清单与规模

| 模块                   | 路径                                 | 文件数 | 总行数 | 状态 |
| ---------------------- | ------------------------------------ | ------ | ------ | ---- |
| **AgentExecutor**      | `ai/AgentExecutor.ts`                | 1      | ~450   | 生产 |
| **AgentEnvInjector**   | `ai/AgentEnvInjector.ts`             | 1      | ~200   | 生产 |
| **Runtime 抽象**       | `ai/runtime/AbstractAgentRuntime.ts` | 1      | ~241   | 生产 |
| **Runtime 类型**       | `ai/runtime/types.ts`                | 1      | ~250   | 生产 |
| **ErrorRecoveryChain** | `ai/runtime/ErrorRecoveryChain.ts`   | 1      | ~300   | 生产 |
| **OpenAI Runtime**     | `ai/runtime/openai/`                 | 8      | ~2,000 | 生产 |
| **PiMono Runtime**     | `ai/runtime/pimono/`                 | 7      | ~1,500 | 生产 |
| **工具系统**           | `ai/tools/`                          | 15     | ~2,500 | 生产 |
| **沙箱安全**           | `ai/sandbox/`                        | 7      | ~1,100 | 生产 |
| **流式事件**           | `ai/streaming/`                      | 6      | ~600   | 生产 |
| **HITL**               | `ai/hitl/`                           | 2      | ~350   | 生产 |
| **进程管理**           | `ai/process/`                        | 2      | ~400   | 生产 |
| **Extension 系统**     | `common/extension/`                  | 8      | ~1,200 | 生产 |
| **内置扩展**           | `extensions/`                        | 4      | ~650   | 生产 |
| **记忆模块（储备）**   | `ai/memory/`                         | 6      | ~1,400 | 储备 |
| **编排模块（储备）**   | `ai/orchestration/`                  | 5      | ~1,400 | 储备 |
| **Swarm（储备）**      | `ai/swarm/`                          | 8      | ~4,100 | 储备 |
| **Teams（储备）**      | `ai/teams/`                          | 3      | ~700   | 储备 |

**生产代码合计**：约 11,000 行
**设计储备代码**：约 7,600 行

### 2.2 完整执行链路图

```
用户输入
    │
    ▼
Gateway chat.send(message, mode)
    │  ├── mode='agent' → 全部工具 + Skill + 执行协议
    │  └── mode='chat'  → 工具（排除 exec） + 简化指令
    │
    ▼
AgentExecutor.submit({ sessionId, message, builder })
    │  ├── busy 检查（同 session 串行）
    │  └── 异步 execute()
    │
    ▼
AgentExecutor.execute()
    │
    ├── 1. AgentEnvInjector.injectEnv(builder, mode)
    │       ├── sessionDir / workspaceRoot / contextDir（始终注入）
    │       └── mode='agent' 时：
    │           ├── SkillManager.scanSkills(skillPaths)
    │           ├── buildExecutionProtocol(skillManager)
    │           ├── formatRuntimePaths(agentEnv)
    │           └── Skill 发现提示
    │
    ├── 2. builder.build() → AgentRuntime 实例
    │
    ├── 3. runtime.initialize()
    │       ├── OpenAI: createAgent() + FileSession + ThinkTagParser
    │       └── PiMono: createAgentSession() + ResourceLoader + convertTools()
    │
    ├── 4. Extension Hook: session_start
    │
    ├── 5. Extension Hook: before_agent_start
    │       ├── memory-auto: 注入记忆摘要
    │       └── 其他扩展: prependContext / replaceSystemPrompt
    │
    ├── 6. runtime.stream(input)  ← AbstractAgentRuntime 模板方法
    │       │
    │       ├── doStream(input)  ← 子类实现
    │       │
    │       │   ┌─── OpenAI 路径 ───┐    ┌─── PiMono 路径 ───┐
    │       │   │ Runner.run()      │    │ session.prompt()   │
    │       │   │ SDK 内部工具循环  │    │ SDK 内部工具循环   │
    │       │   │ onEvent 回调      │    │ subscribe 回调     │
    │       │   │ ThinkTagParser    │    │ <think> 解析       │
    │       │   └───────────────────┘    └────────────────────┘
    │       │
    │       │   工具调用（每次）：
    │       │   ├── Extension Hook: before_tool_call
    │       │   │   ├── tool-approval: exec → checkExecPolicy → HITL
    │       │   │   └── tool-approval: needUserConfirm → HITL
    │       │   ├── isToolAllowed(toolPolicy) → sandbox 级别拦截
    │       │   ├── tool.execute(params, signal, sandboxContext)
    │       │   │   ├── path-guard 路径校验
    │       │   │   └── 工具逻辑执行
    │       │   ├── Extension Hook: after_tool_call
    │       │   └── Extension Hook: tool_result_persist
    │       │
    │       └── yield StreamChunk → AgentExecutor.forward()
    │
    ├── 7. StreamEmitter.forward(chunk)
    │       ├── CHUNK → StreamEvent 映射
    │       └── EventBus 广播 → StreamStore / StreamMonitor / 前端
    │
    ├── 8. Extension Hook: agent_end
    │       └── memory-auto: 检测记忆信号词 → 追加 memory
    │
    ├── 9. Extension Hook: session_end
    │
    └── 10. runtime.destroy()
```

---

## 三、逐模块深度分析

### 3.1 Runtime 层

#### 3.1.1 双 Runtime 架构

| 维度       | OpenAI Runtime                          | PiMono Runtime                               |
| ---------- | --------------------------------------- | -------------------------------------------- |
| SDK        | `@openai/agents`                        | `@mariozechner/pi-coding-agent`              |
| API 格式   | OpenAI Responses API                    | OpenAI Chat Completions                      |
| 工具循环   | SDK 内部（`Runner.run()`）              | SDK 内部（`session.prompt()`）               |
| Turn 边界  | 从 `response_started` 推断              | SDK 直接提供 `turn_start/end`                |
| 思考内容   | `ThinkTagParser` 解析 `<think>`         | SDK 原生 `thinking_delta` 或 `<think>` 解析  |
| 会话持久化 | `FileSession`（JSONL）                  | `SessionManager`（file/memory）              |
| 压缩       | `SessionCompressor`（外部实现）         | SDK 内置 `auto_compaction`                   |
| 重试       | `ErrorRecoveryChain`（外部）            | SDK 内置 `auto_retry` + `ErrorRecoveryChain` |
| 工具转换   | `convertToolsForOpenAI()` → OpenAI 格式 | `convertTools()` → Zod→JSON Schema           |
| HITL 支持  | 通过 Extension Hook                     | 通过 Extension Hook                          |

**发现 1（中）**：两个 Runtime 的工具转换逻辑高度相似（Hook 集成、策略检查、流式桥接），但各自独立实现。OpenAI 版在 `OpenAIAgentRuntime.ts` 中，PiMono 版在 `PiMonoToolConverter.ts` 中。应考虑提取公共工具执行管线。

**发现 2（低）**：`PiMono.clearSession()` 实现不完整（仅有注释"重新创建会话"），file 模式下无法真正清空。

#### 3.1.2 ErrorRecoveryChain

当前策略链：

```
AuthenticationStrategy → ContextCompressionStrategy → ThinkingLevelFallbackStrategy → SimpleRetryStrategy
```

**发现 3（中）**：`RecoveryContext.runtime` 需要由 `AbstractAgentRuntime.stream()` 注入，但当前代码中 `stream()` 创建的 `RecoveryContext` 未传入 `runtime` 属性。因此 `ContextCompressionStrategy` 和 `ThinkingLevelFallbackStrategy` 实际上永远走 `throw` 分支。

#### 3.1.3 流式事件体系

StreamChunk 类型层次：

```
run:start/done/error          → 运行生命周期
turn:start/done               → Turn 边界
llm:start/done                → LLM 调用
reasoning:start/delta/done    → 思考内容
text:start/delta/done         → 文本输出
tool:start/delta/done         → 工具执行
compression:start/done        → 上下文压缩
hitl:required/resolved        → 审批
```

**发现 4（低）**：OpenAI Runtime 内部创建了自己的 `StreamEmitter`（用于工具 `tool:delta` 事件），与 AgentExecutor 创建的 emitter 是不同实例。这意味着工具执行进度事件有两条广播路径，可能导致前端收到重复事件。

### 3.2 工具系统

#### 3.2.1 内置工具清单

| 工具            | 行数     | Pipeline | needUserConfirm | 安全机制                             |
| --------------- | -------- | -------- | --------------- | ------------------------------------ |
| read            | 121      | ✅       | ❌              | path-guard                           |
| write           | 92       | ✅       | ✅              | path-guard + file-lock + file-backup |
| edit            | 151      | ✅       | ❌              | path-guard + file-lock + file-backup |
| exec            | 257      | ❌       | ❌              | cwd 限制 + 输出截断                  |
| process         | 198      | ❌       | ❌              | 仅管理 exec 进程                     |
| memory          | 553      | ❌       | ❌              | 自实现 resolveMemoryPath             |
| session_status  | 88       | ❌       | ❌              | **无路径校验**                       |
| session_history | 92       | ❌       | ❌              | **无路径校验**                       |
| context_inspect | 165      | ❌       | ❌              | **无路径校验**                       |
| skill_list      | 80       | ❌       | ❌              | 只读 SkillManager                    |
| file-lock       | 工具函数 | -        | -               | 互斥锁                               |
| file-backup     | 工具函数 | -        | -               | 写入前备份                           |
| memory-index    | 工具函数 | -        | -               | 索引管理                             |

#### 3.2.2 安全发现

**发现 5（高 — P0）**：`context_inspect`、`session_status`、`session_history` 三个工具直接使用 `path.join(workspace, 'contexts', filename)` 拼接路径，**未经过 path-guard 校验**。如果 LLM 传入 `filename: '../../etc/passwd'`，理论上可以读取沙箱外文件。虽然当前这些工具仅在 Agent 模式下由 LLM 调用（非用户直接输入），但仍构成路径穿越风险。

**发现 6（中）**：`memory` 工具自实现了 `resolveMemoryPath()` 做路径安全校验，逻辑与 `path-guard.ts` 的 `resolveSandboxPath()` 高度重复。应统一使用 `path-guard`，减少安全逻辑散落。

**发现 7（中）**：`exec` 工具本身不做命令安全校验，完全依赖 `tool-approval` Extension 的 `before_tool_call` Hook。如果 Extension 系统未初始化或加载失败，`exec` 将无任何命令级安全保护。

#### 3.2.3 Pipeline 使用率

仅 `read`、`write`、`edit` 三个文件工具使用了 `pipeline.ts` 的 `resolveToolPath`、`formatFileError`、`checkAborted`。其余工具（exec、memory、session\_\*、context_inspect）均未接入管线。

**发现 8（低）**：Pipeline 的路径归一化 `normalizePathParam()` 在任何工具中均未被调用。

#### 3.2.4 缺失工具

**发现 9（中）**：项目无独立的文件搜索（grep/search）和文件发现（glob/find）工具。Agent 当前只能通过 `exec` 执行 shell 命令来搜索文件。Chat 模式下禁用了 `exec`，意味着 Chat 模式 Agent **完全无法搜索文件**。

### 3.3 沙箱安全

#### 3.3.1 策略层级

当前实现：

```
Agent 策略 → 全局策略 → 工具组策略 → 默认策略
deny 叠加 / allow 取交集 / confirm 叠加
```

工具组定义：

- `group:fs` → read, write, edit
- `group:exec` → exec, process
- `group:memory` → memory
- `group:observe` → session_status, session_history, context_inspect, skill_list

**发现 10（低）**：策略层级虽已实现 4 层合并，但当前无 per-agent 策略配置入口（`AgentConfigStore` 尚未实现），实际运行时只有默认策略生效。

#### 3.3.2 exec-policy

命令安全三级：

1. **DANGER_PATTERNS**（黑名单）：~15 条正则，匹配即拒绝
2. **SAFE_BINS**（白名单）：~50+ 命令，匹配即放行
3. **learnedAllowlist**：`approve-always` 时学习的命令前缀

**发现 11（中）**：`learnedAllowlist` 存储在内存中，进程重启后丢失。这是有意设计（安全优先），但应在文档中明确说明。

#### 3.3.3 Docker 沙箱

`docker.ts` 已实现基础的 Docker 容器管理，但：

**发现 12（中）**：`resolveSandboxContext()` 在 Docker 不可用时静默降级为 `path-only` 模式，不发出任何警告。安全敏感场景下，应明确告知用户当前运行在降级模式。

### 3.4 Extension 系统

#### 3.4.1 Hook 分类与执行

| Hook                | 模式      | 执行方式       | 用途                  |
| ------------------- | --------- | -------------- | --------------------- |
| before_agent_start  | modifying | 串行，按优先级 | 注入上下文/替换提示词 |
| before_tool_call    | modifying | 串行，按优先级 | 审批/参数修改/阻止    |
| tool_result_persist | modifying | 串行           | 修改持久化结果        |
| after_tool_call     | void      | 并行           | 工具执行后通知        |
| agent_end           | void      | 并行           | Agent 完成通知        |
| message_received    | void      | 并行           | 消息接收通知          |
| session_start       | void      | 并行           | 会话开始通知          |
| session_end         | void      | 并行           | 会话结束通知          |

#### 3.4.2 ExtensionServices 解耦状况

`ExtensionServices` 接口已定义，`createExtensionServices()` 通过动态 import 实现了懒加载。

**发现 13（中）**：`tool-approval` Extension 的实现仍然直接 `import('../../src/main/ai/hitl/HitlApprovalManager')`，未使用 `api.services.hitl`。P4-2 的设计意图（Extension 通过 services 接口访问核心能力）尚未在内置扩展中落地。

**发现 14（低）**：`memory-auto` Extension 直接读取文件系统（`fs.readFileSync`），未通过 `api.services` 提供的记忆服务接口，但这在当前设计下是合理的（Extension 直接操作文件是允许的）。

#### 3.4.3 Extension 加载流程

```
ReadyExtensionHook.execute()
  → Env.getExtensionSearchPaths() → [builtin, user, workspace]
  → ExtensionLoader.loadAll()
      → 扫描每个目录下的 extension.json
      → require(index.ts) → mod.register(api)
      → 注册 hooks / tools / gateway methods / skills
  → ExtensionManager.initialize(registry)
  → loader.watch() → 文件系统监听
```

**发现 15（低）**：Extension 热重载的 `inferOrigin()` 根据路径推断 Extension 来源，如果 Extension 目录结构变化可能推断错误。

### 3.5 记忆系统

#### 3.5.1 当前能力

- **存储**：Markdown 文件（`MEMORY.md` + `memory/*.md`）
- **搜索**：多关键字、逐行扫描、标题加权 ×2、主记忆 ×1.5、TF 归一化
- **索引**：`.memory-index.json`（写入时增量更新）
- **自动提取**：`memory-auto` Extension 在 `agent_end` 时检测信号词
- **自动注入**：`memory-auto` Extension 在 `before_agent_start` 时注入摘要

#### 3.5.2 索引利用度

**发现 16（中）**：`memory-index.ts` 实现了完整的索引构建、增量更新、搜索 API（`searchIndex`），但 `memory.ts` 的 `search` action **完全未使用索引**，仍然做全文件逐行扫描。索引层当前仅在 `write`/`append` 后触发更新，是一个"写了不读"的状态。

#### 3.5.3 与 OpenClaw 记忆系统差距

| 能力         | coobee-ai            | OpenClaw                 | 差距 |
| ------------ | -------------------- | ------------------------ | ---- |
| 全文检索     | 内存逐行 includes()  | SQLite FTS5              | 大   |
| 向量检索     | 无                   | sqlite-vec + Embedding   | 大   |
| 混合检索     | 无                   | BM25 + 向量 RRF 融合     | 大   |
| 自动索引     | 写入时增量（未利用） | 文件监听 + 自动重建      | 中   |
| Memory Flush | 无                   | 压缩前自动刷写           | 中   |
| 记忆插件化   | 固定实现             | 插件槽位（core/lancedb） | 中   |

#### 3.5.4 设计储备模块

`ai/memory/` 中的 `LongTermMemoryStore` 已定义 SQLite schema（含 `embedding` BLOB 字段），但：

- 未接入任何 Embedding Provider
- 搜索仍用 LIKE 关键字
- 整个模块标记为 `@experimental`，无外部引用

### 3.6 Skill 系统

#### 3.6.1 当前 Skill

| Skill              | 描述                     | 类型     |
| ------------------ | ------------------------ | -------- |
| execution-protocol | 五步工作法               | 核心流程 |
| self-reflection    | 质量/过程评估 + 修复策略 | 自我进化 |
| runtime-env        | 工作空间结构说明         | 环境感知 |
| skill-creator      | 创建新 Skill             | 元能力   |
| extension-creator  | 创建新 Extension         | 元能力   |
| icon-usage         | 项目图标使用             | 领域知识 |

#### 3.6.2 Skill 注入方式

Skill 不预注入全部内容到 LLM 上下文，而是：

1. `skill_list` 工具返回可用 Skill 列表
2. Agent 按需使用 `read` 工具读取 SKILL.md
3. 执行协议中引导 Agent 在"计划"阶段查看相关 Skill

**发现 17（低）**：Skill 按需加载设计良好，但当前没有 Skill 版本管理或变更检测机制。如果运行过程中 Skill 文件被修改，Agent 可能读取到不一致的内容。

### 3.7 会话管理

#### 3.7.1 OpenAI Runtime

- `FileSession`：JSONL 格式，追加写入
- `SessionCompressor`：token 溢出时触发压缩，使用 LLM 生成摘要
- 快照：`saveContextSnapshot()` 在执行后写入 `contexts/` 目录

#### 3.7.2 PiMono Runtime

- `SessionManager`：file 模式（`continueRecent`）或 memory 模式（`inMemory`）
- 压缩/重试：SDK 内置，通过 `SettingsManager` 配置

**发现 18（低）**：两个 Runtime 的会话管理完全独立，无共享的会话抽象。如果需要切换 Runtime，历史会话不可迁移。

### 3.8 Gateway 入口

```typescript
// chat.ts 的核心逻辑
chat.send → createBuilder(mode) → agentExecutor.submit({ sessionId, message, builder })
```

**发现 19（低）**：Gateway 目前只有 `chat.send` 一个入口，不支持会话列表、会话恢复、会话删除等管理操作。

---

## 四、与 OpenClaw 全面对标

### 4.1 架构模式对比

| 维度                 | coobee-ai                     | OpenClaw                                    | 评价           |
| -------------------- | ----------------------------- | ------------------------------------------- | -------------- |
| **部署模型**         | Electron 桌面应用             | Node.js 服务（多渠道）                      | 不同场景       |
| **Runtime 数量**     | 2（OpenAI + PiMono）          | 1（pi-coding-agent）                        | 灵活 vs 专注   |
| **工具循环**         | SDK 内部管理                  | SDK 内部管理                                | 一致           |
| **工具策略**         | 4 层合并                      | 8 层过滤                                    | 差距中等       |
| **工具转换**         | 各 Runtime 独立实现           | 统一 8 步管线                               | 差距明显       |
| **Extension**        | 8 hooks + 3 能力              | 10+ 能力 + 后台服务 + 渠道                  | 差距中等       |
| **HITL**             | Web UI 单渠道                 | 5 渠道（Web/macOS/Discord/Terminal/Socket） | 差距大         |
| **记忆**             | 文件 + 关键字搜索             | SQLite FTS5 + 向量                          | 差距大         |
| **多 Agent**         | 设计储备（未激活）            | 单级 fan-out（生产）                        | 差距大         |
| **并发控制**         | busy 锁（串行）               | Lane 队列（分类并发）                       | 差距大         |
| **安全验证**         | 无                            | TLA+ 形式化验证                             | 差距极大       |
| **会话管理**         | JSONL + file/memory           | JSONL + session 索引                        | 差距小         |
| **自我进化**         | Skill 驱动（self-reflection） | 无（外部管理）                              | coobee-ai 领先 |
| **Claude Code 兼容** | 无                            | 参数名双写 + Schema 兼容                    | 差距中等       |

### 4.2 coobee-ai 的独有优势

1. **双 Runtime 架构**：同时支持 OpenAI 和 PiMono（MiniMax/DeepSeek 等），用户可选择不同 Provider
2. **自我进化闭环**：self-reflection Skill + execution-protocol + memory-auto，Agent 能评估自身表现并积累经验
3. **Skill 系统设计**：按需加载 + 后到覆盖 + Extension 贡献，轻量且灵活
4. **Chat/Agent 双模式**：简化的对话模式 + 完整的 Agent 模式

### 4.3 需要追赶的关键差距

| 优先级 | 差距                          | 影响                  |
| ------ | ----------------------------- | --------------------- |
| **P0** | 路径穿越漏洞（3 个工具）      | 安全风险              |
| **P1** | 记忆搜索能力不足              | Agent 知识检索低效    |
| **P1** | 缺少文件搜索/发现工具         | Chat 模式无法搜索文件 |
| **P1** | ErrorRecoveryChain 策略未生效 | 错误恢复形同虚设      |
| **P2** | 工具执行管线未统一            | 两个 Runtime 重复代码 |
| **P2** | Extension 服务未落地          | 架构设计与实现脱节    |
| **P2** | 索引层未被利用                | 已投入的优化未生效    |
| **P3** | 多 Agent 协调                 | 缺少并行任务处理能力  |
| **P3** | 并发控制                      | 单 session 串行       |
| **P3** | HITL 多渠道                   | 仅 Web UI             |

---

## 五、新发现问题清单

本轮新发现的、前三轮未覆盖的问题：

| 编号 | 优先级 | 模块                   | 问题描述                                                                   |
| ---- | ------ | ---------------------- | -------------------------------------------------------------------------- |
| N-1  | **P0** | context_inspect        | 未使用 path-guard，filename 参数可路径穿越                                 |
| N-2  | **P0** | session_status/history | 同上，直接 path.join 拼接无校验                                            |
| N-3  | **P1** | ErrorRecoveryChain     | RecoveryContext.runtime 未注入，Compression/ThinkingLevel 策略永远走 throw |
| N-4  | **P1** | 工具系统               | 缺少 search/glob 工具，Chat 模式无法搜索文件                               |
| N-5  | **P1** | memory search          | 索引层已实现但 search 未使用，全文件扫描                                   |
| N-6  | **中** | tool-approval          | 仍直接 import 核心模块，未走 ExtensionServices                             |
| N-7  | **中** | exec 安全              | Extension 未加载时 exec 无命令级保护                                       |
| N-8  | **中** | memory 路径            | 自实现 resolveMemoryPath，与 path-guard 重复                               |
| N-9  | **中** | 工具转换               | OpenAI/PiMono 各自实现工具转换 + Hook 集成，代码重复                       |
| N-10 | **中** | Docker 降级            | 降级为 path-only 时无警告                                                  |
| N-11 | **低** | OpenAI 双 emitter      | Runtime 内部 emitter 与 Executor emitter 不同实例                          |
| N-12 | **低** | Pipeline 利用率        | normalizePathParam 未被调用                                                |
| N-13 | **低** | PiMono clearSession    | file 模式实现不完整                                                        |
| N-14 | **低** | 会话迁移               | 两个 Runtime 会话格式不兼容                                                |
| N-15 | **低** | Gateway 管理           | 无会话列表/恢复/删除 API                                                   |

---

## 六、架构健康度评估

| 模块         | 第 3 轮 | 第 4 轮 | 变化 | 说明                                   |
| ------------ | ------- | ------- | ---- | -------------------------------------- |
| Runtime 抽象 | ★★★★☆   | ★★★★☆   | →    | 双 Runtime 设计合理，工具转换需统一    |
| 工具系统     | ★★★☆☆   | ★★★½☆   | ↑    | Pipeline 已建立，但 3 个工具有安全漏洞 |
| 沙箱安全     | ★★★☆☆   | ★★★☆☆   | →    | 策略层级已完善，但工具端存在逃逸点     |
| Extension    | ★★★★☆   | ★★★★☆   | →    | Hook 机制健壮，Services 未落地         |
| HITL         | ★★★★★   | ★★★★★   | →    | 单渠道够用，架构清晰                   |
| 记忆系统     | ★★★★☆   | ★★★☆☆   | ↓    | 发现索引未利用，搜索能力实际不足       |
| 流式事件     | ★★★★☆   | ★★★½☆   | ↓    | 发现双 emitter 问题                    |
| 错误恢复     | ★★★☆☆   | ★★☆☆☆   | ↓    | 新策略未生效，形同虚设                 |
| Skill 系统   | ★★★★★   | ★★★★★   | →    | 轻量灵活，设计优秀                     |
| 会话管理     | ★★★☆☆   | ★★★☆☆   | →    | 两个 Runtime 独立管理                  |

---

## 七、总结

### 核心优势

1. 双 Runtime 架构提供了 Provider 灵活性
2. Extension Hook 机制设计优雅，tool-approval 成功解耦了 HITL
3. Skill 系统的按需加载 + 自我进化闭环是独特亮点
4. Chat/Agent 双模式满足不同使用场景

### 核心风险

1. 3 个工具存在路径穿越安全漏洞（P0）
2. ErrorRecoveryChain 的高级策略（压缩、思考级别降级）未生效
3. 记忆索引层虽已实现但未被利用
4. Chat 模式缺少文件搜索能力

### 架构债务

1. 两个 Runtime 的工具转换/Hook 集成代码重复
2. Extension 内置扩展未迁移到 Services 接口
3. ~7,600 行设计储备代码未激活
4. memory 路径安全逻辑与 path-guard 重复
