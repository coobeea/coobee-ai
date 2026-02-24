# IPC 统一管理

此目录统一管理所有 IPC (Inter-Process Communication) 相关的类型定义和通道常量。

## 📁 目录结构

```
src/shared/ipc/
├── index.ts          # 统一导出入口
├── channels.ts       # IPC 通道名称常量
├── types.ts          # IPC 类型定义
└── README.md         # 说明文档
```

## 📋 文件说明

### `channels.ts`

定义所有 IPC 通道的名称常量，避免硬编码字符串。

**通道分类**：

- `ShellChannels` - Shell 窗口相关（invoke 拉取）
- `WindowChannels` - 窗口控制（invoke）
- `TabChannels` - Tab 操作（invoke）
- `EventChannels` - 事件监听（on 监听）

**命名规范**：`前缀:动作`

- 例如：`shell:get-window-info`、`tab:create`、`event:tabs-updated`

### `types.ts`

定义所有 IPC 通信的请求和响应类型。

**类型分类**：

1. **通用类型** - `IpcResult`、`WindowType`、`TabType`
2. **Shell 相关** - `WindowInfoResponse`、`TabInfoResponse`
3. **Window 控制** - `MinimizeWindowRequest`、`MaximizeWindowRequest` 等
4. **Tab 操作** - `CreateTabRequest`、`CloseTabRequest` 等
5. **事件监听** - `TabsUpdatedEvent`、`TabActivatedEvent` 等

### `index.ts`

统一导出所有通道常量和类型，提供单一入口。

## 🔧 使用方式

### 在主进程中使用

```typescript
// 导入通道常量
import { ShellChannels, WindowChannels } from '@shared/ipc';
// 导入类型
import type { WindowInfoResponse, CreateTabRequest } from '@shared/ipc';

// 注册 IPC 处理器
ipcMain.handle(ShellChannels.GET_WINDOW_INFO, (event): WindowInfoResponse => {
  // ...
});
```

### 在预加载脚本中使用

```typescript
import { ShellChannels } from '@shared/ipc';
import type { WindowInfoResponse } from '@shared/ipc';

const api = {
  getWindowInfo: (): Promise<WindowInfoResponse | null> => ipcRenderer.invoke(ShellChannels.GET_WINDOW_INFO)
};
```

### 在渲染进程中使用

```typescript
import { WindowChannels } from '@shared/ipc';

// 发送窗口控制命令
window.electron.ipcRenderer.send(WindowChannels.MINIMIZE);
```

## ✅ 优势

1. **类型安全** - 所有 IPC 通信都有明确的类型定义
2. **统一管理** - 前后端共享同一套类型和常量，避免不一致
3. **易于扩展** - 新增 IPC 功能时只需在这里添加
4. **防止拼写错误** - 使用常量代替字符串字面量
5. **自文档化** - 详细的注释说明每个类型和通道的用途

## 📝 添加新 IPC 功能

### 1. 在 `channels.ts` 中添加通道常量

```typescript
export const TabChannels = {
  CREATE: 'tab:create',
  // 添加新通道
  RENAME: 'tab:rename'
} as const;
```

### 2. 在 `types.ts` 中添加类型定义

```typescript
/**
 * 重命名 Tab 请求
 */
export interface RenameTabRequest {
  windowId?: number;
  tabId: number;
  newTitle: string;
}
```

### 3. 在 `index.ts` 中导出

```typescript
export type {
  // ...
  RenameTabRequest
} from './types';
```

### 4. 在主进程中实现处理器

```typescript
import { TabChannels } from '@shared/ipc';
import type { RenameTabRequest } from '@shared/ipc';

ipcMain.handle(TabChannels.RENAME, (event, req: RenameTabRequest) => {
  // 实现逻辑
});
```

## 🔄 IPC 通信模式

### invoke/handle 模式（双向通信）

- **主进程**: `ipcMain.handle(channel, handler)`
- **渲染进程**: `ipcRenderer.invoke(channel, args)`
- **用途**: 需要返回值的请求（查询、操作等）
- **例子**: `shell:get-window-info`、`tab:create`

### send/on 模式（单向通信）

- **主进程**: `ipcMain.on(channel, handler)`
- **渲染进程**: `ipcRenderer.send(channel, args)`
- **用途**: 不需要返回值的命令（窗口控制等）
- **例子**: `window:minimize`、`window:close`

### 事件推送（主进程 -> 渲染进程）

- **主进程**: `webContents.send(channel, data)`
- **渲染进程**: `ipcRenderer.on(channel, handler)`
- **用途**: 主进程主动推送事件到渲染进程
- **例子**: `event:tabs-updated`、`event:tab-activated`
