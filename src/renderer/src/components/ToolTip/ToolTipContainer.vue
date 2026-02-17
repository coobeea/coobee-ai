<template>
  <teleport to="body">
    <!-- ToolTip 容器 -->
    <div class="fixed inset-0 pointer-events-none" :style="{ zIndex: containerZIndex }" data-tooltip-container>
      <transition-group name="tooltip" tag="div">
        <div
          v-for="tooltip in visibleToolTips"
          :key="tooltip.id"
          :style="getToolTipStyle(tooltip)"
          :class="getToolTipClass(tooltip)"
          class="absolute pointer-events-none transition-all duration-200 ease-out"
          @mouseenter="handleMouseEnter(tooltip)"
          @mouseleave="handleMouseLeave(tooltip)">
          <!-- 箭头 -->
          <div
            v-if="tooltip.arrow"
            :class="getArrowClass(tooltip)"
            class="absolute w-2 h-2 transform rotate-45 z-10"></div>

          <!-- 内容 -->
          <div
            :class="getContentClass(tooltip)"
            class="relative px-2 py-1 text-xs rounded shadow-lg whitespace-nowrap"
            :style="{ maxWidth: tooltip.maxWidth }">
            <span v-if="!tooltip.html" class="break-words">
              {{ tooltip.content }}
            </span>
            <div v-else class="break-words" v-html="tooltip.content"></div>
          </div>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { zIndexManager } from '@/utils/ZIndexManager';

import { useToolTipStore } from './store';
import type { ToolTipInstance } from './types';

const toolTipStore = useToolTipStore();

// Z-Index 管理
const containerZIndex = zIndexManager.bringToFront();

const visibleToolTips = computed(() => toolTipStore.tooltips.filter((tooltip) => tooltip.visible));

const getToolTipStyle = (tooltip: ToolTipInstance) => {
  // 为每个 tooltip 实例注册独立的 z-index
  const tooltipZIndex = tooltip.zIndex || zIndexManager.bringToFront();

  const style: Record<string, string> = {
    left: `${tooltip.x}px`,
    top: `${tooltip.y}px`,
    zIndex: tooltipZIndex.toString()
  };

  // 根据位置调整 transform
  const placement = tooltip.placement || 'top';

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

  return style;
};

const getToolTipClass = (tooltip: ToolTipInstance) => {
  return {
    'pointer-events-auto': tooltip.persistent
  };
};

const getContentClass = (tooltip: ToolTipInstance) => {
  const theme = tooltip.theme || 'dark';

  return {
    'bg-gray-900 text-white border border-gray-700': theme === 'dark',
    'bg-white text-gray-900 border border-gray-200': theme === 'light'
  };
};

const getArrowClass = (tooltip: ToolTipInstance) => {
  const placement = tooltip.placement || 'top';
  const theme = tooltip.theme || 'dark';

  const themeClass = theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200';

  let positionClass = '';
  let borderSides = '';

  if (placement.startsWith('top')) {
    positionClass = 'bottom-0 translate-y-1/2';
    borderSides = 'border-r border-b';
    if (placement === 'top') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'top-start') positionClass += ' left-2';
    else positionClass += ' right-2';
  } else if (placement.startsWith('bottom')) {
    positionClass = 'top-0 -translate-y-1/2';
    borderSides = 'border-l border-t';
    if (placement === 'bottom') positionClass += ' left-1/2 -translate-x-1/2';
    else if (placement === 'bottom-start') positionClass += ' left-2';
    else positionClass += ' right-2';
  } else if (placement.startsWith('left')) {
    positionClass = 'right-0 translate-x-1/2';
    borderSides = 'border-r border-t';
    if (placement === 'left') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'left-start') positionClass += ' top-1';
    else positionClass += ' bottom-1';
  } else if (placement.startsWith('right')) {
    positionClass = 'left-0 -translate-x-1/2';
    borderSides = 'border-l border-b';
    if (placement === 'right') positionClass += ' top-1/2 -translate-y-1/2';
    else if (placement === 'right-start') positionClass += ' top-1';
    else positionClass += ' bottom-1';
  }

  return `${themeClass} ${positionClass} ${borderSides}`;
};

const handleMouseEnter = (tooltip: ToolTipInstance) => {
  // 鼠标进入tooltip时，如果有隐藏定时器，清除它
  if (tooltip.targetElement) {
    const elementData = (window as any).elementTooltipMap?.get(tooltip.targetElement);
    if (elementData?.hideTimer) {
      clearTimeout(elementData.hideTimer);
      elementData.hideTimer = undefined;
    }
  }
};

const handleMouseLeave = (tooltip: ToolTipInstance) => {
  // 鼠标离开tooltip时，如果不是persistent，则隐藏
  if (!tooltip.persistent && tooltip.targetElement) {
    const hideTooltip = (window as any).hideTooltip;
    if (hideTooltip) {
      hideTooltip(tooltip.targetElement);
    } else {
      // 备用方案：直接隐藏
      toolTipStore.hideToolTip(tooltip.id);
    }
  }
};
</script>

<style scoped>
/* ToolTip 动画 */
.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.2s ease;
}

.tooltip-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.tooltip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.tooltip-move {
  transition: transform 0.2s ease;
}
</style>
