# 纯 Monorepo 架构模式（Electron 应用）

> 展示纯粹使用 pnpm workspace + Vite/tsup 组织 Electron 项目的完整架构方案
>
> 创建时间：2026-02-04

---

## 目录

1. [Electron 架构本质](#1-electron-架构本质)
2. [纯 Monorepo 架构模式](#2-纯-monorepo-架构模式)
3. [包的职责划分](#3-包的职责划分)
4. [构建配置](#4-构建配置)
5. [开发流程](#5-开发流程)
6. [打包发布](#6-打包发布)
7. [完整示例](#7-完整示例)

---

## 1. Electron 架构本质

### 1.1 Electron 的多进程模型

Electron 应用由多个进程组成，每个进程有不同的运行环境和构建需求：

| 进程                    | 运行环境       | 技术栈                 | 构建目标                |
| ----------------------- | -------------- | ---------------------- | ----------------------- |
| **主进程** (Main)       | Node.js        | Node.js + Electron API | CommonJS/ESM (Node 20+) |
| **渲染进程** (Renderer) | Chromium       | HTML + CSS + Vue/React | ES2020+ (Browser)       |
| **Preload** (Bridge)    | Node.js (受限) | Electron contextBridge | CommonJS/ESM (Node 20+) |

### 1.2 关键理解

```
Electron 应用 ≠ 单一进程
Electron 应用 = 主进程 + 渲染进程 + Preload

在 Monorepo 中：
  - 可以把这三个进程拆成独立的包
  - 也可以把它们作为一个整体应用包
```

**核心挑战**：

- 三个进程需要不同的构建配置（Node.js vs Browser）
- 需要协调三个进程的启动顺序
- 需要处理进程间的通信（IPC）

---

## 2. 纯 Monorepo 架构模式

### 2.1 目录结构

```
coobee-ai/
├── packages/
│   ├── electron-app/           # Electron 应用包（推荐方案）
│   │   ├── src/
│   │   │   ├── main/           # 主进程代码
│   │   │   │   ├── index.ts
│   │   │   │   ├── window/
│   │   │   │   └── app/
│   │   │   ├── preload/        # Preload 代码
│   │   │   │   └── index.ts
│   │   │   └── renderer/       # 渲染进程代码
│   │   │       ├── index.html
│   │   │       ├── main.ts
│   │   │       ├── App.vue
│   │   │       └── components/
│   │   ├── resources/          # 静态资源
│   │   ├── package.json
│   │   ├── vite.config.main.ts      # 主进程构建配置
│   │   ├── vite.config.preload.ts   # Preload 构建配置
│   │   ├── vite.config.renderer.ts  # 渲染进程构建配置
│   │   ├── tsconfig.json
│   │   └── electron-builder.yml
│   │
│   ├── ai-core/                # AI 核心包
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ai-gateway/             # AI 网关包
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── pnpm-workspace.yaml
├── package.json               # 根 package.json
└── tsconfig.json             # 根 TS 配置
```

### 2.2 架构分层与依赖方向

```
┌─────────────────────────────────────────────────────────┐
│              @coobee/electron-app                       │
│         (Electron 应用 - 最上层)                        │
│  ├── main/       (Node.js 进程)                        │
│  ├── preload/    (桥接层)                              │
│  └── renderer/   (Browser 进程)                        │
└─────────────────────────────────────────────────────────┘
                    ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│            @coobee/ai-gateway                           │
│         (AI 网关 - WebSocket 对接层)                    │
│  • AgentGateway                                         │
│  • WebSocket 服务器                                     │
│  • 消息路由与处理                                       │
│  • 生命周期管理                                         │
└─────────────────────────────────────────────────────────┘
                    ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│             @coobee/ai-core                             │
│         (AI 核心逻辑 - 最底层，完全独立)                │
│  • Agent 定义                                           │
│  • 工具系统                                             │
│  • 技能系统                                             │
│  • 存储层                                               │
└─────────────────────────────────────────────────────────┘
```

**关键理解：依赖方向是自上而下的**

```
✅ 正确的依赖方向：
   electron-app  →  依赖  →  ai-gateway  →  依赖  →  ai-core

❌ 错误的理解：
   ai-core  依赖  →  electron-app  (✗ 绝对不能这样！)
   ai-gateway  依赖  →  electron-app  (✗ 绝对不能这样！)
```

**为什么这样设计？**

- `ai-core` 是纯业务逻辑，框架无关，可以用于 CLI、Web、Server 等任何场景
- `ai-gateway` 只依赖 `ai-core`，提供 WebSocket 对接层（消息路由、生命周期等）
- `electron-app` 作为最终应用，依赖并整合所有底层包

---

## 3. 包的职责划分

### 3.1 @coobee/electron-app（Electron 应用包）

**定位**: 完整的 Electron 应用，包含 main、preload、renderer

**职责**:

- ✅ 主进程：窗口管理、应用生命周期、系统调用
- ✅ Preload：IPC 桥接、安全的 API 暴露
- ✅ 渲染进程：Vue 3 前端界面

**依赖**:

- `electron` - Electron 框架
- `@coobee/ai-gateway` - AI 网关（在 main 中启动 WebSocket 服务器）
- `vue` - 前端框架（在 renderer 中使用）

**构建产物**:

```
dist/
├── main/
│   └── index.js
├── preload/
│   └── index.js
└── renderer/
    ├── index.html
    └── assets/
```

### 3.2 @coobee/ai-core（AI 核心包）⭐ 最底层

**定位**: 框架无关的 AI 核心逻辑 + 存储

**职责**:

- ✅ Agent 定义与编排
- ✅ 工具系统
- ✅ 技能系统
- ✅ 数据存储层

**依赖**:

- `@openai/agents` - OpenAI Agents 框架
- `openai` - OpenAI SDK
- `zod` - 参数验证
- ❌ **不依赖** `@coobee/electron-app`
- ❌ **不依赖** `electron`

**关键点：完全独立**

- 可以在非 Electron 环境中使用（CLI、Web、Server）
- 不依赖任何其他 workspace 包
- 可以单独发布到 npm

**构建产物**:

```
dist/
├── index.js
└── index.d.ts
```

### 3.3 @coobee/ai-gateway（AI 网关包）⭐ 中间层

**定位**: WebSocket 对接层

**职责**:

- ✅ AgentGateway（整合 ai-core）
- ✅ WebSocket 服务器（ws 库）
- ✅ 消息路由与处理
- ✅ 生命周期管理

**依赖**:

- `@coobee/ai-core` - ✅ **workspace 依赖**（核心逻辑）
- `ws` - WebSocket 服务器库
- ❌ **不依赖** `electron`（网关层框架无关）
- ❌ **不依赖** `@coobee/electron-app`

**关键点：单向依赖**

- 依赖 `ai-core`，被 `electron-app` 依赖
- 不能反向依赖 `electron-app`

**构建产物**:

```
dist/
├── index.js
└── index.d.ts
```

### 3.4 依赖关系总结

```
依赖方向（自上而下）：

@coobee/electron-app
    ↓ 依赖
@coobee/ai-gateway
    ↓ 依赖
@coobee/ai-core
    ↓ 依赖
外部 npm 包 (@openai/agents, openai, zod, ws)
```

**package.json 依赖示例**:

```json
// @coobee/ai-core/package.json
{
  "dependencies": {
    "@openai/agents": "^0.4.6",
    "openai": "^4.72.1",
    "zod": "^4.3.6"
    // ❌ 不包含任何 workspace 包
  }
}

// @coobee/ai-gateway/package.json
{
  "dependencies": {
    "@coobee/ai-core": "workspace:*",  // ✅ 依赖 ai-core
    "ws": "^8.18.0"
    // ❌ 不依赖 electron（网关层框架无关）
    // ❌ 不包含 electron-app
  }
}

// @coobee/electron-app/package.json
{
  "dependencies": {
    "@coobee/ai-gateway": "workspace:*",  // ✅ 依赖 ai-gateway
    "electron": "^39.0.0",
    "vue": "^3.5.0"
  }
}
```

**开发时的影响**:

| 场景                  | 说明                                |
| --------------------- | ----------------------------------- |
| **开发 ai-core**      | ✅ 完全独立，无需 Electron          |
| **开发 ai-gateway**   | ✅ 只需 ai-core，无需 electron-app  |
| **开发 electron-app** | ⚠️ 需要先构建 ai-gateway 和 ai-core |

**构建顺序**（必须遵守）:

```bash
1. pnpm --filter @coobee/ai-core build      # 最底层
2. pnpm --filter @coobee/ai-gateway build   # 中间层
3. pnpm --filter @coobee/electron-app build # 最上层
```

---

## 4. 构建配置

### 4.1 主进程构建配置

```typescript
// packages/electron-app/vite.config.main.ts
import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import path from 'path'

export default defineConfig({
  // 主进程入口
  build: {
    // 输出目录
    outDir: 'dist/main',
    // 不清理输出目录（让 preload 和 renderer 共存）
    emptyOutDir: false,
    // Rollup 配置
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/main/index.ts')
      },
      output: {
        entryFileNames: '[name].js'
      },
      // 外部化 Node.js 内置模块和 Electron
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
    },
    // Node.js 目标
    target: 'node20',
    // 生成 source map
    sourcemap: true
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@coobee/ai-core': path.resolve(__dirname, '../ai-core/src'),
      '@coobee/ai-gateway': path.resolve(__dirname, '../ai-gateway/src')
    }
  }
})
```

### 4.2 Preload 构建配置

```typescript
// packages/electron-app/vite.config.preload.ts
import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import path from 'path'

export default defineConfig({
  build: {
    outDir: 'dist/preload',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        preload: path.resolve(__dirname, 'src/preload/index.ts')
      },
      output: {
        entryFileNames: '[name].js'
      },
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
    },
    target: 'node20',
    sourcemap: true
  }
})
```

### 4.3 渲染进程构建配置

```typescript
// packages/electron-app/vite.config.renderer.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  // 渲染进程入口
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: false,
    // Browser 目标
    target: 'es2020',
    sourcemap: true
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer')
    }
  },
  // 开发服务器配置
  server: {
    port: 5173
  }
})
```

### 4.4 AI 包构建配置

```typescript
// packages/ai-core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

```json
// packages/ai-core/package.json
{
  "name": "@coobee/ai-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch"
  },
  "dependencies": {
    "@openai/agents": "^0.4.6",
    "openai": "^4.72.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.3"
  }
}
```

---

## 5. 开发流程

### 5.1 package.json 脚本配置

```json
// packages/electron-app/package.json
{
  "name": "@coobee/electron-app",
  "version": "1.0.0",
  "main": "dist/main/main.js",
  "scripts": {
    // 构建所有进程
    "build:main": "vite build --config vite.config.main.ts",
    "build:preload": "vite build --config vite.config.preload.ts",
    "build:renderer": "vite build --config vite.config.renderer.ts",
    "build": "pnpm build:main && pnpm build:preload && pnpm build:renderer",

    // 开发模式
    "dev:main": "vite build --config vite.config.main.ts --watch",
    "dev:preload": "vite build --config vite.config.preload.ts --watch",
    "dev:renderer": "vite --config vite.config.renderer.ts",
    "dev:electron": "electron .",
    "dev": "concurrently \"pnpm dev:main\" \"pnpm dev:preload\" \"pnpm dev:renderer\" \"wait-on dist/main/main.js && pnpm dev:electron\"",

    // 打包
    "package:mac": "pnpm build && electron-builder --mac",
    "package:win": "pnpm build && electron-builder --win",
    "package:linux": "pnpm build && electron-builder --linux"
  },
  "dependencies": {
    "@coobee/ai-gateway": "workspace:*",
    "electron": "^39.0.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^7.0.0",
    "concurrently": "^9.0.0",
    "wait-on": "^8.0.0",
    "electron-builder": "^26.0.0"
  }
}
```

```json
// 根 package.json
{
  "name": "coobee-ai-workspace",
  "private": true,
  "scripts": {
    // 构建所有包
    "build:ai": "pnpm --filter '@coobee/ai-*' build",
    "build:app": "pnpm --filter @coobee/electron-app build",
    "build": "pnpm build:ai && pnpm build:app",

    // 开发模式
    "dev:ai": "pnpm --filter '@coobee/ai-*' dev",
    "dev:app": "pnpm --filter @coobee/electron-app dev",
    "dev": "concurrently \"pnpm dev:ai\" \"pnpm dev:app\"",

    // 打包
    "package": "pnpm build && pnpm --filter @coobee/electron-app package:mac"
  }
}
```

### 5.2 开发流程说明

#### 启动开发环境

```bash
# Terminal 1: 启动 AI 包的 watch 构建
pnpm dev:ai

# Terminal 2: 启动 Electron 应用
pnpm dev:app
```

或者使用统一命令：

```bash
pnpm dev
```

**执行顺序**：

1. AI 包开始 watch 构建（`tsup --watch`）
2. 主进程开始 watch 构建（`vite build --watch`）
3. Preload 开始 watch 构建（`vite build --watch`）
4. 渲染进程启动 dev server（`vite`）
5. 等待主进程构建完成 → 启动 Electron

#### 热更新机制

| 进程         | 修改后   | 更新方式             |
| ------------ | -------- | -------------------- |
| **渲染进程** | 保存代码 | ✅ Vite HMR（秒级）  |
| **主进程**   | 保存代码 | ⚠️ 需要重启 Electron |
| **Preload**  | 保存代码 | ⚠️ 需要重启 Electron |
| **AI 包**    | 保存代码 | ⚠️ 需要重启 Electron |

**改进方案**：使用 `nodemon` 或 `electron-reload` 自动重启

```json
{
  "scripts": {
    "dev": "concurrently \"pnpm dev:main\" \"pnpm dev:preload\" \"pnpm dev:renderer\" \"nodemon --watch dist/main --exec 'electron .'\""
  }
}
```

---

## 6. 打包发布

### 6.1 electron-builder 配置

```yaml
# packages/electron-app/electron-builder.yml
appId: com.coobee.ai
productName: Coobee AI
copyright: Copyright © 2026

directories:
  output: ../../release # 输出到根目录的 release/
  buildResources: resources

files:
  - dist/**/* # 构建产物
  - resources/**/* # 静态资源
  - package.json
  - '!**/*.map' # 排除 source map

mac:
  icon: resources/icon.icns
  target:
    - dmg
    - zip
  category: public.app-category.productivity

win:
  icon: resources/icon.ico
  target:
    - nsis
    - portable

linux:
  icon: resources/icon.png
  target:
    - AppImage
    - deb
```

### 6.2 打包流程

```bash
# 完整的打包流程
pnpm build:ai           # 1. 构建 AI 包
pnpm build:app          # 2. 构建 Electron 应用
pnpm --filter @coobee/electron-app package:mac  # 3. 打包 macOS 应用
```

**产物结构**：

```
release/
├── Coobee AI-1.0.0.dmg          # macOS DMG
├── Coobee AI-1.0.0-mac.zip      # macOS ZIP
├── Coobee AI Setup 1.0.0.exe    # Windows 安装包
└── coobee-ai-1.0.0.AppImage     # Linux AppImage
```

---

## 7. 完整示例

### 7.1 主进程代码示例

```typescript
// packages/electron-app/src/main/index.ts
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { AgentGateway } from '@coobee/ai-gateway'

let mainWindow: BrowserWindow | null = null
let agentGateway: AgentGateway | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 开发模式：加载 dev server
  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // 生产模式：加载构建产物
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // 初始化 AI 网关（WebSocket 服务器）
  agentGateway = new AgentGateway()
  await agentGateway.initialize(9000) // 端口 9000

  // 创建窗口
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

### 7.2 Preload 代码示例

```typescript
// packages/electron-app/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // AI 相关 API
  ai: {
    createSession: (config) => ipcRenderer.invoke('ai:create-session', config),
    sendMessage: (sessionId, message) => ipcRenderer.invoke('ai:send-message', sessionId, message),
    onMessage: (callback) => ipcRenderer.on('ai:message', (_, data) => callback(data))
  },

  // 系统 API
  platform: process.platform,
  versions: process.versions
})

// 类型定义（供渲染进程使用）
export interface ElectronAPI {
  ai: {
    createSession: (config: any) => Promise<string>
    sendMessage: (sessionId: string, message: string) => Promise<void>
    onMessage: (callback: (data: any) => void) => void
  }
  platform: string
  versions: NodeJS.ProcessVersions
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
```

### 7.3 渲染进程代码示例

```vue
<!-- packages/electron-app/src/renderer/App.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'

const sessionId = ref<string>('')
const messages = ref<any[]>([])
const inputMessage = ref('')

onMounted(async () => {
  // 创建 AI 会话
  sessionId.value = await window.electronAPI.ai.createSession({
    agent: 'chat'
  })

  // 监听 AI 消息
  window.electronAPI.ai.onMessage((data) => {
    messages.value.push(data)
  })
})

async function sendMessage() {
  if (!inputMessage.value) return

  messages.value.push({
    role: 'user',
    content: inputMessage.value
  })

  await window.electronAPI.ai.sendMessage(sessionId.value, inputMessage.value)
  inputMessage.value = ''
}
</script>

<template>
  <div class="app">
    <div class="messages">
      <div v-for="(msg, i) in messages" :key="i" :class="`message ${msg.role}`">
        {{ msg.content }}
      </div>
    </div>

    <div class="input">
      <input v-model="inputMessage" @keyup.enter="sendMessage" />
      <button @click="sendMessage">发送</button>
    </div>
  </div>
</template>
```

### 7.4 AI 网关代码示例

```typescript
// packages/ai-gateway/src/AgentGateway.ts
import { Agent, SessionStore, MessageStore } from '@coobee/ai-core'
import { WebSocketServer, WebSocket } from 'ws'

export class AgentGateway {
  private wss: WebSocketServer
  private sessionStore: SessionStore
  private messageStore: MessageStore
  private agents: Map<string, Agent> = new Map()

  async initialize(port: number = 9000): Promise<void> {
    this.sessionStore = new SessionStore()
    this.messageStore = new MessageStore()

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ port })
    console.log(`[AI Gateway] WebSocket 服务器启动，端口：${port}`)

    // 监听连接
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws)
    })
  }

  private handleConnection(ws: WebSocket): void {
    console.log('[AI Gateway] 新客户端连接')

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        const response = await this.handleMessage(message)
        ws.send(JSON.stringify(response))
      } catch (error) {
        console.error('[AI Gateway] 处理消息失败:', error)
        ws.send(JSON.stringify({ error: error.message }))
      }
    })
  }

  private async handleMessage(message: any): Promise<any> {
    const { type, payload } = message

    switch (type) {
      case 'create-session':
        return await this.createSession(payload)
      case 'send-message':
        return await this.sendMessage(payload)
      default:
        throw new Error(`未知的消息类型: ${type}`)
    }
  }

  private async createSession(config: any): Promise<{ sessionId: string }> {
    const agent = new Agent(config)
    const sessionId = await this.sessionStore.create(config)
    this.agents.set(sessionId, agent)
    return { sessionId }
  }

  private async sendMessage(payload: { sessionId: string; message: string }): Promise<any> {
    const { sessionId, message } = payload
    const agent = this.agents.get(sessionId)

    if (!agent) {
      throw new Error('Session not found')
    }

    // 保存用户消息
    await this.messageStore.save({
      sessionId,
      role: 'user',
      content: message
    })

    // 调用 AI Agent
    const response = await agent.chat(message)

    // 保存 AI 回复
    await this.messageStore.save({
      sessionId,
      role: 'assistant',
      content: response
    })

    return { response }
  }
}
```

---

## 8. 总结

### 8.1 纯 Monorepo 架构要点

```
✅ Electron 应用作为一个完整的包（@coobee/electron-app）
   - 包含 main、preload、renderer 三个进程
   - 使用 3 个 Vite 配置文件分别构建

✅ AI 模块作为独立的包
   - @coobee/ai-core - AI 核心逻辑
   - @coobee/ai-gateway - WebSocket 对接层

✅ 通过 workspace:* 建立依赖关系

✅ 使用 concurrently 协调多个构建进程

✅ 使用 electron-builder 打包发布
```

### 8.2 目录结构总结

```
packages/
├── electron-app/                # Electron 应用包
│   ├── src/main/               # Node.js 进程
│   ├── src/preload/            # 桥接层
│   ├── src/renderer/           # Browser 进程
│   ├── vite.config.main.ts     # 主进程构建
│   ├── vite.config.preload.ts  # Preload 构建
│   ├── vite.config.renderer.ts # 渲染进程构建
│   └── electron-builder.yml    # 打包配置
├── ai-core/                    # AI 核心包
└── ai-gateway/                 # AI 网关包
```

### 8.3 关键配置文件

| 文件                      | 用途                           |
| ------------------------- | ------------------------------ |
| `pnpm-workspace.yaml`     | Monorepo 包管理                |
| `vite.config.main.ts`     | 主进程构建（Node.js target）   |
| `vite.config.preload.ts`  | Preload 构建（Node.js target） |
| `vite.config.renderer.ts` | 渲染进程构建（Browser target） |
| `electron-builder.yml`    | 应用打包配置                   |
| `tsconfig.json`           | TypeScript 配置                |

### 8.4 完整的开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev                  # 启动所有包的 watch 构建 + Electron

# 构建
pnpm build                # 构建所有包

# 打包
pnpm package              # 打包 macOS 应用
```

---

**这就是纯 Monorepo 架构下 Electron 项目的完整模式！** 🚀
