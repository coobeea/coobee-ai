<script setup lang="ts">
import { ref, computed } from 'vue'
import IconMdiPlus from '~icons/mdi/plus'
import IconMdiMinus from '~icons/mdi/minus'
import IconMdiWindowMaximize from '~icons/mdi/window-maximize'
import IconMdiWindowRestore from '~icons/mdi/window-restore'
import IconMdiClose from '~icons/mdi/close'

import { WindowChannels } from '@shared/ipc'
import TabItem from './TabItem.vue'
import { useTabStore } from '../stores/tab'
import { usePlatform } from '../composables/usePlatform'

const { isMacOS, isWindows } = usePlatform()
const tabStore = useTabStore()

const isMaximized = ref(false)

// 窗口控制
const minimizeWindow = (): void => {
  window.electron.ipcRenderer.send(WindowChannels.MINIMIZE)
}

const maximizeWindow = (): void => {
  window.electron.ipcRenderer.send(WindowChannels.MAXIMIZE)
  isMaximized.value = !isMaximized.value
}

const closeWindow = (): void => {
  window.electron.ipcRenderer.send(WindowChannels.CLOSE)
}

// 最大化图标
const MaximizeIcon = computed(() =>
  isMaximized.value ? IconMdiWindowRestore : IconMdiWindowMaximize
)

// Tab 操作：通过 IPC 与主进程通信
const handleTabClick = async (tabId: string): Promise<void> => {
  try {
    const result = await window.api.tab.switch({
      tabId: Number(tabId)
    })

    if (result.success) {
      // 操作成功后重新同步状态
      await tabStore.syncFromMain()
    } else {
      console.error('Failed to switch tab:', result.error)
    }
  } catch (error) {
    console.error('Error switching tab:', error)
  }
}

const handleTabClose = async (tabId: string): Promise<void> => {
  try {
    const result = await window.api.tab.close({
      tabId: Number(tabId)
    })

    if (result.success) {
      // 操作成功后重新同步状态
      await tabStore.syncFromMain()
    } else {
      console.error('Failed to close tab:', result.error)
    }
  } catch (error) {
    console.error('Error closing tab:', error)
  }
}

const addNewTab = async (): Promise<void> => {
  try {
    const result = await window.api.tab.create({
      title: 'New Chat',
      url: 'local://chat' // 使用 local:// 协议
    })

    if (result.success) {
      // 操作成功后重新同步状态
      await tabStore.syncFromMain()
    } else {
      console.error('Failed to create tab:', result.error)
    }
  } catch (error) {
    console.error('Error creating tab:', error)
  }
}
</script>

<template>
  <header
    class="window-drag-region flex h-9 shrink-0 items-center"
    :class="[isMacOS ? 'rounded-t-[10px] bg-gray-300/95 backdrop-blur-sm' : 'bg-gray-300']"
  >
    <!-- macOS: 左侧留空给红绿灯按钮 -->
    <div v-if="isMacOS" class="h-full w-20 shrink-0"></div>

    <!-- Tabs Container -->
    <div class="flex h-full items-center overflow-x-auto overflow-y-hidden scrollbar-hide">
      <TabItem
        v-for="tab in tabStore.tabs"
        :key="tab.id"
        :active="tab.id === tabStore.currentTabId"
        :can-close="tabStore.tabs.length > 1"
        @click="handleTabClick(tab.id)"
        @close="handleTabClose(tab.id)"
      >
        <span class="truncate">{{ tab.title }}</span>
      </TabItem>
    </div>

    <!-- New Tab Button -->
    <button
      class="window-no-drag-region flex h-full w-10 shrink-0 items-center justify-center text-gray-700 transition-colors hover:bg-gray-400 active:bg-gray-500"
      @click="addNewTab"
    >
      <IconMdiPlus class="text-base" />
    </button>

    <div class="flex-1"></div>

    <!-- Windows/Linux: 窗口控制按钮 -->
    <div v-if="isWindows" class="window-no-drag-region flex h-full">
      <!-- 最小化 -->
      <button
        class="flex h-full w-12 items-center justify-center text-gray-700 transition-colors hover:bg-gray-400 active:bg-gray-500"
        @click="minimizeWindow"
      >
        <IconMdiMinus class="text-base" />
      </button>

      <!-- 最大化/还原 -->
      <button
        class="flex h-full w-12 items-center justify-center text-gray-700 transition-colors hover:bg-gray-400 active:bg-gray-500"
        @click="maximizeWindow"
      >
        <component :is="MaximizeIcon" class="text-sm" />
      </button>

      <!-- 关闭 -->
      <button
        class="flex h-full w-12 items-center justify-center text-gray-700 transition-colors hover:bg-red-500 hover:text-white active:bg-red-600"
        @click="closeWindow"
      >
        <IconMdiClose class="text-base" />
      </button>
    </div>
  </header>
</template>

<style scoped>
/* 窗口拖拽区域 */
.window-drag-region {
  -webkit-app-region: drag;
  app-region: drag;
}

/* 非拖拽区域 */
.window-no-drag-region {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

/* 隐藏滚动条 */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>
