# 扩展点对比分析

> coobee-ai vs OpenClaw vs pi-coding-agent SDK
>
> 基于源码级分析，找出扩展点缺口并提出改进方案。
>
> 2026-02-12

---

## 一、三系统总览

### coobee-ai

- 已定义 **8** 个 Hook，全部被调用
- 4 个被内置模块使用（HITL、Sandbox 等）
- 覆盖层级：会话、Agent、工具

### OpenClaw

- 已定义 **15** Plugin Hook + **6** Internal Hook
- 实际只调用 **5** 个 Plugin + **4** Internal
- 仅 **2** 个 Plugin 被插件使用
- 覆盖层级：会话、Agent、工具、消息、Gateway

### pi-coding-agent SDK

- 已定义 **19+** Extension Event，全部由 SDK 触发
- **60+** 示例扩展
- 覆盖层级：会话、Agent、Turn、工具、
  上下文、模型、输入、资源

### 注册与执行方式

三者都使用 `api.on(name, handler)` 注册。

执行模式：

- **void**（旁听型）：并行执行，互不影响
- **modifying**（拦截型）：按优先级顺序，结果合并

容错策略：

- coobee-ai：独立 try-catch + 计时告警
- OpenClaw：错误不阻断主流程
- pi SDK：SDK 内部处理

### 扩展能力范围

- **coobee-ai**：
  Hook + Tool + Gateway Method
- **OpenClaw**：
  Hook + Internal Hook + Tool + Command +
  Channel + Route + Middleware + Provider
- **pi SDK**：
  Event + Tool + Command + Shortcut +
  Flag + UI

---

## 二、Hook 逐项对比

按生命周期从外到内排列。

每项格式：`Hook名` → 三系统支持情况 → 结论

### Gateway 级

**`gateway_start` / `gateway_stop`**

- coobee-ai：无
- OpenClaw：定义但未调用
- pi SDK：无
- 结论：**无需补齐**
  （coobee-ai 用 Electron 生命周期管理）

### 会话级

**`session_start`**

- coobee-ai：✅ 已定义（void）
- OpenClaw：定义未调用
- pi SDK：✅ `session_start`

**`session_end`**

- coobee-ai：✅ 已定义（void）
- OpenClaw：定义未调用
- pi SDK：✅ `session_shutdown`

**`session_switch` / `session_fork` /
`session_before_fork` / `session_tree`**

- coobee-ai：无
- OpenClaw：无
- pi SDK：✅ 全部支持
- 结论：**暂不需要**
  （coobee-ai 暂无会话分叉/切换能力）

### 消息级

**`message_received`**

- coobee-ai：✅（void）
- OpenClaw：✅ 已调用
- pi SDK：✅ `input`

**`message_sending`**（modifying）

- coobee-ai：无
- OpenClaw：定义未调用
- pi SDK：无
- 结论：**低优先级**

**`message_sent`**（void）

- coobee-ai：无
- OpenClaw：定义未调用
- pi SDK：无
- 结论：**低优先级**

### Agent 执行级

**`before_agent_start`**（modifying）

- coobee-ai：✅
- OpenClaw：✅ 已调用
- pi SDK：✅

**`agent_end`**（void）

- coobee-ai：✅
- OpenClaw：✅ 已调用
- pi SDK：✅

**`run_start`**（void）

- coobee-ai：❌ 缺失
- OpenClaw：无
- pi SDK：✅ `agent_start`
- 结论：**建议补齐**
  （与 `agent_end` 对称，形成闭环）

**`run_error`**（void）

- coobee-ai：❌ 缺失
- OpenClaw：无
- pi SDK：无
- 结论：**P2 后续补齐**

### Turn 轮次级 ⚠️ 重要缺失

**`turn_start`**（void）

- coobee-ai：❌ **缺失**
- OpenClaw：无
- pi SDK：✅

**`turn_end`**（void）

- coobee-ai：❌ **缺失**
- OpenClaw：无
- pi SDK：✅

**结论：必须补齐。** 轮次是 Agent Loop 核心单元：

- Git checkpoint（每轮开始创建恢复点）
- 进度追踪（第 N/M 轮）
- Token 用量统计（按轮次计费）
- Memory Flush（轮次结束时提取记忆）

### LLM 调用级

**`llm_done`**（void）

- coobee-ai：❌ 缺失
- OpenClaw：无
- pi SDK：无
- 结论：**建议补齐**
  （token 用量统计和成本分析）

### 工具级

**`before_tool_call`**（modifying）

- coobee-ai：✅
- OpenClaw：✅ 已调用
- pi SDK：✅ `tool_call`

**`after_tool_call`**（void）

- coobee-ai：✅
- OpenClaw：定义未调用
- pi SDK：✅ `tool_result`

**`tool_result_persist`**（modifying）

- coobee-ai：✅
- OpenClaw：✅ 已调用
- pi SDK：无（coobee-ai 独有）

**结论：覆盖最完整，无需补齐。**

### 压缩级 ⚠️ 重要缺失

**`before_compaction`**（modifying）

- coobee-ai：❌ **缺失**
- OpenClaw：定义但未调用
- pi SDK：✅ `session_before_compact`

**`after_compaction`**（void）

- coobee-ai：❌ **缺失**
- OpenClaw：定义但未调用
- pi SDK：无

**结论：必须补齐。** 与 Memory 系统深度关联：

- `before_compaction`：
  触发 Memory Flush（压缩前提取重要记忆）
- `after_compaction`：
  更新记忆索引、统计压缩效果
- pi SDK 可返回 `{ compaction }`
  完全替换默认压缩

### 上下文级

**`context`**（modifying）

- coobee-ai：无
- OpenClaw：无
- pi SDK：✅
  （每次 LLM 调用前过滤/修改 messages）
- 结论：**中等优先级**

### HITL 审批级

**`hitl_required` / `hitl_approved` /
`hitl_rejected`**（void）

- 三个系统均无独立 Hook
- coobee-ai 有 `hitl:*` 流式事件，
  但未暴露为 Extension Hook
- 结论：**P2 建议补齐**

### 模型/资源级

**`model_select`**（void）

- 仅 pi SDK 支持
- 结论：**低优先级**

**`resources_discover`**（modifying）

- 仅 pi SDK 支持（动态 Skill/Prompt/Theme）
- 结论：**低优先级**

**`user_bash`**（modifying）

- 仅 pi SDK 支持（用户直接执行 bash）
- 结论：**低优先级**

---

## 三、流式事件 → Hook 映射

coobee-ai 已有 **27 种 StreamChunkType**，
但只有 **8 个 Extension Hook**。

很多流式事件已在 Runtime 内部产生，
只需在触发点添加 Hook 调用即可。

### 可转化（建议补齐）

**高优先级：**

- `turn:start` → `turn_start`（void，低难度）
- `turn:done` → `turn_end`（void，低难度）
- `compression:start` → `before_compaction`
  （modifying，中难度）
- `compression:done` → `after_compaction`
  （void，低难度）

**中优先级：**

- `run:start` → `run_start`（void，低难度）
- `run:error` → `run_error`（void，低难度）
- `llm:done` → `llm_done`（void，低难度）
- `hitl:required` → `hitl_required`
  （void，低难度）
- `hitl:approved` → `hitl_approved`
  （void，低难度）
- `hitl:rejected` → `hitl_rejected`
  （void，低难度）

### 不适合做 Hook

- `text:delta` / `reasoning:delta` / `tool:delta`
  → 高频增量，Hook 开销过大
- `text:start` / `reasoning:start`
  → 粒度过细，`turn_start` 已覆盖
- `text:done` / `reasoning:done`
  → 可并入 `llm_done`
- `handoff:start` / `handoff:done`
  → 多 Agent 场景暂缓

---

## 四、差距分析与改进方案

### 4.1 缺口总结

**P0 高优先级：**

1. **Turn 轮次**：
   缺 `turn_start` / `turn_end`
   → 无法按轮次做 checkpoint、统计、
   Memory Flush
2. **压缩**：
   缺 `before_compaction` / `after_compaction`
   → 无法压缩前 Memory Flush，
   无法自定义压缩

**P1 中优先级：**

3. **执行入口**：
   缺 `run_start`
   → 与 `agent_end` 不对称
4. **LLM 调用**：
   缺 `llm_done`
   → 无法按 LLM 粒度统计 token

**P2 低优先级：**

5. **HITL**：
   缺 `hitl_required` / `hitl_approved` /
   `hitl_rejected`
   → 审批对扩展不可见
6. **执行异常**：
   缺 `run_error`
   → 无法执行失败时告警

### 4.2 分阶段新增 8 个 Hook

#### Phase 1（P0 — 立即实施）

新增 4 个：

```
turn_start        (void)      轮次开始
turn_end          (void)      轮次完成
before_compaction (modifying)  压缩前
after_compaction  (void)      压缩完成
```

#### Phase 2（P1 — 近期实施）

新增 2 个：

```
run_start  (void)  执行开始
llm_done   (void)  LLM 调用完成
```

#### Phase 3（P2 — 后续迭代）

新增 2 个：

```
run_error     (void)  执行异常
hitl_decided  (void)  HITL 审批决策
```

### 4.3 完成后 Hook 清单（16 个）

**现有 8 个：**

```
✅ before_agent_start  (modifying)
✅ agent_end            (void)
✅ before_tool_call     (modifying)
✅ after_tool_call      (void)
✅ tool_result_persist  (modifying)
✅ message_received     (void)
✅ session_start        (void)
✅ session_end          (void)
```

**Phase 1 新增 4 个：**

```
🆕 turn_start           (void)
🆕 turn_end             (void)
🆕 before_compaction    (modifying)
🆕 after_compaction     (void)
```

**Phase 2 新增 2 个：**

```
🆕 run_start            (void)
🆕 llm_done             (void)
```

**Phase 3 新增 2 个：**

```
🆕 run_error            (void)
🆕 hitl_decided         (void)
```

---

## 五、Phase 1 类型设计

### turn_start / turn_end

```typescript
interface TurnStartEvent {
  sessionId: string;
  turnIndex: number; // 从 1 开始
}

interface TurnEndEvent {
  sessionId: string;
  turnIndex: number;
  durationMs: number;
  toolCallCount: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

使用场景：

- Git checkpoint：
  `on('turn_start', () => exec('git stash create'))`
- Memory Flush：
  `on('turn_end', () => memoryProcessor.flush())`
- 进度通知：
  `on('turn_start', () => setStatus('Turn N'))`

### before_compaction / after_compaction

```typescript
interface BeforeCompactionEvent {
  sessionId: string;
  messageCount: number; // 待压缩消息数
  totalTokens: number; // 当前 token 总数
  threshold: number; // 触发阈值
}

interface BeforeCompactionResult {
  skipDefault?: boolean; // 跳过默认压缩
  customSummary?: string; // 自定义摘要
}

interface AfterCompactionEvent {
  sessionId: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  duration: number; // ms
}
```

合并规则（modifying）：

- `skipDefault`：任一为 true 则 true
- `customSummary`：后者覆盖前者

使用场景：

- Memory Flush：
  `on('before_compaction', () =>`
  `  memoryProcessor.extractBeforeCompress())`
- 自定义压缩：
  `on('before_compaction', () =>`
  `  ({ skipDefault: true, customSummary }))`
- 统计：
  `on('after_compaction', () =>`
  `  analytics.logCompression(event))`

### Phase 2 类型

```typescript
interface RunStartEvent {
  sessionId: string;
  prompt: string;
  mode: AgentMode; // 'chat' | 'agent'
}

interface LlmDoneEvent {
  sessionId: string;
  turnIndex: number;
  responseId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
}
```

---

## 六、实现路径

### Step 1：类型定义

文件：`src/main/common/extension/types.ts`

- 扩展 `ExtensionHookName` 联合类型
- 新增 Event / Result 接口
- 更新 `ExtensionHookEventMap` 映射
- 更新 `ExtensionHookResultMap` 映射

### Step 2：Hook Mode 注册

```typescript
// EXTENSION_HOOK_MODE 新增：
turn_start: 'void',
turn_end: 'void',
before_compaction: 'modifying',
after_compaction: 'void'
```

### Step 3：合并策略

文件：`ExtensionHookRunner.ts`

```typescript
case 'before_compaction':
  return {
    skipDefault:
      prev.skipDefault || next.skipDefault,
    customSummary:
      next.customSummary ?? prev.customSummary
  }
```

### Step 4：触发点接入

**`turn_start` / `turn_end`**：

- 位置：`PiMonoStreamAdapter.ts`
- 在 `turn:start` / `turn:done` 事件处触发
- PiMono SDK 已有 turn 事件

**`before_compaction`**：

- 位置：`SessionCompressor.compress()` 入口
- 在实际压缩前触发，等待结果

**`after_compaction`**：

- 位置：`SessionCompressor.compress()` 完成后
- 异步触发，不阻塞

### 异步策略

**void Hook**（不阻塞主流程）：

```typescript
hookRunner.runVoidHook('turn_start', event).catch((err) => {
  console.error('[Hook] turn_start:', err);
});
```

**modifying Hook**（必须等待结果）：

```typescript
const result = await hookRunner.runModifyingHook('before_compaction', event);

if (result?.skipDefault) {
  return { summary: result.customSummary };
}
// 继续默认压缩
```

---

## 七、生命周期触发时序

Phase 1 完成后的完整执行流程：

```
用户消息
  │
  ▼
message_received
  │
  ▼
session_start（首次）
  │
  ▼
before_agent_start
  → 注入上下文 / 替换 SystemPrompt
  │
  ▼
run_start (Phase 2)
  │
  ├─ turn_start { turnIndex: 1 }
  │    │
  │    ├─ LLM 调用
  │    │   └─ llm_done (Phase 2)
  │    │
  │    ├─ 文本输出 (text:delta...)
  │    │
  │    ├─ 工具调用
  │    │   ├─ before_tool_call
  │    │   │   → 拦截 / 修改参数
  │    │   ├─ [HITL 审批]
  │    │   │   → hitl_decided (Phase 3)
  │    │   ├─ [工具执行]
  │    │   ├─ after_tool_call
  │    │   └─ tool_result_persist
  │    │       → 修改持久化结果
  │    │
  │    └─ turn_end { turnIndex: 1 }
  │
  ├─ turn_start { turnIndex: 2 }
  │    └─ ... (循环)
  │       └─ turn_end { turnIndex: 2 }
  │
  ├─ [压缩触发]
  │    ├─ before_compaction
  │    │   → Memory Flush
  │    ├─ [执行压缩]
  │    └─ after_compaction
  │
  └─ agent_end
       │
       ▼
  run_error (Phase 3，仅失败时)
       │
       ▼
  session_end（会话结束时）
```

---

## 八、与 Memory 系统的协同

新增 Hook 为"流程式主动记忆系统"
提供了关键接入点：

**记忆提取** — 触发于 `turn_end`（void）

> 每轮结束后，Memory Processor 分析
> 本轮对话，提取关键信息

**压缩前 Flush** — 触发于 `before_compaction`
（modifying）

> 压缩前，Memory Processor 主动提取
> 即将被压缩的消息中的重要记忆

**记忆注入** — 触发于 `before_agent_start`
（modifying）

> Agent 启动时，Memory Processor
> 注入相关记忆到上下文

**记忆索引更新** — 触发于 `after_compaction`
（void）

> 压缩后，更新记忆索引的 token 位置信息

这正是"流程式、主动式记忆系统"的核心架构：

- 独立于 Agent Runtime
- 在流程关键节点主动介入
- 使用自己的 LLM Client 做记忆提取
- 通过 Extension Hook 接入，
  不侵入 Runtime 代码

---

## 九、三系统事件对应表

### coobee-ai ↔ pi SDK

```
session_start      ↔ session_start
session_end        ↔ session_shutdown
message_received   ↔ input
before_agent_start ↔ before_agent_start
agent_end          ↔ agent_end
run_start (新)     ↔ agent_start
turn_start (新)    ↔ turn_start
turn_end (新)      ↔ turn_end
before_tool_call   ↔ tool_call
after_tool_call    ↔ tool_result
tool_result_persist ↔ (pi 无此概念)
before_compaction   ↔ session_before_compact
after_compaction    ↔ (pi 无此概念)
llm_done (新)      ↔ (pi 无独立事件)
(无)               ↔ context
(无)               ↔ model_select
(无)               ↔ resources_discover
(无)               ↔ user_bash
```

### coobee-ai ↔ OpenClaw

```
before_agent_start ↔ before_agent_start ✅调用
agent_end          ↔ agent_end          ✅调用
before_tool_call   ↔ before_tool_call   ✅调用
after_tool_call    ↔ after_tool_call    ❌未调用
tool_result_persist ↔ tool_result_persist ✅调用
message_received   ↔ message_received   ✅调用
session_start      ↔ session_start      ❌未调用
session_end        ↔ session_end        ❌未调用
before_compaction  ↔ before_compaction  ❌未调用
after_compaction   ↔ after_compaction   ❌未调用
turn_start (新)    ↔ (OpenClaw 无)
turn_end (新)      ↔ (OpenClaw 无)
run_start (新)     ↔ (OpenClaw 无)
llm_done (新)      ↔ (OpenClaw 无)
(无)               ↔ message_sending    ❌未调用
(无)               ↔ message_sent       ❌未调用
(无)               ↔ gateway_start      ❌未调用
(无)               ↔ gateway_stop       ❌未调用
```

---

## 十、总结

### 核心发现

1. coobee-ai 的 **8 个 Hook 覆盖了基本功能**，
   但在 Turn 级和压缩级存在关键缺口

2. OpenClaw **定义 15 个但只调用 5 个** —
   说明"定义够用"比"定义很多"更重要

3. pi SDK **19+ 事件最丰富**，
   但很多是 CLI 场景特有的

4. coobee-ai **27 种 StreamChunkType**
   已是完善的事件体系，
   只需将关键流式事件"升级"为 Hook 即可

### 行动建议

**Phase 1**（2-3 天）：

- `turn_start` / `turn_end`
- `before_compaction` / `after_compaction`
- 核心价值：Memory Flush、Git Checkpoint、
  自定义压缩

**Phase 2**（1 天）：

- `run_start` / `llm_done`
- 核心价值：执行闭环、Token 统计

**Phase 3**（1 天）：

- `run_error` / `hitl_decided`
- 核心价值：异常告警、审批追踪

**优先实施 Phase 1**，
它是 Memory 系统架构的前置依赖。
