import type { App } from 'vue';

import MessageContainer from './MessageContainer.vue';
import { useMessageStore } from './store';
import type { MessageAPI } from './types';

const MessagePlugin = {
  install(app: App) {
    // 注册组件
    app.component('MessageContainer', MessageContainer);

    // 创建message API
    const messageStore = useMessageStore();
    const messageAPI: MessageAPI = {
      show: messageStore.addMessage,
      info: messageStore.info,
      success: messageStore.success,
      warning: messageStore.warning,
      error: messageStore.error,
      removeAll: messageStore.removeAllMessages
    };

    // 添加到全局属性
    app.config.globalProperties.$message = messageAPI;

    // 提供给组合式API使用
    app.provide('$message', messageAPI);
  }
};

export default MessagePlugin;
export { useMessageStore };
export type { MessageAPI, MessageInstance, MessageOptions } from './types';
