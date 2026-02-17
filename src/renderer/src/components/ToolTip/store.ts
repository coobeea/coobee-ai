import { reactive } from 'vue';

import type { ToolTipInstance, ToolTipOptions } from './types';

interface ToolTipStore {
  tooltips: ToolTipInstance[];
  defaultOptions: {
    placement: 'top' | 'bottom' | 'left' | 'right';
    trigger: 'hover' | 'click' | 'focus' | 'manual';
    delay: number;
    hideDelay: number;
    disabled: boolean;
    arrow: boolean;
    theme: 'dark' | 'light';
    maxWidth: string;
    offset: number;
    zIndex: number;
    persistent: boolean;
    html: boolean;
  };
}

const store = reactive<ToolTipStore>({
  tooltips: [],
  defaultOptions: {
    placement: 'top',
    trigger: 'hover',
    delay: 100,
    hideDelay: 100,
    disabled: false,
    arrow: true,
    theme: 'dark',
    maxWidth: '200px',
    offset: 8,
    zIndex: 9999,
    persistent: false,
    html: false
  }
});

let tooltipIdCounter = 0;

const generateId = (): string => {
  return `tooltip_${Date.now()}_${++tooltipIdCounter}`;
};

// 计算 tooltip 位置
const calculatePosition = (target: HTMLElement, placement: string, offset: number): { x: number; y: number } => {
  const rect = target.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  let x = 0;
  let y = 0;

  switch (placement) {
    case 'top':
    case 'top-start':
    case 'top-end':
      x = rect.left + scrollX + (placement === 'top' ? rect.width / 2 : placement === 'top-start' ? 0 : rect.width);
      y = rect.top + scrollY - offset;
      break;
    case 'bottom':
    case 'bottom-start':
    case 'bottom-end':
      x =
        rect.left + scrollX + (placement === 'bottom' ? rect.width / 2 : placement === 'bottom-start' ? 0 : rect.width);
      y = rect.bottom + scrollY + offset;
      break;
    case 'left':
    case 'left-start':
    case 'left-end':
      x = rect.left + scrollX - offset;
      y = rect.top + scrollY + (placement === 'left' ? rect.height / 2 : placement === 'left-start' ? 0 : rect.height);
      break;
    case 'right':
    case 'right-start':
    case 'right-end':
      x = rect.right + scrollX + offset;
      y =
        rect.top + scrollY + (placement === 'right' ? rect.height / 2 : placement === 'right-start' ? 0 : rect.height);
      break;
  }

  return { x, y };
};

export const useToolTipStore = () => {
  const showToolTip = (target: HTMLElement, options: ToolTipOptions): string => {
    if (options.disabled) return '';

    const id = generateId();
    const position = calculatePosition(
      target,
      options.placement || store.defaultOptions.placement,
      options.offset || store.defaultOptions.offset
    );

    const tooltip: ToolTipInstance = {
      id,
      visible: true,
      targetElement: target,
      x: position.x,
      y: position.y,
      placement: store.defaultOptions.placement,
      trigger: store.defaultOptions.trigger,
      delay: store.defaultOptions.delay,
      hideDelay: store.defaultOptions.hideDelay,
      disabled: store.defaultOptions.disabled,
      arrow: store.defaultOptions.arrow,
      theme: store.defaultOptions.theme,
      maxWidth: store.defaultOptions.maxWidth,
      offset: store.defaultOptions.offset,
      zIndex: store.defaultOptions.zIndex,
      persistent: store.defaultOptions.persistent,
      html: store.defaultOptions.html,
      ...options
    };

    store.tooltips.push(tooltip);
    return id;
  };

  const hideToolTip = (id: string): void => {
    const index = store.tooltips.findIndex((tooltip) => tooltip.id === id);
    if (index > -1) {
      const tooltip = store.tooltips[index];

      // 先设置为不可见，触发动画
      tooltip.visible = false;

      // 延迟移除，等待动画完成
      setTimeout(() => {
        const currentIndex = store.tooltips.findIndex((t) => t.id === id);
        if (currentIndex > -1) {
          store.tooltips.splice(currentIndex, 1);
        }
      }, 200);
    }
  };

  const hideAllToolTips = (): void => {
    store.tooltips.forEach((tooltip) => {
      tooltip.visible = false;
    });

    setTimeout(() => {
      store.tooltips.splice(0);
    }, 200);
  };

  const updateToolTip = (id: string, options: Partial<ToolTipOptions>): void => {
    const tooltip = store.tooltips.find((t) => t.id === id);
    if (tooltip) {
      Object.assign(tooltip, options);

      // 如果更新了位置相关的选项，重新计算位置
      if (options.placement || options.offset) {
        if (tooltip.targetElement) {
          const position = calculatePosition(tooltip.targetElement, tooltip.placement!, tooltip.offset!);
          tooltip.x = position.x;
          tooltip.y = position.y;
        }
      }
    }
  };

  const findToolTipByTarget = (target: HTMLElement): ToolTipInstance | undefined => {
    return store.tooltips.find((tooltip) => tooltip.targetElement === target);
  };

  const forceHideToolTipByTarget = (target: HTMLElement): void => {
    const tooltip = findToolTipByTarget(target);
    if (tooltip) {
      hideToolTip(tooltip.id);
    }
  };

  const forceHideAllToolTips = (): void => {
    // 立即隐藏所有tooltip，包括persistent的
    store.tooltips.forEach((tooltip) => {
      tooltip.visible = false;
    });
    // 立即清空数组，不等待动画
    store.tooltips.splice(0);
  };

  return {
    tooltips: store.tooltips,
    showToolTip,
    hideToolTip,
    hideAllToolTips,
    updateToolTip,
    findToolTipByTarget,
    forceHideToolTipByTarget,
    forceHideAllToolTips
  };
};
