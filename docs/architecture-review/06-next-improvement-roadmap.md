# coobee-ai 下一阶段改进路线图（第 3 轮）

> 生成时间：2026-02-15  
> 基于：05-third-round-architecture-analysis.md  
> 原则：问题驱动、渐进改进、每项可独立交付  
> 依赖参考：OpenClaw 架构文档

---

## 改进优先级总览

| 编号 | 改进项                             | 优先级 | 复杂度 | 状态      |
| ---- | ---------------------------------- | ------ | ------ | --------- |
| P1-1 | 工具策略分层（Tool Policy Layers） | 高     | 中     | ✅ 已完成 |
| P1-2 | 工具管线标准化（Tool Pipeline）    | 高     | 中     | ✅ 已完成 |
| P1-3 | PiMonoAgentRuntime 拆分            | 中     | 中     | ✅ 已完成 |
| P2-1 | 死代码清理与模块边界标注           | 中     | 低     | ✅ 已完成 |
| P2-2 | HitlApprovalManager 清理           | 低     | 低     | ✅ 已完成 |
| P2-3 | Skill 命名统一 + 文档更新          | 低     | 低     | ✅ 已完成 |
| P3-1 | ErrorRecoveryChain 增强            | 中     | 中     | ✅ 已完成 |
| P3-2 | 记忆索引层（Memory Index）         | 中     | 高     | ✅ 已完成 |
| P3-3 | Hook 容错机制                      | 中     | 低     | ✅ 已完成 |
| P4-1 | 多 Agent 路线评估                  | 高     | 高     | ⏸️ 暂缓   |
| P4-2 | Extension API 解耦                 | 中     | 中     | ✅ 已完成 |
| P4-3 | 并发控制升级                       | 低     | 中     | ⏸️ 暂缓   |
| NEW  | Chat/Agent 双模式支持              | 高     | 中     | ✅ 已完成 |

---

## Phase 1 — 安全与工具系统（短期高优先级）

### P1-1 工具策略分层（Tool Policy Layers）

**问题**：当前只有 1 层策略（path-guard + exec-policy），所有 Agent 共享同一套规则。`tool-policy.ts` 存在但未真正启用。

**对标 OpenClaw**：8 层策略过滤，支持 per-agent / per-group / per-provider 粒度。

**改进方案**：

```
策略求值顺序（高→低）：
  Agent 策略 → 全局策略 → 工具组策略 → 工具默认策略

每个策略可以定义：
  - allow: string[]    → 允许的工具 / 工具组
  - deny: string[]     → 禁止的工具 / 工具组
  - confirm: string[]  → 需确认的工具 / 工具组

deny 永远覆盖 allow（安全优先）。
```

**改动点**：

1. 激活并重构 `tool-policy.ts`，增加策略层级接口
2. 定义工具组（`group:fs`, `group:exec`, `group:memory`, `group:observe`）
3. 在 `AgentConfigStore` 中存储 per-agent 策略
4. `before_tool_call` Hook 在 tool-approval 之前先走 policy 层

**测试策略**：

- 单元测试：策略合并逻辑（deny 覆盖 allow、分组展开）
- 集成测试：Agent 配置策略 → 工具被阻止 / 允许

---

### P1-2 工具管线标准化（Tool Pipeline）

**问题**：每个工具重复 `resolveSandboxPath() + pathGuardErrorToToolResult()` 样板代码，错误处理不一致。

**对标 OpenClaw**：统一工具管线（参数归一化 → schema 兼容性 → Hook → abort → 执行）。

**改进方案**：

```typescript
// tools/pipeline.ts
export async function* executeToolWithPipeline(
  toolName: string,
  params: Record<string, unknown>,
  context: SandboxContext,
  toolDef: ToolDefinition
): AsyncGenerator<ToolStreamUpdate, ToolResult> {
  // 1. 参数归一化（provider 适配）
  const normalized = normalizeParams(toolName, params, context.provider)

  // 2. 路径解析（自动处理所有包含 file_path / path 参数的工具）
  const resolved = resolveToolPaths(normalized, context)
  if (resolved.error) return pathGuardErrorToToolResult(resolved.error)

  // 3. 工具执行
  yield* toolDef.execute(resolved.params, undefined, context)
}
```

**改动点**：

1. 新建 `tools/pipeline.ts`，统一工具路径解析和错误格式化
2. 在 write.ts / edit.ts / read.ts 中移除重复的 resolveSandboxPath 调用
3. 统一 `ToolResult` 错误格式（始终返回结构化错误，不抛异常）

---

### P1-3 PiMonoAgentRuntime 拆分

**问题**：1,059 行的单文件，职责过多。

**改进方案**：

```
pimono/
├── PiMonoAgentRuntime.ts    — 核心生命周期（create/start/stream/destroy）
├── PiMonoToolConverter.ts   — convertTools() 逻辑
├── PiMonoSessionManager.ts  — 会话管理 + 上下文压缩
├── PiMonoStreamAdapter.ts   — ChunkQueue + 流式事件转接
├── PiMonoBuilder.ts         — 构建器（已存在）
├── types.ts                 — 类型定义（已存在）
└── __tests__/
```

**改动点**：

1. 提取 `convertTools()` 到 `PiMonoToolConverter.ts`
2. 提取会话管理到 `PiMonoSessionManager.ts`
3. 保持 `PiMonoAgentRuntime.ts` 只做生命周期编排

---

## Phase 2 — 代码质量（短期低复杂度）

### P2-1 死代码清理与模块边界标注

**问题**：`memory/`, `orchestration/`, `swarm/`, `teams/` 四个模块（~7,600 行）未被业务代码引用。

**改进方案**：

1. 在每个模块的 `index.ts` 顶部添加 `@experimental` 注释
2. 添加 `README.md` 说明模块状态（设计储备 / 待激活 / 待删除）
3. 暂不删除，但明确标注避免被误用
4. `teams/` 因绑定 OpenAI SDK 且与 swarm/ 功能重叠，标记为 `@deprecated`

### P2-2 HitlApprovalManager 清理

**改动点**：

1. `waitForDecisions()` / `submitDecision()` 标记 `@deprecated`
2. 相关测试标记为 `describe.skip` 或添加 `@deprecated` 注释
3. 删除 `exec-policy.ts` 头部过时注释（提到 SDK needsApproval）

### P2-3 Skill 命名统一 + 文档更新

**改动点**：

1. `Self-Reflection` → `self-reflection`（修改 SKILL.md frontmatter name 字段）
2. 确认所有 Skill 统一使用 kebab-case
3. 更新 `03-comprehensive-architecture-analysis.md` 中 HITL 相关章节的状态标注

---

## Phase 3 — 韧性与记忆增强

### P3-1 ErrorRecoveryChain 增强

**当前差距**：

- ContextLengthStrategy 仅重试，不触发上下文压缩
- 无模型降级策略
- 无思考级别降级

**改进方案**：

```typescript
// 新增策略
export class ContextCompressionStrategy implements RecoveryStrategy {
  canHandle(error: Error): boolean {
    return error.message.includes('context_length') || error.message.includes('max_tokens')
  }
  async recover(error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    // 触发 SessionCompressor.compress() 后重试
    if (context.runtime?.compressor) {
      await context.runtime.compressor.compress()
      return { action: 'retry', reason: 'Context compressed, retrying' }
    }
    return { action: 'throw', reason: 'No compressor available' }
  }
}

export class ThinkingLevelFallbackStrategy implements RecoveryStrategy {
  // 降低 thinking level 后重试
  // high → medium → low → off
}
```

**改动点**：

1. 增加 `ContextCompressionStrategy`，连接到 `SessionCompressor`
2. 增加 `ThinkingLevelFallbackStrategy`
3. 在 `RecoveryContext` 中传入 runtime 引用
4. 测试各策略的降级链路

### P3-2 记忆索引层（Memory Index）

**问题**：当记忆文件 > 100 个时，逐文件扫描性能下降，搜索只有关键字匹配。

**OpenClaw 方案**：SQLite FTS5 + sqlite-vec。  
**原则**：优先文件，轻量索引。

**改进方案**（渐进式）：

**阶段 A — 元数据索引（短期）**：

```
.home/workspaces/{id}/memory/
├── MEMORY.md
├── memory/
│   └── *.md
└── .memory-index.json   ← 新增：轻量索引文件
```

```typescript
interface MemoryIndex {
  version: 1
  lastUpdated: string
  entries: {
    file: string
    title: string
    tags: string[] // 自动提取
    summary: string // 首段
    updatedAt: string
    size: number
  }[]
}
```

- Agent search 时先查索引，再按需读全文
- memory-auto Extension 写入记忆时同步更新索引

**阶段 B — FTS 搜索（中期可选）**：

- 引入 better-sqlite3 + FTS5
- 对记忆文本建全文索引
- 保留文件作为 source of truth，SQLite 只做索引

### P3-3 Hook 容错机制

**问题**：Extension 的 Hook 如果抛异常，当前会中断整个执行链路。

**对标 OpenClaw**：Plugin 错误被捕获，Hook 失败时 fail open。

**改进方案**：

- `runModifyingHook` 中为每个 handler 包裹 try/catch
- 失败时 console.error + 继续下一个 handler
- `before_tool_call` 特殊处理：失败时默认 allow（安全优先考虑下可配置）
- 新增 Hook 执行时间监控（warn > 1s, error > 5s）

---

## Phase 4 — 架构演进（中期）

### P4-1 多 Agent 路线评估

**当前储备**：

- `swarm/` — 自研多 Agent 协调（4,100 行）
- `teams/` — OpenAI SDK 绑定（700 行）
- `orchestration/` — 计划与验证（1,400 行）

**OpenClaw 方案**：单级 fan-out + Lane 队列 + 子 Agent 工具策略限制。

**评估维度**：

| 维度     | swarm/                         | OpenClaw 单级 fan-out |
| -------- | ------------------------------ | --------------------- |
| 复杂度   | 高（完整编排）                 | 低（简单派发）        |
| SDK 绑定 | 无                             | 无                    |
| 循环风险 | 有（多级嵌套）                 | 无（强制单级）        |
| 并发模型 | AgentPool + ConcurrencyManager | Lane 队列             |
| 恢复能力 | 无                             | 子 Agent 注册表持久化 |

**建议**：

1. 先做 "单级 fan-out" 作为 MVP
2. `swarm/` 可以保留作为高级模式的候选
3. 具体方案需要单独文档讨论

### P4-2 Extension API 解耦

**问题**：`tool-approval` Extension 直接 import `src/main/ai/hitl/HitlApprovalManager`。Extension 与核心模块不应有直接依赖。

**改进方案**：

```typescript
// Extension API 暴露的服务接口
interface ExtensionServices {
  hitl: {
    requestApproval(sessionId: string, toolName: string, params: unknown): Promise<ApprovalResult>
  }
  memory: {
    read(scope: 'agent' | 'user', path: string): Promise<string>
    write(scope: 'agent' | 'user', path: string, content: string): Promise<void>
  }
  events: StreamEmitter
}

// Extension 注册时通过 api 获取
export function register(api: ExtensionAPI): void {
  const hitl = api.services.hitl
  // ...
}
```

**改动点**：

1. 在 `ExtensionManager` 中注册服务提供者
2. Extension `register(api)` 的 `api` 参数增加 `services` 属性
3. 迁移 tool-approval 和 memory-auto 使用 API 而非直接 import

### P4-3 并发控制升级

**问题**：当前只有 busy 锁（同 session 串行），没有多级并发控制。

**对标 OpenClaw**：Lane 队列（main:4, subagent:8, session:1, cron:1）。

**改进方案**（预留设计，暂不实施）：

```typescript
interface LaneConfig {
  main: number // 主交互通道并发数
  subagent: number // 子 Agent 并发数
  background: number // 后台任务并发数
}
```

**注意**：当前 Electron 单进程模型下，并发需求较低。此项主要是为未来多 Agent 做架构预留。

---

## 实施时间线（建议）

```
┌─────────────────────────────────────────────────────────┐
│ 短期（1-2 周）                                          │
│  ├── P2-1 死代码标注                          [0.5d]   │
│  ├── P2-2 HitlApprovalManager 清理            [0.5d]   │
│  ├── P2-3 Skill 命名统一                      [0.5d]   │
│  ├── P1-2 工具管线标准化                      [2d]     │
│  └── P3-3 Hook 容错机制                       [1d]     │
│                                                         │
│ 中期（3-4 周）                                          │
│  ├── P1-1 工具策略分层                        [3d]     │
│  ├── P1-3 PiMono 拆分                         [2d]     │
│  ├── P3-1 ErrorRecoveryChain 增强             [2d]     │
│  └── P4-2 Extension API 解耦                  [2d]     │
│                                                         │
│ 长期（1-2 月）                                          │
│  ├── P3-2 记忆索引层                          [5d]     │
│  ├── P4-1 多 Agent 路线评估                   [3d]     │
│  └── P4-3 并发控制升级                        [2d]     │
└─────────────────────────────────────────────────────────┘
```

---

## 附录：已完成改进回顾

> 以下为前两轮路线图（04-improvement-roadmap.md）中已完成的改进项

| 编号      | 改进项                                                                                | 完成日期   |
| --------- | ------------------------------------------------------------------------------------- | ---------- |
| R2-P1-1   | HITL 独立于 SDK（tool-approval Extension）                                            | 2026-02-14 |
| R2-P1-2   | path-guard 符号链接测试补充                                                           | 2026-02-14 |
| R2-P1-3   | Extension Skill 发现 + 优先级覆盖                                                     | 2026-02-14 |
| R2-P2-1~4 | Memory 文件驱动系统                                                                   | 2026-02-13 |
| R2-P3-1   | 评估结果 → 记忆                                                                       | 2026-02-13 |
| R2-P3-2   | self-reflection 经验沉淀                                                              | 2026-02-14 |
| R2-P3-3   | 执行协议 Skill 化                                                                     | 2026-02-14 |
| R2-P4-1   | Extension 来源校验                                                                    | 2026-02-14 |
| R2-P4-2   | ErrorRecoveryChain 基础框架                                                           | 2026-02-14 |
| R2-P4-3   | write/edit 版本追踪                                                                   | 2026-02-14 |
| R3-P1-1   | 工具策略分层（group: 支持 + confirm + mergeToolPolicies）                             | 2026-02-15 |
| R3-P1-2   | 工具管线标准化（pipeline.ts + 消除 read/write/edit 样板）                             | 2026-02-15 |
| R3-P2-1   | 死代码标注（memory/ orchestration/ swarm/ @experimental）                             | 2026-02-15 |
| R3-P2-2   | HitlApprovalManager 批量 API @deprecated + exec-policy 注释更新                       | 2026-02-15 |
| R3-P2-3   | Skill 命名统一 kebab-case + 删除重复 self-reflection                                  | 2026-02-15 |
| R3-P3-3   | Hook 执行时间监控（warn >1s, error >5s）                                              | 2026-02-15 |
| R3-NEW    | Chat/Agent 双模式（AgentMode 类型 + Builder.mode() + 条件注入）                       | 2026-02-15 |
| R3-P3-1   | ErrorRecoveryChain 增强（ContextCompressionStrategy + ThinkingLevelFallbackStrategy） | 2026-02-15 |
| R3-P3-2   | 记忆索引层（memory-index.ts 元数据索引 + memory.ts 增量更新集成）                     | 2026-02-15 |
| R3-P4-2   | Extension API 解耦（ExtensionServices 接口 + 懒加载注入 hitl/events）                 | 2026-02-15 |
| R3-P1-3   | PiMonoAgentRuntime 拆分（1059→482 行 + ToolConverter 181 行 + StreamAdapter 480 行）  | 2026-02-15 |
