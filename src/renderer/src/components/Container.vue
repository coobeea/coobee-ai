<template>
  <div class="relative pointer-events-none">
    <!-- 动态渲染已注册的容器组件 -->
    <component :is="container.component" v-for="container in activeContainers" :key="container.name" />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { defineAsyncComponent, markRaw, onMounted, onUnmounted, shallowRef } from 'vue';

import { zIndexManager } from '@/utils/ZIndexManager';

// 容器配置接口
interface ContainerConfig {
  name: string;
  component: Component;
  zIndex: number;
  lazy?: boolean;
  condition?: () => boolean;
  priority: number;
}

// 容器注册表
const containerRegistry = new Map<string, ContainerConfig>();

// 当前激活的容器（使用 shallowRef 避免组件对象被深度响应化）
const activeContainers = shallowRef<ContainerConfig[]>([]);

// 注册容器组件
function registerContainer(config: ContainerConfig): void {
  containerRegistry.set(config.name, config);
  updateActiveContainers();
}

// 注销容器组件
function unregisterContainer(name: string): void {
  containerRegistry.delete(name);
  updateActiveContainers();
}

// 更新激活的容器列表
function updateActiveContainers(): void {
  const containers: ContainerConfig[] = [];

  containerRegistry.forEach((config) => {
    if (config.condition && !config.condition()) {
      return;
    }
    containers.push(config);
  });

  // 按优先级排序
  containers.sort((a, b) => a.priority - b.priority);

  // 分配 z-index
  containers.forEach((container) => {
    container.zIndex = zIndexManager.bringToFront();
  });

  activeContainers.value = containers;
}

// 懒加载容器组件（使用 markRaw 标记组件不需要响应式）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyLoadContainer = (importFn: () => Promise<any>): Component => {
  return markRaw(defineAsyncComponent(importFn));
};

// 初始化默认容器
function initializeDefaultContainers(): void {
  registerContainer({
    name: 'MessageContainer',
    component: lazyLoadContainer(() => import('./Message/MessageContainer.vue')),
    zIndex: 0,
    priority: 1,
    lazy: false
  });

  registerContainer({
    name: 'ConfirmContainer',
    component: lazyLoadContainer(() => import('./Confirm/ConfirmContainer.vue')),
    zIndex: 0,
    priority: 2,
    lazy: true
  });

  registerContainer({
    name: 'PopupContainer',
    component: lazyLoadContainer(() => import('./Popup/PopupContainer.vue')),
    zIndex: 0,
    priority: 3,
    lazy: true
  });

  registerContainer({
    name: 'PopoverContainer',
    component: lazyLoadContainer(() => import('./Popover/PopoverContainer.vue')),
    zIndex: 0,
    priority: 4,
    lazy: true
  });

  registerContainer({
    name: 'ToolTipContainer',
    component: lazyLoadContainer(() => import('./ToolTip/ToolTipContainer.vue')),
    zIndex: 0,
    priority: 5,
    lazy: false
  });

  registerContainer({
    name: 'LoadingOverlay',
    component: lazyLoadContainer(() => import('./LoadingOverlay.vue')),
    zIndex: 0,
    priority: 6,
    lazy: false
  });
}

onMounted(() => {
  initializeDefaultContainers();
});

onUnmounted(() => {
  containerRegistry.clear();
  activeContainers.value = [];
});

defineExpose({
  registerContainer,
  unregisterContainer,
  updateActiveContainers
});
</script>

<style scoped>
/* 使用 Tailwind CSS 类，无需自定义样式 */
</style>
