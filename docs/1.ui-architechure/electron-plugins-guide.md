# Electron 插件使用指南

## 📦 已安装的 Electron 核心库

### 核心框架

| 包名                        | 版本       | 类型 | 说明                   |
| --------------------------- | ---------- | ---- | ---------------------- |
| `electron`                  | `^39.2.6`  | 开发 | Electron 主框架        |
| `electron-builder`          | `^26.0.12` | 开发 | Electron 打包工具      |
| `electron-vite`             | `^5.0.0`   | 开发 | Electron Vite 构建工具 |
| `@electron-toolkit/preload` | `^3.0.2`   | 生产 | Preload 工具           |
| `@electron-toolkit/utils`   | `^4.0.0`   | 生产 | Electron 工具集        |

### Electron 插件

| 包名                          | 版本      | 类型 | 说明            |
| ----------------------------- | --------- | ---- | --------------- |
| `electron-updater`            | `^6.3.9`  | 生产 | 自动更新        |
| `electron-log`                | `^5.4.3`  | 生产 | 日志系统        |
| `electron-store`              | `^11.0.2` | 生产 | 持久化存储      |
| `electron-window-state`       | `^5.0.3`  | 生产 | 窗口状态管理    |
| `electron-devtools-installer` | `^4.0.0`  | 开发 | DevTools 安装器 |
| `@electron/notarize`          | `^3.1.1`  | 开发 | macOS 公证      |

---

## 📝 日志系统 - electron-log

### 基础使用

```typescript
// src/main/index.ts
import log from 'electron-log';

// 配置日志
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB

// 记录日志
log.info('应用启动');
log.debug('调试信息', { data: 'value' });
log.warn('警告信息');
log.error('错误信息', new Error('Something went wrong'));

// 在不同位置使用
log.info('Main process:', 'Hello from main');
```

### 日志级别

```typescript
log.error('错误 - 严重问题');
log.warn('警告 - 需要注意');
log.info('信息 - 一般信息');
log.verbose('详细 - 详细信息');
log.debug('调试 - 调试信息');
log.silly('琐碎 - 最详细的信息');
```

### 日志文件位置

```typescript
// 获取日志文件路径
console.log('日志文件路径:', log.transports.file.getFile().path);

// macOS: ~/Library/Logs/coobee-ai/main.log
// Windows: %USERPROFILE%\AppData\Roaming\coobee-ai\logs\main.log
// Linux: ~/.config/coobee-ai/logs/main.log
```

### 捕获未处理的异常

```typescript
log.catchErrors({
  showDialog: true,
  onError: (error) => {
    log.error('未处理的错误:', error);
  }
});

// 监听 IPC 日志
import { ipcMain } from 'electron';

ipcMain.handle('log:info', (_, message) => {
  log.info('Renderer:', message);
});
```

---

## 💾 持久化存储 - electron-store

### 基础使用

```typescript
// src/main/index.ts
import Store from 'electron-store';

// 定义 Schema
interface StoreSchema {
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  settings: {
    theme: 'light' | 'dark';
    language: string;
  };
  recentFiles: string[];
}

// 创建 Store 实例
const store = new Store<StoreSchema>({
  defaults: {
    windowBounds: {
      width: 1200,
      height: 800
    },
    settings: {
      theme: 'light',
      language: 'zh-CN'
    },
    recentFiles: []
  }
});

// 读取数据
const theme = store.get('settings.theme');
const bounds = store.get('windowBounds');

// 写入数据
store.set('settings.theme', 'dark');
store.set('windowBounds', { width: 1400, height: 900 });

// 删除数据
store.delete('recentFiles');

// 检查是否存在
if (store.has('settings.theme')) {
  console.log('主题设置存在');
}

// 清空所有数据
store.clear();
```

### 加密存储

```typescript
const store = new Store({
  encryptionKey: 'your-secret-key',
  defaults: {
    apiKey: '',
    token: ''
  }
});

// 数据会被加密存储
store.set('apiKey', 'sk-...');
```

### 监听变化

```typescript
// 监听特定键的变化
store.onDidChange('settings.theme', (newValue, oldValue) => {
  console.log(`主题从 ${oldValue} 变为 ${newValue}`);
});

// 监听所有变化
store.onDidAnyChange((newValue, oldValue) => {
  console.log('Store 发生变化');
});
```

### 存储位置

```typescript
console.log('配置文件路径:', store.path);

// macOS: ~/Library/Application Support/coobee-ai/config.json
// Windows: %APPDATA%\coobee-ai\config.json
// Linux: ~/.config/coobee-ai/config.json
```

---

## 🪟 窗口状态管理 - electron-window-state

### 基础使用

```typescript
// src/main/index.ts
import { BrowserWindow } from 'electron';
import windowStateKeeper from 'electron-window-state';

function createWindow() {
  // 加载保存的窗口状态
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    fullScreen: false,
    maximize: true
  });

  // 使用保存的状态创建窗口
  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js')
    }
  });

  // 管理窗口状态
  mainWindowState.manage(mainWindow);

  // 窗口状态会自动保存：
  // - 位置 (x, y)
  // - 大小 (width, height)
  // - 最大化状态
  // - 全屏状态

  return mainWindow;
}
```

### 多窗口管理

```typescript
// 主窗口
const mainWindowState = windowStateKeeper({
  file: 'main-window-state.json',
  defaultWidth: 1200,
  defaultHeight: 800
});

// 设置窗口
const settingsWindowState = windowStateKeeper({
  file: 'settings-window-state.json',
  defaultWidth: 600,
  defaultHeight: 400
});
```

### 监听状态变化

```typescript
const mainWindowState = windowStateKeeper({
  defaultWidth: 1200,
  defaultHeight: 800
});

mainWindowState.manage(mainWindow);

// 手动保存状态
mainWindow.on('close', () => {
  mainWindowState.saveState(mainWindow);
});
```

---

## 🔄 自动更新 - electron-updater

### 基础配置

```typescript
// src/main/index.ts
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

// 配置日志
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// 配置更新服务器
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'your-username',
  repo: 'coobee-ai'
});

// 或使用自定义服务器
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://your-server.com/updates'
});

// 检查更新
autoUpdater.checkForUpdatesAndNotify();
```

### 更新事件

```typescript
import { dialog } from 'electron';

// 检查更新中
autoUpdater.on('checking-for-update', () => {
  log.info('正在检查更新...');
});

// 有可用更新
autoUpdater.on('update-available', (info) => {
  log.info('发现新版本:', info.version);
  dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `发现新版本 ${info.version}，正在下载...`
  });
});

// 没有可用更新
autoUpdater.on('update-not-available', (info) => {
  log.info('当前是最新版本:', info.version);
});

// 下载进度
autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent);
  log.info(`下载进度: ${percent}%`);
  // 可以通过 IPC 发送给渲染进程显示进度
  mainWindow.webContents.send('download-progress', percent);
});

// 下载完成
autoUpdater.on('update-downloaded', (info) => {
  log.info('更新下载完成:', info.version);

  dialog
    .showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '新版本已下载，是否立即重启应用？',
      buttons: ['立即重启', '稍后']
    })
    .then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

// 更新错误
autoUpdater.on('error', (error) => {
  log.error('更新错误:', error);
  dialog.showErrorBox('更新错误', error.message);
});
```

### 手动检查更新

```typescript
// 主进程
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo;
  } catch (error) {
    log.error('检查更新失败:', error);
    throw error;
  }
});

// 渲染进程
const updateInfo = await window.electron.ipcRenderer.invoke('check-for-updates');
```

---

## 🔧 开发工具 - electron-devtools-installer

### 安装 Vue DevTools

```typescript
// src/main/index.ts
import { app } from 'electron';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';

app.whenReady().then(() => {
  if (!app.isPackaged) {
    // 开发环境下安装 DevTools
    installExtension(VUEJS_DEVTOOLS)
      .then((name) => console.log(`已安装: ${name}`))
      .catch((err) => console.log('安装失败:', err));
  }

  createWindow();
});
```

### 安装多个扩展

```typescript
import installExtension, { VUEJS_DEVTOOLS, REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';

const extensions = [VUEJS_DEVTOOLS, REDUX_DEVTOOLS];

app.whenReady().then(() => {
  if (!app.isPackaged) {
    extensions.forEach((extension) => {
      installExtension(extension)
        .then((name) => console.log(`已安装: ${name}`))
        .catch((err) => console.log(`安装失败:`, err));
    });
  }
});
```

---

## 🍎 macOS 公证 - @electron/notarize

### 配置公证

```javascript
// scripts/notarize.js
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.your.app.id',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
};
```

### electron-builder 配置

```yaml
# electron-builder.yml
mac:
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
afterSign: scripts/notarize.js
```

---

## 🎯 完整示例：主进程配置

```typescript
// src/main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import path from 'path';
import log from 'electron-log';
import Store from 'electron-store';
import windowStateKeeper from 'electron-window-state';
import { autoUpdater } from 'electron-updater';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';

// 配置日志
log.transports.file.level = 'info';
autoUpdater.logger = log;

// 配置存储
const store = new Store({
  defaults: {
    theme: 'light',
    language: 'zh-CN'
  }
});

function createWindow() {
  // 窗口状态管理
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800
  });

  // 创建窗口
  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  // 管理窗口状态
  mainWindowState.manage(mainWindow);

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // 加载应用
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

// 应用就绪
app.whenReady().then(() => {
  // Electron 工具优化
  electronApp.setAppUserModelId('com.coobee.ai');

  // 安装 DevTools（开发环境）
  if (!app.isPackaged) {
    installExtension(VUEJS_DEVTOOLS)
      .then((name) => log.info(`已安装: ${name}`))
      .catch((err) => log.error('安装失败:', err));
  }

  // 优化窗口行为
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 创建窗口
  const mainWindow = createWindow();

  // 检查更新
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  // macOS 激活行为
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 处理
ipcMain.handle('log:info', (_, message) => {
  log.info('Renderer:', message);
});

ipcMain.handle('store:get', (_, key) => {
  return store.get(key);
});

ipcMain.handle('store:set', (_, key, value) => {
  store.set(key, value);
});

ipcMain.handle('check-for-updates', async () => {
  return await autoUpdater.checkForUpdates();
});
```

---

## 📚 参考资源

- [Electron 官方文档](https://www.electronjs.org/docs/latest)
- [electron-log](https://github.com/megahertz/electron-log)
- [electron-store](https://github.com/sindresorhus/electron-store)
- [electron-window-state](https://github.com/mawie81/electron-window-state)
- [electron-updater](https://www.electron.build/auto-update)
- [electron-devtools-installer](https://github.com/MarshallOfSound/electron-devtools-installer)
- [@electron/notarize](https://github.com/electron/notarize)

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ Electron 插件配置完成
