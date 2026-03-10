# 图标使用指南

## 📦 已安装的图标库

| 包名                         | 版本     | 说明                              |
| ---------------------------- | -------- | --------------------------------- |
| `@iconify/vue`               | `^5.0.0` | Iconify Vue 3 组件（生产依赖）    |
| `@egoist/tailwindcss-icons`  | `^1.9.2` | Tailwind CSS 图标插件（开发依赖） |
| `@iconify-json/mdi`          | `^1.2.3` | Material Design Icons 图标集      |
| `@iconify-json/svg-spinners` | `^1.2.4` | SVG 加载动画图标集                |

---

## 🎨 两种使用方式

### 方式一：使用 `@iconify/vue` 组件（推荐）

这是最灵活的方式，适合需要动态控制图标属性的场景。

#### 基础使用

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue';
</script>

<template>
  <div>
    <!-- Material Design Icons -->
    <Icon icon="mdi:home" />
    <Icon icon="mdi:settings" />
    <Icon icon="mdi:account" />

    <!-- SVG Spinners -->
    <Icon icon="svg-spinners:ring-resize" />
    <Icon icon="svg-spinners:pulse-3" />
    <Icon icon="svg-spinners:blocks-shuffle-3" />
  </div>
</template>
```

#### 自定义样式

```vue
<template>
  <!-- 自定义大小 -->
  <Icon icon="mdi:home" :width="24" :height="24" />

  <!-- 自定义颜色 -->
  <Icon icon="mdi:heart" color="red" />
  <Icon icon="mdi:star" color="#fbbf24" />

  <!-- 使用 Tailwind 类名 -->
  <Icon icon="mdi:check" class="text-green-500 w-6 h-6" />

  <!-- 旋转和翻转 -->
  <Icon icon="mdi:arrow-right" :rotate="90" />
  <Icon icon="mdi:arrow-right" :flip="horizontal" />

  <!-- 内联样式 -->
  <Icon icon="mdi:account" :style="{ color: 'blue', fontSize: '32px' }" />
</template>
```

#### 响应式和交互

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { ref } from 'vue';

const isLiked = ref(false);
</script>

<template>
  <button @click="isLiked = !isLiked" class="p-2">
    <Icon
      :icon="isLiked ? 'mdi:heart' : 'mdi:heart-outline'"
      :class="isLiked ? 'text-red-500' : 'text-gray-400'"
      class="w-6 h-6 transition-colors" />
  </button>
</template>
```

---

### 方式二：使用 Tailwind CSS 类名

这种方式图标会被编译到 CSS 中，适合静态图标。

#### 基础使用

```vue
<template>
  <!-- Material Design Icons -->
  <i class="i-mdi-home"></i>
  <i class="i-mdi-settings"></i>
  <i class="i-mdi-account"></i>

  <!-- 自定义大小 -->
  <i class="i-mdi-home text-xl"></i>
  <i class="i-mdi-home text-2xl"></i>
  <i class="i-mdi-home w-8 h-8"></i>

  <!-- 自定义颜色 -->
  <i class="i-mdi-heart text-red-500"></i>
  <i class="i-mdi-star text-yellow-500"></i>
</template>
```

#### 按钮中使用

```vue
<template>
  <button class="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded">
    <i class="i-mdi-plus"></i>
    <span>添加</span>
  </button>

  <button class="p-2 hover:bg-gray-100 rounded">
    <i class="i-mdi-delete text-red-500"></i>
  </button>
</template>
```

---

## 🎯 常用图标示例

### Material Design Icons (mdi)

```vue
<template>
  <div class="flex gap-2">
    <!-- 导航图标 -->
    <Icon icon="mdi:home" />
    <Icon icon="mdi:menu" />
    <Icon icon="mdi:close" />
    <Icon icon="mdi:arrow-left" />
    <Icon icon="mdi:arrow-right" />

    <!-- 操作图标 -->
    <Icon icon="mdi:plus" />
    <Icon icon="mdi:minus" />
    <Icon icon="mdi:delete" />
    <Icon icon="mdi:edit" />
    <Icon icon="mdi:check" />

    <!-- 文件图标 -->
    <Icon icon="mdi:file" />
    <Icon icon="mdi:folder" />
    <Icon icon="mdi:download" />
    <Icon icon="mdi:upload" />
    <Icon icon="mdi:cloud" />

    <!-- 用户图标 -->
    <Icon icon="mdi:account" />
    <Icon icon="mdi:account-group" />
    <Icon icon="mdi:login" />
    <Icon icon="mdi:logout" />

    <!-- 设置图标 -->
    <Icon icon="mdi:settings" />
    <Icon icon="mdi:cog" />
    <Icon icon="mdi:wrench" />

    <!-- 社交图标 -->
    <Icon icon="mdi:heart" />
    <Icon icon="mdi:star" />
    <Icon icon="mdi:share" />
    <Icon icon="mdi:comment" />

    <!-- 通知图标 -->
    <Icon icon="mdi:bell" />
    <Icon icon="mdi:email" />
    <Icon icon="mdi:alert" />
    <Icon icon="mdi:information" />
  </div>
</template>
```

### SVG Spinners (加载动画)

```vue
<template>
  <div class="flex gap-4">
    <!-- 各种加载动画 -->
    <Icon icon="svg-spinners:ring-resize" class="w-8 h-8" />
    <Icon icon="svg-spinners:pulse-3" class="w-8 h-8" />
    <Icon icon="svg-spinners:blocks-shuffle-3" class="w-8 h-8" />
    <Icon icon="svg-spinners:90-ring-with-bg" class="w-8 h-8" />
    <Icon icon="svg-spinners:tadpole" class="w-8 h-8" />
    <Icon icon="svg-spinners:eclipse" class="w-8 h-8" />
  </div>
</template>
```

---

## 🔍 搜索和浏览图标

### 官方资源

- **Iconify 图标搜索**: https://icon-sets.iconify.design/
- **Material Design Icons**: https://pictogrammers.com/library/mdi/
- **SVG Spinners**: https://github.com/n3r4zzurr0/svg-spinners

### 在项目中查找图标

访问 [Iconify 官网](https://icon-sets.iconify.design/)，搜索你需要的图标：

1. 搜索图标名称（如 "home", "settings"）
2. 选择图标集（如 "Material Design Icons"）
3. 复制图标名称（如 `mdi:home`）
4. 在项目中使用

---

## 💡 实用组合示例

### 带图标的按钮

```vue
<template>
  <div class="flex gap-2">
    <!-- 主要按钮 -->
    <button class="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
      <Icon icon="mdi:plus" />
      <span>新建</span>
    </button>

    <!-- 次要按钮 -->
    <button class="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
      <Icon icon="mdi:download" />
      <span>下载</span>
    </button>

    <!-- 危险按钮 -->
    <button class="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
      <Icon icon="mdi:delete" />
      <span>删除</span>
    </button>

    <!-- 仅图标按钮 -->
    <button class="p-2 hover:bg-gray-100 rounded">
      <Icon icon="mdi:settings" class="w-5 h-5" />
    </button>
  </div>
</template>
```

### 输入框带图标

```vue
<template>
  <div class="relative">
    <Icon icon="mdi:magnify" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    <input type="text" placeholder="搜索..." class="pl-10 pr-4 py-2 border rounded w-full" />
  </div>
</template>
```

### 状态指示器

```vue
<template>
  <div class="flex gap-4">
    <!-- 成功 -->
    <div class="flex items-center gap-2 text-green-600">
      <Icon icon="mdi:check-circle" />
      <span>成功</span>
    </div>

    <!-- 错误 -->
    <div class="flex items-center gap-2 text-red-600">
      <Icon icon="mdi:alert-circle" />
      <span>错误</span>
    </div>

    <!-- 警告 -->
    <div class="flex items-center gap-2 text-yellow-600">
      <Icon icon="mdi:alert" />
      <span>警告</span>
    </div>

    <!-- 信息 -->
    <div class="flex items-center gap-2 text-blue-600">
      <Icon icon="mdi:information" />
      <span>信息</span>
    </div>
  </div>
</template>
```

### 加载状态

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { ref } from 'vue';

const isLoading = ref(false);

async function handleSubmit() {
  isLoading.value = true;
  // 模拟异步操作
  await new Promise((resolve) => setTimeout(resolve, 2000));
  isLoading.value = false;
}
</script>

<template>
  <button
    @click="handleSubmit"
    :disabled="isLoading"
    class="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50">
    <Icon :icon="isLoading ? 'svg-spinners:ring-resize' : 'mdi:send'" class="w-5 h-5" />
    <span>{{ isLoading ? '发送中...' : '发送' }}</span>
  </button>
</template>
```

### 列表项

```vue
<template>
  <ul class="space-y-2">
    <li class="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
      <Icon icon="mdi:file-document" class="text-blue-500 w-5 h-5" />
      <span class="flex-1">文档.docx</span>
      <Icon icon="mdi:download" class="text-gray-400 w-5 h-5" />
    </li>

    <li class="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
      <Icon icon="mdi:file-image" class="text-green-500 w-5 h-5" />
      <span class="flex-1">图片.png</span>
      <Icon icon="mdi:download" class="text-gray-400 w-5 h-5" />
    </li>

    <li class="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
      <Icon icon="mdi:file-pdf-box" class="text-red-500 w-5 h-5" />
      <span class="flex-1">报告.pdf</span>
      <Icon icon="mdi:download" class="text-gray-400 w-5 h-5" />
    </li>
  </ul>
</template>
```

---

## 🎨 样式技巧

### 响应式大小

```vue
<template>
  <!-- 使用 Tailwind 响应式类 -->
  <Icon icon="mdi:home" class="w-4 h-4 md:w-6 md:h-6 lg:w-8 lg:h-8" />
</template>
```

### 动画效果

```vue
<template>
  <!-- 悬停旋转 -->
  <Icon icon="mdi:settings" class="w-6 h-6 transition-transform hover:rotate-90" />

  <!-- 悬停缩放 -->
  <Icon icon="mdi:heart" class="w-6 h-6 transition-transform hover:scale-125" />

  <!-- 脉冲动画 -->
  <Icon icon="mdi:bell" class="w-6 h-6 animate-pulse" />
</template>
```

### 渐变颜色

```vue
<template>
  <Icon
    icon="mdi:heart"
    class="w-8 h-8"
    style="background: linear-gradient(to right, #ff6b6b, #ee5a6f); -webkit-background-clip: text; -webkit-text-fill-color: transparent;" />
</template>
```

---

## 📝 最佳实践

### 1. 性能优化

- ✅ 优先使用 `@iconify/vue` 组件（按需加载）
- ✅ Tailwind 类名方式适合大量重复使用的图标
- ✅ 避免在循环中导入大量不同的图标

### 2. 一致性

```vue
<script setup lang="ts">
// 在文件顶部统一定义图标大小
const ICON_SIZES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8'
};
</script>

<template>
  <Icon icon="mdi:home" :class="ICON_SIZES.md" />
</template>
```

### 3. 语义化

```vue
<template>
  <!-- 好的做法：语义化的图标使用 -->
  <button aria-label="关闭">
    <Icon icon="mdi:close" />
  </button>

  <!-- 更好的做法：结合文字说明 -->
  <button class="flex items-center gap-2">
    <Icon icon="mdi:plus" />
    <span>添加</span>
  </button>
</template>
```

---

## 🔧 TypeScript 支持

```typescript
// 创建一个图标组件的类型
import type { IconifyIcon } from '@iconify/vue';

interface IconButtonProps {
  icon: string;
  label: string;
  onClick?: () => void;
}

// 使用
const props = defineProps<IconButtonProps>();
```

---

## 📚 参考资源

- [Iconify 官方文档](https://iconify.design/)
- [Iconify Vue 组件](https://iconify.design/docs/icon-components/vue/)
- [Tailwind CSS Icons 插件](https://github.com/egoist/tailwindcss-icons)
- [Material Design Icons](https://pictogrammers.com/library/mdi/)
- [SVG Spinners](https://github.com/n3r4zzurr0/svg-spinners)

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ 图标系统配置完成
