# 图标使用快速参考

## 🚀 三种使用方式速查

### 方式 1️⃣：手动导入（推荐：常用图标）

```vue
<script setup lang="ts">
import IconMdiHome from '~icons/mdi/home'
import IconMdiAccount from '~icons/mdi/account'
</script>

<template>
  <IconMdiHome class="text-2xl text-blue-600" @click="handleClick" />
  <IconMdiAccount class="text-xl" />
</template>
```

**何时使用：**
- ✅ 常用图标（导航栏、工具栏）
- ✅ 需要绑定事件的图标
- ✅ 需要类型提示的场景

---

### 方式 2️⃣：自动导入（推荐：偶尔使用）

```vue
<template>
  <!-- 无需 import，直接使用 -->
  <icon-mdi-fire class="text-red-600" />
  <icon-mdi-weather-sunny class="text-yellow-600" />
  <icon-carbon-settings class="text-gray-600" />
</template>
```

**何时使用：**
- ✅ 偶尔使用的图标
- ✅ 想让代码更简洁
- ✅ 不需要频繁引用的图标

---

### 方式 3️⃣：Tailwind CSS（推荐：动态图标）

```vue
<template>
  <!-- 格式：i-{图标集}-{图标名} -->
  <span class="i-mdi-home text-2xl text-blue-600"></span>
  <span class="i-carbon-settings text-xl text-gray-600"></span>
  
  <!-- 动态拼接 -->
  <span :class="`i-mdi-${iconName} text-2xl`"></span>
</template>
```

**何时使用：**
- ✅ 需要动态切换图标
- ✅ 循环渲染大量图标
- ✅ 图标名称从数据生成
- ✅ 纯展示性图标（不需要交互）

---

## 📋 图标命名转换表

### unplugin-icons（组件方式）

| 图标 ID | 导入路径 | 组件名 | 自动导入 |
|---------|----------|--------|----------|
| `mdi:home` | `~icons/mdi/home` | `IconMdiHome` | `<icon-mdi-home />` |
| `mdi:account-box` | `~icons/mdi/account-box` | `IconMdiAccountBox` | `<icon-mdi-account-box />` |
| `carbon:settings` | `~icons/carbon/settings` | `IconCarbonSettings` | `<icon-carbon-settings />` |
| `svg-spinners:3-dots-fade` | `~icons/svg-spinners/3-dots-fade` | `IconSvgSpinners3DotsFade` | `<icon-svg-spinners-3-dots-fade />` |

### @egoist/tailwindcss-icons（CSS 类方式）

| 图标 ID | CSS 类名 |
|---------|---------|
| `mdi:home` | `i-mdi-home` |
| `mdi:account-box` | `i-mdi-account-box` |
| `carbon:settings` | `i-carbon-settings` |
| `svg-spinners:pulse` | `i-svg-spinners-pulse` |

**转换规则：**
- 格式：`i-{图标集}-{图标名}`
- 图标集和图标名用单个短横线 `-` 连接
- 短横线保持不变
- 冒号 `:` 替换为 `-`

---

## 🎨 样式控制

### 修改颜色

```vue
<!-- 方式 1 & 2：组件方式 -->
<IconMdiHome class="text-blue-600" />
<icon-mdi-home class="text-red-600" />

<!-- 方式 3：CSS 类方式（单色图标） -->
<span class="iconify mdi--home text-blue-600"></span>

<!-- 彩色图标保留原色 -->
<span class="iconify-color vscode-icons--file-type-vue"></span>
```

### 修改大小

```vue
<!-- Tailwind 文本大小类 -->
<IconMdiHome class="text-xl" />    <!-- 1.25rem -->
<IconMdiHome class="text-2xl" />   <!-- 1.5rem -->
<IconMdiHome class="text-4xl" />   <!-- 2.25rem -->

<!-- 自定义尺寸 -->
<IconMdiHome style="font-size: 32px" />
<IconMdiHome class="w-8 h-8" />

<!-- CSS 类方式相同 -->
<span class="i-[mdi--home] text-2xl"></span>
```

### 旋转和翻转

```vue
<!-- Tailwind 变换类 -->
<IconMdiHome class="rotate-45" />
<IconMdiHome class="scale-x-[-1]" />  <!-- 水平翻转 -->

<span class="i-[mdi--home] rotate-90"></span>
```

---

## 🔄 动态图标示例

### 根据状态切换图标

```vue
<script setup>
const isLiked = ref(false)
</script>

<template>
  <!-- 方式 1：组件方式 -->
  <component 
    :is="isLiked ? IconMdiHeart : IconMdiHeartOutline"
    @click="isLiked = !isLiked"
  />
  
  <!-- 方式 3：CSS 类方式（更简洁） -->
  <span 
    :class="`i-mdi-heart${isLiked ? '' : '-outline'} cursor-pointer`"
    @click="isLiked = !isLiked"
  ></span>
</template>
```

### 循环渲染图标列表

```vue
<script setup>
const features = [
  { icon: 'rocket', title: '快速', color: 'text-blue-600' },
  { icon: 'shield', title: '安全', color: 'text-green-600' },
  { icon: 'lightning-bolt', title: '高效', color: 'text-yellow-600' }
]
</script>

<template>
  <!-- 方式 3：最适合这种场景 -->
  <div v-for="item in features" :key="item.icon">
    <span :class="`i-mdi-${item.icon} text-2xl ${item.color}`"></span>
    <p>{{ item.title }}</p>
  </div>
</template>
```

---

## 📦 已安装图标集

| 图标集 | 前缀 | 数量 | 特点 |
|--------|------|------|------|
| Material Design Icons | `mdi` | 7000+ | 最全面的图标集 |
| Carbon Icons | `carbon` | 2000+ | IBM 设计系统 |
| Heroicons | `heroicons` | 500+ | Tailwind 官方 |
| SVG Spinners | `svg-spinners` | 50+ | 动画加载图标 |

---

## 🔍 查找图标

访问 [Icônes](https://icones.js.org/) 浏览和搜索图标：

1. 搜索你需要的图标
2. 点击图标
3. 选择代码格式：
   - **Vue** → 复制组件导入代码
   - **CSS** → 复制 Tailwind CSS 类名

---

## 💡 最佳实践

1. **常用图标用组件** - 类型安全，可绑定事件
2. **动态图标用 CSS 类** - 支持运行时拼接
3. **混合使用** - 根据场景选择最合适的方式
4. **统一命名** - 团队约定使用哪种方式
5. **按需加载** - 只打包实际使用的图标

---

## 🚨 常见问题

### Q: 图标不显示？

**解决方案：**
1. 检查图标名称是否正确（访问 [Icônes](https://icones.js.org/) 确认）
2. 确认图标集已安装：`@iconify-json/{collection}`
3. 清除缓存：删除 `node_modules/.vite`
4. 重启开发服务器

### Q: CSS 类方式图标颜色不对？

**解决方案：**
- 图标颜色通过 `text-*` 类控制
- 例如：`<span class="i-mdi-home text-blue-600"></span>`

### Q: 如何选择使用哪种方式？

**快速决策：**
- 需要绑定事件？→ 方式 1（组件）
- 需要动态切换？→ 方式 3（CSS 类）
- 偶尔使用？→ 方式 2（自动导入）

---

## 📚 完整文档

详细说明请查看：[docs/icon-usage-guide.md](./icon-usage-guide.md)
