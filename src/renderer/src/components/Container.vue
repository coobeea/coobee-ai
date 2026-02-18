<template>
  <div class="relative pointer-events-none">
    <component :is="container.component" v-for="container in activeContainers" :key="container.name" />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { defineAsyncComponent, markRaw, onMounted, onUnmounted, shallowRef } from 'vue';

interface ContainerConfig {
  name: string;
  component: Component;
  lazy?: boolean;
  condition?: () => boolean;
  priority: number;
}

const containerRegistry = new Map<string, ContainerConfig>();
const activeContainers = shallowRef<ContainerConfig[]>([]);

function registerContainer(config: ContainerConfig): void {
  containerRegistry.set(config.name, config);
  updateActiveContainers();
}

function unregisterContainer(name: string): void {
  containerRegistry.delete(name);
  updateActiveContainers();
}

function updateActiveContainers(): void {
  const containers: ContainerConfig[] = [];

  containerRegistry.forEach((config) => {
    if (config.condition && !config.condition()) return;
    containers.push(config);
  });

  containers.sort((a, b) => a.priority - b.priority);
  activeContainers.value = containers;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyLoadContainer = (importFn: () => Promise<any>): Component => {
  return markRaw(defineAsyncComponent(importFn));
};

function initializeDefaultContainers(): void {
  registerContainer({
    name: 'MessageContainer',
    component: lazyLoadContainer(() => import('./Message/MessageContainer.vue')),
    priority: 1,
    lazy: false
  });

  registerContainer({
    name: 'ConfirmContainer',
    component: lazyLoadContainer(() => import('./Confirm/ConfirmContainer.vue')),
    priority: 2,
    lazy: true
  });

  registerContainer({
    name: 'PopoverContainer',
    component: lazyLoadContainer(() => import('./Popover/PopoverContainer.vue')),
    priority: 3,
    lazy: true
  });

  registerContainer({
    name: 'ToolTipContainer',
    component: lazyLoadContainer(() => import('./ToolTip/ToolTipContainer.vue')),
    priority: 4,
    lazy: false
  });

  registerContainer({
    name: 'LoadingOverlay',
    component: lazyLoadContainer(() => import('./LoadingOverlay.vue')),
    priority: 5,
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
