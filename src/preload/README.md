# Preload 脚本

Preload 在渲染进程加载前执行，通过 `contextBridge` 向渲染进程暴露安全的 API。

## 暴露的 API

### `window.api`

| 方法            | 说明                    | 返回值                               |
| --------------- | ----------------------- | ------------------------------------ |
| `getPlatform()` | 获取当前操作系统平台    | `'darwin'` \| `'win32'` \| `'linux'` |
| `getWindowId()` | 向主进程拉取当前窗口 ID | `Promise<number>`                    |

### `window.electron`

由 `@electron-toolkit/preload` 提供，包含：

- `ipcRenderer`：IPC 通信（如 `send('window:minimize')`）
- `process`：进程信息（如 `process.versions`）
- 其他 Electron 安全 API

## 使用示例

```typescript
// 平台检测（可与 usePlatform 的 navigator 方案二选一）
const platform = window.api.getPlatform(); // 'darwin' | 'win32' | 'linux'

// 窗口 ID（向主进程拉取，用于 IPC 时标识当前窗口）
const windowId = await window.api.getWindowId();

// 窗口控制
window.electron.ipcRenderer.send('window:minimize');
window.electron.ipcRenderer.send('window:maximize');
window.electron.ipcRenderer.send('window:close');
```

## 类型声明

渲染进程中的 TypeScript 类型见 `index.d.ts`，保证 `window.api` 和 `window.electron` 的类型安全。

## 注意

- `getWindowId()` 为异步，向主进程 invoke `shell:get-window-id` 拉取当前窗口 ID，失败或非窗口上下文返回 `0`。
- 仅在 `contextIsolation: true` 时使用 `contextBridge`；否则直接挂到 `window`。
