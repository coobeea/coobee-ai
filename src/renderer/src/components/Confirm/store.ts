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
        persistent: false,
        showCancelButton: true,
        ...options,
        onConfirm: async () => {
          try {
            if (options.onConfirm) {
              const confirmInstance = store.confirms.find((c) => c.id === id);
              if (confirmInstance) {
                confirmInstance.loading = true;
              }

              await options.onConfirm();
            }
            removeConfirm(id);
            resolve(true);
          } catch (error) {
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
      confirm.visible = false;

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
