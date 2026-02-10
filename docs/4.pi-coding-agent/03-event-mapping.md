# pi-coding-agent → StreamChunk 事件映射方案

> 对比当前 OpenAI Agents SDK 的 `consumeStreamEvents` 逻辑，
> 分析切换到 pi-coding-agent 后事件转换的简化程度。
> 基于真实测试日志 `test-results/20260210/agent-events-*.log` 分析。

---

## 一、两套 SDK 的事件结构对比

### 1.1 OpenAI Agents SDK（当前方案）

三层原始事件，需要自己合成 turn/llm 生命周期：

```
raw_model_stream_event
  ├── response_started      ← 我们用它推断 turn:start + llm:start
  ├── output_text_delta     ← text:delta
  ├── response_done         ← text:done + llm:done（含 usage）
  └── model (SSE raw)       ← 包含 tool_calls / usage / finish_reason

run_item_stream_event
  ├── tool_called           ← tool:start
  ├── tool_output           ← tool:done
  ├── handoff_requested     ← handoff:start
  ├── handoff_occurred      ← handoff:done
  └── tool_approval_requested ← hitl:required

agent_updated_stream_event  ← Agent 切换通知
```

**痛点**：

- 没有明确的 `turn_start` / `turn_end`，需要用 `response_started` 推断
- 没有 `thinking_delta`（推理内容混在 text 里，用 `<think>` 标签包裹）
- 工具只有 `tool_called` + `tool_output`，没有执行进度
- 需要手动追踪 `turnIndex`、`turnOpen`、`textStartEmitted` 状态

### 1.2 pi-coding-agent（新方案）

四层事件，结构清晰，无需自行合成：

```
agent_start / agent_end                    ← 最外层生命周期
turn_start / turn_end                      ← 明确的轮次（不需要推断！）
message_start / message_update / message_end ← 消息流式
tool_execution_start / _update / _end       ← 工具（含进度！）
auto_compaction_start / _end               ← 压缩（内置！）
auto_retry_start / _end                    ← 重试（内置！）
```

**优势**：

- `turn_start` / `turn_end` **直接提供**，不需要从 `response_started` 推断
- `thinking_delta` **独立事件**，不需要解析 `<think>` 标签
- `tool_execution_update` 提供**执行进度**（OpenAI SDK 没有）
- 压缩和重试**内置事件**，不需要自己实现

---

## 二、当前痛点的真实案例

从测试日志（`test-results/20260210/agent-events-1770718045365.log`，6 个场景、共 136 个事件）可以看到：

### 2.1 `<think>` 标签混在文本中（最大痛点）

当前 OpenAI Agents SDK 中，**思考内容和实际文本混在同一个 `text:delta` 里**：

```
// 场景1 - 简单问答（10 个事件）
#5 text:delta → "<think>\n用户问"
#6 text:delta → "1+1等于几，要求用一个数字回答。\n</think>\n\n2"
```

前端需要**自己解析 `<think>...</think>` 标签**来分离思考和正文，而且标签可能跨多个 delta 片段！

```
// 场景2 - 工具调用（22 个事件）
#5 text:delta → "<think>\n用户要求"          ← <think> 开始
#6 text:delta → "计算 17 + 28...add_numbers"  ← 纯思考内容
#7 text:delta → "...\n</think>\n\n我来帮您"    ← </think> 和正文混在一起！
```

**`<think>` 跨 delta 的 3 种难处理模式**：

| 模式                    | 真实示例                      | 解析难度   |
| ----------------------- | ----------------------------- | ---------- |
| 开头即 `<think>`        | `"<think>\n用户问"`           | 较易       |
| `</think>` 和正文混合   | `"...\n</think>\n\n我来帮您"` | 困难       |
| 同一 delta 包含完整标签 | `"...\n</think>\n\n2"`        | 需要状态机 |

**pi-coding-agent 的解决方案**：`thinking_delta` 是独立事件类型，不会和 `text_delta` 混在一起。前端零解析负担。

### 2.2 Turn 边界靠推断（第二大痛点）

SDK 没有 `turn_start` / `turn_end` 事件，`consumeStreamEvents` 用 `response_started` 推断：

```
// 场景2 - 单工具调用：2 轮对话
Turn 1:
  response_started     → 推断 turn:start(1) + llm:start
  output_text_delta ×3 → text:delta
  response_done        → llm:done + text:done
  tool_called          → tool:start
  tool_output          → tool:done

Turn 2:（由下一个 response_started 触发关闭上一轮）
  response_started     → 推断 turn:done(1) + turn:start(2)
  output_text_delta ×3
  response_done

流结束               → 推断 turn:done(2)  ← 需要 turnOpen 标志手动关闭
```

对应 `consumeStreamEvents` 中的关键状态机逻辑（~200 行）：

```typescript
// 当前代码：手动推断 turn 边界
if (rawType === 'response_started') {
  if (turnOpen) {
    onChunk({ type: 'turn:done', content: '', data: { turnIndex } }) // ← 关闭上一轮
  }
  turnIndex++
  turnOpen = true
  textStartEmitted = false
  onChunk({ type: 'turn:start', content: '', data: { turnIndex } }) // ← 开新一轮
  onChunk({ type: 'llm:start', content: '' })
}

// 流结束后还需要手动关闭最后一轮
if (turnOpen) {
  onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
}
```

**pi-coding-agent**：直接给 `turn_start` + `turn_end`，完全不需要推断，不需要 `turnOpen` 状态变量。

### 2.3 工具执行无进度（第三大痛点）

从日志看，当前 SDK 中工具从 `tool:start` 到 `tool:done` 之间**没有任何事件**：

```
// 场景2 - tool:start 到 tool:done 之间是空白
#10 tool:start  "add_numbers"   elapsed: 15279ms
#11 tool:done   "{\"result\":45}" elapsed: 15280ms  ← 仅 1ms 间隔（因为是 mock）
```

实际 coding-agent 场景中，工具执行（如 bash、文件读写）可能需要数秒甚至更久，期间前端无法展示进度。

**pi-coding-agent**：`tool_execution_update` 事件在执行过程中持续推送进度。

### 2.4 真实场景事件时序图

从 6 个测试场景中提取的典型事件流模式：

#### 场景1：简单问答（10 个事件，1 轮）

```
run:start → turn:start(1) → llm:start → text:start
  → text:delta × 2 → llm:done → text:done
→ turn:done(1) → run:done
```

#### 场景2：单工具调用（22 个事件，2 轮）

```
run:start → turn:start(1) → llm:start → text:start
  → text:delta × 3（含 <think>...</think>）
  → llm:done → text:done
  → tool:start → tool:done
→ turn:done(1) → turn:start(2) → llm:start → text:start
  → text:delta × 3（含 <think>...</think>）
  → llm:done → text:done
→ turn:done(2) → run:done
```

#### 场景3：链式工具（24 个事件，2 轮截断 by maxTurns）

```
同场景2，但执行了 add_numbers 后因 maxTurns=2 截断，
未继续调用 multiply_numbers
```

#### 场景4：并行工具（27 个事件，2 轮）

```
Turn 1: llm → text × 3 → [tool:start × 2, tool:done × 2]（add + reverse 并行）
Turn 2: llm → text × 6 → 最终回答汇总
```

#### 场景5：三轮链式（23 个事件，2 轮截断 by maxTurns）

```
Turn 1: llm → text × 4 → [tool:start, tool:done]（add_numbers）
Turn 2: llm → text × 3 → 截断（应继续调 multiply_numbers）
```

#### 场景6：多种工具混合（30 个事件，2 轮）

```
Turn 1: llm → text × 4 → [tool:start × 3, tool:done × 3]（weather + time + add 并行）
Turn 2: llm → text × 6 → 最终回答汇总
```

---

## 三、事件映射表

### 3.1 完整映射

| pi-coding-agent 事件                | StreamChunk type         | 数据提取                                           |
| ----------------------------------- | ------------------------ | -------------------------------------------------- |
| `agent_start`                       | `run:start`              | —                                                  |
| `agent_end`                         | `run:done`               | `event.messages`                                   |
| `turn_start`                        | `turn:start`             | `turnIndex++`（自增）                              |
| `turn_end`                          | `turn:done`              | `event.message`, `event.toolResults`               |
| `message_start`                     | `llm:start`              | —                                                  |
| `message_update` (text_delta)       | `text:delta`             | `event.assistantMessageEvent.delta`                |
| `message_update` (thinking_delta)   | `reasoning:delta`        | `event.assistantMessageEvent.delta`                |
| `message_update` (input_json_delta) | —                        | 忽略（工具参数流，不需要前端展示）                 |
| `message_update` (stop)             | `text:done` + `llm:done` | 从 `event.message` 提取完整文本和 usage            |
| `message_end`                       | —                        | 忽略（信息已在 stop 中）                           |
| `tool_execution_start`              | `tool:start`             | `event.toolName`, `event.toolCallId`, `event.args` |
| `tool_execution_update`             | `tool:delta`             | `event.partialResult`（工具执行进度）              |
| `tool_execution_end`                | `tool:done`              | `event.toolName`, `event.result`, `event.isError`  |
| `auto_compaction_start`             | `compression:start`      | `event.reason`                                     |
| `auto_compaction_end`               | `compression:done`       | `event.result`                                     |
| `auto_retry_start`                  | —                        | 可选：转为日志                                     |
| `auto_retry_end`                    | —                        | 可选：转为日志                                     |

### 3.2 不需要映射的 StreamChunk 类型

| StreamChunk type                  | 说明                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `run:error`                       | 由 try/catch 生成，不变                                          |
| `run:interrupted` / `run:resumed` | pi-SDK 无 HITL 概念（工具由 SDK 自动执行）                       |
| `hitl:required/approved/rejected` | pi-SDK 通过 Extension 的 `tool_call` 拦截实现，无需 runtime 处理 |
| `handoff:start/done`              | pi-SDK 是单智能体，无 handoff（subagent 是独立进程）             |
| `text:start`                      | 首个 `text_delta` 时自动补发                                     |
| `reasoning:start/done`            | 首个/最后一个 `thinking_delta` 时补发                            |
| `tool:pending`                    | 合并到 `tool:delta`（pi-SDK 的 `tool_execution_update` 覆盖）    |

---

## 四、新版 consumeStreamEvents 伪代码

```typescript
/**
 * pi-coding-agent 事件消费
 *
 * 对比 OpenAI SDK 版本（~200 行 + 3 个状态变量 + response_started 推断），
 * 新版只需 ~80 行 + 2 个布尔标志，无需推断 turn 边界。
 */
private setupEventSubscription(
  session: AgentSession,
  onChunk: (chunk: StreamChunk) => void,
  onTextDelta: (text: string) => void
): () => void {
  let turnIndex = 0
  let textStartEmitted = false
  let reasoningStartEmitted = false

  return session.subscribe((event) => {
    switch (event.type) {
      // ===== Agent 生命周期 =====
      case 'agent_start':
        onChunk({ type: 'run:start', content: '' })
        break

      case 'agent_end':
        onChunk({ type: 'run:done', content: '' })
        break

      // ===== Turn（SDK 直接给！无需推断！）=====
      case 'turn_start':
        turnIndex++
        textStartEmitted = false
        reasoningStartEmitted = false
        onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
        break

      case 'turn_end':
        onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
        break

      // ===== Message（LLM 流式）=====
      case 'message_start':
        onChunk({ type: 'llm:start', content: '' })
        break

      case 'message_update': {
        const msgEvent = event.assistantMessageEvent
        switch (msgEvent.type) {
          case 'text_delta':
            // 纯文本！不会夹杂 <think> 标签
            if (!textStartEmitted) {
              textStartEmitted = true
              onChunk({ type: 'text:start', content: '' })
            }
            onTextDelta(msgEvent.delta)
            onChunk({
              type: 'text:delta',
              content: msgEvent.delta,
              data: { delta: msgEvent.delta }
            })
            break

          case 'thinking_delta':
            // 独立的思考流！无需解析 <think> 标签
            if (!reasoningStartEmitted) {
              reasoningStartEmitted = true
              onChunk({ type: 'reasoning:start', content: '' })
            }
            onChunk({
              type: 'reasoning:delta',
              content: msgEvent.delta,
              data: { delta: msgEvent.delta }
            })
            break

          case 'stop':
            if (textStartEmitted) {
              const fullText = extractFullText(event.message)
              onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
            }
            if (reasoningStartEmitted) {
              onChunk({ type: 'reasoning:done', content: '' })
            }
            const usage = event.message?.usage
            onChunk({
              type: 'llm:done',
              content: '',
              data: {
                usage: usage ? {
                  inputTokens: usage.input || 0,
                  outputTokens: usage.output || 0,
                  totalTokens: usage.totalTokens || 0
                } : undefined
              }
            })
            break
        }
        break
      }

      case 'message_end':
        // 忽略（信息已在 stop 中处理）
        break

      // ===== Tool（含执行进度！）=====
      case 'tool_execution_start':
        onChunk({
          type: 'tool:start',
          content: event.toolName,
          data: { toolName: event.toolName, callId: event.toolCallId }
        })
        break

      case 'tool_execution_update':
        // OpenAI SDK 完全没有对应事件！
        onChunk({
          type: 'tool:delta',
          content: JSON.stringify(event.partialResult),
          data: { delta: JSON.stringify(event.partialResult), callId: event.toolCallId }
        })
        break

      case 'tool_execution_end':
        onChunk({
          type: 'tool:done',
          content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          data: { toolName: event.toolName, callId: event.toolCallId, output: event.result }
        })
        break

      // ===== 压缩（SDK 内置！）=====
      case 'auto_compaction_start':
        onChunk({
          type: 'compression:start',
          content: `Compaction triggered: ${event.reason}`,
          data: { reason: event.reason, totalTokens: 0, threshold: 0 }
        })
        break

      case 'auto_compaction_end':
        onChunk({
          type: 'compression:done',
          content: event.aborted ? 'Compaction aborted' : 'Compaction done',
          data: {
            summarizedSeqs: [],
            endSeq: 0,
            originalTokens: 0,
            summaryTokens: 0,
            compressionRatio: 0,
            duration: 0
          }
        })
        break
    }
  })
}
```

---

## 五、场景对比：新旧方案事件流

### 5.1 场景2「单工具调用」当前 vs pi-coding-agent

**当前方案（22 个事件，需要推断 + 解析 `<think>`）**：

```
run:start
  turn:start(1)    ← 从 response_started 推断
    llm:start      ← 从 response_started 推断
      text:start   ← 首个 text:delta 时补发
      text:delta   "<think>\n用户要求"              ← 混合！
      text:delta   "计算 17 + 28...add_numbers..."  ← 混合！
      text:delta   "...\n</think>\n\n我来帮您..."   ← 混合！
    llm:done       ← 从 response_done 推断
    text:done      ← 含 <think>...</think> 全文
    tool:start     "add_numbers"
    tool:done      "{\"result\":45}"
  turn:done(1)     ← 由下一个 response_started 触发关闭
  turn:start(2)    ← 从第二个 response_started 推断
    llm:start
      text:start
      text:delta   "<think>\n好的，add_numbers..."  ← 又是混合！
      text:delta   "...\n</think>\n\n17 + 28 = 45"  ← 混合！
    llm:done
    text:done
  turn:done(2)     ← 流结束时手动关闭
run:done
```

**pi-coding-agent 方案（预计 ~18 个事件，直接 + 纯净）**：

```
run:start                                            ← agent_start
  turn:start(1)                                      ← turn_start（SDK 直接给！）
    llm:start                                        ← message_start
      reasoning:start                                ← 首个 thinking_delta 时补发
      reasoning:delta  "用户要求计算 17 + 28..."      ← 纯思考！
      reasoning:done
      text:start                                     ← 首个 text_delta 时补发
      text:delta  "我来帮您计算 17 + 28。"            ← 纯文本！无 <think>
      text:done
    llm:done                                         ← stop
    tool:start  "add_numbers"                        ← tool_execution_start
    tool:done   "{\"result\":45}"                    ← tool_execution_end
  turn:done(1)                                       ← turn_end（SDK 直接给！）
  turn:start(2)                                      ← turn_start
    llm:start
      reasoning:start
      reasoning:delta  "结果是 45..."
      reasoning:done
      text:start
      text:delta  "17 + 28 = 45"                     ← 纯文本！
      text:done
    llm:done
  turn:done(2)                                       ← turn_end
run:done                                             ← agent_end
```

**关键区别**：

- 思考和文本**完全分离**，前端零解析负担
- Turn 边界**无需推断**，无 `turnOpen` 状态变量
- 事件流**语义更清晰**，每个事件的含义直接明了

### 5.2 场景6「多种工具混合并行」当前 vs pi-coding-agent

**当前方案（30 个事件）**：

```
Turn 1: 3 个工具并行
  text:delta × 4（含 <think>...</think>）
  llm:done
  text:done   ← 含完整 <think> 标签
  tool:start  "get_weather"      ← 并行开始
  tool:start  "get_current_time"
  tool:start  "add_numbers"
  tool:done   "{\"city\":\"北京\"...}"     ← 并行完成
  tool:done   "{\"date\":\"2026/2/10\"...}"
  tool:done   "{\"result\":100...}"

Turn 2: 汇总回答
  text:delta × 6（含 <think>...</think>）
```

**pi-coding-agent 方案：完全相同的并行工具支持 + 纯净事件流**

- `tool_execution_start` × 3 → `tool_execution_update` × N → `tool_execution_end` × 3
- 比当前方案多了**执行进度**信息

---

## 六、关键简化对比

| 方面             | OpenAI Agents SDK（当前）                             | pi-coding-agent（新）                                                           |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Turn 检测**    | 用 `response_started` 推断，手动追踪 `turnOpen` 状态  | SDK 直接给 `turn_start/turn_end`                                                |
| **状态变量**     | `turnIndex` + `turnOpen` + `textStartEmitted`（3 个） | `turnIndex` + `textStartEmitted` + `reasoningStartEmitted`（3 个但无 turnOpen） |
| **思考流**       | `<think>` 标签混在 `text:delta` 中，需要流式解析器    | 独立 `thinking_delta` 事件，零解析                                              |
| **工具进度**     | 无（只有 start + done，中间空白）                     | `tool_execution_update` 提供实时进度                                            |
| **压缩**         | 自行实现 `SessionCompressor`（~300 行）+ 手动触发     | SDK 内置 `auto_compaction_start/end`                                            |
| **重试**         | 无                                                    | SDK 内置 `auto_retry_start/end`                                                 |
| **代码量**       | `consumeStreamEvents` ~200 行                         | `setupEventSubscription` ~80 行                                                 |
| **调试复杂度**   | 需要看 `raw_model_stream_event` 原始 JSON             | 事件语义清晰，直接 switch                                                       |
| **前端解析负担** | 需要实现 `<think>` 标签流式解析器（跨 delta 片段）    | 零额外解析                                                                      |

---

## 七、可以删除/简化的代码

切换到 pi-coding-agent 后，以下代码可以大幅简化或删除：

### 7.1 可完全删除的文件

| 文件                   | 原因                                      |
| ---------------------- | ----------------------------------------- |
| `SessionCompressor.ts` | SDK 内置 `auto_compaction`                |
| `tokenCounter.ts`      | SDK 内置 token 管理                       |
| `FileSession.ts`       | SDK 有 `SessionManager`（内存/文件/续接） |

### 7.2 可简化的类型定义

| `types.ts` 中的定义                                                | 操作     | 原因                                       |
| ------------------------------------------------------------------ | -------- | ------------------------------------------ |
| `SessionItem`, `SummaryMeta`, `SessionCompressionOptions`          | **删除** | Session 格式由 SDK 管理                    |
| `CompressionResult`, `CompressionStartData`, `CompressionDoneData` | **简化** | 直接透传 SDK 的 `auto_compaction` 事件数据 |
| `ContextSnapshot`                                                  | **删除** | SDK 有自己的 session 查询 API              |
| `tool:pending` 类型                                                | **删除** | 合并到 `tool:delta`                        |
| `hitl:*` 3 个类型                                                  | **删除** | Extension 的 `tool_call` 事件拦截替代      |
| `handoff:*` 2 个类型                                               | **删除** | 单智能体无 handoff                         |
| `run:interrupted` / `run:resumed`                                  | **删除** | 无 HITL                                    |
| `HitlRequiredData`, `HandoffData`                                  | **删除** | 对应类型删除                               |

### 7.3 AgentRuntime 简化

| 模块                           | 操作             | 原因                                                                       |
| ------------------------------ | ---------------- | -------------------------------------------------------------------------- |
| `consumeStreamEvents` (~200行) | **重写为 ~80行** | 事件由 SDK 直接提供                                                        |
| HITL 相关逻辑（~80 行）        | **删除**         | `pendingState`, `pendingInterruptions`, approve/reject/resume/resumeStream |
| `compressSessionIfNeeded`      | **删除**         | SDK 内置压缩                                                               |
| `compressSession`              | **删除**         | SDK 内置压缩                                                               |
| `extractToolCalls`             | **简化**         | 从 SDK 的 `agent_end.messages` 提取                                        |
| `getContextSnapshot`           | **删除**         | SDK 有自己的 session API                                                   |

### 7.4 StreamEmitter 简化

| 方法                                                        | 操作     | 原因               |
| ----------------------------------------------------------- | -------- | ------------------ |
| `emitHandoff`                                               | **删除** | 单智能体无 handoff |
| `emitToolApproval`                                          | **删除** | 无 HITL            |
| `emitAgentUpdated`                                          | **删除** | 单智能体           |
| `StreamMessageType` 中的 `handoff`, `hitl`, `agent_updated` | **删除** | 对应方法删除       |

---

## 八、StreamChunkType 精简方案

切换后建议精简为：

```typescript
export type StreamChunkType =
  // ① run: 执行生命周期
  | 'run:start'
  | 'run:done'
  | 'run:error'
  // ② turn: 对话轮次（SDK 直接提供！）
  | 'turn:start'
  | 'turn:done'
  // ③ llm: 模型调用
  | 'llm:start'
  | 'llm:done'
  // ④ text: 文本输出（纯文本！不含 <think>）
  | 'text:start'
  | 'text:delta'
  | 'text:done'
  // ⑤ reasoning: 推理/思考（SDK 独立事件！）
  | 'reasoning:start'
  | 'reasoning:delta'
  | 'reasoning:done'
  // ⑥ tool: 工具调用（含执行进度！）
  | 'tool:start'
  | 'tool:delta' // ← 现在有实际内容了（tool_execution_update 进度）
  | 'tool:done'
  // ⑦ compression: 压缩（SDK 内置！）
  | 'compression:start'
  | 'compression:done'
```

**删除的类型（8 个 → 0 个）**：

- `run:interrupted` / `run:resumed` — 无 HITL
- `hitl:required` / `hitl:approved` / `hitl:rejected` — Extension 处理
- `handoff:start` / `handoff:done` — 单智能体
- `tool:pending` — 合并到 `tool:delta`

**最终**：24 种 → 16 种（减少 33%），且每种事件含义更清晰、数据更丰富。

---

## 九、总结

| 维度                     | 当前方案                   | 新方案                                               | 改善         |
| ------------------------ | -------------------------- | ---------------------------------------------------- | ------------ |
| StreamChunkType 数量     | 24 种                      | 16 种                                                | -33%         |
| consumeStreamEvents 代码 | ~200 行                    | ~80 行                                               | -60%         |
| 状态变量                 | 3 个（含 `turnOpen` 推断） | 3 个（无推断）                                       | 无需推断     |
| 可删除文件               | 0                          | 3 个（SessionCompressor, tokenCounter, FileSession） | 减少维护     |
| 前端 `<think>` 解析      | 需要流式标签解析器         | 零解析                                               | 大幅简化前端 |
| 工具执行进度             | 无                         | 有（tool_execution_update）                          | 更好的 UX    |
| 压缩                     | 自行实现 ~300 行           | SDK 内置                                             | 减少维护     |
| 重试                     | 无                         | SDK 内置                                             | 更健壮       |
