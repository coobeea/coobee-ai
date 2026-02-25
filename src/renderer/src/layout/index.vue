<script setup lang="ts">
/**
 * Layout — 全局布局容器
 *
 * 结构：
 *   ┌──────────┬────────────────────────────┐
 *   │ Sidebar  │                            │
 *   │ (220px)  │       router-view          │
 *   │          │                            │
 *   │ 新建对话  │  （各页面自行决定内部布局）  │
 *   │ 会话列表  │                            │
 *   │ ──────── │                            │
 *   │ 导航菜单  │                            │
 *   │ 设置     │                            │
 *   └──────────┴────────────────────────────┘
 *
 * 全局悬浮组件：
 *   - CopilotBubble：应用管家悬浮气泡（右下角，所有页面可见）
 */

import Sidebar from './Sidebar.vue';
import CopilotBubble from '@/components/copilot/CopilotBubble.vue';
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="flex h-full w-full">
    <!-- 左侧窄导航 (fullscreen 模式下隐藏) -->
    <Sidebar v-if="!route.meta.fullscreen" />

    <!-- 主内容区域 -->
    <main class="min-h-0 min-w-0 flex-1 overflow-hidden">
      <router-view />
    </main>

    <!-- 全局悬浮：应用管家气泡 (fullscreen 模式下隐藏) -->
    <CopilotBubble v-if="!route.meta.fullscreen" />
  </div>
</template>
