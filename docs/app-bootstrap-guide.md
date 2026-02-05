# AppBootstrapHook 应用启动配置指南

## 概述

`AppBootstrapHook` 是在应用准备就绪时执行的生命周期钩子，负责初始化应用级别的基础设置。

## 功能特性

### 1. 系统托盘图标

- **位置**: `src/main/common/tray.ts`
- **图标路径**:
  - 开发模式: `resources/trayIconTemplate.png`
  - 生产模式: `{resourcesPath}/trayIconTemplate.png`
- **功能**:
  - 显示应用托盘图标
  - 点击托盘图标显示主窗口
  - 右键菜单（显示主窗口、关于、退出）

### 2. 应用名称和版本

- 自动设置应用名称为 `Coobee AI`
- 从 `package.json` 读取应用版本

### 3. macOS Dock 图标

- 在 macOS 上自动使用 `icon.icns`
- 无需手动配置

## 文件结构

```
src/main/
├── common/
│   ├── tray.ts              # 托盘管理器
│   └── index.ts             # 导出 trayManager
├── lifecycle/
│   └── AppBootstrapHook.ts  # 应用启动钩子
resources/
├── trayIconTemplate.png     # 托盘图标 (22x22)
└── trayIconTemplate@2x.png  # 托盘图标 Retina (44x44)
```

## 使用方法

### 托盘管理器 API

```typescript
import { trayManager } from '@main/common'

// 创建托盘
trayManager.createTray()

// 更新托盘菜单
trayManager.updateMenu()

// 销毁托盘
trayManager.destroy()

// 重新创建托盘
trayManager.recreate()

// 检查托盘是否已创建
const isCreated = trayManager.isCreated()

// 获取托盘实例
const tray = trayManager.getTray()
```

### 自定义托盘菜单

编辑 `src/main/common/tray.ts` 中的 `updateMenu()` 方法：

```typescript
updateMenu(): void {
  if (!this.tray) return

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: '显示主窗口',
      click: async () => {
        // 自定义逻辑
      }
    },
    { type: 'separator' },
    {
      label: '自定义菜单项',
      click: () => {
        // 自定义逻辑
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ]

  const contextMenu = Menu.buildFromTemplate(menuTemplate)
  this.tray.setContextMenu(contextMenu)
}
```

## 图标规范

### macOS 托盘图标

- **格式**: PNG（Template 模式）
- **尺寸**: 22x22 (标准) / 44x44 (Retina)
- **文件名**: `trayIconTemplate.png` / `trayIconTemplate@2x.png`
- **设计要求**:
  - 使用纯黑色 (#000000)
  - 透明背景
  - 简洁的几何图形
  - Template 模式自动适配明暗主题

### Windows 托盘图标

- **格式**: ICO 或 PNG
- **尺寸**: 16x16
- **文件名**: `tray-icon.ico` 或 `tray-icon.png`

## 生命周期

```
App Ready
    ↓
AppBootstrapHook (priority: 90)
    ├─ 设置应用名称
    ├─ 记录应用版本
    ├─ 创建系统托盘
    └─ 配置 macOS Dock
    ↓
WindowBootstrapHook (priority: 100)
    └─ 创建主窗口
```

## 注意事项

1. **托盘图标路径**
   - 开发模式和生产模式路径不同
   - 使用 `Env.isDev` 判断环境
   - 使用 `process.resourcesPath` 获取生产模式资源路径

2. **跨平台兼容**
   - macOS 使用 Template 图像（自动适配主题）
   - Windows 使用普通图标
   - Linux 使用 PNG 图标

3. **错误处理**
   - 托盘初始化失败不会阻止应用启动
   - 使用 `critical: false` 标记非关键钩子
   - 错误会被记录到日志

4. **动态导入**
   - 使用动态导入避免循环依赖
   - 例如: `await import('./window')`

## 扩展功能

### 添加托盘通知

```typescript
// 在 TrayManager 中添加方法
showNotification(title: string, body: string): void {
  if (this.tray) {
    this.tray.displayBalloon({
      title,
      content: body,
      icon: this.getTrayIconPath()
    })
  }
}
```

### 动态更新托盘图标

```typescript
// 在 TrayManager 中添加方法
updateIcon(iconPath: string): void {
  if (this.tray) {
    const icon = nativeImage.createFromPath(iconPath)
    this.tray.setImage(icon)
  }
}
```

### 托盘角标（macOS）

```typescript
// 设置角标数字
app.dock.setBadge('3')

// 清除角标
app.dock.setBadge('')
```

## 常见问题

### Q: 托盘图标不显示？

**A**: 检查以下几点：

1. 图标文件是否存在于 `resources/` 目录
2. 生产环境检查打包配置 (`electron-builder.yml`)
3. 查看日志中的图标路径是否正确

### Q: macOS 托盘图标颜色不对？

**A**: 确保使用 Template 模式：

```typescript
const trayIcon = nativeImage.createFromPath(iconPath)
trayIcon.setTemplateImage(true) // 关键设置
```

### Q: 如何禁用托盘？

**A**: 在 `AppBootstrapHook.ts` 中注释掉托盘创建代码：

```typescript
// const { trayManager } = await import('@main/common/tray')
// trayManager.createTray()
```

### Q: 托盘菜单点击无响应？

**A**: 检查是否使用了动态导入：

```typescript
click: async () => {
  const { windowManager } = await import('./window')
  // 使用 windowManager
}
```

## 相关文档

- [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray)
- [macOS Human Interface Guidelines - Status Bar Icons](https://developer.apple.com/design/human-interface-guidelines/status-bars)
- [Icon Generation Guide](./icon-implementation-summary.md)
