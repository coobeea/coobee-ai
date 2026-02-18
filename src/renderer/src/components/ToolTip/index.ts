/**
 * @description 全局 ToolTip 组件，提供丰富的提示功能。
 *
 * @example
 *
 * // 1. 在 <script setup> (组合式 API) 中使用 (推荐):
 * // =================================================================
 *
 * // 在顶层组件 (如 App.vue) 中确保注册了 <ToolTipContainer /> 组件
 *
 * // 在需要使用的组件中:
 * import { useToolTip } from '@/composables/useToolTip';
 *
 * const tooltip = useToolTip();
 *
 * const showTooltip = (event: MouseEvent) => {
 *   const target = event.target as HTMLElement;
 *   tooltip.show(target, {
 *     content: '这是一个提示信息',
 *     placement: 'top',
 *     theme: 'dark'
 *   });
 * };
 *
 * // 2. 使用指令 (推荐):
 * // =================================================================
 *
 * <template>
 *   <!-- 基础用法 -->
 *   <button v-tooltip="'这是提示信息'">悬停显示提示</button>
 *
 *   <!-- 配置选项 -->
 *   <button v-tooltip="{ content: '详细提示', placement: 'bottom', theme: 'light' }">
 *     自定义提示
 *   </button>
 *
 *   <!-- 使用修饰符 -->
 *   <button v-tooltip.bottom.click.light="'点击显示提示'">
 *     点击提示
 *   </button>
 *
 *   <!-- HTML 内容 -->
 *   <button v-tooltip="{ content: '<strong>粗体</strong>提示', html: true }">
 *     HTML 提示
 *   </button>
 * </template>
 *
 * // 3. 在 Options API 中使用:
 * // =================================================================
 *
 * export default {
 *   methods: {
 *     showTooltip(event) {
 *       this.$tooltip.show(event.target, {
 *         content: '提示信息',
 *         placement: 'top'
 *       });
 *     }
 *   }
 * }
 *
 * // 4. 可用的修饰符:
 * // =================================================================
 * // 位置修饰符: .top, .bottom, .left, .right
 * // 触发修饰符: .click, .focus (默认是 hover)
 * // 主题修饰符: .dark, .light (默认是 dark)
 *
 * // 5. 配置选项:
 * // =================================================================
 * interface ToolTipOptions {
 *   content: string;                    // 提示内容
 *   placement?: 'top' | 'bottom' | 'left' | 'right' | ...; // 位置
 *   trigger?: 'hover' | 'click' | 'focus' | 'manual';      // 触发方式
 *   delay?: number;                     // 显示延迟 (ms)
 *   hideDelay?: number;                 // 隐藏延迟 (ms)
 *   disabled?: boolean;                 // 是否禁用
 *   arrow?: boolean;                    // 是否显示箭头
 *   theme?: 'dark' | 'light';          // 主题
 *   maxWidth?: string;                  // 最大宽度
 *   offset?: number;                    // 偏移距离
 *   persistent?: boolean;               // 是否持久显示
 *   html?: boolean;                     // 是否支持 HTML
 * }
 */
import type { App, DirectiveBinding } from 'vue';

import { useToolTipStore } from './store';
import ToolTipContainer from './ToolTipContainer.vue';
import type { ToolTipAPI, ToolTipDirectiveBinding, ToolTipOptions } from './types';

// 存储元素与 tooltip 的映射关系
const elementTooltipMap = new WeakMap<
  HTMLElement,
  {
    id: string;
    showTimer?: number;
    hideTimer?: number;
    options: ToolTipOptions;
    listeners?: {
      mouseenter?: () => void;
      mouseleave?: () => void;
      click?: () => void;
      focus?: () => void;
      blur?: () => void;
    };
  }
>();

// 解析指令绑定值
const parseDirectiveValue = (binding: DirectiveBinding): ToolTipOptions => {
  let options: ToolTipOptions;

  if (typeof binding.value === 'string') {
    options = { content: binding.value };
  } else if (typeof binding.value === 'object' && binding.value !== null) {
    options = { ...binding.value };
  } else {
    options = { content: '' };
  }

  // 处理修饰符
  if (binding.modifiers.top) options.placement = 'top';
  if (binding.modifiers.bottom) options.placement = 'bottom';
  if (binding.modifiers.left) options.placement = 'left';
  if (binding.modifiers.right) options.placement = 'right';

  if (binding.modifiers.click) options.trigger = 'click';
  if (binding.modifiers.focus) options.trigger = 'focus';

  if (binding.modifiers.dark) options.theme = 'dark';
  if (binding.modifiers.light) options.theme = 'light';

  return options;
};

// 显示 tooltip
const showTooltip = (el: HTMLElement, options: ToolTipOptions) => {
  const tooltipStore = useToolTipStore();
  const elementData = elementTooltipMap.get(el);

  // 清除隐藏定时器
  if (elementData?.hideTimer) {
    clearTimeout(elementData.hideTimer);
  }

  // 如果已经有 tooltip，先隐藏
  if (elementData?.id) {
    tooltipStore.hideToolTip(elementData.id);
  }

  // 设置显示定时器
  const showTimer = window.setTimeout(() => {
    const id = tooltipStore.showToolTip(el, options);
    elementTooltipMap.set(el, {
      id,
      options,
      showTimer: undefined,
      hideTimer: elementData?.hideTimer
    });
  }, options.delay || 100);

  elementTooltipMap.set(el, {
    id: elementData?.id || '',
    options,
    showTimer,
    hideTimer: elementData?.hideTimer
  });
};

// 隐藏 tooltip
const hideTooltip = (el: HTMLElement, force = false) => {
  const tooltipStore = useToolTipStore();
  const elementData = elementTooltipMap.get(el);

  if (!elementData) return;

  // 清除显示定时器
  if (elementData.showTimer) {
    clearTimeout(elementData.showTimer);
    elementData.showTimer = undefined;
  }

  // 如果是持久化的且不是强制隐藏，不隐藏
  if (elementData.options.persistent && !force) return;

  // 清除之前的隐藏定时器
  if (elementData.hideTimer) {
    clearTimeout(elementData.hideTimer);
  }

  // 设置隐藏定时器
  const hideTimer = window.setTimeout(() => {
    if (elementData.id) {
      tooltipStore.hideToolTip(elementData.id);
    }
    elementTooltipMap.delete(el);
  }, elementData.options.hideDelay || 100);

  elementTooltipMap.set(el, {
    ...elementData,
    hideTimer,
    showTimer: undefined
  });
};

// 添加事件监听器
const addEventListeners = (el: HTMLElement, options: ToolTipOptions) => {
  const trigger = options.trigger || 'hover';
  const listeners: any = {};

  if (trigger === 'hover') {
    listeners.mouseenter = () => showTooltip(el, options);
    listeners.mouseleave = () => hideTooltip(el);
    el.addEventListener('mouseenter', listeners.mouseenter);
    el.addEventListener('mouseleave', listeners.mouseleave);
  } else if (trigger === 'click') {
    listeners.click = () => {
      const elementData = elementTooltipMap.get(el);
      const tooltipStore = useToolTipStore();
      const existingTooltip = tooltipStore.tooltips.find((t) => t.id === elementData?.id && t.visible);

      if (existingTooltip) {
        // 强制隐藏，即使是persistent
        hideTooltip(el, true);
      } else {
        showTooltip(el, options);
      }
    };
    el.addEventListener('click', listeners.click);
  } else if (trigger === 'focus') {
    listeners.focus = () => showTooltip(el, options);
    listeners.blur = () => hideTooltip(el);
    el.addEventListener('focus', listeners.focus);
    el.addEventListener('blur', listeners.blur);
  }

  // 保存监听器引用
  const elementData = elementTooltipMap.get(el);
  elementTooltipMap.set(el, {
    ...elementData,
    id: elementData?.id || '',
    options,
    listeners
  });
};

// 移除事件监听器
const removeEventListeners = (el: HTMLElement) => {
  const elementData = elementTooltipMap.get(el);
  if (!elementData || !elementData.listeners) return;

  const { listeners } = elementData;

  if (listeners.mouseenter) {
    el.removeEventListener('mouseenter', listeners.mouseenter);
  }
  if (listeners.mouseleave) {
    el.removeEventListener('mouseleave', listeners.mouseleave);
  }
  if (listeners.click) {
    el.removeEventListener('click', listeners.click);
  }
  if (listeners.focus) {
    el.removeEventListener('focus', listeners.focus);
  }
  if (listeners.blur) {
    el.removeEventListener('blur', listeners.blur);
  }
};

const ToolTipPlugin = {
  install(app: App) {
    // 注册组件
    app.component('ToolTipContainer', ToolTipContainer);

    // 创建 tooltip API
    const tooltipStore = useToolTipStore();
    const tooltipAPI: ToolTipAPI = {
      show: tooltipStore.showToolTip,
      hide: tooltipStore.hideToolTip,
      hideAll: tooltipStore.hideAllToolTips,
      update: tooltipStore.updateToolTip,
      forceHideByTarget: tooltipStore.forceHideToolTipByTarget,
      forceHideAll: tooltipStore.forceHideAllToolTips
    };

    // 添加到全局属性
    app.config.globalProperties.$tooltip = tooltipAPI;

    // 提供给组合式API使用
    app.provide('$tooltip', tooltipAPI);

    (window as any).elementTooltipMap = elementTooltipMap;
    (window as any).hideTooltip = hideTooltip;

    // 全局点击：关闭非 persistent 的 tooltip
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-tooltip-container]')) {
        tooltipStore.tooltips.forEach((tooltip) => {
          if (!tooltip.persistent && tooltip.trigger !== 'click') {
            tooltipStore.hideToolTip(tooltip.id);
          }
        });
      }
    });

    // 注册指令
    app.directive('tooltip', {
      mounted(el: HTMLElement, binding: ToolTipDirectiveBinding) {
        const options = parseDirectiveValue(binding as DirectiveBinding);
        if (options.content && !options.disabled) {
          addEventListeners(el, options);
        }
      },

      updated(el: HTMLElement, binding: ToolTipDirectiveBinding) {
        // 移除旧的事件监听器
        removeEventListeners(el);

        // 隐藏当前的 tooltip
        const elementData = elementTooltipMap.get(el);
        if (elementData?.id) {
          tooltipStore.hideToolTip(elementData.id);
        }

        // 添加新的事件监听器
        const options = parseDirectiveValue(binding as DirectiveBinding);
        if (options.content && !options.disabled) {
          addEventListeners(el, options);
        }
      },

      unmounted(el: HTMLElement) {
        // 清理
        removeEventListeners(el);
        const elementData = elementTooltipMap.get(el);
        if (elementData) {
          if (elementData.showTimer) {
            clearTimeout(elementData.showTimer);
          }
          if (elementData.hideTimer) {
            clearTimeout(elementData.hideTimer);
          }
          if (elementData.id) {
            // 强制隐藏tooltip，即使是persistent
            tooltipStore.hideToolTip(elementData.id);
          }
          elementTooltipMap.delete(el);
        }
      }
    });
  }
};

export default ToolTipPlugin;
export { useToolTipStore };
export type { ToolTipAPI, ToolTipInstance, ToolTipOptions } from './types';
