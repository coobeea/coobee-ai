# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-14T14:27:48.648Z
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
- **耗时**: 1131ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                |
| --- | -------- | ----------------- | ------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                         |
| 2   | 718      | `turn:start`      | turnIndex: 1                                            |
| 3   | 718      | `llm:start`       |                                                         |
| 4   | 719      | `reasoning:start` |                                                         |
| 5   | 719      | `reasoning:delta` | `\n用户问`                                              |
| 6   | 1121     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。1+1=2，所以答案是2。\n` |
| 7   | 1121     | `reasoning:done`  | rawContent(35字符)                                      |
| 8   | 1121     | `text:start`      |                                                         |
| 9   | 1121     | `text:delta`      | `\n\n2`                                                 |
| 10  | 1131     | `text:done`       | 2                                                       |
| 11  | 1131     | `llm:done`        | tokens: in=32, out=26, total=58                         |
| 12  | 1132     | `turn:done`       | turnIndex: 1                                            |
| 13  | 1132     | `run:done`        |                                                         |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 14:27:48.658 |
| 2   | message | assistant | [多段内容]                | 14:27:49.783 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1771079268658}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。1+1=2，所以答案是2。\n</think>\n\n2"}]},"ts":1771079269783}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。1+1=2，所以答案是2。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(35字符): `用户问1+1等于几，要求用一个数字回答。1+1=2，所以答案是2。`
- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果如下：

1. **加法计算**：17 + 28 = **45**
2. **字符串反转**： "hello" 反转为 **"olleh"**

两个操作都已完成！`

- **耗时**: 27475ms
- **事件总数**: 31
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                    |
| --- | -------- | ----------------- | ------------------------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                                             |
| 2   | 22605    | `turn:start`      | turnIndex: 1                                                                                |
| 3   | 22605    | `llm:start`       |                                                                                             |
| 4   | 22606    | `reasoning:start` |                                                                                             |
| 5   | 22606    | `reasoning:delta` | `\n用户明确`                                                                                |
| 6   | 23487    | `reasoning:delta` | `要求进行两项操作：一是计算加法 17 + 28，二是反转字符串 \"hello\"。我需要调用两个工具来...` |
| 7   | 24130    | `reasoning:delta` | `任务。\n`                                                                                  |
| 8   | 24130    | `reasoning:done`  | rawContent(66字符)                                                                          |
| 9   | 24130    | `text:start`      |                                                                                             |
| 10  | 24130    | `text:delta`      | `\n\n\n`                                                                                    |
| 11  | 24407    | `text:done`       |                                                                                             |
| 12  | 24408    | `llm:done`        | tokens: in=351, out=89, total=440                                                           |
| 13  | 24408    | `tool:start`      | add_numbers (callId: N/A)                                                                   |
| 14  | 24409    | `tool:start`      | reverse_string (callId: N/A)                                                                |
| 15  | 24409    | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                                   |
| 16  | 24410    | `tool:done`       | {"original":"hello","reversed":"olleh"}                                                     |
| 17  | 25930    | `turn:done`       | turnIndex: 1                                                                                |
| 18  | 25930    | `turn:start`      | turnIndex: 2                                                                                |
| 19  | 25930    | `llm:start`       |                                                                                             |
| 20  | 25930    | `reasoning:start` |                                                                                             |
| 21  | 25930    | `reasoning:delta` | `\n好的，我已经`                                                                            |
| 22  | 26621    | `reasoning:delta` | `调用了两个工具并收到了结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hel...`        |
| 23  | 27045    | `reasoning:delta` | `转为 \"olleh\"\n\n现在我可以直接向用户展示这两个结果。\n`                                  |
| 24  | 27045    | `reasoning:done`  | rawContent(93字符)                                                                          |
| 25  | 27045    | `text:start`      |                                                                                             |
| 26  | 27045    | `text:delta`      | `\n\n计算结果如下：\n\n1. **加法计算**：17 + 28 = **`                                       |
| 27  | 27460    | `text:delta`      | `45**\n2. **字符串反转**： \"hello\" 反转为 **\"olleh\"**\n\n两个操作都已...`               |
| 28  | 27473    | `text:done`       | 计算结果如下：                                                                              |

1. **加法计算**：17 + 28 = **45**
2. **字符串反转**... |
   | 29 | 27473 | `llm:done` | tokens: in=487, out=91, total=578 |
   | 30 | 27475 | `turn:done` | turnIndex: 2 |
   | 31 | 27475 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 14:27:49.788 |
| 2   | message | assistant            | [多段内容]                                  | 14:28:17.262 |
| 3   | message | function_call        |                                             | 14:28:17.262 |
| 4   | message | function_call        |                                             | 14:28:17.262 |
| 5   | message | function_call_result |                                             | 14:28:17.262 |
| 6   | message | function_call_result |                                             | 14:28:17.262 |
| 7   | message | assistant            | [多段内容]                                  | 14:28:17.262 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1771079269788}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两项操作：一是计算加法 17 + 28，二是反转字符串 \"hello\"。我需要调用两个工具来分别完成这两个任务。\n</think>\n\n\n"}]},"ts":1771079297262}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_3donuqszwe7j_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1771079297262}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_3donuqszwe7j_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1771079297262}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_3donuqszwe7j_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1771079297262}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_3donuqszwe7j_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1771079297262}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经调用了两个工具并收到了结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n现在我可以直接向用户展示这两个结果。\n</think>\n\n计算结果如下：\n\n1. **加法计算**：17 + 28 = **45**\n2. **字符串反转**： \"hello\" 反转为 **\"olleh\"**\n\n两个操作都已完成！"}]},"ts":1771079297262}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求进行两项操作：一是计算加法 17 + 28，二是反转字符串 \"hello\"。我需要调用两个工具来分别完成这两个任务。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n好的，我已经调用了两个工具并收到了结果：\n\n1. 加法计算：17 + 28 = 45\n2. 字符串反转：\"hello\" 反转为 \"olleh\"\n\n现在我可以直接向用户展示这两个结果。\n</think>\n\n计算结果如下：\n\n1
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/6/2
- text:delta 拼接: `

计算结果如下：

1. **加法计算**：17 + 28 = **45**
2. **字符串反转**： "hello" 反转为 **"olleh"**

两个操作都已完成！`

- text:done: `计算结果如下：

1. **加法计算**：17 + 28 = **45**
2. **字符串反转**： "hello" 反转为 **"olleh"**

两个操作都已完成！`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                     | Session行数 | Context消息数 |
| ---- | --------------------------- | ------------------------ | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好，小明！我记住你了： |

- 名字：小明
- 最喜欢的数字：42

这个数字在《银河系漫游指南》中是"生命、宇宙以及一切... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = 100，正好是整数！计算完成，小明。... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫小明呀！我之前记住的：

- 名字：小明
- 最喜欢的数字：42... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 14:28:17.278 |
| 2   | message | assistant            | [多段内容]                  | 14:28:19.609 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 14:28:19.613 |
| 4   | message | assistant            | [多段内容]                  | 14:28:22.681 |
| 5   | message | function_call        |                             | 14:28:22.681 |
| 6   | message | function_call_result |                             | 14:28:22.681 |
| 7   | message | assistant            | [多段内容]                  | 14:28:22.681 |
| 8   | message | user                 | 我叫什么名字？              | 14:28:22.685 |
| 9   | message | assistant            | [多段内容]                  | 14:28:24.546 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1771079297278}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n\n这是一个简单的自我介绍，不需要调用任何工具。我只需要确认并记住这些信息。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n这个数字在《银河系漫游指南》中是\"生命、宇宙以及一切终极问题的答案\"，很有意思的选择！有什么我可以帮你的吗？"}]},"ts":1771079299609}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1771079299613}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]},"ts":1771079302681}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_i53hvjhn4j8o_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1771079302681}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_i53hvjhn4j8o_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1771079302681}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n结果是 100。这个计算对用户来说很简单，而且正好是 42 + 58 = 100，这是一个整数结果。\n</think>\n\n42 + 58 = 100，正好是整数！计算完成，小明。"}]},"ts":1771079302681}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1771079302685}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问他们叫什么名字。根据系统提示，用户告诉我他们叫小明，最喜欢的数字是42。我需要在后续对话中准确引用这些信息。\n</think>\n\n你叫小明呀！我之前记住的：\n- 名字：小明\n- 最喜欢的数字：42"}]},"ts":1771079304546}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n\n这是一个简单的自我介绍，不需要调用任何工具。我只需要确认并记住这些信息。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n\n这是一个简单的自我介绍，不需要调用任何工具。我只需要确认并记住这些信息。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n结果是 100。这个计算对用户来说很简单，而且正好是 42 + 58 = 100，这是一个整数结果。\n</think>\n\n42 + 58 = 100，正好是整数！计算完成，小明。"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他的名字是小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n\n这是一个简单的自我介绍，不需要调用任何工具。我只需要确认并记住这些信息。\n</think>\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n结果是 100。这个计算对用户来说很简单，而且正好是 42 + 58 = 100，这是一个整数结果。\n</think>\n\n42 + 58 = 100，正好是整数！计算完成，小明。"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问他们叫什么名字。根据系统提示，用户告诉我他们叫小明，最喜欢的数字是42。我需要在后续对话中准确引用这些信息。\n</think>\n\n你叫小明呀！我之前记住的：\n- 名字：小明\n- 最喜欢的数字：42"}]
```

### 3.5 完整事件流（3轮合计 57 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                                                |
| --- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                                                         |
| 2   | 838      | `turn:start`      | turnIndex: 1                                                                                            |
| 3   | 838      | `llm:start`       |                                                                                                         |
| 4   | 838      | `reasoning:start` |                                                                                                         |
| 5   | 838      | `reasoning:delta` | `\n用户告诉我`                                                                                          |
| 6   | 1346     | `reasoning:delta` | `他的名字是小明，最喜欢的数字是42。我应该记住这个信息，并在后续对话中准确引用。\n\n这是一个简单的自...` |
| 7   | 1729     | `reasoning:delta` | `工具。我只需要确认并记住这些信息。\n`                                                                  |
| 8   | 1729     | `reasoning:done`  | rawContent(85字符)                                                                                      |
| 9   | 1729     | `text:start`      |                                                                                                         |
| 10  | 1729     | `text:delta`      | `\n\n你好，小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42`                                        |
| 11  | 2169     | `text:delta`      | `\n\n这个数字在《银河系漫游指南》中是\"生命、宇宙以及一切终极问题的答案\"，很有意思的选择`              |
| 12  | 2327     | `text:delta`      | `！有什么我可以帮你的吗？`                                                                              |
| 13  | 2334     | `text:done`       | 你好，小明！我记住你了：                                                                                |

- 名字：小明
- 最喜欢的数字：42

这个数字在《银河系漫游指南》中是... |
| 14 | 2334 | `llm:done` | tokens: in=249, out=90, total=339 |
| 15 | 2336 | `turn:done` | turnIndex: 1 |
| 16 | 2336 | `run:done` | |
| 17 | 2338 | `run:start` | |
| 18 | 3263 | `turn:start` | turnIndex: 1 |
| 19 | 3263 | `llm:start` | |
| 20 | 3263 | `reasoning:start` | |
| 21 | 3263 | `reasoning:delta` | `\n用户要求` |
| 22 | 3660 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来计算这个加法。\n` |
| 23 | 3660 | `reasoning:done` | rawContent(45字符) |
| 24 | 3660 | `text:start` | |
| 25 | 3660 | `text:delta` | `\n\n\n` |
| 26 | 4020 | `text:done` | |
| 27 | 4020 | `llm:done` | tokens: in=315, out=58, total=373 |
| 28 | 4020 | `tool:start` | add_numbers (callId: N/A) |
| 29 | 4020 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 30 | 4762 | `turn:done` | turnIndex: 1 |
| 31 | 4762 | `turn:start` | turnIndex: 2 |
| 32 | 4762 | `llm:start` | |
| 33 | 4763 | `reasoning:start` | |
| 34 | 4763 | `reasoning:delta` | `\n结果是 ` |
| 35 | 5145 | `reasoning:delta` | `100。这个计算对用户来说很简单，而且正好是 42 + 58 = 100，这是一个整数结果。\n` |
| 36 | 5145 | `reasoning:done` | rawContent(52字符) |
| 37 | 5145 | `text:start` | |
| 38 | 5145 | `text:delta` | `\n\n42` |
| 39 | 5393 | `text:delta` | ` + 58 = 100，正好是整数！计算完成，小明。` |
| 40 | 5407 | `text:done` | 42 + 58 = 100，正好是整数！计算完成，小明。 |
| 41 | 5407 | `llm:done` | tokens: in=409, out=44, total=453 |
| 42 | 5408 | `turn:done` | turnIndex: 2 |
| 43 | 5408 | `run:done` | |
| 44 | 5409 | `run:start` | |
| 45 | 6387 | `turn:start` | turnIndex: 1 |
| 46 | 6387 | `llm:start` | |
| 47 | 6387 | `reasoning:start` | |
| 48 | 6387 | `reasoning:delta` | `\n用户问` |
| 49 | 6994 | `reasoning:delta` | `他们叫什么名字。根据系统提示，用户告诉我他们叫小明，最喜欢的数字是42。我需要在后续对话中准确引用这...` |
| 50 | 6994 | `reasoning:done` | rawContent(59字符) |
| 51 | 6994 | `text:start` | |
| 52 | 6994 | `text:delta` | `\n\n你叫小明` |
| 53 | 7262 | `text:delta` | `呀！我之前记住的：\n- 名字：小明\n- 最喜欢的数字：42` |
| 54 | 7271 | `text:done` | 你叫小明呀！我之前记住的：

- 名字：小明
- 最喜欢的数字：42 |
  | 55 | 7271 | `llm:done` | tokens: in=414, out=53, total=467 |
  | 56 | 7272 | `turn:done` | turnIndex: 1 |
  | 57 | 7272 | `run:done` | |

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
