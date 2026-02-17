import type { App } from 'vue';

import Popup from './index.vue';
import PopupContainer from './PopupContainer.vue';

// 导出类型
export type { PopupPosition, PopupTransition } from './index.vue';

// 导出组件
export { Popup, PopupContainer };

// 创建插件
export default {
  install(app: App) {
    app.component('Popup', Popup);
    app.component('PopupContainer', PopupContainer);
  }
};

// 组合式函数：使用弹出层
export function usePopup() {
  const getPopupManager = () => {
    if (typeof window !== 'undefined') {
      return (window as any).__POPUP_MANAGER__;
    }
    return null;
  };

  const getNextZIndex = () => {
    const manager = getPopupManager();
    return manager ? manager.getNextZIndex() : 1000;
  };

  const addPopup = (id: string) => {
    const manager = getPopupManager();
    return manager ? manager.addPopup(id) : getNextZIndex();
  };

  const removePopup = (id: string) => {
    const manager = getPopupManager();
    if (manager) {
      manager.removePopup(id);
    }
  };

  return {
    getNextZIndex,
    addPopup,
    removePopup
  };
}
