# 定时任务推送机制设计方案

> 文档版本：1.0
> 创建日期：2026-03-02
> 状态：设计稿

---

## 一、需求背景

### 1.1 当前问题

目前定时任务系统（CronJob）在执行完成后**没有任何推送通知机制**，导致：

1. **前端无法实时感知任务完成** - 用户必须手动刷新页面才能看到执行结果
2. **无法及时获知任务失败** - 任务执行失败时没有即时通知
3. **缺乏执行进度反馈** - 用户不知道任务何时开始、何时结束

### 1.2 需求目标

| 目标         | 描述                               | 优先级 |
| ------------ | ---------------------------------- | ------ |
| **实时推送** | 任务执行完成后，前端能立即收到通知 | P0     |
| **状态感知** | 区分成功/失败状态，提供不同反馈    | P0     |
| **结果展示** | 推送内容包含执行结果摘要           | P1     |
| **系统通知** | 可选的桌面系统通知                 | P2     |
| **执行进度** | 支持任务开始/结束的全流程推送      | P2     |

---

## 二、现状分析

### 2.1 当前执行流程

```
┌─────────────────────────────────────────────────────────────┐
│ CronScheduler (调度器)                                       │
│   └── 到达 cron 表达式时间点 → 触发执行                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ CronJobExecutor (执行器) - src/main/ai/cron/CronJobExecutor.ts
│                                                              │
│  1. 创建 sessionId: `cron-{jobId}-{timestamp}`              │
│  2. 选择 Agent: job.agentId || 'app-copilot'                │
│  3. 调用 agentExecutor.submitAndWait()                       │
│  4. 等待 Agent 执行完成                                        │
│  5. 记录执行状态到 .home/cron/executions/{jobId}/{id}.json  │
│                                                              │
│  ❌ 执行完成后：仅记录日志，无任何推送                         │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │ CronJobStore    │
            │ (持久化存储)     │
            └─────────────────┘
```

### 2.2 当前代码（无推送）

```typescript
// src/main/ai/cron/CronJobExecutor.ts:61-100

// 成功路径
execution.status = 'success';
execution.endedAt = new Date().toISOString();
execution.result = result.output || '执行成功';
await this.store.updateExecutionStatus(job.id, {
  lastRunAt: execution.startedAt,
  runCount: job.runCount + 1
});
log.info(`[CronJobExecutor] 作业执行成功：${job.id}`); // ← 仅记录日志

// 失败路径
execution.status = 'failed';
execution.error = errorMessage;
await this.store.updateExecutionStatus(job.id, {
  lastRunAt: execution.startedAt,
  runCount: job.runCount + 1,
  failCount: job.failCount + 1,
  lastError: errorMessage
});
log.error(`[CronJobExecutor] 作业执行失败：${job.id}`, error); // ← 仅记录日志

// 连续失败 3 次自动禁用
if (job.failCount + 1 >= 3) {
  await this.store.update(job.id, {
    status: 'disabled',
    lastError: `连续失败 ${job.failCount + 1} 次，已自动禁用`
  });
}
```

### 2.3 可复用的推送基础设施

项目中已有完善的推送基础设施：

| 机制               | 文件位置                                  | 适用场景             |
| ------------------ | ----------------------------------------- | -------------------- |
| **WebSocket 广播** | `src/main/gateway/Gateway.ts`             | 所有连接的客户端     |
| **IPC 事件**       | `src/main/common/ipc/eventBroadcaster.ts` | Electron 窗口/标签页 |
| **系统通知**       | `src/main/ai/tavern/TaskScheduler.ts`     | 桌面级通知           |
| **EventBus**       | `src/main/common/eventbus.ts`             | 模块间解耦通信       |

### 2.4 参考实现：TaskScheduler 通知

```typescript
// src/main/ai/tavern/TaskScheduler.ts:383-399

if (this.enableNotification) {
  this.sendNotification(`任务完成：${taskId}`, '执行成功');
}

private sendNotification(title: string, body: string): void {
  import('electron')
    .then(({ Notification }) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    });
}
```

---

## 三、方案设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         推送架构设计                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐      ┌──────────────┐      ┌───────────────┐  │
│  │ CronJobExecutor │ ───► │   EventBus   │ ───► │  CronBridge   │  │
│  │   (执行器)       │ emit │ 'cron:*'     │ on   │  (事件桥接)    │  │
│  └─────────────────┘      └──────────────┘      └───────┬───────┘  │
│                                                         │           │
│                    ┌────────────────────────────────────┤           │
│                    │                                    │           │
│                    ▼                                    ▼           │
│         ┌──────────────────┐              ┌────────────────────┐   │
│         │ Gateway          │              │ Electron           │   │
│         │ broadcastEvent() │              │ Notification       │   │
│         └────────┬─────────┘              └────────────────────┘   │
│                  │                                                 │
│         ┌────────▼─────────┐                                      │
│         │ WebSocket Clients│                                      │
│         │ (前端 GatewayClient)                                    │
│         └──────────────────┘                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 事件类型定义

```typescript
// src/shared/ipc/events.ts 或新建 src/shared/cron-events.ts

/** Cron 任务事件类型 */
interface CronEvents {
  /** 任务开始执行 */
  'cron:started': {
    jobId: string;
    jobName: string;
    startedAt: string; // ISO 8601
    sessionId: string;
  };

  /** 任务执行完成（成功） */
  'cron:completed': {
    jobId: string;
    jobName: string;
    status: 'success';
    result: string;
    startedAt: string;
    endedAt: string;
    duration: number; // 执行时长 (ms)
  };

  /** 任务执行失败 */
  'cron:failed': {
    jobId: string;
    jobName: string;
    status: 'failed';
    error: string;
    startedAt: string;
    endedAt: string;
    failCount: number; // 连续失败次数
    willDisable: boolean; // 是否将自动禁用
  };

  /** 任务被自动禁用 */
  'cron:disabled': {
    jobId: string;
    jobName: string;
    reason: string;
    failCount: number;
    disabledAt: string;
  };
}
```

### 3.3 数据流设计

```
时序图：

CronScheduler     CronJobExecutor      EventBus        CronBridge      Gateway       Frontend
     │                  │                  │               │             │              │
     │  trigger()       │                  │               │             │              │
     │─────────────────►│                  │               │             │              │
     │                  │                  │               │             │              │
     │                  │ emit('cron:started')             │             │              │
     │                  │─────────────────►│               │             │              │
     │                  │                  │               │             │              │
     │                  │                  │ on('cron:*')  │             │              │
     │                  │                  │──────────────►│             │              │
     │                  │                  │               │             │              │
     │                  │                  │               │ broadcast   │              │
     │                  │                  │               │────────────►│              │
     │                  │                  │               │             │              │
     │                  │                  │               │             │  WebSocket    │
     │                  │                  │               │             │──────────────►│
     │                  │                  │               │             │              │
     │                  │ (执行任务...)      │               │             │              │
     │                  │                  │               │             │              │
     │                  │                  │               │             │              │
     │                  │ emit('cron:completed/failed')    │             │              │
     │                  │─────────────────►│               │             │              │
     │                  │                  │               │             │              │
     │                  │                  │──────────────►│             │              │
     │                  │                  │               │             │              │
     │                  │                  │               │ broadcast   │              │
     │                  │                  │               │────────────►│              │
     │                  │                  │               │             │              │
     │                  │                  │               │             │  WebSocket    │
     │                  │                  │               │             │──────────────►│
     │                  │                  │               │             │              │
```

---

## 四、实现方案

### 4.1 方案 A：EventBus + EventBridge（推荐）

#### 优点

- ✅ 符合项目现有架构（参考 AgentEventBridge 等 7 个 Bridge）
- ✅ CronJobExecutor 与 Gateway 解耦
- ✅ EventBus 集中管理，便于调试和扩展
- ✅ 支持多个 Bridge 监听同一事件

#### 缺点

- ⚠️ 需要新增文件（CronBridge.ts）
- ⚠️ 代码改动较多

#### 改动清单

| 文件                                    | 操作     | 说明                              |
| --------------------------------------- | -------- | --------------------------------- |
| `src/shared/ipc/events.ts`              | 修改     | 添加 Cron 事件类型定义            |
| `src/main/ai/cron/CronJobExecutor.ts`   | 修改     | 注入 eventBus，执行前后 emit 事件 |
| `src/main/gateway/events/CronBridge.ts` | **新建** | Cron 事件桥接                     |
| `src/renderer/src/views/CronView.vue`   | 修改     | 添加 WebSocket 事件监听           |

---

### 4.2 方案 B：直接调用 Gateway 广播

#### 优点

- ✅ 实现简单，代码改动少
- ✅ 不需要新增文件

#### 缺点

- ❌ CronJobExecutor 依赖 Gateway，耦合度高
- ❌ 不符合项目现有架构模式
- ❌ 难以扩展（如添加过滤、多路推送）

#### 改动清单

| 文件                                  | 操作 | 说明                                       |
| ------------------------------------- | ---- | ------------------------------------------ |
| `src/main/ai/cron/CronJobExecutor.ts` | 修改 | 注入 getGateway()，直接调用 broadcastEvent |
| `src/renderer/src/views/CronView.vue` | 修改 | 添加 WebSocket 事件监听                    |

---

### 4.3 方案 C：多层推送（最完整）

结合 EventBus + Electron Notification，提供完整推送体验。

#### 推送层级

```
执行完成
   │
   ├──► EventBus → CronBridge → WebSocket (前端实时更新)  [P0]
   │
   ├──► Electron Notification (系统通知，可选配置)        [P2]
   │
   └──► 写入执行日志 (已有)                               [已有]
```

#### 配置选项

在 cron 作业定义中添加通知配置：

```typescript
interface CronJobDefinition {
  id: string;
  name: string;
  task: string;
  cronExpression: string;
  agentId?: string;
  status: 'active' | 'disabled';
  // 新增通知配置
  notification?: {
    enabled: boolean; // 是否启用通知 (默认 true)
    onSuccess: boolean; // 成功时通知 (默认 false)
    onFailure: boolean; // 失败时通知 (默认 true)
    systemNotification: boolean; // 系统通知 (默认 false)
  };
}
```

---

## 五、详细实现（方案 A）

### 5.1 修改事件类型定义

**文件**: `src/shared/ipc/events.ts`

```typescript
// 添加 Cron 相关事件类型
export interface CronEventMap {
  'cron:job-started': {
    jobId: string;
    jobName: string;
    startedAt: number;
  };
  'cron:job-completed': {
    jobId: string;
    jobName: string;
    status: 'success';
    result: string;
    duration: number;
  };
  'cron:job-failed': {
    jobId: string;
    jobName: string;
    status: 'failed';
    error: string;
    failCount: number;
    willDisable: boolean;
  };
  'cron:job-disabled': {
    jobId: string;
    jobName: string;
    reason: string;
    failCount: number;
  };
}
```

### 5.2 修改 CronJobExecutor

**文件**: `src/main/ai/cron/CronJobExecutor.ts`

```typescript
import { eventBus } from '@main/common/eventbus';

export class CronJobExecutor {
  // ... 现有代码 ...

  async execute(job: CronJobDefinition): Promise<void> {
    const executionId = nanoid();
    const startedAt = Date.now();

    // 发送开始事件
    eventBus.emit('cron:job-started', {
      jobId: job.id,
      jobName: job.name,
      startedAt
    });

    try {
      // ... 现有执行逻辑 ...
      const result = await agentExecutor.submitAndWait({...});

      const endedAt = Date.now();
      const duration = endedAt - startedAt;

      // 发送完成事件
      eventBus.emit('cron:job-completed', {
        jobId: job.id,
        jobName: job.name,
        status: 'success',
        result: result.output || '执行成功',
        duration
      });

      log.info(`[CronJobExecutor] 作业执行成功：${job.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const willDisable = job.failCount + 1 >= 3;

      // 发送失败事件
      eventBus.emit('cron:job-failed', {
        jobId: job.id,
        jobName: job.name,
        status: 'failed',
        error: errorMessage,
        failCount: job.failCount + 1,
        willDisable
      });

      log.error(`[CronJobExecutor] 作业执行失败：${job.id}`, error);

      // 连续失败 3 次，发送禁用事件
      if (willDisable) {
        eventBus.emit('cron:job-disabled', {
          jobId: job.id,
          jobName: job.name,
          reason: `连续失败 ${job.failCount + 1} 次`,
          failCount: job.failCount + 1
        });
      }
    }
  }
}
```

### 5.3 创建 CronBridge

**文件**: `src/main/gateway/events/CronBridge.ts`

```typescript
/**
 * CronBridge - Cron 事件桥接
 *
 * 将主进程内部的 cron 事件转发到 WebSocket 客户端
 */

import { eventBus } from '@main/common/eventbus';
import type { Gateway } from '../Gateway';
import type { EventBridgeInit } from '../protocol/types';

export const initCronEventBridge: EventBridgeInit = (gateway) => {
  // 任务开始
  const startedHandler = (payload: { jobId: string; jobName: string; startedAt: number }) => {
    gateway.broadcastEvent('cron.job.started', payload);
  };

  // 任务完成
  const completedHandler = (payload: {
    jobId: string;
    jobName: string;
    status: 'success';
    result: string;
    duration: number;
  }) => {
    gateway.broadcastEvent('cron.job.completed', payload);
  };

  // 任务失败
  const failedHandler = (payload: {
    jobId: string;
    jobName: string;
    status: 'failed';
    error: string;
    failCount: number;
    willDisable: boolean;
  }) => {
    gateway.broadcastEvent('cron.job.failed', payload);
  };

  // 任务禁用
  const disabledHandler = (payload: { jobId: string; jobName: string; reason: string; failCount: number }) => {
    gateway.broadcastEvent('cron.job.disabled', payload);
  };

  // 注册监听器
  eventBus.on('cron:job-started', startedHandler);
  eventBus.on('cron:job-completed', completedHandler);
  eventBus.on('cron:job-failed', failedHandler);
  eventBus.on('cron:job-disabled', disabledHandler);

  // 返回清理函数
  return () => {
    eventBus.off('cron:job-started', startedHandler);
    eventBus.off('cron:job-completed', completedHandler);
    eventBus.off('cron:job-failed', failedHandler);
    eventBus.off('cron:job-disabled', disabledHandler);
  };
};
```

### 5.4 前端监听实现

**文件**: `src/renderer/src/views/CronView.vue`

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { gatewayClient } from '@/services/GatewayClient';
import { toast } from 'vue-sonner';

const jobs = ref<CronJobDefinition[]>([]);
const loading = ref(false);

// 事件处理
const handleCronEvent = (data: { event: string; payload: unknown }) => {
  const { event, payload } = data;

  switch (event) {
    case 'cron.job.started':
      toast.info(`任务开始：${(payload as any).jobName}`);
      refreshJobs();
      break;

    case 'cron.job.completed':
      const completed = payload as any;
      toast.success(`任务完成：${completed.jobName}`, {
        description: completed.result,
        duration: 5000
      });
      refreshJobs();
      break;

    case 'cron.job.failed':
      const failed = payload as any;
      toast.error(`任务失败：${failed.jobName}`, {
        description: failed.error,
        duration: 10000
      });
      refreshJobs();
      break;

    case 'cron.job.disabled':
      const disabled = payload as any;
      toast.warning(`任务已禁用：${disabled.jobName}`, {
        description: disabled.reason,
        duration: 10000
      });
      refreshJobs();
      break;
  }
};

const refreshJobs = async () => {
  loading.value = true;
  try {
    const res = await fetch('/gateway/cron-jobs');
    jobs.value = await res.json();
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  refreshJobs();
  gatewayClient.on('event', handleCronEvent);
});

onUnmounted(() => {
  gatewayClient.off('event', handleCronEvent);
});
</script>
```

---

## 六、可选扩展功能

### 6.1 系统通知（Electron Notification）

在 CronJobExecutor 中添加可选的系统通知：

```typescript
private sendSystemNotification(title: string, body: string): void {
  if (!this.config.enableSystemNotification) return;

  import('electron')
    .then(({ Notification }) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    });
}
```

### 6.2 执行进度推送

如果需要推送执行过程中的日志：

```typescript
// 在 AgentExecutor 执行过程中捕获输出
const streamEmitter = new StreamEmitter(sessionId);
streamEmitter.on('chunk', (chunk) => {
  eventBus.emit('cron:job-progress', {
    jobId: job.id,
    chunk
  });
});
```

### 6.3 客户端订阅机制

实现类似 StreamBridge 的订阅机制，只推送给关心的客户端：

```typescript
// CronBridge.ts
const subscribedSessions = new Set<string>();

eventBus.on('cron:job-started', (payload) => {
  gateway.broadcastEventIf('cron.job.started', payload, (meta) => meta.subscribedSessions.has(`cron-${payload.jobId}`));
});
```

---

## 七、测试计划

### 7.1 单元测试

| 测试项                    | 说明                                   |
| ------------------------- | -------------------------------------- |
| CronJobExecutor emit 事件 | 验证执行开始/完成/失败时正确 emit 事件 |
| CronBridge 事件转发       | 验证 EventBus 事件正确转发到 Gateway   |
| Gateway.broadcastEvent    | 验证事件正确广播到 WebSocket 客户端    |

### 7.2 集成测试

| 测试项       | 说明                                       |
| ------------ | ------------------------------------------ |
| 完整流程测试 | 创建定时任务 → 触发执行 → 验证前端收到事件 |
| 失败场景测试 | 模拟执行失败 → 验证失败事件推送            |
| 连续失败测试 | 连续失败 3 次 → 验证禁用事件推送           |

### 7.3 前端测试

| 测试项            | 说明                                 |
| ----------------- | ------------------------------------ |
| 事件监听注册/注销 | 验证组件挂载/卸载时正确注册/注销监听 |
| Toast 通知显示    | 验证不同类型事件显示对应 Toast       |
| 数据自动刷新      | 验证收到事件后作业列表自动刷新       |

---

## 八、风险评估

| 风险              | 影响         | 缓解措施                        |
| ----------------- | ------------ | ------------------------------- |
| EventBus 事件过多 | 可能影响性能 | 仅 emit 关键事件，避免频繁 emit |
| 前端重复注册监听  | 内存泄漏     | 确保 onUnmounted 时注销监听     |
| WebSocket 断连    | 事件丢失     | 前端重连后主动拉取最新状态      |
| 大量并发任务      | 事件风暴     | 考虑事件节流/合并机制           |

---

## 九、实施计划

详见 `cron-notification-implementation-plan.md`

---

## 十、参考文档

- [EventBus 实现](../src/main/common/eventbus.ts)
- [Gateway 实现](../src/main/gateway/Gateway.ts)
- [EventBridge 示例](../src/main/gateway/events/AgentEventBridge.ts)
- [TaskScheduler 通知](../src/main/ai/tavern/TaskScheduler.ts)
- [GatewayClient 实现](../src/renderer/src/services/GatewayClient.ts)
