<template>
  <teleport to="body">
    <!-- 消息容器 -->
    <div
      v-for="position in positions"
      :key="position"
      :class="getContainerClass(position)"
      class="fixed z-[9999] pointer-events-none">
      <transition-group name="message" tag="div" class="space-y-2">
        <div
          v-for="message in getMessagesByPosition(position)"
          :key="message.id"
          :class="getMessageClass(message.type)"
          class="pointer-events-auto bg-background border border-border rounded-lg shadow-lg p-4 flex items-center gap-3 min-w-[300px] max-w-[500px]">
          <!-- 图标 -->
          <div :class="getIconClass(message.type)" class="flex-shrink-0 flex items-center justify-center">
            <i :class="getIconName(message.type)" class="w-5 h-5" />
          </div>

          <!-- 消息内容 -->
          <div class="flex-1 text-sm text-foreground">
            {{ message.content }}
          </div>

          <!-- 关闭按钮 -->
          <button
            class="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted flex items-center justify-center"
            @click="removeMessage(message.id)">
            <i class="i-mdi-close w-4 h-4" />
          </button>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { useMessageStore } from '@/components/Message/store';

import type { MessagePosition } from './types';

const messageStore = useMessageStore();

const positions: MessagePosition[] = [
  'topLeft',
  'topCenter',
  'topRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
  'center'
];

const getMessagesByPosition = (position: MessagePosition) => {
  return messageStore.messages.filter((message) => message.position === position);
};

const getContainerClass = (position: MessagePosition) => {
  const baseClass = 'flex flex-col';

  switch (position) {
    case 'topLeft':
      return `${baseClass} top-4 left-4`;
    case 'topCenter':
      return `${baseClass} top-4 left-1/2 transform -translate-x-1/2`;
    case 'topRight':
      return `${baseClass} top-4 right-4`;
    case 'bottomLeft':
      return `${baseClass} bottom-4 left-4`;
    case 'bottomCenter':
      return `${baseClass} bottom-4 left-1/2 transform -translate-x-1/2`;
    case 'bottomRight':
      return `${baseClass} bottom-4 right-4`;
    case 'center':
      return `${baseClass} top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2`;
    default:
      return `${baseClass} top-4 left-1/2 transform -translate-x-1/2`;
  }
};

const getMessageClass = (type?: string) => {
  switch (type) {
    case 'success':
      return 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900';
    case 'warning':
      return 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900';
    case 'error':
      return 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900';
    default:
      return 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900';
  }
};

const getIconClass = (type?: string) => {
  switch (type) {
    case 'success':
      return 'text-green-600 dark:text-green-400';
    case 'warning':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-blue-600 dark:text-blue-400';
  }
};

const getIconName = (type?: string) => {
  switch (type) {
    case 'success':
      return 'i-mdi-check-circle';
    case 'warning':
      return 'i-mdi-alert';
    case 'error':
      return 'i-mdi-alert-circle';
    default:
      return 'i-mdi-information';
  }
};

const removeMessage = (id: string) => {
  messageStore.removeMessage(id);
};
</script>

<style scoped>
/* 消息动画 */
.message-enter-active,
.message-leave-active {
  transition: all 0.3s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.message-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.message-move {
  transition: transform 0.3s ease;
}
</style>
