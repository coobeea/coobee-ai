import { reactive } from 'vue';

import type { MessageInstance, MessageOptions, MessagePosition, MessageType } from './types';

interface MessageStore {
  messages: MessageInstance[];
  defaultOptions: {
    duration: number;
    position: MessagePosition;
    showClose: boolean;
  };
}

const store = reactive<MessageStore>({
  messages: [],
  defaultOptions: {
    duration: 3000, // 默认3秒
    position: 'topCenter',
    showClose: true
  }
});

let messageIdCounter = 0;

const generateId = (): string => {
  return `message_${Date.now()}_${++messageIdCounter}`;
};

export const useMessageStore = () => {
  const addMessage = (options: MessageOptions): string => {
    const id = generateId();
    const message: MessageInstance = {
      id,
      visible: true,
      duration: store.defaultOptions.duration,
      position: store.defaultOptions.position,
      showClose: store.defaultOptions.showClose,
      ...options
    };

    store.messages.push(message);

    // 设置自动关闭定时器
    if (message.duration && message.duration > 0) {
      message.timer = window.setTimeout(() => {
        removeMessage(id);
      }, message.duration);
    }

    return id;
  };

  const removeMessage = (id: string): void => {
    const index = store.messages.findIndex((msg) => msg.id === id);
    if (index > -1) {
      const message = store.messages[index];

      // 清除定时器
      if (message.timer) {
        clearTimeout(message.timer);
      }

      // 调用关闭回调
      if (message.onClose) {
        message.onClose();
      }

      // 先设置为不可见，触发动画
      message.visible = false;

      // 延迟移除，等待动画完成
      setTimeout(() => {
        const currentIndex = store.messages.findIndex((msg) => msg.id === id);
        if (currentIndex > -1) {
          store.messages.splice(currentIndex, 1);
        }
      }, 300); // 与CSS动画时间一致
    }
  };

  const removeAllMessages = (): void => {
    store.messages.forEach((message) => {
      if (message.timer) {
        clearTimeout(message.timer);
      }
      if (message.onClose) {
        message.onClose();
      }
    });
    store.messages.length = 0;
  };

  const createMessage = (type: MessageType) => {
    return (content: string, options?: Partial<MessageOptions>): string => {
      return addMessage({
        content,
        type,
        ...options
      });
    };
  };

  return {
    messages: store.messages,
    addMessage,
    removeMessage,
    removeAllMessages,
    info: createMessage('info'),
    success: createMessage('success'),
    warning: createMessage('warning'),
    error: createMessage('error')
  };
};
