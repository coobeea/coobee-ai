# Event 处理器待实现清单

本文档记录 `src/main/events/` 目录下所有待实现的事件处理器。

> **状态**：暂不实现，仅记录备忘
> **创建时间**：2026-03-04
> **优先级**：P2 (低优先级)

---

## 📋 待实现列表

### 1. 目录监控相关

#### directoryDeletedChanged.ts

- **事件名**：`directory:deleted:changed`
- **触发时机**：当目录被删除时
- **待实现**：
  - [ ] 如果目录在监控中，从监控列表移除
  - [ ] 清理相关数据

#### directoryCreatedChanged.ts

- **事件名**：`directory:created:changed`
- **触发时机**：当新目录被创建时
- **待实现**：
  - [ ] 添加目录到监控列表
  - [ ] 通知相关服务目录已创建

#### directoryUpdatedChanged.ts

- **事件名**：`directory:updated:changed`
- **触发时机**：当目录配置被更新时（如监控设置变更）
- **待实现**：
  - [ ] 如果监控配置变更，更新监控器设置
  - [ ] 通知相关服务目录已更新

---

### 2. 系统配置相关

#### backupPathChanged.ts

- **事件名**：`config:backupPath:changed`
- **触发时机**：备份路径变更
- **待实现**：
  - [ ] 实现备份路径切换逻辑
  - [ ] 可能需要迁移现有备份文件

#### logPathChanged.ts

- **事件名**：`config:logPath:changed`
- **触发时机**：日志路径变更
- **待实现**：
  - [ ] 实现日志路径切换逻辑
  - [ ] 可能需要关闭旧日志文件，打开新路径

#### languageChanged.ts

- **事件名**：`config:language:changed`
- **触发时机**：用户切换界面语言
- **待实现**：
  - [ ] 实现国际化切换逻辑
  - [ ] 可能需要通知前端重新加载语言包

#### autoUpdateChanged.ts

- **事件名**：`config:autoUpdate:changed`
- **触发时机**：自动更新开关变更
- **待实现**：
  - [ ] 启用或禁用自动更新检查
  - [ ] 可能需要集成 electron-updater

#### betaUpdatesChanged.ts

- **事件名**：`config:betaUpdates:changed`
- **触发时机**：Beta 更新开关变更
- **待实现**：
  - [ ] 配置更新通道（stable / beta）
  - [ ] 可能需要集成 electron-updater

---

### 3. UI 交互相关

#### selectionToolbarChanged.ts

- **事件名**：`config:selectionToolbar:changed`
- **触发时机**：选择工具栏配置变更
- **待实现**：
  - [ ] 通知渲染进程更新选择工具栏配置
  - [ ] 可能需要更新工具栏显示状态

#### soundEffectsChanged.ts

- **事件名**：`config:soundEffects:changed`
- **触发时机**：音效开关变更
- **待实现**：
  - [ ] 通知渲染进程更新音效状态
  - [ ] 启用或禁用系统音效

---

### 4. 窗口行为相关

以下事件处理器已有基本实现，仅记录备忘：

- **alwaysOnTopChanged.ts** - 窗口置顶
- **autoStartChanged.ts** - 开机自启动
- **closeToTrayChanged.ts** - 关闭到托盘
- **hardwareAccelerationChanged.ts** - 硬件加速
- **memoryLimitChanged.ts** - 内存限制
- **minimizeOnCloseChanged.ts** - 最小化到托盘
- **newTabChanged.ts** - 新标签页行为
- **newWindowChanged.ts** - 新窗口行为
- **quitChanged.ts** - 退出应用
- **refreshChanged.ts** - 刷新行为
- **refreshTabChanged.ts** - 刷新标签页
- **shortcutsChanged.ts** - 快捷键配置
- **showHideWindowChanged.ts** - 显示/隐藏窗口
- **showTrayIconChanged.ts** - 托盘图标显示
- **startToTrayChanged.ts** - 启动到托盘
- **themeChanged.ts** - 主题切换

---

## 📌 实现建议

当需要实现这些事件处理器时，建议：

1. **优先级排序**：
   - P1: 自动更新、语言切换（用户体验相关）
   - P2: 目录监控（功能完整性）
   - P3: 备份/日志路径切换（边缘场景）

2. **实现方式**：
   - 使用统一的事件总线（EventBus）
   - 主进程处理逻辑 + IPC 通知渲染进程
   - 持久化配置到 ConfigService

3. **测试覆盖**：
   - 为每个实现的处理器编写单元测试
   - 集成测试覆盖事件触发到效果生效的完整流程

---

## 🔗 相关文档

- 事件系统架构：`docs/3.ai-architecture/`
- 配置管理：`src/main/common/config/`
- IPC 通信：`src/main/common/ipc/`
