# 快捷键系统实现总结

## 概述

参考 Joythink-AI 项目，成功实现了 coobee-ai 的快捷键系统，**不包含导航快捷键**（Left/Right），只保留核心功能快捷键。

## 实现内容

### 1. 核心模块

#### `src/main/common/shortcut/`

- **`index.ts`**: 快捷键管理器主模块
  - `ShortcutManager` 类：管理快捷键注册/注销/刷新
  - `DEFAULT_SHORTCUTS` 常量：默认快捷键配置
  - 单例导出：`shortcutManager`

- **`LocalShortcut.ts`**: 本地快捷键实现
  - 通过监听 `before-input-event` 实现应用内快捷键
  - 支持窗口级和应用级快捷键
  - 自动处理窗口销毁时的清理

- **`README.md`**: 详细的使用文档

### 2. 类型定义

#### `src/shared/types.ts`

```typescript
export interface Shortcut {
  key: string; // 快捷键标识
  shortcut: string; // 快捷键组合
  editable: boolean; // 是否可编辑
  enabled: boolean; // 是否启用
  global: boolean; // 是否为全局快捷键
  registered: boolean; // 是否已注册
}
```

### 3. 配置集成

#### `src/main/common/config.ts`

- 添加 `SHORTCUTS` 配置键
- 实现 `getShortcuts()` 和 `setShortcuts()` 方法
- 配置变更时触发 `CONFIG_SHORTCUTS_CHANGED` 事件

### 4. 事件系统

#### `src/shared/ipc/events.ts`

- 添加 `CONFIG_SHORTCUTS_CHANGED` 事件类型
- 定义对应的 Payload 类型

#### `src/main/events/shortcutsChanged.ts`

- 快捷键配置变更事件处理器
- 自动刷新快捷键注册

### 5. 生命周期集成

#### `src/main/lifecycle/ReadyShortcutRegistrationHook.ts`

- **执行阶段**: READY
- **优先级**: 400（在窗口和其他核心服务初始化后）
- **功能**:
  - 首次运行时初始化默认快捷键配置
  - 注册所有快捷键

## 默认快捷键配置

| 快捷键         | 组合键        | 类型 | 功能          |
| -------------- | ------------- | ---- | ------------- |
| ShowHideWindow | `Command+Tab` | 全局 | 显示/隐藏窗口 |
| Quit           | `Command+Q`   | 本地 | 退出应用      |
| GoSettings     | `Command+,`   | 本地 | 跳转到设置页  |
| FreshWindow    | `Command+N`   | 本地 | 创建新窗口    |

> **注意**: `CommandOrControl` 在 macOS 上映射为 `Command`，在 Windows/Linux 上映射为 `Control`

## 工作流程

### 初始化流程

```
应用启动
  → INIT 阶段：加载配置
  → READY 阶段：ReadyShortcutRegistrationHook 执行
     → 检查配置中是否有快捷键
     → 如果没有，初始化为 DEFAULT_SHORTCUTS
     → 调用 shortcutManager.registerShortcuts()
       → 遍历所有快捷键
       → 根据 global 标志选择注册方式
         → global: true  → 使用 globalShortcut.register()
         → global: false → 使用 LocalShortcut.register()
```

### 快捷键触发流程

```
用户按下快捷键
  → 全局快捷键：由 Electron globalShortcut 捕获
  → 本地快捷键：由 before-input-event 捕获
    → LocalShortcut 标准化键盘事件
    → 查找匹配的快捷键
    → 执行回调函数
      → 调用 ShortcutManager 的处理函数
        → 通过 eventBus.emit() 发送事件
          → 对应的事件处理器（src/main/events/）执行业务逻辑
```

### 配置变更流程

```
用户修改快捷键配置
  → config.setShortcuts(newShortcuts)
    → 触发 CONFIG_SHORTCUTS_CHANGED 事件
      → shortcutsChanged.ts 事件处理器执行
        → shortcutManager.refreshShortcuts()
          → 从配置读取快捷键
          → 合并默认配置和用户配置
          → 注销所有旧快捷键
          → 注册所有新快捷键
```

## 与参考项目的差异

### ✅ 保留的功能

- 全局快捷键支持（ShowHideWindow）
- 本地快捷键支持（Quit, GoSettings, FreshWindow）
- 快捷键配置持久化
- 快捷键动态刷新
- LocalShortcut 完整实现
- 事件系统集成

### ❌ 移除的功能

- **导航快捷键**（Left/Right）
- 对应的导航事件处理器

### 🔄 调整的内容

- 快捷键数量：6 个 → 4 个
- 文件命名：遵循 coobee-ai 的命名规范（带 phase 前缀）
- 日志标签：统一使用 `[ShortcutManager]` 和 `[LocalShortcut]`
- 事件命名：遵循 `EventTypes` 常量定义

## 技术亮点

1. **类型安全**: 完整的 TypeScript 类型定义
2. **跨平台兼容**: 使用 `CommandOrControl` 实现跨平台
3. **内存安全**: 窗口销毁时自动清理快捷键监听器
4. **可扩展**: 易于添加新的快捷键
5. **配置化**: 支持运行时配置和持久化
6. **事件驱动**: 与应用的 EventBus 系统完美集成

## 验证结果

### ✅ 类型检查

```bash
pnpm typecheck
# ✓ typecheck:node 通过
# ✓ typecheck:web 通过
```

### ✅ 代码格式化

```bash
pnpm format
# ✓ 所有文件格式正确
```

## 使用示例

### 注册快捷键

```typescript
import { shortcutManager } from '@main/common/shortcut';

// 在应用启动时自动注册（通过 Hook）
// 手动刷新
await shortcutManager.refreshShortcuts();
```

### 获取快捷键配置

```typescript
const shortcuts = shortcutManager.getShortcuts();
console.log(shortcuts); // [{ key: 'Quit', shortcut: 'CommandOrControl+Q', ... }]
```

### 修改快捷键配置

```typescript
import { config } from '@main/common/config';

const newShortcuts = config.getShortcuts().map((s) => {
  if (s.key === 'Quit') {
    return { ...s, enabled: false };
  }
  return s;
});

config.setShortcuts(newShortcuts);
// 自动触发 shortcutsChanged 事件 → 刷新快捷键
```

## 扩展指南

要添加新的快捷键，参考 `src/main/common/shortcut/README.md` 中的详细说明。

## 文件清单

### 新增文件

- `src/main/common/shortcut/index.ts` - 快捷键管理器
- `src/main/common/shortcut/LocalShortcut.ts` - 本地快捷键实现
- `src/main/common/shortcut/README.md` - 使用文档
- `src/main/events/shortcutsChanged.ts` - 配置变更事件处理器
- `src/main/lifecycle/ReadyShortcutRegistrationHook.ts` - 快捷键注册 Hook
- `docs/shortcut-implementation.md` - 实现总结（本文件）

### 修改文件

- `src/shared/types.ts` - 添加 `Shortcut` 接口
- `src/main/common/config.ts` - 添加快捷键配置支持
- `src/shared/ipc/events.ts` - 添加快捷键配置变更事件

## 后续工作

可选的增强功能：

1. **前端快捷键设置界面**
   - 可视化快捷键配置
   - 冲突检测
   - 实时预览

2. **快捷键冲突检测**
   - 检测与系统快捷键的冲突
   - 检测与其他应用的冲突

3. **快捷键组合验证**
   - 防止无效组合
   - 提供友好的错误提示

4. **快捷键帮助面板**
   - 显示所有可用快捷键
   - 提供快捷键搜索功能

## 总结

快捷键系统已完整实现，与 coobee-ai 的架构无缝集成，提供了：

- ✅ 全局和本地快捷键支持
- ✅ 配置持久化和动态刷新
- ✅ 完整的类型安全
- ✅ 事件驱动架构
- ✅ 生命周期管理
- ✅ 详细的文档

系统已准备好投入使用！🎉
