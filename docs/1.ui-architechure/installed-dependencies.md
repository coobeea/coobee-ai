# 已安装依赖总结

## 📦 安装完成时间

2026-02-04

---

## ✅ 已安装的依赖

### 1. AI & Agent 框架

| 包名                        | 版本      | 类型 | 说明                                             |
| --------------------------- | --------- | ---- | ------------------------------------------------ |
| `openai`                    | `^6.17.0` | 生产 | OpenAI 官方 SDK，支持 GPT-4、GPT-3.5 等模型      |
| `@openai/agents`            | `^0.4.5`  | 生产 | OpenAI Agents 框架，用于构建智能代理             |
| `@modelcontextprotocol/sdk` | `^1.25.3` | 生产 | Model Context Protocol SDK，统一的模型上下文协议 |

### 2. 数据库

| 包名                              | 版本      | 类型 | 说明                                              |
| --------------------------------- | --------- | ---- | ------------------------------------------------- |
| `better-sqlite3-multiple-ciphers` | `^12.6.2` | 生产 | 支持多种加密的 SQLite3 数据库，已成功编译原生模块 |

### 3. 富文本编辑器 (Tiptap)

| 包名                             | 版本      | 类型 | 说明                       |
| -------------------------------- | --------- | ---- | -------------------------- |
| `@tiptap/core`                   | `^3.19.0` | 生产 | Tiptap 核心库              |
| `@tiptap/vue-3`                  | `^3.19.0` | 生产 | Vue 3 集成                 |
| `@tiptap/starter-kit`            | `^3.19.0` | 生产 | 起始工具包（包含常用扩展） |
| `@tiptap/extension-code-block`   | `^3.19.0` | 生产 | 代码块扩展                 |
| `@tiptap/extension-hard-break`   | `^3.19.0` | 生产 | 硬换行扩展                 |
| `@tiptap/extension-history`      | `^3.19.0` | 生产 | 撤销/重做历史记录          |
| `@tiptap/extension-image`        | `^3.19.0` | 生产 | 图片支持                   |
| `@tiptap/extension-mention`      | `^3.19.0` | 生产 | @提及功能                  |
| `@tiptap/extension-placeholder`  | `^3.19.0` | 生产 | 占位符文本                 |
| `@tiptap/extension-table`        | `^3.19.0` | 生产 | 表格支持                   |
| `@tiptap/extension-table-cell`   | `^3.19.0` | 生产 | 表格单元格                 |
| `@tiptap/extension-table-header` | `^3.19.0` | 生产 | 表格表头                   |
| `@tiptap/extension-table-row`    | `^3.19.0` | 生产 | 表格行                     |
| `@tiptap/extension-task-item`    | `^3.19.0` | 生产 | 任务项（可勾选）           |
| `@tiptap/extension-task-list`    | `^3.19.0` | 生产 | 任务列表                   |
| `@tiptap/suggestion`             | `^3.19.0` | 生产 | 建议/自动完成功能          |

### 4. 代码编辑器 (Monaco Editor)

| 包名                            | 版本      | 类型 | 说明                       |
| ------------------------------- | --------- | ---- | -------------------------- |
| `monaco-editor`                 | `^0.55.1` | 生产 | VS Code 编辑器核心         |
| `vite-plugin-monaco-editor-esm` | `^2.0.2`  | 开发 | Monaco Editor 的 Vite 插件 |

---

## 📊 依赖统计

- **总计新增**: 21 个依赖包
- **生产依赖**: 20 个
- **开发依赖**: 1 个
- **原生模块**: 1 个（better-sqlite3-multiple-ciphers）

---

## 🔧 特殊配置

### pnpm 构建配置

已在 `package.json` 中配置 `better-sqlite3-multiple-ciphers` 允许运行构建脚本：

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "electron",
    "esbuild",
    "better-sqlite3-multiple-ciphers"
  ]
}
```

### 原生模块编译

`better-sqlite3-multiple-ciphers` 已成功编译为原生模块：

- ✅ 使用 node-gyp 编译
- ✅ 架构: arm64 (Apple Silicon)
- ✅ Electron 兼容性已验证

---

## 🎯 使用建议

### 1. Tiptap 富文本编辑器

```typescript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { VueNodeViewRenderer } from '@tiptap/vue-3';

const editor = new Editor({
  extensions: [
    StarterKit
    // 添加更多扩展...
  ],
  content: '<p>Hello World!</p>'
});
```

### 2. OpenAI SDK

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

### 3. Model Context Protocol

```typescript
import { Client } from '@modelcontextprotocol/sdk';

const client = new Client({
  // 配置...
});
```

### 4. Better SQLite3

```typescript
import Database from 'better-sqlite3-multiple-ciphers';

const db = new Database('mydb.db', {
  // cipher: 'sqlcipher', // 可选加密
});

const stmt = db.prepare('SELECT * FROM users');
const users = stmt.all();
```

### 5. Monaco Editor (Vite 配置)

在 `electron.vite.config.ts` 中添加：

```typescript
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

export default defineConfig({
  renderer: {
    plugins: [monacoEditorPlugin()]
  }
});
```

---

## 📚 下一步建议

1. **继续安装其他依赖**：
   - Vue 状态管理：`pinia` + `pinia-plugin-persistedstate`
   - 网络请求：`axios`
   - 日期处理：`dayjs`
   - 工具函数：`lodash`

2. **配置开发环境**：
   - 设置 TypeScript 类型定义
   - 配置 Monaco Editor 语法高亮
   - 设置数据库迁移脚本

3. **创建基础组件**：
   - 富文本编辑器组件
   - 代码编辑器组件
   - AI 聊天界面组件

---

## ⚠️ 注意事项

1. **better-sqlite3-multiple-ciphers**：
   - 编译时出现 1 个警告（类型转换），但不影响使用
   - 需要确保 Python 环境可用（编译原生模块）

2. **Monaco Editor**：
   - 需要在 Vite 配置中添加插件才能正常使用
   - 打包时注意 Web Worker 配置

3. **Tiptap**：
   - 所有扩展版本保持一致（3.19.0）
   - 需要在 Vue 组件中正确初始化编辑器

4. **OpenAI SDK**：
   - 需要配置 API Key
   - 注意 API 调用频率限制

---

## 🎨 Vue 生态系统依赖（第二批）

安装时间：2026-02-04

### Vue 核心生态

| 包名                          | 版本      | 类型 | 说明                          |
| ----------------------------- | --------- | ---- | ----------------------------- |
| `vue-router`                  | `^5.0.2`  | 生产 | Vue 路由管理器                |
| `pinia`                       | `^3.0.4`  | 生产 | Vue 状态管理（Vuex 的继任者） |
| `pinia-plugin-persistedstate` | `^4.7.1`  | 生产 | Pinia 状态持久化插件          |
| `@pinia/colada`               | `^0.21.2` | 生产 | Pinia 数据获取和缓存库        |
| `@vueuse/core`                | `^14.2.0` | 生产 | Vue 组合式 API 工具集         |

### UI 组件库

| 包名                   | 版本           | 类型 | 说明                           |
| ---------------------- | -------------- | ---- | ------------------------------ |
| `@iconify/vue`         | `^5.0.0`       | 生产 | Iconify 通用图标库             |
| `vue-sonner`           | `^2.0.9`       | 生产 | Toast 通知组件                 |
| `vue-virtual-scroller` | `2.0.0-beta.8` | 生产 | 虚拟滚动组件（大列表性能优化） |
| `vuedraggable`         | `^2.24.3`      | 生产 | 拖拽排序组件                   |

### 使用示例

#### 1. Vue Router 配置

```typescript
// src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/Home.vue')
    }
  ]
});

export default router;
```

#### 2. Pinia 状态管理

```typescript
// src/stores/counter.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCounterStore = defineStore(
  'counter',
  () => {
    const count = ref(0);

    function increment() {
      count.value++;
    }

    return { count, increment };
  },
  {
    persist: true // 启用持久化
  }
);
```

#### 3. VueUse 工具集

```vue
<script setup lang="ts">
import { useMouse, useLocalStorage, useToggle } from '@vueuse/core';

const { x, y } = useMouse();
const [isDark, toggle] = useToggle();
const settings = useLocalStorage('settings', { theme: 'light' });
</script>
```

#### 4. 虚拟滚动

```vue
<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

const items = ref(Array.from({ length: 10000 }, (_, i) => ({ id: i })));
</script>

<template>
  <RecycleScroller :items="items" :item-size="50" key-field="id">
    <template #default="{ item }">
      <div>Item {{ item.id }}</div>
    </template>
  </RecycleScroller>
</template>
```

### 📊 第二批依赖统计

- **新增依赖**: 9 个
- **Vue 核心**: 5 个
- **UI 组件**: 4 个（不包括 radix-vue、reka-ui 和 lucide-vue-next）

---

## 📊 总依赖统计

- **生产依赖**: 29 个
- **开发依赖**: 10 个
- **总计**: 39 个

---

---

## 🎨 样式框架依赖（第三批）

安装时间：2026-02-04

### Tailwind CSS 4.x

| 包名                      | 版本       | 类型 | 说明                                  |
| ------------------------- | ---------- | ---- | ------------------------------------- |
| `tailwindcss`             | `^4.1.18`  | 开发 | Tailwind CSS 4.x 核心框架             |
| `@tailwindcss/vite`       | `^4.1.18`  | 开发 | Tailwind Vite 插件（Tailwind 4 专用） |
| `@tailwindcss/typography` | `^0.5.19`  | 开发 | 排版插件（美化文章样式）              |
| `sass`                    | `^1.97.3`  | 开发 | Sass/SCSS 预处理器                    |
| `autoprefixer`            | `^10.4.24` | 开发 | CSS 自动添加浏览器前缀                |

### 配置文件

已创建和配置的文件：

- ✅ `src/renderer/src/assets/tailwind.css` - Tailwind 主配置
- ✅ `electron.vite.config.ts` - 已添加 Tailwind Vite 插件
- ✅ `src/renderer/src/main.ts` - 已导入 Tailwind CSS
- 📖 `docs/tailwind-setup.md` - 详细配置指南

### Tailwind CSS 4 新特性

1. **原生 CSS 引擎** - 不再需要 PostCSS，性能提升 5-10 倍
2. **@theme 指令** - 使用 CSS 变量自定义主题
3. **@plugin 指令** - 直接在 CSS 中引入插件
4. **无需 config 文件** - 配置全部在 CSS 中完成

### 使用示例

```vue
<template>
  <div class="p-4 bg-white dark:bg-gray-900">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-white">标题</h1>
    <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">按钮</button>
  </div>
</template>
```

### 📊 第三批依赖统计

- **新增依赖**: 5 个（全部为开发依赖）
- **样式框架**: Tailwind CSS 4.x 完整套件

---

## 🎨 图标库依赖（第四批）

安装时间：2026-02-04

### Iconify 图标系统

| 包名                         | 版本     | 类型 | 说明                                       |
| ---------------------------- | -------- | ---- | ------------------------------------------ |
| `@egoist/tailwindcss-icons`  | `^1.9.2` | 开发 | Tailwind CSS 图标插件                      |
| `@iconify-json/mdi`          | `^1.2.3` | 开发 | Material Design Icons 图标集（5000+ 图标） |
| `@iconify-json/svg-spinners` | `^1.2.4` | 开发 | SVG 加载动画图标集                         |

### 两种使用方式

#### 1. 使用 `@iconify/vue` 组件（推荐）

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue';
</script>

<template>
  <Icon icon="mdi:home" class="w-6 h-6" />
  <Icon icon="mdi:settings" color="blue" />
  <Icon icon="svg-spinners:ring-resize" class="w-8 h-8" />
</template>
```

#### 2. 使用 Tailwind 类名

```vue
<template>
  <i class="i-mdi-home"></i>
  <i class="i-mdi-settings text-xl text-blue-500"></i>
</template>
```

### 配置更新

- ✅ 已在 `tailwind.css` 中添加 `@egoist/tailwindcss-icons` 插件
- 📖 `docs/icons-guide.md` - 详细的图标使用指南

### 📊 第四批依赖统计

- **新增依赖**: 3 个（全部为开发依赖）
- **图标数量**: 5000+ Material Design Icons + 多个加载动画

---

---

## 🔧 工具库依赖（第五批）

安装时间：2026-02-04

### 网络请求

| 包名    | 版本      | 类型 | 说明          |
| ------- | --------- | ---- | ------------- |
| `axios` | `^1.13.4` | 生产 | HTTP 客户端库 |

### 工具函数

| 包名          | 版本       | 类型 | 说明                  |
| ------------- | ---------- | ---- | --------------------- |
| `lodash`      | `^4.17.23` | 生产 | JavaScript 工具函数库 |
| `dayjs`       | `^1.11.19` | 生产 | 轻量级日期处理库      |
| `diff`        | `^8.0.3`   | 生产 | 文本差异对比          |
| `nanoid`      | `^5.1.6`   | 生产 | 唯一 ID 生成器        |
| `gray-matter` | `^4.0.3`   | 生产 | Front Matter 解析     |
| `jsonrepair`  | `^3.13.2`  | 生产 | JSON 修复工具         |
| `zod`         | `^4.3.6`   | 生产 | Schema 验证库         |
| `tokenx`      | `^1.3.0`   | 生产 | Token 计数工具        |

### 文件系统

| 包名        | 版本      | 类型 | 说明                     |
| ----------- | --------- | ---- | ------------------------ |
| `fs-ext`    | `^2.1.1`  | 生产 | 文件系统扩展（原生模块） |
| `mkdirp`    | `^3.0.1`  | 生产 | 递归创建目录             |
| `glob`      | `^13.0.1` | 生产 | 文件匹配模式             |
| `minimatch` | `^10.1.2` | 生产 | 最小文件匹配             |
| `fflate`    | `^0.8.2`  | 生产 | 快速压缩/解压            |
| `chokidar`  | `^5.0.0`  | 生产 | 文件监听库               |

### 事件 & 进程

| 包名          | 版本     | 类型 | 说明             |
| ------------- | -------- | ---- | ---------------- |
| `events`      | `^3.3.0` | 生产 | Node.js 事件模块 |
| `mitt`        | `^3.0.1` | 生产 | 轻量级事件发射器 |
| `cross-spawn` | `^7.0.6` | 生产 | 跨平台进程创建   |

### 定时任务

| 包名        | 版本     | 类型 | 说明          |
| ----------- | -------- | ---- | ------------- |
| `node-cron` | `^4.2.1` | 生产 | Cron 定时任务 |

### 后端服务 (Koa)

| 包名             | 版本      | 类型 | 说明         |
| ---------------- | --------- | ---- | ------------ |
| `koa`            | `^3.1.1`  | 生产 | Koa 框架     |
| `@koa/router`    | `^15.3.0` | 生产 | Koa 路由     |
| `@koa/cors`      | `^5.0.0`  | 生产 | CORS 中间件  |
| `koa-bodyparser` | `^4.4.1`  | 生产 | Body 解析器  |
| `koa-static`     | `^5.0.0`  | 生产 | 静态文件服务 |

### 配置更新

- ✅ 已在 pnpm 配置中添加 `fs-ext` 构建权限
- ✅ `fs-ext` 原生模块已成功编译
- 📖 `docs/utilities-guide.md` - 详细的工具库使用指南

### 📊 第五批依赖统计

- **新增依赖**: 24 个（全部为生产依赖）
- **原生模块**: 1 个（fs-ext）

---

---

## ⚡ Electron 插件依赖（第六批）

安装时间：2026-02-04

### Electron 核心插件

| 包名                          | 版本      | 类型 | 说明                   |
| ----------------------------- | --------- | ---- | ---------------------- |
| `electron-log`                | `^5.4.3`  | 生产 | 日志系统               |
| `electron-store`              | `^11.0.2` | 生产 | 持久化存储（支持加密） |
| `electron-window-state`       | `^5.0.3`  | 生产 | 窗口状态管理           |
| `electron-devtools-installer` | `^4.0.0`  | 开发 | DevTools 扩展安装器    |
| `@electron/notarize`          | `^3.1.1`  | 开发 | macOS 公证工具         |

### 功能说明

#### electron-log

- 多级别日志（error, warn, info, debug）
- 自动保存到文件
- 支持控制台和文件输出
- 捕获未处理的异常

#### electron-store

- 简单的键值存储
- 支持 Schema 和默认值
- 支持加密存储
- 监听数据变化

#### electron-window-state

- 自动保存窗口位置和大小
- 支持最大化/全屏状态
- 多窗口独立管理

#### electron-devtools-installer

- 开发环境安装浏览器扩展
- 支持 Vue DevTools, React DevTools 等
- 自动下载和安装

#### @electron/notarize

- macOS 应用公证
- 集成到 electron-builder 构建流程

### 配置文件

已创建配置指南：

- 📖 `docs/electron-plugins-guide.md` - 详细使用指南和完整示例

### 📊 第六批依赖统计

- **新增依赖**: 5 个
- **生产依赖**: 3 个
- **开发依赖**: 2 个

---

## 📊 总依赖统计

- **生产依赖**: 58 个
- **开发依赖**: 20 个
- **总计**: 78 个
- **原生模块**: 2 个（better-sqlite3-multiple-ciphers, fs-ext）

---

---

## ⚙️ 配置优化（完成）

基于 CataxBot 项目的最佳实践，已完成以下配置优化：

### Electron Vite 配置

- ✅ Main 进程优化（外部化依赖、路径别名、原生模块处理）
- ✅ Preload 进程优化（外部化依赖、共享代码别名）
- ✅ Renderer 进程优化（依赖预优化、Monaco 配置、CSS 优化）

### TypeScript 配置

- ✅ 路径别名支持（`@`, `@renderer`, `@shared`）
- ✅ 共享代码类型支持

### 项目结构

- ✅ 创建 `src/shared` 目录（共享类型和常量）
- ✅ 添加共享类型定义（User, AppSettings, WindowBounds）
- ✅ 添加共享常量（APP_NAME, IPC_CHANNELS 等）

### 配置文档

- 📖 `docs/vite-config-guide.md` - Vite 配置详细指南
- 📖 `docs/config-improvements.md` - 配置改进总结

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ 所有依赖安装成功，配置已优化完成  
**注意**:

- 未安装国际化（vue-i18n）
- 未安装无样式组件库（radix-vue, reka-ui）
- 未安装 Lucide 图标库（lucide-vue-next），使用 @iconify/vue + Material Design Icons 代替
- ✅ 已配置 Tailwind CSS 4.x（详见 docs/tailwind-setup.md）
- ✅ 已配置 Iconify 图标系统（详见 docs/icons-guide.md）
- ✅ 已配置工具库（详见 docs/utilities-guide.md）
- ✅ 已配置 Electron 插件（详见 docs/electron-plugins-guide.md）
- ✅ 已优化 Electron Vite 配置（详见 docs/vite-config-guide.md）
