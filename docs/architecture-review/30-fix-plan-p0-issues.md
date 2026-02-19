# P0 问题修复计划

> 基于第 29 轮架构分析  
> 创建时间：2026-02-19  
> 目标：修复 11 个 P0 级阻塞/严重问题

---

## 修复策略

采用**分阶段**修复策略，每个阶段完成后运行完整测试套件，确保无回归。

```
Phase 1: 核心执行层修复（Backend + Frontend 资源管理）
    ├─ 修复 ThreadWaker 绕过 pipeline
    ├─ 修复 abort 检查延迟
    └─ 修复 Frontend 资源泄漏

Phase 2: 测试覆盖补齐（高风险路径）
    ├─ tool-approval Extension 测试
    └─ GatewayClient 测试

Phase 3: Multi-Agent 产品化（用户可用性）
    ├─ 前端 mode 选择 UI
    └─ 子 Agent 审批方案
```

---

## Phase 1: 核心执行层修复

### 1.1 修复 ThreadWaker 绕过 pipeline (B-P0-1)

**问题**：`ThreadWaker.ts:234` 使用 `agentExecutor.submit()` 而非 `submitViaPipeline()`，绕过 MessagePipeline 的队列和 runId 竞态防护。

**影响**：审批后恢复时可能与 pipeline 状态冲突，无法享受排队、中断、竞态防护。

**修复方案**：

```typescript
// src/main/ai/threads/ThreadWaker.ts

// 旧代码（第 234 行）
await agentExecutor.submit({
  sessionId: threadId,
  message: resumeMessage,
  signal: undefined
});

// 新代码
await agentExecutor.submitViaPipeline(threadId, resumeMessage, 'agent');
```

**验证**：

- 运行 `async-approval-e2e.test.ts`
- 添加新测试用例：审批后恢复时，验证 pipeline 的 runId 正确递增

**预计耗时**：15 分钟

---

### 1.2 修复 OpenAI signal 未传入工具 (B-P0-2)

**问题**：`OpenAIAgentRuntime.ts:631` 调用 `executeToolPipeline` 时未传入 `signal`，工具执行期间无法响应 abort。

**影响**：用户点击停止按钮后，工具执行仍继续，无法及时中止。

**修复方案**：

```typescript
// src/main/ai/runtime/openai/OpenAIAgentRuntime.ts

// 找到 convertTools 中的 executeToolPipeline 调用（约第 631 行）
const result = await this.executeToolPipeline(
  this.sessionId,
  toolCall,
  def,
  tools,
  messages,
  // 新增：传入 signal
  signal
);
```

**同时修改 `executeToolPipeline` 方法签名**（如果尚未支持）：

```typescript
// src/main/ai/runtime/ToolExecutionPipeline.ts

async executeToolPipeline(
  sessionId: string,
  toolCall: ToolCall,
  toolDef: ToolDefinition,
  tools: ToolDefinition[],
  messages: any[],
  signal?: AbortSignal  // 确保有此参数
): Promise<ToolResult> {
  // ...
  // 在 Phase 1: before_tool_call Hook 中传入 signal
  // 在 Phase 3: def.execute() 中传入 signal
}
```

**验证**：

- 运行 `OpenAIAgentRuntime.test.ts`
- 手动测试：启动 OpenAI Agent，调用工具后立即点击停止，验证工具是否中止

**预计耗时**：30 分钟

---

### 1.3 修复 consumeAndForward abort 检查延迟 (B-P0-3)

**问题**：`AgentExecutor.ts:348` 仅在 `while` 循环每次迭代时检查 `signal?.aborted`，若 `gen.next()` 长时间阻塞（如工具执行），abort 无法及时生效。

**影响**：用户点击停止后，要等到当前 chunk 处理完才会中止，响应不及时。

**修复方案（两个层次）**：

#### 1.3.1 在 consumeAndForward 中增加超时检查

```typescript
// src/main/ai/AgentExecutor.ts

private async consumeAndForward(
  gen: AsyncGenerator<StreamChunk>,
  eventWriter: AgentEventWriter | null,
  sessionId: string,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  let r = await gen.next();
  while (!r.done) {
    // 现有：每次迭代开头检查
    if (signal?.aborted) {
      await gen.return?.();
      return;
    }

    const chunk = r.value;

    // ... 现有处理逻辑 ...

    // 新增：用 Promise.race 为 gen.next() 增加 abort 检查
    r = await Promise.race([
      gen.next(),
      new Promise<IteratorResult<StreamChunk>>((resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new Error('Aborted by user'));
          });
        }
      })
    ]);
  }
}
```

#### 1.3.2 在工具执行层面传递 signal

确保 `executeToolPipeline` 将 `signal` 传递给工具的 `execute` 方法：

```typescript
// src/main/ai/runtime/ToolExecutionPipeline.ts

// Phase 3: def.execute()
const result = await def.execute(toolInput, {
  sessionId: this.sessionId,
  signal // 确保传入
});
```

**验证**：

- 运行 `AgentExecutor.test.ts`
- 手动测试：调用耗时工具（如 `sleep 60`），立即点击停止，验证是否在 1 秒内中止

**预计耗时**：45 分钟

---

### 1.4 修复 Copilot 监听器泄漏 (F-P0-1)

**问题**：`stores/copilot.ts:63-68` 每次 `sendMessage` 可能调用 `initStreamListener`，`gateway.onConnect()` 返回的取消函数未保存，重连时累积重复 handler。

**影响**：重连多次后，每次流式事件都会触发多个重复的 handler，造成内存泄漏和 CPU 浪费。

**修复方案**：

```typescript
// src/renderer/src/stores/copilot.ts

import { defineStore } from 'pinia';

export const useCopilotStore = defineStore('copilot', () => {
  // ... 现有状态 ...

  // 新增：保存取消函数
  let cleanupStreamListener: (() => void) | null = null;
  let cleanupOnConnect: (() => void) | null = null;

  function initStreamListener() {
    // 先清理旧监听器
    if (cleanupStreamListener) {
      cleanupStreamListener();
      cleanupStreamListener = null;
    }
    if (cleanupOnConnect) {
      cleanupOnConnect();
      cleanupOnConnect = null;
    }

    // 注册新监听器
    cleanupStreamListener = gateway.on('stream.message', (event) => {
      // ... 现有逻辑 ...
    });

    cleanupOnConnect = gateway.onConnect(() => {
      gateway.request('stream.subscribe', { sessionId: copilotSessionId.value });
    });
  }

  function sendMessage(text: string) {
    // 只在首次时初始化
    if (!cleanupStreamListener) {
      initStreamListener();
    }
    // ... 现有逻辑 ...
  }

  // 新增：清理函数
  function cleanup() {
    if (cleanupStreamListener) {
      cleanupStreamListener();
      cleanupStreamListener = null;
    }
    if (cleanupOnConnect) {
      cleanupOnConnect();
      cleanupOnConnect = null;
    }
  }

  return {
    // ... 现有导出 ...
    cleanup
  };
});
```

**在 App.vue 中调用清理**：

```typescript
// src/renderer/src/App.vue

import { useCopilotStore } from './stores/copilot';
import { onUnmounted } from 'vue';

const copilotStore = useCopilotStore();

onUnmounted(() => {
  copilotStore.cleanup();
});
```

**验证**：

- 手动测试：启动应用 → Copilot 发送消息 → 断开网络 → 重连 → 再次发送 → 检查控制台日志是否有重复处理

**预计耗时**：30 分钟

---

### 1.5 调用 streamCleanup / cleanupThreadWs (F-P0-2)

**问题**：`composables/useStreamWs.ts:171` 的 `streamCleanup()` 从未调用，应用销毁时监听器泄漏。

**影响**：EventBus 监听器和 Gateway 回调不会清理，内存泄漏。

**修复方案**：

#### 方案 A：在 App.vue 中统一清理

```typescript
// src/renderer/src/App.vue

import { onUnmounted } from 'vue';
import { streamCleanup } from './composables/useStreamWs';
import { cleanupThreadWs } from './composables/useThreadWs';

onUnmounted(() => {
  streamCleanup();
  cleanupThreadWs();
});
```

#### 方案 B：监听主进程的 APP_BEFORE_QUIT 事件

```typescript
// src/renderer/src/main.ts

import { eventBus } from './services/EventBus';
import { streamCleanup } from './composables/useStreamWs';
import { cleanupThreadWs } from './composables/useThreadWs';

eventBus.on('APP_BEFORE_QUIT', () => {
  streamCleanup();
  cleanupThreadWs();
});
```

**推荐方案 A**（更直接）。

**验证**：

- 运行应用 → 订阅流 → 关闭应用 → 检查是否有未清理的定时器或监听器（通过浏览器 DevTools）

**预计耗时**：20 分钟

---

## Phase 2: 测试覆盖补齐

### 2.1 为 tool-approval Extension 增加测试 (T-P0-1)

**问题**：`extensions/tool-approval/` 无测试，HITL 核心逻辑所在。

**目标**：覆盖 `before_tool_call` Hook 的各种场景。

**测试计划**：

```
extensions/tool-approval/__tests__/tool-approval.test.ts

测试用例：
1. ExecPolicy.allow → 直接放行
2. ExecPolicy.deny → 阻止执行
3. ExecPolicy.ask + asyncMode → 发出 hitl:required 事件 + 返回 suspend: true
4. needUserConfirm=true + syncMode → 调用 hitlApprovalManager.waitForSingleDecision
5. 审批超时 → 返回拒绝
6. sessionCounters 增量
7. approve-once → 执行工具
8. reject → 不执行工具
9. approve-always → 保存到 autoApprovals
10. 第二次同工具调用，autoApprovals 生效
```

**实现框架**：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createExtension } from '../index';
import type { ExtensionContext } from '@main/common/extension/types';

describe('tool-approval Extension', () => {
  let extension: ReturnType<typeof createExtension>;
  let mockContext: ExtensionContext;
  let mockHitlManager: any;
  let mockEventWriter: any;

  beforeEach(() => {
    // 初始化 mock
    mockHitlManager = {
      waitForSingleDecision: vi.fn(),
      hasSinglePending: vi.fn().mockReturnValue(false)
    };
    mockEventWriter = {
      dispatch: vi.fn()
    };
    mockContext = {
      // ... 构造 ExtensionContext
    };

    extension = createExtension();
  });

  it('ExecPolicy.allow → 直接放行', async () => {
    // ... 测试逻辑
  });

  // ... 其它用例
});
```

**预计耗时**：2 小时

---

### 2.2 为 GatewayClient 增加测试 (F-P0-3)

**问题**：`src/renderer/` 无测试，GatewayClient 的 WebSocket 连接、重连、RPC、事件订阅无测试。

**目标**：

1. 验证重连后调用 `stream.resend`（第 26/28 轮 P0-3）
2. 验证 RPC 超时处理
3. 验证事件订阅和取消

**测试计划**：

```
src/renderer/src/services/__tests__/GatewayClient.test.ts

测试用例：
1. 连接成功 → connectionState = 'connected'
2. 连接失败 → 指数退避重连
3. 重连成功 → 触发 onConnect 回调
4. 重连成功 → 调用 stream.resend
5. RPC 请求 → 30s 超时
6. 事件订阅 → on() → 收到事件
7. 取消订阅 → off() → 不再收到事件
8. 断开时 rejectAllPending
```

**实现框架**（需配置 Vitest 支持 renderer）：

```typescript
// vitest.config.ts 增加

export default defineConfig({
  test: {
    include: [
      'src/main/**/__tests__/**/*.test.ts',
      'src/renderer/**/__tests__/**/*.test.ts' // 新增
    ],
    environment: 'jsdom' // 为 renderer 测试提供浏览器环境
  }
});
```

```typescript
// src/renderer/src/services/__tests__/GatewayClient.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GatewayClient } from '../GatewayClient';

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: (() => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  triggerOpen() {
    this.onopen?.();
  }
  triggerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  triggerClose() {
    this.onclose?.();
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

describe('GatewayClient', () => {
  let client: GatewayClient;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    client = new GatewayClient();
    mockWs = new MockWebSocket();
  });

  it('连接成功', async () => {
    client.connect();
    mockWs.triggerOpen();
    expect(client.connectionState.value).toBe('connected');
  });

  it('重连后调用 stream.resend', async () => {
    // ... 测试逻辑
  });

  // ... 其它用例
});
```

**预计耗时**：3 小时

---

## Phase 3: Multi-Agent 产品化

### 3.1 前端增加 mode 选择 UI (M-P0-1)

**问题**：`chat.send` 未传 `mode`，始终为 `agent`，用户无法使用 Orchestrator/Swarm。

**修复方案（分步骤）**：

#### 步骤 1：扩展 Thread 创建 API

```typescript
// src/main/gateway/methods/threads.ts

export const threadMethods = {
  create: async (params: {
    title?: string;
    agentId?: string;
    agentType?: 'agent' | 'orchestrator' | 'swarm'; // 新增
  }) => {
    const { title, agentId, agentType = 'agent' } = params;

    const thread = await db.threads.create({
      title: title || `Thread ${Date.now()}`,
      agentId,
      agentType // 保存到数据库
      // ...
    });

    return thread;
  }
};
```

#### 步骤 2：在 AgentView 中增加 mode 选择

```vue
<!-- src/renderer/src/views/AgentView.vue -->

<template>
  <div>
    <!-- 现有：Agent 选择 -->
    <select v-model="selectedAgentId">
      <option v-for="agent in agents" :key="agent.id" :value="agent.id">
        {{ agent.name }}
      </option>
    </select>

    <!-- 新增：Mode 选择 -->
    <div class="mode-selector">
      <label>执行模式：</label>
      <select v-model="selectedMode">
        <option value="agent">单 Agent</option>
        <option value="orchestrator">编排模式</option>
        <option value="swarm">蜂群模式</option>
      </select>
      <p class="mode-description">{{ getModeDescription(selectedMode) }}</p>
    </div>

    <button @click="startThread">开始对话</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { gateway } from '@/services/GatewayClient';

const selectedAgentId = ref<string>('');
const selectedMode = ref<'agent' | 'orchestrator' | 'swarm'>('agent');
const router = useRouter();

function getModeDescription(mode: string): string {
  const descriptions = {
    agent: '单个智能体独立完成任务',
    orchestrator: '程序化多智能体编排，适合可分解的复杂任务',
    swarm: '智能体间动态协作，通过 handoff 机制自主决策'
  };
  return descriptions[mode] || '';
}

async function startThread() {
  const thread = await gateway.request('threads.create', {
    agentId: selectedAgentId.value,
    agentType: selectedMode.value // 传入 mode
  });
  router.push(`/thread/${thread.id}`);
}
</script>
```

#### 步骤 3：在 chat.send 中传入 mode

```typescript
// src/renderer/src/stores/chat.ts

export const useChatStore = defineStore('chat', () => {
  // ...

  async function sendMessage(text: string) {
    // 获取当前 Thread 的 agentType
    const thread = threadsStore.threads.find((t) => t.id === activeThreadId.value);
    const mode = thread?.agentType || 'agent';

    await gateway.request('chat.send', {
      sessionId: activeThreadId.value,
      message: text,
      mode // 传入 mode
    });
  }

  // ...
});
```

#### 步骤 4：后端 chat.send 已支持 mode，无需修改

`src/main/gateway/methods/chat.ts:176-216` 已有 mode 分支，直接可用。

**验证**：

- 创建 Thread 时选择 orchestrator → 发送消息 → 验证后端执行 OrchestratorRuntime
- 创建 Thread 时选择 swarm → 发送消息 → 验证后端执行 SwarmRuntime

**预计耗时**：2 小时

---

### 3.2 修复子 Agent 审批问题 (M-P0-2)

**问题**：子 Agent 审批事件按子 sessionId 分发，前端只订阅主 thread，子 Agent 审批会阻塞。

**方案选择**：

#### 方案 A：前端订阅子 sessionId（推荐）

**优点**：改动最小，逻辑清晰  
**缺点**：需要解析 sessionId 格式

```typescript
// src/renderer/src/composables/useStreamWs.ts

function subscribeToThread(threadId: string) {
  // 订阅主 thread
  gateway.request('stream.subscribe', { sessionId: threadId });

  // 同时订阅所有可能的子 sessionId
  // delegate: {threadId}:delegate:*
  // worker: {threadId}:worker:*
  // swarm: {threadId}:swarm:*

  // 方案 1：后端支持通配符订阅
  gateway.request('stream.subscribe', { sessionId: `${threadId}:*` });

  // 方案 2：监听 stream.message，根据 sessionId 前缀过滤
  const unsubscribe = gateway.on('stream.message', (event) => {
    if (event.sessionId.startsWith(`${threadId}:`)) {
      // 处理子 Agent 事件
      handleStreamMessage(event);
    }
  });
}
```

#### 方案 B：后端转发子 Agent 审批事件到主 thread

```typescript
// src/main/ai/AgentEventWriter.ts

public static dispatchForSession(sessionId: string, chunk: StreamChunk): void {
  // 现有逻辑
  this.dispatch(sessionId, chunk);

  // 新增：如果是子 sessionId，同时转发到主 thread
  if (sessionId.includes(':')) {
    const mainThreadId = sessionId.split(':')[0];
    const modifiedChunk = {
      ...chunk,
      data: {
        ...chunk.data,
        subSessionId: sessionId  // 标记来源
      }
    };
    this.dispatch(mainThreadId, modifiedChunk);
  }
}
```

#### 方案 C：子 Agent 审批自动通过

```typescript
// src/main/ai/tools/builtin/delegate-to-agent.ts

// 创建子 Agent 时，设置 autoApprove
const childBuilder = createBuilderFromDefinition(agentDef).setSessionId(childSessionId).setExecPolicy({
  mode: 'allow', // 子 Agent 工具自动通过
  allowedCommands: '*'
});
```

**推荐方案 B**（后端转发），用户体验最好。

**验证**：

- 主 Agent 调用 `delegate_to_agent` → 子 Agent 调用需审批的工具（如 `exec`）→ 前端显示审批卡片 → 用户点击允许 → 子 Agent 继续执行

**预计耗时**：2 小时

---

## 总结

### 时间估算

| 阶段        | 任务                 | 预计耗时 |
| ----------- | -------------------- | -------- |
| **Phase 1** | ThreadWaker pipeline | 15 分钟  |
|             | OpenAI signal        | 30 分钟  |
|             | abort 检查           | 45 分钟  |
|             | Copilot 泄漏         | 30 分钟  |
|             | streamCleanup        | 20 分钟  |
| **Phase 2** | tool-approval 测试   | 2 小时   |
|             | GatewayClient 测试   | 3 小时   |
| **Phase 3** | mode 选择 UI         | 2 小时   |
|             | 子 Agent 审批        | 2 小时   |

**总计：约 11 小时**

### 优先级建议

**今天完成**：Phase 1（2.5 小时）  
**本周完成**：Phase 2（5 小时）  
**下周完成**：Phase 3（4 小时）

### 执行顺序

1. ✅ **Phase 1.1** - ThreadWaker（15 分钟）
2. ✅ **Phase 1.5** - streamCleanup（20 分钟）
3. ✅ **Phase 1.4** - Copilot 泄漏（30 分钟）
4. ✅ **Phase 1.2** - OpenAI signal（30 分钟）
5. ✅ **Phase 1.3** - abort 检查（45 分钟）
6. **Phase 2.1** - tool-approval 测试（2 小时）
7. **Phase 2.2** - GatewayClient 测试（3 小时）
8. **Phase 3.1** - mode 选择 UI（2 小时）
9. **Phase 3.2** - 子 Agent 审批（2 小时）

---

## 执行记录

| 任务      | 状态      | 开始时间 | 完成时间 | 实际耗时 | 备注 |
| --------- | --------- | -------- | -------- | -------- | ---- |
| Phase 1.1 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 1.2 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 1.3 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 1.4 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 1.5 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 2.1 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 2.2 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 3.1 | ⏳ 待开始 | -        | -        | -        | -    |
| Phase 3.2 | ⏳ 待开始 | -        | -        | -        | -    |
