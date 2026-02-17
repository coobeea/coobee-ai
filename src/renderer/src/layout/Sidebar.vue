<script setup lang="ts">
/**
 * Sidebar — 左侧窄导航栏
 *
 * 固定在左侧，图标式导航。
 *   - 顶部：新建会话
 *   - 中部：页面导航（Agent、日志等）
 *   - 底部：设置
 */

import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();

const activeMenuId = ref('agent');

const menuItems: MenuItem[] = [
  { id: 'agent', label: 'Agent', icon: 'i-carbon-bot', route: '/agent' },
  { id: 'logs', label: '日志', icon: 'i-carbon-report', route: '/logs' }
];

const handleMenuClick = (item: MenuItem): void => {
  router.push(item.route);
};

const handleSettings = (): void => {
  router.push('/settings');
};

const handleNewSession = (): void => {
  router.push({ path: '/agent', query: { new: '1' } });
};

const updateActiveState = (): void => {
  const name = route.name as string;
  if (name) {
    activeMenuId.value = name;
  }
};

watch(() => route.name, updateActiveState);
onMounted(() => updateActiveState());
</script>

<template>
  <div class="flex h-full w-[52px] shrink-0 flex-col bg-surface">
    <!-- 新建会话 -->
    <div class="flex items-center justify-center pb-2 pt-4">
      <button
        class="group flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-110 hover:shadow-md active:scale-95"
        title="新建会话"
        @click="handleNewSession">
        <span class="i-carbon-add inline-block h-4 w-4 transition-transform duration-300 group-hover:rotate-90"></span>
      </button>
    </div>

    <!-- 分隔线 -->
    <div class="mx-3.5 my-2 h-px bg-border"></div>

    <!-- 导航菜单 -->
    <nav class="flex flex-1 flex-col gap-1 px-2 pt-1">
      <div v-for="item in menuItems" :key="item.id" class="group relative flex justify-center">
        <!-- 激活指示条 -->
        <transition
          enter-active-class="transition-all duration-300"
          enter-from-class="scale-y-0 opacity-0"
          enter-to-class="scale-y-100 opacity-100"
          leave-active-class="transition-all duration-200"
          leave-from-class="scale-y-100 opacity-100"
          leave-to-class="scale-y-0 opacity-0">
          <div
            v-if="item.id === activeMenuId"
            class="absolute -left-2 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"></div>
        </transition>

        <button
          class="flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200"
          :class="[
            item.id === activeMenuId
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          ]"
          :title="item.label"
          @click="handleMenuClick(item)">
          <span :class="item.icon" class="inline-block h-[18px] w-[18px]"></span>
        </button>
      </div>
    </nav>

    <!-- 底部：设置 -->
    <div class="flex flex-col items-center px-2 pb-4">
      <div class="mb-2 h-px w-full bg-border"></div>
      <button
        class="group flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200"
        :class="[
          activeMenuId === 'settings'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        ]"
        title="设置"
        @click="handleSettings">
        <span
          class="i-carbon-settings inline-block h-[18px] w-[18px] transition-transform duration-500 group-hover:rotate-180"></span>
      </button>
    </div>
  </div>
</template>
