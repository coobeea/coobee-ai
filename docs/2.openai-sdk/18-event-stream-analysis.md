# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-14T00:53:33.138Z
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
- **耗时**: 9552ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                             |
| --- | -------- | ----------------- | ------------------------------------------------------------------------------------ |
| 1   | 0        | `run:start`       |                                                                                      |
| 2   | 8787     | `turn:start`      | turnIndex: 1                                                                         |
| 3   | 8787     | `llm:start`       |                                                                                      |
| 4   | 8787     | `reasoning:start` |                                                                                      |
| 5   | 8787     | `reasoning:delta` | `\n用户问`                                                                           |
| 6   | 9537     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。我需要简洁回答。\n` |
| 7   | 9537     | `reasoning:done`  | rawContent(47字符)                                                                   |
| 8   | 9537     | `text:start`      |                                                                                      |
| 9   | 9537     | `text:delta`      | `\n\n2`                                                                              |
| 10  | 9549     | `text:done`       | 2                                                                                    |
| 11  | 9550     | `llm:done`        | tokens: in=32, out=28, total=60                                                      |
| 12  | 9552     | `turn:done`       | turnIndex: 1                                                                         |
| 13  | 9552     | `run:done`        |                                                                                      |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 00:53:33.148 |
| 2   | message | assistant | [多段内容]                | 00:53:42.692 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1771030413148}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。我需要简洁回答。\n</think>\n\n2"}]},"ts":1771030422692}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。我需要简洁回答。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(47字符): `用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。我需要简洁回答。`
- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**："hello" 反转后是 "olleh"`

- **耗时**: 5255ms
- **事件总数**: 33
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                            |
| --- | -------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                                                     |
| 2   | 605      | `turn:start`      | turnIndex: 1                                                                                        |
| 3   | 605      | `llm:start`       |                                                                                                     |
| 4   | 606      | `reasoning:start` |                                                                                                     |
| 5   | 606      | `reasoning:delta` | `\n用户提出了`                                                                                      |
| 6   | 1346     | `reasoning:delta` | `两个明确的要求：\n1. 计算 17 + 28：这需要使用 `add_numbers` 工具，参数为 ...`                      |
| 7   | 1755     | `reasoning:delta` | `=17 和 b=28。\n2. 反转 \"hello\" 这个字符串：这需要使用 `reverse_str...`                           |
| 8   | 2229     | `reasoning:delta` | `独立且都属于工具的适用范围，我应该同时调用这两个工具来高效地完成用户的任务。\n`                    |
| 9   | 2229     | `reasoning:done`  | rawContent(182字符)                                                                                 |
| 10  | 2229     | `text:start`      |                                                                                                     |
| 11  | 2229     | `text:delta`      | `\n\n\n`                                                                                            |
| 12  | 2825     | `text:done`       |                                                                                                     |
| 13  | 2826     | `llm:done`        | tokens: in=351, out=140, total=491                                                                  |
| 14  | 2827     | `tool:start`      | add_numbers (callId: N/A)                                                                           |
| 15  | 2827     | `tool:start`      | reverse_string (callId: N/A)                                                                        |
| 16  | 2827     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                                           |
| 17  | 2828     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                                             |
| 18  | 3533     | `turn:done`       | turnIndex: 1                                                                                        |
| 19  | 3533     | `turn:start`      | turnIndex: 2                                                                                        |
| 20  | 3533     | `llm:start`       |                                                                                                     |
| 21  | 3533     | `reasoning:start` |                                                                                                     |
| 22  | 3533     | `reasoning:delta` | `\n好的，我已经`                                                                                    |
| 23  | 4052     | `reasoning:delta` | `收到了两个工具的返回结果。让我分析一下：\n\n1. `add_numbers` 工具返回了结果：45，...`              |
| 24  | 4454     | `reasoning:delta` | `45\"。这说明 17 + 28 的计算结果是正确的。\n\n2.`reverse_string` 工...`                             |
| 25  | 4835     | `reasoning:delta` | `后的字符串 \"olleh\"。\n\n现在我需要将这两个结果清晰地呈现给用户。我会分别说明加法计算和字符串...` |
| 26  | 4835     | `reasoning:done`  | rawContent(200字符)                                                                                 |
| 27  | 4835     | `text:start`      |                                                                                                     |
| 28  | 4835     | `text:delta`      | `\n\n计算`                                                                                          |
| 29  | 5247     | `text:delta`      | `结果如下：\n\n1. **加法计算**：17 + 28 = 45\n\n2. **字符串反转**：\"hel...`                        |
| 30  | 5255     | `text:done`       | 计算结果如下：                                                                                      |

1. **加法计算**：17 + 28 = 45

2. **字符串反转**："h... |
   | 31 | 5255 | `llm:done` | tokens: in=538, out=136, total=674 |
   | 32 | 5256 | `turn:done` | turnIndex: 2 |
   | 33 | 5256 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 00:53:42.699 |
| 2   | message | assistant            | [多段内容]                                  | 00:53:47.953 |
| 3   | message | function_call        |                                             | 00:53:47.953 |
| 4   | message | function_call        |                                             | 00:53:47.953 |
| 5   | message | function_call_result |                                             | 00:53:47.953 |
| 6   | message | function_call_result |                                             | 00:53:47.953 |
| 7   | message | assistant            | [多段内容]                                  | 00:53:47.953 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1771030422699}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户提出了两个明确的要求：\n1. 计算 17 + 28：这需要使用 `add_numbers` 工具，参数为 a=17 和 b=28。\n2. 反转 \"hello\" 这个字符串：这需要使用 `reverse_string` 工具，参数为 text=\"hello\"。\n\n由于这两个请求相互独立且都属于工具的适用范围，我应该同时调用这两个工具来高效地完成用户的任务。\n</think>\n\n\n"}]},"ts":1771030427953}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_wu9tq1h1do8w_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1771030427953}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_wu9tq1h1do8w_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1771030427953}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_wu9tq1h1do8w_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1771030427953}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_wu9tq1h1do8w_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1771030427953}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经收到了两个工具的返回结果。让我分析一下：\n\n1. `add_numbers` 工具返回了结果：45，表达式是 \"17 + 28 = 45\"。这说明 17 + 28 的计算结果是正确的。\n\n2. `reverse_string` 工具返回了原始字符串 \"hello\" 和反转后的字符串 \"olleh\"。\n\n现在我需要将这两个结果清晰地呈现给用户。我会分别说明加法计算和字符串反转的结果。\n</think>\n\n计算结果如下：\n\n1. **加法计算**：17 + 28 = 45\n\n2. **字符串反转**：\"hello\" 反转后是 \"olleh\""}]},"ts":1771030427953}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户提出了两个明确的要求：\n1. 计算 17 + 28：这需要使用 `add_numbers` 工具，参数为 a=17 和 b=28。\n2. 反转 \"hello\" 这个字符串：这需要使用 `reverse_string` 工具，参数为 text
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经收到了两个工具的返回结果。让我分析一下：\n\n1. `add_numbers` 工具返回了结果：45，表达式是 \"17 + 28 = 45\"。这说明 17 + 28 的计算结果是正确的。\n\n2. `reverse_string`
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/8/2
- text:delta 拼接: `

计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**："hello" 反转后是 "olleh"`

- text:done: `计算结果如下：

1. **加法计算**：17 + 28 = 45

2. **字符串反转**："hello" 反转后是 "olleh"`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                                        | Session行数 | Context消息数 |
| ---- | --------------------------- | ------------------------------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好，小明！我记住你最喜欢的数字是 **42**。 |

有什么我可以帮你的吗？... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = **100**... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫**小明**呀！这是你一开始就告诉我的。... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 00:53:47.959 |
| 2   | message | assistant            | [多段内容]                  | 00:53:49.506 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 00:53:49.508 |
| 4   | message | assistant            | [多段内容]                  | 00:53:52.161 |
| 5   | message | function_call        |                             | 00:53:52.161 |
| 6   | message | function_call_result |                             | 00:53:52.161 |
| 7   | message | assistant            | [多段内容]                  | 00:53:52.161 |
| 8   | message | user                 | 我叫什么名字？              | 00:53:52.162 |
| 9   | message | assistant            | [多段内容]                  | 00:53:53.497 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1771030427959}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你最喜欢的数字是 **42**。\n\n有什么我可以帮你的吗？"}]},"ts":1771030429506}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1771030429508}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]},"ts":1771030432161}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_0e0r1zvvpc5k_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1771030432161}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_0e0r1zvvpc5k_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1771030432161}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回结果是 100。让我告诉用户计算结果。\n</think>\n\n42 + 58 = **100**"}]},"ts":1771030432161}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1771030432162}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示中的信息，用户告诉我他叫小明，所以我应该回答用户叫什么名字。\n</think>\n\n你叫**小明**呀！这是你一开始就告诉我的。"}]},"ts":1771030433497}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你最喜欢的数字是 **42**。\n\n有什么我可以帮你的吗？"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你最喜欢的数字是 **42**。\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回结果是 100。让我告诉用户计算结果。\n</think>\n\n42 + 58 = **100**"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n你好，小明！我记住你最喜欢的数字是 **42**。\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回结果是 100。让我告诉用户计算结果。\n</think>\n\n42 + 58 = **100**"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示中的信息，用户告诉我他叫小明，所以我应该回答用户叫什么名字。\n</think>\n\n你叫**小明**呀！这是你一开始就告诉我的。"}]
```

### 3.5 完整事件流（3轮合计 54 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                     |
| --- | -------- | ----------------- | ---------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                              |
| 2   | 923      | `turn:start`      | turnIndex: 1                                                                 |
| 3   | 923      | `llm:start`       |                                                                              |
| 4   | 923      | `reasoning:start` |                                                                              |
| 5   | 923      | `reasoning:delta` | `\n用户告诉我`                                                               |
| 6   | 1359     | `reasoning:delta` | `他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n` |
| 7   | 1359     | `reasoning:done`  | rawContent(44字符)                                                           |
| 8   | 1359     | `text:start`      |                                                                              |
| 9   | 1359     | `text:delta`      | `\n\n你好，小明！我记住你最喜欢的`                                           |
| 10  | 1534     | `text:delta`      | `数字是 **42**。\n\n有什么我可以帮你的吗？`                                  |
| 11  | 1547     | `text:done`       | 你好，小明！我记住你最喜欢的数字是 **42**。                                  |

有什么我可以帮你的吗？ |
| 12 | 1547 | `llm:done` | tokens: in=249, out=45, total=294 |
| 13 | 1548 | `turn:done` | turnIndex: 1 |
| 14 | 1548 | `run:done` | |
| 15 | 1549 | `run:start` | |
| 16 | 2359 | `turn:start` | turnIndex: 1 |
| 17 | 2359 | `llm:start` | |
| 18 | 2359 | `reasoning:start` | |
| 19 | 2359 | `reasoning:delta` | `\n用户要求` |
| 20 | 2906 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n` |
| 21 | 2906 | `reasoning:done` | rawContent(45字符) |
| 22 | 2906 | `text:start` | |
| 23 | 2906 | `text:delta` | `\n\n\n` |
| 24 | 3103 | `text:done` | |
| 25 | 3103 | `llm:done` | tokens: in=286, out=58, total=344 |
| 26 | 3103 | `tool:start` | add_numbers (callId: N/A) |
| 27 | 3103 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 28 | 3753 | `turn:done` | turnIndex: 1 |
| 29 | 3753 | `turn:start` | turnIndex: 2 |
| 30 | 3753 | `llm:start` | |
| 31 | 3753 | `reasoning:start` | |
| 32 | 3754 | `reasoning:delta` | `\n工具返回` |
| 33 | 4193 | `reasoning:delta` | `结果是 100。让我告诉用户计算结果。\n` |
| 34 | 4193 | `reasoning:done` | rawContent(25字符) |
| 35 | 4193 | `text:start` | |
| 36 | 4193 | `text:delta` | `\n\n42 + 58 = **100**` |
| 37 | 4203 | `text:done` | 42 + 58 = **100** |
| 38 | 4203 | `llm:done` | tokens: in=380, out=24, total=404 |
| 39 | 4203 | `turn:done` | turnIndex: 2 |
| 40 | 4203 | `run:done` | |
| 41 | 4204 | `run:start` | |
| 42 | 4834 | `turn:start` | turnIndex: 1 |
| 43 | 4834 | `llm:start` | |
| 44 | 4834 | `reasoning:start` | |
| 45 | 4834 | `reasoning:delta` | `\n用户问我` |
| 46 | 5383 | `reasoning:delta` | `叫什么名字。根据系统提示中的信息，用户告诉我他叫小明，所以我应该回答用户叫什么名字。\n` |
| 47 | 5383 | `reasoning:done` | rawContent(48字符) |
| 48 | 5383 | `text:start` | |
| 49 | 5383 | `text:delta` | `\n\n你叫**小明**呀！这是你` |
| 50 | 5532 | `text:delta` | `一开始就告诉我的。` |
| 51 | 5539 | `text:done` | 你叫**小明**呀！这是你一开始就告诉我的。 |
| 52 | 5539 | `llm:done` | tokens: in=377, out=38, total=415 |
| 53 | 5539 | `turn:done` | turnIndex: 1 |
| 54 | 5539 | `run:done` | |

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
