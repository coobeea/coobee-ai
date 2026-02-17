# Popover 组件

一个功能丰富的弹出框组件，支持多种触发方式、位置、主题和交互功能。

## 特性

- 🎯 **多种位置**：支持 12 个位置选项（top、bottom、left、right 及其变体）
- 🎨 **主题样式**：内置浅色和深色两种主题
- 🖱️ **多种触发**：支持 hover、click、focus 和手动触发
- 📱 **响应式设计**：自动适应屏幕尺寸和位置
- 🎭 **动画效果**：流畅的显示/隐藏动画
- 🔧 **高度可配置**：丰富的配置选项
- 📝 **HTML 支持**：支持 HTML 内容渲染
- 🎪 **指令支持**：支持 Vue 指令和编程式调用
- ❌ **可关闭**：支持关闭按钮和外部点击关闭
- 📏 **尺寸控制**：支持小、中、大三种尺寸
- 🏷️ **标题支持**：可显示标题栏
- 🎨 **自定义样式**：支持自定义类名和样式

## 安装

组件已自动注册到全局，无需手动导入。

## 基本用法

### 指令方式

```vue
<template>
  <!-- 基本用法 -->
  <button v-popover="'这是一个 Popover'">悬停显示</button>

  <!-- 点击触发 -->
  <button v-popover.click="'点击显示'">点击显示</button>

  <!-- 不同位置 -->
  <button v-popover.bottom="'底部显示'">底部</button>
  <button v-popover.left="'左侧显示'">左侧</button>
  <button v-popover.right="'右侧显示'">右侧</button>

  <!-- 不同主题 -->
  <button v-popover.dark="'深色主题'">深色</button>
  <button v-popover.light="'浅色主题'">浅色</button>

  <!-- 不同尺寸 -->
  <button v-popover.small="'小尺寸'">小</button>
  <button v-popover.medium="'中尺寸'">中</button>
  <button v-popover.large="'大尺寸'">大</button>
</template>
```

### 编程式调用

```vue
<template>
  <button @click="showPopover">显示 Popover</button>
  <button @click="hideAll">隐藏所有</button>
</template>

<script setup>
import { usePopover } from '@/composables/usePopover';

const { show, hide, hideAll } = usePopover();

const showPopover = (event) => {
  show(event.target, {
    content: '编程式显示的 Popover',
    placement: 'top',
    theme: 'dark'
  });
};
</script>
```

## 配置选项

### PopoverOptions

```typescript
interface PopoverOptions {
  content?: string; // 内容文本
  html?: boolean; // 是否支持 HTML
  placement?: PopoverPlacement; // 显示位置
  trigger?: PopoverTrigger; // 触发方式
  theme?: PopoverTheme; // 主题样式
  size?: PopoverSize; // 尺寸大小
  arrow?: boolean; // 是否显示箭头
  closable?: boolean; // 是否可关闭
  delay?: number; // 显示延迟（毫秒）
  hideDelay?: number; // 隐藏延迟（毫秒）
  offset?: number; // 偏移距离
  disabled?: boolean; // 是否禁用
  maxWidth?: string; // 最大宽度
  minWidth?: string; // 最小宽度
  customClass?: string; // 自定义类名
  zIndex?: number; // 层级
  closeOnClickOutside?: boolean; // 点击外部关闭
  closeOnEsc?: boolean; // ESC 键关闭
  title?: string; // 标题
  customStyle?: Record<string, string>; // 自定义样式
}
```

### PopoverPlacement

```typescript
type PopoverPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';
```

### PopoverTrigger

```typescript
type PopoverTrigger = 'click' | 'hover' | 'focus' | 'manual';
```

### PopoverTheme

```typescript
type PopoverTheme = 'light' | 'dark';
```

### PopoverSize

```typescript
type PopoverSize = 'small' | 'medium' | 'large';
```

## 指令修饰符

### 位置修饰符

- `.top` - 顶部显示
- `.bottom` - 底部显示
- `.left` - 左侧显示
- `.right` - 右侧显示

### 触发修饰符

- `.click` - 点击触发
- `.hover` - 悬停触发（默认）
- `.focus` - 聚焦触发

### 主题修饰符

- `.light` - 浅色主题（默认）
- `.dark` - 深色主题

### 尺寸修饰符

- `.small` - 小尺寸
- `.medium` - 中尺寸（默认）
- `.large` - 大尺寸

### 功能修饰符

- `.closable` - 显示关闭按钮

## API 方法

### usePopover

```typescript
const { show, hide, hideAll, update } = usePopover();

// 显示 Popover
show(target: HTMLElement, options: PopoverOptions): string

// 隐藏指定 Popover
hide(id: string): void

// 隐藏所有 Popover
hideAll(): void

// 更新 Popover
update(id: string, options: Partial<PopoverOptions>): void
```

## 高级用法

### HTML 内容

```vue
<template>
  <button v-popover="htmlContent">HTML 内容</button>
</template>

<script setup>
const htmlContent = {
  content: '<div><h4>标题</h4><p>支持 <strong>HTML</strong> 内容</p></div>',
  html: true,
  closable: true
};
</script>
```

### 带标题的 Popover

```vue
<template>
  <button v-popover="titleContent">带标题</button>
</template>

<script setup>
const titleContent = {
  title: '提示信息',
  content: '这是 Popover 的内容部分',
  closable: true
};
</script>
```

### 自定义样式

```vue
<template>
  <button v-popover="customContent">自定义样式</button>
</template>

<script setup>
const customContent = {
  content: '自定义样式的 Popover',
  customClass: 'my-popover',
  customStyle: {
    borderRadius: '12px',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)'
  }
};
</script>
```

### 编程式控制

```vue
<template>
  <div>
    <button @click="showCustomPopover">显示</button>
    <button @click="updatePopover">更新</button>
    <button @click="hidePopover">隐藏</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePopover } from '@/composables/usePopover';

const { show, hide, update } = usePopover();
const popoverId = ref('');

const showCustomPopover = (event) => {
  popoverId.value = show(event.target, {
    content: '可控制的 Popover',
    placement: 'top',
    closable: true
  });
};

const updatePopover = () => {
  if (popoverId.value) {
    update(popoverId.value, {
      content: '更新后的内容',
      theme: 'dark'
    });
  }
};

const hidePopover = () => {
  if (popoverId.value) {
    hide(popoverId.value);
    popoverId.value = '';
  }
};
</script>
```

## 样式自定义

### CSS 变量

```css
:root {
  --popover-bg-light: #ffffff;
  --popover-bg-dark: #374151;
  --popover-text-light: #111827;
  --popover-text-dark: #ffffff;
  --popover-border-light: #e5e7eb;
  --popover-border-dark: #4b5563;
  --popover-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}
```

### 自定义类名

```css
.my-custom-popover {
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.my-custom-popover .popover-title {
  background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
  color: white;
}
```

## 注意事项

1. **性能优化**：组件使用了 `teleport` 将内容渲染到 `body`，避免了 z-index 层级问题
2. **内存管理**：自动清理事件监听器和定时器，防止内存泄漏
3. **响应式**：自动适应屏幕尺寸变化和滚动位置
4. **无障碍性**：支持键盘导航和 ESC 键关闭
5. **兼容性**：与现有组件系统完全兼容

## 示例

查看 `PopoverExample.vue` 文件获取完整的使用示例。
