import { inject } from 'vue';

import type { MessageAPI } from '@/components/Message/types';

export const useMessage = (): MessageAPI => {
  const message = inject<MessageAPI>('$message');

  if (!message) {
    throw new Error('useMessage must be used within a component that has MessagePlugin installed');
  }

  return message;
};
