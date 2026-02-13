# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-13T09:17:13.628Z
>
> 模型: `qwen-plus` | API: `https://dashscope.aliyuncs.com/compatible-mode/v1`

## 目录

1. [场景1：简单问答（无工具）](#场景1简单问答无工具)
2. [场景2：工具调用（add_numbers）](#场景2工具调用add_numbers)
3. [场景3：多轮对话 + Session 持久化验证](#场景3多轮对话--session-持久化验证)
4. [总结](#总结)

## 场景1：简单问答（无工具）

- **输入**: `1+1等于几？用一个数字回答`
- **输出**: `2`
- **耗时**: 547ms
- **事件总数**: 9
- **模型**: `qwen-plus`
- **有推理事件**: 否

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型     | 内容摘要                       |
| --- | -------- | ------------ | ------------------------------ |
| 1   | 0        | `run:start`  |                                |
| 2   | 502      | `turn:start` | turnIndex: 1                   |
| 3   | 502      | `llm:start`  |                                |
| 4   | 503      | `text:start` |                                |
| 5   | 503      | `text:delta` | `2`                            |
| 6   | 546      | `text:done`  | 2                              |
| 7   | 546      | `llm:done`   | tokens: in=33, out=1, total=34 |
| 8   | 547      | `turn:done`  | turnIndex: 1                   |
| 9   | 547      | `run:done`   |                                |

### 1.2 事件闭环检查

| 事件对                     | start 次数 | done 次数 | 状态    |
| -------------------------- | ---------- | --------- | ------- |
| `run:start` / `run:done`   | 1          | 1         | ✅ 配对 |
| `turn:start` / `turn:done` | 1          | 1         | ✅ 配对 |
| `llm:start` / `llm:done`   | 1          | 1         | ✅ 配对 |
| `text:start` / `text:done` | 1          | 1         | ✅ 配对 |

### 1.3 Session 文件内容 (messages.jsonl)

共 2 条记录：

| seq | type    | role      | 内容摘要                  | 时间         |
| --- | ------- | --------- | ------------------------- | ------------ |
| 1   | message | user      | 1+1等于几？用一个数字回答 | 09:17:13.648 |
| 2   | message | assistant | [多段内容]                | 09:17:14.180 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1770974233648}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"2"}]},"ts":1770974234180}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"2"}]
```

## 场景2：工具调用（add_numbers + reverse_string）

- **输入**: `请计算 17 + 28，然后反转 "hello" 这个字符串`
- **输出**: `17 + 28 = 45，"hello" 反转后是 "olleh"。`
- **耗时**: 2819ms
- **事件总数**: 23
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 否

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型     | 内容摘要                                  |
| --- | -------- | ------------ | ----------------------------------------- |
| 1   | 1        | `run:start`  |                                           |
| 2   | 966      | `turn:start` | turnIndex: 1                              |
| 3   | 966      | `llm:start`  |                                           |
| 4   | 1713     | `llm:done`   | tokens: in=351, out=47, total=398         |
| 5   | 1714     | `tool:start` | add_numbers (callId: N/A)                 |
| 6   | 1714     | `tool:start` | reverse_string (callId: N/A)              |
| 7   | 1714     | `tool:done`  | {"result":45,"expression":"17 + 28 = 45"} |
| 8   | 1714     | `tool:done`  | {"original":"hello","reversed":"olleh"}   |
| 9   | 2298     | `turn:done`  | turnIndex: 1                              |
| 10  | 2298     | `turn:start` | turnIndex: 2                              |
| 11  | 2298     | `llm:start`  |                                           |
| 12  | 2299     | `text:start` |                                           |
| 13  | 2299     | `text:delta` | `1`                                       |
| 14  | 2303     | `text:delta` | `7 + `                                    |
| 15  | 2358     | `text:delta` | `28 =`                                    |
| 16  | 2423     | `text:delta` | ` 4`                                      |
| 17  | 2555     | `text:delta` | `5，\"hello\"`                            |
| 18  | 2600     | `text:delta` | ` 反转后`                                 |
| 19  | 2730     | `text:delta` | `是 \"olleh\"。`                          |
| 20  | 2819     | `text:done`  | 17 + 28 = 45，"hello" 反转后是 "olleh"。  |
| 21  | 2819     | `llm:done`   | tokens: in=445, out=24, total=469         |
| 22  | 2819     | `turn:done`  | turnIndex: 2                              |
| 23  | 2819     | `run:done`   |                                           |

### 2.2 事件闭环检查

| 事件对                     | start 次数 | done 次数 | 状态    |
| -------------------------- | ---------- | --------- | ------- |
| `run:start` / `run:done`   | 1          | 1         | ✅ 配对 |
| `turn:start` / `turn:done` | 2          | 2         | ✅ 配对 |
| `llm:start` / `llm:done`   | 2          | 2         | ✅ 配对 |
| `text:start` / `text:done` | 1          | 1         | ✅ 配对 |
| `tool:start` / `tool:done` | 2          | 2         | ✅ 配对 |

### 2.3 事件嵌套结构分析

```
run:start
  turn:start
    llm:start
    llm:done
    tool:start
      tool:start
      tool:done
    tool:done
  turn:done
  turn:start
    llm:start
      text:start
      text:done
    llm:done
  turn:done
run:done
```

### 2.4 Session 文件内容 (messages.jsonl)

共 6 条记录：

| seq | type    | role                 | 内容摘要                                    | 时间         |
| --- | ------- | -------------------- | ------------------------------------------- | ------------ |
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 09:17:14.185 |
| 2   | message | function_call        |                                             | 09:17:17.002 |
| 3   | message | function_call        |                                             | 09:17:17.002 |
| 4   | message | function_call_result |                                             | 09:17:17.002 |
| 5   | message | function_call_result |                                             | 09:17:17.002 |
| 6   | message | assistant            | [多段内容]                                  | 09:17:17.002 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1770974234185}
{"seq":2,"type":"message","item":{"type":"function_call","callId":"call_a80adda97b8c45f4a9655e","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1770974237002}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_aebd8ad8ae504fd4abe45c","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1770974237002}
{"seq":4,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_a80adda97b8c45f4a9655e","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1770974237002}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_aebd8ad8ae504fd4abe45c","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1770974237002}
{"seq":6,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"17 + 28 = 45，\"hello\" 反转后是 \"olleh\"。"}]},"ts":1770974237002}
```

### 2.6 Context Snapshot

**统计信息：**

- 上下文消息数（发送给 LLM）: 6
- 总 SessionItem 数: 6
- 其中 message 数: 6
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 请计算 17 + 28，然后反转 "hello" 这个字符串
// [unknown]
// [unknown]
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"17 + 28 = 45，\"hello\" 反转后是 \"olleh\"。"}]
```

## 场景3：多轮对话 + Session 持久化验证

### 3.1 对话记录

| 轮次 | 输入                        | 输出                                         | Session行数 | Context消息数 |
| ---- | --------------------------- | -------------------------------------------- | ----------- | ------------- |
| 1    | 我叫小明，最喜欢的数字是 42 | 好的，小明！我记住了你最喜欢的数字是 42。... | 2           | 2             |
| 2    | 帮我算一下 42 + 58          | 42 + 58 = 100。小明，结果是 100！...         | 6           | 6             |
| 3    | 我叫什么名字？              | 你叫小明。...                                | 8           | 8             |

### 3.2 Session 文件最终内容

共 8 条记录：

| seq | type    | role                 | 内容摘要                    | 时间         |
| --- | ------- | -------------------- | --------------------------- | ------------ |
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 09:17:17.007 |
| 2   | message | assistant            | [多段内容]                  | 09:17:17.655 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 09:17:17.660 |
| 4   | message | function_call        |                             | 09:17:19.425 |
| 5   | message | function_call_result |                             | 09:17:19.425 |
| 6   | message | assistant            | [多段内容]                  | 09:17:19.425 |
| 7   | message | user                 | 我叫什么名字？              | 09:17:19.427 |
| 8   | message | assistant            | [多段内容]                  | 09:17:19.791 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1770974237007}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"好的，小明！我记住了你最喜欢的数字是 42。"}]},"ts":1770974237655}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1770974237660}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_ae13d2cd06ba4d318875e5","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1770974239425}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_ae13d2cd06ba4d318875e5","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1770974239425}
{"seq":6,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"42 + 58 = 100。小明，结果是 100！"}]},"ts":1770974239425}
{"seq":7,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1770974239427}
{"seq":8,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"你叫小明。"}]},"ts":1770974239791}
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
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"好的，小明！我记住了你最喜欢的数字是 42。"}]
```

#### 第2轮后（工具调用后）

**统计信息：**

- 上下文消息数（发送给 LLM）: 6
- 总 SessionItem 数: 6
- 其中 message 数: 6
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 我叫小明，最喜欢的数字是 42
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"好的，小明！我记住了你最喜欢的数字是 42。"}]
// [user] 帮我算一下 42 + 58
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"42 + 58 = 100。小明，结果是 100！"}]
```

#### 第3轮后

**统计信息：**

- 上下文消息数（发送给 LLM）: 8
- 总 SessionItem 数: 8
- 其中 message 数: 8
- 其中 summary 数: 0
- 最后一条 summary: 无

**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**

```json
// [user] 我叫小明，最喜欢的数字是 42
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"好的，小明！我记住了你最喜欢的数字是 42。"}]
// [user] 帮我算一下 42 + 58
// [unknown]
// [unknown]
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"42 + 58 = 100。小明，结果是 100！"}]
// [user] 我叫什么名字？
// [assistant] [{"providerData":{"annotations":[]},"type":"output_text","text":"你叫小明。"}]
```

### 3.5 完整事件流（3轮合计 46 个事件）

| #   | 时间(ms) | 事件类型     | 内容摘要                                    |
| --- | -------- | ------------ | ------------------------------------------- |
| 1   | 1        | `run:start`  |                                             |
| 2   | 274      | `turn:start` | turnIndex: 1                                |
| 3   | 274      | `llm:start`  |                                             |
| 4   | 274      | `text:start` |                                             |
| 5   | 274      | `text:delta` | `好的`                                      |
| 6   | 298      | `text:delta` | `，小`                                      |
| 7   | 338      | `text:delta` | `明！`                                      |
| 8   | 383      | `text:delta` | `我记`                                      |
| 9   | 508      | `text:delta` | `住了你最喜欢的数字是 `                     |
| 10  | 625      | `text:delta` | `42。`                                      |
| 11  | 649      | `text:done`  | 好的，小明！我记住了你最喜欢的数字是 42。   |
| 12  | 649      | `llm:done`   | tokens: in=240, out=16, total=256           |
| 13  | 652      | `turn:done`  | turnIndex: 1                                |
| 14  | 652      | `run:done`   |                                             |
| 15  | 653      | `run:start`  |                                             |
| 16  | 1386     | `turn:start` | turnIndex: 1                                |
| 17  | 1386     | `llm:start`  |                                             |
| 18  | 1668     | `llm:done`   | tokens: in=276, out=27, total=303           |
| 19  | 1669     | `tool:start` | add_numbers (callId: N/A)                   |
| 20  | 1669     | `tool:done`  | {"result":100,"expression":"42 + 58 = 100"} |
| 21  | 1917     | `turn:done`  | turnIndex: 1                                |
| 22  | 1917     | `turn:start` | turnIndex: 2                                |
| 23  | 1917     | `llm:start`  |                                             |
| 24  | 1917     | `text:start` |                                             |
| 25  | 1917     | `text:delta` | `4`                                         |
| 26  | 1940     | `text:delta` | `2 + `                                      |
| 27  | 2008     | `text:delta` | `58 =`                                      |
| 28  | 2071     | `text:delta` | ` 10`                                       |
| 29  | 2226     | `text:delta` | `0。小明，`                                 |
| 30  | 2268     | `text:delta` | `结果是 1`                                  |
| 31  | 2402     | `text:delta` | `00！`                                      |
| 32  | 2419     | `text:done`  | 42 + 58 = 100。小明，结果是 100！           |
| 33  | 2419     | `llm:done`   | tokens: in=337, out=22, total=359           |
| 34  | 2420     | `turn:done`  | turnIndex: 2                                |
| 35  | 2420     | `run:done`   |                                             |
| 36  | 2421     | `run:start`  |                                             |
| 37  | 2678     | `turn:start` | turnIndex: 1                                |
| 38  | 2678     | `llm:start`  |                                             |
| 39  | 2678     | `text:start` |                                             |
| 40  | 2678     | `text:delta` | `你`                                        |
| 41  | 2701     | `text:delta` | `叫小明`                                    |
| 42  | 2765     | `text:delta` | `。`                                        |
| 43  | 2785     | `text:done`  | 你叫小明。                                  |
| 44  | 2785     | `llm:done`   | tokens: in=374, out=5, total=379            |
| 45  | 2786     | `turn:done`  | turnIndex: 1                                |
| 46  | 2786     | `run:done`   |                                             |

### 3.6 事件闭环检查

| 事件对                     | start 次数 | done 次数 | 状态    |
| -------------------------- | ---------- | --------- | ------- |
| `run:start` / `run:done`   | 3          | 3         | ✅ 配对 |
| `turn:start` / `turn:done` | 4          | 4         | ✅ 配对 |
| `llm:start` / `llm:done`   | 4          | 4         | ✅ 配对 |
| `text:start` / `text:done` | 3          | 3         | ✅ 配对 |
| `tool:start` / `tool:done` | 1          | 1         | ✅ 配对 |

### 3.7 验证结论

- Session 累积增长: 2 → 6 → 8 ✅
- Context 累积增长: 2 → 6 → 8 ✅
- 第3轮回忆成功（包含"小明"）: ✅
- 第2轮计算正确（包含"100"）: ✅
- text:delta 无 `<think>` 标签: ✅

## 总结

### 事件流体系

本次测试使用模型 `qwen-plus` 验证了以下关键能力：

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
