<script setup lang="ts">
/**
 * App.vue — 根组件
 *
 * 等待后端就绪信号后才渲染真实内容（路由视图 + 全局 UI 容器）。
 * 就绪前显示简洁的加载界面，防止前端在后端未完成初始化时发起请求。
 *
 * 就绪检测：
 *   1. IPC invoke 轮询 api.isBackendReady()
 *   2. IPC 事件 backend:ready 推送
 *   3. 5 秒超时兜底
 */

import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import Container from '@/components/Container.vue';
import ConfirmContainer from '@/components/Confirm/ConfirmContainer.vue';
import MessageContainer from '@/components/Message/MessageContainer.vue';
import StatusBar from '@/components/StatusBar.vue';
import eventBus from '@/eventbus';
import { EventTypes } from '@shared/ipc/events';
import { streamCleanup } from '@/composables/useStreamWs';
import { cleanupThreadWs } from '@/composables/useThreadWs';
import { workerCleanup } from '@/composables/useWorkerWs';
import { useCopilotStore } from '@/stores/copilot';
import { useWorkerStore } from '@/stores/worker';

const isReady = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
const route = useRoute();
const copilotStore = useCopilotStore();
const workerStore = useWorkerStore();

function markReady(): void {
  if (isReady.value) return;
  isReady.value = true;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function onBackendReady(): void {
  markReady();
}

onMounted(async () => {
  // 方式 1: 监听 IPC 事件推送
  eventBus.once(EventTypes.BACKEND_READY, onBackendReady);

  // 方式 2: 主动查询（后端可能在渲染端加载前就已就绪）
  try {
    const ready = await window.api?.isBackendReady?.();
    if (ready) {
      markReady();
      // 请求 Worker 列表
      workerStore.requestWorkers();
      return;
    }
  } catch {
    // IPC 不可用（非 Electron 环境）— 直接就绪
    markReady();
    return;
  }

  // 方式 3: 超时兜底（5 秒）
  timeoutId = setTimeout(() => {
    console.warn('[App] Backend ready timeout, proceeding anyway');
    markReady();
    // 请求 Worker 列表
    workerStore.requestWorkers();
  }, 5000);
});

onUnmounted(() => {
  eventBus.off(EventTypes.BACKEND_READY, onBackendReady);
  if (timeoutId) clearTimeout(timeoutId);

  // 清理全局监听器，防止内存泄漏
  streamCleanup();
  cleanupThreadWs();
  workerCleanup();
  copilotStore.cleanup();
});
</script>

<template>
  <!-- 加载中 -->
  <Transition name="fade">
    <div v-if="!isReady" class="app-loading">
      <div class="loading-spinner" />
      <p class="loading-text">加载中...</p>
    </div>
  </Transition>

  <!-- 真实内容 -->
  <div
    v-if="isReady"
    class="bg-background text-foreground transition-theme flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex min-h-0 flex-1 flex-col">
      <router-view />
      <Container />
    </div>
    <StatusBar v-if="!route.meta.fullscreen" />
  </div>

  <!-- 全局容器 -->
  <ConfirmContainer />
  <MessageContainer />
</template>

<style scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background, 0 0% 100%));
  z-index: 99999;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid hsl(var(--border, 0 0% 90%));
  border-top-color: hsl(var(--primary, 220 90% 56%));
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: hsl(var(--muted-foreground, 0 0% 45%));
  letter-spacing: 0.5px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-leave-to {
  opacity: 0;
}
</style>
