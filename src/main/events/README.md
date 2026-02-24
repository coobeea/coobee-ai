# 事件处理器 (Event Handlers)

## 目录结构

```
src/main/events/
├── README.md                        # 本文档
├── alwaysOnTopChanged.ts            # 窗口置顶变更
├── autoStartChanged.ts              # 自动启动变更
├── autoUpdateChanged.ts             # 自动更新变更
├── backupPathChanged.ts             # 备份路径变更
├── betaUpdatesChanged.ts            # 预发布版本变更
├── closeToTrayChanged.ts            # 关闭到托盘变更
├── directoryCreatedChanged.ts       # 目录创建事件
├── directoryDeletedChanged.ts       # 目录删除事件
├── directoryUpdatedChanged.ts       # 目录更新事件
├── freshWindowChanged.ts            # 创建新窗口
├── goSettingsChanged.ts             # 跳转到设置页
├── hardwareAccelerationChanged.ts   # 硬件加速变更
├── languageChanged.ts               # 语言变更
├── logPathChanged.ts                # 日志路径变更
├── memoryLimitChanged.ts            # 内存限制变更
├── minimizeOnCloseChanged.ts        # 关闭时最小化到托盘变更
├── navigationBackChanged.ts         # 导航后退
├── navigationForwardChanged.ts      # 导航前进
├── quitChanged.ts                   # 退出应用
├── selectionToolbarChanged.ts       # 选择工具栏变更
├── shortcutsChanged.ts              # 快捷键变更
├── showHideWindowChanged.ts         # 显示/隐藏窗口切换
├── showTrayIconChanged.ts           # 显示托盘图标变更
├── soundEffectsChanged.ts           # 音效设置变更
├── startToTrayChanged.ts            # 启动到托盘变更
├── themeChanged.ts                  # 主题变更
├── userChanged.ts                   # 用户登录/登出
└── workspacePathChanged.ts          # 工作区路径变更
```

## 事件处理器规范

### 1. 文件命名规范

- 文件名必须以 `Changed.ts` 结尾
- 使用驼峰命名法（camelCase）
- 例如：`themeChanged.ts`, `autoStartChanged.ts`

### 2. 事件名称转换规则

文件名会自动转换为事件名：

```
themeChanged.ts        → config:theme:changed
autoStartChanged.ts    → config:autoStart:changed
showTrayIconChanged.ts → config:showTrayIcon:changed
```

转换逻辑：

1. 移除文件名末尾的 `Changed`
2. 在原有驼峰命名后添加 `:changed` 后缀

### 3. 代码结构

每个事件处理器文件应该包含：

```typescript
import { log } from '@main/common/logger';

/**
 * [功能] 事件处理器
 * 事件名: config:[eventName]:changed
 * 对应事件: EventTypes.CONFIG_[EVENT_NAME]_CHANGED
 */
export default (payload: { [key]: [type] }): void => {
  log.info('[Event] 处理 [功能] 事件:', payload);

  // 实现具体逻辑
};
```

### 4. 导出规范

- **必须使用默认导出** (`export default`)
- 导出的必须是一个函数
- 函数接收一个 `payload` 参数（事件数据）
- 支持同步函数和异步函数（`async`）

### 5. Payload 类型定义

所有事件的 Payload 类型都定义在 `@shared/ipc/events.ts` 中的 `EventPayloads` 接口：

```typescript
export interface EventPayloads {
  [EventTypes.CONFIG_THEME_CHANGED]: {
    theme: 'light' | 'dark' | 'auto';
  };
  [EventTypes.CONFIG_AUTO_START_CHANGED]: {
    value: boolean;
  };
  // ... 其他事件类型
}
```

## 自动注册机制

事件处理器会被自动扫描和注册，无需手动注册。

### EventBus 扫描逻辑

1. 使用 Vite 的 `import.meta.glob` 扫描 `src/main/events/**/*.ts`
2. 过滤出以 `Changed.ts` 结尾的文件
3. 自动将文件名转换为事件名
4. 注册事件监听器

### 初始化时机

EventBus 的 `initConsumers()` 方法会在应用启动时自动调用，完成所有事件处理器的注册。

## 事件触发

事件由 `config.ts` 中的各个配置方法触发：

```typescript
// 例如：主题变更
setTheme(theme: ThemeMode): void {
  // ...
  eventBus.emit(EventTypes.CONFIG_THEME_CHANGED, { theme })
}
```

## 实现状态

### 配置类事件（Config Events）

| 事件处理器                  | 状态      | 说明                 |
| --------------------------- | --------- | -------------------- |
| themeChanged                | ✅ 已实现 | 日志记录             |
| autoStartChanged            | ✅ 已实现 | 设置开机启动         |
| startToTrayChanged          | ✅ 已实现 | 更新隐藏启动设置     |
| showTrayIconChanged         | ✅ 已实现 | 创建/销毁托盘图标    |
| closeToTrayChanged          | ✅ 已实现 | 仅日志记录           |
| minimizeOnCloseChanged      | ✅ 已实现 | 仅日志记录           |
| alwaysOnTopChanged          | ✅ 已实现 | 更新所有窗口置顶状态 |
| hardwareAccelerationChanged | ✅ 已实现 | 日志记录（需重启）   |
| memoryLimitChanged          | ✅ 已实现 | 日志记录（需重启）   |
| languageChanged             | 🚧 待完善 | TODO                 |
| backupPathChanged           | 🚧 待完善 | TODO                 |
| workspacePathChanged        | 🚧 待完善 | TODO                 |
| logPathChanged              | 🚧 待完善 | TODO（需重启）       |
| autoUpdateChanged           | 🚧 待完善 | TODO                 |
| betaUpdatesChanged          | 🚧 待完善 | TODO                 |
| soundEffectsChanged         | 🚧 待完善 | TODO                 |
| selectionToolbarChanged     | 🚧 待完善 | TODO                 |
| shortcutsChanged            | 🚧 待完善 | TODO                 |

### 窗口操作事件（Window Events）

| 事件处理器               | 状态      | 说明              |
| ------------------------ | --------- | ----------------- |
| freshWindowChanged       | ✅ 已实现 | 创建新窗口        |
| showHideWindowChanged    | ✅ 已实现 | 切换窗口显示/隐藏 |
| quitChanged              | ✅ 已实现 | 退出应用          |
| navigationBackChanged    | ✅ 已实现 | 浏览器后退        |
| navigationForwardChanged | ✅ 已实现 | 浏览器前进        |
| goSettingsChanged        | 🚧 待完善 | TODO              |

### 业务逻辑事件（Business Events）

| 事件处理器              | 状态      | 说明                |
| ----------------------- | --------- | ------------------- |
| userChanged             | 🚧 待完善 | TODO：用户登录/登出 |
| directoryCreatedChanged | 🚧 待完善 | TODO：目录监控      |
| directoryDeletedChanged | 🚧 待完善 | TODO：目录监控      |
| directoryUpdatedChanged | 🚧 待完善 | TODO：目录监控      |

**总计：28个事件处理器**

- ✅ 核心功能已实现：11个
- 🚧 待完善（TODO）：17个

## 注意事项

### 1. 避免循环依赖

如果需要导入其他模块（如 `trayManager`, `windowManager`），使用动态导入：

```typescript
export default async (payload): Promise<void> => {
  const { trayManager } = await import('@main/common/tray');
  // 使用 trayManager
};
```

### 2. 错误处理

始终使用 try-catch 包裹可能抛出异常的代码：

```typescript
export default (payload): void => {
  try {
    // 业务逻辑
  } catch (error) {
    log.error('[Event] 处理事件失败:', error);
  }
};
```

### 3. 日志记录

- 使用 `log.info()` 记录重要操作
- 使用 `log.debug()` 记录详细信息
- 使用 `log.warn()` 记录警告
- 使用 `log.error()` 记录错误

### 4. 重启应用生效的配置

某些配置需要重启应用才能生效（如硬件加速、日志路径），应在日志中明确提示用户。

## 扩展指南

### 添加新的事件处理器

1. 在 `@shared/ipc/events.ts` 中定义事件类型和 Payload
2. 在 `src/main/events/` 创建 `[eventName]Changed.ts` 文件
3. 实现事件处理逻辑
4. 在 `config.ts` 相应的 setter 方法中触发事件

系统会自动扫描和注册新的事件处理器，无需额外配置。
