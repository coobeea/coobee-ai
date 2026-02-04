# Electron 多窗口多 Tab 完整架构指导

> **唯一的架构指导文档** - 实现 catax-bot 风格的**单主进程 + 多窗口 + 多 Tab（WebContentsView）**完整方案

## 📖 文档说明

这是 **coobee-ai 项目的唯一完整架构指导文档**，包含：

- ✅ **窗口管理**（WindowManager）- 基础架构
- ✅ **Tab 管理**（TabManager）- 核心特性 ⭐
- ✅ **实施步骤** - 详细的分步指导
- ✅ **代码模板** - 可直接使用的代码

**阅读时间**：30-40 分钟  
**实施时间**：10-15 天

---

## 🎯 架构概览

### 两种窗口类型设计

coobee-ai 采用**双窗口类型架构**，专注核心功能：

| 窗口类型    | 用途              | 典型 Tab 类型        | 使用场景                    |
| ----------- | ----------------- | -------------------- | --------------------------- |
| **agent**   | AI Agent 交互窗口 | chat, task, settings | AI 对话、任务管理、系统设置 |
| **browser** | 浏览器窗口        | webpage              | 网页浏览、内容查看          |

**设计理念**：

- ✅ **专注核心**：只保留最必要的两种窗口类型
- ✅ **职责清晰**：Agent 窗口处理 AI 交互，Browser 窗口处理网页浏览
- ✅ **灵活扩展**：每种窗口内支持多种 Tab 类型

---

## 🎯 核心特性

### 关键架构：三层管理

```
应用层 (AppManager)
  ├─ 窗口层 (WindowManager)  ← 管理多个窗口
  └─ Tab 层 (TabManager) ⭐   ← 每个窗口内管理多个 Tab
```

**核心亮点**：

- ✅ **独立进程**：每个 Tab 是独立的渲染进程（WebContentsView）
- ✅ **崩溃隔离**：Tab 崩溃不影响其他 Tab 和窗口
- ✅ **内存隔离**：每个 Tab 有独立的内存空间
- ✅ **灵活布局**：Tab 可以在窗口间拖拽移动
- ✅ **浏览器体验**：类似 Chrome 的多 Tab 体验

---

## 📊 完整架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        操作系统                                    │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  主进程 (Main Process) - 单例                               │  │
│  │  ────────────────────────────────────                        │
│  │  • AppManager                                              │  │
│  │  • WindowManager (管理所有窗口)                             │  │
│  │  • TabManager    (管理所有 Tab) ⭐                         │  │
│  │  • EventBus                                                │  │
│  │  • DatabaseService                                         │  │
│  │  • ConfigManager                                           │  │
│  └────┬─────────────────┬──────────────────┬──────────────────┘  │
│       │                 │                  │                      │
│   创建窗口           创建窗口            创建窗口                  │
│       │                 │                  │                      │
│  ┌────▼────────┐   ┌───▼─────────┐   ┌───▼─────────┐           │
│  │ 窗口 1      │   │ 窗口 2       │   │ 窗口 3       │           │
│  │ (Agent)     │   │ (Browser)    │   │ (Agent)      │           │
│  │             │   │              │   │              │           │
│  │ ┌─────────┐ │   │ ┌──────────┐│   │ ┌──────────┐│           │
│  │ │ Tab 1   │ │   │ │ Tab 1    ││   │ │ Tab 1    ││           │
│  │ │ Chat    │ │   │ │ Web Page ││   │ │ Task     ││           │
│  │ │ (View)  │ │   │ │ (View)   ││   │ │ (View)   ││           │
│  │ └─────────┘ │   │ └──────────┘│   │ └──────────┘│           │
│  │             │   │              │   │              │           │
│  │ ┌─────────┐ │   │ ┌──────────┐│   │              │           │
│  │ │ Tab 2   │ │   │ │ Tab 2    ││   │              │           │
│  │ │ Task    │ │   │ │ Web Page ││   │              │           │
│  │ │ (View)  │ │   │ │ (View)   ││   │              │           │
│  │ └─────────┘ │   │ └──────────┘│   │              │           │
│  │             │   │              │   │              │           │
│  │ ┌─────────┐ │   │              │   │              │           │
│  │ │ Tab 3   │ │   │              │   │              │           │
│  │ │Settings │ │   │              │   │              │           │
│  │ │ (View)  │ │   │              │   │              │           │
│  │ └─────────┘ │   │              │   │              │           │
│  └─────────────┘   └──────────────┘   └──────────────┘           │
│                                                                    │
│  说明：                                                             │
│  • 每个 Tab 是一个独立的 WebContentsView (独立渲染进程)            │
│  • 每个 Tab 有自己的 webContents                                  │
│  • Tab 可以在窗口间拖拽移动                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📋 完整实施路线图

```
阶段 1: WindowManager (1-2天)
  ↓
阶段 2: TabManager (2-3天)
  ↓
阶段 3: IPC 通信 (1天)
  ↓
阶段 4: Shell 窗口 (1-2天)
  ↓
阶段 5: 测试优化 (2-3天)
─────────────────
总计: 7-11 天
```

**详细实施步骤请参考**：[implementation-checklist.md](./implementation-checklist.md)

---

## 🔑 核心技术：WebContentsView

### 什么是 WebContentsView？

**WebContentsView** 是 Electron 提供的一个 API，用于在 BrowserWindow 中嵌入独立的网页内容。

**关键特性**：

- ✅ 每个 View 是**独立的渲染进程**
- ✅ 有自己的 `webContents` 对象
- ✅ 可以动态添加/移除到窗口
- ✅ 可以调整位置和大小
- ✅ 进程隔离，崩溃不影响其他 Tab

**与传统方案对比**：

| 方案                 | 实现方式     | 进程隔离 | 性能 | 复杂度 |
| -------------------- | ------------ | -------- | ---- | ------ |
| **Vue Router Tab**   | 单页面路由   | ❌       | 高   | 低     |
| **iframe**           | 嵌入 iframe  | 部分     | 中   | 中     |
| **WebContentsView**  | 独立渲染进程 | ✅       | 高   | 高     |
| **多 BrowserWindow** | 多窗口       | ✅       | 低   | 高     |

---

## 🏗️ 组件架构设计

### 1. WindowManager（窗口管理器）

**职责**：

- 创建和管理 BrowserWindow
- 窗口生命周期管理
- 窗口状态跟踪
- 窗口事件处理

**数据结构**：

```typescript
interface WindowConfig {
  type: 'agent' | 'browser' // agent: AI Agent 交互窗口, browser: 浏览器窗口
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  frame?: boolean
  transparent?: boolean
  initialUrl?: string
  metadata?: Record<string, unknown>
}

interface WindowInfo {
  id: number
  type: WindowConfig['type']
  window: BrowserWindow
  isMain: boolean
  createdAt: Date
  metadata?: Record<string, unknown>
}
```

**核心方法**：

```typescript
class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map()
  private windowInfo: Map<number, WindowInfo> = new Map()
  private mainWindowId: number | null = null
  private focusedWindowId: number | null = null

  // 创建窗口
  createWindow(config: WindowConfig): BrowserWindow | null

  // 查询窗口
  getWindow(windowId: number): BrowserWindow | undefined
  getMainWindow(): BrowserWindow | undefined
  getFocusedWindow(): BrowserWindow | undefined
  getAllWindows(): BrowserWindow[]

  // 窗口操作
  closeWindow(windowId: number): Promise<boolean>
  focusWindow(windowId: number): boolean
  minimizeWindow(windowId: number): boolean
  maximizeWindow(windowId: number): boolean

  // 窗口通信
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void
  sendToAllWindows(channel: string, ...args: unknown[]): void

  // 内部方法
  private setupWindowEvents(windowId: number): void
  private loadWindowContent(window: BrowserWindow, url: string): Promise<void>
  private getWindowPreset(type: string): Partial<BrowserWindowConstructorOptions>
}
```

**窗口类型预设**：

```typescript
private readonly WINDOW_PRESETS = {
  agent: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  },
  browser: {
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}
```

**窗口类型说明**：

| 类型        | 用途              | 特点                                           |
| ----------- | ----------------- | ---------------------------------------------- |
| **agent**   | AI Agent 交互窗口 | 主要窗口，支持多 Tab，用于 AI 对话、任务管理等 |
| **browser** | 浏览器窗口        | 内置浏览器，支持多 Tab，用于网页浏览           |

---

### 2. TabManager（Tab 管理器）⭐ 核心

**职责**：

- 创建和管理 WebContentsView
- Tab 生命周期管理
- Tab 切换和关闭
- View 边界计算
- Tab 状态同步

### 核心数据结构

```typescript
interface TabInfo {
  id: number // Tab ID (使用 webContents.id)
  windowId: number // 所属窗口 ID
  view: WebContentsView // WebContentsView 实例
  url: string // 当前 URL
  title: string // Tab 标题
  icon?: string // Tab 图标
  type: 'chat' | 'task' | 'settings' | 'webpage' // Tab 类型
  isActive: boolean // 是否激活
  position: number // 位置顺序
  closable: boolean // 是否可关闭
  createdAt: Date // 创建时间
  metadata?: Record<string, unknown> // 其他元数据
}

class TabManager {
  // 全局 Tab 存储
  private tabs: Map<number, WebContentsView> = new Map()

  // Tab 状态存储
  private tabState: Map<number, TabInfo> = new Map()

  // 窗口 → Tab IDs 映射
  private windowTabs: Map<number, number[]> = new Map()

  // Tab ID → 窗口 ID 映射
  private tabWindowMap: Map<number, number> = new Map()

  // WebContents ID → Tab ID 映射（用于 IPC 来源识别）
  private webContentsToTabId: Map<number, number> = new Map()
}
```

---

## 🔧 实现步骤

### 阶段 1：创建 TabManager 类

**文件位置**：`src/main/managers/TabManager.ts`

**核心方法**：

```typescript
import { WebContentsView, BrowserWindow } from 'electron'
import { join } from 'path'
import { log } from '@main/common/logger'
import { eventBus } from '@main/common/eventbus'

export interface TabConfig {
  type: 'chat' | 'task' | 'settings' | 'webpage' // Tab 类型
  url?: string // 初始 URL，默认 '/'
  title?: string // Tab 标题
  icon?: string // Tab 图标
  closable?: boolean // 是否可关闭，默认 true
  metadata?: Record<string, unknown>
}

/**
 * Tab 类型说明：
 * - chat: AI 对话 Tab
 * - task: 任务管理 Tab
 * - settings: 设置 Tab
 * - webpage: 网页浏览 Tab（用于 browser 窗口）
 */

export interface TabInfo {
  id: number
  windowId: number
  view: WebContentsView
  url: string
  title: string
  icon?: string
  type: TabConfig['type']
  isActive: boolean
  position: number
  closable: boolean
  createdAt: Date
  metadata?: Record<string, unknown>
}

export class TabManager {
  private tabs: Map<number, WebContentsView> = new Map()
  private tabState: Map<number, TabInfo> = new Map()
  private windowTabs: Map<number, number[]> = new Map()
  private tabWindowMap: Map<number, number> = new Map()
  private webContentsToTabId: Map<number, number> = new Map()

  constructor() {
    log.info('[TabManager] 初始化 Tab 管理器')
    this.setupEventHandlers()
  }

  /**
   * 创建新 Tab
   * @param windowId 目标窗口 ID
   * @param config Tab 配置
   * @returns WebContentsView 实例
   */
  async createTab(windowId: number, config: TabConfig): Promise<WebContentsView | null> {
    try {
      const window = BrowserWindow.fromId(windowId)
      if (!window || window.isDestroyed()) {
        throw new Error(`窗口不存在: ${windowId}`)
      }

      log.info(`[TabManager] 创建 Tab: ${config.type} in window ${windowId}`)

      // 1. 创建 WebContentsView
      const view = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      const tabId = view.webContents.id

      // 2. 注册 Tab 信息
      const position = (this.windowTabs.get(windowId)?.length || 0) + 1
      const tabInfo: TabInfo = {
        id: tabId,
        windowId,
        view,
        url: config.url || '/',
        title: config.title || 'New Tab',
        icon: config.icon,
        type: config.type,
        isActive: false,
        position,
        closable: config.closable ?? true,
        createdAt: new Date(),
        metadata: config.metadata
      }

      this.tabs.set(tabId, view)
      this.tabState.set(tabId, tabInfo)
      this.webContentsToTabId.set(view.webContents.id, tabId)

      // 3. 添加到窗口
      window.contentView.addChildView(view)

      // 4. 更新窗口 Tab 列表
      if (!this.windowTabs.has(windowId)) {
        this.windowTabs.set(windowId, [])
      }
      this.windowTabs.get(windowId)!.push(tabId)
      this.tabWindowMap.set(tabId, windowId)

      // 5. 设置 View 边界
      this.updateViewBounds(window, view)

      // 6. 绑定事件
      this.setupTabEvents(tabId)

      // 7. 加载内容
      await this.loadTabContent(view, config.url || '/')

      // 8. 发送事件
      eventBus.emit('tab:created', { tabId, windowId, type: config.type })

      // 9. 通知窗口更新
      this.notifyWindowTabsUpdate(windowId)

      return view
    } catch (error) {
      log.error('[TabManager] 创建 Tab 失败:', error)
      return null
    }
  }

  /**
   * 切换激活的 Tab
   */
  async switchTab(tabId: number): Promise<boolean> {
    const tabInfo = this.tabState.get(tabId)
    if (!tabInfo) {
      log.warn(`[TabManager] Tab 不存在: ${tabId}`)
      return false
    }

    const { windowId, view } = tabInfo
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return false
    }

    // 1. 取消当前窗口所有 Tab 的激活状态
    const windowTabIds = this.windowTabs.get(windowId) || []
    for (const id of windowTabIds) {
      const info = this.tabState.get(id)
      if (info) {
        info.isActive = false
      }
    }

    // 2. 激活目标 Tab
    tabInfo.isActive = true

    // 3. 将 View 移到最上层
    window.contentView.removeChildView(view)
    window.contentView.addChildView(view)

    // 4. 更新边界
    this.updateViewBounds(window, view)

    // 5. 发送事件
    eventBus.emit('tab:switched', { tabId, windowId })

    // 6. 通知窗口更新
    this.notifyWindowTabsUpdate(windowId)

    log.info(`[TabManager] 切换 Tab: ${tabId}`)
    return true
  }

  /**
   * 关闭 Tab
   */
  async closeTab(tabId: number): Promise<boolean> {
    const tabInfo = this.tabState.get(tabId)
    if (!tabInfo) {
      return false
    }

    const { windowId, view } = tabInfo
    const window = BrowserWindow.fromId(windowId)

    log.info(`[TabManager] 关闭 Tab: ${tabId}`)

    // 1. 从窗口移除 View
    if (window && !window.isDestroyed()) {
      window.contentView.removeChildView(view)
    }

    // 2. 销毁 webContents
    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }

    // 3. 清理映射
    this.tabs.delete(tabId)
    this.tabState.delete(tabId)
    this.tabWindowMap.delete(tabId)
    this.webContentsToTabId.delete(view.webContents.id)

    // 4. 从窗口 Tab 列表移除
    const windowTabIds = this.windowTabs.get(windowId)
    if (windowTabIds) {
      const index = windowTabIds.indexOf(tabId)
      if (index > -1) {
        windowTabIds.splice(index, 1)
      }
    }

    // 5. 如果是激活的 Tab，切换到其他 Tab
    if (tabInfo.isActive && windowTabIds && windowTabIds.length > 0) {
      await this.switchTab(windowTabIds[0])
    }

    // 6. 发送事件
    eventBus.emit('tab:closed', { tabId, windowId })

    // 7. 通知窗口更新
    this.notifyWindowTabsUpdate(windowId)

    return true
  }

  /**
   * 更新 View 边界（考虑 Chrome 高度）
   */
  private updateViewBounds(window: BrowserWindow, view: WebContentsView): void {
    const windowBounds = window.getBounds()
    const chromeHeight = 60 // Tab Bar 高度

    view.setBounds({
      x: 0,
      y: chromeHeight,
      width: windowBounds.width,
      height: windowBounds.height - chromeHeight
    })
  }

  /**
   * 加载 Tab 内容
   */
  private async loadTabContent(view: WebContentsView, url: string): Promise<void> {
    if (url.startsWith('local://')) {
      // 本地路由
      const route = url.replace('local://', '')
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      const prodPath = join(__dirname, '../renderer/index.html')

      if (devUrl) {
        await view.webContents.loadURL(`${devUrl}/#/${route}`)
      } else {
        await view.webContents.loadFile(prodPath, { hash: route })
      }
    } else {
      // 外部 URL
      await view.webContents.loadURL(url)
    }
  }

  /**
   * 设置 Tab 事件
   */
  private setupTabEvents(tabId: number): void {
    const tabInfo = this.tabState.get(tabId)
    if (!tabInfo) return

    const { view } = tabInfo

    // 页面标题更新
    view.webContents.on('page-title-updated', (event, title) => {
      tabInfo.title = title
      this.notifyWindowTabsUpdate(tabInfo.windowId)
    })

    // 页面导航
    view.webContents.on('did-navigate', (event, url) => {
      tabInfo.url = url
      this.notifyWindowTabsUpdate(tabInfo.windowId)
    })

    // 页面崩溃
    view.webContents.on('render-process-gone', (event, details) => {
      log.error(`[TabManager] Tab 进程崩溃: ${tabId}`, details)
      // 可以选择关闭或重新加载
    })
  }

  /**
   * 通知窗口 Tab 列表更新
   */
  private notifyWindowTabsUpdate(windowId: number): void {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) return

    const tabIds = this.windowTabs.get(windowId) || []
    const tabsData = tabIds
      .map((id) => {
        const info = this.tabState.get(id)
        if (!info) return null

        return {
          id: info.id,
          title: info.title,
          icon: info.icon,
          url: info.url,
          type: info.type,
          isActive: info.isActive,
          position: info.position,
          closable: info.closable
        }
      })
      .filter(Boolean)

    // 发送到窗口的所有 webContents
    window.webContents.send('update-window-tabs', windowId, tabsData)
  }

  /**
   * 获取窗口的所有 Tab
   */
  getWindowTabs(windowId: number): TabInfo[] {
    const tabIds = this.windowTabs.get(windowId) || []
    return tabIds
      .map((id) => this.tabState.get(id))
      .filter((info): info is TabInfo => info !== undefined)
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 窗口关闭时，关闭所有 Tab
    eventBus.on('window:closed', (data: { windowId: number }) => {
      const tabIds = this.windowTabs.get(data.windowId) || []
      tabIds.forEach((tabId) => {
        this.closeTab(tabId)
      })
      this.windowTabs.delete(data.windowId)
    })

    // 窗口大小变化时，更新所有 Tab 的边界
    eventBus.on('window:resized', (data: { windowId: number }) => {
      const window = BrowserWindow.fromId(data.windowId)
      if (!window || window.isDestroyed()) return

      const tabIds = this.windowTabs.get(data.windowId) || []
      tabIds.forEach((tabId) => {
        const view = this.tabs.get(tabId)
        if (view) {
          this.updateViewBounds(window, view)
        }
      })
    })
  }
}
```

---

## 🎨 渲染进程集成

### Shell 窗口结构

```vue
<!-- src/renderer/shell/App.vue -->
<template>
  <div class="shell-window">
    <!-- Tab Bar -->
    <div class="tab-bar">
      <TabItem
        v-for="tab in tabs"
        :key="tab.id"
        :tab="tab"
        :active="tab.isActive"
        @click="switchTab(tab.id)"
        @close="closeTab(tab.id)"
      />
      <button @click="createNewTab">+</button>
    </div>

    <!-- Tab Content Area -->
    <!-- WebContentsView 会填充这个区域 -->
    <div class="tab-content">
      <!-- 由主进程的 WebContentsView 渲染 -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTabStore } from './stores/tab'

const tabStore = useTabStore()
const tabs = computed(() => tabStore.tabs)

onMounted(() => {
  // 监听 Tab 列表更新
  window.electron.ipcRenderer.on('update-window-tabs', (_, windowId, tabsData) => {
    tabStore.updateWindowTabs(windowId, tabsData)
  })

  // 初始化
  tabStore.init()
})

async function switchTab(tabId: number) {
  await window.tabApi.switch(tabId)
}

async function closeTab(tabId: number) {
  await window.tabApi.close(tabId)
}

async function createNewTab() {
  await window.tabApi.create({
    type: 'chat',
    url: 'local://chat'
  })
}
</script>
```

---

## 📦 IPC 接口

### 主进程 Handler

```typescript
// src/main/ipc/handlers/TabHandlers.ts
import { ipcMain } from 'electron'
import { appManager } from '@main/common/app'

export function registerTabHandlers(): void {
  // 创建 Tab
  ipcMain.handle('tab:create', async (event, windowId: number, config: TabConfig) => {
    const view = await appManager.getTabManager().createTab(windowId, config)
    return { success: !!view, tabId: view?.webContents.id }
  })

  // 切换 Tab
  ipcMain.handle('tab:switch', async (event, tabId: number) => {
    const success = await appManager.getTabManager().switchTab(tabId)
    return { success }
  })

  // 关闭 Tab
  ipcMain.handle('tab:close', async (event, tabId: number) => {
    const success = await appManager.getTabManager().closeTab(tabId)
    return { success }
  })

  // 获取窗口的所有 Tab
  ipcMain.handle('tab:get-window-tabs', async (event, windowId: number) => {
    const tabs = appManager.getTabManager().getWindowTabs(windowId)
    return { tabs }
  })
}
```

### Preload API

```typescript
// src/preload/index.ts
const tabApi = {
  create: (windowId: number, config: unknown) => ipcRenderer.invoke('tab:create', windowId, config),

  switch: (tabId: number) => ipcRenderer.invoke('tab:switch', tabId),

  close: (tabId: number) => ipcRenderer.invoke('tab:close', tabId),

  getWindowTabs: (windowId: number) => ipcRenderer.invoke('tab:get-window-tabs', windowId)
}

contextBridge.exposeInMainWorld('tabApi', tabApi)
```

---

## 🎯 核心优势

### 相比传统 Tab 方案

| 特性     | Vue Router Tab | WebContentsView Tab |
| -------- | -------------- | ------------------- |
| 进程隔离 | ❌ 同一进程    | ✅ 独立进程         |
| 崩溃影响 | ⚠️ 全部崩溃    | ✅ 单个崩溃         |
| 内存隔离 | ❌ 共享内存    | ✅ 独立内存         |
| 性能隔离 | ❌ 相互影响    | ✅ 互不影响         |
| 拖拽移动 | ⚠️ 复杂        | ✅ 简单             |
| 独立导航 | ⚠️ 需处理      | ✅ 原生支持         |

---

## 📊 性能考虑

### Tab 数量限制

```typescript
class TabManager {
  private readonly MAX_TABS_PER_WINDOW = 20

  async createTab(windowId: number, config: TabConfig) {
    const currentTabs = this.windowTabs.get(windowId)?.length || 0
    if (currentTabs >= this.MAX_TABS_PER_WINDOW) {
      log.warn('[TabManager] 已达到最大 Tab 数限制')
      return null
    }
    // ...
  }
}
```

### 内存管理

- Tab 关闭时自动释放 webContents
- 非激活 Tab 可以进入"休眠"状态（降低优先级）
- 定期检查僵尸 Tab 并清理

---

## 🔗 集成到现有架构

### AppManager 集成

```typescript
// src/main/common/app.ts
export class AppManager {
  private windowManager!: WindowManager
  private tabManager!: TabManager // ← 新增

  async initialize() {
    // ...
    await app.whenReady()

    // 初始化管理器
    this.windowManager = new WindowManager()
    this.tabManager = new TabManager() // ← 新增

    // 创建主窗口（Agent 窗口）
    const mainWindow = this.windowManager.createWindow({
      type: 'agent',
      initialUrl: '/shell' // Shell 入口
    })

    // 创建第一个 Tab（Chat Tab）
    await this.tabManager.createTab(mainWindow.id, {
      type: 'chat',
      url: 'local://chat',
      title: 'New Chat'
    })

    // ...
  }

  getTabManager(): TabManager {
    return this.tabManager
  }
}
```

---

## 📝 总结

**多 Tab 架构** 是 catax-bot 的核心特性之一，使用 **WebContentsView** 实现：

1. ✅ **真正的进程隔离**：每个 Tab 是独立渲染进程
2. ✅ **崩溃隔离**：单个 Tab 崩溃不影响其他
3. ✅ **内存隔离**：每个 Tab 有独立的内存空间
4. ✅ **灵活管理**：Tab 可以在窗口间移动
5. ✅ **原生体验**：类似浏览器的 Tab 体验

**实施顺序**：

1. 先实现 WindowManager（多窗口）
2. 再实现 TabManager（多 Tab）
3. 最后实现 Tab 拖拽和窗口间移动

这是一个**高级架构**，需要对 Electron 的 WebContentsView API 有深入理解。

---

## 🎨 使用示例

### 场景 1：创建 Agent 窗口并添加多个 Tab

```typescript
// 1. 创建 Agent 窗口
const agentWindow = windowManager.createWindow({
  type: 'agent',
  width: 1200,
  height: 800
})

// 2. 添加 Chat Tab
await tabManager.createTab(agentWindow.id, {
  type: 'chat',
  url: 'local://chat',
  title: 'AI Chat',
  icon: 'message-circle'
})

// 3. 添加 Task Tab
await tabManager.createTab(agentWindow.id, {
  type: 'task',
  url: 'local://tasks',
  title: 'Task Manager',
  icon: 'check-square'
})

// 4. 添加 Settings Tab
await tabManager.createTab(agentWindow.id, {
  type: 'settings',
  url: 'local://settings',
  title: 'Settings',
  icon: 'settings',
  closable: false // 设置 Tab 不可关闭
})
```

### 场景 2：创建 Browser 窗口浏览网页

```typescript
// 1. 创建 Browser 窗口
const browserWindow = windowManager.createWindow({
  type: 'browser',
  width: 1024,
  height: 768
})

// 2. 添加多个网页 Tab
await tabManager.createTab(browserWindow.id, {
  type: 'webpage',
  url: 'https://example.com',
  title: 'Example'
})

await tabManager.createTab(browserWindow.id, {
  type: 'webpage',
  url: 'https://github.com',
  title: 'GitHub'
})
```

### 场景 3：典型应用启动流程

```typescript
// src/main/common/app.ts
async initialize() {
  await app.whenReady()

  // 初始化管理器
  this.windowManager = new WindowManager()
  this.tabManager = new TabManager()

  // 创建主 Agent 窗口
  const mainWindow = this.windowManager.createWindow({
    type: 'agent',
    initialUrl: '/shell'
  })

  // 创建默认 Chat Tab
  await this.tabManager.createTab(mainWindow.id, {
    type: 'chat',
    url: 'local://chat',
    title: 'Welcome',
    icon: 'message-circle'
  })

  // 根据用户上次会话，恢复其他 Tab...
  await this.restoreUserSession(mainWindow.id)
}
```

---

## 📐 Tab 类型适用场景

### Agent 窗口 Tab 类型

| Tab 类型     | 路由               | 用途        | 是否可关闭 |
| ------------ | ------------------ | ----------- | ---------- |
| **chat**     | `local://chat`     | AI 对话界面 | ✅ 是      |
| **task**     | `local://tasks`    | 任务管理    | ✅ 是      |
| **settings** | `local://settings` | 系统设置    | ❌ 否      |

### Browser 窗口 Tab 类型

| Tab 类型    | 路由          | 用途     | 是否可关闭 |
| ----------- | ------------- | -------- | ---------- |
| **webpage** | `https://...` | 浏览网页 | ✅ 是      |

---

## 🔄 窗口与 Tab 的关系

```
Agent 窗口
├── Chat Tab 1
├── Chat Tab 2
├── Task Tab
└── Settings Tab (不可关闭)

Browser 窗口
├── Webpage Tab 1 (https://example.com)
├── Webpage Tab 2 (https://github.com)
└── Webpage Tab 3 (https://docs.example.com)
```
