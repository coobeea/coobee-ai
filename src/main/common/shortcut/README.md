# 快捷键系统

快捷键管理模块，支持全局快捷键和应用内本地快捷键。

## 文件结构

```
shortcut/
├── index.ts          # 快捷键管理器主模块
├── LocalShortcut.ts  # 本地快捷键实现（应用内）
└── README.md         # 说明文档
```

## 快捷键类型

### 1. 全局快捷键 (Global Shortcut)

即使应用不在焦点也能触发的快捷键，使用 Electron 的 `globalShortcut` API。

**示例：** `ShowHideWindow` - 显示/隐藏窗口 (`Command+Tab`)

### 2. 本地快捷键 (Local Shortcut)

仅在应用获得焦点时触发的快捷键，通过监听 `before-input-event` 实现。

**示例：**

- `Quit` - 退出应用 (`Command+Q`)
- `GoSettings` - 跳转设置 (`Command+,`)
- `NewWindow` - 创建新窗口 (`Command+N`)
- `NewTab` - 创建新标签页 (`Command+T`)
- `Refresh` - 刷新当前页面 (`Command+R`)

## 默认快捷键配置

```typescript
DEFAULT_SHORTCUTS = [
  {
    key: 'ShowHideWindow',
    shortcut: 'CommandOrControl+Tab',
    global: true, // 全局快捷键
    enabled: true,
    editable: true
  },
  {
    key: 'Quit',
    shortcut: 'CommandOrControl+Q',
    global: false, // 本地快捷键
    enabled: true,
    editable: true
  },
  {
    key: 'GoSettings',
    shortcut: 'CommandOrControl+,',
    global: false,
    enabled: true,
    editable: true
  },
  {
    key: 'NewWindow',
    shortcut: 'CommandOrControl+N',
    global: false,
    enabled: true,
    editable: true
  },
  {
    key: 'NewTab',
    shortcut: 'CommandOrControl+T',
    global: false,
    enabled: true,
    editable: true
  },
  {
    key: 'Refresh',
    shortcut: 'CommandOrControl+R',
    global: false,
    enabled: true,
    editable: true
  }
];
```

## 使用方法

### 注册快捷键

```typescript
import { shortcutManager } from '@main/common/shortcut';

// 注册所有快捷键
shortcutManager.registerShortcuts();

// 刷新快捷键（从配置重新加载）
await shortcutManager.refreshShortcuts();
```

### 注销快捷键

```typescript
// 注销所有快捷键
shortcutManager.unregisterShortcuts();

// 销毁快捷键管理器（在应用退出时）
shortcutManager.destroy();
```

### 获取快捷键配置

```typescript
const shortcuts = shortcutManager.getShortcuts();
```

## 快捷键加速器格式

快捷键使用 Electron 加速器格式：

- **修饰键**: `CommandOrControl`, `Command`, `Control`, `Alt`, `Shift`
- **功能键**: `F1`-`F24`
- **特殊键**: `Enter`, `Escape`, `Tab`, `Space`, `Backspace`, 方向键等
- **字符键**: `A`-`Z`, `0`-`9`, 标点符号等

**组合示例：**

- `CommandOrControl+Q` - macOS: `Cmd+Q`, Windows/Linux: `Ctrl+Q`
- `Alt+Shift+F` - `Alt+Shift+F`
- `F5` - 单个功能键

## LocalShortcut API

用于注册应用内本地快捷键：

```typescript
import LocalShortcut from '@main/common/shortcut/LocalShortcut';
import { BrowserWindow } from 'electron';

// 在所有窗口注册快捷键
LocalShortcut.register('CommandOrControl+K', () => {
  console.log('快捷键触发');
});

// 在特定窗口注册快捷键
const win = BrowserWindow.getFocusedWindow();
LocalShortcut.register(win, 'CommandOrControl+L', () => {
  console.log('窗口快捷键触发');
});

// 注销快捷键
LocalShortcut.unregister('CommandOrControl+K');

// 注销所有快捷键
LocalShortcut.unregisterAll();

// 检查快捷键是否已注册
const isRegistered = LocalShortcut.isRegistered('CommandOrControl+K');

// 禁用窗口的所有快捷键
LocalShortcut.disableAll(win);

// 启用窗口的所有快捷键
LocalShortcut.enableAll(win);
```

## 生命周期集成

快捷键在应用生命周期中的初始化：

1. **INIT 阶段**: 配置加载
2. **READY 阶段**: 快捷键注册（`ReadyShortcutRegistrationHook`, priority 400）
3. **BEFORE_QUIT 阶段**: 快捷键注销

## 事件系统集成

快捷键触发通过 EventBus 发送事件：

```typescript
eventBus.emit('quit:changed'); // 退出应用
eventBus.emit('goSettings:changed'); // 跳转设置
eventBus.emit('showHideWindow:changed'); // 显示/隐藏窗口
eventBus.emit('newWindow:changed'); // 创建新窗口
eventBus.emit('newTab:changed'); // 创建新标签页
eventBus.emit('refresh:changed'); // 刷新当前页面
```

对应的事件处理器位于 `src/main/events/`:

- `quitChanged.ts`
- `goSettingsChanged.ts`
- `showHideWindowChanged.ts`
- `newWindowChanged.ts`
- `newTabChanged.ts`
- `refreshChanged.ts`

## 配置变更

快捷键配置变更会触发 `shortcuts:changed` 事件：

```typescript
// 事件处理器：src/main/events/shortcutsChanged.ts
export default async (): Promise<void> => {
  const { shortcutManager } = await import('@main/common/shortcut');
  await shortcutManager.refreshShortcuts();
};
```

## 注意事项

1. **全局快捷键冲突**: 全局快捷键可能与系统或其他应用冲突，注册失败时会有警告日志
2. **快捷键验证**: LocalShortcut 会验证加速器格式，无效格式会被拒绝
3. **窗口生命周期**: 本地快捷键会在窗口销毁时自动清理
4. **平台差异**:
   - macOS: `Command` 键
   - Windows/Linux: `Control` 键
   - 使用 `CommandOrControl` 实现跨平台兼容

## 扩展新快捷键

要添加新的快捷键：

1. 在 `DEFAULT_SHORTCUTS` 中添加配置
2. 在 `ShortcutManager.registerShortcuts()` 中添加处理逻辑
3. 创建对应的事件处理器 `src/main/events/*Changed.ts`
4. 在 EventBus 中 emit 对应事件

**示例：添加 "全选" 快捷键**

```typescript
// 1. 添加默认配置
DEFAULT_SHORTCUTS.push({
  key: 'SelectAll',
  shortcut: `${CommandKey}+A`,
  editable: true,
  enabled: true,
  global: false,
  registered: false
})

// 2. 添加处理函数
private handleSelectAll(): void {
  log.info('[ShortcutManager] 快捷键触发: SelectAll')
  eventBus.emit('selectAll:changed')
}

// 3. 注册逻辑
case 'SelectAll':
  handler = () => this.handleSelectAll()
  break

// 4. 创建事件处理器
// src/main/events/selectAllChanged.ts
export default async (): Promise<void> => {
  // 实现全选逻辑
}
```

## 调试

启用日志级别为 `debug` 可查看快捷键注册详情：

```typescript
log.setLevel('debug');

// 日志输出：
// [ShortcutManager] 开始注册应用快捷键...
// [ShortcutManager] 全局快捷键注册成功: ShowHideWindow -> CommandOrControl+Tab
// [LocalShortcut] 注册快捷键 CommandOrControl+Q
// [ShortcutManager] 快捷键注册完成，共注册 4 个快捷键
```
