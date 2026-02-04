import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 应用全局状态管理
 * 跨窗口共享状态
 */
export const useAppStore = defineStore('app', () => {
  // State
  const theme = ref<'light' | 'dark' | 'auto'>('auto')
  const sidebarCollapsed = ref(false)
  const loading = ref(false)

  // Actions
  function setTheme(newTheme: 'light' | 'dark' | 'auto') {
    theme.value = newTheme
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setLoading(value: boolean) {
    loading.value = value
  }

  return {
    // State
    theme,
    sidebarCollapsed,
    loading,
    // Actions
    setTheme,
    toggleSidebar,
    setLoading
  }
})
