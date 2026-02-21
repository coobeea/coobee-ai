<template>
  <teleport to="body">
    <!-- 消息容器 -->
    <div v-for="position in positions" :key="position" :class="getContainerClass(position)" class="message-container">
      <transition-group name="message" tag="div" class="message-list">
        <div
          v-for="message in getMessagesByPosition(position)"
          :key="message.id"
          :class="`message-item message-${message.type}`">
          <!-- 图标 -->
          <div :class="`message-icon message-icon-${message.type}`">
            <i :class="getIconName(message.type)" class="w-5 h-5" />
          </div>

          <!-- 消息内容 -->
          <div class="message-content">
            {{ message.content }}
          </div>

          <!-- 关闭按钮 -->
          <button class="message-close" @click="removeMessage(message.id)">
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

const getContainerClass = (position: MessagePosition): string => {
  switch (position) {
    case 'topLeft':
      return 'message-top-left';
    case 'topCenter':
      return 'message-top-center';
    case 'topRight':
      return 'message-top-right';
    case 'bottomLeft':
      return 'message-bottom-left';
    case 'bottomCenter':
      return 'message-bottom-center';
    case 'bottomRight':
      return 'message-bottom-right';
    case 'center':
      return 'message-center';
    default:
      return 'message-top-center';
  }
};

const getIconName = (type?: string): string => {
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

const removeMessage = (id: string): void => {
  messageStore.removeMessage(id);
};
</script>

<style scoped>
.message-container {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

.message-top-left {
  top: 16px;
  left: 16px;
}

.message-top-center {
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
}

.message-top-right {
  top: 16px;
  right: 16px;
}

.message-bottom-left {
  bottom: 16px;
  left: 16px;
}

.message-bottom-center {
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
}

.message-bottom-right {
  bottom: 16px;
  right: 16px;
}

.message-center {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-item {
  pointer-events: auto;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow:
    0 4px 12px hsl(var(--shadow) / 0.1),
    0 2px 6px hsl(var(--shadow) / 0.08);
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 300px;
  max-width: 500px;
}

.message-info {
  border-color: hsl(var(--primary) / 0.3);
  background: hsl(var(--primary) / 0.05);
}

.message-success {
  border-color: hsl(142 71% 45% / 0.3);
  background: hsl(142 71% 45% / 0.05);
}

.message-warning {
  border-color: hsl(45 93% 47% / 0.3);
  background: hsl(45 93% 47% / 0.05);
}

.message-error {
  border-color: hsl(var(--error) / 0.3);
  background: hsl(var(--error) / 0.05);
}

.message-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-icon-info {
  color: hsl(var(--primary));
}

.message-icon-success {
  color: hsl(142 71% 45%);
}

.message-icon-warning {
  color: hsl(45 93% 47%);
}

.message-icon-error {
  color: hsl(var(--error));
}

.message-content {
  flex: 1;
  font-size: 14px;
  color: hsl(var(--foreground));
}

.message-close {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
  border-radius: 4px;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-close:hover {
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--foreground));
}

/* 动画 */
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
