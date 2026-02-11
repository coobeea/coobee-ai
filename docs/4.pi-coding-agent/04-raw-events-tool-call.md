# pi-coding-agent 原始事件流 — 工具调用场景

> **场景**: 用户发送「请计算 17 + 28」，agent 思考后调用 add_numbers 工具，获取结果后回复
> **模型**: MiniMax-M2.1 (openai-completions / openai-compat)
> **来源**: `test-results/20260211/pi-agent-events-1770777349855.log`

---

@pi-agent-events-1770777349855.log (158)

```json
{
  "type": "agent_start"
}
```

---

@pi-agent-events-1770777349855.log (160)

```json
{
  "type": "turn_start"
}
```

---

@pi-agent-events-1770777349855.log (161)

```json
{
  "type": "message_start",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "请计算 17 + 28" }],
    "timestamp": 1770777354766
  }
}
```

---

@pi-agent-events-1770777349855.log (162)

```json
{
  "type": "message_end",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "请计算 17 + 28" }],
    "timestamp": 1770777354766
  }
}
```

---

@pi-agent-events-1770777349855.log (163)

```json
{
  "type": "message_start",
  "message": {
    "role": "assistant",
    "content": [],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 0,
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
    },
    "stopReason": "stop",
    "timestamp": 1770777354767
  }
}
```

---

@pi-agent-events-1770777349855.log (164)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_start",
    "contentIndex": 0
  }
}
```

---

@pi-agent-events-1770777349855.log (165)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "<think>\n用户要求"
  }
}
```

---

@pi-agent-events-1770777349855.log (166)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n</think>\n\n\n"
  }
}
```

---

@pi-agent-events-1770777349855.log (167)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_end",
    "contentIndex": 0,
    "content": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n</think>\n\n\n"
  }
}
```

---

@pi-agent-events-1770777349855.log (168)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "toolcall_start",
    "contentIndex": 1
  }
}
```

---

@pi-agent-events-1770777349855.log (169)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "toolcall_delta",
    "contentIndex": 1,
    "delta": "{\"a\": 17, \"b\": 28}"
  }
}
```

---

@pi-agent-events-1770777349855.log (170)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "toolcall_end",
    "contentIndex": 1,
    "toolCall": {
      "type": "toolCall",
      "id": "call_function_65d3w27b080d_1",
      "name": "add_numbers",
      "arguments": { "a": 17, "b": 28 }
    }
  }
}
```

---

@pi-agent-events-1770777349855.log (171)

```json
{
  "type": "message_end",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n</think>\n\n\n"
      },
      {
        "type": "toolCall",
        "id": "call_function_65d3w27b080d_1",
        "name": "add_numbers",
        "arguments": { "a": 17, "b": 28 }
      }
    ],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 271,
      "output": 92,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 363,
      "cost": {
        "input": 0.0000813,
        "output": 0.0001104,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.0001917
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1770777354767
  }
}
```

---

@pi-agent-events-1770777349855.log (172)

```json
{
  "type": "tool_execution_start",
  "toolCallId": "call_function_65d3w27b080d_1",
  "toolName": "add_numbers",
  "args": { "a": 17, "b": 28 }
}
```

---

@pi-agent-events-1770777349855.log (173)

```json
{
  "type": "tool_execution_update",
  "toolCallId": "call_function_65d3w27b080d_1",
  "toolName": "add_numbers",
  "args": { "a": 17, "b": 28 },
  "partialResult": {
    "content": [{ "type": "text", "text": "Executing add_numbers..." }],
    "details": { "status": "running" }
  }
}
```

---

@pi-agent-events-1770777349855.log (174)

```json
{
  "type": "tool_execution_end",
  "toolCallId": "call_function_65d3w27b080d_1",
  "toolName": "add_numbers",
  "result": {
    "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
    "details": { "name": "add_numbers" }
  },
  "isError": false
}
```

---

@pi-agent-events-1770777349855.log (175)

```json
{
  "type": "message_start",
  "message": {
    "role": "toolResult",
    "toolCallId": "call_function_65d3w27b080d_1",
    "toolName": "add_numbers",
    "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
    "details": { "name": "add_numbers" },
    "isError": false,
    "timestamp": 1770777358183
  }
}
```

---

@pi-agent-events-1770777349855.log (176)

```json
{
  "type": "message_end",
  "message": {
    "role": "toolResult",
    "toolCallId": "call_function_65d3w27b080d_1",
    "toolName": "add_numbers",
    "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
    "details": { "name": "add_numbers" },
    "isError": false,
    "timestamp": 1770777358183
  }
}
```

---

@pi-agent-events-1770777349855.log (177)

```json
{
  "type": "turn_end",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n</think>\n\n\n"
      },
      {
        "type": "toolCall",
        "id": "call_function_65d3w27b080d_1",
        "name": "add_numbers",
        "arguments": { "a": 17, "b": 28 }
      }
    ],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 271,
      "output": 92,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 363,
      "cost": {
        "input": 0.0000813,
        "output": 0.0001104,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.0001917
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1770777354767
  },
  "toolResults": [
    {
      "role": "toolResult",
      "toolCallId": "call_function_65d3w27b080d_1",
      "toolName": "add_numbers",
      "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
      "details": { "name": "add_numbers" },
      "isError": false,
      "timestamp": 1770777358183
    }
  ]
}
```

---

@pi-agent-events-1770777349855.log (178)

```json
{
  "type": "turn_start"
}
```

---

@pi-agent-events-1770777349855.log (179)

```json
{
  "type": "message_start",
  "message": {
    "role": "assistant",
    "content": [],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 0,
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
    },
    "stopReason": "stop",
    "timestamp": 1770777358184
  }
}
```

---

@pi-agent-events-1770777349855.log (180)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_start",
    "contentIndex": 0
  }
}
```

---

@pi-agent-events-1770777349855.log (181)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "<think>\n工具返回"
  }
}
```

---

@pi-agent-events-1770777349855.log (182)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n</think>\n\n17 + 28 = **45**"
  }
}
```

---

@pi-agent-events-1770777349855.log (183)

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_end",
    "contentIndex": 0,
    "content": "<think>\n工具返回了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n</think>\n\n17 + 28 = **45**"
  }
}
```

---

@pi-agent-events-1770777349855.log (184)

```json
{
  "type": "message_end",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "<think>\n工具返回了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n</think>\n\n17 + 28 = **45**"
      }
    ],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 365,
      "output": 61,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 426,
      "cost": {
        "input": 0.0001095,
        "output": 0.0000732,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.0001827
      }
    },
    "stopReason": "stop",
    "timestamp": 1770777358184
  }
}
```

---

@pi-agent-events-1770777349855.log (185)

```json
{
  "type": "turn_end",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "<think>\n工具返回了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n</think>\n\n17 + 28 = **45**"
      }
    ],
    "api": "openai-completions",
    "provider": "openai-compat",
    "model": "MiniMax-M2.1",
    "usage": {
      "input": 365,
      "output": 61,
      "cacheRead": 0,
      "cacheWrite": 0,
      "totalTokens": 426,
      "cost": {
        "input": 0.0001095,
        "output": 0.0000732,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.0001827
      }
    },
    "stopReason": "stop",
    "timestamp": 1770777358184
  },
  "toolResults": []
}
```

---

@pi-agent-events-1770777349855.log (186)

```json
{
  "type": "agent_end",
  "messages": [
    {
      "role": "user",
      "content": [{ "type": "text", "text": "请计算 17 + 28" }],
      "timestamp": 1770777354766
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据工具说明，我必须使用 add_numbers 工具来完成加法。\n</think>\n\n\n"
        },
        {
          "type": "toolCall",
          "id": "call_function_65d3w27b080d_1",
          "name": "add_numbers",
          "arguments": { "a": 17, "b": 28 }
        }
      ],
      "api": "openai-completions",
      "provider": "openai-compat",
      "model": "MiniMax-M2.1",
      "usage": {
        "input": 271,
        "output": 92,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 363,
        "cost": {
          "input": 0.0000813,
          "output": 0.0001104,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0.0001917
        }
      },
      "stopReason": "toolUse",
      "timestamp": 1770777354767
    },
    {
      "role": "toolResult",
      "toolCallId": "call_function_65d3w27b080d_1",
      "toolName": "add_numbers",
      "content": [{ "type": "text", "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}" }],
      "details": { "name": "add_numbers" },
      "isError": false,
      "timestamp": 1770777358183
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "<think>\n工具返回了结果：45。计算结果是 17 + 28 = 45。我现在可以直接回答用户。\n</think>\n\n17 + 28 = **45**"
        }
      ],
      "api": "openai-completions",
      "provider": "openai-compat",
      "model": "MiniMax-M2.1",
      "usage": {
        "input": 365,
        "output": 61,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 426,
        "cost": {
          "input": 0.0001095,
          "output": 0.0000732,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0.0001827
        }
      },
      "stopReason": "stop",
      "timestamp": 1770777358184
    }
  ]
}
```

---
