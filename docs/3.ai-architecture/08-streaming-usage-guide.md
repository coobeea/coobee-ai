# 流式输出使用指南

本文档说明如何使用基于 EventBus 的流式输出系统。

## 目录

- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [生产者使用](#生产者使用)
- [消费者使用](#消费者使用)
- [前端集成](#前端集成)
- [监控与调试](#监控与调试)

---

## 系统架构

```
┌────────────────────────┐
│  Agent/Team Runtime    │
│   (StreamEmitter)      │ ←─ 生产者：发送消息
└───────────┬────────────┘
            │ emit() 发送到 EventBus
            ↓
┌───────────────────────────┐
│      EventBus (中心)       │
└───────────────────────────┘
            │
    ┌───────┼───────┐
    ↓       ↓       ↓
┌────────┐┌────────┐┌────────┐
│StreamS ││WebSock ││StreamM │
│tore    ││etBroad ││onitor  │ ←─ 消费者：接收并处理
│(持久化) ││caster  ││(监控)  │
└────────┘└────────┘└────────┘
          │
          ↓
    ┌──────────┐
    │ Frontend │
    └──────────┘
```

---

## 快速开始

### 1. 初始化消费者

在应用启动时初始化所有消费者：

```typescript
import { streamStore, webSocketBroadcaster, streamMonitor } from '@main/ai';

// 1. 初始化持久化消费者
await streamStore.initialize();

// 2. 初始化 WebSocket 推送消费者（指定端口）
webSocketBroadcaster.initialize(8765);

// 3. 初始化监控消费者
streamMonitor.initialize();

console.log('流式输出系统初始化完成');
```

### 2. 创建 Agent/Team Runtime

```typescript
import { runtimeFactory } from '@main/ai';

// 创建 Agent Runtime
const agentRuntime = await runtimeFactory.createRuntime({
  type: 'agent',
  id: 'agent-001',
  sessionId: 'session-123' // 可选，默认自动生成
});

// 初始化（内部会创建 StreamEmitter）
await agentRuntime.initialize();
```

### 3. 使用流式执行

```typescript
// 执行 Agent 并自动发送流式消息
const result = await agentRuntime.runStream(
  'Tell me a joke',
  {}, // ExecutionConfig
  (chunk) => {
    // 可选的回调（兼容旧接口）
    console.log('Chunk:', chunk);
  }
);

console.log('Result:', result.output);
```

---

## 生产者使用

### StreamEmitter API

`StreamEmitter` 由 Runtime 内部创建，自动发送消息到 EventBus。

#### 发送文本消息

```typescript
await streamEmitter.emitText('Hello, this is a text message');
```

#### 发送思考消息

```typescript
await streamEmitter.emitThinking('Processing your request...');
```

#### 发送工具调用消息

```typescript
await streamEmitter.emitToolCall({
  name: 'search',
  arguments: { query: 'AI' },
  result: { results: ['...'] }
});
```

#### 发送错误消息

```typescript
try {
  // ...
} catch (error) {
  await streamEmitter.emitError(error as Error);
}
```

#### 发送流开始/结束事件

```typescript
// 开始
await streamEmitter.emitStart();

// 处理...

// 结束
await streamEmitter.emitDone();
```

---

## 消费者使用

### StreamStore（持久化消费者）

持久化所有流式消息到 SQLite。

#### 查询消息

```typescript
import { streamStore } from '@main/ai';

// 获取会话的所有消息（按序号）
const messages = await streamStore.getMessages('session-123');

// 从指定序号开始获取
const newMessages = await streamStore.getMessages('session-123', 10);

// 获取最新序号
const latestSeq = await streamStore.getLatestSequence('session-123');
```

#### 清理消息

```typescript
// 清理 7 天前的消息
await streamStore.cleanOldMessages(7);

// 清除会话的所有消息
await streamStore.clearSession('session-123');
```

### WebSocketBroadcaster（推送消费者）

推送流式消息到 WebSocket 客户端。

#### 服务端

```typescript
import { webSocketBroadcaster } from '@main/ai';

// 初始化（默认端口 8765）
webSocketBroadcaster.initialize(8765);

// 后续消息会自动推送给已订阅的客户端
```

#### 客户端协议

```typescript
// 连接
const ws = new WebSocket('ws://localhost:8765');

// 订阅会话
ws.send(
  JSON.stringify({
    type: 'subscribe',
    sessionId: 'session-123'
  })
);

// 接收消息
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'message':
      console.log('New message:', msg.data);
      break;
    case 'resend_batch':
      console.log('Resent messages:', msg.data);
      break;
    case 'error':
      console.error('Error:', msg.data.error);
      break;
  }
};

// 重发消息（恢复场景）
ws.send(
  JSON.stringify({
    type: 'resend',
    sessionId: 'session-123',
    fromSequence: 5
  })
);

// 取消订阅
ws.send(
  JSON.stringify({
    type: 'unsubscribe',
    sessionId: 'session-123'
  })
);
```

### StreamMonitor（监控消费者）

收集会话级别的统计信息。

```typescript
import { streamMonitor } from '@main/ai';

// 初始化
streamMonitor.initialize();

// 获取会话统计
const stats = streamMonitor.getStats('session-123');
console.log('Session stats:', {
  messageCount: stats.messageCount,
  errorCount: stats.errorCount,
  duration: stats.endTime ? stats.endTime - stats.startTime : null
});

// 获取所有会话统计
const allStats = streamMonitor.getAllStats();
```

---

## 前端集成

### Vue 3 组件示例

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { StreamMessage } from '@shared/types';

const messages = ref<StreamMessage[]>([]);
const isConnected = ref(false);
let ws: WebSocket | null = null;

const sessionId = 'session-123';

onMounted(() => {
  // 连接 WebSocket
  ws = new WebSocket('ws://localhost:8765');

  ws.onopen = () => {
    isConnected.value = true;
    // 订阅会话
    ws?.send(
      JSON.stringify({
        type: 'subscribe',
        sessionId
      })
    );
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'message') {
      messages.value.push(msg.data);
    } else if (msg.type === 'resend_batch') {
      messages.value = msg.data.sort((a, b) => a.sequence - b.sequence);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    isConnected.value = false;
  };

  ws.onclose = () => {
    isConnected.value = false;
    // 自动重连
    setTimeout(() => {
      if (!isConnected.value) {
        onMounted();
      }
    }, 3000);
  };
});

onUnmounted(() => {
  if (ws) {
    ws.send(
      JSON.stringify({
        type: 'unsubscribe',
        sessionId
      })
    );
    ws.close();
  }
});
</script>

<template>
  <div>
    <div v-if="!isConnected">Connecting...</div>
    <div v-else>
      <h2>Stream Messages</h2>
      <div v-for="msg in messages" :key="msg.id">
        <div :class="`message-${msg.type}`">
          <span class="seq">#{{ msg.sequence }}</span>
          <span class="content">{{ msg.content }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
```

### 断线重连与消息恢复

```typescript
// 断线重连示例
function reconnectWebSocket(sessionId: string) {
  const ws = new WebSocket('ws://localhost:8765');

  ws.onopen = async () => {
    // 1. 获取本地最新序号
    const lastSeq = getLastLocalSequence(sessionId);

    // 2. 订阅会话
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        sessionId
      })
    );

    // 3. 请求重发丢失的消息
    if (lastSeq > 0) {
      ws.send(
        JSON.stringify({
          type: 'resend',
          sessionId,
          fromSequence: lastSeq + 1
        })
      );
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'resend_batch') {
      // 收到重发的消息，补充到本地
      messages.value.push(...msg.data);
      saveLocalMessages(sessionId, msg.data);
    }
  };

  return ws;
}
```

---

## 监控与调试

### 查看实时统计

```typescript
// 每 5 秒输出一次统计
setInterval(() => {
  const allStats = streamMonitor.getAllStats();
  console.table(allStats);
}, 5000);
```

### 查看数据库中的消息

```bash
# 使用 SQLite CLI
sqlite3 ~/.coobee-ai/app.db

# 查询最近的消息
SELECT * FROM stream_messages
WHERE session_id = 'session-123'
ORDER BY sequence DESC
LIMIT 10;

# 统计消息类型分布
SELECT type, COUNT(*) as count
FROM stream_messages
WHERE session_id = 'session-123'
GROUP BY type;
```

### WebSocket 调试工具

推荐使用以下工具测试 WebSocket 连接：

- **Postman**: 支持 WebSocket 连接测试
- **wscat**: 命令行工具

```bash
# 安装 wscat
npm install -g wscat

# 连接并订阅
wscat -c ws://localhost:8765
> {"type":"subscribe","sessionId":"session-123"}
```

---

## 最佳实践

### 1. 消息序号管理

- **生产者**: 使用 `StreamEmitter`，自动管理序号
- **消费者**: 按序号排序消息，确保顺序正确

### 2. 错误处理

- 捕获所有错误并使用 `emitError()` 发送
- 前端显示错误提示，并允许用户重试

### 3. 资源清理

- 定期调用 `streamStore.cleanOldMessages()` 清理旧消息
- 前端断开连接时，发送 `unsubscribe` 消息

### 4. 性能优化

- 使用 `fromSequence` 参数避免重复获取消息
- 前端使用虚拟滚动渲染大量消息

### 5. 安全

- WebSocket 端口不要暴露到公网
- 添加身份验证（future）

---

## 故障排查

### 问题 1: 消息未收到

**检查**:

1. 消费者是否已初始化？
2. EventBus 是否正常工作？
3. WebSocket 是否已连接？

**解决**:

```typescript
// 检查消费者初始化状态
console.log('Initialized:', {
  store: streamStore,
  broadcaster: webSocketBroadcaster,
  monitor: streamMonitor
});
```

### 问题 2: 消息顺序错乱

**原因**: 网络延迟导致消息乱序

**解决**:

```typescript
// 前端按序号排序
messages.value.sort((a, b) => a.sequence - b.sequence);
```

### 问题 3: WebSocket 频繁断开

**原因**: 网络不稳定或超时

**解决**:

- 实现心跳机制（已包含 `ping/pong`）
- 增加重连延迟
- 检查防火墙设置

---

## 总结

流式输出系统提供了：

✅ **可靠性**: 持久化 + 序号机制，确保消息不丢失  
✅ **可恢复性**: 断线重连后可恢复丢失的消息  
✅ **可扩展性**: 基于 EventBus，易于添加新消费者  
✅ **可监控性**: 内置监控统计，方便调试

使用此系统，你可以构建稳定、可靠的 AI Agent 流式交互体验！
