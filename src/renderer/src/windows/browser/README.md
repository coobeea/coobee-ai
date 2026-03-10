# Browser 窗口

**Browser 窗口** 是 Coobee AI 的浏览器窗口，用于展示网页内容和在线资源。

## 📂 目录结构

```
src/renderer/src/windows/browser/
├── main.ts              # Browser 窗口入口
├── BrowserApp.vue       # Browser 根组件
└── components/          # Browser 专用组件（待添加）
    ├── AddressBar.vue
    ├── NavigationBar.vue
    └── BookmarkBar.vue
```

## 🎯 功能特性

### 待实现

- [ ] 地址栏
- [ ] 导航按钮（前进/后退/刷新）
- [ ] 书签栏
- [ ] 标签页管理（由 WindowManager 管理）
- [ ] 网页加载进度
- [ ] 开发者工具集成

## 🔌 使用方式

### 在主进程中创建窗口

```typescript
import { windowManager } from '@main/common/window';

// 创建 Browser 窗口
const browserWindow = windowManager.createWindow({
  type: 'browser',
  url: '/browser.html' // 加载 browser.html
});
```

## 🎨 设计规范

- **布局**：Chrome Bar + Tab Content 两段式
- **颜色**：简洁灰白配色
- **图标**：使用 `unplugin-icons`

## 📦 依赖

### 核心依赖

- `vue` - Vue 3 框架
- `pinia` - 状态管理

### 共享依赖

- `@shared/stores` - 跨窗口共享状态
- `@shared/utils` - 工具函数
