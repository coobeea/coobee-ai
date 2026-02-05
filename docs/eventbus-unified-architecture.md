# EventBus 统一架构调整总结

## 调整时间

2026-02-05

## 调整原因

之前事件发送分散在两个地方：

- ❌ `WindowManager.ts` - window 相关事件
- ❌ `tabHandlers.ts` - tab 相关事件

**问题**：架构不统一，职责分散

## 新架构设计

### 统一原则

**所有业务事件都在 `WindowManager` 中发送**

```
前端 IPC 调用
    ↓
IPC Handlers (协调层)
    ├─ 接收请求
    ├─ 调用 WindowManager 方法
    └─ 返回结果
    ↓
WindowManager (业务层) ← 统一在这里发送事件
    ├─ 执行业务逻辑
    ├─ eventBus.emit(事件) ← 集中发送
    └─ 返回结果
    ↓
EventBus → IpcEventBroadcaster → 前端
```

---

## 修改内容

### 1. `WindowManager.ts` - 添加事件发送

#### createTab() - Tab 创建

```typescript
// 在 Tab 创建成功后
eventBus.emit('tab:created', {
  windowId,
  tabId,
  title: tabInfo.title,
  url: tabInfo.url,
  position: tabInfo.position
})
```

#### closeTab() - Tab 关闭

```typescript
// 在 Tab 关闭成功后
eventBus.emit('tab:closed', {
  windowId,
  tabId
})
```

#### switchTab() - Tab 激活

```typescript
// 在 Tab 切换成功后
// 记录 previousTabId
const previousTab = Array.from(windowInfo.tabs.values()).find((t) => t.isActive)
const previousTabId = previousTab ? previousTab.id : null

// ... 切换逻辑 ...

eventBus.emit('tab:activated', {
  windowId,
  tabId,
  previousTabId
})
```

#### updateTab() - Tab 更新（新增方法）

```typescript
/**
 * 更新 Tab 信息
 * @param windowId 窗口 ID
 * @param tabId Tab ID
 * @param updates 要更新的字段
 * @returns 是否成功更新
 */
updateTab(
  windowId: number,
  tabId: number,
  updates: { title?: string; url?: string }
): boolean {
  // ... 更新逻辑 ...

  // 发送 tab:updated 事件
  eventBus.emit('tab:updated', {
    windowId,
    tabId,
    title: updates.title,
    url: updates.url
  })

  return true
}
```

#### reorderTabs() - Tab 移动

```typescript
// 在 Tab 重新排序成功后
tabIds.forEach((tabId, toPosition) => {
  const tab = windowInfo.tabs.get(tabId)
  if (tab && tab.position !== toPosition) {
    eventBus.emit('tab:moved', {
      windowId,
      tabId,
      fromPosition: tab.position,
      toPosition
    })
  }
})
```

#### Window 事件（已有）

- `window:created` - 在 `createWindow()` 中
- `window:closed` - 在 `setupWindowEvents()` 的 'closed' 事件中
- `window:focused` - 在 `setupWindowEvents()` 的 'focus' 事件中
- `window:blurred` - 在 `setupWindowEvents()` 的 'blur' 事件中

---

### 2. `tabHandlers.ts` - 移除事件发送

#### 移除的代码

```typescript
// ❌ 移除 eventBus 导入
- import { eventBus } from '../eventbus'

// ❌ 移除所有 eventBus.emit() 调用
- eventBus.emit('tab:created', ...)
- eventBus.emit('tab:closed', ...)
- eventBus.emit('tab:activated', ...)
- eventBus.emit('tab:updated', ...)
```

#### 更新 tab:update 处理器

```typescript
// 之前：直接修改 tab 对象
const tab = windowInfo.tabs.get(req.tabId)
tab.title = req.title
tab.url = req.url
eventBus.emit('tab:updated', ...)

// 现在：调用 WindowManager.updateTab()
const success = windowManager.updateTab(windowId, req.tabId, {
  title: req.title,
  url: req.url
})
```

---

## 架构优势

### ✅ 统一职责

```
WindowManager
├─ 业务逻辑执行
├─ 事件发送 ← 统一在这里
└─ 状态管理

IPC Handlers
├─ 请求接收
├─ 参数验证
├─ 调用 WindowManager
└─ 结果返回
```

### ✅ 代码清晰

- 所有事件发送都在业务层
- IPC 层只负责协调
- 职责分离清晰

### ✅ 易于维护

- 修改事件逻辑只需改 WindowManager
- 不需要在多个文件中同步修改
- 降低维护成本

### ✅ 完整性保障

- 无论通过 IPC 还是内部调用都会发送事件
- 事件和业务逻辑在同一处
- 不会遗漏事件

---

## 事件发送位置总结

| 事件类型         | 发送位置         | 触发方法              | Payload                                         |
| ---------------- | ---------------- | --------------------- | ----------------------------------------------- |
| `tab:created`    | WindowManager.ts | `createTab()`         | `{ windowId, tabId, title, url, position }`     |
| `tab:closed`     | WindowManager.ts | `closeTab()`          | `{ windowId, tabId }`                           |
| `tab:activated`  | WindowManager.ts | `switchTab()`         | `{ windowId, tabId, previousTabId }`            |
| `tab:updated`    | WindowManager.ts | `updateTab()`         | `{ windowId, tabId, title?, url? }`             |
| `tab:moved`      | WindowManager.ts | `reorderTabs()`       | `{ windowId, tabId, fromPosition, toPosition }` |
| `window:created` | WindowManager.ts | `createWindow()`      | `{ windowId, type }`                            |
| `window:closed`  | WindowManager.ts | `setupWindowEvents()` | `{ windowId }`                                  |
| `window:focused` | WindowManager.ts | `setupWindowEvents()` | `{ windowId }`                                  |
| `window:blurred` | WindowManager.ts | `setupWindowEvents()` | `{ windowId }`                                  |

**结论**：✅ 所有事件都在 `WindowManager` 中统一发送

---

## 调用流程示例

### Tab 创建流程

```typescript
// 1. 前端调用 IPC
await window.api.tab.create({ title: 'New Tab', url: 'local://chat' })

// 2. IPC Handler 接收（tabHandlers.ts）
ipcMain.handle(TabChannels.CREATE, async (event, req) => {
  // 3. 调用 WindowManager
  const tabId = await windowManager.createTab(windowId, config)

  // 4. WindowManager 执行 + 发送事件
  //    ├─ 创建 Tab
  //    ├─ eventBus.emit('tab:created', payload) ← 在这里
  //    └─ return tabId

  // 5. IPC Handler 返回结果
  return { success: true, data: { tabId } }
})

// 6. 事件流转
// EventBus → IpcEventBroadcaster → Preload → 前端 EventBus → 组件
```

---

## 质量保证

### 类型检查 ✅

```bash
pnpm typecheck
# ✅ 通过
```

### 架构一致性 ✅

- ✅ 所有事件在 WindowManager 中发送
- ✅ IPC Handlers 不再发送事件
- ✅ 职责分离清晰

---

## 总结

通过这次架构调整，实现了：

1. **统一事件发送位置** - 所有事件都在 `WindowManager` 中
2. **清晰的职责分离** - 业务层负责事件，IPC 层负责协调
3. **更好的可维护性** - 修改集中，降低维护成本
4. **完整性保障** - 无论如何调用都会触发事件

现在的架构更加清晰、统一、易于维护！🎉
