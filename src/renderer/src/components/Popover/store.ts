/**
 * Popover 状态管理
 */

import { reactive } from 'vue';

import type { PopoverInstance, PopoverOptions } from './types';

interface PopoverState {
  popovers: PopoverInstance[];
}

const state = reactive<PopoverState>({
  popovers: []
});

// 生成唯一 ID
const generateId = (): string => {
  return `popover_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

// 计算 Popover 位置
const calculatePosition = (
  target: HTMLElement,
  placement: string = 'top',
  offset: number = 8
): { x: number; y: number } => {
  const rect = target.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  let x = 0;
  let y = 0;

  switch (placement) {
    case 'top':
      x = rect.left + scrollX + rect.width / 2;
      y = rect.top + scrollY - offset;
      break;
    case 'top-start':
      x = rect.left + scrollX;
      y = rect.top + scrollY - offset;
      break;
    case 'top-end':
      x = rect.right + scrollX;
      y = rect.top + scrollY - offset;
      break;
    case 'bottom':
      x = rect.left + scrollX + rect.width / 2;
      y = rect.bottom + scrollY + offset;
      break;
    case 'bottom-start':
      x = rect.left + scrollX;
      y = rect.bottom + scrollY + offset;
      break;
    case 'bottom-end':
      x = rect.right + scrollX;
      y = rect.bottom + scrollY + offset;
      break;
    case 'left':
      x = rect.left + scrollX - offset;
      y = rect.top + scrollY + rect.height / 2;
      break;
    case 'left-start':
      x = rect.left + scrollX - offset;
      y = rect.top + scrollY;
      break;
    case 'left-end':
      x = rect.left + scrollX - offset;
      y = rect.bottom + scrollY;
      break;
    case 'right':
      x = rect.right + scrollX + offset;
      y = rect.top + scrollY + rect.height / 2;
      break;
    case 'right-start':
      x = rect.right + scrollX + offset;
      y = rect.top + scrollY;
      break;
    case 'right-end':
      x = rect.right + scrollX + offset;
      y = rect.bottom + scrollY;
      break;
    default:
      x = rect.left + scrollX + rect.width / 2;
      y = rect.top + scrollY - offset;
  }

  return { x, y };
};

export const usePopoverStore = () => {
  const showPopover = (target: HTMLElement, options: PopoverOptions): string => {
    const id = generateId();
    const { x, y } = calculatePosition(target, options.placement, options.offset);

    const popover: PopoverInstance = {
      id,
      target,
      options,
      visible: true,
      x,
      y,
      showTimer: null,
      hideTimer: null
    };

    state.popovers.push(popover);
    return id;
  };

  const hidePopover = (id: string): void => {
    const index = state.popovers.findIndex((popover) => popover.id === id);
    if (index > -1) {
      state.popovers[index].visible = false;
      // 延迟移除，等待动画完成
      setTimeout(() => {
        const currentIndex = state.popovers.findIndex((popover) => popover.id === id);
        if (currentIndex > -1) {
          state.popovers.splice(currentIndex, 1);
        }
      }, 200);
    }
  };

  const hideAllPopovers = (): void => {
    state.popovers.forEach((popover) => {
      popover.visible = false;
    });
    // 延迟清空，等待动画完成
    setTimeout(() => {
      state.popovers.splice(0);
    }, 200);
  };

  const updatePopover = (id: string, options: Partial<PopoverOptions>): void => {
    const popover = state.popovers.find((p) => p.id === id);
    if (popover) {
      // 更新位置
      if (options.placement || options.offset) {
        const { x, y } = calculatePosition(
          popover.target,
          options.placement || popover.options.placement,
          options.offset || popover.options.offset
        );
        popover.x = x;
        popover.y = y;
      }

      // 更新其他属性
      Object.assign(popover, options);
      Object.assign(popover.options, options);
    }
  };

  const getPopoverById = (id: string): PopoverInstance | undefined => {
    return state.popovers.find((popover) => popover.id === id);
  };

  const getPopoversByTarget = (target: HTMLElement): PopoverInstance[] => {
    return state.popovers.filter((popover) => popover.target === target);
  };

  return {
    popovers: state.popovers,
    showPopover,
    hidePopover,
    hideAllPopovers,
    updatePopover,
    getPopoverById,
    getPopoversByTarget
  };
};
