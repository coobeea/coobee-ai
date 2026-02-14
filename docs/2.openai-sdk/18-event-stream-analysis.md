# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-13T17:36:06.326Z
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
- **耗时**: 1671ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                            |
| --- | -------- | ----------------- | ----------------------------------- |
| 1   | 1        | `run:start`       |                                     |
| 2   | 1399     | `turn:start`      | turnIndex: 1                        |
| 3   | 1399     | `llm:start`       |                                     |
| 4   | 1400     | `reasoning:start` |                                     |
| 5   | 1400     | `reasoning:delta` | `\n用户问`                          |
| 6   | 1666     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。\n` |
| 7   | 1666     | `reasoning:done`  | rawContent(22字符)                  |
| 8   | 1666     | `text:start`      |                                     |
| 9   | 1666     | `text:delta`      | `\n\n2`                             |
| 10  | 1671     | `text:done`       | 2                                   |
| 11  | 1671     | `llm:done`        | tokens: in=32, out=17, total=49     |
| 12  | 1672     | `turn:done`       | turnIndex: 1                        |
| 13  | 1672     | `run:done`        |                                     |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 17:36:06.334 |
| 2   | message | assistant | [多段内容]                | 17:36:08.000 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1771004166334}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。\n</think>\n\n2"}]},"ts":1771004168000}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(22字符): `用户问1+1等于几，要求用一个数字回答。`
- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**：将 "hello" 反转后得到 "olleh"

这两个操作都已完成！`

- **耗时**: 5201ms
- **事件总数**: 31
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                |
| --- | -------- | ----------------- | --------------------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                                         |
| 2   | 1148     | `turn:start`      | turnIndex: 1                                                                            |
| 3   | 1148     | `llm:start`       |                                                                                         |
| 4   | 1149     | `reasoning:start` |                                                                                         |
| 5   | 1150     | `reasoning:delta` | `\n用户明确`                                                                            |
| 6   | 1655     | `reasoning:delta` | `要求计算 17 + 28，这是加法操作，应该使用 `add_numbers` 工具。同时用户还要求反...`      |
| 7   | 2105     | `reasoning:delta` | `字符串，这是字符串反转操作，应该使用 `reverse_string` 工具。我需要同时调用这两个工...` |
| 8   | 2105     | `reasoning:done`  | rawContent(118字符)                                                                     |
| 9   | 2105     | `text:start`      |                                                                                         |
| 10  | 2105     | `text:delta`      | `\n\n\n`                                                                                |
| 11  | 2872     | `text:done`       |                                                                                         |
| 12  | 2874     | `llm:done`        | tokens: in=351, out=107, total=458                                                      |
| 13  | 2874     | `tool:start`      | add_numbers (callId: N/A)                                                               |
| 14  | 2874     | `tool:start`      | reverse_string (callId: N/A)                                                            |
| 15  | 2875     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                               |
| 16  | 2876     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                                 |
| 17  | 3881     | `turn:done`       | turnIndex: 1                                                                            |
| 18  | 3881     | `turn:start`      | turnIndex: 2                                                                            |
| 19  | 3881     | `llm:start`       |                                                                                         |
| 20  | 3881     | `reasoning:start` |                                                                                         |
| 21  | 3881     | `reasoning:delta` | `\n好的，我已经`                                                                        |
| 22  | 4308     | `reasoning:delta` | `收到了两个工具的返回结果：\n1. `add_numbers` 工具返回了 17 + 28 = 45\n...`             |
| 23  | 4705     | `reasoning:delta` | `_string` 工具将 \"hello\" 反转为 \"olleh\"\n\n现在我需要根据这些结果来回答用户...`     |
| 24  | 4705     | `reasoning:done`  | rawContent(123字符)                                                                     |
| 25  | 4705     | `text:start`      |                                                                                         |
| 26  | 4705     | `text:delta`      | `\n\n计算结果如下：\n\n1. **加`                                                         |
| 27  | 5190     | `text:delta`      | `法计算**：17 + 28 = 45\n\n2. **字符串反转**：将 \"hello\" 反转后得到 \"...`            |
| 28  | 5199     | `text:done`       | 计算结果如下：                                                                          |

1. **加法计算**：17 + 28 = 45

2. **字符串反转**：将 ... |
   | 29 | 5200 | `llm:done` | tokens: in=505, out=103, total=608 |
   | 30 | 5201 | `turn:done` | turnIndex: 2 |
   | 31 | 5201 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 17:36:08.005 |
| 2   | message | assistant            | [多段内容]                                  | 17:36:13.204 |
| 3   | message | function_call        |                                             | 17:36:13.204 |
| 4   | message | function_call        |                                             | 17:36:13.204 |
| 5   | message | function_call_result |                                             | 17:36:13.204 |
| 6   | message | function_call_result |                                             | 17:36:13.204 |
| 7   | message | assistant            | [多段内容]                                  | 17:36:13.204 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1771004168005}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求计算 17 + 28，这是加法操作，应该使用 `add_numbers` 工具。同时用户还要求反转 \"hello\" 字符串，这是字符串反转操作，应该使用 `reverse_string` 工具。我需要同时调用这两个工具。\n</think>\n\n\n"}]},"ts":1771004173204}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_jrbwkkq2xgwi_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1771004173204}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_jrbwkkq2xgwi_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1771004173204}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_jrbwkkq2xgwi_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1771004173204}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_jrbwkkq2xgwi_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1771004173204}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经收到了两个工具的返回结果：\n1. `add_numbers` 工具返回了 17 + 28 = 45\n2. `reverse_string` 工具将 \"hello\" 反转为 \"olleh\"\n\n现在我需要根据这些结果来回答用户的问题。\n</think>\n\n计算结果如下：\n\n1. **加法计算**：17 + 28 = 45\n\n2. **字符串反转**：将 \"hello\" 反转后得到 \"olleh\"\n\n这两个操作都已完成！"}]},"ts":1771004173204}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求计算 17 + 28，这是加法操作，应该使用 `add_numbers` 工具。同时用户还要求反转 \"hello\" 字符串，这是字符串反转操作，应该使用 `reverse_string` 工具。我需要同时调用这两个工具。\n</thin
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经收到了两个工具的返回结果：\n1. `add_numbers` 工具返回了 17 + 28 = 45\n2. `reverse_string` 工具将 \"hello\" 反转为 \"olleh\"\n\n现在我需要根据这些结果来回答用户的
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/6/2
- text:delta 拼接: `

计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**：将 "hello" 反转后得到 "olleh"

这两个操作都已完成！`

- text:done: `计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**：将 "hello" 反转后得到 "olleh"

这两个操作都已完成！`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                     | Session行数 | Context消息数 |
| ---- | --------------------------- | ------------------------ | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好，小明！我记住你了： |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = **100**... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫**小明**，对吧？😊... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 17:36:13.211 |
| 2   | message | assistant            | [多段内容]                  | 17:36:15.123 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 17:36:15.128 |
| 4   | message | assistant            | [多段内容]                  | 17:36:21.996 |
| 5   | message | function_call        |                             | 17:36:21.996 |
| 6   | message | function_call_result |                             | 17:36:21.996 |
| 7   | message | assistant            | [多段内容]                  | 17:36:21.996 |
| 8   | message | user                 | 我叫什么名字？              | 17:36:22.000 |
| 9   | message | assistant            | [多段内容]                  | 17:36:24.288 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1771004173211}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]},"ts":1771004175123}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1771004175128}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n</think>\n\n\n"}]},"ts":1771004181996}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_ep8gasme82xt_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1771004181996}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_ep8gasme82xt_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1771004181996}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果显示 42 + 58 = 100。这是用户喜欢的数字 42 的加法计算。\n</think>\n\n42 + 58 = **100**"}]},"ts":1771004181996}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1771004182000}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问\"我叫什么名字？\"。根据系统提示中用户提供的初始信息，用户告诉我他叫小明。我需要记住这个信息并在回答中准确引用。\n\n用户说：\"我叫小明，最喜欢的数字是 42\"\n\n所以用户叫小明，最喜欢的数字是42。\n</think>\n\n你叫**小明**，对吧？😊"}]},"ts":1771004184288}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果显示 42 + 58 = 100。这是用户喜欢的数字 42 的加法计算。\n</think>\n\n42 + 58 = **100**"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果显示 42 + 58 = 100。这是用户喜欢的数字 42 的加法计算。\n</think>\n\n42 + 58 = **100**"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问\"我叫什么名字？\"。根据系统提示中用户提供的初始信息，用户告诉我他叫小明。我需要记住这个信息并在回答中准确引用。\n\n用户说：\"我叫小明，最喜欢的数字是 42\"\n\n所以用户叫小明，最喜欢的数字是42。\n</think>\n\n你叫
```

### 3.5 完整事件流（3轮合计 55 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                      |
| --- | -------- | ----------------- | ----------------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                               |
| 2   | 1001     | `turn:start`      | turnIndex: 1                                                                  |
| 3   | 1001     | `llm:start`       |                                                                               |
| 4   | 1001     | `reasoning:start` |                                                                               |
| 5   | 1001     | `reasoning:delta` | `\n用户告诉我`                                                                |
| 6   | 1558     | `reasoning:delta` | `他叫小明，最喜欢的数字是 42。我应该记住这些信息，并在后续对话中准确引用。\n` |
| 7   | 1558     | `reasoning:done`  | rawContent(45字符)                                                            |
| 8   | 1558     | `text:start`      |                                                                               |
| 9   | 1558     | `text:delta`      | `\n\n你好，小明！我记住你了：\n- 名字：小`                                    |
| 10  | 1903     | `text:delta`      | `明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？`                            |
| 11  | 1914     | `text:done`       | 你好，小明！我记住你了：                                                      |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？ |
| 12 | 1914 | `llm:done` | tokens: in=249, out=53, total=302 |
| 13 | 1915 | `turn:done` | turnIndex: 1 |
| 14 | 1915 | `run:done` | |
| 15 | 1917 | `run:start` | |
| 16 | 6021 | `turn:start` | turnIndex: 1 |
| 17 | 6021 | `llm:start` | |
| 18 | 6021 | `reasoning:start` | |
| 19 | 6021 | `reasoning:delta` | `\n用户要求` |
| 20 | 6634 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来计算。\n` |
| 21 | 6634 | `reasoning:done` | rawContent(41字符) |
| 22 | 6634 | `text:start` | |
| 23 | 6634 | `text:delta` | `\n\n\n` |
| 24 | 6878 | `text:done` | |
| 25 | 6879 | `llm:done` | tokens: in=293, out=55, total=348 |
| 26 | 6879 | `tool:start` | add_numbers (callId: N/A) |
| 27 | 6880 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 28 | 8103 | `turn:done` | turnIndex: 1 |
| 29 | 8103 | `turn:start` | turnIndex: 2 |
| 30 | 8103 | `llm:start` | |
| 31 | 8105 | `reasoning:start` | |
| 32 | 8105 | `reasoning:delta` | `\n计算结果显示` |
| 33 | 8782 | `reasoning:delta` | ` 42 + 58 = 100。这是用户喜欢的数字 42 的加法计算。\n` |
| 34 | 8782 | `reasoning:done` | rawContent(42字符) |
| 35 | 8782 | `text:start` | |
| 36 | 8782 | `text:delta` | `\n\n42 + 58 = **100**` |
| 37 | 8786 | `text:done` | 42 + 58 = **100** |
| 38 | 8787 | `llm:done` | tokens: in=384, out=33, total=417 |
| 39 | 8788 | `turn:done` | turnIndex: 2 |
| 40 | 8788 | `run:done` | |
| 41 | 8789 | `run:start` | |
| 42 | 9858 | `turn:start` | turnIndex: 1 |
| 43 | 9858 | `llm:start` | |
| 44 | 9859 | `reasoning:start` | |
| 45 | 9859 | `reasoning:delta` | `\n用户问` |
| 46 | 10363 | `reasoning:delta` | `\"我叫什么名字？\"。根据系统提示中用户提供的初始信息，用户告诉我他叫小明。我需要记住这个信息并在回答` |
| 47 | 10832 | `reasoning:delta` | `中准确引用。\n\n用户说：\"我叫小明，最喜欢的数字是 42\"\n\n所以用户叫小明，最喜欢的数字是42。` |
| 48 | 11065 | `reasoning:delta` | `\n` |
| 49 | 11065 | `reasoning:done` | rawContent(104字符) |
| 50 | 11065 | `text:start` | |
| 51 | 11065 | `text:delta` | `\n\n你叫**小明**，对吧？😊` |
| 52 | 11078 | `text:done` | 你叫**小明**，对吧？😊 |
| 53 | 11079 | `llm:done` | tokens: in=384, out=67, total=451 |
| 54 | 11080 | `turn:done` | turnIndex: 1 |
| 55 | 11080 | `run:done` | |

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
