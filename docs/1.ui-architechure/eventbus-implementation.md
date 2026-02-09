# EventBus 事件同步系统实现总结

## 实现概述

成功实现了一个统一的 IPC 事件同步系统，用于主进程和前端之间的实时数据同步。

### 核心架构

```
主进程 EventBus (已有)
    ↓ 监听事件
IpcEventBroadcaster
    ↓ 通过单一 IPC 通道 'ipc:event' 发送
Preload 层桥接
    ↓ 转发到
前端 EventBus (mitt)
    ↓ 分发给
业务组件/事件处理器
```

## 已创建的文件

### 1. 共享定义层 (`src/shared/ipc/`)

#### `events.ts` - 事件类型定义

```typescript
- EventTypes: 事件类型常量
- EventPayloads: 事件负载类型映射
- IpcEventMessage: 统一的事件消息格式
- EventHandler: 类型安全的事件处理器
```

**已定义的事件类型**：

- Window: `created`, `closed`, `focused`, `blurred`
- Tab: `created`, `closed`, `activated`, `updated`, `moved`
- App: `theme:changed`, `config:updated`, `system:error`

#### `channels.ts` - 更新

添加了统一事件通道常量：`IPC_EVENT_CHANNEL = 'ipc:event'`

#### `index.ts` - 更新

导出所有事件相关类型和常量。

### 2. 主进程层 (`src/main/common/ipc/`)

#### `eventBroadcaster.ts` - IPC 事件广播器

```typescript
class IpcEventBroadcaster {
  init(): void // 初始化，设置事件监听
  broadcast() // 广播到所有窗口
  sendToWindow() // 发送到指定窗口
  sendToWindowTabs() // 发送到窗口的所有 Tab
}
```

**功能**：

- 监听主进程 `eventBus` 的事件
- 通过 `IPC_EVENT_CHANNEL` 转发到前端
- 支持全局广播和定向发送

#### `index.ts` - 更新

在 `registerIpcHandlers()` 中初始化 `ipcEventBroadcaster`。

### 3. Preload 层 (`src/preload/`)

#### `index.ts` - 更新

```typescript
- 监听 IPC_EVENT_CHANNEL 通道
- 接收 IpcEventMessage 并转发到前端 EventBus
- 暴露 registerEventBus API
```

#### `index.d.ts` - 更新

添加 `registerEventBus(bus: any): void` 类型定义。

### 4. 前端层 (`src/renderer/src/`)

#### `utils/eventBus.ts` - 前端 EventBus

```typescript
class FrontendEventBus {
  on() // 订阅事件
  off() // 取消订阅
  emit() // 发送事件
  once() // 单次订阅
  clear() // 清空所有监听
}
```

**特点**：

- 基于 `mitt` 实现
- 类型安全
- 支持前端内部事件

#### `composables/useEventBus.ts` - Vue Composable

```typescript
export function useEventBus() {
  return {
    on, // 订阅（自动清理）
    off, // 取消订阅
    once, // 单次订阅
    emit // 发送事件
  }
}
```

**优势**：

- 自动生命周期管理
- 组件卸载时自动清理订阅
- 完整的 TypeScript 类型推断

#### `eventbus/event_handles/` - 事件处理器

**`tabEventsHandle.ts`** - Tab 事件处理示例

```typescript
;-handleTabCreated() - handleTabClosed() - handleTabActivated() - handleTabUpdated() - setup() // 注册所有处理器
```

**`index.ts`** - 统一注册

```typescript
export function setupEventHandlers(): void {
  setupTabEvents()
  // 其他处理器...
}
```

#### `eventbus/index.ts` - 统一导出

导出 `eventBus`, `setupEventHandlers`, `useEventBus`。

### 5. 示例和文档

#### `examples/EventBusExample.vue` - 使用示例

演示组件，包含：

- 事件日志显示
- Tab 事件监听统计
- 前端触发事件测试

#### `docs/eventbus-guide.md` - 使用指南

完整的使用文档，包括：

- 架构说明
- 使用方法
- 最佳实践
- 常见问题

## 使用流程

### 1. 初始化（在 `main.ts` 中）

```typescript
import { eventBus } from './utils/eventBus'
import { setupEventHandlers } from './eventbus/event_handles'

// 1. 注册 EventBus 到 Preload
window.api.registerEventBus(eventBus)

// 2. 设置事件处理器
setupEventHandlers()

// 3. 创建 Vue 应用
const app = createApp(App)
app.mount('#app')
```

### 2. 主进程触发事件

```typescript
import { eventBus } from '@main/common/eventbus'

// EventBus 触发，IpcEventBroadcaster 自动转发
eventBus.emit('tab:created', {
  windowId: 1,
  tabId: 2,
  title: 'New Tab',
  url: 'local://chat',
  position: 0
})
```

### 3. 前端监听事件

```vue
<script setup lang="ts">
import { useEventBus } from '@/composables/useEventBus'
import { EventTypes } from '@shared/ipc/events'

const { on } = useEventBus()

// 自动清理的事件监听
on(EventTypes.TAB_CREATED, (payload) => {
  console.log('Tab 创建:', payload)
})
</script>
```

## 技术特性

### ✅ 类型安全

- 完整的 TypeScript 类型定义
- 编译时类型检查
- IDE 自动补全支持

### ✅ 自动清理

- Vue Composable 自动管理订阅生命周期
- 组件卸载时自动取消所有订阅
- 避免内存泄漏

### ✅ 统一通道

- 只使用一个 IPC 通道 (`ipc:event`)
- 通过 `type` 字段区分事件类型
- 减少 IPC 通道数量，提高性能

### ✅ 模块化

- 事件处理器按功能组织
- 清晰的目录结构
- 易于扩展和维护

### ✅ 灵活广播

- 支持全局广播
- 支持指定窗口发送
- 支持指定 Tab 发送

## 代码质量

### 类型检查

```bash
✅ pnpm typecheck - 通过
```

### ESLint

所有新文件符合项目 ESLint 规范，使用 `unknown` 替代 `any`（必要处除外）。

## 扩展点

### 1. 添加新事件类型

在 `src/shared/ipc/events.ts` 中添加：

```typescript
export const EventTypes = {
  MY_EVENT: 'my:event'
}

export interface EventPayloads {
  [EventTypes.MY_EVENT]: { ... }
}
```

在 `eventBroadcaster.ts` 中注册监听：

```typescript
eventBus.on('my:event', (data: unknown) => {
  this.broadcast('my:event', data as EventPayloads['my:event'])
})
```

### 2. 创建新的事件处理器

在 `src/renderer/src/eventbus/event_handles/` 中创建新文件，然后在 `index.ts` 中注册。

### 3. 定向发送事件

使用 `ipcEventBroadcaster` 的不同方法：

```typescript
// 全局广播
ipcEventBroadcaster.broadcast('event', payload)

// 指定窗口
ipcEventBroadcaster.sendToWindow(windowId, 'event', payload)

// 窗口所有 Tab
ipcEventBroadcaster.sendToWindowTabs(windowId, 'event', payload)
```

## 性能考虑

1. **单一通道**：减少 IPC 开销
2. **按需订阅**：只订阅需要的事件
3. **自动清理**：避免内存泄漏
4. **类型优化**：编译时优化，零运行时开销

## 测试建议

1. **单元测试**：测试 EventBus 的 on/off/emit 方法
2. **集成测试**：测试主进程到前端的完整事件流
3. **组件测试**：使用 `EventBusExample.vue` 验证功能

## 总结

成功实现了一个完整的、类型安全的、高性能的 IPC 事件同步系统。系统具有良好的可扩展性和可维护性，为项目的实时数据同步提供了坚实的基础。

### 主要优势

1. **开发体验**：完整的类型提示和自动补全
2. **可维护性**：清晰的模块划分和统一的架构
3. **性能**：单一 IPC 通道，减少通信开销
4. **可靠性**：自动生命周期管理，避免内存泄漏

### 下一步

- 在实际业务中使用和验证
- 根据需要添加更多事件类型
- 完善事件处理器逻辑
- 考虑添加事件过滤和转换机制
