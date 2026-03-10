# 事件系统修复说明

## 问题描述

后端（主进程）发送的事件无法推送到前端（渲染进程）。

## 根本原因

`IpcEventBroadcaster` 类虽然已经创建了单例实例，但其 `init()` 方法从未被调用，导致：

- 主进程的 EventBus 事件没有被监听
- 事件无法通过 IPC 通道转发到前端
- 前端的事件处理器收不到任何事件

## 修复方案

在 `IpcRegistrationHook.ts` 中添加 `ipcEventBroadcaster.init()` 调用。

### 修改的文件

**`src/main/lifecycle/IpcRegistrationHook.ts`**

```typescript
async execute(_context: LifecycleContext): Promise<void> {
  log.info('[IpcRegistrationHook] Registering IPC handlers...')

  try {
    // 动态导入以避免循环依赖
    const { registerIpcHandlers } = await import('@main/common/ipc')
    const { ipcEventBroadcaster } = await import('@main/common/ipc/eventBroadcaster')

    // 注册所有 IPC 处理器
    registerIpcHandlers()

    // ✅ 新增：初始化 IPC 事件广播器
    ipcEventBroadcaster.init()

    log.info('[IpcRegistrationHook] All IPC handlers registered successfully')
  } catch (error) {
    log.error('[IpcRegistrationHook] Failed to register IPC handlers:', error)
    throw error
  }
}
```

## 事件流程（修复后）

```
1. 后端 EventBus
   ↓ emit(EventTypes.TAB_CREATED, payload)

2. IpcEventBroadcaster (✅ 已初始化，正在监听)
   ↓ eventBus.on(EventTypes.TAB_CREATED, ...)
   ↓ broadcast(type, payload)
   ↓ win.webContents.send('ipc:event', message)

3. Preload onEvent
   ↓ ipcRenderer.on('ipc:event', callback)

4. Renderer EventBus
   ↓ eventBus.emit(message.type, message.payload)

5. Event Handlers
   ↓ logEvent('Tab 创建', payload)
   ✅ 日志记录到 LogStore
```

## 验证步骤

### 1. 启动应用

```bash
pnpm dev
```

### 2. 检查控制台日志

在**主进程终端**应该看到：

```
[IpcRegistrationHook] Registering IPC handlers...
[IpcEventBroadcaster] Initialized
[IpcEventBroadcaster] Event listeners setup completed
[IpcRegistrationHook] All IPC handlers registered successfully
```

### 3. 打开日志查看器

1. 点击应用右下角的**蓝色浮动按钮**
2. 应该能看到各种事件日志

### 4. 触发事件测试

执行以下操作，观察日志面板：

#### 测试 Window 事件

- **最小化窗口** → 应该看到 "窗口最小化" 日志
- **最大化窗口** → 应该看到 "窗口最大化" 日志
- **恢复窗口** → 应该看到 "窗口取消最大化" 日志
- **改变窗口大小** → 应该看到 "窗口大小变化" 日志
- **窗口失焦/聚焦** → 应该看到对应日志

#### 测试 App 事件（macOS）

- **点击 Dock 图标** → 应该看到 "应用激活" 日志
- **切换到其他应用再切回来** → 应该看到 "应用获得焦点" 日志

#### 测试 Tab 事件（如果实现了 Tab 功能）

- **创建新 Tab** → 应该看到 "Tab 创建" 日志
- **切换 Tab** → 应该看到 "Tab 激活" 日志
- **关闭 Tab** → 应该看到 "Tab 关闭" 日志

### 5. 使用日志过滤器

在日志面板中测试过滤功能：

1. **按级别过滤**：
   - 选择 "Info" → 只显示 info 级别的日志
   - 选择 "Error" → 只显示错误日志

2. **按分类过滤**：
   - 选择 "Window" → 只显示窗口相关日志
   - 选择 "App" → 只显示应用相关日志
   - 选择 "Tab" → 只显示 Tab 相关日志

3. **搜索功能**：
   - 输入 "窗口" → 过滤包含"窗口"的日志
   - 输入 "创建" → 过滤包含"创建"的日志

### 6. 检查日志详情

1. 点击任意日志行
2. 应该展开显示完整的 `data` 内容（JSON 格式）
3. 点击日志右侧的复制按钮，应该能复制日志内容

## 预期结果

✅ **修复成功的标志**：

1. 主进程日志显示 `[IpcEventBroadcaster] Initialized`
2. 日志查看器能收到并显示后端事件
3. 所有窗口操作都能在日志面板中实时看到
4. 日志过滤、搜索、复制功能正常工作

❌ **仍有问题的表现**：

1. 日志查看器为空或只有少量日志
2. 窗口操作后没有新日志出现
3. 控制台报错

## 调试技巧

### 如果仍然收不到事件：

1. **检查主进程日志**：

   ```bash
   # 应该看到 IpcEventBroadcaster 初始化日志
   [IpcEventBroadcaster] Initialized
   ```

2. **检查事件发送日志**：
   - 设置 log level 为 debug
   - 应该看到 `[IpcEventBroadcaster] Broadcast event: xxx to N windows`

3. **检查前端 IPC 监听**：
   - 打开开发者工具（F12）
   - Console 应该看到 `[ipcSetup] IPC events initialized`

4. **检查事件处理器注册**：
   - Console 应该看到：
     ```
     [TabEvents] Tab 事件处理器已注册
     [WindowEvents] 窗口事件处理器已注册
     [AppEvents] 应用事件处理器已注册
     ```

### 添加调试日志

如果需要更详细的调试信息，可以临时添加：

```typescript
// 在 ipcSetup.ts 中
window.api.onEvent((message) => {
  console.log('[ipcSetup] Received event:', message.type, message.payload);
  eventBus.emit(message.type, message.payload);
});

// 在 eventBroadcaster.ts 的 broadcast 方法中
log.info(`[IpcEventBroadcaster] Broadcasting ${type} to ${sentCount} windows`);
```

## 相关文件

- **后端事件发送**：`src/main/common/window/WindowManager.ts`
- **事件广播器**：`src/main/common/ipc/eventBroadcaster.ts`
- **生命周期初始化**：`src/main/lifecycle/IpcRegistrationHook.ts`
- **前端 IPC 监听**：`src/renderer/src/plugins/ipcSetup.ts`
- **前端事件处理**：`src/renderer/src/eventbus/event_handles/`
- **日志存储**：`src/renderer/src/stores/log.ts`
- **日志查看器**：`src/renderer/src/components/LogViewer.vue`

## 总结

这个修复非常简单但关键：

- **问题**：忘记调用 `ipcEventBroadcaster.init()`
- **修复**：在 IPC 注册阶段添加初始化调用
- **影响**：打通了主进程到渲染进程的完整事件流
- **效果**：所有后端事件现在都能正确推送到前端并显示在日志查看器中

修复后，整个事件系统应该能完整工作，你可以实时看到应用中发生的所有事件！🎉
