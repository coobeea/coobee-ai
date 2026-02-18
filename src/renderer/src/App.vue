<script setup lang="ts">
// App.vue — 根组件，负责渲染路由视图和全局 UI 容器（Message、Confirm、Tooltip 等）
import Container from '@/components/Container.vue';
</script>

<template>
  <div class="bg-background text-foreground transition-theme flex flex-col flex-1">
    <router-view />
    <Container />
  </div>
</template>
