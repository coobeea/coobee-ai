<script setup lang="ts">
import { onMounted } from 'vue'
import AppBar from './components/AppBar.vue'
import { useTabStore } from './stores/tab'

const tabStore = useTabStore()

// 初始化：从主进程同步 Tab 状态
onMounted(async () => {
  await tabStore.syncFromMain()
})
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-gray-50">
    <!-- Title Bar with Tabs -->
    <AppBar />

    <!-- Main Content Area -->
    <!-- WebContentsView will be rendered here by the main process -->
    <main class="content-container relative flex-1 overflow-hidden"></main>
  </div>
</template>
