# EventBus 事件同步系统使用指南

## 概述

项目实现了一个统一的 IPC 事件同步系统，用于在主进程和前端之间高效地传递事件。

### 核心设计

```
主进程 EventBus → IpcEventBroadcaster → 单一 IPC 通道 'ipc:event'
    ↓
Preload 监听并转发
    ↓
前端 EventBus → 业务组件订阅
```

**关键特性**：

- ✅ 单一 IPC 通道 (`ipc:event`)，通过 `type` 字段区分事件类型
- ✅ 完整的 TypeScript 类型安全
- ✅ 自动生命周期管理（组件卸载时自动清理）
- ✅ 支持事件处理器模块化组织

## 目录结构

```
src/
├── shared/ipc/
│   ├── events.ts              # 事件类型定义和 Payload
│   ├── channels.ts            # IPC 通道常量
│   └── index.ts               # 统一导出
│
├── main/common/ipc/
│   ├── eventBroadcaster.ts    # IPC 事件广播器（主进程）
│   └── index.ts               # 注册 IPC 处理器
│
├── renderer/src/
│   ├── utils/
│   │   └── eventBus.ts        # 前端 EventBus（基于 mitt）
│   ├── composables/
│   │   └── useEventBus.ts     # Vue Composable
│   └── eventbus/
│       ├── index.ts           # EventBus 模块导出
│       └── event_handles/     # 事件处理器
│           ├── index.ts       # 统一注册
│           └── tabEventsHandle.ts  # Tab 事件处理示例
```

## 使用方法

### 1. 定义新事件

在 `src/shared/ipc/events.ts` 中添加事件类型：

```typescript
export const EventTypes = {
  // ... 已有事件
  MY_NEW_EVENT: 'my:new-event'
} as const

export interface EventPayloads {
  // ... 已有 Payload
  [EventTypes.MY_NEW_EVENT]: {
    id: number
    message: string
  }
}
```

### 2. 主进程触发事件

#### 方式 1：通过主进程 EventBus（推荐）

```typescript
import { eventBus } from '@main/common/eventbus'

// 触发事件，IpcEventBroadcaster 会自动广播到前端
eventBus.emit('my:new-event', {
  id: 123,
  message: 'Hello from main process'
})
```

#### 方式 2：直接使用 IpcEventBroadcaster

```typescript
import { ipcEventBroadcaster } from '@main/common/ipc'

// 广播到所有窗口
ipcEventBroadcaster.broadcast('my:new-event', {
  id: 123,
  message: 'Hello'
})

// 发送到指定窗口
ipcEventBroadcaster.sendToWindow(windowId, 'my:new-event', {
  id: 123,
  message: 'Hello'
})

// 发送到指定窗口的所有 Tab
ipcEventBroadcaster.sendToWindowTabs(windowId, 'my:new-event', {
  id: 123,
  message: 'Hello'
})
```

### 3. 前端监听事件

#### 方式 1：使用 Composable（推荐，自动清理）

```vue
<script setup lang="ts">
import { useEventBus } from '@/composables/useEventBus'
import { EventTypes } from '@shared/ipc/events'

const { on, emit } = useEventBus()

// 监听主进程事件（组件卸载时自动取消订阅）
on(EventTypes.TAB_CREATED, (payload) => {
  console.log('Tab 创建:', payload.tabId, payload.title)
})

on(EventTypes.TAB_CLOSED, (payload) => {
  console.log('Tab 关闭:', payload.tabId)
})

// 前端内部也可以触发事件
function handleClick() {
  emit(EventTypes.TAB_UPDATED, {
    windowId: 1,
    tabId: 2,
    title: '新标题'
  })
}
</script>
```

#### 方式 2：直接使用 EventBus

```typescript
import eventBus from '@/utils/eventBus'
import { EventTypes } from '@shared/ipc/events'

// 订阅事件
eventBus.on(EventTypes.TAB_CREATED, (payload) => {
  console.log('Tab 创建:', payload)
})

// 取消订阅（需手动管理）
eventBus.off(EventTypes.TAB_CREATED, handler)

// 单次订阅
eventBus.once(EventTypes.TAB_CREATED, (payload) => {
  console.log('只触发一次')
})

// 发送事件
eventBus.emit(EventTypes.TAB_CREATED, {
  windowId: 1,
  tabId: 2,
  title: 'New Tab',
  url: 'local://chat',
  position: 0
})
```

### 4. 创建事件处理器模块

在 `src/renderer/src/eventbus/event_handles/` 中创建新的处理器：

```typescript
// myEventsHandle.ts
import { EventTypes } from '@shared/ipc/events'
import eventBus from '@/utils/eventBus'

function handleMyEvent(payload: any): void {
  console.log('[MyEvents] 处理事件:', payload)
  // 业务逻辑...
}

export function setup(): void {
  eventBus.on(EventTypes.MY_NEW_EVENT, handleMyEvent)
  console.log('[MyEvents] 事件处理器已注册')
}
```

然后在 `event_handles/index.ts` 中注册：

```typescript
import { setup as setupMyEvents } from './myEventsHandle'

export function setupEventHandlers(): void {
  setupTabEvents()
  setupMyEvents() // 添加新处理器

  console.log('[EventHandlers] 所有事件处理器已注册')
}
```

### 5. 初始化 EventBus

在 `src/renderer/src/main.ts` 中注册：

```typescript
import { createApp } from 'vue'
import App from './App.vue'
import { eventBus } from './utils/eventBus'
import { setupEventHandlers } from './eventbus/event_handles'

// 1. 注册前端 EventBus 到 Preload
window.api.registerEventBus(eventBus)

// 2. 设置所有事件处理器
setupEventHandlers()

// 3. 创建 Vue 应用
const app = createApp(App)
app.mount('#app')
```

## 已定义的事件类型

### Window 事件

- `window:created` - 窗口创建
- `window:closed` - 窗口关闭
- `window:focused` - 窗口获得焦点
- `window:blurred` - 窗口失去焦点

### Tab 事件

- `tab:created` - Tab 创建
- `tab:closed` - Tab 关闭
- `tab:activated` - Tab 激活
- `tab:updated` - Tab 更新
- `tab:moved` - Tab 移动

### App 事件

- `theme:changed` - 主题切换
- `config:updated` - 配置更新
- `system:error` - 系统错误

## 最佳实践

### 1. 类型安全

始终使用 `EventTypes` 常量而非字符串：

```typescript
// ✅ 好
on(EventTypes.TAB_CREATED, handler)

// ❌ 差
on('tab:created', handler)
```

### 2. 生命周期管理

在 Vue 组件中使用 `useEventBus` Composable，自动管理订阅：

```typescript
// ✅ 好 - 自动清理
const { on } = useEventBus()
on(EventTypes.TAB_CREATED, handler)

// ❌ 差 - 需要手动清理
eventBus.on(EventTypes.TAB_CREATED, handler)
onUnmounted(() => {
  eventBus.off(EventTypes.TAB_CREATED, handler)
})
```

### 3. 事件命名

遵循 `资源:动作` 格式：

```typescript
// ✅ 好
'tab:created'
'window:focused'
'user:login'

// ❌ 差
'created-tab'
'focus'
'userLogin'
```

### 4. Payload 设计

Payload 应包含所有必要信息，避免前端再次查询：

```typescript
// ✅ 好
interface TabCreatedPayload {
  windowId: number
  tabId: number
  title: string
  url: string
  position: number
}

// ❌ 差
interface TabCreatedPayload {
  tabId: number // 缺少上下文信息
}
```

## 常见问题

### Q: EventBus 没有收到事件？

A: 确保在 `main.ts` 中调用了 `window.api.registerEventBus(eventBus)`

### Q: 如何调试事件？

A: EventBus 自动打印日志，打开浏览器控制台查看：

```
[EventBus] 订阅事件: tab:created
[EventBus] 发送事件: tab:created { ... }
```

### Q: 可以在前端内部触发事件吗？

A: 可以！使用 `emit` 方法即可在前端内部触发事件，不会发送到主进程。

### Q: 如何避免内存泄漏？

A: 使用 `useEventBus` Composable，它会在组件卸载时自动清理订阅。

## 扩展

### 添加新的事件广播源

在 `eventBroadcaster.ts` 的 `setupEventListeners` 中添加：

```typescript
eventBus.on('your:event', (data: any) => {
  this.broadcast('your:event', data)
})
```

### 条件广播

根据需要选择广播方式：

```typescript
// 广播到所有窗口
ipcEventBroadcaster.broadcast('event', payload)

// 只发送到特定窗口
if (shouldNotifyWindow) {
  ipcEventBroadcaster.sendToWindow(windowId, 'event', payload)
}
```

## 性能优化

1. **避免高频事件**：对于频繁触发的事件（如鼠标移动），考虑节流
2. **按需订阅**：只订阅需要的事件，避免全局订阅
3. **及时清理**：确保组件卸载时取消订阅

## 总结

这个事件系统提供了：

- 📡 统一的 IPC 通道
- 🔒 完整的类型安全
- 🧹 自动生命周期管理
- 📦 模块化的事件处理器
- 🎯 灵活的广播策略

使用这个系统可以轻松实现主进程和前端之间的实时数据同步！
