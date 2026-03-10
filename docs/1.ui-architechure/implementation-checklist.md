# 多窗口架构实现清单

## 📋 任务清单

---

## 阶段 1：WindowManager 基础实现

### 1.1 创建 WindowManager 类

**文件**: `src/main/managers/WindowManager.ts`

**任务**:

- [ ] 定义 `WindowConfig` 接口
- [ ] 定义 `WindowInfo` 接口
- [ ] 创建 `WindowManager` 类骨架
- [ ] 实现窗口存储 `Map<number, WindowInfo>`
- [ ] 实现主窗口 ID 和焦点窗口 ID 跟踪

**代码模板**:

```typescript
import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { WindowEvents } from '@shared/events';

export interface WindowConfig {
  type: 'main' | 'chat' | 'browser' | 'settings' | 'floating';
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  initialUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface WindowInfo {
  id: number;
  type: WindowConfig['type'];
  window: BrowserWindow;
  isMain: boolean;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export class WindowManager {
  private windows: Map<number, WindowInfo> = new Map();
  private mainWindowId: number | null = null;
  private focusedWindowId: number | null = null;

  constructor() {
    log.info('[WindowManager] 初始化窗口管理器');
  }

  // TODO: 实现方法
}
```

---

### 1.2 实现窗口创建方法

**任务**:

- [ ] 实现 `createWindow()` 方法
- [ ] 定义窗口类型预设配置
- [ ] 合并用户配置和预设配置
- [ ] 创建 BrowserWindow 实例
- [ ] 注册窗口到 Map
- [ ] 设置窗口事件监听器
- [ ] 加载窗口内容

**代码模板**:

```typescript
private readonly WINDOW_PRESETS: Record<
  WindowConfig['type'],
  Partial<BrowserWindowConstructorOptions>
> = {
  main: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  },
  chat: {
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400
  },
  browser: {
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600
  },
  settings: {
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    resizable: true
  },
  floating: {
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true
  }
}

createWindow(config: WindowConfig): BrowserWindow | null {
  try {
    log.info(`[WindowManager] 创建窗口: ${config.type}`)

    // 1. 合并配置
    const preset = this.WINDOW_PRESETS[config.type]
    const windowOptions: BrowserWindowConstructorOptions = {
      ...preset,
      width: config.width ?? preset.width,
      height: config.height ?? preset.height,
      // ... 合并其他配置
    }

    // 2. 创建窗口
    const window = new BrowserWindow(windowOptions)
    const windowId = window.id

    // 3. 注册窗口信息
    const windowInfo: WindowInfo = {
      id: windowId,
      type: config.type,
      window,
      isMain: config.type === 'main',
      createdAt: new Date(),
      metadata: config.metadata
    }
    this.windows.set(windowId, windowInfo)

    // 4. 设置主窗口
    if (config.type === 'main') {
      this.mainWindowId = windowId
    }

    // 5. 绑定窗口事件
    this.setupWindowEvents(windowId)

    // 6. 加载内容
    this.loadWindowContent(window, config.initialUrl || '/')

    // 7. 发送事件
    eventBus.emit(WindowEvents.CREATED, { windowId, type: config.type })

    return window
  } catch (error) {
    log.error('[WindowManager] 创建窗口失败:', error)
    return null
  }
}
```

---

### 1.3 实现窗口事件处理

**任务**:

- [ ] 监听窗口就绪事件 `ready-to-show`
- [ ] 监听窗口关闭事件 `closed`
- [ ] 监听窗口焦点事件 `focus`/`blur`
- [ ] 监听窗口最小化/最大化事件
- [ ] 通过 eventBus 发送窗口状态变更

**代码模板**:

```typescript
private setupWindowEvents(windowId: number): void {
  const windowInfo = this.windows.get(windowId)
  if (!windowInfo) return

  const { window } = windowInfo

  // 就绪显示
  window.on('ready-to-show', () => {
    log.info(`[WindowManager] 窗口就绪: ${windowId}`)
    window.show()
    eventBus.emit(WindowEvents.READY_TO_SHOW, { windowId })
  })

  // 窗口关闭
  window.on('closed', () => {
    log.info(`[WindowManager] 窗口关闭: ${windowId}`)
    this.windows.delete(windowId)

    // 如果是主窗口关闭，退出应用
    if (windowId === this.mainWindowId) {
      app.quit()
    }

    eventBus.emit(WindowEvents.CLOSED, { windowId })
  })

  // 焦点变更
  window.on('focus', () => {
    this.focusedWindowId = windowId
    eventBus.emit(WindowEvents.FOCUS, { windowId })
  })

  window.on('blur', () => {
    if (this.focusedWindowId === windowId) {
      this.focusedWindowId = null
    }
    eventBus.emit(WindowEvents.BLUR, { windowId })
  })

  // 最小化/最大化
  window.on('minimize', () => {
    eventBus.emit(WindowEvents.MINIMIZE, { windowId })
  })

  window.on('maximize', () => {
    eventBus.emit(WindowEvents.MAXIMIZE, { windowId })
  })

  window.on('unmaximize', () => {
    eventBus.emit(WindowEvents.UNMAXIMIZE, { windowId })
  })
}
```

---

### 1.4 实现窗口获取方法

**任务**:

- [ ] `getWindow(windowId)` - 获取指定窗口
- [ ] `getAllWindows()` - 获取所有窗口
- [ ] `getMainWindow()` - 获取主窗口
- [ ] `getFocusedWindow()` - 获取焦点窗口
- [ ] `getWindowsByType(type)` - 按类型获取窗口

**代码模板**:

```typescript
getWindow(windowId: number): BrowserWindow | null {
  return this.windows.get(windowId)?.window || null
}

getAllWindows(): WindowInfo[] {
  return Array.from(this.windows.values())
}

getMainWindow(): BrowserWindow | null {
  if (!this.mainWindowId) return null
  return this.getWindow(this.mainWindowId)
}

getFocusedWindow(): BrowserWindow | null {
  if (!this.focusedWindowId) return null
  return this.getWindow(this.focusedWindowId)
}

getWindowsByType(type: WindowConfig['type']): WindowInfo[] {
  return this.getAllWindows().filter((info) => info.type === type)
}

getWindowCount(): number {
  return this.windows.size
}
```

---

### 1.5 实现窗口操作方法

**任务**:

- [ ] `focusWindow(windowId)` - 聚焦窗口
- [ ] `closeWindow(windowId)` - 关闭窗口
- [ ] `closeAllWindows(except?)` - 关闭所有窗口
- [ ] `minimizeWindow(windowId)` - 最小化窗口
- [ ] `maximizeWindow(windowId)` - 最大化窗口
- [ ] `restoreWindow(windowId)` - 恢复窗口

**代码模板**:

```typescript
focusWindow(windowId: number): void {
  const window = this.getWindow(windowId)
  if (window) {
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()
  }
}

closeWindow(windowId: number): void {
  const window = this.getWindow(windowId)
  if (window && !window.isDestroyed()) {
    window.close()
  }
}

closeAllWindows(except?: number): void {
  for (const [windowId, info] of this.windows) {
    if (except && windowId === except) continue
    this.closeWindow(windowId)
  }
}

minimizeWindow(windowId: number): void {
  const window = this.getWindow(windowId)
  if (window) {
    window.minimize()
  }
}

maximizeWindow(windowId: number): void {
  const window = this.getWindow(windowId)
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  }
}

restoreWindow(windowId: number): void {
  const window = this.getWindow(windowId)
  if (window && window.isMinimized()) {
    window.restore()
  }
}
```

---

## 阶段 2：AppManager 集成

### 2.1 集成 WindowManager

**文件**: `src/main/common/app.ts`

**任务**:

- [ ] 在 `AppManager` 中添加 `windowManager` 属性
- [ ] 在 `initialize()` 中初始化 `WindowManager`
- [ ] 在应用就绪后创建主窗口
- [ ] 添加 `getWindowManager()` 方法

**代码模板**:

```typescript
import { WindowManager } from '@main/managers/WindowManager';

export class AppManager {
  private lifecycleManager: LifecycleManager;
  private windowManager!: WindowManager;

  async initialize(): Promise<void> {
    try {
      log.info('[App] 开始初始化应用...');

      // 1. 应用基础配置
      electronApp.setAppUserModelId('com.electron');

      // 2. 单实例锁定
      this.setupSingleInstance();

      await app.whenReady();

      // 3. 初始化窗口管理器
      this.windowManager = new WindowManager();
      log.info('[App] 窗口管理器初始化完成');

      // 4. 触发 INIT 阶段
      await this.lifecycleManager.executePhase(LifecyclePhase.INIT);

      // 5. 创建主窗口
      const mainWindow = this.windowManager.createWindow({
        type: 'main',
        initialUrl: '/'
      });

      if (!mainWindow) {
        throw new Error('创建主窗口失败');
      }

      // 6. 触发 READY 阶段
      await this.lifecycleManager.executePhase(LifecyclePhase.READY);

      log.info('[App] 应用初始化完成');
    } catch (error) {
      log.error('[App] 应用初始化失败:', error);
      throw error;
    }
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }
}
```

---

### 2.2 实现单实例锁定

**任务**:

- [ ] 在 `AppManager` 中实现 `setupSingleInstance()`
- [ ] 请求单实例锁 `app.requestSingleInstanceLock()`
- [ ] 监听 `second-instance` 事件
- [ ] 聚焦主窗口

**代码模板**:

```typescript
private setupSingleInstance(): void {
  const gotTheLock = app.requestSingleInstanceLock()

  if (!gotTheLock) {
    log.info('[App] 应用已在运行，退出当前实例')
    app.quit()
    return
  }

  log.info('[App] 获得单实例锁')

  app.on('second-instance', (event, commandLine, workingDirectory) => {
    log.info('[App] 检测到第二个实例启动', {
      commandLine,
      workingDirectory
    })

    // 聚焦主窗口
    const mainWindow = this.windowManager.getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }

    // TODO: 处理命令行参数（如深度链接）
  })
}
```

---

## 阶段 3：IPC 通信实现

### 3.1 创建 IPC Handlers

**文件**: `src/main/ipc/handlers/WindowHandlers.ts`

**任务**:

- [ ] 创建窗口操作的 IPC 处理器
- [ ] 注册 `window:create` 处理器
- [ ] 注册 `window:close` 处理器
- [ ] 注册 `window:focus` 处理器
- [ ] 注册 `window:get-all` 处理器

**代码模板**:

```typescript
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { appManager } from '@main/common/app';
import { log } from '@main/common/logger';
import type { WindowConfig } from '@main/managers/WindowManager';

export function registerWindowHandlers(): void {
  // 创建窗口
  ipcMain.handle('window:create', async (event: IpcMainInvokeEvent, config: WindowConfig) => {
    try {
      log.info('[IPC] 创建窗口请求:', config);
      const window = appManager.getWindowManager().createWindow(config);

      if (!window) {
        throw new Error('创建窗口失败');
      }

      return {
        success: true,
        windowId: window.id
      };
    } catch (error) {
      log.error('[IPC] 创建窗口失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  });

  // 关闭窗口
  ipcMain.handle('window:close', async (event: IpcMainInvokeEvent, windowId: number) => {
    try {
      log.info('[IPC] 关闭窗口请求:', windowId);
      appManager.getWindowManager().closeWindow(windowId);
      return { success: true };
    } catch (error) {
      log.error('[IPC] 关闭窗口失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  });

  // 聚焦窗口
  ipcMain.handle('window:focus', async (event: IpcMainInvokeEvent, windowId: number) => {
    try {
      appManager.getWindowManager().focusWindow(windowId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  });

  // 获取所有窗口
  ipcMain.handle('window:get-all', async () => {
    try {
      const windows = appManager.getWindowManager().getAllWindows();
      return {
        success: true,
        windows: windows.map((info) => ({
          id: info.id,
          type: info.type,
          isMain: info.isMain,
          createdAt: info.createdAt,
          metadata: info.metadata
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  });

  log.info('[IPC] 窗口处理器注册完成');
}
```

---

### 3.2 注册 IPC Handlers

**文件**: `src/main/ipc/index.ts`

**任务**:

- [ ] 创建 IPC 注册入口
- [ ] 导入并调用所有 Handler 注册函数

**代码模板**:

```typescript
import { registerWindowHandlers } from './handlers/WindowHandlers';
// import { registerDatabaseHandlers } from './handlers/DatabaseHandlers'
// import { registerConfigHandlers } from './handlers/ConfigHandlers'

export function registerIpcHandlers(): void {
  registerWindowHandlers();
  // registerDatabaseHandlers()
  // registerConfigHandlers()
}
```

**在 AppManager 中调用**:

```typescript
import { registerIpcHandlers } from '@main/ipc'

async initialize() {
  // ...
  await app.whenReady()

  // 注册 IPC 处理器
  registerIpcHandlers()

  // ...
}
```

---

### 3.3 更新 Preload API

**文件**: `src/preload/index.ts`

**任务**:

- [ ] 暴露窗口操作 API 给渲染进程
- [ ] 使用 `contextBridge.exposeInMainWorld`

**代码模板**:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// 窗口 API
const windowApi = {
  // 创建窗口
  create: (config: unknown) => ipcRenderer.invoke('window:create', config),

  // 关闭窗口
  close: (windowId: number) => ipcRenderer.invoke('window:close', windowId),

  // 聚焦窗口
  focus: (windowId: number) => ipcRenderer.invoke('window:focus', windowId),

  // 获取所有窗口
  getAll: () => ipcRenderer.invoke('window:get-all'),

  // 监听窗口事件
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },

  // 移除监听
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  }
};

// 暴露到渲染进程
contextBridge.exposeInMainWorld('windowApi', windowApi);
```

**类型定义**: `src/preload/index.d.ts`

```typescript
export interface WindowApi {
  create: (config: unknown) => Promise<{ success: boolean; windowId?: number; error?: string }>;
  close: (windowId: number) => Promise<{ success: boolean; error?: string }>;
  focus: (windowId: number) => Promise<{ success: boolean; error?: string }>;
  getAll: () => Promise<{ success: boolean; windows?: unknown[]; error?: string }>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    windowApi: WindowApi;
  }
}
```

---

## 阶段 4：事件定义扩展

### 4.1 添加窗口事件

**文件**: `src/shared/events.d.ts`

**任务**:

- [ ] 添加窗口创建事件
- [ ] 添加窗口关闭事件
- [ ] 添加窗口焦点事件等

**代码扩展**:

```typescript
export enum WindowEvents {
  // 新增
  CREATED = 'window:created', // 窗口已创建
  CLOSED = 'window:closed', // 窗口已关闭
  FOCUS = 'window:focus', // 窗口获得焦点
  BLUR = 'window:blur', // 窗口失去焦点
  MINIMIZE = 'window:minimize', // 窗口最小化
  MAXIMIZE = 'window:maximize', // 窗口最大化
  UNMAXIMIZE = 'window:unmaximize', // 窗口取消最大化

  // 原有的...
  READY_TO_SHOW = 'window:ready-to-show'
  // ...
}

// 扩展事件负载
export interface EventPayloads {
  [WindowEvents.CREATED]: { windowId: number; type: string };
  [WindowEvents.CLOSED]: { windowId: number };
  [WindowEvents.FOCUS]: { windowId: number };
  [WindowEvents.BLUR]: { windowId: number };
  // ...
}
```

---

## 测试清单

### 单元测试

- [ ] WindowManager 创建窗口测试
- [ ] WindowManager 获取窗口测试
- [ ] WindowManager 操作窗口测试
- [ ] 单实例锁定测试

### 集成测试

- [ ] 创建多个窗口
- [ ] 窗口间通信
- [ ] 窗口焦点切换
- [ ] 窗口关闭后资源清理

### 性能测试

- [ ] 创建 10 个窗口的性能
- [ ] 内存占用测试
- [ ] 窗口切换响应时间

---

## 完成标准

- ✅ 所有代码通过 TypeScript 类型检查
- ✅ 所有代码通过 ESLint 检查
- ✅ 单元测试覆盖率 > 80%
- ✅ 所有功能通过集成测试
- ✅ 文档完善，包含使用示例
- ✅ 性能指标达标

---

## 下一步

开始实施 **阶段 1.1 - 创建 WindowManager 类**
