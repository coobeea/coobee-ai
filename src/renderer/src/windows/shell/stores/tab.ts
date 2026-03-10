/**
 * Tab 状态管理
 *
 * 现在 Tab 的生命周期由主进程管理，前端 store 只负责：
 * 1. 存储从主进程同步的 Tab 状态
 * 2. 提供响应式的 Tab 数据给组件使用
 * 3. 初始化时从主进程拉取 Tab 列表
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Tab {
  id: string;
  title: string;
  icon?: string;
}

export const useTabStore = defineStore('shell-tab', () => {
  // State
  const tabs = ref<Tab[]>([]);
  const currentTabId = ref<string | null>(null);
  const isInitialized = ref(false);

  // Getters
  const currentTab = computed(() => tabs.value.find((tab) => tab.id === currentTabId.value));

  /**
   * 从主进程同步 Tab 状态
   */
  const syncFromMain = async (): Promise<void> => {
    try {
      const windowInfo = await window.api.getWindowInfo();

      if (!windowInfo) {
        console.warn('Failed to get window info');
        return;
      }

      // 同步 Tab 列表
      tabs.value = windowInfo.tabs.map((tab) => ({
        id: tab.id.toString(),
        title: tab.title,
        icon: undefined // 可以根据需要添加图标逻辑
      }));

      // 同步当前激活的 Tab
      currentTabId.value = windowInfo.currentTabId?.toString() || null;

      isInitialized.value = true;
    } catch (error) {
      console.error('Error syncing tabs from main:', error);
    }
  };

  /**
   * 更新 Tab 列表（由事件监听器调用）
   */
  const updateTabs = (newTabs: Array<{ id: number; title: string }>, activeTabId: number | null): void => {
    tabs.value = newTabs.map((tab) => ({
      id: tab.id.toString(),
      title: tab.title,
      icon: undefined
    }));

    currentTabId.value = activeTabId?.toString() || null;
  };

  return {
    tabs,
    currentTabId,
    currentTab,
    isInitialized,
    syncFromMain,
    updateTabs
  };
});
