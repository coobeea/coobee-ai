# 15 - 流式消息格式详解

> 来源：OpenAI SDK `openai/resources/responses/responses.d.ts`（53 种原始事件），
> Agents SDK `packages/agents-core/src/events.ts`, `packages/agents-core/src/types/protocol.ts`, `packages/agents-core/src/items.ts`

---

## 概述

OpenAI Agents JS SDK 的流式消息格式采用**三层事件模型**：

```
Layer 3  应用层     RunStreamEvent              ← 你的代码消费这一层
           ↑ 包装
Layer 2  协议层     StreamEvent（4 种）           ← 模型无关的抽象
           ↑ 转换/透传
Layer 1  原始层     Responses API 事件（53 种）   ← OpenAI 底层 SSE
```

- 日常封装只需关注 **Layer 3**
- 需要细粒度控制（函数参数增量、思维链等）时深入 **Layer 1**

> **注意**：使用 `chat_completions` API（如 MiniMax）时，Layer 1 是 Chat Completion Chunk 格式，Layer 2/3 结构不变。

---

## Layer 1: 原始事件（53 种）

OpenAI Responses API 返回的 Server-Sent Events，通过 `raw_model_stream_event` 中 `data.type === 'model'` 的 `data.event` 获取。

### 1.1 响应生命周期（7 个）

典型时序：`queued → created → in_progress → completed / failed / incomplete`

| 事件 `type`            | 说明                                      |
| ---------------------- | ----------------------------------------- |
| `response.queued`      | 请求已入队                                |
| `response.created`     | 响应对象已创建，含完整 `response`         |
| `response.in_progress` | 模型开始生成                              |
| `response.completed`   | 正常完成，含 `usage` + `output`           |
| `response.failed`      | 失败，含 `error`                          |
| `response.incomplete`  | 被截断（token 上限等）                    |
| `error`                | 错误事件，含 `code` / `message` / `param` |

### 1.2 输出项管理（2 个）

| 事件 `type`                  | 说明                                    |
| ---------------------------- | --------------------------------------- |
| `response.output_item.added` | 新输出项开始，通过 `item.type` 区分类型 |
| `response.output_item.done`  | 输出项生成完毕                          |

> 函数调用、文本、推理等都没有单独 "started" 事件，统一通过 `output_item.added` 的 `item.type` 区分。

### 1.3 内容部分（2 个）

| 事件 `type`                   | 说明                 |
| ----------------------------- | -------------------- |
| `response.content_part.added` | 输出项内的子内容开始 |
| `response.content_part.done`  | 子内容完成           |

### 1.4 文本输出（3 个）

| 事件 `type`                             | 关键字段        | 说明                     |
| --------------------------------------- | --------------- | ------------------------ |
| `response.output_text.delta`            | `delta: string` | 文本增量（每个 token）   |
| `response.output_text.done`             | `text: string`  | 文本输出完毕（完整文本） |
| `response.output_text.annotation.added` | `annotation`    | 文本注释（引用来源等）   |

### 1.5 推理 / 思维链（6 个）

**原始推理文本**（模型完整思维过程，部分模型不返回或加密）：

| 事件 `type`                     | 关键字段        |
| ------------------------------- | --------------- |
| `response.reasoning_text.delta` | `delta: string` |
| `response.reasoning_text.done`  | `text: string`  |

**推理摘要**（面向用户的可读摘要）：

| 事件 `type`                             | 关键字段                |
| --------------------------------------- | ----------------------- |
| `response.reasoning_summary_part.added` | `part`, `summary_index` |
| `response.reasoning_summary_part.done`  | `part`, `summary_index` |
| `response.reasoning_summary_text.delta` | `delta: string`         |
| `response.reasoning_summary_text.done`  | `text: string`          |

### 1.6 函数调用（2 个）

| 事件 `type`                              | 关键字段                         |
| ---------------------------------------- | -------------------------------- |
| `response.function_call_arguments.delta` | `delta: string`, `call_id`       |
| `response.function_call_arguments.done`  | `arguments: string`（完整 JSON） |

完整事件流：

```
output_item.added (type=function_call)
  → function_call_arguments.delta × N
  → function_call_arguments.done
  → output_item.done
```

### 1.7 拒绝回复（2 个）

| 事件 `type`              | 关键字段          |
| ------------------------ | ----------------- |
| `response.refusal.delta` | `delta: string`   |
| `response.refusal.done`  | `refusal: string` |

### 1.8 音频（4 个）

| 事件 `type`                       | 关键字段                  |
| --------------------------------- | ------------------------- |
| `response.audio.delta`            | `delta: string`（base64） |
| `response.audio.done`             | —                         |
| `response.audio.transcript.delta` | `delta: string`           |
| `response.audio.transcript.done`  | `transcript: string`      |

### 1.9 Code Interpreter（5 个）

事件流：`in_progress → interpreting → code.delta × N → code.done → completed`

| 事件 `type`                                   | 说明         |
| --------------------------------------------- | ------------ |
| `response.code_interpreter_call.in_progress`  | 开始         |
| `response.code_interpreter_call.interpreting` | 执行中       |
| `response.code_interpreter_call_code.delta`   | 代码文本增量 |
| `response.code_interpreter_call_code.done`    | 代码文本完成 |
| `response.code_interpreter_call.completed`    | 完成         |

### 1.10 File Search（3 个）

事件流：`in_progress → searching → completed`

| 事件 `type`                             |
| --------------------------------------- |
| `response.file_search_call.in_progress` |
| `response.file_search_call.searching`   |
| `response.file_search_call.completed`   |

### 1.11 Web Search（3 个）

事件流：`in_progress → searching → completed`

| 事件 `type`                            |
| -------------------------------------- |
| `response.web_search_call.in_progress` |
| `response.web_search_call.searching`   |
| `response.web_search_call.completed`   |

### 1.12 Image Generation（4 个）

事件流：`in_progress → generating → partial_image × N → completed`

| 事件 `type`                                    | 关键字段                          |
| ---------------------------------------------- | --------------------------------- |
| `response.image_generation_call.in_progress`   | —                                 |
| `response.image_generation_call.generating`    | —                                 |
| `response.image_generation_call.partial_image` | `partial_image: string`（base64） |
| `response.image_generation_call.completed`     | —                                 |

### 1.13 MCP 工具（8 个）

事件流：`call.in_progress → arguments.delta/done → completed/failed`

| 事件 `type`                           | 说明           |
| ------------------------------------- | -------------- |
| `response.mcp_call.in_progress`       | MCP 调用开始   |
| `response.mcp_call_arguments.delta`   | 参数增量       |
| `response.mcp_call_arguments.done`    | 参数完成       |
| `response.mcp_call.completed`         | 调用完成       |
| `response.mcp_call.failed`            | 调用失败       |
| `response.mcp_list_tools.in_progress` | 工具列表请求中 |
| `response.mcp_list_tools.completed`   | 工具列表完成   |
| `response.mcp_list_tools.failed`      | 工具列表失败   |

### 1.14 自定义工具（2 个）

| 事件 `type`                             | 关键字段        |
| --------------------------------------- | --------------- |
| `response.custom_tool_call_input.delta` | `delta: string` |
| `response.custom_tool_call_input.done`  | `input: string` |

### Layer 1 分类速查

```
响应生命周期  (7)  queued → created → in_progress → completed/failed/incomplete + error
输出项管理    (2)  output_item.added / done
内容部分      (2)  content_part.added / done
文本输出      (3)  output_text.delta / done + annotation.added
推理思维链    (6)  reasoning_text.delta/done + reasoning_summary_*.delta/done
函数调用      (2)  function_call_arguments.delta / done
拒绝回复      (2)  refusal.delta / done
音频          (4)  audio.delta/done + audio.transcript.delta/done
Code Interp.  (5)  in_progress → interpreting → code.delta/done → completed
File Search   (3)  in_progress → searching → completed
Web Search    (3)  in_progress → searching → completed
Image Gen.    (4)  in_progress → generating → partial_image → completed
MCP           (8)  call + list_tools 的 in_progress/completed/failed
自定义工具    (2)  input.delta / done
──────────────────
合计 53 种
```

---

## Layer 2: SDK 协议事件（StreamEvent）

SDK 将 Layer 1 转换为 **4 种**统一协议事件，屏蔽不同模型提供者的差异。

### 四种类型

**`response_started`** — 响应开始

```typescript
{ type: 'response_started', providerData?: Record<string, any> }
```

**`output_text_delta`** — 文本增量（最常用，实现打字机效果）

```typescript
{ type: 'output_text_delta', delta: string, providerData?: Record<string, any> }
```

**`response_done`** — 响应完成

```typescript
{
  type: 'response_done',
  response: { id: string, output: OutputModelItem[], usage: UsageData },
  providerData?: Record<string, any>
}
```

其中 `UsageData`：

```typescript
interface UsageData {
  requests?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails?: Record<string, number> | Array<Record<string, number>>;
  outputTokensDetails?: Record<string, number> | Array<Record<string, number>>;
}
```

**`model`** — Layer 1 原始事件透传

```typescript
{ type: 'model', event: any /* Layer 1 的 53 种之一 */ }
```

### 转换规则

```
Layer 1                           →  Layer 2
───────────────────────────────      ──────────────────────
response.created                 →   response_started  +  model
response.output_text.delta       →   output_text_delta +  model
response.completed               →   response_done     +  model
其余 50 种事件                    →   model（仅透传）
```

> 只需文本增量用 `output_text_delta`；需要函数参数增量、推理文本等细粒度事件，从 `model.event` 提取。

---

## Layer 3: 运行事件（RunStreamEvent）

应用层最终消费的事件，通过 `for await (const event of result)` 获取。

三种类型：

### `raw_model_stream_event`

包装 Layer 2 协议事件：

```typescript
{ type: 'raw_model_stream_event', data: StreamEvent }
```

`data` 的四种可能值：

| `data.type`         | 含义     | 关键字段                             |
| ------------------- | -------- | ------------------------------------ |
| `response_started`  | 响应开始 | `providerData`                       |
| `output_text_delta` | 文本增量 | `delta: string`                      |
| `response_done`     | 响应完成 | `response.id` / `.output` / `.usage` |
| `model`             | 原始透传 | `event`（Layer 1 的 53 种之一）      |

### `run_item_stream_event`

Agent 处理模型响应后产生的高级事件：

```typescript
{ type: 'run_item_stream_event', name: string, item: RunItem }
```

7 种 `name` 值：

| `name`                    | RunItem 类型            | 触发时机         |
| ------------------------- | ----------------------- | ---------------- |
| `message_output_created`  | `RunMessageOutputItem`  | 文本消息完成     |
| `tool_called`             | `RunToolCallItem`       | 模型输出函数调用 |
| `tool_output`             | `RunToolCallOutputItem` | 工具执行完毕     |
| `handoff_requested`       | `RunHandoffCallItem`    | 请求切换 Agent   |
| `handoff_occurred`        | `RunHandoffOutputItem`  | Handoff 完成     |
| `reasoning_item_created`  | `RunReasoningItem`      | 推理/思维链完成  |
| `tool_approval_requested` | `RunToolApprovalItem`   | 工具需人工审批   |

### `agent_updated_stream_event`

Agent 发生切换（Handoff 后）：

```typescript
{ type: 'agent_updated_stream_event', agent: Agent }
```

---

## RunItem 类型详解

`run_item_stream_event` 中 `item` 的 7 种具体类型。

### RunMessageOutputItem

```typescript
class RunMessageOutputItem {
  readonly type = 'message_output_item';
  rawItem: AssistantMessageItem;
  agent: Agent;
  get content(): string; // 便捷属性：纯文本
}
```

`AssistantContent` 联合类型：

```typescript
| { type: 'output_text', text: string }     // 文本
| { type: 'refusal', refusal: string }      // 拒绝
| { type: 'audio', audio: string, ... }     // 音频
| { type: 'image', image: string }          // 图片
```

### RunToolCallItem

```typescript
class RunToolCallItem {
  readonly type = 'tool_call_item';
  rawItem: ToolCallItem; // 5 种工具调用之一
  agent: Agent;
}
```

`ToolCallItem` 联合类型（5 种）：

```typescript
// 自定义函数调用（最常用）
interface FunctionCallItem {
  type: 'function_call';
  callId: string;
  name: string;
  arguments: string; // JSON 字符串
}

// 托管工具（web_search、file_search 等）
interface HostedToolCallItem {
  type: 'hosted_tool_call';
  name: string;
  arguments?: string;
  output?: string;
}

// 计算机操作
interface ComputerUseCallItem {
  type: 'computer_call';
  callId: string;
  action: ComputerAction; // click, type, screenshot, scroll, ...
}

// Shell 命令
interface ShellCallItem {
  type: 'shell_call';
  callId: string;
  action: { commands: string[]; timeoutMs?: number };
}

// 补丁应用
interface ApplyPatchCallItem {
  type: 'apply_patch_call';
  callId: string;
  operation: { type: 'create_file' | 'update_file' | 'delete_file'; path: string; diff?: string };
}
```

### RunToolCallOutputItem

```typescript
class RunToolCallOutputItem {
  readonly type = 'tool_call_output_item'
  rawItem: FunctionCallResultItem | ComputerCallResultItem | ...
  agent: Agent
  output: string | unknown
}
```

`FunctionCallResultItem`（最常用）：

```typescript
interface FunctionCallResultItem {
  type: 'function_call_result';
  name: string;
  callId: string;
  output: string | ToolCallOutputContent | Array<ToolCallStructuredOutput>;
}
```

### RunReasoningItem

```typescript
class RunReasoningItem {
  readonly type = 'reasoning_item';
  rawItem: {
    type: 'reasoning';
    content: Array<{ type: 'input_text'; text: string }>; // 用户可见摘要
    rawContent?: Array<{ type: 'reasoning_text'; text: string }>; // 原始推理文本
  };
  agent: Agent;
}
```

### RunHandoffCallItem / RunHandoffOutputItem

```typescript
class RunHandoffCallItem {
  readonly type = 'handoff_call_item';
  rawItem: FunctionCallItem; // Handoff 本质是函数调用
  agent: Agent; // 发起 Handoff 的 Agent
}

class RunHandoffOutputItem {
  readonly type = 'handoff_output_item';
  rawItem: FunctionCallResultItem;
  sourceAgent: Agent;
  targetAgent: Agent;
}
```

### RunToolApprovalItem

```typescript
class RunToolApprovalItem {
  readonly type = 'tool_approval_item'
  rawItem: FunctionCallItem | HostedToolCallItem | ComputerUseCallItem | ...
  agent: Agent
  get name(): string | undefined
  get arguments(): string | undefined
}
```

---

## 完整事件时序图

### 场景 A：纯文本回复

```
Layer 1 原始事件                     Layer 3 SDK 事件
────────────────                     ───────────────
response.created                 →   raw { response_started }
response.in_progress             →   raw { model }
output_item.added (message)      →   raw { model }
content_part.added               →   raw { model }
output_text.delta "你"           →   raw { output_text_delta, delta: '你' }
output_text.delta "好"           →   raw { output_text_delta, delta: '好' }
output_text.done                 →   raw { model }
content_part.done                →   raw { model }
output_item.done                 →   raw { model }
response.completed               →   raw { response_done }
                                     run_item { message_output_created }
```

### 场景 B：工具调用 → 文本回复

```
── 第 1 轮：调用工具 ──

response.created                 →   raw { response_started }
output_item.added (fn_call)      →   raw { model }
fn_call_arguments.delta × N      →   raw { model } × N
fn_call_arguments.done           →   raw { model }
output_item.done                 →   raw { model }
response.completed               →   raw { response_done }
                                     run_item { tool_called }
                                     (SDK 执行工具)
                                     run_item { tool_output }

── 第 2 轮：生成回复 ──

response.created                 →   raw { response_started }
output_text.delta "天气晴朗"     →   raw { output_text_delta } × N
response.completed               →   raw { response_done }
                                     run_item { message_output_created }
```

### 场景 C：推理 + 文本回复

```
response.created                 →   raw { response_started }
output_item.added (reasoning)    →   raw { model }
reasoning_text.delta × N         →   raw { model } × N
reasoning_text.done              →   raw { model }
reasoning_summary_text.delta × N →   raw { model } × N
output_item.done                 →   raw { model }
                                     run_item { reasoning_item_created }
output_item.added (message)      →   raw { model }
output_text.delta "答案是..."    →   raw { output_text_delta }
response.completed               →   raw { response_done }
                                     run_item { message_output_created }
```

### 场景 D：Handoff 切换

```
response.completed               →   raw { response_done }
                                     run_item { handoff_requested }
                                     run_item { handoff_occurred }
                                     agent_updated { agent: AgentB }
                                     (Agent B 开始新一轮...)
```

---

## 封装实用代码

### 1. 提取纯文本（打字机效果）

```typescript
// 最简方式
for await (const delta of result.toTextStream()) {
  appendToUI(delta);
}

// 通过事件
for await (const event of result) {
  if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
    appendToUI(event.data.delta);
  }
}
```

### 2. 追踪工具调用全过程

```typescript
for await (const event of result) {
  // 工具参数增量（从 Layer 1 原始事件获取）
  if (event.type === 'raw_model_stream_event' && event.data.type === 'model') {
    const raw = event.data.event;
    if (raw.type === 'response.function_call_arguments.delta') {
      showArgumentsDelta(raw.delta);
    }
  }

  // 工具调用完成和结果（Layer 3 高级事件）
  if (event.type === 'run_item_stream_event') {
    if (event.name === 'tool_called') {
      showToolCallStart((event.item as RunToolCallItem).rawItem);
    }
    if (event.name === 'tool_output') {
      showToolCallResult((event.item as RunToolCallOutputItem).output);
    }
  }
}
```

### 3. 获取推理 / 思维链增量

```typescript
for await (const event of result) {
  if (event.type === 'raw_model_stream_event' && event.data.type === 'model') {
    const raw = event.data.event;
    if (raw.type === 'response.reasoning_text.delta') appendThinking(raw.delta);
    if (raw.type === 'response.reasoning_summary_text.delta') appendSummary(raw.delta);
  }

  // 推理完成后的完整数据
  if (event.type === 'run_item_stream_event' && event.name === 'reasoning_item_created') {
    const item = event.item as RunReasoningItem;
    // item.rawItem.content     → 用户可见摘要
    // item.rawItem.rawContent  → 原始推理文本
  }
}
```

### 4. 追踪 Agent 切换

```typescript
for await (const event of result) {
  if (event.type === 'agent_updated_stream_event') {
    updateCurrentAgent(event.agent.name);
  }
}
```

### 5. 获取 Token 用量

```typescript
for await (const event of result) {
  if (event.type === 'raw_model_stream_event' && event.data.type === 'response_done') {
    const { inputTokens, outputTokens, totalTokens } = event.data.response.usage;
    updateTokenCount({ input: inputTokens, output: outputTokens, total: totalTokens });
  }
}
```

### 6. 处理 HITL 中断

```typescript
for await (const event of result) {
  if (event.type === 'run_item_stream_event' && event.name === 'tool_approval_requested') {
    const approval = event.item as RunToolApprovalItem;
    showApprovalDialog({
      agent: approval.agent.name,
      tool: approval.name,
      args: approval.arguments
    });
  }
}
```

### 7. 完整处理器模板

```typescript
for await (const event of result) {
  switch (event.type) {
    case 'raw_model_stream_event':
      switch (event.data.type) {
        case 'response_started':
          onResponseStarted();
          break;
        case 'output_text_delta':
          onTextDelta(event.data.delta);
          break;
        case 'response_done':
          onResponseDone(event.data.response);
          break;
        case 'model':
          handleRawEvent(event.data.event);
          break;
      }
      break;

    case 'run_item_stream_event':
      switch (event.name) {
        case 'message_output_created':
          onMessage(event.item as RunMessageOutputItem);
          break;
        case 'tool_called':
          onToolCalled(event.item as RunToolCallItem);
          break;
        case 'tool_output':
          onToolOutput(event.item as RunToolCallOutputItem);
          break;
        case 'reasoning_item_created':
          onReasoning(event.item as RunReasoningItem);
          break;
        case 'handoff_requested':
          onHandoffReq(event.item as RunHandoffCallItem);
          break;
        case 'handoff_occurred':
          onHandoffDone(event.item as RunHandoffOutputItem);
          break;
        case 'tool_approval_requested':
          onApproval(event.item as RunToolApprovalItem);
          break;
      }
      break;

    case 'agent_updated_stream_event':
      onAgentUpdated(event.agent);
      break;
  }
}
```

Layer 1 原始事件子处理器：

```typescript
function handleRawEvent(raw: any) {
  switch (raw.type) {
    // 推理
    case 'response.reasoning_text.delta':
      onReasoningDelta(raw.delta);
      break;
    case 'response.reasoning_summary_text.delta':
      onSummaryDelta(raw.delta);
      break;

    // 函数参数
    case 'response.function_call_arguments.delta':
      onArgsDelta(raw.delta, raw.call_id);
      break;
    case 'response.function_call_arguments.done':
      onArgsDone(raw.arguments, raw.call_id);
      break;

    // 拒绝
    case 'response.refusal.delta':
      onRefusalDelta(raw.delta);
      break;

    // 输出项
    case 'response.output_item.added':
      onItemAdded(raw.item);
      break;
    case 'response.output_item.done':
      onItemDone(raw.item);
      break;

    // 托管工具（按需）
    case 'response.web_search_call.searching':
      onWebSearch(raw);
      break;
    case 'response.code_interpreter_call_code.delta':
      onCodeDelta(raw.delta);
      break;
    case 'response.image_generation_call.partial_image':
      onPartialImage(raw.partial_image);
      break;
  }
}
```

---

## 与 OpenAI 原始格式的关系

### 一致的部分

| 方面       | SDK 格式                  | OpenAI 原始格式                                |
| ---------- | ------------------------- | ---------------------------------------------- |
| 文本增量   | `output_text_delta.delta` | `response.output_text.delta.delta`             |
| 响应完成   | `response_done.response`  | `response.completed.response`                  |
| Token 用量 | `usage.inputTokens`       | `usage.input_tokens`（camelCase ↔ snake_case） |
| 原始事件   | `model.event`             | 完全透传                                       |

### SDK 额外提供的抽象

| SDK 事件                      | OpenAI 原始 API            |
| ----------------------------- | -------------------------- |
| `run_item_stream_event`       | 需自行解析 response output |
| `agent_updated_stream_event`  | 无（SDK 概念）             |
| `tool_called` + `tool_output` | 需自行管理工具执行         |
| `handoff_*`                   | 无（SDK 概念）             |
| `tool_approval_requested`     | 无（SDK HITL 机制）        |

---

## 速查总表

### Layer 3: RunStreamEvent（12 种组合）

| `event.type`                 | 子类型                           | 说明                  |
| ---------------------------- | -------------------------------- | --------------------- |
| `raw_model_stream_event`     | `data.type = response_started`   | 响应开始              |
| `raw_model_stream_event`     | `data.type = output_text_delta`  | 文本增量              |
| `raw_model_stream_event`     | `data.type = response_done`      | 响应完成              |
| `raw_model_stream_event`     | `data.type = model`              | Layer 1 透传（53 种） |
| `run_item_stream_event`      | `name = message_output_created`  | 消息输出              |
| `run_item_stream_event`      | `name = tool_called`             | 工具调用              |
| `run_item_stream_event`      | `name = tool_output`             | 工具结果              |
| `run_item_stream_event`      | `name = handoff_requested`       | 请求 Handoff          |
| `run_item_stream_event`      | `name = handoff_occurred`        | Handoff 完成          |
| `run_item_stream_event`      | `name = reasoning_item_created`  | 推理内容              |
| `run_item_stream_event`      | `name = tool_approval_requested` | 工具审批              |
| `agent_updated_stream_event` | —                                | Agent 切换            |

### Layer 1: 原始事件索引（53 种）

| #     | 事件类型                                                                    | 分类             |
| ----- | --------------------------------------------------------------------------- | ---------------- |
| 1-7   | `response.queued/created/in_progress/completed/failed/incomplete` + `error` | 生命周期         |
| 8-9   | `response.output_item.added/done`                                           | 输出项           |
| 10-11 | `response.content_part.added/done`                                          | 内容部分         |
| 12-14 | `response.output_text.delta/done` + `annotation.added`                      | 文本             |
| 15-20 | `response.reasoning_text.*` + `reasoning_summary_*.*`                       | 推理             |
| 21-22 | `response.function_call_arguments.delta/done`                               | 函数调用         |
| 23-24 | `response.refusal.delta/done`                                               | 拒绝             |
| 25-28 | `response.audio.*`                                                          | 音频             |
| 29-33 | `response.code_interpreter_call*`                                           | Code Interpreter |
| 34-36 | `response.file_search_call.*`                                               | File Search      |
| 37-39 | `response.web_search_call.*`                                                | Web Search       |
| 40-43 | `response.image_generation_call.*`                                          | Image Generation |
| 44-51 | `response.mcp_call*` + `mcp_list_tools.*`                                   | MCP              |
| 52-53 | `response.custom_tool_call_input.delta/done`                                | 自定义工具       |

---

返回 [README.md](./README.md) 查看完整文档目录。
