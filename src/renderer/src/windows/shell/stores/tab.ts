/**
 * Tab 状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Tab {
  id: string
  title: string
  icon?: string
}

export const useTabStore = defineStore('shell-tab', () => {
  // State
  const tabs = ref<Tab[]>([
    {
      id: '1',
      title: 'Chat',
      icon: 'mdi:robot'
    }
  ])

  const currentTabId = ref<string>('1')

  // Getters
  const currentTab = computed(() => tabs.value.find((tab) => tab.id === currentTabId.value))

  // Actions
  const addTab = (title = 'New Tab'): void => {
    const newTab: Tab = {
      id: Date.now().toString(),
      title
    }
    tabs.value.push(newTab)
    currentTabId.value = newTab.id
  }

  const removeTab = (id: string): void => {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index === -1) return

    // 如果删除的是当前 Tab，切换到前一个或后一个
    if (currentTabId.value === id) {
      const nextIndex = index > 0 ? index - 1 : index + 1
      currentTabId.value = tabs.value[nextIndex]?.id || ''
    }

    tabs.value.splice(index, 1)

    // 如果删除后没有 Tab 了，创建一个新的
    if (tabs.value.length === 0) {
      addTab('Chat')
    }
  }

  const setCurrentTab = (id: string): void => {
    if (tabs.value.some((tab) => tab.id === id)) {
      currentTabId.value = id
    }
  }

  return {
    tabs,
    currentTabId,
    currentTab,
    addTab,
    removeTab,
    setCurrentTab
  }
})
