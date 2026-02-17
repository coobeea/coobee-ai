<script setup lang="ts">
// App.vue — 根组件，负责渲染路由视图和全局 UI 容器（Message、Confirm、Tooltip 等）
import Container from '@/components/Container.vue';
</script>

<template>
  <router-view />
  <Container />
</template>
