<template>
  <teleport to="body">
    <div v-if="visibleConfirms.length > 0" :style="{ zIndex: currentZIndex }" class="fixed inset-0">
      <!-- 遮罩层 -->
      <transition name="overlay">
        <OverlayMask
          v-if="visibleConfirms.length > 0"
          :visible="visibleConfirms.length > 0"
          :z-index="0"
          :blur="true"
          :opacity="0.5"
          :background-color="'#000000'"
          @click="handleOverlayClick" />
      </transition>

      <!-- 确认对话框 -->
      <div class="fixed inset-0 z-[1] pointer-events-none flex items-center justify-center p-4">
        <transition-group name="confirm" tag="div" class="relative">
          <div
            v-for="confirm in visibleConfirms"
            :key="confirm.id"
            class="pointer-events-auto bg-background border border-border rounded-lg shadow-lg w-full mx-auto min-w-[400px] max-w-[500px]"
            :class="getConfirmClass(confirm.type)">
            <!-- 头部 -->
            <div class="flex items-center gap-3 p-6 pb-4">
              <div v-if="confirm.showIcon" :class="getIconClass(confirm.type)" class="flex-shrink-0">
                <i :class="getIconName(confirm.type)" class="w-6 h-6" />
              </div>
              <div class="flex-1">
                <h3 class="text-lg font-semibold text-foreground">{{ confirm.title }}</h3>
              </div>
            </div>

            <!-- 内容 -->
            <div class="px-6 pb-6">
              <p class="text-sm text-muted-foreground leading-relaxed">{{ confirm.message }}</p>
            </div>

            <!-- 按钮 -->
            <div class="flex gap-3 p-6 pt-0 justify-end">
              <button
                v-if="confirm.showCancelButton"
                :disabled="confirm.loading"
                class="px-4 py-2 text-sm font-medium text-muted-foreground bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                @click="handleCancel(confirm)">
                {{ confirm.cancelText }}
              </button>
              <button
                :disabled="confirm.loading"
                :class="getConfirmButtonClass(confirm.type)"
                class="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                @click="handleConfirm(confirm)">
                <i v-if="confirm.loading" class="i-mdi-loading animate-spin w-4 h-4" />
                {{ confirm.confirmText }}
              </button>
            </div>
          </div>
        </transition-group>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import OverlayMask from '@/components/OverlayMask/index.vue';
import { layerManager } from '@/utils/LayerManager';

import { useConfirmStore } from './store';
import type { ConfirmInstance } from './types';

const confirmStore = useConfirmStore();
const layerId = `confirm_${Math.random().toString(36).slice(2, 9)}`;

const visibleConfirms = computed(() => confirmStore.confirms.filter((confirm) => confirm.visible));

const getConfirmClass = (type?: string) => {
  switch (type) {
    case 'warning':
      return 'border-yellow-200 dark:border-yellow-800';
    case 'error':
      return 'border-red-200 dark:border-red-800';
    case 'success':
      return 'border-green-200 dark:border-green-800';
    default:
      return 'border-blue-200 dark:border-blue-800';
  }
};

const getIconClass = (type?: string) => {
  const baseClass = 'w-10 h-10 rounded-full flex items-center justify-center';

  switch (type) {
    case 'warning':
      return `${baseClass} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400`;
    case 'error':
      return `${baseClass} bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400`;
    case 'success':
      return `${baseClass} bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400`;
    default:
      return `${baseClass} bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400`;
  }
};

const getIconName = (type?: string) => {
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

const getConfirmButtonClass = (type?: string) => {
  switch (type) {
    case 'warning':
      return 'bg-yellow-600 hover:bg-yellow-700 text-white dark:bg-yellow-500 dark:hover:bg-yellow-600';
    case 'error':
      return 'bg-red-600 hover:bg-red-700 text-white dark:bg-red-500 dark:hover:bg-red-600';
    case 'success':
      return 'bg-green-600 hover:bg-green-700 text-white dark:bg-green-500 dark:hover:bg-green-600';
    default:
      return 'bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-500 dark:hover:bg-blue-600';
  }
};

const handleConfirm = (confirm: ConfirmInstance) => {
  if (confirm.onConfirm) {
    confirm.onConfirm();
  }
};

const handleCancel = (confirm: ConfirmInstance) => {
  if (confirm.onCancel) {
    confirm.onCancel();
  }
};

const handleOverlayClick = () => {
  // 点击遮罩层时取消最新的确认框
  const latestConfirm = visibleConfirms.value[visibleConfirms.value.length - 1];
  if (latestConfirm && !latestConfirm.loading && !latestConfirm.persistent) {
    handleCancel(latestConfirm);
  }
};

const currentZIndex = ref(0);

function handleEnterKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  if (visibleConfirms.value.length === 0) return;
  const latest = visibleConfirms.value[visibleConfirms.value.length - 1];
  if (!latest || latest.loading) return;
  event.preventDefault();
  handleConfirm(latest);
}

watch(
  () => visibleConfirms.value.length,
  (count) => {
    if (count > 0) {
      currentZIndex.value = layerManager.register(layerId, () => {
        const latest = visibleConfirms.value[visibleConfirms.value.length - 1];
        if (latest && !latest.loading && !latest.persistent) {
          handleCancel(latest);
        }
      });
      document.addEventListener('keydown', handleEnterKey);
    } else {
      layerManager.unregister(layerId);
      document.removeEventListener('keydown', handleEnterKey);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  layerManager.unregister(layerId);
  document.removeEventListener('keydown', handleEnterKey);
});
</script>

<style scoped>
/* 确认框动画 */
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
</style>
