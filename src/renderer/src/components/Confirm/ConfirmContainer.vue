<template>
  <teleport to="body">
    <!-- 遮罩层 -->
    <transition name="overlay">
      <OverlayMask
        v-if="visibleConfirms.length > 0"
        :visible="visibleConfirms.length > 0"
        :z-index="10000"
        :blur="true"
        :opacity="0.5"
        :background-color="'#000000'"
        @click="handleOverlayClick" />
    </transition>

    <!-- 确认对话框 -->
    <div class="confirm-wrapper">
      <transition-group name="confirm" tag="div" class="relative">
        <div
          v-for="confirm in visibleConfirms"
          :key="confirm.id"
          class="confirm-dialog"
          :class="`confirm-${confirm.type}`">
          <!-- 头部 -->
          <div class="confirm-header">
            <div v-if="confirm.showIcon" :class="`confirm-icon confirm-icon-${confirm.type}`">
              <i :class="getIconName(confirm.type)" class="w-6 h-6" />
            </div>
            <div class="flex-1">
              <h3 class="confirm-title">{{ confirm.title }}</h3>
            </div>
          </div>

          <!-- 内容 -->
          <div class="confirm-content">
            <p class="confirm-message">{{ confirm.message }}</p>
          </div>

          <!-- 按钮 -->
          <div class="confirm-actions">
            <button
              v-if="confirm.showCancelButton"
              :disabled="confirm.loading"
              class="confirm-btn confirm-btn-cancel"
              @click="handleCancel(confirm)">
              {{ confirm.cancelText }}
            </button>
            <button
              :disabled="confirm.loading"
              :class="`confirm-btn confirm-btn-${confirm.type}`"
              @click="handleConfirm(confirm)">
              <i v-if="confirm.loading" class="i-mdi-loading animate-spin w-4 h-4" />
              {{ confirm.confirmText }}
            </button>
          </div>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import OverlayMask from '@/components/OverlayMask/index.vue';

import { useConfirmStore } from './store';
import type { ConfirmInstance } from './types';

const confirmStore = useConfirmStore();

const visibleConfirms = computed(() => confirmStore.confirms.filter((confirm) => confirm.visible));

const getIconName = (type?: string): string => {
  switch (type) {
    case 'warning':
      return 'i-mdi-alert';
    case 'error':
      return 'i-mdi-alert-circle';
    case 'success':
      return 'i-mdi-check-circle';
    default:
      return 'i-mdi-help-circle';
  }
};

const handleConfirm = (confirm: ConfirmInstance): void => {
  if (confirm.onConfirm) {
    confirm.onConfirm();
  }
};

const handleCancel = (confirm: ConfirmInstance): void => {
  if (confirm.onCancel) {
    confirm.onCancel();
  }
};

const handleOverlayClick = (): void => {
  const latestConfirm = visibleConfirms.value[visibleConfirms.value.length - 1];
  if (latestConfirm && !latestConfirm.loading && !latestConfirm.persistent) {
    handleCancel(latestConfirm);
  }
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (visibleConfirms.value.length === 0) return;

  const latestConfirm = visibleConfirms.value[visibleConfirms.value.length - 1];
  if (!latestConfirm || latestConfirm.loading) return;

  switch (event.key) {
    case 'Enter':
      event.preventDefault();
      handleConfirm(latestConfirm);
      break;
    case 'Escape':
      if (latestConfirm.persistent) return;
      event.preventDefault();
      handleCancel(latestConfirm);
      break;
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.confirm-wrapper {
  position: fixed;
  inset: 0;
  z-index: 10001;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.confirm-dialog {
  pointer-events: auto;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow:
    0 20px 50px hsl(var(--shadow) / 0.15),
    0 8px 20px hsl(var(--shadow) / 0.1);
  width: 100%;
  margin: 0 auto;
  min-width: 400px;
  max-width: 500px;
}

.confirm-info {
  border-color: hsl(var(--primary) / 0.3);
}

.confirm-warning {
  border-color: hsl(45 93% 47% / 0.3);
}

.confirm-error {
  border-color: hsl(var(--error) / 0.3);
}

.confirm-success {
  border-color: hsl(142 71% 45% / 0.3);
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  padding-bottom: 16px;
}

.confirm-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.confirm-icon-info {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.confirm-icon-warning {
  background: hsl(45 93% 47% / 0.1);
  color: hsl(45 93% 47%);
}

.confirm-icon-error {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.confirm-icon-success {
  background: hsl(142 71% 45% / 0.1);
  color: hsl(142 71% 45%);
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.confirm-content {
  padding: 0 24px 24px;
}

.confirm-message {
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  padding: 0 24px 24px;
  justify-content: flex-end;
}

.confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirm-btn-cancel {
  color: hsl(var(--muted-foreground));
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.4);
}

.confirm-btn-cancel:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.3);
  border-color: hsl(var(--border) / 0.6);
}

.confirm-btn-info {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
}

.confirm-btn-info:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
}

.confirm-btn-warning {
  color: white;
  background: hsl(45 93% 47%);
}

.confirm-btn-warning:hover:not(:disabled) {
  background: hsl(45 93% 42%);
  box-shadow: 0 2px 8px hsl(45 93% 47% / 0.25);
}

.confirm-btn-error {
  color: hsl(var(--error-foreground));
  background: hsl(var(--error));
}

.confirm-btn-error:hover:not(:disabled) {
  background: hsl(var(--error) / 0.9);
  box-shadow: 0 2px 8px hsl(var(--error) / 0.25);
}

.confirm-btn-success {
  color: white;
  background: hsl(142 71% 45%);
}

.confirm-btn-success:hover:not(:disabled) {
  background: hsl(142 71% 40%);
  box-shadow: 0 2px 8px hsl(142 71% 45% / 0.25);
}

/* 动画 */
.confirm-enter-active,
.confirm-leave-active {
  transition: all 0.3s ease;
}

.confirm-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(-20px);
}

.confirm-leave-to {
  opacity: 0;
  transform: scale(0.9) translateY(20px);
}

.confirm-move {
  transition: transform 0.3s ease;
}

.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.3s ease;
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
</style>
