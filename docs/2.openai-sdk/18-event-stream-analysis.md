# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-14T11:22:32.420Z
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
- **耗时**: 1297ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                           |
| --- | -------- | ----------------- | ------------------------------------------------------------------ |
| 1   | 1        | `run:start`       |                                                                    |
| 2   | 808      | `turn:start`      | turnIndex: 1                                                       |
| 3   | 808      | `llm:start`       |                                                                    |
| 4   | 809      | `reasoning:start` |                                                                    |
| 5   | 809      | `reasoning:delta` | `\n用户问`                                                         |
| 6   | 1285     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。\n` |
| 7   | 1285     | `reasoning:done`  | rawContent(40字符)                                                 |
| 8   | 1285     | `text:start`      |                                                                    |
| 9   | 1285     | `text:delta`      | `\n\n2`                                                            |
| 10  | 1297     | `text:done`       | 2                                                                  |
| 11  | 1297     | `llm:done`        | tokens: in=32, out=27, total=59                                    |
| 12  | 1298     | `turn:done`       | turnIndex: 1                                                       |
| 13  | 1298     | `run:done`        |                                                                    |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 11:22:32.429 |
| 2   | message | assistant | [多段内容]                | 11:22:33.721 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1771068152429}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，1+1=2。\n</think>\n\n2"}]},"ts":1771068153721}
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
- **输出**: `计算结果如下：

**加法运算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- **耗时**: 5623ms
- **事件总数**: 31
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                |
| --- | -------- | ----------------- | --------------------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                                         |
| 2   | 2751     | `turn:start`      | turnIndex: 1                                                                            |
| 3   | 2751     | `llm:start`       |                                                                                         |
| 4   | 2752     | `reasoning:start` |                                                                                         |
| 5   | 2752     | `reasoning:delta` | `\n用户要求`                                                                            |
| 6   | 3318     | `reasoning:delta` | `计算 17 + 28 和反转 \"hello\" 这个字符串。我有两个工具可以完成这些任务：add_nu...`     |
| 7   | 3679     | `reasoning:delta` | `工具。\n`                                                                              |
| 8   | 3679     | `reasoning:done`  | rawContent(92字符)                                                                      |
| 9   | 3679     | `text:start`      |                                                                                         |
| 10  | 3679     | `text:delta`      | `\n\n\n`                                                                                |
| 11  | 3958     | `text:done`       |                                                                                         |
| 12  | 3959     | `llm:done`        | tokens: in=351, out=92, total=443                                                       |
| 13  | 3959     | `tool:start`      | add_numbers (callId: N/A)                                                               |
| 14  | 3959     | `tool:start`      | reverse_string (callId: N/A)                                                            |
| 15  | 3959     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                               |
| 16  | 3960     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                                 |
| 17  | 4809     | `turn:done`       | turnIndex: 1                                                                            |
| 18  | 4809     | `turn:start`      | turnIndex: 2                                                                            |
| 19  | 4809     | `llm:start`       |                                                                                         |
| 20  | 4809     | `reasoning:start` |                                                                                         |
| 21  | 4809     | `reasoning:delta` | `\n好的，我已经`                                                                        |
| 22  | 5183     | `reasoning:delta` | `成功调用了两个工具。现在让我整理结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转...` |
| 23  | 5450     | `reasoning:delta` | `hello\" 反转为 \"olleh\"\n\n现在我可以用这些结果来回答用户的问题。\n`                  |
| 24  | 5450     | `reasoning:done`  | rawContent(99字符)                                                                      |
| 25  | 5450     | `text:start`      |                                                                                         |
| 26  | 5450     | `text:delta`      | `\n\n计算结果如下：\n\n**加法运算：** 17 + 28 = 45`                                     |
| 27  | 5614     | `text:delta`      | `\n\n**字符串反转：** \"hello\" 反转为 \"olleh\"`                                       |
| 28  | 5621     | `text:done`       | 计算结果如下：                                                                          |

**加法运算：** 17 + 28 = 45

**字符串反转：** "hello... |
| 29 | 5622 | `llm:done` | tokens: in=490, out=84, total=574 |
| 30 | 5623 | `turn:done` | turnIndex: 2 |
| 31 | 5623 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 11:22:33.724 |
| 2   | message | assistant            | [多段内容]                                  | 11:22:39.345 |
| 3   | message | function_call        |                                             | 11:22:39.345 |
| 4   | message | function_call        |                                             | 11:22:39.345 |
| 5   | message | function_call_result |                                             | 11:22:39.345 |
| 6   | message | function_call_result |                                             | 11:22:39.345 |
| 7   | message | assistant            | [多段内容]                                  | 11:22:39.345 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1771068153724}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 17 + 28 和反转 \"hello\" 这个字符串。我有两个工具可以完成这些任务：add_numbers 和 reverse_string。我应该分别调用这两个工具。\n</think>\n\n\n"}]},"ts":1771068159345}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_m849h3kvfyt1_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1771068159345}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_m849h3kvfyt1_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1771068159345}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_m849h3kvfyt1_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1771068159345}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_m849h3kvfyt1_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1771068159345}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经成功调用了两个工具。现在让我整理结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n现在我可以用这些结果来回答用户的问题。\n</think>\n\n计算结果如下：\n\n**加法运算：** 17 + 28 = 45\n\n**字符串反转：** \"hello\" 反转为 \"olleh\""}]},"ts":1771068159345}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 17 + 28 和反转 \"hello\" 这个字符串。我有两个工具可以完成这些任务：add_numbers 和 reverse_string。我应该分别调用这两个工具。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经成功调用了两个工具。现在让我整理结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n现在我可以用这些结果来回答用户的问题。\n</think>\n\n计算结果如下
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/6/2
- text:delta 拼接: `

计算结果如下：

**加法运算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- text:done: `计算结果如下：

**加法运算：** 17 + 28 = 45

**字符串反转：** "hello" 反转为 "olleh"`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                   | Session行数 | Context消息数 |
| ---- | --------------------------- | ---------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好，小明！我记住了： |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = 100... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫小明。... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 11:22:39.352 |
| 2   | message | assistant            | [多段内容]                  | 11:22:41.170 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 11:22:41.173 |
| 4   | message | assistant            | [多段内容]                  | 11:22:57.443 |
| 5   | message | function_call        |                             | 11:22:57.443 |
| 6   | message | function_call_result |                             | 11:22:57.443 |
| 7   | message | assistant            | [多段内容]                  | 11:22:57.443 |
| 8   | message | user                 | 我叫什么名字？              | 11:22:57.444 |
| 9   | message | assistant            | [多段内容]                  | 11:22:58.858 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1771068159352}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字叫小明，最喜欢的数字是 42。我需要记住这些信息以便在后续对话中准确引用。\n\n我应该简短地确认我记住了这些信息。\n</think>\n\n你好，小明！我记住了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]},"ts":1771068161170}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1771068161173}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n\n参数：\n- a: 42\n- b: 58\n</think>\n\n\n"}]},"ts":1771068177443}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_l75e86o85mqs_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1771068177443}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_l75e86o85mqs_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1771068177443}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，add_numbers 工具返回了结果：42 + 58 = 100。我应该告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]},"ts":1771068177443}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1771068177444}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示，我被告知用户叫小明。我应该回答他。\n</think>\n\n你叫小明。"}]},"ts":1771068178858}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字叫小明，最喜欢的数字是 42。我需要记住这些信息以便在后续对话中准确引用。\n\n我应该简短地确认我记住了这些信息。\n</think>\n\n你好，小明！我记住了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字叫小明，最喜欢的数字是 42。我需要记住这些信息以便在后续对话中准确引用。\n\n我应该简短地确认我记住了这些信息。\n</think>\n\n你好，小明！我记住了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n\n参数：\n- a: 42\n- b: 58\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，add_numbers 工具返回了结果：42 + 58 = 100。我应该告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字叫小明，最喜欢的数字是 42。我需要记住这些信息以便在后续对话中准确引用。\n\n我应该简短地确认我记住了这些信息。\n</think>\n\n你好，小明！我记住了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算。\n\n参数：\n- a: 42\n- b: 58\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，add_numbers 工具返回了结果：42 + 58 = 100。我应该告诉用户这个结果。\n</think>\n\n42 + 58 = 100"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问我叫什么名字。根据系统提示，我被告知用户叫小明。我应该回答他。\n</think>\n\n你叫小明。"}]
```

### 3.5 完整事件流（3轮合计 56 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                               |
| --- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 0        | `run:start`       |                                                                                                        |
| 2   | 1005     | `turn:start`      | turnIndex: 1                                                                                           |
| 3   | 1005     | `llm:start`       |                                                                                                        |
| 4   | 1005     | `reasoning:start` |                                                                                                        |
| 5   | 1005     | `reasoning:delta` | `\n用户告诉我`                                                                                         |
| 6   | 1379     | `reasoning:delta` | `他的名字叫小明，最喜欢的数字是 42。我需要记住这些信息以便在后续对话中准确引用。\n\n我应该简短地确...` |
| 7   | 1661     | `reasoning:delta` | `我记住了这些信息。\n`                                                                                 |
| 8   | 1661     | `reasoning:done`  | rawContent(67字符)                                                                                     |
| 9   | 1661     | `text:start`      |                                                                                                        |
| 10  | 1661     | `text:delta`      | `\n\n你好，小明！我记住了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮`                       |
| 11  | 1811     | `text:delta`      | `你的吗？`                                                                                             |
| 12  | 1820     | `text:done`       | 你好，小明！我记住了：                                                                                 |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？ |
| 13 | 1820 | `llm:done` | tokens: in=249, out=64, total=313 |
| 14 | 1821 | `turn:done` | turnIndex: 1 |
| 15 | 1821 | `run:done` | |
| 16 | 1822 | `run:start` | |
| 17 | 15549 | `turn:start` | turnIndex: 1 |
| 18 | 15549 | `llm:start` | |
| 19 | 15550 | `reasoning:start` | |
| 20 | 15550 | `reasoning:delta` | `\n用户要求` |
| 21 | 16275 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来计算。\n\n参数：\n- a: 42\n-...` |
| 22 | 16275 | `reasoning:done` | rawContent(62字符) |
| 23 | 16275 | `text:start` | |
| 24 | 16275 | `text:delta` | `\n\n\n` |
| 25 | 16751 | `text:done` | |
| 26 | 16752 | `llm:done` | tokens: in=292, out=69, total=361 |
| 27 | 16752 | `tool:start` | add_numbers (callId: N/A) |
| 28 | 16752 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 29 | 17486 | `turn:done` | turnIndex: 1 |
| 30 | 17486 | `turn:start` | turnIndex: 2 |
| 31 | 17486 | `llm:start` | |
| 32 | 17486 | `reasoning:start` | |
| 33 | 17486 | `reasoning:delta` | `\n好的，` |
| 34 | 17945 | `reasoning:delta` | `add_numbers 工具返回了结果：42 + 58 = 100。我应该告诉用户这个结果。\n` |
| 35 | 17945 | `reasoning:done` | rawContent(51字符) |
| 36 | 17945 | `text:start` | |
| 37 | 17945 | `text:delta` | `\n\n42 + 58 =` |
| 38 | 18083 | `text:delta` | ` 100` |
| 39 | 18092 | `text:done` | 42 + 58 = 100 |
| 40 | 18092 | `llm:done` | tokens: in=397, out=35, total=432 |
| 41 | 18093 | `turn:done` | turnIndex: 2 |
| 42 | 18093 | `run:done` | |
| 43 | 18094 | `run:start` | |
| 44 | 18964 | `turn:start` | turnIndex: 1 |
| 45 | 18964 | `llm:start` | |
| 46 | 18964 | `reasoning:start` | |
| 47 | 18964 | `reasoning:delta` | `\n用户问我` |
| 48 | 19365 | `reasoning:delta` | `叫什么名字。根据系统提示，我被告知用户叫小明。我应该回答他。\n` |
| 49 | 19365 | `reasoning:done` | rawContent(36字符) |
| 50 | 19365 | `text:start` | |
| 51 | 19365 | `text:delta` | `\n\n你` |
| 52 | 19496 | `text:delta` | `叫小明。` |
| 53 | 19507 | `text:done` | 你叫小明。 |
| 54 | 19507 | `llm:done` | tokens: in=382, out=26, total=408 |
| 55 | 19508 | `turn:done` | turnIndex: 1 |
| 56 | 19508 | `run:done` | |

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
