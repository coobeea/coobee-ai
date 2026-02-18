<template>
  <teleport to="body">
    <!-- Popover 容器 -->
    <div class="fixed inset-0 pointer-events-none" :style="{ zIndex: containerZIndex }">
      <transition-group name="popover" tag="div">
        <div
          v-for="popover in visiblePopovers"
          :key="popover.id"
          :style="getPopoverStyle(popover)"
          :class="getPopoverClass(popover)"
          class="absolute pointer-events-auto transition-all duration-200 ease-out"
          @click.stop>
          <!-- 箭头 -->
          <div
            v-if="popover.options.arrow"
            :class="getArrowClass(popover)"
            class="absolute w-3 h-3 transform rotate-45 z-10"></div>

          <!-- 主体内容 -->
          <div
            :class="getContentClass(popover)"
            class="relative rounded-lg shadow-lg border"
            :style="getContentStyle(popover)">
            <!-- 标题栏 -->
            <div
              v-if="popover.options.title || popover.options.closable"
              class="flex items-center justify-between p-3 border-b dark:border-gray-600">
              <h3 v-if="popover.options.title" class="text-sm font-medium truncate dark:text-gray-100">
                {{ popover.options.title }}
              </h3>
              <button
                v-if="popover.options.closable"
                class="ml-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 flex-shrink-0 dark:text-gray-300"
                @click="handleClose(popover)">
                <i class="i-mdi-close w-4 h-4"></i>
              </button>
            </div>

            <!-- 内容区域 -->
            <div :class="getBodyClass(popover)">
              <span v-if="!popover.options.html" class="break-words dark:text-gray-100">
                {{ popover.options.content }}
              </span>
              <div v-else class="break-words dark:text-gray-100" v-html="popover.options.content"></div>
            </div>
          </div>
        </div>
      </transition-group>
    </div>

    <!-- 遮罩层（用于点击外部关闭） -->
    <div
      v-if="hasVisiblePopovers"
      class="fixed inset-0 pointer-events-auto"
      :style="{ zIndex: overlayZIndex }"
      @click="handleClickOutside"></div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue';

import { layerManager } from '@/utils/LayerManager';

import { usePopoverStore } from './store';
import type { PopoverInstance } from './types';

const popoverStore = usePopoverStore();

const layerId = `popover-container_${Math.random().toString(36).slice(2, 9)}`;
const containerZIndex = layerManager.register(layerId, () => {
  visiblePopovers.value.forEach((popover) => {
    if (popover.options.closeOnEsc !== false) {
      popoverStore.hidePopover(popover.id);
    }
  });
});
const overlayZIndex = containerZIndex - 1;

const visiblePopovers = computed(() => popoverStore.popovers.filter((popover) => popover.visible));

const hasVisiblePopovers = computed(() => visiblePopovers.value.length > 0);

const getPopoverStyle = (popover: PopoverInstance) => {
  // 为每个 popover 实例注册独立的 z-index
  const popoverZIndex = popover.options.zIndex || layerManager.nextZIndex();

  const style: Record<string, string> = {
    left: `${popover.x}px`,
    top: `${popover.y}px`,
    zIndex: popoverZIndex.toString()
  };

  // 根据位置调整 transform
  const placement = popover.options.placement || 'top';

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
  if (popover.options.customStyle) {
    Object.assign(style, popover.options.customStyle);
  }

  return style;
};

const getPopoverClass = (popover: PopoverInstance) => {
  const classes: string[] = [];

  // 尺寸类
  const size = popover.options.size || 'medium';
  if (size === 'small') classes.push('max-w-xs');
  else if (size === 'medium') classes.push('max-w-sm');
  else if (size === 'large') classes.push('max-w-md');

  // 自定义类名
  if (popover.options.customClass) {
    classes.push(popover.options.customClass);
  }

  return classes.join(' ');
};

const getContentClass = (popover: PopoverInstance) => {
  const theme = popover.options.theme || 'light';

  return {
    'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-600':
      theme === 'light',
    'bg-gray-800 text-white border-gray-600': theme === 'dark'
  };
};

const getContentStyle = (popover: PopoverInstance) => {
  const style: Record<string, string> = {};

  if (popover.options.maxWidth) {
    style.maxWidth = popover.options.maxWidth;
  }
  if (popover.options.minWidth) {
    style.minWidth = popover.options.minWidth;
  }

  return style;
};

const getBodyClass = (popover: PopoverInstance) => {
  const hasTitle = popover.options.title || popover.options.closable;
  return hasTitle ? 'p-3' : 'p-3';
};

const getArrowClass = (popover: PopoverInstance) => {
  const placement = popover.options.placement || 'top';
  const theme = popover.options.theme || 'light';

  const themeClass =
    theme === 'light'
      ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
      : 'bg-gray-800 border-gray-600';

  let positionClass = '';
  let borderSides = '';

  if (placement.startsWith('top')) {
    positionClass = 'bottom-0 translate-y-1/2';
    borderSides = 'border-r border-b'; // 箭头指向下方
    if (placement === 'top') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'top-start') positionClass += ' left-2';
    else positionClass += ' left-1/2 -translate-x-1/2'; // top-end 也使用居中对齐
  } else if (placement.startsWith('bottom')) {
    positionClass = 'top-0 -translate-y-1/2';
    borderSides = 'border-l border-t'; // 箭头指向上方
    if (placement === 'bottom') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'bottom-start') positionClass += ' left-2';
    else positionClass += ' right-2';
  } else if (placement.startsWith('left')) {
    positionClass = 'right-0 translate-x-1/2';
    borderSides = 'border-r border-t'; // 箭头指向右方
    if (placement === 'left') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'left-start') positionClass += ' top-2';
    else positionClass += ' bottom-2';
  } else if (placement.startsWith('right')) {
    positionClass = 'left-0 -translate-x-1/2';
    borderSides = 'border-l border-b'; // 箭头指向左方
    if (placement === 'right') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'right-start') positionClass += ' top-2';
    else positionClass += ' bottom-2';
  }

  return `${themeClass} ${positionClass} ${borderSides}`;
};

const handleClose = (popover: PopoverInstance) => {
  popoverStore.hidePopover(popover.id);
};

const handleClickOutside = () => {
  // 只关闭设置了 closeOnClickOutside 的 popover
  visiblePopovers.value.forEach((popover) => {
    if (popover.options.closeOnClickOutside !== false) {
      popoverStore.hidePopover(popover.id);
    }
  });
};

onUnmounted(() => {
  layerManager.unregister(layerId);
});
</script>

<style scoped>
/* Popover 动画 */
.popover-enter-active,
.popover-leave-active {
  transition: all 0.2s ease;
}

.popover-enter-from {
  opacity: 0;
}

.popover-leave-to {
  opacity: 0;
}

.popover-move {
  transition: transform 0.2s ease;
}
</style>
