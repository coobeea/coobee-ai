# ToolTip 组件

一个功能丰富、易于使用的 ToolTip 组件，支持多种触发方式、位置配置和主题样式。

## 特性

- 🎯 **多种位置**: 支持 12 种不同的位置配置
- 🎨 **主题切换**: 内置深色和浅色主题
- 🖱️ **多种触发方式**: 支持 hover、click、focus 和手动触发
- ⚡ **高性能**: 使用 Teleport 和优化的定位算法
- 🎭 **动画效果**: 流畅的进入和退出动画
- 📱 **响应式**: 自动适应屏幕边界
- 🔧 **高度可配置**: 丰富的配置选项
- 📝 **HTML 支持**: 支持 HTML 内容渲染
- 🎪 **指令支持**: 提供 v-tooltip 指令，使用简单

## 安装和注册

组件已经在主应用中自动注册，无需额外安装。

```typescript
// 在 main.ts 中已经注册
import ComponentsPlugin from '@/components';
app.use(ComponentsPlugin);
```

## 🚀 快速开始

### 基础用法

```vue
<template>
  <!-- 基础用法 -->
  <button v-tooltip="'这是提示信息'">悬停显示提示</button>

  <!-- 配置选项 -->
  <button v-tooltip="{ content: '详细提示', placement: 'bottom', theme: 'light' }"> 自定义提示 </button>

  <!-- 使用修饰符 -->
  <button v-tooltip.bottom.click.light="'点击显示提示'"> 点击提示 </button>
</template>
```

## 🔧 问题修复

### ToolTip 无法关闭的问题已修复

我们修复了以下可能导致 ToolTip 无法关闭的问题：

1. **定时器竞态条件**：改进了显示/隐藏定时器的清理逻辑
2. **持久化 ToolTip 处理**：添加了强制隐藏选项
3. **事件监听器清理**：确保组件卸载时完全清理
4. **全局关闭机制**：
   - 按 `ESC` 键强制关闭所有 ToolTip
   - 点击 ToolTip 外部区域关闭非持久化的 ToolTip

### 新增 API 方法

```javascript
// 强制隐藏指定元素的 ToolTip
tooltip.forceHideByTarget(element);

// 强制隐藏所有 ToolTip（包括持久化的）
tooltip.forceHideAll();
```

### 2. 编程式调用

```vue
<template>
  <button ref="buttonRef" @click="showTooltip">显示提示</button>
</template>

<script setup>
import { ref } from 'vue';
import { useToolTip } from '@/composables/useToolTip';

const tooltip = useToolTip();
const buttonRef = ref();

const showTooltip = () => {
  tooltip.show(buttonRef.value, {
    content: '这是提示信息',
    placement: 'top',
    theme: 'dark'
  });
};
</script>
```

## 配置选项

### ToolTipOptions

| 属性         | 类型                | 默认值    | 说明            |
| ------------ | ------------------- | --------- | --------------- |
| `content`    | `string`            | -         | 提示内容 (必填) |
| `placement`  | `Placement`         | `'top'`   | 显示位置        |
| `trigger`    | `Trigger`           | `'hover'` | 触发方式        |
| `delay`      | `number`            | `100`     | 显示延迟 (毫秒) |
| `hideDelay`  | `number`            | `100`     | 隐藏延迟 (毫秒) |
| `disabled`   | `boolean`           | `false`   | 是否禁用        |
| `arrow`      | `boolean`           | `true`    | 是否显示箭头    |
| `theme`      | `'dark' \| 'light'` | `'dark'`  | 主题样式        |
| `maxWidth`   | `string`            | `'200px'` | 最大宽度        |
| `offset`     | `number`            | `8`       | 偏移距离        |
| `zIndex`     | `number`            | `9999`    | 层级            |
| `persistent` | `boolean`           | `false`   | 是否持久显示    |
| `html`       | `boolean`           | `false`   | 是否支持 HTML   |

### 位置选项 (Placement)

- `top`, `top-start`, `top-end`
- `bottom`, `bottom-start`, `bottom-end`
- `left`, `left-start`, `left-end`
- `right`, `right-start`, `right-end`

### 触发方式 (Trigger)

- `hover`: 鼠标悬停触发 (默认)
- `click`: 点击触发
- `focus`: 获得焦点触发
- `manual`: 手动触发

## 指令修饰符

### 位置修饰符

- `.top`, `.bottom`, `.left`, `.right`

### 触发修饰符

- `.click`, `.focus` (默认是 hover)

### 主题修饰符

- `.dark`, `.light` (默认是 dark)

### 示例

```vue
<template>
  <!-- 底部显示，点击触发，浅色主题 -->
  <button v-tooltip.bottom.click.light="'提示信息'">按钮</button>

  <!-- 右侧显示，获得焦点触发 -->
  <input v-tooltip.right.focus="'输入提示'" />
</template>
```

## API 方法

### useToolTip()

返回 ToolTip API 对象：

```typescript
interface ToolTipAPI {
  show: (target: HTMLElement, options: ToolTipOptions) => string;
  hide: (id: string) => void;
  hideAll: () => void;
  update: (id: string, options: Partial<ToolTipOptions>) => void;
}
```

#### 方法说明

- `show(target, options)`: 显示 tooltip，返回 tooltip ID
- `hide(id)`: 隐藏指定 ID 的 tooltip
- `hideAll()`: 隐藏所有 tooltip
- `update(id, options)`: 更新指定 tooltip 的配置

## 高级用法

### HTML 内容

```vue
<template>
  <button
    v-tooltip="{
      content: '<strong>粗体</strong>和<em>斜体</em>文本',
      html: true,
      theme: 'light'
    }">
    HTML 内容
  </button>
</template>
```

### 持久化显示

```vue
<template>
  <button
    v-tooltip="{
      content: '这个提示不会自动隐藏',
      persistent: true
    }">
    持久化提示
  </button>
</template>
```

### 动态配置

```vue
<template>
  <button v-tooltip="tooltipConfig">动态配置</button>
</template>

<script setup>
import { ref, computed } from 'vue';

const isDarkMode = ref(true);

const tooltipConfig = computed(() => ({
  content: '动态主题提示',
  theme: isDarkMode.value ? 'dark' : 'light',
  placement: 'top'
}));
</script>
```

### 编程式控制

```vue
<template>
  <div>
    <button ref="targetRef" @mouseenter="showTooltip">目标元素</button>
    <button @click="hideTooltip">隐藏提示</button>
    <button @click="updateTooltip">更新提示</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useToolTip } from '@/composables/useToolTip';

const tooltip = useToolTip();
const targetRef = ref();
let currentTooltipId = '';

const showTooltip = () => {
  currentTooltipId = tooltip.show(targetRef.value, {
    content: '编程式控制的提示',
    placement: 'top',
    persistent: true
  });
};

const hideTooltip = () => {
  if (currentTooltipId) {
    tooltip.hide(currentTooltipId);
  }
};

const updateTooltip = () => {
  if (currentTooltipId) {
    tooltip.update(currentTooltipId, {
      content: '更新后的提示内容',
      theme: 'light'
    });
  }
};
</script>
```

## 样式自定义

组件使用 Tailwind CSS 类名，可以通过修改主题配置来自定义样式：

```css
/* 自定义深色主题 */
.tooltip-dark {
  @apply bg-gray-900 text-white border-gray-700;
}

/* 自定义浅色主题 */
.tooltip-light {
  @apply bg-white text-gray-900 border-gray-200;
}
```

## 注意事项

1. **性能优化**: 组件使用了 `WeakMap` 来管理元素与 tooltip 的关系，避免内存泄漏
2. **边界检测**: 自动检测屏幕边界，防止 tooltip 超出可视区域
3. **事件清理**: 组件卸载时会自动清理所有事件监听器和定时器
4. **HTML 安全**: 使用 `html: true` 时请确保内容安全，避免 XSS 攻击
5. **层级管理**: 默认 z-index 为 9999，可根据需要调整

## 示例文件

查看 `examples/ToolTipExample.vue` 文件获取完整的使用示例。

## 类型定义

```typescript
// 完整的类型定义请查看 types.ts 文件
export interface ToolTipOptions {
  content: string;
  placement?: Placement;
  trigger?: Trigger;
  delay?: number;
  hideDelay?: number;
  disabled?: boolean;
  arrow?: boolean;
  theme?: 'dark' | 'light';
  maxWidth?: string;
  offset?: number;
  zIndex?: number;
  persistent?: boolean;
  html?: boolean;
}
```
