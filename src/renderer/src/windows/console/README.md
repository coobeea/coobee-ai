# Console Window

控制台窗口 - 用于监控和管理所有窗口状态

## 功能特性

- ✅ **实时监控** - 自动刷新显示所有窗口状态
- ✅ **窗口统计** - 显示窗口总数、可见窗口数、聚焦窗口数
- ✅ **详细信息** - 展示每个窗口的位置、尺寸、状态等信息
- ✅ **自动/手动模式** - 支持自动刷新和手动刷新两种模式

## 使用方式

### 开发环境

在开发环境中，控制台窗口会加载：

```
http://localhost:5173/console.html
```

### 生产环境

在生产环境中，控制台窗口会加载：

```
file://.../resources/app.asar/dist-electron/renderer/console.html
```

## 技术栈

- **框架**: Vue 3 + TypeScript
- **样式**: Tailwind CSS 4
- **图标**: unplugin-icons
- **状态管理**: Pinia

## 待实现功能

1. 后端 IPC 接口 `window:getAllWindows` - 获取所有窗口信息
2. 窗口操作功能（聚焦、最小化、关闭等）
3. 实时事件监听（窗口创建、关闭、状态变化）
