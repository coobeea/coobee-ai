# SDK 流式事件原始数据（场景：单工具调用 add_numbers）

> 数据来源：`test-results/20260210/agent-events-1770718045365.log` 行 117-139
>
> 共 23 条事件，每条独立格式化，与原始日志一一对应。

---

## #1 (行117) raw_model_stream_event | rawType=response_started

**时间**：10:07:33.370

```json
{
  "type": "response_started",
  "providerData": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n用户要求",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #2 (行118) raw_model_stream_event | rawType=model

**时间**：10:07:33.371

```json
{
  "type": "model",
  "event": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n用户要求",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #3 (行119) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:33.371

```json
{
  "type": "output_text_delta",
  "delta": "<think>\n用户要求",
  "providerData": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n用户要求",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #4 (行120) raw_model_stream_event | rawType=model

**时间**：10:07:34.238

```json
{
  "type": "model",
  "event": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "计算 17 + 28，这是一个加法问题。根据指示，我必须使用 add_numbers 工具来完成加法。\n\n我需要调用 add_numbers 工具，并传入参数",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #5 (行121) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:34.238

```json
{
  "type": "output_text_delta",
  "delta": "计算 17 + 28，这是一个加法问题。根据指示，我必须使用 add_numbers 工具来完成加法。\n\n我需要调用 add_numbers 工具，并传入参数",
  "providerData": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "计算 17 + 28，这是一个加法问题。根据指示，我必须使用 add_numbers 工具来完成加法。\n\n我需要调用 add_numbers 工具，并传入参数",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #6 (行122) raw_model_stream_event | rawType=model

**时间**：10:07:34.925

```json
{
  "type": "model",
  "event": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "：\n- a: 17（第一个数字）\n- b: 28（第二个数字）\n</think>\n\n我来帮您计算 17 + 28。\n",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #7 (行123) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:34.928

```json
{
  "type": "output_text_delta",
  "delta": "：\n- a: 17（第一个数字）\n- b: 28（第二个数字）\n</think>\n\n我来帮您计算 17 + 28。\n",
  "providerData": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "：\n- a: 17（第一个数字）\n- b: 28（第二个数字）\n</think>\n\n我来帮您计算 17 + 28。\n",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #8 (行124) raw_model_stream_event | rawType=model

**时间**：10:07:41.831

```json
{
  "type": "model",
  "event": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [
      {
        "finish_reason": "tool_calls",
        "index": 0,
        "delta": {
          "content": "",
          "role": "assistant",
          "name": "MiniMax AI",
          "tool_calls": [
            {
              "id": "call_function_arof6jc5h6j7_1",
              "type": "function",
              "function": {
                "name": "add_numbers",
                "arguments": "{\"a\": 17, \"b\": 28}"
              },
              "index": 0
            }
          ],
          "audio_content": ""
        }
      }
    ],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #9 (行125) raw_model_stream_event | rawType=model

**时间**：10:07:41.837

```json
{
  "type": "model",
  "event": {
    "id": "05da365e58b15aceefa86b40c8997a53",
    "choices": [],
    "created": 1770718046,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": {
      "total_tokens": 350,
      "total_characters": 0,
      "prompt_tokens": 249,
      "completion_tokens": 101,
      "completion_tokens_details": {
        "reasoning_tokens": 57
      }
    },
    "base_resp": {
      "status_code": 0,
      "status_msg": ""
    }
  }
}
```

---

## #10 (行126) raw_model_stream_event | rawType=response_done

**时间**：10:07:41.840

```json
{
  "type": "response_done",
  "response": {
    "id": "FAKE_ID",
    "usage": {
      "inputTokens": 249,
      "outputTokens": 101,
      "totalTokens": 350,
      "inputTokensDetails": {
        "cached_tokens": 0
      },
      "outputTokensDetails": {
        "reasoning_tokens": 57
      }
    },
    "output": [
      {
        "id": "FAKE_ID",
        "content": [
          {
            "text": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据指示，我必须使用 add_numbers 工具来完成加法。\n\n我需要调用 add_numbers 工具，并传入参数：\n- a: 17（第一个数字）\n- b: 28（第二个数字）\n</think>\n\n我来帮您计算 17 + 28。\n",
            "type": "output_text",
            "providerData": {
              "annotations": []
            }
          }
        ],
        "role": "assistant",
        "type": "message",
        "status": "completed"
      },
      {
        "id": "FAKE_ID",
        "arguments": "{\"a\": 17, \"b\": 28}",
        "name": "add_numbers",
        "type": "function_call",
        "callId": "call_function_arof6jc5h6j7_1"
      }
    ]
  }
}
```

---

## #11 (行127) run_item_stream_event | name=message_output_created | itemType=message_output_item

**时间**：10:07:41.840

```json
{
  "id": "FAKE_ID",
  "type": "message",
  "role": "assistant",
  "status": "completed",
  "content": [
    {
      "providerData": {
        "annotations": []
      },
      "type": "output_text",
      "text": "<think>\n用户要求计算 17 + 28，这是一个加法问题。根据指示，我必须使用 add_numbers 工具来完成加法。\n\n我需要调用 add_numbers 工具，并传入参数：\n- a: 17（第一个数字）\n- b: 28（第二个数字）\n</think>\n\n我来帮您计算 17 + 28。\n"
    }
  ]
}
```

---

## #12 (行128) run_item_stream_event | name=tool_called | itemType=tool_call_item

**时间**：10:07:41.841

```json
{
  "id": "FAKE_ID",
  "type": "function_call",
  "callId": "call_function_arof6jc5h6j7_1",
  "name": "add_numbers",
  "arguments": "{\"a\": 17, \"b\": 28}"
}
```

---

## #13 (行129) run_item_stream_event | name=tool_output | itemType=tool_call_output_item

**时间**：10:07:41.842

```json
{
  "type": "function_call_result",
  "name": "add_numbers",
  "callId": "call_function_arof6jc5h6j7_1",
  "status": "completed",
  "output": {
    "type": "text",
    "text": "{\"result\":45,\"expression\":\"17 + 28 = 45\"}"
  }
}
```

---

## #14 (行130) raw_model_stream_event | rawType=response_started

**时间**：10:07:46.045

```json
{
  "type": "response_started",
  "providerData": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n好的，",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #15 (行131) raw_model_stream_event | rawType=model

**时间**：10:07:46.046

```json
{
  "type": "model",
  "event": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n好的，",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #16 (行132) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:46.050

```json
{
  "type": "output_text_delta",
  "delta": "<think>\n好的，",
  "providerData": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "<think>\n好的，",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #17 (行133) raw_model_stream_event | rawType=model

**时间**：10:07:46.785

```json
{
  "type": "model",
  "event": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "add_numbers 工具已经返回了结果。结果是 45，表达式是 \"17 + 28 = 45\"。我应该直接告诉用户这个结果。\n</think>\n\n",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #18 (行134) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:46.786

```json
{
  "type": "output_text_delta",
  "delta": "add_numbers 工具已经返回了结果。结果是 45，表达式是 \"17 + 28 = 45\"。我应该直接告诉用户这个结果。\n</think>\n\n",
  "providerData": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "index": 0,
        "delta": {
          "content": "add_numbers 工具已经返回了结果。结果是 45，表达式是 \"17 + 28 = 45\"。我应该直接告诉用户这个结果。\n</think>\n\n",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #19 (行135) raw_model_stream_event | rawType=model

**时间**：10:07:46.977

```json
{
  "type": "model",
  "event": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "finish_reason": "stop",
        "index": 0,
        "delta": {
          "content": "17 + 28 = 45",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #20 (行136) raw_model_stream_event | rawType=output_text_delta

**时间**：10:07:46.978

```json
{
  "type": "output_text_delta",
  "delta": "17 + 28 = 45",
  "providerData": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [
      {
        "finish_reason": "stop",
        "index": 0,
        "delta": {
          "content": "17 + 28 = 45",
          "role": "assistant",
          "name": "MiniMax AI",
          "audio_content": ""
        }
      }
    ],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": null,
    "input_sensitive": false,
    "output_sensitive": false,
    "input_sensitive_type": 0,
    "output_sensitive_type": 0,
    "output_sensitive_int": 0
  }
}
```

---

## #21 (行137) raw_model_stream_event | rawType=model

**时间**：10:07:46.985

```json
{
  "type": "model",
  "event": {
    "id": "05da366df2a0a751252f941c03f5dc53",
    "choices": [],
    "created": 1770718061,
    "model": "MiniMax-M2.1",
    "object": "chat.completion.chunk",
    "usage": {
      "total_tokens": 431,
      "total_characters": 0,
      "prompt_tokens": 386,
      "completion_tokens": 45,
      "completion_tokens_details": {
        "reasoning_tokens": 37
      }
    },
    "base_resp": {
      "status_code": 0,
      "status_msg": ""
    }
  }
}
```

---

## #22 (行138) raw_model_stream_event | rawType=response_done

**时间**：10:07:46.986

```json
{
  "type": "response_done",
  "response": {
    "id": "FAKE_ID",
    "usage": {
      "inputTokens": 386,
      "outputTokens": 45,
      "totalTokens": 431,
      "inputTokensDetails": {
        "cached_tokens": 0
      },
      "outputTokensDetails": {
        "reasoning_tokens": 37
      }
    },
    "output": [
      {
        "id": "FAKE_ID",
        "content": [
          {
            "text": "<think>\n好的，add_numbers 工具已经返回了结果。结果是 45，表达式是 \"17 + 28 = 45\"。我应该直接告诉用户这个结果。\n</think>\n\n17 + 28 = 45",
            "type": "output_text",
            "providerData": {
              "annotations": []
            }
          }
        ],
        "role": "assistant",
        "type": "message",
        "status": "completed"
      }
    ]
  }
}
```

---

## #23 (行139) run_item_stream_event | name=message_output_created | itemType=message_output_item

**时间**：10:07:46.987

```json
{
  "id": "FAKE_ID",
  "type": "message",
  "role": "assistant",
  "status": "completed",
  "content": [
    {
      "providerData": {
        "annotations": []
      },
      "type": "output_text",
      "text": "<think>\n好的，add_numbers 工具已经返回了结果。结果是 45，表达式是 \"17 + 28 = 45\"。我应该直接告诉用户这个结果。\n</think>\n\n17 + 28 = 45"
    }
  ]
}
```
