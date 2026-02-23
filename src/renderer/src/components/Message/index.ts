import type { App } from 'vue';

import MessageContainer from './MessageContainer.vue';
import { useMessageStore } from './store';
import type { MessageAPI } from './types';

let installed = false;

const MessagePlugin = {
  install(app: App): void {
    if (installed) return;
    installed = true;

    app.component('MessageContainer', MessageContainer);

    const messageStore = useMessageStore();
    const messageAPI: MessageAPI = {
      show: messageStore.addMessage,
      info: messageStore.info,
      success: messageStore.success,
      warning: messageStore.warning,
      error: messageStore.error,
      removeAll: messageStore.removeAllMessages
    };

    app.config.globalProperties.$message = messageAPI;
    app.provide('$message', messageAPI);
  }
};

export default MessagePlugin;
export { useMessageStore };
export type { MessageAPI, MessageInstance, MessageOptions } from './types';
