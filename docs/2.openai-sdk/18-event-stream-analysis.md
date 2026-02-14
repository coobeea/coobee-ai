# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-14T15:15:54.879Z
>
> 模型: `MiniMax-M2.1` | API: `https://api.minimaxi.com/v1`

## 目录

1. [场景1：简单问答（无工具）](#场景1简单问答无工具)
2. [场景2：工具调用（add_numbers）](#场景2工具调用add_numbers)
3. [场景3：多轮对话 + Session 持久化验证](#场景3多轮对话--session-持久化验证)
4. [总结](#总结)

## 场景1：简单问答（无工具）

- **输入**: `1+1等于几？用一个数字回答`
- **输出**: `2`
- **耗时**: 1287ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                         |
| --- | -------- | ----------------- | -------------------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                                  |
| 2   | 817      | `turn:start`      | turnIndex: 1                                                                     |
| 3   | 818      | `llm:start`       |                                                                                  |
| 4   | 819      | `reasoning:start` |                                                                                  |
| 5   | 819      | `reasoning:delta` | `\n用户问`                                                                       |
| 6   | 1277     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。\n\n1+1 = 2\n\n我应该简洁地回答，用一个数字。\n` |
| 7   | 1277     | `reasoning:done`  | rawContent(48字符)                                                               |
| 8   | 1277     | `text:start`      |                                                                                  |
| 9   | 1277     | `text:delta`      | `\n\n2`                                                                          |
| 10  | 1286     | `text:done`       | 2                                                                                |
| 11  | 1286     | `llm:done`        | tokens: in=32, out=33, total=65                                                  |
| 12  | 1288     | `turn:done`       | turnIndex: 1                                                                     |
| 13  | 1288     | `run:done`        |                                                                                  |

### 1.2 事件闭环检查

| 事件对                               | start 次数 | done 次数 | 状态    |
| ------------------------------------ | ---------- | --------- | ------- |
| `run:start` / `run:done`             | 1          | 1         | ✅ 配对 |
| `turn:start` / `turn:done`           | 1          | 1         | ✅ 配对 |
| `llm:start` / `llm:done`             | 1          | 1         | ✅ 配对 |
| `text:start` / `text:done`           | 1          | 1         | ✅ 配对 |
| `reasoning:start` / `reasoning:done` | 1          | 1         | ✅ 配对 |

### 1.3 Session 文件内容 (messages.jsonl)

共 2 条记录：

| seq | type    | role      | 内容摘要                  | 时间         |
| --- | ------- | --------- | ------------------------- | ------------ |
| 1   | message | user      | 1+1等于几？用一个数字回答 | 15:15:54.886 |
| 2   | message | assistant | [多段内容]                | 15:15:56.168 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1771082154886}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。\n\n1+1 = 2\n\n我应该简洁地回答，用一个数字。\n</think>\n\n2"}]},"ts":1771082156168}
```

### 1.5 Context Snapshot（下次 LLM 调用的上下文）

**统计信息：**

- 上下文消息数（发送给 LLM）: 2
- 总 SessionItem 数: 2
- 其中 message 数: 2
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 1+1等于几？用一个数字回答
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。\n\n1+1 = 2\n\n我应该简洁地回答，用一个数字。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(48字符): `
  用户问1+1等于几，要求用一个数字回答。

1+1 = 2

我应该简洁地回答，用一个数字。
`

- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果如下：

**加法计算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- **耗时**: 4064ms
- **事件总数**: 31
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                           |
| --- | -------- | ----------------- | ---------------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                                    |
| 2   | 646      | `turn:start`      | turnIndex: 1                                                                       |
| 3   | 646      | `llm:start`       |                                                                                    |
| 4   | 647      | `reasoning:start` |                                                                                    |
| 5   | 647      | `reasoning:delta` | `\n用户明确`                                                                       |
| 6   | 1148     | `reasoning:delta` | `要求进行两个操作：加法计算和字符串反转。我需要分别调用 `add_numbers`工具进行`     |
| 7   | 1542     | `reasoning:delta` | `17 + 28 的计算，以及调用 `reverse_string` 工具来反转 \"hello\"。\n`               |
| 8   | 1542     | `reasoning:done`  | rawContent(101字符)                                                                |
| 9   | 1542     | `text:start`      |                                                                                    |
| 10  | 1542     | `text:delta`      | `\n\n\n`                                                                           |
| 11  | 2083     | `text:done`       |                                                                                    |
| 12  | 2084     | `llm:done`        | tokens: in=351, out=101, total=452                                                 |
| 13  | 2085     | `tool:start`      | add_numbers (callId: N/A)                                                          |
| 14  | 2085     | `tool:start`      | reverse_string (callId: N/A)                                                       |
| 15  | 2086     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                          |
| 16  | 2086     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                            |
| 17  | 2858     | `turn:done`       | turnIndex: 1                                                                       |
| 18  | 2859     | `turn:start`      | turnIndex: 2                                                                       |
| 19  | 2859     | `llm:start`       |                                                                                    |
| 20  | 2859     | `reasoning:start` |                                                                                    |
| 21  | 2859     | `reasoning:delta` | `\n我已经成功`                                                                     |
| 22  | 3427     | `reasoning:delta` | `调用了两个工具并得到了结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：hello...` |
| 23  | 3883     | `reasoning:delta` | ` olleh\n\n现在我可以向用户汇报这两个结果了。\n`                                   |
| 24  | 3883     | `reasoning:done`  | rawContent(86字符)                                                                 |
| 25  | 3883     | `text:start`      |                                                                                    |
| 26  | 3883     | `text:delta`      | `\n\n计算结果如下：\n\n**加法计算：** 17 + 28 = 45\n\n**字符串反转：** \"`         |
| 27  | 4053     | `text:delta`      | `hello\" 反转为 \"olleh\"`                                                         |
| 28  | 4063     | `text:done`       | 计算结果如下：                                                                     |

**加法计算：** 17 + 28 = 45

**字符串反转：** "hello... |
| 29 | 4063 | `llm:done` | tokens: in=499, out=79, total=578 |
| 30 | 4064 | `turn:done` | turnIndex: 2 |
| 31 | 4064 | `run:done` | |

### 2.2 事件闭环检查

| 事件对                               | start 次数 | done 次数 | 状态    |
| ------------------------------------ | ---------- | --------- | ------- |
| `run:start` / `run:done`             | 1          | 1         | ✅ 配对 |
| `turn:start` / `turn:done`           | 2          | 2         | ✅ 配对 |
| `llm:start` / `llm:done`             | 2          | 2         | ✅ 配对 |
| `text:start` / `text:done`           | 2          | 2         | ✅ 配对 |
| `reasoning:start` / `reasoning:done` | 2          | 2         | ✅ 配对 |
| `tool:start` / `tool:done`           | 2          | 2         | ✅ 配对 |

### 2.3 事件嵌套结构分析

```
run:start
  turn:start
    llm:start
      reasoning:start
      reasoning:done
      text:start
      text:done
    llm:done
    tool:start
      tool:start
      tool:done
    tool:done
  turn:done
  turn:start
    llm:start
      reasoning:start
      reasoning:done
      text:start
      text:done
    llm:done
  turn:done
run:done
```

### 2.4 Session 文件内容 (messages.jsonl)

共 7 条记录：

| seq | type    | role                 | 内容摘要                                    | 时间         |
| --- | ------- | -------------------- | ------------------------------------------- | ------------ |
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 15:15:56.177 |
| 2   | message | assistant            | [多段内容]                                  | 15:16:00.239 |
| 3   | message | function_call        |                                             | 15:16:00.239 |
| 4   | message | function_call        |                                             | 15:16:00.239 |
| 5   | message | function_call_result |                                             | 15:16:00.239 |
| 6   | message | function_call_result |                                             | 15:16:00.239 |
| 7   | message | assistant            | [多段内容]                                  | 15:16:00.239 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1771082156177}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两个操作：加法计算和字符串反转。我需要分别调用 `add_numbers` 工具进行 17 + 28 的计算，以及调用 `reverse_string` 工具来反转 \"hello\"。\n</think>\n\n\n"}]},"ts":1771082160239}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_ihxgtl8o2clq_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1771082160239}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_ihxgtl8o2clq_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1771082160239}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_ihxgtl8o2clq_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1771082160239}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_ihxgtl8o2clq_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1771082160239}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n我已经成功调用了两个工具并得到了结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：hello 反转为 olleh\n\n现在我可以向用户汇报这两个结果了。\n</think>\n\n计算结果如下：\n\n**加法计算：** 17 + 28 = 45\n\n**字符串反转：** \"hello\" 反转为 \"olleh\""}]},"ts":1771082160239}
```

### 2.6 Context Snapshot

**统计信息：**

- 上下文消息数（发送给 LLM）: 7
- 总 SessionItem 数: 7
- 其中 message 数: 7
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 请计算 17 + 28，然后反转 "hello" 这个字符串
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两个操作：加法计算和字符串反转。我需要分别调用 `add_numbers` 工具进行 17 + 28 的计算，以及调用 `reverse_string` 工具来反转 \"hello\"。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n我已经成功调用了两个工具并得到了结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：hello 反转为 olleh\n\n现在我可以向用户汇报这两个结果了。\n</think>\n\n计算结果如下：\n\n**加法计算：** 17
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/6/2
- text:delta 拼接: `

计算结果如下：

**加法计算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- text:done: `计算结果如下：

**加法计算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                                                                 | Session行数 | Context消息数 |
| ---- | --------------------------- | -------------------------------------------------------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好，小明！我记住了，你最喜欢的数字是 42。有什么我可以帮你的吗？... | 2           | 2             |
| 2    | 帮我算一下 42 + 58          | 42 + 58 = 100...                                                     | 7           | 7             |
| 3    | 我叫什么名字？              | 你叫小明啊！...                                                      | 9           | 9             |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 15:16:00.243 |
| 2   | message | assistant            | [多段内容]                  | 15:16:02.050 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 15:16:02.053 |
| 4   | message | assistant            | [多段内容]                  | 15:16:05.627 |
| 5   | message | function_call        |                             | 15:16:05.627 |
| 6   | message | function_call_result |                             | 15:16:05.627 |
| 7   | message | assistant            | [多段内容]                  | 15:16:05.627 |
| 8   | message | user                 | 我叫什么名字？              | 15:16:05.630 |
| 9   | message | assistant            | [多段内容]                  | 15:16:06.904 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1771082160243}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n\n这个问题没有涉及到加法计算，所以我不需要调用 add_numbers 工具。我只需要确认我记住了用户的信息。\n</think>\n\n你好，小明！我记住了，你最喜欢的数字是 42。有什么我可以帮你的吗？"}]},"ts":1771082162050}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1771082162053}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58，我需要使用 add_numbers 工具来完成这个计算。\n</think>\n\n\n"}]},"ts":1771082165627}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_8lcw9is1rjsu_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1771082165627}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_8lcw9is1rjsu_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1771082165627}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果：42 + 58 = 100。我可以直接告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]},"ts":1771082165627}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1771082165630}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示，用户之前告诉我他叫小明，所以我应该回答小明的名字。\n</think>\n\n你叫小明啊！"}]},"ts":1771082166904}
```

### 3.4 各轮 Context Snapshot 对比

#### 第1轮后

**统计信息：**

- 上下文消息数（发送给 LLM）: 2
- 总 SessionItem 数: 2
- 其中 message 数: 2
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 我叫小明，最喜欢的数字是 42
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n\n这个问题没有涉及到加法计算，所以我不需要调用 add_numbers 工具。我只需要确认我记住了用户的信息。\n</think>\n\n你好，小明！我记
```

#### 第2轮后（工具调用后）

**统计信息：**

- 上下文消息数（发送给 LLM）: 7
- 总 SessionItem 数: 7
- 其中 message 数: 7
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 我叫小明，最喜欢的数字是 42
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n\n这个问题没有涉及到加法计算，所以我不需要调用 add_numbers 工具。我只需要确认我记住了用户的信息。\n</think>\n\n你好，小明！我记
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58，我需要使用 add_numbers 工具来完成这个计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果：42 + 58 = 100。我可以直接告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]
```

#### 第3轮后

**统计信息：**

- 上下文消息数（发送给 LLM）: 9
- 总 SessionItem 数: 9
- 其中 message 数: 9
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 我叫小明，最喜欢的数字是 42
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n\n这个问题没有涉及到加法计算，所以我不需要调用 add_numbers 工具。我只需要确认我记住了用户的信息。\n</think>\n\n你好，小明！我记
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58，我需要使用 add_numbers 工具来完成这个计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果：42 + 58 = 100。我可以直接告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示，用户之前告诉我他叫小明，所以我应该回答小明的名字。\n</think>\n\n你叫小明啊！"}]
```

### 3.5 完整事件流（3轮合计 54 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                      |
| --- | -------- | ----------------- | --------------------------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                                               |
| 2   | 830      | `turn:start`      | turnIndex: 1                                                                                  |
| 3   | 830      | `llm:start`       |                                                                                               |
| 4   | 830      | `reasoning:start` |                                                                                               |
| 5   | 830      | `reasoning:delta` | `\n用户告诉我`                                                                                |
| 6   | 1287     | `reasoning:delta` | `他的名字是小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n\n这个问题` |
| 7   | 1661     | `reasoning:delta` | `没有涉及到加法计算，所以我不需要调用 add_numbers 工具。我只需要确认我记住了用户的信息。...`  |
| 8   | 1661     | `reasoning:done`  | rawContent(104字符)                                                                           |
| 9   | 1661     | `text:start`      |                                                                                               |
| 10  | 1661     | `text:delta`      | `\n\n你好，小明！我记住了，你最喜欢的`                                                        |
| 11  | 1802     | `text:delta`      | `数字是 42。有什么我可以帮你的吗？`                                                           |
| 12  | 1808     | `text:done`       | 你好，小明！我记住了，你最喜欢的数字是 42。有什么我可以帮你的吗？                             |
| 13  | 1808     | `llm:done`        | tokens: in=249, out=67, total=316                                                             |
| 14  | 1809     | `turn:done`       | turnIndex: 1                                                                                  |
| 15  | 1809     | `run:done`        |                                                                                               |
| 16  | 1810     | `run:start`       |                                                                                               |
| 17  | 3046     | `turn:start`      | turnIndex: 1                                                                                  |
| 18  | 3047     | `llm:start`       |                                                                                               |
| 19  | 3047     | `reasoning:start` |                                                                                               |
| 20  | 3047     | `reasoning:delta` | `\n用户要求`                                                                                  |
| 21  | 3559     | `reasoning:delta` | `计算 42 + 58，我需要使用 add_numbers 工具来完成这个计算。\n`                                 |
| 22  | 3559     | `reasoning:done`  | rawContent(45字符)                                                                            |
| 23  | 3559     | `text:start`      |                                                                                               |
| 24  | 3559     | `text:delta`      | `\n\n\n`                                                                                      |
| 25  | 3791     | `text:done`       |                                                                                               |
| 26  | 3792     | `llm:done`        | tokens: in=285, out=56, total=341                                                             |
| 27  | 3792     | `tool:start`      | add_numbers (callId: N/A)                                                                     |
| 28  | 3793     | `tool:done`       | {"result":100,"expression":"42 + 58 = 100"}                                                   |
| 29  | 4815     | `turn:done`       | turnIndex: 1                                                                                  |
| 30  | 4815     | `turn:start`      | turnIndex: 2                                                                                  |
| 31  | 4815     | `llm:start`       |                                                                                               |
| 32  | 4815     | `reasoning:start` |                                                                                               |
| 33  | 4815     | `reasoning:delta` | `\n工具返回`                                                                                  |
| 34  | 5375     | `reasoning:delta` | `了结果：42 + 58 = 100。我可以直接告诉用户这个结果。\n`                                       |
| 35  | 5375     | `reasoning:done`  | rawContent(38字符)                                                                            |
| 36  | 5375     | `text:start`      |                                                                                               |
| 37  | 5375     | `text:delta`      | `\n\n42 + 58 = 100`                                                                           |
| 38  | 5382     | `text:done`       | 42 + 58 = 100                                                                                 |
| 39  | 5383     | `llm:done`        | tokens: in=377, out=30, total=407                                                             |
| 40  | 5385     | `turn:done`       | turnIndex: 2                                                                                  |
| 41  | 5385     | `run:done`        |                                                                                               |
| 42  | 5387     | `run:start`       |                                                                                               |
| 43  | 6151     | `turn:start`      | turnIndex: 1                                                                                  |
| 44  | 6151     | `llm:start`       |                                                                                               |
| 45  | 6152     | `reasoning:start` |                                                                                               |
| 46  | 6152     | `reasoning:delta` | `\n用户问我`                                                                                  |
| 47  | 6655     | `reasoning:delta` | `叫什么名字。根据系统提示，用户之前告诉我他叫小明，所以我应该回答小明的名字。\n`              |
| 48  | 6655     | `reasoning:done`  | rawContent(44字符)                                                                            |
| 49  | 6655     | `text:start`      |                                                                                               |
| 50  | 6655     | `text:delta`      | `\n\n你叫小明啊！`                                                                            |
| 51  | 6661     | `text:done`       | 你叫小明啊！                                                                                  |
| 52  | 6661     | `llm:done`        | tokens: in=375, out=29, total=404                                                             |
| 53  | 6662     | `turn:done`       | turnIndex: 1                                                                                  |
| 54  | 6663     | `run:done`        |                                                                                               |

### 3.6 事件闭环检查

| 事件对                               | start 次数 | done 次数 | 状态    |
| ------------------------------------ | ---------- | --------- | ------- |
| `run:start` / `run:done`             | 3          | 3         | ✅ 配对 |
| `turn:start` / `turn:done`           | 4          | 4         | ✅ 配对 |
| `llm:start` / `llm:done`             | 4          | 4         | ✅ 配对 |
| `text:start` / `text:done`           | 4          | 4         | ✅ 配对 |
| `reasoning:start` / `reasoning:done` | 4          | 4         | ✅ 配对 |
| `tool:start` / `tool:done`           | 1          | 1         | ✅ 配对 |

### 3.7 验证结论

- Session 累积增长: 2 → 7 → 9 ✅
- Context 累积增长: 2 → 7 → 9 ✅
- 第3轮回忆成功（包含"小明"）: ✅
- 第2轮计算正确（包含"100"）: ✅
- text:delta 无 `<think>` 标签: ✅

## 总结

### 事件流体系

本次测试使用模型 `MiniMax-M2.1` 验证了以下关键能力：

1. **事件闭环**: 所有 `start/done` 事件正确配对（run, turn, llm, text, reasoning, tool）
2. **推理拆分**: ThinkTagParser 正确将 `<think>` 标签拆分为独立的 `reasoning:start/delta/done` 事件
3. **文本纯净**: `text:delta` 和 `text:done` 中不含 `<think>` 标签
4. **Session 持久化**: messages.jsonl 正确记录了所有对话历史（user, assistant, function_call, function_call_output）
5. **Context 构建**: getItems() 正确返回累积的上下文，LLM 能回忆之前的信息

### 事件嵌套层级

```
run:start
  turn:start (turnIndex=1)
    llm:start
      reasoning:start        ← 仅 <think> 模型
      reasoning:delta × N
      reasoning:done
      text:start
      text:delta × N
      text:done
    llm:done (usage)
    tool:start (toolName)
    tool:done (output)
  turn:done
  turn:start (turnIndex=2)   ← 工具调用后新 turn
    llm:start
      ...
    llm:done
  turn:done
run:done
```

### Session 文件格式

```
messages.jsonl 每行格式（SessionItem）：
  { "seq": 1, "type": "message", "item": { "role": "user", "content": "..." }, "ts": ... }
  { "seq": 2, "type": "message", "item": { "role": "assistant", "content": [{"type":"output_text","text":"..."}] }, "ts": ... }
  { "seq": N, "type": "summary", "item": {...}, "meta": { "summarizedSeqs": [...], ... }, "ts": ... }
```
