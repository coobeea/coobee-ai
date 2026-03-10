# Tailwind CSS 4 配置指南

## 📦 已安装的包

| 包名                      | 版本       | 说明                                  |
| ------------------------- | ---------- | ------------------------------------- |
| `tailwindcss`             | `^4.1.18`  | Tailwind CSS 4.x 核心                 |
| `@tailwindcss/vite`       | `^4.1.18`  | Tailwind Vite 插件（用于 Tailwind 4） |
| `@tailwindcss/typography` | `^0.5.19`  | 排版插件（美化文章、文档样式）        |
| `sass`                    | `^1.97.3`  | Sass/SCSS 预处理器                    |
| `autoprefixer`            | `^10.4.24` | CSS 自动添加浏览器前缀                |

---

## 🎯 Tailwind CSS 4 的新特性

Tailwind CSS 4 是一个重大更新，主要变化：

1. **原生 CSS 引擎** - 使用原生 CSS 特性，不再需要 PostCSS
2. **更快的构建速度** - 性能提升 5-10 倍
3. **@theme 指令** - 使用 CSS 变量自定义主题
4. **@plugin 指令** - 直接在 CSS 中引入插件
5. **不需要 tailwind.config.js** - 配置全部在 CSS 文件中

---

## 📁 项目结构

```
src/renderer/src/
├── assets/
│   ├── tailwind.css      # Tailwind 主配置文件 ✅ 已创建
│   ├── main.css          # 自定义全局样式
│   └── base.css          # 基础样式
├── main.ts               # 入口文件 ✅ 已配置
└── App.vue

electron.vite.config.ts   # Vite 配置 ✅ 已配置
```

---

## ⚙️ 配置文件

### 1. Tailwind CSS 配置 (`src/renderer/src/assets/tailwind.css`)

```css
@import 'tailwindcss';
@plugin "@tailwindcss/typography";

/* 自定义主题配置 */
@theme {
  /* 自定义颜色 */
  --color-primary: #3b82f6;
  --color-secondary: #8b5cf6;

  /* 自定义字体 */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
}

/* 基础样式 */
body {
  @apply font-sans antialiased;
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  @apply w-2 h-2;
}

::-webkit-scrollbar-track {
  @apply bg-gray-100 dark:bg-gray-800;
}

::-webkit-scrollbar-thumb {
  @apply bg-gray-300 dark:bg-gray-600 rounded-full;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-gray-400 dark:bg-gray-500;
}
```

### 2. Vite 配置 (`electron.vite.config.ts`)

```typescript
import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
});
```

### 3. 主入口文件 (`src/renderer/src/main.ts`)

```typescript
import './assets/tailwind.css'; // ✅ 已添加
import './assets/main.css';
// ... 其他导入
```

---

## 🎨 使用示例

### 基础样式

```vue
<template>
  <div class="p-4 bg-white dark:bg-gray-900">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-white">标题</h1>
    <p class="mt-2 text-gray-600 dark:text-gray-400">描述文字</p>
  </div>
</template>
```

### 使用自定义颜色

```vue
<template>
  <button class="bg-[var(--color-primary)] text-white px-4 py-2 rounded">主要按钮</button>
  <button class="bg-[var(--color-secondary)] text-white px-4 py-2 rounded">次要按钮</button>
</template>
```

### 响应式设计

```vue
<template>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    <div class="p-4 bg-white rounded shadow">卡片 1</div>
    <div class="p-4 bg-white rounded shadow">卡片 2</div>
    <div class="p-4 bg-white rounded shadow">卡片 3</div>
  </div>
</template>
```

### Typography 插件使用

```vue
<template>
  <article class="prose dark:prose-invert max-w-none">
    <h1>文章标题</h1>
    <p>这是一段文字，Typography 插件会自动美化排版。</p>
    <ul>
      <li>列表项 1</li>
      <li>列表项 2</li>
    </ul>
  </article>
</template>
```

---

## 🌓 暗色模式

Tailwind CSS 4 内置暗色模式支持，使用 `dark:` 前缀：

```vue
<template>
  <div class="bg-white dark:bg-gray-900 text-black dark:text-white">内容会根据系统主题自动切换</div>
</template>
```

如果需要手动控制暗色模式，可以使用 VueUse：

```vue
<script setup lang="ts">
import { useDark, useToggle } from '@vueuse/core';

const isDark = useDark();
const toggleDark = useToggle(isDark);
</script>

<template>
  <button @click="toggleDark()">切换主题</button>
</template>
```

---

## 📝 扩展主题

在 `tailwind.css` 中添加更多自定义：

```css
@theme {
  /* 自定义颜色 */
  --color-primary: #3b82f6;
  --color-secondary: #8b5cf6;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  /* 自定义间距 */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;

  /* 自定义圆角 */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 1rem;
  --radius-full: 9999px;

  /* 自定义字体大小 */
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;
}
```

---

## 🔧 使用 Sass/SCSS

项目已安装 Sass，可以使用 `.scss` 文件：

```scss
// styles.scss
$primary-color: #3b82f6;

.custom-button {
  @apply px-4 py-2 rounded;
  background-color: $primary-color;

  &:hover {
    @apply shadow-lg;
  }
}
```

---

## 📚 常用工具类

### 布局

- `flex`, `grid` - Flexbox / Grid 布局
- `container` - 居中容器
- `space-x-4`, `space-y-4` - 子元素间距

### 间距

- `p-4`, `px-4`, `py-4` - 内边距
- `m-4`, `mx-4`, `my-4` - 外边距

### 文字

- `text-sm`, `text-base`, `text-lg` - 字体大小
- `font-bold`, `font-semibold` - 字体粗细
- `text-center`, `text-left` - 文字对齐

### 颜色

- `bg-blue-500`, `text-blue-500` - 背景/文字颜色
- `border-blue-500` - 边框颜色

### 交互

- `hover:bg-blue-600` - 鼠标悬停
- `focus:ring-2` - 焦点状态
- `active:scale-95` - 点击状态

---

## 🚀 性能优化

Tailwind CSS 4 自动优化，无需额外配置：

1. ✅ **自动 Tree-shaking** - 只打包使用到的样式
2. ✅ **原生 CSS** - 无需 PostCSS，构建更快
3. ✅ **智能缓存** - 增量构建，开发体验更好

---

## 📖 参考资源

- [Tailwind CSS 4 官方文档](https://tailwindcss.com/docs)
- [Tailwind CSS 4 升级指南](https://tailwindcss.com/docs/upgrade-guide)
- [Typography 插件](https://tailwindcss.com/docs/typography-plugin)
- [Tailwind Vite 插件](https://github.com/tailwindlabs/tailwindcss-vite)

---

**配置完成时间**: 2026-02-04  
**状态**: ✅ Tailwind CSS 4 已完全配置
