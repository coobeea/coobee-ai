# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-12T12:59:48.239Z
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
- **耗时**: 2173ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                           |
| --- | -------- | ----------------- | ------------------------------------------------------------------ |
| 1   | 1        | `run:start`       |                                                                    |
| 2   | 1672     | `turn:start`      | turnIndex: 1                                                       |
| 3   | 1672     | `llm:start`       |                                                                    |
| 4   | 1673     | `reasoning:start` |                                                                    |
| 5   | 1673     | `reasoning:delta` | `\n用户问`                                                         |
| 6   | 2161     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。\n` |
| 7   | 2161     | `reasoning:done`  | rawContent(40字符)                                                 |
| 8   | 2161     | `text:start`      |                                                                    |
| 9   | 2161     | `text:delta`      | `\n\n2`                                                            |
| 10  | 2172     | `text:done`       | 2                                                                  |
| 11  | 2172     | `llm:done`        | tokens: in=32, out=27, total=59                                    |
| 12  | 2174     | `turn:done`       | turnIndex: 1                                                       |
| 13  | 2174     | `run:done`        |                                                                    |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 12:59:48.251 |
| 2   | message | assistant | [多段内容]                | 12:59:50.415 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1770901188251}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。\n</think>\n\n2"}]},"ts":1770901190415}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(40字符): `用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。`
- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果：
- 加法：17 + 28 = 45
- 反转字符串："hello" → "olleh"`
- **耗时**: 4461ms
- **事件总数**: 31
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                             |
| --- | -------- | ----------------- | ------------------------------------------------------------------------------------ |
| 1   | 0        | `run:start`       |                                                                                      |
| 2   | 854      | `turn:start`      | turnIndex: 1                                                                         |
| 3   | 854      | `llm:start`       |                                                                                      |
| 4   | 854      | `reasoning:start` |                                                                                      |
| 5   | 854      | `reasoning:delta` | `\n用户明确`                                                                         |
| 6   | 1449     | `reasoning:delta` | `要求进行两个操作：加法和字符串反转。我需要分别调用 `add_numbers`和`reverse...`      |
| 7   | 1940     | `reasoning:delta` | `正确的参数。\n`                                                                     |
| 8   | 1940     | `reasoning:done`  | rawContent(80字符)                                                                   |
| 9   | 1940     | `text:start`      |                                                                                      |
| 10  | 1940     | `text:delta`      | `\n\n\n`                                                                             |
| 11  | 2421     | `text:done`       |                                                                                      |
| 12  | 2422     | `llm:done`        | tokens: in=351, out=89, total=440                                                    |
| 13  | 2423     | `tool:start`      | add_numbers (callId: N/A)                                                            |
| 14  | 2424     | `tool:start`      | reverse_string (callId: N/A)                                                         |
| 15  | 2424     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                            |
| 16  | 2424     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                              |
| 17  | 3079     | `turn:done`       | turnIndex: 1                                                                         |
| 18  | 3079     | `turn:start`      | turnIndex: 2                                                                         |
| 19  | 3079     | `llm:start`       |                                                                                      |
| 20  | 3079     | `reasoning:start` |                                                                                      |
| 21  | 3079     | `reasoning:delta` | `\n工具调用`                                                                         |
| 22  | 3677     | `reasoning:delta` | `成功完成了！现在我来总结结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hel...` |
| 23  | 4093     | `reasoning:delta` | ` \"olleh\"\n\n我会清晰地呈现这两个结果。\n`                                         |
| 24  | 4093     | `reasoning:done`  | rawContent(86字符)                                                                   |
| 25  | 4093     | `text:start`      |                                                                                      |
| 26  | 4093     | `text:delta`      | `\n\n计算结果：\n- 加法：17 + 28 = 45\n- 反`                                         |
| 27  | 4452     | `text:delta`      | `转字符串：\"hello\" → \"olleh\"`                                                    |
| 28  | 4459     | `text:done`       | 计算结果：                                                                           |

- 加法：17 + 28 = 45
- 反转字符串："hello" → "olleh" |
  | 29 | 4459 | `llm:done` | tokens: in=487, out=74, total=561 |
  | 30 | 4461 | `turn:done` | turnIndex: 2 |
  | 31 | 4461 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 12:59:50.422 |
| 2   | message | assistant            | [多段内容]                                  | 12:59:54.881 |
| 3   | message | function_call        |                                             | 12:59:54.881 |
| 4   | message | function_call        |                                             | 12:59:54.881 |
| 5   | message | function_call_result |                                             | 12:59:54.881 |
| 6   | message | function_call_result |                                             | 12:59:54.881 |
| 7   | message | assistant            | [多段内容]                                  | 12:59:54.881 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1770901190422}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两个操作：加法和字符串反转。我需要分别调用 `add_numbers` 和 `reverse_string` 这两个工具，并传入正确的参数。\n</think>\n\n\n"}]},"ts":1770901194881}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_fkereycz53w5_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1770901194881}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_fkereycz53w5_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1770901194881}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_fkereycz53w5_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1770901194881}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_fkereycz53w5_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1770901194881}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具调用成功完成了！现在我来总结结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n我会清晰地呈现这两个结果。\n</think>\n\n计算结果：\n- 加法：17 + 28 = 45\n- 反转字符串：\"hello\" → \"olleh\""}]},"ts":1770901194881}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两个操作：加法和字符串反转。我需要分别调用 `add_numbers` 和 `reverse_string` 这两个工具，并传入正确的参数。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具调用成功完成了！现在我来总结结果：\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n我会清晰地呈现这两个结果。\n</think>\n\n计算结果：\n- 加法：17 + 28
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/6/2
- text:delta 拼接: `

计算结果：

- 加法：17 + 28 = 45
- 反转字符串："hello" → "olleh"`
- text:done: `计算结果：
- 加法：17 + 28 = 45
- 反转字符串："hello" → "olleh"`
- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                   | Session行数 | Context消息数 |
| ---- | --------------------------- | ---------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 好的，小明！我记住了： |

- 你的名字是**小明**
- 你最喜欢的数字是 **42**

有什么我可以帮你的吗？... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = **100**... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫**小明**呀！这是你一开始告诉我的。😊... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 12:59:54.890 |
| 2   | message | assistant            | [多段内容]                  | 12:59:56.719 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 12:59:56.721 |
| 4   | message | assistant            | [多段内容]                  | 13:00:04.490 |
| 5   | message | function_call        |                             | 13:00:04.490 |
| 6   | message | function_call_result |                             | 13:00:04.490 |
| 7   | message | assistant            | [多段内容]                  | 13:00:04.490 |
| 8   | message | user                 | 我叫什么名字？              | 13:00:04.491 |
| 9   | message | assistant            | [多段内容]                  | 13:00:13.348 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1770901194890}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n好的，小明！我记住了：\n- 你的名字是**小明**\n- 你最喜欢的数字是 **42**\n\n有什么我可以帮你的吗？"}]},"ts":1770901196719}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1770901196721}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]},"ts":1770901204490}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_5bhuvwyr1w5q_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1770901204490}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_5bhuvwyr1w5q_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1770901204490}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果 100。42 + 58 确实等于 100。我直接告诉用户结果即可。\n</think>\n\n42 + 58 = **100**"}]},"ts":1770901204490}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1770901204491}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示中的信息，用户告诉我他叫小明。我需要回答用户的问题。\n</think>\n\n你叫**小明**呀！这是你一开始告诉我的。😊"}]},"ts":1770901213348}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n好的，小明！我记住了：\n- 你的名字是**小明**\n- 你最喜欢的数字是 **42**\n\n有什么我可以帮你的吗？"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n好的，小明！我记住了：\n- 你的名字是**小明**\n- 你最喜欢的数字是 **42**\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果 100。42 + 58 确实等于 100。我直接告诉用户结果即可。\n</think>\n\n42 + 58 = **100**"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n</think>\n\n好的，小明！我记住了：\n- 你的名字是**小明**\n- 你最喜欢的数字是 **42**\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n工具返回了结果 100。42 + 58 确实等于 100。我直接告诉用户结果即可。\n</think>\n\n42 + 58 = **100**"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示中的信息，用户告诉我他叫小明。我需要回答用户的问题。\n</think>\n\n你叫**小明**呀！这是你一开始告诉我的。😊"}]
```

### 3.5 完整事件流（3轮合计 54 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                     |
| --- | -------- | ----------------- | ---------------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                              |
| 2   | 1087     | `turn:start`      | turnIndex: 1                                                                 |
| 3   | 1087     | `llm:start`       |                                                                              |
| 4   | 1087     | `reasoning:start` |                                                                              |
| 5   | 1087     | `reasoning:delta` | `\n用户告诉我`                                                               |
| 6   | 1432     | `reasoning:delta` | `他叫小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n` |
| 7   | 1432     | `reasoning:done`  | rawContent(44字符)                                                           |
| 8   | 1432     | `text:start`      |                                                                              |
| 9   | 1432     | `text:delta`      | `\n\n好的，小明！我记住了：\n- 你的名字是**`                                 |
| 10  | 1823     | `text:delta`      | `小明**\n- 你最喜欢的数字是 **42**\n\n有什么我可以帮你的吗？`                |
| 11  | 1832     | `text:done`       | 好的，小明！我记住了：                                                       |

- 你的名字是**小明**
- 你最喜欢的数字是 **42**

有什么我可... |
| 12 | 1832 | `llm:done` | tokens: in=249, out=54, total=303 |
| 13 | 1833 | `turn:done` | turnIndex: 1 |
| 14 | 1833 | `run:done` | |
| 15 | 1834 | `run:start` | |
| 16 | 3973 | `turn:start` | turnIndex: 1 |
| 17 | 3973 | `llm:start` | |
| 18 | 3973 | `reasoning:start` | |
| 19 | 3973 | `reasoning:delta` | `\n用户要求` |
| 20 | 4660 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n` |
| 21 | 4660 | `reasoning:done` | rawContent(45字符) |
| 22 | 4660 | `text:start` | |
| 23 | 4660 | `text:delta` | `\n\n\n` |
| 24 | 5073 | `text:done` | |
| 25 | 5073 | `llm:done` | tokens: in=295, out=58, total=353 |
| 26 | 5073 | `tool:start` | add_numbers (callId: N/A) |
| 27 | 5074 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 28 | 8567 | `turn:done` | turnIndex: 1 |
| 29 | 8567 | `turn:start` | turnIndex: 2 |
| 30 | 8567 | `llm:start` | |
| 31 | 8567 | `reasoning:start` | |
| 32 | 8567 | `reasoning:delta` | `\n工具返回` |
| 33 | 9483 | `reasoning:delta` | `了结果 100。42 + 58 确实等于 100。我直接告诉用户结果即可。\n` |
| 34 | 9483 | `reasoning:done` | rawContent(43字符) |
| 35 | 9483 | `text:start` | |
| 36 | 9483 | `text:delta` | `\n\n42 + 58 = **100**` |
| 37 | 9604 | `text:done` | 42 + 58 = **100** |
| 38 | 9604 | `llm:done` | tokens: in=389, out=35, total=424 |
| 39 | 9604 | `turn:done` | turnIndex: 2 |
| 40 | 9604 | `run:done` | |
| 41 | 9605 | `run:start` | |
| 42 | 17200 | `turn:start` | turnIndex: 1 |
| 43 | 17200 | `llm:start` | |
| 44 | 17201 | `reasoning:start` | |
| 45 | 17201 | `reasoning:delta` | `\n用户问我` |
| 46 | 18313 | `reasoning:delta` | `叫什么名字。根据系统提示中的信息，用户告诉我他叫小明。我需要回答用户的问题。\n` |
| 47 | 18313 | `reasoning:done` | rawContent(44字符) |
| 48 | 18313 | `text:start` | |
| 49 | 18313 | `text:delta` | `\n\n你叫**小明**呀！这是你一开始` |
| 50 | 18457 | `text:delta` | `告诉我的。😊` |
| 51 | 18462 | `text:done` | 你叫**小明**呀！这是你一开始告诉我的。😊 |
| 52 | 18462 | `llm:done` | tokens: in=386, out=38, total=424 |
| 53 | 18463 | `turn:done` | turnIndex: 1 |
| 54 | 18463 | `run:done` | |

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
