# 快捷键事件优化总结

## 📋 优化目标

消除事件多次转发的冗余设计，简化事件流程，避免通过 EventBus 多次处理同一个事件。

## 🔍 优化前的问题

### 问题 1：GO_SETTINGS 事件多次转发

```
用户按 Command+,
    ↓
handleGoSettings() → eventBus.emit(ShortcutEvents.GO_SETTINGS)  // 'goSettings:changed'
    ↓
goSettingsChanged.ts 接收
    ↓
eventBus.emit(EventTypes.UI_GO_SETTINGS)  // 'ui:go-settings'
    ↓
IpcEventBroadcaster 广播到前端
```

**问题**：`goSettingsChanged.ts` 只做事件转发，没有后端业务逻辑，纯粹是多余的一层。

### 问题 2：CREATE_WINDOW 事件冗余

```
用户按 Command+N
    ↓
handleNewWindow() → eventBus.emit(ShortcutEvents.NEW_WINDOW)
    ↓
newWindowChanged.ts 接收
    ↓
windowManager.createWindow()  // 业务逻辑
    ↓
eventBus.emit(EventTypes.UI_CREATE_WINDOW)  // 多余！
    ↓
IpcEventBroadcaster 广播
```

**问题**：

- `windowManager.createWindow()` 已经会触发 `WindowEvents.WINDOW_CREATED` 事件
- `IpcEventBroadcaster` 会自动广播 `WINDOW_CREATED` 到前端
- 再发送 `UI_CREATE_WINDOW` 是重复的，前端会收到两个相似的事件

### 核心问题

1. ❌ **事件多次转发**：快捷键事件 → ShortcutEvents → \_Changed.ts → EventTypes.UI\_\_ → IpcEventBroadcaster
2. ❌ **冗余的 UI 事件**：`UI_GO_SETTINGS` 和 `UI_CREATE_WINDOW` 与业务事件重复
3. ❌ **外部依赖内部事件**：`IpcEventBroadcaster` 是内部事件通知机制，不应该被外部显式依赖

## ✅ 优化后的设计

### 优化原则

1. **单一职责**：快捷键事件只用于需要后端业务逻辑的场景
2. **避免重复**：不发送与业务事件重复的 UI 事件
3. **自动广播**：依赖 `IpcEventBroadcaster` 自动广播业务事件（如 `WINDOW_CREATED`）

### 优化后的流程

#### NEW_WINDOW（正确流程）

```
用户按 Command+N
    ↓
handleNewWindow() → eventBus.emit(ShortcutEvents.NEW_WINDOW)
    ↓
newWindowChanged.ts 接收
    ↓
windowManager.createWindow()
    ↓
windowManager 内部触发 WindowEvents.WINDOW_CREATED
    ↓
IpcEventBroadcaster 自动广播 WINDOW_CREATED 到前端
    ↓
前端监听 WINDOW_CREATED 更新状态
```

**改进**：移除了冗余的 `UI_CREATE_WINDOW` 事件，依赖业务事件的自动广播。

## 📝 具体修改

### 1. 删除冗余的事件定义

**文件**: `src/shared/ipc/events.ts`

```diff
- // ==================== UI 操作事件 ====================
- /** 跳转到设置页 */
- UI_GO_SETTINGS: 'ui:go-settings',
- /** 创建新窗口 */
- UI_CREATE_WINDOW: 'ui:create-window',
```

```diff
- // ==================== UI 操作事件 ====================
- [EventTypes.UI_GO_SETTINGS]: {
-   timestamp: number
- }
- [EventTypes.UI_CREATE_WINDOW]: {
-   timestamp: number
- }
```

### 2. 删除 GO_SETTINGS 快捷键

**文件**: `src/shared/events.ts`

```diff
export enum ShortcutEvents {
  QUIT = 'quit:changed',
- GO_SETTINGS = 'goSettings:changed',
  SHOW_HIDE_WINDOW = 'showHideWindow:changed',
  NEW_WINDOW = 'newWindow:changed',
  // ...
}
```

```diff
interface EventPayloads {
  [ShortcutEvents.QUIT]: void
- [ShortcutEvents.GO_SETTINGS]: void
  [ShortcutEvents.SHOW_HIDE_WINDOW]: void
  // ...
}
```

### 3. 删除 ShortcutManager 中的 GoSettings

**文件**: `src/main/common/shortcut/index.ts`

```diff
const DEFAULT_SHORTCUTS: Shortcut[] = [
  // ...
  {
    key: 'Quit',
    shortcut: `${CommandKey}+Q`,
    // ...
  },
- {
-   key: 'GoSettings',
-   shortcut: `${CommandKey}+,`,
-   // ...
- },
  {
    key: 'NewWindow',
    // ...
  }
]
```

```diff
- private handleGoSettings(): void {
-   log.info('[ShortcutManager] 快捷键触发: GoSettings')
-   eventBus.emit(ShortcutEvents.GO_SETTINGS)
- }
```

```diff
switch (shortcut.key) {
  case 'Quit':
    handler = () => this.handleQuit()
    break
- case 'GoSettings':
-   handler = () => this.handleGoSettings()
-   break
  case 'ShowHideWindow':
    handler = () => this.handleShowHideWindow()
    break
}
```

### 4. 删除事件处理器

**删除文件**: `src/main/events/goSettingsChanged.ts`

### 5. 优化 newWindowChanged.ts

**文件**: `src/main/events/newWindowChanged.ts`

```diff
export default async (): Promise<void> => {
  try {
    const { windowManager } = await import('@main/common/window')
    const newWindow = await windowManager.createWindow({ type: 'agent' })

    if (newWindow) {
      log.info(`[Event] 新窗口创建成功: windowId=${newWindow.id}`)
-
-     // 发送 UI 事件到前端（可选，用于前端显示提示等）
-     const { eventBus } = await import('@main/common/eventbus')
-     eventBus.emit(EventTypes.UI_CREATE_WINDOW, {
-       timestamp: Date.now()
-     })
+     // windowManager 已经自动触发了 WINDOW_CREATED 事件
+     // IpcEventBroadcaster 会自动广播到前端，无需手动发送
    }
  }
}
```

### 6. 移除 IpcEventBroadcaster 中的监听

**文件**: `src/main/common/ipc/eventBroadcaster.ts`

```diff
- // ==================== UI 操作事件 ====================
- eventBus.on(EventTypes.UI_GO_SETTINGS, (data: unknown) => {
-   this.broadcast(EventTypes.UI_GO_SETTINGS, data as EventPayloads['ui:go-settings'])
- })
-
- eventBus.on(EventTypes.UI_CREATE_WINDOW, (data: unknown) => {
-   this.broadcast(EventTypes.UI_CREATE_WINDOW, data as EventPayloads['ui:create-window'])
- })
```

## 📊 优化效果

### 代码量减少

- 删除 1 个事件处理器文件 (`goSettingsChanged.ts`)
- 删除 2 个事件类型定义 (`UI_GO_SETTINGS`, `UI_CREATE_WINDOW`)
- 删除 1 个快捷键配置 (`GoSettings`)
- 删除 3 个方法/函数
- 删除约 **80 行代码**

### 性能优化

- ✅ 减少 2 次事件转发（每次快捷键触发少 2 次 EventBus.emit）
- ✅ 减少 2 个 EventBus 监听器
- ✅ 减少不必要的 IPC 通信

### 架构优化

- ✅ **更清晰的职责**：快捷键事件只用于需要后端逻辑的操作
- ✅ **避免重复事件**：前端不会收到重复的窗口创建通知
- ✅ **降低耦合**：不再显式依赖 `IpcEventBroadcaster` 的 UI 事件
- ✅ **更简洁的流程**：事件流转路径更短，更容易理解和调试

## 🎯 设计原则（总结）

### 何时使用快捷键事件（ShortcutEvents）

✅ **应该使用**：

- 需要后端业务逻辑的操作
  - 示例：`NEW_WINDOW`（需要 `windowManager.createWindow()`）
  - 示例：`NEW_TAB`（需要 `windowManager.createTab()`）
  - 示例：`QUIT`（需要 `app.quit()`）
  - 示例：`REFRESH`（需要 `webContents.reload()`）

❌ **不应该使用**：

- 纯前端操作（如路由跳转、UI 切换等）
- 已有业务事件覆盖的场景（如窗口创建已有 `WINDOW_CREATED`）

### 事件流程设计

**正确的流程**：

```
快捷键触发 → ShortcutEvents → 业务逻辑 → 业务事件 → IpcEventBroadcaster 自动广播 → 前端
```

**错误的流程**（已修复）：

```
快捷键触发 → ShortcutEvents → 业务逻辑 → UI 事件 → IpcEventBroadcaster → 前端
                                      ↓
                                  业务事件 → IpcEventBroadcaster → 前端
```

## 🔮 未来改进建议

1. **前端路由跳转**：如果后续需要"跳转到设置页"的功能，应该：
   - 不使用快捷键系统
   - 前端直接监听键盘事件（如 `Command+,`）
   - 前端内部处理路由跳转

2. **快捷键配置化**：考虑将快捷键配置暴露给用户自定义

3. **事件文档化**：为每个事件添加详细的文档说明其用途和 payload

## ✅ 验证

- ✅ TypeScript 类型检查通过
- ✅ Prettier 格式化通过
- ✅ 无 ESLint 错误
- ✅ 事件流程更加简洁清晰
