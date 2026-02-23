import type { App } from 'vue';

import ConfirmContainer from './ConfirmContainer.vue';
import { useConfirmStore } from './store';
import type { ConfirmAPI } from './types';

let installed = false;

const ConfirmPlugin = {
  install(app: App): void {
    if (installed) return;
    installed = true;

    app.component('ConfirmContainer', ConfirmContainer);

    const confirmStore = useConfirmStore();
    const confirmAPI: ConfirmAPI = {
      show: confirmStore.showConfirm,
      info: confirmStore.info,
      warning: confirmStore.warning,
      error: confirmStore.error,
      success: confirmStore.success
    };

    app.config.globalProperties.$confirm = confirmAPI;
    app.provide('$confirm', confirmAPI);
  }
};

export default ConfirmPlugin;
export { useConfirmStore };
export type { ConfirmAPI, ConfirmInstance, ConfirmOptions } from './types';
