# Popup 弹出层组件

一个功能强大、高度可定制的弹出层组件，支持多种定位方式、动画效果和自定义样式。

## 特性

- 🎯 **多种定位方式**：支持 9 种预设定位 + 自定义定位
- 🎨 **丰富动画效果**：7 种内置动画过渡效果
- 🎛️ **高度可定制**：支持自定义样式、类名、遮罩层等
- 🔧 **完善的事件系统**：提供完整的生命周期事件
- 📱 **响应式设计**：支持移动端和桌面端
- ♿ **无障碍支持**：支持键盘导航和焦点管理
- 🔒 **滚动锁定**：可选的页面滚动锁定功能

## 基础用法

```vue
<template>
  <div>
    <button @click="visible = true">打开弹出层</button>

    <Popup v-model:visible="visible">
      <div class="popup-content">
        <h3>弹出层内容</h3>
        <p>这里是弹出层的内容</p>
        <button @click="visible = false">关闭</button>
      </div>
    </Popup>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Popup } from '@/components/Popup';

const visible = ref(false);
</script>
```

## 定位方式

### 预设定位

```vue
<!-- 居中显示（默认） -->
<Popup v-model:visible="visible" position="center">
  <div class="popup-content">居中内容</div>
</Popup>

<!-- 顶部显示 -->
<Popup v-model:visible="visible" position="top">
  <div class="popup-content">顶部内容</div>
</Popup>

<!-- 右下角显示 -->
<Popup v-model:visible="visible" position="bottom-right">
  <div class="popup-content">右下角内容</div>
</Popup>
```

### 支持的定位方式

- `center` - 居中（默认）
- `top` - 顶部居中
- `bottom` - 底部居中
- `left` - 左侧居中
- `right` - 右侧居中
- `top-left` - 左上角
- `top-right` - 右上角
- `bottom-left` - 左下角
- `bottom-right` - 右下角
- `custom` - 自定义定位

### 自定义定位

```vue
<Popup
  v-model:visible="visible"
  position="custom"
  :custom-position="{
    top: '20px',
    right: '20px',
    transform: 'none'
  }">
  <div class="popup-content">自定义位置内容</div>
</Popup>
```

## 动画效果

```vue
<!-- 淡入淡出（默认） -->
<Popup v-model:visible="visible" transition="fade">
  <div class="popup-content">淡入淡出</div>
</Popup>

<!-- 向上滑动 -->
<Popup v-model:visible="visible" transition="slide-up">
  <div class="popup-content">向上滑动</div>
</Popup>

<!-- 弹跳效果 -->
<Popup v-model:visible="visible" transition="bounce">
  <div class="popup-content">弹跳效果</div>
</Popup>
```

### 支持的动画类型

- `fade` - 淡入淡出（默认）
- `slide-up` - 向上滑动
- `slide-down` - 向下滑动
- `slide-left` - 向左滑动
- `slide-right` - 向右滑动
- `zoom` - 缩放
- `bounce` - 弹跳

## 高级配置

### 遮罩层配置

```vue
<!-- 无遮罩层 -->
<Popup v-model:visible="visible" :show-mask="false">
  <div class="popup-content">无遮罩层</div>
</Popup>

<!-- 非模态弹出层 -->
<Popup v-model:visible="visible" :modal="false" :close-on-click-overlay="false">
  <div class="popup-content">非模态弹出层</div>
</Popup>
```

### 自定义样式

```vue
<Popup
  v-model:visible="visible"
  overlay-class="custom-overlay"
  container-class="custom-container"
  :overlay-style="{ backgroundColor: 'rgba(255, 0, 0, 0.3)' }"
  :container-style="{ borderRadius: '20px' }">
  <div class="popup-content">自定义样式</div>
</Popup>
```

### 层级管理

```vue
<Popup v-model:visible="visible" :z-index="2000">
  <div class="popup-content">高层级弹出层</div>
</Popup>
```

## API 参考

### Props

| 参数                  | 类型              | 默认值     | 说明                                 |
| --------------------- | ----------------- | ---------- | ------------------------------------ |
| `visible`             | `boolean`         | `false`    | 是否显示弹出层                       |
| `position`            | `PopupPosition`   | `'center'` | 定位方式                             |
| `modal`               | `boolean`         | `true`     | 是否为模态弹出层                     |
| `showMask`            | `boolean`         | `true`     | 是否显示遮罩层                       |
| `closeOnClickOverlay` | `boolean`         | `true`     | 点击遮罩层是否关闭                   |
| `closeOnEsc`          | `boolean`         | `true`     | 按ESC键是否关闭                      |
| `lockScroll`          | `boolean`         | `true`     | 是否锁定滚动                         |
| `transition`          | `PopupTransition` | `'fade'`   | 动画类型                             |
| `zIndex`              | `number`          | `1000`     | z-index 层级                         |
| `overlayClass`        | `string`          | -          | 自定义遮罩层类名                     |
| `containerClass`      | `string`          | -          | 自定义容器类名                       |
| `overlayStyle`        | `object`          | -          | 自定义遮罩层样式                     |
| `containerStyle`      | `object`          | -          | 自定义容器样式                       |
| `customPosition`      | `object`          | -          | 自定义定位（position为custom时使用） |

### Events

| 事件名           | 说明               | 回调参数             |
| ---------------- | ------------------ | -------------------- |
| `update:visible` | 显示状态改变时触发 | `(visible: boolean)` |
| `open`           | 弹出层打开时触发   | -                    |
| `close`          | 弹出层关闭时触发   | -                    |
| `opened`         | 打开动画完成后触发 | -                    |
| `closed`         | 关闭动画完成后触发 | -                    |

### Methods

| 方法名  | 说明       | 参数 |
| ------- | ---------- | ---- |
| `close` | 关闭弹出层 | -    |

### Slots

| 插槽名    | 说明       |
| --------- | ---------- |
| `default` | 弹出层内容 |

## 类型定义

```typescript
type PopupPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'custom';

type PopupTransition = 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'bounce';
```

## 使用组合式函数

```vue
<script setup>
import { usePopup } from '@/components/Popup';

const { getNextZIndex, addPopup, removePopup } = usePopup();

// 获取下一个z-index
const zIndex = getNextZIndex();

// 添加弹出层到管理器
const popupId = 'my-popup';
addPopup(popupId);

// 移除弹出层
removePopup(popupId);
</script>
```

## 注意事项

1. **容器设置**：确保在 App.vue 中添加了 `PopupContainer` 组件
2. **层级管理**：多个弹出层会自动管理层级，后打开的弹出层层级更高
3. **滚动锁定**：当 `lockScroll` 为 `true` 时，弹出层打开时会锁定页面滚动
4. **键盘导航**：支持 ESC 键关闭（可通过 `closeOnEsc` 控制）
5. **焦点管理**：弹出层打开时会自动获取焦点

## 最佳实践

1. **内容结构**：为弹出层内容添加适当的背景、边框和内边距
2. **响应式设计**：使用响应式单位和类名确保在不同设备上的显示效果
3. **无障碍性**：为弹出层内容添加适当的 ARIA 标签
4. **性能优化**：避免在弹出层中放置过重的组件
5. **用户体验**：提供清晰的关闭按钮和操作指引
