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
    duration: 3000,
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

      if (message.timer) {
        clearTimeout(message.timer);
      }

      if (message.onClose) {
        message.onClose();
      }

      message.visible = false;

      setTimeout(() => {
        const currentIndex = store.messages.findIndex((msg) => msg.id === id);
        if (currentIndex > -1) {
          store.messages.splice(currentIndex, 1);
        }
      }, 300);
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
