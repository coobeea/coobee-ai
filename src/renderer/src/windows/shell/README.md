# Shell 窗口

Shell 窗口是 Coobee AI 的主窗口外壳，提供标题栏和多标签页管理。

**重要**：Shell 只是一个**外壳容器**，实际内容由主进程通过 `WebContentsView` 动态渲染。

## 📁 目录结构

```
shell/
├── components/          # 组件
│   ├── AppBar.vue      # 标题栏（含 Tab 管理和窗口控制）
│   └── TabItem.vue     # Tab 项组件
├── composables/        # 组合式函数
│   └── usePlatform.ts  # 平台检测（macOS/Windows/Linux）
├── stores/             # 状态管理
│   └── tab.ts          # Tab 状态（增删改查）
├── main.ts             # 入口文件
├── ShellApp.vue        # 根组件（外壳容器）
├── types.ts            # 类型定义
└── README.md           # 说明文档
```

## 🎯 核心功能

### ShellApp.vue - 外壳容器

```vue
<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-gray-50">
    <!-- 标题栏 -->
    <AppBar />

    <!-- 内容区域（空容器，主进程通过 WebContentsView 填充） -->
    <main class="content-container relative flex-1 overflow-hidden"></main>
  </div>
</template>
```

### AppBar - 标题栏

**功能**：

- ✅ Logo 显示
- ✅ 多 Tab 管理（新建、关闭、切换）
- ✅ 平台适配：
  - **macOS**：左侧留空给红绿灯按钮，圆角背景，毛玻璃效果
  - **Windows/Linux**：自定义窗口控制按钮（最小化、最大化、关闭）
- ✅ 拖拽区域：标题栏可拖动窗口

### Tab Store - 状态管理

```typescript
import { useTabStore } from './stores/tab'

const tabStore = useTabStore()

// 添加 Tab
tabStore.addTab('New Chat')

// 删除 Tab
tabStore.removeTab(tabId)

// 切换 Tab
tabStore.setCurrentTab(tabId)
```

## 🎨 设计规范

### 样式

- **纯 Tailwind CSS**：不使用第三方 UI 组件库
- **图标**：使用 `unplugin-icons`（`~icons/mdi/*`）
- **颜色方案**：
  - 主色：`blue-600`
  - 背景：`gray-50`、`gray-100`
  - 边框：`gray-200`、`gray-300`

### 无边框窗口

```css
/* 可拖拽区域 */
.window-drag-region {
  -webkit-app-region: drag;
  app-region: drag;
}

/* 不可拖拽区域（按钮等） */
.window-no-drag-region {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
```

### 平台差异

| 特性     | macOS                                 | Windows/Linux        |
| -------- | ------------------------------------- | -------------------- |
| 圆角     | ✅ `rounded-t-[10px]`                 | ❌                   |
| 背景     | 毛玻璃 `bg-white/80 backdrop-blur-sm` | 纯色 `bg-gray-100`   |
| 控制按钮 | 系统红绿灯（左上角）                  | 自定义按钮（右上角） |
| 左侧空白 | ✅ 80px                               | ❌                   |

## 📋 类型定义

```typescript
// stores/tab.ts
export interface Tab {
  id: string
  title: string
  icon?: string
}
```

## 🚀 工作原理

### 内容渲染流程

1. **Shell 窗口启动**：渲染 `ShellApp.vue`（标题栏 + 空容器）
2. **主进程接管**：通过 `WebContentsView` 动态注入内容到 `.content-container`
3. **Tab 切换**：通知主进程切换 `WebContentsView`

### 窗口控制

```typescript
// 最小化
window.electron.ipcRenderer.send('window:minimize')

// 最大化/还原
window.electron.ipcRenderer.send('window:maximize')

// 关闭
window.electron.ipcRenderer.send('window:close')
```

## ⚠️ 注意事项

1. **Shell 只是外壳**：不包含业务逻辑，只负责 UI 框架
2. **内容由主进程管理**：通过 `WebContentsView` 动态渲染
3. **不使用 Vue Router**：路由在主进程层面处理
4. **Tab 状态在渲染进程**：通过 `useTabStore()` 管理
5. **IPC 通信**：通过 `window.electron.ipcRenderer` 与主进程通信

## 📦 依赖

- Vue 3 + Composition API
- Pinia
- Tailwind CSS 4
- unplugin-icons
