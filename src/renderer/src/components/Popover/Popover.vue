<template>
  <div class="popover-wrapper">
    <!-- Reference 元素 -->
    <div
      ref="referenceRef"
      class="popover-reference"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
      @click="handleClick"
      @focus="handleFocus"
      @blur="handleBlur">
      <slot name="reference"></slot>
    </div>

    <!-- Popover 内容 -->
    <teleport to="body">
      <transition name="popover" appear>
        <div
          v-if="visible"
          ref="popoverRef"
          :style="popoverStyle"
          :class="popoverClass"
          class="absolute pointer-events-auto transition-all duration-200 ease-out"
          @click.stop>
          <!-- 箭头 -->
          <div v-if="arrow" :class="arrowClass" class="absolute w-3 h-3 transform z-10"></div>

          <!-- 主体内容 -->
          <div :class="contentClass" class="relative rounded-lg shadow-lg border" :style="contentStyle">
            <!-- 标题栏 -->
            <div v-if="title || closable" class="flex items-center justify-between p-3 border-b dark:border-gray-600">
              <h3 v-if="title" class="text-sm font-medium truncate dark:text-gray-100">
                {{ title }}
              </h3>
              <button
                v-if="closable"
                class="ml-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 flex-shrink-0 dark:text-gray-300"
                @click="handleClose">
                <i class="i-mdi-close w-4 h-4"></i>
              </button>
            </div>

            <!-- 内容区域 -->
            <div :class="bodyClass" class="dark:text-gray-100">
              <slot></slot>
            </div>
          </div>
        </div>
      </transition>

      <!-- 遮罩层（用于点击外部关闭） -->
      <div
        v-if="visible && closeOnClickOutside"
        class="fixed inset-0 pointer-events-auto"
        style="z-index: 9997"
        @click="handleClickOutside"></div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { PopoverPlacement, PopoverSize, PopoverTheme, PopoverTrigger } from './types';

interface Props {
  // 显示控制
  modelValue?: boolean;
  // 位置
  placement?: PopoverPlacement;
  // 触发方式
  trigger?: PopoverTrigger;
  // 主题
  theme?: PopoverTheme;
  // 尺寸
  size?: PopoverSize;
  // 是否显示箭头
  arrow?: boolean;
  // 是否可关闭
  closable?: boolean;
  // 延迟显示（毫秒）
  delay?: number;
  // 延迟隐藏（毫秒）
  hideDelay?: number;
  // 偏移量
  offset?: number;
  // 是否禁用
  disabled?: boolean;
  // 最大宽度
  maxWidth?: string;
  // 最小宽度
  minWidth?: string;
  // z-index
  zIndex?: number;
  // 点击外部关闭
  closeOnClickOutside?: boolean;
  // ESC 键关闭
  closeOnEsc?: boolean;
  // 标题
  title?: string;
  // 自定义样式
  customStyle?: Record<string, string>;
  // 自定义类名
  customClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  placement: 'top',
  trigger: 'hover',
  theme: 'light',
  size: 'medium',
  arrow: true,
  closable: false,
  delay: 0,
  hideDelay: 0,
  offset: 8,
  disabled: false,
  zIndex: 9998,
  closeOnClickOutside: true,
  closeOnEsc: true
});

interface Emits {
  'update:modelValue': [value: boolean];
  show: [];
  hide: [];
}

const emit = defineEmits<Emits>();

const referenceRef = ref<HTMLElement>();
const popoverRef = ref<HTMLElement>();
const visible = ref(props.modelValue);
const showTimer = ref<number>();
const hideTimer = ref<number>();
const position = ref({ x: 0, y: 0 });

// 监听 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    visible.value = newValue;
  }
);

// 监听 visible 变化
watch(visible, (newValue) => {
  emit('update:modelValue', newValue);
  if (newValue) {
    emit('show');
    nextTick(() => {
      updatePosition();
    });
  } else {
    emit('hide');
  }
});

// 计算样式
const popoverStyle = computed(() => {
  const style: Record<string, string> = {
    left: `${position.value.x}px`,
    top: `${position.value.y}px`,
    zIndex: props.zIndex?.toString() || '9998'
  };

  // 根据位置调整 transform
  const placement = props.placement || 'top';

  if (placement.startsWith('top')) {
    style.transform =
      placement === 'top'
        ? 'translateX(-50%) translateY(-100%)'
        : placement === 'top-start'
          ? 'translateY(-100%)'
          : 'translateX(-100%) translateY(-100%)';
  } else if (placement.startsWith('bottom')) {
    style.transform =
      placement === 'bottom' ? 'translateX(-50%)' : placement === 'bottom-start' ? '' : 'translateX(-100%)';
  } else if (placement.startsWith('left')) {
    style.transform =
      placement === 'left'
        ? 'translateX(-100%) translateY(-50%)'
        : placement === 'left-start'
          ? 'translateX(-100%)'
          : 'translateX(-100%) translateY(-100%)';
  } else if (placement.startsWith('right')) {
    style.transform =
      placement === 'right' ? 'translateY(-50%)' : placement === 'right-start' ? '' : 'translateY(-100%)';
  }

  // 应用自定义样式
  if (props.customStyle) {
    Object.assign(style, props.customStyle);
  }

  return style;
});

const popoverClass = computed(() => {
  const classes: string[] = [];

  // 尺寸类
  const size = props.size || 'medium';
  if (size === 'small') classes.push('max-w-xs');
  else if (size === 'medium') classes.push('max-w-sm');
  else if (size === 'large') classes.push('max-w-md');

  // 自定义类名
  if (props.customClass) {
    const customClasses = props.customClass.split(' ').filter(Boolean);
    classes.push(...customClasses);
  }

  return classes.join(' ');
});

const contentClass = computed(() => {
  const theme = props.theme || 'light';

  return {
    'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-600':
      theme === 'light',
    'bg-gray-800 text-white border-gray-600': theme === 'dark'
  };
});

const contentStyle = computed(() => {
  const style: Record<string, string> = {};

  if (props.maxWidth) {
    style.maxWidth = props.maxWidth;
  }
  if (props.minWidth) {
    style.minWidth = props.minWidth;
  }

  return style;
});

const bodyClass = computed(() => {
  const hasTitle = props.title || props.closable;
  return hasTitle ? 'p-3' : 'p-3';
});

const arrowClass = computed(() => {
  const placement = props.placement || 'top';
  const theme = props.theme || 'light';

  const themeClass = theme === 'light' ? 'bg-white dark:bg-gray-800' : 'bg-gray-800';
  const borderClass = theme === 'light' ? 'border-gray-200 dark:border-gray-600' : 'border-gray-600';

  let positionClass = '';
  let rotateClass = '';
  let borderSides = '';

  if (placement.startsWith('top')) {
    positionClass = 'bottom-0 translate-y-1/2';
    rotateClass = 'rotate-45';
    borderSides = 'border-r border-b';
    if (placement === 'top') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'top-start') positionClass += ' left-4';
    else positionClass += ' right-4';
  } else if (placement.startsWith('bottom')) {
    positionClass = 'top-0 -translate-y-1/2';
    rotateClass = 'rotate-45';
    borderSides = 'border-l border-t';
    if (placement === 'bottom') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'bottom-start') positionClass += ' left-4';
    else positionClass += ' right-4';
  } else if (placement.startsWith('left')) {
    positionClass = 'right-0 translate-x-1/2';
    rotateClass = 'rotate-45';
    borderSides = 'border-r border-t';
    if (placement === 'left') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'left-start') positionClass += ' top-4';
    else positionClass += ' bottom-4';
  } else if (placement.startsWith('right')) {
    positionClass = 'left-0 -translate-x-1/2';
    rotateClass = 'rotate-45';
    borderSides = 'border-l border-b';
    if (placement === 'right') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'right-start') positionClass += ' top-4';
    else positionClass += ' bottom-4';
  }

  return `${themeClass} ${borderClass} ${positionClass} ${rotateClass} ${borderSides}`;
});

// 更新位置
const updatePosition = () => {
  if (!referenceRef.value || !popoverRef.value) return;

  const referenceRect = referenceRef.value.getBoundingClientRect();
  const placement = props.placement || 'top';
  const offset = props.offset || 8;

  let x = 0;
  let y = 0;

  // 计算基础位置 - 考虑箭头的固定偏移和旋转
  const arrowSize = 12; // 箭头尺寸 (w-3 h-3 = 12px)
  const arrowFixedOffset = 3; // 箭头固定偏移 (left-4/right-4/top-4/bottom-4 = 16px)
  const arrowHypotenuseSize: number = arrowSize * Math.sqrt(2); // 箭头斜边长度 ≈ 16.97px
  const arrowHalfHypotenuse = arrowHypotenuseSize / 2; // 箭头斜边的一半 ≈ 8.49px

  if (placement.startsWith('top')) {
    y = referenceRect.top - offset;
    if (placement === 'top') {
      x = referenceRect.left + referenceRect.width / 2;
    } else if (placement === 'top-start') {
      // 箭头位置在 left-4，箭头中心应该对准referenceRect中心
      // popover的x位置 = referenceRect中心 - 箭头固定偏移 - 箭头中心偏移
      x = referenceRect.left + Math.abs(referenceRect.width - arrowHalfHypotenuse) / 2 - arrowFixedOffset;
    } else {
      // 箭头位置在 right-4，箭头中心应该对准referenceRect中心
      // popover的x位置 = referenceRect中心 + 箭头固定偏移 - 箭头中心偏移
      x =
        referenceRect.left +
        referenceRect.width +
        Math.abs(referenceRect.width - arrowHalfHypotenuse) / 2 +
        arrowFixedOffset;
    }
  } else if (placement.startsWith('bottom')) {
    y = referenceRect.bottom + offset;
    if (placement === 'bottom') {
      x = referenceRect.left + referenceRect.width / 2;
    } else if (placement === 'bottom-start') {
      // 箭头位置在 left-4，箭头中心应该对准referenceRect中心
      x = referenceRect.left + Math.abs(referenceRect.width - arrowHalfHypotenuse) / 2 - arrowFixedOffset;
    } else {
      // 箭头位置在 right-4，箭头中心应该对准referenceRect中心
      x =
        referenceRect.left +
        referenceRect.width +
        Math.abs(referenceRect.width - arrowHalfHypotenuse) / 2 +
        arrowFixedOffset;
    }
  } else if (placement.startsWith('left')) {
    x = referenceRect.left - offset;
    if (placement === 'left') {
      y = referenceRect.top + referenceRect.height / 2;
    } else if (placement === 'left-start') {
      // 箭头位置在 top-4，箭头中心应该对准referenceRect中心
      y = referenceRect.top + Math.abs(referenceRect.height - arrowHalfHypotenuse) / 2 - arrowFixedOffset;
    } else {
      // 箭头位置在 bottom-4，箭头中心应该对准referenceRect中心
      y =
        referenceRect.top +
        referenceRect.height +
        Math.abs(referenceRect.height - arrowHalfHypotenuse) / 2 +
        arrowFixedOffset;
    }
  } else if (placement.startsWith('right')) {
    x = referenceRect.right + offset;
    if (placement === 'right') {
      y = referenceRect.top + referenceRect.height / 2;
    } else if (placement === 'right-start') {
      // 箭头位置在 top-4，箭头中心应该对准referenceRect中心
      y = referenceRect.top + Math.abs(referenceRect.height - arrowHalfHypotenuse) / 2 - arrowFixedOffset;
    } else {
      // 箭头位置在 bottom-4，箭头中心应该对准referenceRect中心
      y =
        referenceRect.top +
        referenceRect.height +
        Math.abs(referenceRect.height - arrowHalfHypotenuse) / 2 +
        arrowFixedOffset;
    }
  }

  position.value = { x, y };
};

// 显示 Popover
const show = () => {
  if (props.disabled) return;

  clearTimeout(hideTimer.value);

  if (props.delay > 0) {
    showTimer.value = window.setTimeout(() => {
      visible.value = true;
    }, props.delay);
  } else {
    visible.value = true;
  }
};

// 隐藏 Popover
const hide = () => {
  clearTimeout(showTimer.value);

  if (props.hideDelay > 0) {
    hideTimer.value = window.setTimeout(() => {
      visible.value = false;
    }, props.hideDelay);
  } else {
    visible.value = false;
  }
};

// 事件处理
const handleMouseEnter = () => {
  if (props.trigger === 'hover') {
    show();
  }
};

const handleMouseLeave = () => {
  if (props.trigger === 'hover') {
    hide();
  }
};

const handleClick = () => {
  if (props.trigger === 'click') {
    if (visible.value) {
      hide();
    } else {
      show();
    }
  }
};

const handleFocus = () => {
  if (props.trigger === 'focus') {
    show();
  }
};

const handleBlur = () => {
  if (props.trigger === 'focus') {
    hide();
  }
};

const handleClose = () => {
  hide();
};

const handleClickOutside = () => {
  if (props.closeOnClickOutside) {
    hide();
  }
};

const handleEscKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.closeOnEsc && visible.value) {
    hide();
  }
};

// 生命周期
onMounted(() => {
  document.addEventListener('keydown', handleEscKey);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscKey);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition);
  clearTimeout(showTimer.value);
  clearTimeout(hideTimer.value);
});

// 暴露方法
defineExpose({
  show,
  hide,
  updatePosition
});
</script>

<style scoped>
.popover-wrapper {
  display: inline-block;
}

.popover-reference {
  display: inline-block;
}

/* Popover 动画 */
.popover-enter-active,
.popover-leave-active {
  transition: opacity 0.2s ease;
}

.popover-enter-from {
  opacity: 0;
}

.popover-leave-to {
  opacity: 0;
}
</style>
