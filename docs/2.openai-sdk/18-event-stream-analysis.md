# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-11T00:53:18.622Z
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
- **耗时**: 3435ms
- **事件总数**: 13
- **模型**: `MiniMax-M2.1`
- **有推理事件**: 是（<think> 标签被拆分）

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                             |
| --- | -------- | ----------------- | -------------------------------------------------------------------- |
| 1   | 1        | `run:start`       |                                                                      |
| 2   | 2793     | `turn:start`      | turnIndex: 1                                                         |
| 3   | 2793     | `llm:start`       |                                                                      |
| 4   | 2793     | `reasoning:start` |                                                                      |
| 5   | 2793     | `reasoning:delta` | `\n用户问`                                                           |
| 6   | 3425     | `reasoning:delta` | `1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。\n` |
| 7   | 3425     | `reasoning:done`  | rawContent(39字符)                                                   |
| 8   | 3425     | `text:start`      |                                                                      |
| 9   | 3425     | `text:delta`      | `\n\n2`                                                              |
| 10  | 3433     | `text:done`       | 2                                                                    |
| 11  | 3433     | `llm:done`        | tokens: in=32, out=24, total=56                                      |
| 12  | 3436     | `turn:done`       | turnIndex: 1                                                         |
| 13  | 3436     | `run:done`        |                                                                      |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 00:53:18.629 |
| 2   | message | assistant | [多段内容]                | 00:53:22.059 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1770771198629}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。\n</think>\n\n2"}]},"ts":1770771202059}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。\n</think>\n\n2"}]
```

### 1.6 推理事件拆分分析

模型 `MiniMax-M2.1` 输出了 `<think>` 标签，ThinkTagParser 已成功拆分：

- reasoning:start 次数: 1
- reasoning:delta 次数: 2
- reasoning:done 次数: 1
- 推理全文(39字符): `用户问1+1等于几，要求用一个数字回答。这是一个简单的数学问题，答案是2。`
- text:delta 拼接: `

2`

- text:done 全文: `2`

**结论**: text:delta 和 text:done 中均不含 `<think>` 标签 ✅

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `计算结果：
  17 + 28 = 45

反转结果：
"hello" 反转后是 "olleh"`

- **耗时**: 8671ms
- **事件总数**: 32
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 是

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                    |
| --- | -------- | ----------------- | --------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                             |
| 2   | 3403     | `turn:start`      | turnIndex: 1                                                                |
| 3   | 3403     | `llm:start`       |                                                                             |
| 4   | 3403     | `reasoning:start` |                                                                             |
| 5   | 3403     | `reasoning:delta` | `\n用户明确`                                                                |
| 6   | 4127     | `reasoning:delta` | `要求计算 17 + 28 和反转 \"hello\"。这两个请求分别对应 `add_numbers` 和...` |
| 7   | 4780     | `reasoning:delta` | `。\n`                                                                      |
| 8   | 4780     | `reasoning:done`  | rawContent(91字符)                                                          |
| 9   | 4780     | `text:start`      |                                                                             |
| 10  | 4780     | `text:delta`      | `\n\n\n`                                                                    |
| 11  | 5126     | `text:done`       |                                                                             |
| 12  | 5127     | `llm:done`        | tokens: in=351, out=93, total=444                                           |
| 13  | 5127     | `tool:start`      | add_numbers (callId: N/A)                                                   |
| 14  | 5129     | `tool:start`      | reverse_string (callId: N/A)                                                |
| 15  | 5130     | `tool:done`       | {"result":45,"expression":"17 + 28 = 45"}                                   |
| 16  | 5130     | `tool:done`       | {"original":"hello","reversed":"olleh"}                                     |
| 17  | 6292     | `turn:done`       | turnIndex: 1                                                                |
| 18  | 6292     | `turn:start`      | turnIndex: 2                                                                |
| 19  | 6292     | `llm:start`       |                                                                             |
| 20  | 6292     | `reasoning:start` |                                                                             |
| 21  | 6292     | `reasoning:delta` | `\n用户要求`                                                                |
| 22  | 7186     | `reasoning:delta` | `计算 17 + 28 和反转 \"hello\"。我已经调用了 `add_numbers`和`rev...`        |
| 23  | 7693     | `reasoning:delta` | `add_numbers` 工具返回的结果，17 + 28 = 45。\n根据 `reverse_str...`         |
| 24  | 8242     | `reasoning:delta` | `是 \"olleh\"。\n\n现在我需要将这两个结果清晰地呈现给用户。\n`              |
| 25  | 8242     | `reasoning:done`  | rawContent(194字符)                                                         |
| 26  | 8242     | `text:start`      |                                                                             |
| 27  | 8242     | `text:delta`      | `\n\n计算结果：\n17 + 28 = 45\n\n反转结果：\n\"`                            |
| 28  | 8663     | `text:delta`      | `hello\" 反转后是 \"olleh\"`                                                |
| 29  | 8669     | `text:done`       | 计算结果：                                                                  |

17 + 28 = 45

反转结果：
"hello" 反转后是 "olleh" |
| 30 | 8669 | `llm:done` | tokens: in=491, out=112, total=603 |
| 31 | 8670 | `turn:done` | turnIndex: 2 |
| 32 | 8671 | `run:done` | |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 00:53:22.064 |
| 2   | message | assistant            | [多段内容]                                  | 00:53:30.733 |
| 3   | message | function_call        |                                             | 00:53:30.733 |
| 4   | message | function_call        |                                             | 00:53:30.733 |
| 5   | message | function_call_result |                                             | 00:53:30.733 |
| 6   | message | function_call_result |                                             | 00:53:30.733 |
| 7   | message | assistant            | [多段内容]                                  | 00:53:30.733 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1770771202064}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求计算 17 + 28 和反转 \"hello\"。这两个请求分别对应 `add_numbers` 和 `reverse_string` 工具。因此，我需要调用这两个工具。\n</think>\n\n\n"}]},"ts":1770771210733}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_function_fls84nnkycu1_1","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1770771210733}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_function_fls84nnkycu1_2","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1770771210733}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_fls84nnkycu1_1","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1770771210733}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_function_fls84nnkycu1_2","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1770771210733}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 17 + 28 和反转 \"hello\"。我已经调用了 `add_numbers` 和 `reverse_string` 工具来分别处理这两个请求。\n\n根据 `add_numbers` 工具返回的结果，17 + 28 = 45。\n根据 `reverse_string` 工具返回的结果，\"hello\" 反转后是 \"olleh\"。\n\n现在我需要将这两个结果清晰地呈现给用户。\n</think>\n\n计算结果：\n17 + 28 = 45\n\n反转结果：\n\"hello\" 反转后是 \"olleh\""}]},"ts":1770771210733}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户明确要求计算 17 + 28 和反转 \"hello\"。这两个请求分别对应 `add_numbers` 和 `reverse_string` 工具。因此，我需要调用这两个工具。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 17 + 28 和反转 \"hello\"。我已经调用了 `add_numbers` 和 `reverse_string` 工具来分别处理这两个请求。\n\n根据 `add_numbers` 工具返回的结果，17 + 28 = 45。\n
```

### 2.7 推理事件拆分分析

- reasoning:start/delta/done: 2/7/2
- text:delta 拼接: `

计算结果：
17 + 28 = 45

反转结果：
"hello" 反转后是 "olleh"`

- text:done: `计算结果：
  17 + 28 = 45

反转结果：
"hello" 反转后是 "olleh"`

- **结论**: 推理与正文已正确分离 ✅

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                   | Session行数 | Context消息数 |
| ---- | --------------------------- | ---------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 你好小明！我记住你了： |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？... | 2 | 2 |
| 2 | 帮我算一下 42 + 58 | 42 + 58 = **100**... | 7 | 7 |
| 3 | 我叫什么名字？ | 你叫**小明**！... | 9 | 9 |

### 3.2 Session 文件最终内容

共 9 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 00:53:30.738 |
| 2   | message | assistant            | [多段内容]                  | 00:53:34.627 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 00:53:34.629 |
| 4   | message | assistant            | [多段内容]                  | 00:53:41.730 |
| 5   | message | function_call        |                             | 00:53:41.730 |
| 6   | message | function_call_result |                             | 00:53:41.730 |
| 7   | message | assistant            | [多段内容]                  | 00:53:41.730 |
| 8   | message | user                 | 我叫什么名字？              | 00:53:41.731 |
| 9   | message | assistant            | [多段内容]                  | 00:53:48.093 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1770771210738}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我需要记住这些信息并在后续对话中准确引用。\n</think>\n\n你好小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]},"ts":1770771214627}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1770771214629}
{"seq":4,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来进行计算。\n</think>\n\n\n"}]},"ts":1770771221730}
{"seq":5,"type":"message","item":{"type":"function_call","callId":"call_function_hu2y09678231_1","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1770771221730}
{"seq":6,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_function_hu2y09678231_1","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1770771221730}
{"seq":7,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果是 100。用户最喜欢的数字是 42，42 + 58 = 100。\n</think>\n\n42 + 58 = **100**"}]},"ts":1770771221730}
{"seq":8,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1770771221731}
{"seq":9,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问他们叫什么名字。根据系统提示，用户告诉我他们叫小明。我应该准确回答这个问题。\n</think>\n\n你叫**小明**！"}]},"ts":1770771228093}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我需要记住这些信息并在后续对话中准确引用。\n</think>\n\n你好小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我需要记住这些信息并在后续对话中准确引用。\n</think>\n\n你好小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来进行计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果是 100。用户最喜欢的数字是 42，42 + 58 = 100。\n</think>\n\n42 + 58 = **100**"}]
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户告诉我他叫小明，最喜欢的数字是42。我需要记住这些信息并在后续对话中准确引用。\n</think>\n\n你好小明！我记住你了：\n- 名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？"}]
// [user] 帮我算一下 42 + 58
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户要求计算 42 + 58。我需要使用 add_numbers 工具来进行计算。\n</think>\n\n\n"}]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n计算结果是 100。用户最喜欢的数字是 42，42 + 58 = 100。\n</think>\n\n42 + 58 = **100**"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"<think>\n用户问他们叫什么名字。根据系统提示，用户告诉我他们叫小明。我应该准确回答这个问题。\n</think>\n\n你叫**小明**！"}]
```

### 3.5 完整事件流（3轮合计 54 个事件）

| #   | 时间(ms) | 事件类型          | 内容摘要                                                                   |
| --- | -------- | ----------------- | -------------------------------------------------------------------------- |
| 1   | 0        | `run:start`       |                                                                            |
| 2   | 2508     | `turn:start`      | turnIndex: 1                                                               |
| 3   | 2508     | `llm:start`       |                                                                            |
| 4   | 2509     | `reasoning:start` |                                                                            |
| 5   | 2509     | `reasoning:delta` | `\n用户告诉我`                                                             |
| 6   | 3307     | `reasoning:delta` | `他叫小明，最喜欢的数字是42。我需要记住这些信息并在后续对话中准确引用。\n` |
| 7   | 3307     | `reasoning:done`  | rawContent(43字符)                                                         |
| 8   | 3307     | `text:start`      |                                                                            |
| 9   | 3307     | `text:delta`      | `\n\n你好小明！我记住你了：\n- `                                           |
| 10  | 3882     | `text:delta`      | `名字：小明\n- 最喜欢的数字：42\n\n有什么我可以帮你的吗？`                 |
| 11  | 3889     | `text:done`       | 你好小明！我记住你了：                                                     |

- 名字：小明
- 最喜欢的数字：42

有什么我可以帮你的吗？ |
| 12 | 3889 | `llm:done` | tokens: in=249, out=51, total=300 |
| 13 | 3890 | `turn:done` | turnIndex: 1 |
| 14 | 3890 | `run:done` | |
| 15 | 3891 | `run:start` | |
| 16 | 7034 | `turn:start` | turnIndex: 1 |
| 17 | 7034 | `llm:start` | |
| 18 | 7034 | `reasoning:start` | |
| 19 | 7034 | `reasoning:delta` | `\n用户要求` |
| 20 | 7735 | `reasoning:delta` | `计算 42 + 58。我需要使用 add_numbers 工具来进行计算。\n` |
| 21 | 7735 | `reasoning:done` | rawContent(43字符) |
| 22 | 7735 | `text:start` | |
| 23 | 7735 | `text:delta` | `\n\n\n` |
| 24 | 7920 | `text:done` | |
| 25 | 7920 | `llm:done` | tokens: in=292, out=55, total=347 |
| 26 | 7921 | `tool:start` | add_numbers (callId: N/A) |
| 27 | 7921 | `tool:done` | {"result":100,"expression":"42 + 58 = 100"} |
| 28 | 10042 | `turn:done` | turnIndex: 1 |
| 29 | 10042 | `turn:start` | turnIndex: 2 |
| 30 | 10042 | `llm:start` | |
| 31 | 10043 | `reasoning:start` | |
| 32 | 10043 | `reasoning:delta` | `\n计算结果是` |
| 33 | 10867 | `reasoning:delta` | ` 100。用户最喜欢的数字是 42，42 + 58 = 100。\n` |
| 34 | 10867 | `reasoning:done` | rawContent(39字符) |
| 35 | 10867 | `text:start` | |
| 36 | 10867 | `text:delta` | `\n\n42 + 58 =` |
| 37 | 10982 | `text:delta` | ` **100**` |
| 38 | 10992 | `text:done` | 42 + 58 = **100** |
| 39 | 10992 | `llm:done` | tokens: in=383, out=31, total=414 |
| 40 | 10993 | `turn:done` | turnIndex: 2 |
| 41 | 10993 | `run:done` | |
| 42 | 10994 | `run:start` | |
| 43 | 16612 | `turn:start` | turnIndex: 1 |
| 44 | 16612 | `llm:start` | |
| 45 | 16612 | `reasoning:start` | |
| 46 | 16612 | `reasoning:delta` | `\n用户问` |
| 47 | 17347 | `reasoning:delta` | `他们叫什么名字。根据系统提示，用户告诉我他们叫小明。我应该准确回答这个问题。\n` |
| 48 | 17347 | `reasoning:done` | rawContent(43字符) |
| 49 | 17347 | `text:start` | |
| 50 | 17347 | `text:delta` | `\n\n你叫**小明**！` |
| 51 | 17355 | `text:done` | 你叫**小明**！ |
| 52 | 17355 | `llm:done` | tokens: in=383, out=29, total=412 |
| 53 | 17357 | `turn:done` | turnIndex: 1 |
| 54 | 17357 | `run:done` | |

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
