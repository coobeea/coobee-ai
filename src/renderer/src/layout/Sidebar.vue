<script setup lang="ts">
/**
 * Sidebar — 左侧窄导航栏
 *
 * 固定在左侧，宽度 w-14（56px），图标式导航。
 * 参考 Joythink-AI 的侧边栏风格：
 *   - 顶部：应用 Logo
 *   - 中部：页面导航（Agent、日志等）
 *   - 底部：设置
 */

import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

interface MenuItem {
  id: string
  label: string
  icon: string
  route: string
}

const router = useRouter()
const route = useRoute()

const activeMenuId = ref('agent')

const menuItems: MenuItem[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: 'i-carbon-bot',
    route: '/agent'
  },
  {
    id: 'logs',
    label: '日志',
    icon: 'i-carbon-report',
    route: '/logs'
  }
]

const handleMenuClick = (item: MenuItem): void => {
  router.push(item.route)
}

const handleSettings = (): void => {
  router.push('/settings')
}

const handleNewSession = (): void => {
  // 跳转到 agent 页面并通过 query 标记新建会话
  router.push({ path: '/agent', query: { new: '1' } })
}

const updateActiveState = (): void => {
  const name = route.name as string
  if (name) {
    activeMenuId.value = name
  }
}

watch(() => route.name, updateActiveState)

onMounted(() => {
  updateActiveState()
})
</script>

<template>
  <div class="flex h-full w-14 flex-col border-r border-gray-200/80 bg-white/95">
    <!-- 顶部 Logo + 新建会话 -->
    <div class="flex flex-col items-center gap-2 py-3">
      <div
        class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 transition-transform hover:scale-105"
      >
        <span class="i-carbon-bot inline-block h-5 w-5 text-primary"></span>
      </div>
      <button
        class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition hover:bg-primary/90 hover:shadow-md"
        title="新建会话"
        @click="handleNewSession"
      >
        <span class="i-carbon-add inline-block h-4 w-4"></span>
      </button>
    </div>

    <!-- 主菜单 -->
    <div class="flex flex-1 flex-col gap-0.5 px-1.5 py-1">
      <div v-for="item in menuItems" :key="item.id" class="group relative">
        <button
          class="flex h-10 w-full items-center justify-center rounded-lg transition-all duration-200"
          :class="[
            item.id === activeMenuId
              ? 'bg-primary text-white shadow-sm'
              : 'text-gray-400 hover:scale-105 hover:bg-gray-100 hover:text-gray-600'
          ]"
          :title="item.label"
          @click="handleMenuClick(item)"
        >
          <span
            :class="item.icon"
            class="inline-block h-5 w-5 transition-colors duration-200"
          ></span>
        </button>

        <!-- 激活指示条 -->
        <div
          v-if="item.id === activeMenuId"
          class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        ></div>
      </div>
    </div>

    <!-- 底部：设置 -->
    <div class="flex flex-col gap-0.5 border-t border-gray-200/60 px-1.5 py-3">
      <button
        class="flex h-10 w-full items-center justify-center rounded-lg transition-all duration-200"
        :class="[
          activeMenuId === 'settings'
            ? 'bg-primary text-white shadow-sm'
            : 'text-gray-400 hover:scale-105 hover:bg-gray-100 hover:text-gray-600'
        ]"
        title="设置"
        @click="handleSettings"
      >
        <span class="i-carbon-settings inline-block h-5 w-5 transition-colors duration-200"></span>
      </button>
    </div>
  </div>
</template>
