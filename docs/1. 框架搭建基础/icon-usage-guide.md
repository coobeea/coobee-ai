# 图标使用指南

## 概述

项目同时支持 **三种图标使用方式**，覆盖不同的使用场景：

1. **unplugin-icons** - 图标作为 Vue 组件
2. **@egoist/tailwindcss-icons** - 图标作为 Tailwind CSS 类

支持 200+ 图标集，超过 200,000 个图标，完全离线打包。

## 为什么支持多种方式？

### unplugin-icons 的优势

1. ✅ **组件化**：图标作为 Vue 组件，符合框架思想
2. ✅ **类型安全**：完整的 TypeScript 支持和 IDE 提示
3. ✅ **事件绑定**：可以直接绑定 Vue 事件（@click、@hover 等）
4. ✅ **动画控制**：支持 Vue 动画和过渡

### @egoist/tailwindcss-icons 的优势

1. ✅ **动态图标**：支持动态拼接图标名称
2. ✅ **简洁语法**：使用 CSS 类，代码更简洁
3. ✅ **统一风格**：与 Tailwind CSS 工具类一致
4. ✅ **性能优秀**：CSS 方式，渲染性能好

## 三种使用方式

### 方式 1：手动导入（推荐常用图标）

```vue
<script setup lang="ts">
// 导入格式：~icons/{图标集名称}/{图标名称}
import IconMdiHome from '~icons/mdi/home'
import IconMdiAccount from '~icons/mdi/account'
</script>

<template>
  <IconMdiHome class="text-2xl text-blue-600" />
  <IconMdiAccount class="text-xl" />
</template>
```

**优点**：

- 明确的依赖关系
- 更好的代码提示
- 适合常用图标

### 方式 2：自动导入（推荐偶尔使用的图标）

无需导入，直接在模板中使用：

```vue
<template>
  <!-- 格式：icon-{图标集}-{图标名称} -->
  <icon-mdi-fire class="text-red-600" />
  <icon-mdi-weather-sunny class="text-yellow-600" />
  <icon-svg-spinners-pulse class="animate-spin" />
</template>
```

**优点**：

- 无需 import 语句
- 代码更简洁
- 适合偶尔使用的图标

### 方式 3：Tailwind CSS 类（推荐动态图标场景）

使用 `@egoist/tailwindcss-icons` 插件，将图标作为 CSS 类使用：

```vue
<template>
  <!-- 格式：i-{图标集}-{图标名称} -->
  <span class="i-mdi-home text-2xl text-blue-600"></span>
  <span class="i-carbon-settings text-xl text-gray-600"></span>
  <span class="i-heroicons-star-solid text-xl text-yellow-600"></span>

  <!-- 支持动态拼接 -->
  <span :class="`i-mdi-${iconName} text-2xl`"></span>
</template>

<script setup>
const iconName = ref('home') // 可以动态改变
</script>
```

**优点**：

- ✅ 支持动态拼接图标名称
- ✅ 语法简洁，与 Tailwind 风格一致
- ✅ 适合需要动态切换图标的场景
- ✅ CSS 方式，渲染性能好
- ✅ 颜色自动跟随文本颜色

**注意事项**：

- 图标集和图标名用单个短横线 `-` 连接
- 图标名中的短横线保持不变，如 `i-mdi-account-box`
- 颜色通过 `text-*` 类控制

## 使用场景建议

根据不同场景选择合适的方式：

| 场景                         | 推荐方式             | 原因                             |
| ---------------------------- | -------------------- | -------------------------------- |
| 常用图标（如导航栏、工具栏） | 方式 1：手动导入     | 类型安全、IDE 提示好、可绑定事件 |
| 偶尔使用的图标               | 方式 2：自动导入     | 无需 import，代码简洁            |
| 需要动态切换的图标           | 方式 3：Tailwind CSS | 支持动态拼接，最灵活             |
| 大量展示性图标（如图标库）   | 方式 3：Tailwind CSS | CSS 渲染，性能好                 |
| 需要复杂交互的图标           | 方式 1：手动导入     | 可绑定事件、使用 Vue 动画        |

### 混合使用示例

```vue
<template>
  <div>
    <!-- 常用导航图标：手动导入 -->
    <IconMdiHome @click="goHome" class="cursor-pointer" />

    <!-- 偶尔使用的图标：自动导入 -->
    <icon-mdi-settings />

    <!-- 动态图标：Tailwind CSS -->
    <span :class="`i-[mdi--${statusIcon}]`"></span>

    <!-- 图标列表：Tailwind CSS -->
    <div v-for="icon in iconList" :key="icon">
      <span :class="`i-[mdi--${icon}]`"></span>
    </div>
  </div>
</template>
```

## 图标命名规则

### 1. 图标集名称（使用短横线连接）

- `mdi` → Material Design Icons
- `svg-spinners` → SVG Spinners
- `carbon` → Carbon Icons
- `heroicons` → Heroicons

### 2. 图标名称转换规则

#### unplugin-icons（组件方式）

- 原始名称中的 `:` 转换为 `/`
- 组件名使用 PascalCase（大写驼峰）
- 前缀 `Icon` + 图标集名 + 图标名

#### @egoist/tailwindcss-icons（CSS 类方式）

- 原始名称中的 `:` 转换为 `-`
- 使用小写加短横线格式
- 前缀 `i-` + 图标集 + `-` + 图标名

**示例：**
| 图标 ID | 手动导入 | 自动导入 | CSS 类 |
|---------|----------|----------|---------|
| `mdi:home` | `IconMdiHome` | `<icon-mdi-home />` | `i-mdi-home` |
| `mdi:account-box` | `IconMdiAccountBox` | `<icon-mdi-account-box />` | `i-mdi-account-box` |
| `svg-spinners:3-dots-fade` | `IconSvgSpinners3DotsFade` | `<icon-svg-spinners-3-dots-fade />` | `i-svg-spinners-3-dots-fade` |
| `carbon:settings` | `IconCarbonSettings` | `<icon-carbon-settings />` | `i-carbon-settings` |

## 浏览可用图标

🔍 访问 [Icônes](https://icones.js.org/) 浏览所有可用图标

## 自定义图标样式

### 修改颜色

```vue
<template>
  <!-- 使用 Tailwind CSS -->
  <IconMdiHome class="text-blue-600" />

  <!-- 使用 CSS -->
  <IconMdiHome style="color: #3b82f6" />
</template>
```

### 修改大小

```vue
<template>
  <!-- Tailwind CSS -->
  <IconMdiHome class="text-xl" />
  <!-- 1.25rem -->
  <IconMdiHome class="text-2xl" />
  <!-- 1.5rem -->
  <IconMdiHome class="text-4xl" />
  <!-- 2.25rem -->

  <!-- 自定义尺寸 -->
  <IconMdiHome style="font-size: 32px" />
  <IconMdiHome class="w-8 h-8" />
</template>
```

### 添加动画

```vue
<template>
  <!-- Tailwind 动画 -->
  <IconSvgSpinners3DotsFade class="animate-pulse" />

  <!-- SVG Spinners 自带动画 -->
  <IconSvgSpinnersPulse />
</template>
```

## 常用图标集

### Material Design Icons (mdi)

最全面的图标集，超过 7000+ 图标

```vue
<IconMdiHome />
<IconMdiAccount />
<IconMdiSettings />
<IconMdiHeart />
<IconMdiStar />
```

### SVG Spinners (svg-spinners)

动画加载图标

```vue
<IconSvgSpinners3DotsFade />
<IconSvgSpinnersPulse />
<IconSvgSpinnersRingResize />
```

### Carbon Icons (carbon)

IBM 设计系统图标

```vue
<IconCarbonHome />
<IconCarbonUser />
<IconCarbonSettings />
```

### Heroicons (heroicons)

Tailwind CSS 官方图标

```vue
<IconHeroiconsHome />
<IconHeroiconsUser />
```

## 配置说明

### 1. electron.vite.config.ts（unplugin-icons）

```typescript
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  renderer: {
    plugins: [
      // 自动导入组件
      Components({
        resolvers: [
          IconsResolver({
            prefix: 'icon' // 自动导入的组件前缀
          })
        ]
      }),
      // 图标插件
      Icons({
        compiler: 'vue3',
        autoInstall: true // 自动安装缺失的图标集
      })
    ]
  }
})
```

### 2. tailwind.css（@egoist/tailwindcss-icons）

```css
@import 'tailwindcss';
@plugin "@egoist/tailwindcss-icons";
```

**说明：**

- 默认前缀为 `i`（类名格式：`i-{collection}-{icon}`）
- 默认缩放比例为 1（相对于当前字体大小）
- 自动从已安装的 `@iconify-json/*` 包加载图标

如需自定义配置，可以传递选项：

```css
@plugin "@egoist/tailwindcss-icons" {
  scale: 1.2;
}
```

### 已安装的图标集

项目已安装以下图标集：

- `@iconify-json/mdi` - Material Design Icons (7000+ 图标)
- `@iconify-json/svg-spinners` - SVG Spinners (动画图标)
- `@iconify-json/carbon` - Carbon Icons (IBM 设计系统)
- `@iconify-json/heroicons` - Heroicons (Tailwind 官方图标)

如需使用其他图标集，可以安装对应的包：

```bash
pnpm add -D @iconify-json/{collection-name}
```

或者在 `electron.vite.config.ts` 中启用 `autoInstall: true`，让插件自动安装。

## 性能优化

1. **手动导入常用图标**：对于频繁使用的图标，使用手动导入以获得更好的类型提示
2. **自动导入偶尔使用的图标**：减少 import 语句，代码更简洁
3. **按需加载**：只有实际使用的图标会被打包
4. **Tree Shaking**：未使用的图标不会被包含在最终包中

## 故障排除

### 图标不显示

1. 检查图标名称是否正确（访问 [Icônes](https://icones.js.org/) 确认）
2. 确认图标集已安装（`@iconify-json/{collection}`）
3. 检查是否启用了 `autoInstall: true`
4. 清除缓存：`pnpm clean` 或删除 `node_modules/.vite`

### TypeScript 类型错误

确保 `tsconfig.web.json` 中包含：

```json
{
  "compilerOptions": {
    "types": ["unplugin-icons/types/vue"]
  }
}
```

### 自动导入不工作

1. 检查 `unplugin-vue-components` 是否正确配置
2. 确认组件前缀是否正确（默认 `icon-`）
3. 重启开发服务器

## 参考资源

- [unplugin-icons 官方文档](https://github.com/unplugin/unplugin-icons)
- [Iconify 图标浏览器](https://icones.js.org/)
- [Iconify 官方网站](https://iconify.design/)
