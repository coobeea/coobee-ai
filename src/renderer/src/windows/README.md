# Windows 窗口目录

**Windows** 目录统一管理所有窗口界面的代码，与主模块代码清晰分离。

## 📂 目录结构

```
src/renderer/src/windows/
├── README.md            # 本文档
├── shell/               # Shell 窗口（AI 对话）
│   ├── main.ts
│   ├── ShellApp.vue
│   ├── types.ts
│   ├── components/
│   └── composables/
└── browser/             # Browser 窗口
    ├── main.ts
    ├── BrowserApp.vue
    └── components/
```

## 🎯 设计目标

### 清晰的代码组织

- ✅ **主模块代码**：放在 `src/renderer/src/` 下（如 `App.vue`、`main.ts`、`components/`、`assets/` 等）
- ✅ **窗口界面代码**：统一放在 `src/renderer/src/windows/` 下
- ✅ **共享代码**：放在 `src/renderer/src/shared/` 下

### 优势

1. **职责清晰**：一眼就能看出哪些是窗口界面，哪些是主模块代码
2. **易于维护**：添加新窗口时，直接在 `windows/` 下创建新目录即可
3. **避免混淆**：不会把窗口代码和主模块代码混在一起

## 📝 添加新窗口

### 1. 创建窗口目录

```bash
mkdir -p src/renderer/src/windows/新窗口名
```

### 2. 创建必要文件

```
src/renderer/src/windows/新窗口名/
├── main.ts              # 窗口入口
├── NewWindowApp.vue     # 窗口根组件
├── types.ts             # 类型定义
├── components/          # 专用组件
└── composables/         # 专用逻辑（可选）
```

### 3. 创建 HTML 入口

```html
<!-- src/renderer/新窗口名.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>新窗口</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/windows/新窗口名/main.ts"></script>
  </body>
</html>
```

### 4. 更新 Vite 配置

```typescript
// electron.vite.config.ts
build: {
  rollupOptions: {
    input: {
      index: resolve('src/renderer/index.html'),
      shell: resolve('src/renderer/shell.html'),
      browser: resolve('src/renderer/browser.html'),
      新窗口名: resolve('src/renderer/新窗口名.html')
    }
  }
}
```

### 5. 更新 WindowManager

在 `src/main/common/window/WindowManager.ts` 的 `loadWindowContent` 方法中添加新窗口类型的加载逻辑。

## 🔧 窗口模板

### main.ts（入口文件）

```typescript
import '@/assets/tailwind.css';
import '@/assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import NewWindowApp from './NewWindowApp.vue';

const app = createApp(NewWindowApp);
const pinia = createPinia();

app.use(pinia);
app.mount('#app');
```

### NewWindowApp.vue（根组件）

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { SomeType } from './types';

// 窗口逻辑
</script>

<template>
  <div class="flex h-screen flex-col">
    <!-- 窗口内容 -->
  </div>
</template>
```

### types.ts（类型定义）

```typescript
/**
 * 新窗口类型定义
 */

export interface SomeType {
  id: string;
  name: string;
}
```

## 📚 现有窗口

### Shell 窗口

- **路径**：`src/windows/shell/`
- **用途**：AI 对话窗口
- **HTML**：`shell.html`
- **类型**：`agent`

### Browser 窗口

- **路径**：`src/windows/browser/`
- **用途**：浏览器窗口
- **HTML**：`browser.html`
- **类型**：`browser`

## ⚠️ 注意事项

1. **独立性**：每个窗口的代码应该保持独立，避免直接依赖其他窗口
2. **共享代码**：需要跨窗口共享的代码，应该放在 `src/shared/` 下
3. **命名规范**：窗口目录名使用小写，组件名使用 PascalCase
4. **HTML 路径**：HTML 文件中的 script 路径应该指向 `/src/windows/{窗口名}/main.ts`
