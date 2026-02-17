<template>
  <button :type="type" :disabled="disabled || loading" :class="buttonClasses" @click="handleClick">
    <!-- 加载图标 -->
    <i v-if="loading" class="i-mdi-loading animate-spin" :class="iconSizeClass"></i>

    <!-- 左侧图标 -->
    <i v-else-if="leftIcon" :class="[leftIcon, iconSizeClass]"></i>

    <!-- 仅图标模式的图标 -->
    <i v-else-if="mode === 'icon' && icon" :class="[icon, iconSizeClass]"></i>

    <!-- 按钮文本 -->
    <span v-if="mode !== 'icon'" :class="textClass" class="flex items-center">
      <slot>{{ label }}</slot>
    </span>

    <!-- 右侧图标 -->
    <i v-if="rightIcon && !loading" :class="[rightIcon, iconSizeClass]"></i>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { BaseButtonProps } from './types';

const props = withDefaults(defineProps<BaseButtonProps>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
  fullWidth: false,
  mode: 'text'
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

// 图标尺寸类
const iconSizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-3 h-3';
    case 'md':
      return 'w-4 h-4';
    case 'lg':
      return 'w-5 h-5';
    default:
      return 'w-4 h-4';
  }
});

// 文本类
const textClass = computed(() => {
  // 间距现已通过gap属性在父元素上统一处理，此处不再需要
  return '';
});

const buttonClasses = computed(() => {
  const classes: string[] = [];

  // 基础样式
  classes.push(
    'inline-flex items-center justify-center rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50'
  );

  // 根据模式调整间距
  if (props.mode === 'icon') {
    // 图标按钮 - 正方形
    switch (props.size) {
      case 'sm':
        classes.push('h-8 w-8');
        break;
      case 'md':
        classes.push('h-10 w-10');
        break;
      case 'lg':
        classes.push('h-12 w-12');
        break;
    }
  } else {
    // 文字按钮或文字+图标按钮
    const hasIcons = props.leftIcon || props.rightIcon || props.loading;

    if (props.variant === 'text') {
      const sizeClasses = { sm: 'text-sm', md: 'text-sm', lg: 'text-base' };
      classes.push(sizeClasses[props.size] || 'text-sm');
      if (hasIcons) {
        // 统一使用较小的间距，以获得更紧凑的外观
        classes.push('gap-1');
      }
    } else {
      switch (props.size) {
        case 'sm':
          classes.push('h-8 text-sm');
          classes.push(hasIcons ? 'px-2 gap-1' : 'px-3');
          break;
        case 'md':
          classes.push('h-10 text-sm');
          classes.push(hasIcons ? 'px-3 gap-2' : 'px-4');
          break;
        case 'lg':
          classes.push('h-12 text-base');
          classes.push(hasIcons ? 'px-4 gap-2' : 'px-6');
          break;
      }
    }
  }

  // 变体样式
  switch (props.variant) {
    case 'primary':
      classes.push('bg-primary text-primary-foreground hover:bg-primary-hover', 'shadow hover:shadow-md');
      break;
    case 'secondary':
      classes.push('bg-secondary text-secondary-foreground hover:bg-secondary-hover', 'border border-border');
      break;
    case 'outline':
      classes.push('border border-border bg-background hover:bg-accent hover:text-accent-foreground');
      break;
    case 'ghost':
      classes.push('hover:bg-accent hover:text-accent-foreground');
      break;
    case 'danger':
      classes.push('bg-error text-error-foreground hover:bg-red-600', 'shadow hover:shadow-md');
      break;
    case 'text':
      classes.push('h-auto p-0 text-primary underline-offset-4 hover:underline disabled:no-underline');
      break;
  }

  // 全宽样式
  if (props.fullWidth) {
    classes.push('w-full');
  }

  return classes.join(' ');
});

const handleClick = (event: MouseEvent) => {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
};
</script>
