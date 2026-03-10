# OpenClaw Gateway 与钩子系统协作机制 — 以 Agent 执行流程为核心

> 本文档围绕 **一条消息从外部系统进入 Gateway、经过处理流程、进入 Agent 核心、最终返回结果** 的完整链路，逐步解析钩子在每个阶段扮演的角色。

---

## 目录

1. [全流程鸟瞰图](#1-全流程鸟瞰图)
2. [阶段一：外部系统 → Gateway 入口](#2-阶段一外部系统--gateway-入口)
3. [阶段二：消息归一化与去重](#3-阶段二消息归一化与去重)
4. [阶段三：message_received 钩子 — 第一个拦截点](#4-阶段三message_received-钩子--第一个拦截点)
5. [阶段四：命令解析与 Internal Hook](#5-阶段四命令解析与-internal-hook)
6. [阶段五：进入 Agent 核心 — before_agent_start 钩子](#6-阶段五进入-agent-核心--before_agent_start-钩子)
7. [阶段六：Agent 执行中 — before_tool_call 钩子](#7-阶段六agent-执行中--before_tool_call-钩子)
8. [阶段七：工具结果持久化 — tool_result_persist 钩子](#8-阶段七工具结果持久化--tool_result_persist-钩子)
9. [阶段八：Agent 执行完成 — agent_end 钩子](#9-阶段八agent-执行完成--agent_end-钩子)
10. [阶段九：消息发送 — message_sending 钩子](#10-阶段九消息发送--message_sending-钩子)
11. [特殊入口：外部 HTTP Webhook 如何触发 Agent](#11-特殊入口外部-http-webhook-如何触发-agent)
12. [特殊入口：插件如何注册自定义扩展](#12-特殊入口插件如何注册自定义扩展)
13. [两套钩子系统的区别](#13-两套钩子系统的区别)
14. [钩子的容错哲学](#14-钩子的容错哲学)
15. [关键代码索引](#15-关键代码索引)

---

## 1. 全流程鸟瞰图

我们先看一条消息从头到尾的完整旅程，每个 `★` 标记的地方就是一个钩子触发点：

```
用户在微信/Telegram/Discord/Web UI 发送一条消息
  │
  ▼
═══════════════════════════════════════════════════
  Gateway 入口（WebSocket RPC / HTTP）
  ├── 认证校验（token / connect 握手）
  ├── 消息归一化（统一字段名: From, To, Body, Surface...）
  └── 去重检查
═══════════════════════════════════════════════════
  │
  ▼
★ 钩子 1: message_received（通知型，并行执行，不阻塞）
  │  "有人发了一条消息" — 插件可以记日志/做统计/发外部通知
  │
  ▼
═══════════════════════════════════════════════════
  命令解析层
  ├── 是 /new 命令？ → ★ Internal Hook: command:new
  ├── 是 /stop 命令？ → ★ Internal Hook: command:stop
  ├── 是 /help 等命令？ → 直接返回，不进 Agent
  └── 不是命令 → 继续进入 Agent
═══════════════════════════════════════════════════
  │
  ▼
  会话管理
  ├── 解析 sessionKey（路由到正确的 Agent 会话）
  ├── 排队等待（同一会话串行，不同会话可并行）
  └── 创建 AgentSession + SessionManager
  │
  ▼
★ 钩子 2: before_agent_start（修改型，顺序执行）
  │  "Agent 即将开始思考" — 插件可以注入额外上下文到系统提示词
  │  例: 记忆插件把历史摘要注入为 prependContext
  │
  ▼
═══════════════════════════════════════════════════
  Agent 核心执行（大模型思考 + 工具调用循环）
  │
  ├── 大模型决定调用工具 exec("ls -la")
  │   │
  │   ▼
  │   ★ 钩子 3: before_tool_call（修改型，顺序执行）
  │   │  "Agent 要执行 ls -la" — 插件可以修改参数或阻止执行
  │   │  例: 安全插件检查命令是否安全
  │   │
  │   ▼
  │   工具实际执行 → 返回结果
  │   │
  │   ▼
  │   ★ 钩子 4: tool_result_persist（同步修改型）
  │   │  "工具结果要写入会话记录" — 插件可以修改/缩减持久化内容
  │   │  例: 裁剪过大的文件读取结果，只保留摘要
  │   │
  │   └── 继续下一轮大模型思考...
  │
  ▼
★ 钩子 5: agent_end（通知型，并行执行，不阻塞）
  │  "Agent 执行结束了" — 插件可以分析对话/记录耗时/写数据库
  │
  ▼
═══════════════════════════════════════════════════
  消息发送层
  │
  ├── ★ 钩子 6: message_sending（修改型，顺序执行）
  │   │  "要发消息给用户了" — 插件可以修改内容或取消发送
  │   │  例: 敏感词过滤插件替换不当内容
  │   │
  │   ▼
  │   通过渠道发送（Telegram / Discord / Web UI ...）
  │   │
  │   ▼
  │   ★ 钩子 7: message_sent（通知型，并行执行）
  │      "消息发送完毕" — 插件可以确认/审计
  │
  ▼
用户收到回复
═══════════════════════════════════════════════════
```

---

## 2. 阶段一：外部系统 → Gateway 入口

所有外部系统都通过 Gateway 与 Agent 核心交互，Gateway 提供两种协议：

### 2.1 WebSocket RPC（主要通道）

客户端（Web UI、macOS App、Discord Bot 等）通过 WebSocket 连接 Gateway，发送 JSON RPC 请求：

```json
{
  "type": "req",
  "id": "req-123",
  "method": "chat.send",
  "params": {
    "message": "帮我看看这个文件",
    "sessionKey": "main"
  }
}
```

Gateway 在 WebSocket 连接建立时进行认证，然后将请求分发给对应的 handler：

```typescript
// src/gateway/server-methods.ts (L193-219)
export async function handleGatewayRequest(opts) {
  // 1. 权限检查
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }

  // 2. 查找 handler（先查插件注册的，再查核心的）
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];

  // 3. 执行 handler
  await handler({ req, params, client, respond, context });
}
```

**插件在这里的扩展点**：插件可以通过 `api.registerGatewayMethod("my.custom.method", handler)` 注册自己的 RPC 方法，这些方法和核心方法一样通过 WebSocket 被调用。

### 2.2 HTTP（Webhook + REST API）

外部服务（GitHub、Gmail、Zapier 等）通过 HTTP POST 发送 Webhook，这个后面在 [第 11 章](#11-特殊入口外部-http-webhook-如何触发-agent) 专门讲。

### 2.3 消息渠道（Telegram / Discord / Slack / WhatsApp / Signal）

这些渠道各自维护一个长连接或 HTTP 轮询，收到消息后将其标准化为统一格式，送入 Gateway 的消息处理流程。

---

## 3. 阶段二：消息归一化与去重

不管消息来自哪个渠道，进入处理流程前都被归一化为 `FinalizedMsgContext`，它有统一的字段：

```
FinalizedMsgContext {
  From: "user123"          // 发送者
  To: "bot456"             // 接收者
  Body: "帮我看看文件"      // 消息正文
  Surface: "telegram"      // 来源渠道
  Provider: "telegram"     // 提供商
  SessionKey: "main"       // 会话标识
  SenderId: "12345"        // 发送者ID
  SenderName: "张三"       // 发送者名字
  MessageSid: "msg-abc"    // 消息唯一ID
  ...
}
```

去重检查确保同一条消息不会被处理两次（比如 Webhook 重试的场景）：

```typescript
// src/auto-reply/reply/dispatch-from-config.ts (L143-146)
if (shouldSkipDuplicateInbound(ctx)) {
  recordProcessed('skipped', { reason: 'duplicate' });
  return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };
}
```

---

## 4. 阶段三：message_received 钩子 — 第一个拦截点

消息归一化之后、任何命令处理之前，触发 `message_received` 钩子：

```typescript
// src/auto-reply/reply/dispatch-from-config.ts (L150-198)
const hookRunner = getGlobalHookRunner();
if (hookRunner?.hasHooks('message_received')) {
  void hookRunner
    .runMessageReceived(
      {
        from: ctx.From ?? '',
        content, // 消息文本
        timestamp,
        metadata: {
          to: ctx.To,
          provider: ctx.Provider,
          surface: ctx.Surface,
          senderId: ctx.SenderId,
          senderName: ctx.SenderName,
          senderUsername: ctx.SenderUsername,
          messageId: messageIdForHook
          // ...
        }
      },
      {
        channelId, // "telegram"/"discord"/...
        accountId: ctx.AccountId,
        conversationId
      }
    )
    .catch((err) => {
      logVerbose(`dispatch-from-config: message_received hook failed: ${String(err)}`);
    });
}
```

**关键设计特征**：

1. **`void` — 不等待**：注意前面有 `void`，说明这个钩子是 fire-and-forget，不会阻塞消息处理流程
2. **并行执行**：多个插件注册的 handler 通过 `Promise.all` 并行执行
3. **不能修改消息**：这是一个 Void 型钩子，handler 拿到的是消息的只读副本

**插件可以用来做什么**：

- 消息日志：把每条收到的消息记录到外部数据库
- 统计分析：统计每个渠道的消息量
- 外部通知：把消息摘要转发到 Slack 频道
- 触发器：检测到特定关键词时触发外部 API

**插件注册示例**：

```typescript
// 某个插件的 register 函数
api.on('message_received', async (event, ctx) => {
  // event.from = "user123"
  // event.content = "帮我看看文件"
  // ctx.channelId = "telegram"
  await myDatabase.log({
    from: event.from,
    content: event.content,
    channel: ctx.channelId,
    timestamp: event.timestamp
  });
});
```

---

## 5. 阶段四：命令解析与 Internal Hook

消息进入命令解析层后，如果是 `/new` 或 `/reset` 命令，会触发 Internal Hook：

```typescript
// src/auto-reply/reply/commands-core.ts (L74-107)
if (resetRequested && params.command.isAuthorizedSender) {
  const commandAction = resetMatch?.[1] ?? 'new'; // "new" 或 "reset"

  // 创建事件
  const hookEvent = createInternalHookEvent('command', commandAction, params.sessionKey ?? '', {
    sessionEntry: params.sessionEntry,
    previousSessionEntry: params.previousSessionEntry,
    commandSource: params.command.surface,
    senderId: params.command.senderId,
    cfg: params.cfg
  });

  // 触发钩子
  await triggerInternalHook(hookEvent);

  // 钩子可以通过 event.messages 数组回传消息给用户
  if (hookEvent.messages.length > 0) {
    const hookReply = { text: hookEvent.messages.join('\n\n') };
    await routeReply({
      payload: hookReply,
      channel: channel,
      to: to,
      sessionKey: params.sessionKey
      // ...
    });
  }
}
```

**这和 Plugin Typed Hook 有什么区别？**

Internal Hook 是一套更老的事件系统，它使用字符串键匹配（`command:new`），handler 可以往 `event.messages` 里推送消息。典型场景是：用户发送 `/new` 重置会话时，记忆插件把上一轮对话的摘要存到长期记忆里。

```typescript
// 某个 Internal Hook handler 的例子
registerInternalHook('command:new', async (event) => {
  // 用户执行了 /new，旧会话即将被清除
  const sessionEntry = event.context.sessionEntry;

  // 把旧会话摘要存到记忆系统
  await memory.saveSummary(event.sessionKey, sessionEntry);

  // 可以回传一条消息给用户
  event.messages.push('已保存上一轮对话到记忆中 ✓');
});
```

---

## 6. 阶段五：进入 Agent 核心 — before_agent_start 钩子

命令处理完毕后，如果消息不是命令（或者是需要 Agent 处理的内容），消息会经过会话管理、排队，最终进入 `runEmbeddedAttempt`。在大模型开始思考**之前**，触发 `before_agent_start`：

```typescript
// src/agents/pi-embedded-runner/run/attempt.ts (L710-749)
const hookRunner = getGlobalHookRunner();

// ... 准备好 AgentSession, SessionManager 等 ...

// Agent 开始执行前，给插件一个注入上下文的机会
let effectivePrompt = params.prompt;
if (hookRunner?.hasHooks('before_agent_start')) {
  try {
    const hookResult = await hookRunner.runBeforeAgentStart(
      {
        prompt: params.prompt, // 用户发送的消息
        messages: activeSession.messages // 当前会话的所有历史消息
      },
      {
        agentId: hookAgentId, // "main" 或其他 agent ID
        sessionKey: params.sessionKey, // 会话标识
        workspaceDir: params.workspaceDir, // 工作区路径
        messageProvider: params.messageProvider // "telegram"/"web"/...
      }
    );

    // 如果插件返回了 prependContext，把它拼到用户消息前面
    if (hookResult?.prependContext) {
      effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
      log.debug(`hooks: prepended context to prompt (${hookResult.prependContext.length} chars)`);
    }
  } catch (hookErr) {
    log.warn(`before_agent_start hook failed: ${String(hookErr)}`);
  }
}

// 然后用 effectivePrompt 去调大模型
```

**这个钩子的核心能力**：

| 返回字段         | 作用                     | 示例                                           |
| ---------------- | ------------------------ | ---------------------------------------------- |
| `prependContext` | 在用户消息前面追加上下文 | `"上一次对话中，用户提到他在做 React 项目..."` |
| `systemPrompt`   | 替换整个系统提示词       | `"你是一个专业的代码审查助手..."`              |

**这是修改型钩子，顺序执行**。如果多个插件都返回 `prependContext`，它们会被拼接（不是覆盖）：

```typescript
// src/plugins/hooks.ts (L191-198) — 合并策略
(acc, next) => ({
  systemPrompt: next.systemPrompt ?? acc?.systemPrompt,   // 后面的覆盖前面的
  prependContext:
    acc?.prependContext && next.prependContext
      ? `${acc.prependContext}\n\n${next.prependContext}`  // 拼接！
      : (next.prependContext ?? acc?.prependContext),
}),
```

**典型使用场景 — 记忆插件**：

```typescript
api.on(
  'before_agent_start',
  async (event, ctx) => {
    // 从向量数据库中搜索与当前消息相关的历史记忆
    const memories = await vectorDB.search(event.prompt, { limit: 5 });

    if (memories.length > 0) {
      return {
        prependContext: `以下是与当前话题相关的历史记忆:\n${memories.map((m) => `- ${m.text}`).join('\n')}`
      };
    }
  },
  { priority: 100 }
); // 高优先级，确保记忆最先被注入
```

---

## 7. 阶段六：Agent 执行中 — before_tool_call 钩子

Agent 在执行过程中会调用工具（读文件、执行命令、搜索等）。每次工具调用前，都会经过 `before_tool_call` 钩子。

这个钩子的集成方式是通过 **工具包装**，在工具创建阶段就把钩子包裹进 `execute` 函数：

```typescript
// src/agents/pi-tools.before-tool-call.ts (L64-88)
export function wrapToolWithBeforeToolCallHook(tool, ctx) {
  const execute = tool.execute;
  const toolName = tool.name || 'tool';

  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      // ① 先运行钩子
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx
      });

      // ② 如果钩子说"阻止"，直接报错，工具不会执行
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }

      // ③ 用（可能被修改过的）参数执行工具
      return await execute(toolCallId, outcome.params, signal, onUpdate);
    }
  };
}
```

钩子的具体执行逻辑：

```typescript
// src/agents/pi-tools.before-tool-call.ts (L16-62)
export async function runBeforeToolCallHook(args) {
  const hookRunner = getGlobalHookRunner();

  // 快速路径：没有注册钩子就直接跳过
  if (!hookRunner?.hasHooks('before_tool_call')) {
    return { blocked: false, params: args.params };
  }

  const hookResult = await hookRunner.runBeforeToolCall(
    { toolName, params: normalizedParams }, // Event: 告诉插件 "哪个工具" + "什么参数"
    { toolName, agentId, sessionKey } // Context: 会话信息
  );

  // 插件说阻止？
  if (hookResult?.block) {
    return {
      blocked: true,
      reason: hookResult.blockReason || 'Tool call blocked'
    };
  }

  // 插件修改了参数？
  if (hookResult?.params) {
    return { blocked: false, params: { ...params, ...hookResult.params } };
  }

  // 默认：放行
  return { blocked: false, params };
}
```

**这个钩子能做什么？**

| 返回字段                              | 作用             | 结果                     |
| ------------------------------------- | ---------------- | ------------------------ |
| `{ block: true, blockReason: "..." }` | 完全阻止工具调用 | Agent 收到一个错误消息   |
| `{ params: { ... } }`                 | 修改工具参数     | Agent 感知不到参数被改了 |
| `undefined` / `null`                  | 不干预           | 工具正常执行             |

**典型使用场景**：

```typescript
// 安全审计插件
api.on('before_tool_call', async (event, ctx) => {
  // 拦截所有 exec 工具调用
  if (event.toolName === 'exec') {
    const command = event.params.command;

    // 阻止删除操作
    if (command.includes('rm -rf')) {
      return { block: true, blockReason: '危险操作被安全策略阻止: rm -rf' };
    }

    // 自动添加 --dry-run 标志
    if (command.startsWith('terraform')) {
      return { params: { command: command + ' --dry-run' } };
    }
  }
});
```

**和 HITL（命令执行审批）的关系**：

`before_tool_call` 钩子运行在 **HITL 审批之外**。实际的执行链是：

```
大模型决定调用 exec("rm file.txt")
  │
  ▼
before_tool_call 钩子 → 插件可以修改参数/阻止
  │
  ▼ (如果没被阻止)
exec 工具内部逻辑
  ├── 解析命令
  ├── 检查 exec-approvals.json 策略
  ├── 如果需要审批 → HITL 流程（等待人类审批）
  ├── 如果审批通过 → 实际执行命令
  └── 返回结果
```

所以 `before_tool_call` 是在 HITL **之前** 的一层防护。

---

## 8. 阶段七：工具结果持久化 — tool_result_persist 钩子

工具执行完毕后，结果要写入 SessionManager 的 JSONL 文件（会话记录）。在写入之前，`tool_result_persist` 钩子可以修改要持久化的内容：

```typescript
// src/agents/session-tool-result-guard-wrapper.ts (L26-46)
const hookRunner = getGlobalHookRunner();
const transform = hookRunner?.hasHooks('tool_result_persist')
  ? (message, meta) => {
      const out = hookRunner.runToolResultPersist(
        {
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
          message, // 即将写入文件的 AgentMessage
          isSynthetic: meta.isSynthetic
        },
        {
          agentId: opts?.agentId,
          sessionKey: opts?.sessionKey,
          toolName: meta.toolName,
          toolCallId: meta.toolCallId
        }
      );
      return out?.message ?? message; // 返回修改后的消息（或原始消息）
    }
  : undefined;

// 把 transform 函数安装到 SessionManager
const guard = installSessionToolResultGuard(sessionManager, {
  transformToolResultForPersistence: transform
});
```

**特殊设计 — 同步钩子**：

这是唯一一个 **同步执行** 的钩子，因为 SessionManager 的写入是同步的热路径。如果插件的 handler 意外返回了 Promise，会被检测到并忽略：

```typescript
// src/plugins/hooks.ts (L346-354)
// 防御：检测意外的异步 handler
if (out && typeof (out as any).then === 'function') {
  const msg = `tool_result_persist handler returned a Promise; this hook is synchronous`;
  logger?.warn?.(msg);
  continue; // 跳过这个 handler
}
```

**典型使用场景**：

```typescript
// 结果压缩插件：避免巨大的工具结果塞满会话历史
api.on('tool_result_persist', (event, ctx) => {
  // event.toolName = "read"
  // event.message = { role: "tool", content: [{ type: "text", text: "...巨长的文件内容..." }] }

  const content = event.message.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text' && part.text.length > 10000) {
        // 截断过长的工具结果
        return {
          message: {
            ...event.message,
            content: [
              {
                type: 'text',
                text: part.text.slice(0, 10000) + '\n...[truncated]'
              }
            ]
          }
        };
      }
    }
  }
});
```

---

## 9. 阶段八：Agent 执行完成 — agent_end 钩子

当大模型完成思考和所有工具调用后，触发 `agent_end`：

```typescript
// src/agents/pi-embedded-runner/run/attempt.ts (L852-873)
// 注意：fire-and-forget，不 await
if (hookRunner?.hasHooks('agent_end')) {
  hookRunner
    .runAgentEnd(
      {
        messages: messagesSnapshot, // 整个对话的完整消息列表
        success: !aborted && !promptError, // 执行是否成功
        error: promptError ? describeUnknownError(promptError) : undefined,
        durationMs: Date.now() - promptStartedAt // 执行耗时
      },
      {
        agentId: hookAgentId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        messageProvider: params.messageProvider
      }
    )
    .catch((err) => {
      log.warn(`agent_end hook failed: ${err}`);
    });
}
```

**这是通知型钩子（Void）**：

- 并行执行，不阻塞返回
- 不能修改 Agent 的输出
- 错误被捕获并记录，不影响结果

**典型使用场景**：

```typescript
// 对话分析插件
api.on('agent_end', async (event, ctx) => {
  // 记录对话统计
  await analytics.record({
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey,
    success: event.success,
    durationMs: event.durationMs,
    messageCount: event.messages.length,
    error: event.error
  });

  // 如果执行失败，发送告警
  if (!event.success && event.error) {
    await alertService.notify(`Agent ${ctx.agentId} 执行失败: ${event.error}`);
  }
});
```

---

## 10. 阶段九：消息发送 — message_sending 钩子

Agent 的回复要发送给用户之前，`message_sending` 钩子可以修改或取消消息。

**这个钩子的类型定义**：

```typescript
// src/plugins/types.ts (L369-378)
// Event:
{ to: string; content: string; metadata?: Record<string, unknown> }

// Result:
{
  content?: string;    // 修改后的消息内容
  cancel?: boolean;    // 设为 true 则取消发送
}
```

**这是修改型钩子**：多个插件按优先级顺序执行，合并策略是后面的覆盖前面的 `content`，任何一个 `cancel: true` 都会取消发送。

**典型使用场景**：

```typescript
// 内容过滤插件
api.on('message_sending', async (event, ctx) => {
  // 检查消息是否包含敏感信息
  const hasSensitive = await contentFilter.check(event.content);

  if (hasSensitive) {
    // 方案1：修改内容
    return { content: event.content.replace(/密码:\s*\S+/g, '密码: [已隐藏]') };

    // 方案2：完全取消发送
    // return { cancel: true };
  }
});
```

---

## 11. 特殊入口：外部 HTTP Webhook 如何触发 Agent

除了用户直接发消息，外部系统（GitHub、Gmail、Zapier 等）可以通过 HTTP Webhook 触发 Agent。这条路径绕过了消息归一化和命令解析，直接创建一个隔离的 Agent 会话：

```
外部系统发送 HTTP POST
  │
  ▼
Gateway HTTP Server
  │
  ├── POST /hooks/wake   → 唤醒 Agent（添加系统事件）
  └── POST /hooks/agent  → 创建隔离 Agent 会话
        │
        ├── Token 认证
        ├── 解析请求体 → normalizeAgentPayload()
        │
        ▼
  dispatchAgentHook()
        │
        ├── 构造一个临时 CronJob（sessionTarget: "isolated"）
        └── 异步执行 runCronIsolatedAgentTurn()
              │
              ▼
        和正常的 Agent 执行一样：
        ├── ★ before_agent_start 钩子
        ├── Agent 核心执行（工具调用循环）
        │   └── ★ before_tool_call 钩子（每次工具调用）
        │   └── ★ tool_result_persist 钩子（每次结果持久化）
        ├── ★ agent_end 钩子
        └── 结果发送到指定渠道
```

**具体代码**：

```typescript
// src/gateway/server/hooks.ts (L32-105)
const dispatchAgentHook = (value) => {
  // 1. 创建隔离的 sessionKey
  const sessionKey = value.sessionKey.trim() || `hook:${randomUUID()}`;

  // 2. 构造临时任务
  const job: CronJob = {
    id: randomUUID(),
    name: value.name, // 如 "GitHub"
    sessionTarget: 'isolated', // 隔离会话，不影响用户的主会话
    payload: {
      kind: 'agentTurn',
      message: value.message, // 如 "New PR #123: fix auth bug"
      deliver: value.deliver, // 是否将结果发送到消息渠道
      channel: value.channel, // 发送到哪个渠道（telegram/discord/...）
      to: value.to // 发送给谁
    }
  };

  // 3. 异步执行（HTTP 立即返回 200）
  void (async () => {
    const result = await runCronIsolatedAgentTurn({
      cfg: loadConfig(),
      deps,
      job,
      message: value.message,
      sessionKey,
      lane: 'cron'
    });
    // 结果记录到系统事件
    enqueueSystemEvent(`Hook ${value.name}: ${result.summary}`, {
      sessionKey: mainSessionKey
    });
  })();
};
```

**Hook Mapping — 更灵活的外部对接**：

对于不同格式的外部 Webhook，可以配置 Mapping 规则自动转换：

```yaml
# config.yaml 中的 hooks 配置
hooks:
  enabled: true
  token: 'my-secret-token'
  mappings:
    - id: github-pr
      match: { path: 'github' }
      action: agent
      name: 'GitHub PR Review'
      sessionKey: 'hook:github:{{pull_request.number}}'
      messageTemplate: "请审查 PR #{{pull_request.number}}: {{pull_request.title}}\n\n{{pull_request.body}}"
      channel: telegram
      deliver: true
```

这样当 GitHub 发送 Webhook 到 `POST /hooks/github` 时，Gateway 会：

1. 匹配到 `github-pr` 规则
2. 用 Mustache 模板从 payload 中提取数据
3. 构造 Agent 消息并执行

---

## 12. 特殊入口：插件如何注册自定义扩展

插件通过 `register(api)` 函数在 Gateway 启动时注册所有扩展。完整的注册能力：

```typescript
// 一个完整插件的例子
export function register(api: OpenClawPluginApi) {
  // ① 注册工具 — 给 Agent 添加新能力
  api.registerTool({
    name: 'jira_search',
    description: '搜索 JIRA 工单',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async (toolCallId, params) => {
      const results = await jiraClient.search(params.query);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  });

  // ② 注册生命周期钩子
  api.on('before_agent_start', async (event, ctx) => {
    // 在 Agent 思考前注入 JIRA 项目上下文
    return { prependContext: '当前活跃的 JIRA Sprint: PROJ-2024-Q1' };
  });

  api.on('before_tool_call', async (event, ctx) => {
    // 记录所有工具调用
    await auditLog.record({
      tool: event.toolName,
      params: event.params,
      agent: ctx.agentId
    });
  });

  // ③ 注册 Gateway RPC 方法 — Web UI 可以调用
  api.registerGatewayMethod('jira.status', async ({ params, respond }) => {
    const status = await jiraClient.getProjectStatus();
    respond(true, status);
  });

  // ④ 注册 HTTP 路由 — 外部系统回调
  api.registerHttpRoute({
    path: '/plugins/jira/webhook',
    handler: async (req, res) => {
      // 处理 JIRA Webhook 通知
      const body = await readBody(req);
      // ...
      res.statusCode = 200;
      res.end('ok');
    }
  });

  // ⑤ 注册聊天命令 — 用户可以直接在聊天里使用
  api.registerCommand({
    name: 'jira',
    description: '查询 JIRA 工单状态',
    handler: async (ctx) => {
      const status = await jiraClient.getMyTasks();
      return {
        text: `你的待办工单:\n${status.map((t) => `- ${t.key}: ${t.summary}`).join('\n')}`
      };
    }
  });
}
```

**这些注册在 Gateway 中如何生效**：

```
Gateway 启动
  │
  ├── loadOpenClawPlugins()
  │     │
  │     ├── 发现所有插件（全局/工作区/配置目录）
  │     ├── 逐个加载并调用 register(api)
  │     │     ├── api.registerTool() → 存入 registry.tools
  │     │     ├── api.on() → 存入 registry.typedHooks
  │     │     ├── api.registerGatewayMethod() → 存入 registry.gatewayHandlers
  │     │     ├── api.registerHttpRoute() → 存入 registry.httpRoutes
  │     │     └── api.registerCommand() → 存入 registry.commands
  │     │
  │     └── initializeGlobalHookRunner(registry) ← 让钩子全局可用
  │
  ├── attachGatewayWsHandlers({
  │     extraHandlers: pluginRegistry.gatewayHandlers  ← 插件 RPC 方法注入 WS
  │   })
  │
  └── HTTP 路由分发时也会查 pluginRegistry.httpRoutes ← 插件 HTTP 路由
```

---

## 13. 两套钩子系统的区别

OpenClaw 有两套并存的钩子系统，它们各有职责：

### Internal Hooks（较老，用于系统级事件）

```typescript
// 注册
registerInternalHook("command:new", async (event) => {
  // event.messages.push("已保存记忆");  ← 可以回传消息
});

// 触发
const event = createInternalHookEvent("command", "new", sessionKey, { ... });
await triggerInternalHook(event);
```

- **使用场景**：Gateway 启动（`gateway:startup`）、命令处理（`command:new`、`command:stop`）、Agent bootstrap（`agent:bootstrap`）
- **执行方式**：所有 handler 顺序执行
- **通信方式**：通过 `event.messages` 数组回传消息
- **优先级**：无，按注册顺序执行

### Plugin Typed Hooks（新式，用于 Agent 生命周期）

```typescript
// 注册
api.on("before_tool_call", async (event, ctx) => {
  return { block: true, blockReason: "不允许" };  ← 通过返回值通信
}, { priority: 100 });

// 触发（由系统在对应阶段自动调用）
const result = await hookRunner.runBeforeToolCall(event, ctx);
```

- **使用场景**：Agent 生命周期全覆盖（14 种钩子）
- **执行方式**：Void 型并行 / Modifying 型按优先级顺序
- **通信方式**：通过返回值
- **优先级**：有，`priority` 越大越先执行

### 一张表看清区别

| 阶段            | 使用的钩子系统 | 钩子名                | 能做什么              |
| --------------- | -------------- | --------------------- | --------------------- |
| 消息进入        | Plugin Typed   | `message_received`    | 记录/统计（不能修改） |
| /new 命令       | Internal       | `command:new`         | 保存记忆，回传消息    |
| /stop 命令      | Internal       | `command:stop`        | 清理资源              |
| Gateway 启动    | Internal       | `gateway:startup`     | 初始化外部服务        |
| Agent bootstrap | Internal       | `agent:bootstrap`     | 修改工作区文件列表    |
| Agent 思考前    | Plugin Typed   | `before_agent_start`  | 注入上下文            |
| 工具调用前      | Plugin Typed   | `before_tool_call`    | 修改参数/阻止         |
| 工具结果存储    | Plugin Typed   | `tool_result_persist` | 裁剪/修改结果         |
| Agent 完成      | Plugin Typed   | `agent_end`           | 分析/统计             |
| 消息发送前      | Plugin Typed   | `message_sending`     | 修改内容/取消发送     |
| 消息发送后      | Plugin Typed   | `message_sent`        | 确认/审计             |

---

## 14. 钩子的容错哲学

所有钩子都遵循一个核心原则：**插件的 bug 不能让 Agent 瘫痪**。

| 场景                                       | 处理方式                   | 原因                               |
| ------------------------------------------ | -------------------------- | ---------------------------------- |
| `message_received` handler 抛异常          | 捕获 + 日志                | 通知型，不影响消息处理             |
| `before_agent_start` handler 抛异常        | 捕获 + 日志，用原始 prompt | Agent 继续执行，只是没有额外上下文 |
| `before_tool_call` handler 抛异常          | 捕获 + 日志，放行工具调用  | **宁可执行工具也不无故阻止**       |
| `tool_result_persist` handler 返回 Promise | 警告 + 忽略                | 同步路径不能等                     |
| `agent_end` handler 抛异常                 | 捕获 + 日志                | 结果已经产生了，不影响             |

```typescript
// 典型的容错模式（在 before_tool_call 中）
} catch (err) {
  log.warn(`before_tool_call hook failed: tool=${toolName} error=${String(err)}`);
}
return { blocked: false, params };  // 出错 → 默认放行
```

---

## 15. 关键代码索引

| 文件                                              | 在流程中的位置                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `src/auto-reply/reply/dispatch-from-config.ts`    | 消息入口：归一化、去重、触发 `message_received`                   |
| `src/auto-reply/reply/commands-core.ts`           | 命令解析：触发 `command:new` Internal Hook                        |
| `src/auto-reply/reply/get-reply.ts`               | 会话管理：解析 sessionKey、准备 Agent 参数                        |
| `src/agents/pi-embedded-runner/run/attempt.ts`    | Agent 核心：触发 `before_agent_start`、`agent_end`                |
| `src/agents/pi-tools.before-tool-call.ts`         | 工具钩子：`before_tool_call` 的实现和工具包装                     |
| `src/agents/session-tool-result-guard-wrapper.ts` | 结果钩子：`tool_result_persist` 的 SessionManager 集成            |
| `src/plugins/hooks.ts`                            | 钩子引擎：`createHookRunner`、`runVoidHook`、`runModifyingHook`   |
| `src/plugins/hook-runner-global.ts`               | 全局单例：`getGlobalHookRunner`、`initializeGlobalHookRunner`     |
| `src/plugins/registry.ts`                         | 注册中心：`createPluginRegistry`、`createApi`、所有 register 方法 |
| `src/plugins/loader.ts`                           | 插件加载：`loadOpenClawPlugins`、插件发现和初始化                 |
| `src/plugins/types.ts`                            | 类型定义：14 种 Hook 类型、`OpenClawPluginApi`                    |
| `src/hooks/internal-hooks.ts`                     | Internal Hook 系统：`registerInternalHook`、`triggerInternalHook` |
| `src/gateway/server.impl.ts`                      | Gateway 主入口：启动流程、插件加载、WS/HTTP 绑定                  |
| `src/gateway/server-startup.ts`                   | 附属服务启动：Internal Hook 加载、`gateway:startup` 触发          |
| `src/gateway/hooks.ts`                            | HTTP Webhook 配置：`HooksConfigResolved`、payload 解析            |
| `src/gateway/hooks-mapping.ts`                    | Webhook 映射：规则匹配、模板渲染、预置映射                        |
| `src/gateway/server/hooks.ts`                     | Webhook 分发：`dispatchAgentHook`、`dispatchWakeHook`             |
| `src/gateway/server-methods.ts`                   | RPC 方法注册：核心 + 插件方法合并、权限检查                       |

---

> **总结**：Gateway 是 Agent 和外部世界之间的唯一桥梁。消息从外部系统进入后，经过归一化 → 钩子通知 → 命令解析 → 会话管理 → Agent 执行（每个工具调用都有钩子） → 结果发送。钩子系统让插件能在这条链路的每个关键节点上做事情——记日志、注入上下文、拦截工具、过滤消息——而且任何一个钩子出错都不会打断主流程。外部系统则可以通过 HTTP Webhook 直接触发 Agent，走的是同样的 Agent 执行链路（包括所有钩子），只是跳过了消息归一化和命令解析阶段。
