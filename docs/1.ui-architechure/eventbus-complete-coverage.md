# EventBus 完整事件覆盖总结

## 完成时间

2026-02-05

## 所有事件列表

### Tab 事件（7 个）

| 事件常量              | 事件名称              | 触发位置                          | Payload                                         |
| --------------------- | --------------------- | --------------------------------- | ----------------------------------------------- |
| `TAB_CREATED`         | `tab:created`         | `WindowManager.createTab()`       | `{ windowId, tabId, title, url, position }`     |
| `TAB_CLOSED`          | `tab:closed`          | `WindowManager.closeTab()`        | `{ windowId, tabId }`                           |
| `TAB_ACTIVATED`       | `tab:activated`       | `WindowManager.switchTab()`       | `{ windowId, tabId, previousTabId }`            |
| `TAB_UPDATED`         | `tab:updated`         | `WindowManager.updateTab()`       | `{ windowId, tabId, title?, url? }`             |
| `TAB_MOVED`           | `tab:moved`           | _(保留，单个移动)_                | `{ windowId, tabId, fromPosition, toPosition }` |
| `TABS_REORDERED`      | `tabs:reordered`      | `WindowManager.reorderTabs()`     | `{ windowId, tabIds[], changes[] }`             |
| `TAB_MOVED_TO_WINDOW` | `tab:moved-to-window` | `WindowManager.moveTabToWindow()` | `{ tabId, fromWindowId, toWindowId, title }`    |
| `TAB_DUPLICATED`      | `tab:duplicated`      | `WindowManager.duplicateTab()`    | `{ windowId, originalTabId, newTabId, title }`  |

### Window 事件（4 个）

| 事件常量         | 事件名称         | 触发位置                                       | Payload              |
| ---------------- | ---------------- | ---------------------------------------------- | -------------------- |
| `WINDOW_CREATED` | `window:created` | `WindowManager.createWindow()`                 | `{ windowId, type }` |
| `WINDOW_CLOSED`  | `window:closed`  | `WindowManager.setupWindowEvents()` - 'closed' | `{ windowId }`       |
| `WINDOW_FOCUSED` | `window:focused` | `WindowManager.setupWindowEvents()` - 'focus'  | `{ windowId }`       |
| `WINDOW_BLURRED` | `window:blurred` | `WindowManager.setupWindowEvents()` - 'blur'   | `{ windowId }`       |

### App 事件（3 个）

| 事件常量         | 事件名称         | 触发位置   | Payload                        |
| ---------------- | ---------------- | ---------- | ------------------------------ |
| `THEME_CHANGED`  | `theme:changed`  | _(待实现)_ | `{ theme: 'light' \| 'dark' }` |
| `CONFIG_UPDATED` | `config:updated` | _(待实现)_ | `{ key, value }`               |
| `SYSTEM_ERROR`   | `system:error`   | _(待实现)_ | `{ code, message, details? }`  |

**总计：14 个事件类型**

---

## 事件分类详解

### 1. Tab 生命周期事件

#### 创建和销毁

- ✅ `TAB_CREATED` - Tab 创建成功
- ✅ `TAB_CLOSED` - Tab 关闭成功
- ✅ `TAB_DUPLICATED` - Tab 复制成功

#### 状态变化

- ✅ `TAB_ACTIVATED` - Tab 被激活（包含之前激活的 Tab ID）
- ✅ `TAB_UPDATED` - Tab 信息更新（标题、URL 等）

#### 位置变化

- ✅ `TAB_MOVED` - 单个 Tab 移动（保留，用于特殊场景）
- ✅ `TABS_REORDERED` - 批量重排序（推荐用于拖拽排序）
- ✅ `TAB_MOVED_TO_WINDOW` - Tab 跨窗口移动

---

### 2. Window 生命周期事件

#### 创建和销毁

- ✅ `WINDOW_CREATED` - 窗口创建成功
- ✅ `WINDOW_CLOSED` - 窗口关闭

#### 焦点变化

- ✅ `WINDOW_FOCUSED` - 窗口获得焦点
- ✅ `WINDOW_BLURRED` - 窗口失去焦点

---

### 3. App 全局事件

#### 配置和主题

- ⏳ `THEME_CHANGED` - 主题切换（待实现）
- ⏳ `CONFIG_UPDATED` - 配置更新（待实现）

#### 错误处理

- ⏳ `SYSTEM_ERROR` - 系统错误（待实现）

---

## 事件设计原则

### ✅ 统一发送位置

**所有事件都在 `WindowManager` 中发送**

```typescript
WindowManager (业务层)
├─ createTab()        → emit(TAB_CREATED)
├─ closeTab()         → emit(TAB_CLOSED)
├─ switchTab()        → emit(TAB_ACTIVATED)
├─ updateTab()        → emit(TAB_UPDATED)
├─ reorderTabs()      → emit(TABS_REORDERED)
├─ moveTabToWindow()  → emit(TAB_MOVED_TO_WINDOW)
├─ duplicateTab()     → emit(TAB_DUPLICATED)
├─ createWindow()     → emit(WINDOW_CREATED)
└─ setupWindowEvents()
   ├─ 'closed'        → emit(WINDOW_CLOSED)
   ├─ 'focus'         → emit(WINDOW_FOCUSED)
   └─ 'blur'          → emit(WINDOW_BLURRED)
```

### ✅ 使用常量

所有事件发送和监听都使用 `EventTypes` 常量：

```typescript
// ✅ 发送事件
eventBus.emit(EventTypes.TAB_CREATED, payload)

// ✅ 监听事件
eventBus.on(EventTypes.TAB_CREATED, handler)

// ❌ 避免硬编码字符串
eventBus.emit('tab:created', payload)
```

### ✅ 完整信息

事件 Payload 应包含所有必要的上下文信息：

```typescript
// ✅ 好 - 包含完整上下文
{
  windowId: 1,
  tabId: 2,
  title: 'New Tab',
  url: 'local://chat',
  position: 0
}

// ❌ 差 - 信息不完整
{
  tabId: 2
}
```

### ✅ 批量操作统一

对于批量操作，发送单个事件而不是多个：

```typescript
// ✅ 好 - 批量重排序
eventBus.emit(EventTypes.TABS_REORDERED, {
  windowId,
  tabIds: [3, 1, 2],
  changes: [...]
})

// ❌ 差 - 循环发送多个事件
tabIds.forEach(tabId => {
  eventBus.emit(EventTypes.TAB_MOVED, { ... })
})
```

---

## 使用场景

### 前端自动同步

```vue
<script setup lang="ts">
import { useEventBus } from '@/composables/useEventBus'
import { EventTypes } from '@shared/ipc/events'

const { on } = useEventBus()

// 监听 Tab 创建，自动添加到列表
on(EventTypes.TAB_CREATED, (payload) => {
  tabs.value.push({
    id: payload.tabId,
    title: payload.title,
    url: payload.url
  })
})

// 监听 Tab 关闭，自动从列表移除
on(EventTypes.TAB_CLOSED, (payload) => {
  tabs.value = tabs.value.filter((t) => t.id !== payload.tabId)
})

// 监听 Tabs 重排序，批量更新顺序
on(EventTypes.TABS_REORDERED, (payload) => {
  // 根据新顺序重新排列
  const orderedTabs = payload.tabIds
    .map((id) => tabs.value.find((t) => t.id === id))
    .filter(Boolean)
  tabs.value = orderedTabs
})
</script>
```

### 跨窗口同步

```typescript
// 监听 Tab 跨窗口移动
on(EventTypes.TAB_MOVED_TO_WINDOW, (payload) => {
  console.log(`Tab ${payload.tabId} 从窗口 ${payload.fromWindowId} 移到 ${payload.toWindowId}`)

  // 更新源窗口和目标窗口的 TabStore
  sourceWindowStore.removeTab(payload.tabId)
  targetWindowStore.addTab(payload.tabId)
})
```

---

## 完整的事件流程

```
用户操作
  ↓
前端 IPC 调用 (tab:create)
  ↓
IPC Handler (tabHandlers.ts)
  ├─ 参数验证
  └─ 调用 WindowManager.createTab()
  ↓
WindowManager (业务层) ⭐ 统一事件源
  ├─ 执行业务逻辑
  ├─ eventBus.emit(EventTypes.TAB_CREATED, payload)
  └─ 返回结果
  ↓
主进程 EventBus
  ↓
IpcEventBroadcaster (监听)
  └─ 通过 'ipc:event' 通道广播
  ↓
Preload 层
  └─ 转发到前端 EventBus
  ↓
前端 EventBus
  └─ 分发给订阅者
  ↓
前端组件/TabStore
  └─ 自动更新 UI
```

---

## 性能优化

### 批量操作优化

| 操作                  | 事件数量                    | 性能    |
| --------------------- | --------------------------- | ------- |
| 创建 1 个 Tab         | 1 个事件                    | 优秀 ✅ |
| 重排序 10 个 Tab      | 1 个事件（包含所有变化）    | 优秀 ✅ |
| 移动 Tab 到另一个窗口 | 1 个事件                    | 优秀 ✅ |
| 复制 Tab              | 2 个事件（原 Tab + 新 Tab） | 良好 ✅ |

---

## 质量保证

### ✅ 类型检查

```bash
pnpm typecheck - 通过
```

### ✅ 事件覆盖

- ✅ 所有 Tab 操作都有对应事件
- ✅ 所有 Window 生命周期都有对应事件
- ✅ 批量操作优化完成

### ✅ 代码规范

- ✅ 使用 `EventTypes` 常量
- ✅ 完整的类型定义
- ✅ 统一的发送位置

---

## 总结

当前的 EventBus 系统已经实现了：

1. **完整的事件覆盖** - 所有 Tab/Window 操作都有对应事件
2. **统一的事件源** - 所有事件都在 WindowManager 中发送
3. **类型安全** - 使用 EventTypes 常量和 TypeScript 类型
4. **性能优化** - 批量操作发送单个事件
5. **架构清晰** - 职责分离，易于维护

现在前端可以通过监听这些事件实现完全的自动同步！🎉
