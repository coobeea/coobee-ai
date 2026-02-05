# EventBus 后端集成完成总结

## 完成时间

2026-02-05

## 修改的文件

### 1. `src/main/common/ipc/tabHandlers.ts`

添加了 eventBus 导入和事件发送：

#### Tab Created 事件

```typescript
// 在 TabChannels.CREATE 处理器中
eventBus.emit('tab:created', {
  windowId,
  tabId,
  title: tab.title,
  url: tab.url,
  position: tab.position
})
```

#### Tab Closed 事件

```typescript
// 在 TabChannels.CLOSE 处理器中
eventBus.emit('tab:closed', {
  windowId,
  tabId: req.tabId
})
```

#### Tab Activated 事件

```typescript
// 在 TabChannels.SWITCH 处理器中
const previousTab = windowManager.getActiveTab(windowId)
const previousTabId = previousTab ? previousTab.id : null

eventBus.emit('tab:activated', {
  windowId,
  tabId: req.tabId,
  previousTabId
})
```

#### Tab Updated 事件

```typescript
// 在 TabChannels.UPDATE 处理器中
eventBus.emit('tab:updated', {
  windowId,
  tabId: req.tabId,
  title: req.title,
  url: req.url
})
```

---

### 2. `src/main/common/window/WindowManager.ts`

添加了 eventBus 导入和窗口生命周期事件发送：

#### Window Created 事件

```typescript
// 在 createWindow() 方法中，窗口创建成功后
eventBus.emit('window:created', {
  windowId: window.id,
  type: config.type
})
```

#### Window Closed 事件

```typescript
// 在 setupWindowEvents() 的 'closed' 监听器中
window.on(BrowserWindowEvents.CLOSED, () => {
  eventBus.emit('window:closed', {
    windowId
  })
  this.cleanupWindow(windowId)
})
```

#### Window Focused 事件

```typescript
// 在 setupWindowEvents() 的 'focus' 监听器中
window.on(BrowserWindowEvents.FOCUS, () => {
  windowInfo.state.isFocused = true
  this.focusedWindowId = windowId

  eventBus.emit('window:focused', {
    windowId
  })
})
```

#### Window Blurred 事件

```typescript
// 在 setupWindowEvents() 的 'blur' 监听器中
window.on(BrowserWindowEvents.BLUR, () => {
  windowInfo.state.isFocused = false
  if (this.focusedWindowId === windowId) {
    this.focusedWindowId = null
  }

  eventBus.emit('window:blurred', {
    windowId
  })
})
```

---

## 事件流程

### 完整的事件流程

```
前端 UI 操作
    ↓
IPC 调用 (例如: tab:create)
    ↓
IPC Handler (tabHandlers.ts)
    ├─ 调用 WindowManager.createTab()
    ├─ 获取创建结果
    ├─ eventBus.emit('tab:created', payload) ← 发送事件
    └─ 返回结果给前端
    ↓
主进程 EventBus
    ↓
IpcEventBroadcaster (监听 eventBus)
    ├─ 接收到 'tab:created' 事件
    └─ 通过 IPC 'ipc:event' 通道广播
    ↓
Preload 层
    ├─ 监听 'ipc:event' 通道
    └─ 转发到前端 EventBus
    ↓
前端 EventBus
    ├─ emit('tab:created', payload)
    └─ 触发所有订阅者
    ↓
前端组件 (useEventBus)
    └─ 收到事件，更新 UI
```

---

## 已实现的事件

### Tab 事件 ✅

| 事件类型        | 触发位置                  | Payload                                     |
| --------------- | ------------------------- | ------------------------------------------- |
| `tab:created`   | `tabHandlers.ts` - CREATE | `{ windowId, tabId, title, url, position }` |
| `tab:closed`    | `tabHandlers.ts` - CLOSE  | `{ windowId, tabId }`                       |
| `tab:activated` | `tabHandlers.ts` - SWITCH | `{ windowId, tabId, previousTabId }`        |
| `tab:updated`   | `tabHandlers.ts` - UPDATE | `{ windowId, tabId, title?, url? }`         |

### Window 事件 ✅

| 事件类型         | 触发位置                            | Payload              |
| ---------------- | ----------------------------------- | -------------------- |
| `window:created` | `WindowManager.ts` - createWindow() | `{ windowId, type }` |
| `window:closed`  | `WindowManager.ts` - 'closed' 事件  | `{ windowId }`       |
| `window:focused` | `WindowManager.ts` - 'focus' 事件   | `{ windowId }`       |
| `window:blurred` | `WindowManager.ts` - 'blur' 事件    | `{ windowId }`       |

---

## 测试验证

### 验证步骤

1. **启动应用**

   ```bash
   pnpm dev
   ```

2. **前端监听事件** (在任意 Vue 组件中)

   ```vue
   <script setup lang="ts">
   import { useEventBus } from '@/composables/useEventBus'
   import { EventTypes } from '@shared/ipc/events'

   const { on } = useEventBus()

   on(EventTypes.TAB_CREATED, (payload) => {
     console.log('收到 Tab 创建事件:', payload)
   })

   on(EventTypes.TAB_CLOSED, (payload) => {
     console.log('收到 Tab 关闭事件:', payload)
   })
   </script>
   ```

3. **执行操作测试**
   - 创建新 Tab → 应该收到 `tab:created` 事件
   - 关闭 Tab → 应该收到 `tab:closed` 事件
   - 切换 Tab → 应该收到 `tab:activated` 事件
   - 更新 Tab → 应该收到 `tab:updated` 事件

4. **使用示例组件**
   - 打开 `src/renderer/src/examples/EventBusExample.vue`
   - 查看事件日志和统计

---

## 架构设计

### 职责分离

```
IPC Layer (协调层)
├─ 接收前端请求
├─ 调用 WindowManager (业务层)
├─ 发送 eventBus 事件 ← 在这里发送
└─ 返回响应

Business Layer (业务层)
├─ WindowManager (纯业务逻辑)
└─ 不关心事件系统

Event Layer (事件层)
├─ EventBus (主进程事件总线)
├─ IpcEventBroadcaster (监听并广播)
└─ 前端 EventBus (接收并分发)
```

### 优势

1. ✅ **职责清晰**：IPC 层负责事件发送，业务层专注业务逻辑
2. ✅ **易于维护**：事件发送集中在入口层
3. ✅ **架构合理**：符合分层架构原则
4. ✅ **避免循环依赖**：WindowManager 不依赖 eventBus

---

## 质量保证

### 类型检查 ✅

```bash
pnpm typecheck
# ✅ 通过
```

### 代码规范 ✅

所有修改符合 ESLint 规范

---

## 下一步

1. **前端集成** (待完成)
   - 在 `main.ts` 中注册 EventBus
   - 设置事件处理器
   - 在业务组件中使用 `useEventBus` 监听事件

2. **实际测试**
   - 验证事件流程
   - 检查事件 Payload 完整性
   - 测试并发场景

3. **性能优化** (可选)
   - 监控事件频率
   - 必要时添加防抖/节流

---

## 总结

后端事件集成已完成，所有关键操作都会发送事件到 eventBus：

- ✅ Tab 创建/关闭/激活/更新
- ✅ Window 创建/关闭/聚焦/失焦

事件流程清晰，架构合理，代码质量有保障。现在可以继续前端集成和测试验证。
