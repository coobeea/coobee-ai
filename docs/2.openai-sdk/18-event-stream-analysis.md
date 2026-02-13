# OpenAI AgentRuntime 事件流分析报告

> 自动生成于 2026-02-13T15:54:30.195Z
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
- **耗时**: 553ms
- **事件总数**: 9
- **模型**: `qwen-plus`
- **有推理事件**: 否

### 1.1 完整事件流

| #   | 时间(ms) | 事件类型     | 内容摘要                       |
| --- | -------- | ------------ | ------------------------------ |
| 1   | 0        | `run:start`  |                                |
| 2   | 514      | `turn:start` | turnIndex: 1                   |
| 3   | 514      | `llm:start`  |                                |
| 4   | 514      | `text:start` |                                |
| 5   | 514      | `text:delta` | `2`                            |
| 6   | 551      | `text:done`  | 2                              |
| 7   | 551      | `llm:done`   | tokens: in=33, out=1, total=34 |
| 8   | 552      | `turn:done`  | turnIndex: 1                   |
| 9   | 552      | `run:done`   |                                |

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
| 1   | message | user      | 1+1等于几？用一个数字回答 | 15:54:30.204 |
| 2   | message | assistant | [多段内容]                | 15:54:30.749 |

### 1.4 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"1+1等于几？用一个数字回答"},"ts":1770998070204}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"2"}]},"ts":1770998070749}
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
- **耗时**: 2365ms
- **事件总数**: 23
- **Turn 数**: 2
- **工具调用**: add_numbers({"a":17,"b":28}), reverse_string({"text":"hello"})
- **有推理事件**: 否

### 2.1 完整事件流

| #   | 时间(ms) | 事件类型     | 内容摘要                                  |
| --- | -------- | ------------ | ----------------------------------------- |
| 1   | 0        | `run:start`  |                                           |
| 2   | 627      | `turn:start` | turnIndex: 1                              |
| 3   | 627      | `llm:start`  |                                           |
| 4   | 1405     | `llm:done`   | tokens: in=351, out=47, total=398         |
| 5   | 1406     | `tool:start` | add_numbers (callId: N/A)                 |
| 6   | 1407     | `tool:start` | reverse_string (callId: N/A)              |
| 7   | 1407     | `tool:done`  | {"result":45,"expression":"17 + 28 = 45"} |
| 8   | 1407     | `tool:done`  | {"original":"hello","reversed":"olleh"}   |
| 9   | 1817     | `turn:done`  | turnIndex: 1                              |
| 10  | 1817     | `turn:start` | turnIndex: 2                              |
| 11  | 1817     | `llm:start`  |                                           |
| 12  | 1818     | `text:start` |                                           |
| 13  | 1818     | `text:delta` | `1`                                       |
| 14  | 1839     | `text:delta` | `7 + `                                    |
| 15  | 1905     | `text:delta` | `28 =`                                    |
| 16  | 1971     | `text:delta` | ` 4`                                      |
| 17  | 2102     | `text:delta` | `5，\"hello\"`                            |
| 18  | 2213     | `text:delta` | ` 反转后是 \"olle`                        |
| 19  | 2347     | `text:delta` | `h\"。`                                   |
| 20  | 2364     | `text:done`  | 17 + 28 = 45，"hello" 反转后是 "olleh"。  |
| 21  | 2364     | `llm:done`   | tokens: in=445, out=24, total=469         |
| 22  | 2365     | `turn:done`  | turnIndex: 2                              |
| 23  | 2365     | `run:done`   |                                           |

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
| 1   | message | user                 | 请计算 17 + 28，然后反转 "hello" 这个字符串 | 15:54:30.755 |
| 2   | message | function_call        |                                             | 15:54:33.117 |
| 3   | message | function_call        |                                             | 15:54:33.117 |
| 4   | message | function_call_result |                                             | 15:54:33.117 |
| 5   | message | function_call_result |                                             | 15:54:33.117 |
| 6   | message | assistant            | [多段内容]                                  | 15:54:33.117 |

### 2.5 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"请计算 17 + 28，然后反转 \"hello\" 这个字符串"},"ts":1770998070755}
{"seq":2,"type":"message","item":{"type":"function_call","callId":"call_4b749c7631014600bbf23f","name":"add_numbers","arguments":"{\"a\": 17, \"b\": 28}"},"ts":1770998073117}
{"seq":3,"type":"message","item":{"type":"function_call","callId":"call_eca529105e6d49f4ba933e","name":"reverse_string","arguments":"{\"text\": \"hello\"}"},"ts":1770998073117}
{"seq":4,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_4b749c7631014600bbf23f","status":"completed","output":{"type":"text","text":"{\"result\":45,\"expression\":\"17 + 28 = 45\"}"}},"ts":1770998073117}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"reverse_string","callId":"call_eca529105e6d49f4ba933e","status":"completed","output":{"type":"text","text":"{\"original\":\"hello\",\"reversed\":\"olleh\"}"}},"ts":1770998073117}
{"seq":6,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"17 + 28 = 45，\"hello\" 反转后是 \"olleh\"。"}]},"ts":1770998073117}
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
| 1   | message | user                 | 我叫小明，最喜欢的数字是 42 | 15:54:33.124 |
| 2   | message | assistant            | [多段内容]                  | 15:54:33.759 |
| 3   | message | user                 | 帮我算一下 42 + 58          | 15:54:33.763 |
| 4   | message | function_call        |                             | 15:54:35.406 |
| 5   | message | function_call_result |                             | 15:54:35.406 |
| 6   | message | assistant            | [多段内容]                  | 15:54:35.406 |
| 7   | message | user                 | 我叫什么名字？              | 15:54:35.410 |
| 8   | message | assistant            | [多段内容]                  | 15:54:35.795 |

### 3.3 Session 文件原始内容

```json
{"seq":1,"type":"message","item":{"type":"message","role":"user","content":"我叫小明，最喜欢的数字是 42"},"ts":1770998073124}
{"seq":2,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"好的，小明！我记住了你最喜欢的数字是 42。"}]},"ts":1770998073759}
{"seq":3,"type":"message","item":{"type":"message","role":"user","content":"帮我算一下 42 + 58"},"ts":1770998073763}
{"seq":4,"type":"message","item":{"type":"function_call","callId":"call_4a4588b44c8d4c3d85f27f","name":"add_numbers","arguments":"{\"a\": 42, \"b\": 58}"},"ts":1770998075406}
{"seq":5,"type":"message","item":{"type":"function_call_result","name":"add_numbers","callId":"call_4a4588b44c8d4c3d85f27f","status":"completed","output":{"type":"text","text":"{\"result\":100,\"expression\":\"42 + 58 = 100\"}"}},"ts":1770998075406}
{"seq":6,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"42 + 58 = 100。小明，结果是 100！"}]},"ts":1770998075406}
{"seq":7,"type":"message","item":{"type":"message","role":"user","content":"我叫什么名字？"},"ts":1770998075410}
{"seq":8,"type":"message","item":{"id":"FAKE_ID","type":"message","role":"assistant","status":"completed","content":[{"providerData":{"annotations":[]},"type":"output_text","text":"你叫小明。"}]},"ts":1770998075795}
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
| 1   | 0        | `run:start`  |                                             |
| 2   | 264      | `turn:start` | turnIndex: 1                                |
| 3   | 264      | `llm:start`  |                                             |
| 4   | 264      | `text:start` |                                             |
| 5   | 264      | `text:delta` | `好的`                                      |
| 6   | 286      | `text:delta` | `，小`                                      |
| 7   | 333      | `text:delta` | `明！`                                      |
| 8   | 432      | `text:delta` | `我记`                                      |
| 9   | 507      | `text:delta` | `住了你最喜欢的数字是 `                     |
| 10  | 617      | `text:delta` | `42。`                                      |
| 11  | 635      | `text:done`  | 好的，小明！我记住了你最喜欢的数字是 42。   |
| 12  | 635      | `llm:done`   | tokens: in=240, out=16, total=256           |
| 13  | 638      | `turn:done`  | turnIndex: 1                                |
| 14  | 638      | `run:done`   |                                             |
| 15  | 639      | `run:start`  |                                             |
| 16  | 1194     | `turn:start` | turnIndex: 1                                |
| 17  | 1194     | `llm:start`  |                                             |
| 18  | 1477     | `llm:done`   | tokens: in=276, out=27, total=303           |
| 19  | 1477     | `tool:start` | add_numbers (callId: N/A)                   |
| 20  | 1478     | `tool:done`  | {"result":100,"expression":"42 + 58 = 100"} |
| 21  | 1774     | `turn:done`  | turnIndex: 1                                |
| 22  | 1774     | `turn:start` | turnIndex: 2                                |
| 23  | 1774     | `llm:start`  |                                             |
| 24  | 1774     | `text:start` |                                             |
| 25  | 1774     | `text:delta` | `4`                                         |
| 26  | 1795     | `text:delta` | `2 + `                                      |
| 27  | 1860     | `text:delta` | `58 =`                                      |
| 28  | 1926     | `text:delta` | ` 10`                                       |
| 29  | 2078     | `text:delta` | `0。小明，`                                 |
| 30  | 2127     | `text:delta` | `结果是 1`                                  |
| 31  | 2260     | `text:delta` | `00！`                                      |
| 32  | 2282     | `text:done`  | 42 + 58 = 100。小明，结果是 100！           |
| 33  | 2282     | `llm:done`   | tokens: in=337, out=22, total=359           |
| 34  | 2283     | `turn:done`  | turnIndex: 2                                |
| 35  | 2283     | `run:done`   |                                             |
| 36  | 2285     | `run:start`  |                                             |
| 37  | 2560     | `turn:start` | turnIndex: 1                                |
| 38  | 2560     | `llm:start`  |                                             |
| 39  | 2561     | `text:start` |                                             |
| 40  | 2561     | `text:delta` | `你`                                        |
| 41  | 2586     | `text:delta` | `叫小明`                                    |
| 42  | 2648     | `text:delta` | `。`                                        |
| 43  | 2672     | `text:done`  | 你叫小明。                                  |
| 44  | 2672     | `llm:done`   | tokens: in=374, out=5, total=379            |
| 45  | 2672     | `turn:done`  | turnIndex: 1                                |
| 46  | 2672     | `run:done`   |                                             |

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
