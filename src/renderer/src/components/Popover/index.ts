/**
 * Popover 组件
 *
 * 基本用法：
 * ```vue
 * <!-- 指令方式 -->
 * <button v-popover="'这是一个 Popover'">悬停显示</button>
 * <button v-popover.click="'点击显示'">点击显示</button>
 * <button v-popover.bottom.dark="'底部深色主题'">底部深色</button>
 *
 * <!-- 对象配置 -->
 * <button v-popover="{
 *   content: '自定义内容',
 *   placement: 'right',
 *   theme: 'light',
 *   closable: true
 * }">自定义配置</button>
 *
 * <!-- 编程式调用 -->
 * <script setup>
 * import { usePopover } from '@/components/Popover';
 *
 * const { show, hide, hideAll } = usePopover();
 *
 * const showPopover = (event) => {
 *   show(event.target, {
 *     content: '编程式显示',
 *     placement: 'top'
 *   });
 * };
 * </script>
 * ```
 *
 * 指令修饰符：
 * - 位置：.top, .bottom, .left, .right
 * - 触发：.click, .hover, .focus
 * - 主题：.dark, .light
 * - 尺寸：.small, .medium, .large
 * - 功能：.closable
 *
 * 配置选项：
 * ```typescript
 * interface PopoverOptions {
 *   content?: string;                   // 内容文本
 *   html?: boolean;                     // 是否支持 HTML
 *   placement?: PopoverPlacement;       // 显示位置
 *   trigger?: PopoverTrigger;           // 触发方式
 *   theme?: PopoverTheme;               // 主题样式
 *   size?: PopoverSize;                 // 尺寸大小
 *   arrow?: boolean;                    // 是否显示箭头
 *   closable?: boolean;                 // 是否可关闭
 *   delay?: number;                     // 显示延迟
 *   hideDelay?: number;                 // 隐藏延迟
 *   offset?: number;                    // 偏移距离
 *   disabled?: boolean;                 // 是否禁用
 *   maxWidth?: string;                  // 最大宽度
 *   minWidth?: string;                  // 最小宽度
 *   customClass?: string;               // 自定义类名
 *   zIndex?: number;                    // 层级
 *   closeOnClickOutside?: boolean;      // 点击外部关闭
 *   closeOnEsc?: boolean;               // ESC 键关闭
 *   title?: string;                     // 标题
 *   customStyle?: Record<string, string>; // 自定义样式
 * }
 * ```
 */
import type { App, DirectiveBinding } from 'vue';

import Popover from './Popover.vue';
import PopoverContainer from './PopoverContainer.vue';
import { usePopoverStore } from './store';
import type { PopoverAPI, PopoverDirectiveBinding, PopoverOptions } from './types';

// 存储元素与 popover 的映射关系
const elementPopoverMap = new WeakMap<
  HTMLElement,
  {
    id: string;
    showTimer?: number;
    hideTimer?: number;
    options: PopoverOptions;
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
const parseDirectiveValue = (binding: DirectiveBinding): PopoverOptions => {
  let options: PopoverOptions;

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
  if (binding.modifiers.hover) options.trigger = 'hover';
  if (binding.modifiers.focus) options.trigger = 'focus';

  if (binding.modifiers.dark) options.theme = 'dark';
  if (binding.modifiers.light) options.theme = 'light';

  if (binding.modifiers.small) options.size = 'small';
  if (binding.modifiers.medium) options.size = 'medium';
  if (binding.modifiers.large) options.size = 'large';

  if (binding.modifiers.closable) options.closable = true;

  // 设置默认值
  if (!options.trigger) options.trigger = 'hover';
  if (!options.placement) options.placement = 'top';
  if (!options.theme) options.theme = 'light';
  if (!options.size) options.size = 'medium';
  if (options.arrow === undefined) options.arrow = true;
  if (options.closeOnClickOutside === undefined) options.closeOnClickOutside = true;
  if (options.closeOnEsc === undefined) options.closeOnEsc = true;

  return options;
};

// 显示 popover
const showPopover = (el: HTMLElement, options: PopoverOptions) => {
  const popoverStore = usePopoverStore();
  const elementData = elementPopoverMap.get(el);

  // 清除隐藏定时器
  if (elementData?.hideTimer) {
    clearTimeout(elementData.hideTimer);
  }

  // 如果已经有 popover，先隐藏
  if (elementData?.id) {
    popoverStore.hidePopover(elementData.id);
  }

  // 设置显示定时器
  const showTimer = window.setTimeout(() => {
    const id = popoverStore.showPopover(el, options);
    elementPopoverMap.set(el, {
      ...elementData,
      id,
      options,
      showTimer: undefined,
      hideTimer: elementData?.hideTimer
    });
  }, options.delay || 100);

  elementPopoverMap.set(el, {
    ...elementData,
    id: elementData?.id || '',
    options,
    showTimer,
    hideTimer: elementData?.hideTimer
  });
};

// 隐藏 popover
const hidePopover = (el: HTMLElement) => {
  const popoverStore = usePopoverStore();
  const elementData = elementPopoverMap.get(el);

  if (!elementData) return;

  // 清除显示定时器
  if (elementData.showTimer) {
    clearTimeout(elementData.showTimer);
  }

  // 设置隐藏定时器
  const hideTimer = window.setTimeout(() => {
    if (elementData.id) {
      popoverStore.hidePopover(elementData.id);
    }
    elementPopoverMap.delete(el);
  }, elementData.options.hideDelay || 100);

  elementPopoverMap.set(el, {
    ...elementData,
    hideTimer,
    showTimer: undefined
  });
};

// 添加事件监听器
const addEventListeners = (el: HTMLElement, options: PopoverOptions) => {
  const trigger = options.trigger || 'hover';
  const listeners: any = {};

  if (trigger === 'hover') {
    listeners.mouseenter = () => showPopover(el, options);
    listeners.mouseleave = () => hidePopover(el);
    el.addEventListener('mouseenter', listeners.mouseenter);
    el.addEventListener('mouseleave', listeners.mouseleave);
  } else if (trigger === 'click') {
    listeners.click = () => {
      const elementData = elementPopoverMap.get(el);
      if (elementData?.id) {
        hidePopover(el);
      } else {
        showPopover(el, options);
      }
    };
    el.addEventListener('click', listeners.click);
  } else if (trigger === 'focus') {
    listeners.focus = () => showPopover(el, options);
    listeners.blur = () => hidePopover(el);
    el.addEventListener('focus', listeners.focus);
    el.addEventListener('blur', listeners.blur);
  }

  // 保存监听器引用
  const elementData = elementPopoverMap.get(el);
  elementPopoverMap.set(el, {
    ...elementData,
    id: elementData?.id || '',
    options,
    listeners
  });
};

// 移除事件监听器
const removeEventListeners = (el: HTMLElement) => {
  const elementData = elementPopoverMap.get(el);
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

const PopoverPlugin = {
  install(app: App) {
    // 注册全局组件
    app.component('PopoverContainer', PopoverContainer);
    app.component('Popover', Popover);

    // 创建 popover API
    const popoverStore = usePopoverStore();
    const popoverAPI: PopoverAPI = {
      show: popoverStore.showPopover,
      hide: popoverStore.hidePopover,
      hideAll: popoverStore.hideAllPopovers,
      update: popoverStore.updatePopover
    };

    // 添加到全局属性
    app.config.globalProperties.$popover = popoverAPI;

    // 提供给组合式API使用
    app.provide('$popover', popoverAPI);

    // 注册指令
    app.directive('popover', {
      mounted(el: HTMLElement, binding: PopoverDirectiveBinding) {
        const options = parseDirectiveValue(binding as DirectiveBinding);
        if (options.content && !options.disabled) {
          addEventListeners(el, options);
        }
      },

      updated(el: HTMLElement, binding: PopoverDirectiveBinding) {
        // 移除旧的事件监听器
        removeEventListeners(el);

        // 隐藏当前的 popover
        const elementData = elementPopoverMap.get(el);
        if (elementData?.id) {
          popoverStore.hidePopover(elementData.id);
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
        const elementData = elementPopoverMap.get(el);
        if (elementData) {
          if (elementData.showTimer) clearTimeout(elementData.showTimer);
          if (elementData.hideTimer) clearTimeout(elementData.hideTimer);
          if (elementData.id) {
            popoverStore.hidePopover(elementData.id);
          }
          elementPopoverMap.delete(el);
        }
      }
    });
  }
};

export default PopoverPlugin;
export { Popover, usePopoverStore };
export type { PopoverAPI, PopoverInstance, PopoverOptions } from './types';
