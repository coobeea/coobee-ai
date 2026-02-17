import { reactive } from 'vue';

import type { ConfirmInstance, ConfirmOptions } from './types';

interface ConfirmStore {
  confirms: ConfirmInstance[];
  defaultOptions: {
    title: string;
    confirmText: string;
    cancelText: string;
    type: 'info' | 'warning' | 'error' | 'success';
    showIcon: boolean;
  };
}

const store = reactive<ConfirmStore>({
  confirms: [],
  defaultOptions: {
    title: '确认',
    confirmText: '确定',
    cancelText: '取消',
    type: 'info',
    showIcon: true
  }
});

let confirmIdCounter = 0;

const generateId = (): string => {
  return `confirm_${Date.now()}_${++confirmIdCounter}`;
};

export const useConfirmStore = () => {
  const showConfirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = generateId();
      const confirm: ConfirmInstance = {
        id,
        visible: true,
        loading: false,
        title: store.defaultOptions.title,
        confirmText: store.defaultOptions.confirmText,
        cancelText: store.defaultOptions.cancelText,
        type: store.defaultOptions.type,
        showIcon: store.defaultOptions.showIcon,
        persistent: false, // 默认非持久
        showCancelButton: true, // 默认显示取消按钮
        ...options,
        onConfirm: async () => {
          try {
            if (options.onConfirm) {
              // 设置加载状态
              const confirmInstance = store.confirms.find((c) => c.id === id);
              if (confirmInstance) {
                confirmInstance.loading = true;
              }

              await options.onConfirm();
            }
            removeConfirm(id);
            resolve(true);
          } catch (error) {
            // 如果确认回调出错，移除加载状态但不关闭对话框
            const confirmInstance = store.confirms.find((c) => c.id === id);
            if (confirmInstance) {
              confirmInstance.loading = false;
            }
            console.error('Confirm callback error:', error);
          }
        },
        onCancel: () => {
          if (options.onCancel) {
            options.onCancel();
          }
          removeConfirm(id);
          resolve(false);
        }
      };

      store.confirms.push(confirm);
    });
  };

  const removeConfirm = (id: string): void => {
    const index = store.confirms.findIndex((confirm) => confirm.id === id);
    if (index > -1) {
      const confirm = store.confirms[index];

      // 先设置为不可见，触发动画
      confirm.visible = false;

      // 延迟移除，等待动画完成
      setTimeout(() => {
        const currentIndex = store.confirms.findIndex((c) => c.id === id);
        if (currentIndex > -1) {
          store.confirms.splice(currentIndex, 1);
        }
      }, 300);
    }
  };

  const createConfirm = (type: 'info' | 'warning' | 'error' | 'success') => {
    return (message: string, options?: Partial<ConfirmOptions>): Promise<boolean> => {
      return showConfirm({
        message,
        type,
        ...options
      });
    };
  };

  return {
    confirms: store.confirms,
    showConfirm,
    removeConfirm,
    info: createConfirm('info'),
    warning: createConfirm('warning'),
    error: createConfirm('error'),
    success: createConfirm('success')
  };
};
