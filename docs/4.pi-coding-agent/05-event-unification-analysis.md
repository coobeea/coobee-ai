# OpenAI vs PiMono 事件流统一化分析

> **目标**: 分析两套运行时 StreamChunk 输出的差异，确保事件名称、时序、内容格式完全一致
> **基准**: OpenAIAgentRuntime 的输出作为标准（已在线上运行）
> **参考数据**:
>
> - OpenAI: `test-results/20260211/agent-events-1770784736183.log` (场景2, line 168-442)
> - PiMono: `test-results/20260211/pi-agent-events-1770777349855.log` (场景2, line 189-457)

---

## 1. 事件时序对比（场景2: 单工具调用 add_numbers(17,28)）

### OpenAI (26 个事件)

```
#1  run:start
#2  turn:start        { turnIndex: 1 }
#3  llm:start
#4  reasoning:start
#5  reasoning:delta    "\n用户要求"
#6  reasoning:delta    "计算 17 + 28。我需要使用 add_numbers 工具来完成这个加法运算。\n"
#7  reasoning:done     { rawContent: "..." }
#8  text:start
#9  text:delta         "\n\n\n"
#10 text:done          { text: "" }
#11 llm:done           { responseId, usage: { inputTokens: 249, outputTokens: 58, totalTokens: 307 } }
#12 tool:start         { toolName: "add_numbers", callId: "..." }        ← ❶ tool:start 在 llm:done 之后
#13 tool:done          { toolName, callId, output: "{...}" }
#14 turn:done          { turnIndex: 1 }
#15 turn:start         { turnIndex: 2 }
#16 llm:start
#17 reasoning:start
#18 reasoning:delta    "\n工具返回"
#19 reasoning:delta    "了结果：17 + 28 = 45。\n"
#20 reasoning:done     { rawContent: "..." }
#21 text:start
#22 text:delta         "\n\n17 + 28 = 45"
#23 text:done          { text: "17 + 28 = 45" }
#24 llm:done           { responseId, usage: { inputTokens: 343, outputTokens: 24, totalTokens: 367 } }
#25 turn:done          { turnIndex: 2 }
#26 run:done
```

### PiMono (24 个事件)

```
#1  run:start
#2  turn:start         { turnIndex: 1 }
#3  llm:start
#4  reasoning:start
#5  reasoning:delta    "\n用户要求"
#6  reasoning:delta    "计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n"
#7  reasoning:done     { rawContent: "..." }
#8  llm:done           { usage: { inputTokens: 271, outputTokens: 92, totalTokens: 363 } }     ← ❶ llm:done 在 tool:start 之前
#9  tool:start         { toolName: "add_numbers", callId: "..." }
#10 tool:delta         { delta: "...", callId: "..." }                    ← ❷ 独有事件
#11 tool:done          { toolName, callId, output: {...}, isError }       ← ❸ output 格式不同
#12 turn:done          { turnIndex: 1 }
#13 turn:start         { turnIndex: 2 }
#14 llm:start
#15 reasoning:start
#16 reasoning:delta    "\n工具返回"
#17 reasoning:delta    "了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n"
#18 reasoning:done     { rawContent: "..." }
#19 text:start
#20 text:delta         "17 + 28 = **45**"
#21 text:done          { text: "17 + 28 = **45**" }
#22 llm:done           { usage: { inputTokens: 365, outputTokens: 61, totalTokens: 426 } }
#23 turn:done          { turnIndex: 2 }
#24 run:done
```

---

## 2. 差异汇总

| #   | 差异点                                     | OpenAI 行为                                                                                               | PiMono 行为                                                                                                                               | 影响级别            |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| D1  | **工具调用轮次缺少 text:start/delta/done** | 即使文本为空，也会输出 `text:start` → `text:delta("\n\n\n")` → `text:done({ text: "" })`                  | 工具调用轮次不输出任何 text 事件                                                                                                          | **高**              |
| D2  | **llm:done 与 tool:start 的时序**          | `text:done` → `llm:done` → `tool:start` → `tool:done`                                                     | `reasoning:done` → `llm:done` → `tool:start` → `tool:done`                                                                                | **低** (时序一致)   |
| D3  | **tool:delta 事件**                        | 无此事件（OpenAI SDK 不提供执行进度）                                                                     | 有 `tool:delta`（pi-SDK 提供 `tool_execution_update`）                                                                                    | **低** (多出不影响) |
| D4  | **tool:done content/output 格式**          | `content: "{\"result\":45,...}"` (纯 JSON 字符串) / `data.output: "{\"result\":45,...}"` (纯 JSON 字符串) | `content: "{\"content\":[{\"type\":\"text\",...}],...}"` (嵌套结构 JSON) / `data.output: { content: [...], details: {...} }` (结构化对象) | **高**              |
| D5  | **llm:done data 结构**                     | `{ responseId: "FAKE_ID", usage: {...} }`                                                                 | `{ usage: {...} }` (无 responseId)                                                                                                        | **中**              |
| D6  | **事件总数差异**                           | 26 个 (工具调用轮多了 text:start/delta/done)                                                              | 24 个                                                                                                                                     | 由 D1 导致          |

---

## 3. 逐项差异详细分析

### D1: 工具调用轮次缺少 text:start/delta/done (高)

**OpenAI 行为** (场景2, #8-#10):

当 LLM 决定调用工具时，`<think>` 之后会有换行/空行再触发 tool_call。OpenAI SDK 的 `output_text_delta` 会把 `</think>` 之后的 `\n\n\n` 发出来，OpenAIAgentRuntime 解析后产生：

```json
{ "type": "text:start", "content": "" }
{ "type": "text:delta", "content": "\n\n\n", "data": { "delta": "\n\n\n" } }
{ "type": "text:done", "content": "", "data": { "text": "" } }
```

**PiMono 行为**:

pi-SDK 的 `text_delta` 也包含了 `</think>\n\n\n`，PiMono 的 `processTextDelta` 解析到 `</think>` 后发出 `reasoning:done`，剩余的 `\n\n\n` 被 `emitCleanText` 处理。但由于只有空白符，`emitCleanText` 的 `if (!text || text.length === 0)` 判断后可能跳过了，或者 text 实际上就是空白换行，不会触发 `text:start`。

**改进方案**:

PiMono 需要在工具调用轮次也输出 `text:start` → `text:delta` → `text:done` 事件。即使内容为空/仅空行，也要保持和 OpenAI 一致的行为。具体改动在 `processTextDelta` 的 `emitCleanText` 中：当检测到 `</think>` 后有剩余文本（包括空白）时，仍然发出 `text:start/delta/done`。

### D2: llm:done 与 tool:start 的时序 (低)

**两者时序实际上一致**: `llm:done` → `tool:start` → `tool:done`

OpenAI 多了 `text:start/delta/done` 夹在中间:

```
reasoning:done → text:start → text:delta → text:done → llm:done → tool:start
```

PiMono:

```
reasoning:done → llm:done → tool:start
```

D1 修复后，两者时序将完全一致。无需额外改动。

### D3: tool:delta 事件 (低)

**OpenAI**: 不产生 `tool:delta`。`@openai/agents` SDK 在 `tool_called` 事件后直接执行工具，执行完后 `tool_output` 回报结果。

**PiMono**: pi-SDK 有 `tool_execution_update` 事件（执行进度），PiMono 将其映射为 `tool:delta`。

**改进方案**: 无需改动。`tool:delta` 在 `StreamChunkType` 中已定义为合法事件。OpenAI 只是不产生，PiMono 多出不影响前端（前端通过 type 过滤）。前端若不关注可忽略。

### D4: tool:done content/output 格式 (高)

**OpenAI**:

@agent-events-1770784736183.log (line 294-305)

```json
{
  "type": "tool:done",
  "content": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}",
  "data": {
    "toolName": "add_numbers",
    "callId": "call_function_oqnkc4it1zgv_1",
    "output": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}"
  }
}
```

- `content`: 工具直接返回的 JSON 字符串
- `data.output`: 同上，纯 JSON 字符串

**PiMono**:

@pi-agent-events-1770777349855.log (line 299-321)

```json
{
  "type": "tool:done",
  "content": "{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"result\\\":45,...}\"}],\"details\":{\"name\":\"add_numbers\"}}",
  "data": {
    "toolName": "add_numbers",
    "callId": "call_function_65d3w27b080d_1",
    "output": {
      "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
      "details": { "name": "add_numbers" }
    },
    "isError": false
  }
}
```

- `content`: 序列化了 pi-SDK 的 `AgentToolResult` 结构（含 `content[]` 和 `details`）
- `data.output`: 结构化的 `AgentToolResult` 对象

**改进方案**:

PiMono 的 `tool_execution_end` 处理需要解包 pi-SDK 的 `AgentToolResult`：

1. 从 `result.content[0].text` 提取实际工具输出字符串
2. `content` 字段赋值为这个纯文本
3. `data.output` 也赋值为这个纯文本
4. `data.isError` 可保留（OpenAI 没有此字段，但不影响）

```typescript
// 改动前
const result = evt.result
onChunk({
  type: 'tool:done',
  content: typeof result === 'string' ? result : JSON.stringify(result),
  data: { toolName, callId, output: result, isError }
})

// 改动后
const rawResult = evt.result
const output = this.extractToolOutput(rawResult) // 新增: 从 AgentToolResult 提取纯文本
onChunk({
  type: 'tool:done',
  content: output,
  data: { toolName, callId, output, isError }
})
```

### D5: llm:done data 缺少 responseId (中)

**OpenAI**:

```json
{
  "type": "llm:done",
  "data": {
    "responseId": "FAKE_ID",
    "usage": { "inputTokens": 249, "outputTokens": 58, "totalTokens": 307 }
  }
}
```

**PiMono**:

```json
{
  "type": "llm:done",
  "data": {
    "usage": { "inputTokens": 271, "outputTokens": 92, "totalTokens": 363 }
  }
}
```

**改进方案**:

pi-SDK 的 `message_end` 事件中没有提供独立的 responseId。可以：

- 方案 A: 不添加，字段为可选的（`LlmDoneData.responseId?`），前端应兼容
- 方案 B: 用 message timestamp 或自生成 ID 填充

建议选 **方案 A**，无需改动。`responseId` 在 `LlmDoneData` 中定义为 `responseId?: string`，本身就是可选的。

---

## 4. SDK 原始事件对照表

以下展示两个 SDK 同一场景下产生的原始事件，以及如何映射到统一 StreamChunk。

| 阶段         | OpenAI SDK 原始事件                                                | pi-coding-agent SDK 原始事件                        | 统一 StreamChunk                         |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------- |
| 执行开始     | (无，由 Runtime 自行发出)                                          | `agent_start`                                       | `run:start`                              |
| 轮次开始     | `agent_updated_stream_event` (首次)                                | `turn_start`                                        | `turn:start { turnIndex }`               |
| LLM 请求开始 | `raw_model_stream_event (response_started)`                        | `message_start (role=assistant)`                    | `llm:start`                              |
| 思考开始     | `raw_model_stream_event (output_text_delta)` 中检测 `<think>`      | `message_update (text_delta)` 中检测 `<think>`      | `reasoning:start`                        |
| 思考增量     | `raw_model_stream_event (output_text_delta)` 中 `<think>` 内容     | `message_update (text_delta)` 中 `<think>` 内容     | `reasoning:delta { delta }`              |
| 思考结束     | `raw_model_stream_event (output_text_delta)` 中检测 `</think>`     | `message_update (text_delta)` 中检测 `</think>`     | `reasoning:done { rawContent }`          |
| 文本开始     | `raw_model_stream_event (output_text_delta)` `</think>` 之后的文本 | `message_update (text_delta)` `</think>` 之后的文本 | `text:start`                             |
| 文本增量     | `raw_model_stream_event (output_text_delta)`                       | `message_update (text_delta)`                       | `text:delta { delta }`                   |
| 文本结束     | `raw_model_stream_event (response_done)`                           | `message_update (text_end)`                         | `text:done { text }`                     |
| LLM 请求结束 | `raw_model_stream_event (response_done)`                           | `message_end (role=assistant)`                      | `llm:done { responseId?, usage }`        |
| 工具调用开始 | `run_item_stream_event (tool_called)`                              | `tool_execution_start`                              | `tool:start { toolName, callId }`        |
| 工具执行进度 | (无)                                                               | `tool_execution_update`                             | `tool:delta { delta, callId }`           |
| 工具调用结束 | `run_item_stream_event (tool_output)`                              | `tool_execution_end`                                | `tool:done { toolName, callId, output }` |
| 轮次结束     | `agent_updated_stream_event` (轮次边界)                            | `turn_end`                                          | `turn:done { turnIndex }`                |
| 执行结束     | (无，由 Runtime 自行发出)                                          | `agent_end`                                         | `run:done`                               |

---

## 5. 改动优先级

| 优先级 | 改动项                                   | 涉及文件                | 预估改动量                                                             |
| ------ | ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| **P0** | D4: tool:done output 格式统一            | `PiMonoAgentRuntime.ts` | 小 (新增 `extractToolOutput` 方法，约 10 行)                           |
| **P1** | D1: 工具调用轮补充 text:start/delta/done | `PiMonoAgentRuntime.ts` | 中 (修改 `text_end` / `stop` 处理逻辑，确保即使仅空白也发出 text 事件) |
| **P2** | D5: llm:done 添加 responseId             | 无需改动                | 无 (字段可选，前端应兼容)                                              |
| **P2** | D3: tool:delta 多出                      | 无需改动                | 无 (合法事件，前端可忽略)                                              |

---

## 6. 改动后预期事件流

修复 D1 和 D4 后，PiMono 场景2 预期输出 **26 个事件**，与 OpenAI 完全一致：

```
#1  run:start
#2  turn:start         { turnIndex: 1 }
#3  llm:start
#4  reasoning:start
#5  reasoning:delta    "\n用户要求..."
#6  reasoning:delta    "..."
#7  reasoning:done     { rawContent: "..." }
#8  text:start                                          ← 新增
#9  text:delta         "\n\n\n"                         ← 新增 (或其他空白)
#10 text:done          { text: "" }                     ← 新增
#11 llm:done           { usage: {...} }
#12 tool:start         { toolName: "add_numbers", callId: "..." }
    [tool:delta]       (可选，PiMono 独有，不影响)
#13 tool:done          { toolName, callId, output: "{\"result\":45,...}" }    ← output 格式已统一
#14 turn:done          { turnIndex: 1 }
#15 turn:start         { turnIndex: 2 }
#16 llm:start
#17 reasoning:start
#18 reasoning:delta    "\n工具返回..."
#19 reasoning:delta    "..."
#20 reasoning:done     { rawContent: "..." }
#21 text:start
#22 text:delta         "17 + 28 = **45**"
#23 text:done          { text: "17 + 28 = **45**" }
#24 llm:done           { usage: {...} }
#25 turn:done          { turnIndex: 2 }
#26 run:done
```

---

## 7. 测试验证方案

修改完成后，需要运行以下测试确保两套输出一致：

1. **PiMono 单元测试** (`PiMonoAgentRuntime.test.ts`) — 验证事件时序和内容格式
2. **PiMono 集成测试** (`PiMonoAgentRuntime.integration.test.ts`) — 验证会话管理场景
3. **手动对比** — 运行两套测试，逐项比对事件日志中的 StreamChunk，确认：
   - 事件名称完全一致
   - 事件顺序完全一致（tool:delta 除外）
   - `content` 和 `data` 字段格式完全一致
