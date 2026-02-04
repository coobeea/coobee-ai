# IPC 模块

主进程常用 IPC 处理器，主要为 `shell:` 与 `window:` 相关。

## 目录结构

```
ipc/
├── channels.ts      # 从 @shared/ipcChannels re-export
├── shellHandlers.ts # shell: 处理器（拉取窗口 ID、上报 Chrome 高度）
├── windowHandlers.ts# window: 处理器（最小化、最大化、关闭）
├── index.ts         # 统一注册 registerIpcHandlers()
└── README.md
```

**通道常量定义在 `src/shared/ipcChannels.ts`**，主进程与渲染进程均通过 `@shared/ipcChannels` 引用。

## 通道说明

### Shell 通道（shell:）

| 通道                  | 方向   | 说明                                               |
| --------------------- | ------ | -------------------------------------------------- |
| `shell:get-window-id` | invoke | 渲染进程拉取当前窗口 ID                            |
| `shell:chrome-height` | on     | 渲染进程上报 Chrome 高度（AppBar + Toolbar），预留 |

### 窗口控制通道（window:）

| 通道              | 方向 | 说明                |
| ----------------- | ---- | ------------------- |
| `window:minimize` | on   | 最小化当前窗口      |
| `window:maximize` | on   | 最大化/还原当前窗口 |
| `window:close`    | on   | 关闭当前窗口        |

## 使用方式

- **主进程**：在 `app.whenReady()` 之后调用 `registerIpcHandlers()`（已在 AppManager 中调用）。
- **渲染进程**：通过 `window.electron.ipcRenderer.send(WindowChannels.XXX)` 或 preload 暴露的 `window.api.getWindowId()` 使用。

## 扩展

新增 shell 相关处理：在 `shellHandlers.ts` 中增加 `ipcMain.handle` / `ipcMain.on`，并在 `channels.ts` 中增加对应常量。
