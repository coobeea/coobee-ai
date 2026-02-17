<script setup lang="ts">
/**
 * Layout — 全局布局容器
 *
 * 结构：
 *   ┌────┬──────────────────────────────────┐
 *   │    │                                  │
 *   │ S  │         router-view              │
 *   │ i  │                                  │
 *   │ d  │    （各页面自行决定内部布局）       │
 *   │ e  │                                  │
 *   │ b  │                                  │
 *   │ a  │                                  │
 *   │ r  │                                  │
 *   │    │                                  │
 *   └────┴──────────────────────────────────┘
 */

import Sidebar from './Sidebar.vue'
</script>

<template>
  <div class="flex h-full w-full">
    <!-- 左侧窄导航 -->
    <Sidebar />

    <!-- 主内容区域 -->
    <main class="min-w-0 flex-1">
      <router-view />
    </main>
  </div>
</template>
