/**
 * UIStore - UI 状态管理
 *
 * 整合所有 UI 相关状态：窗口、加载、日志、Copilot 等
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/** 窗口状态 */
export type WindowStatus = 'maximized' | 'minimized' | 'normal' | 'fullscreen';

/** 侧边栏状态 */
export interface SidebarState {
  collapsed: boolean;
  width: number;
  activeTab: 'tasks' | 'tavern' | 'skills' | 'cron' | 'brain-monitor' | 'observability';
}

/** Copilot 状态 */
export interface CopilotState {
  visible: boolean;
  position: { x: number; y: number };
  minimized: boolean;
}

/**
 * UI Store
 *
 * 集中管理所有 UI 状态，减少碎片化
 */
export const useUIStore = defineStore('ui', () => {
  // ==================== State ====================

  const windowStatus = ref<WindowStatus>('normal');
  const windowFocused = ref(true);

  const sidebar = ref<SidebarState>({
    collapsed: false,
    width: 280,
    activeTab: 'tasks'
  });

  const loading = ref<Record<string, boolean>>({});
  const globalLoading = ref(false);

  const copilot = ref<CopilotState>({
    visible: false,
    position: { x: 0, y: 0 },
    minimized: false
  });

  const logVisible = ref(false);
  const preferenceVisible = ref(false);

  // ==================== Getters ====================

  const isMaximized = computed(() => windowStatus.value === 'maximized');
  const isFullscreen = computed(() => windowStatus.value === 'fullscreen');
  const isMinimized = computed(() => windowStatus.value === 'minimized');
  const isLoading = computed(() => globalLoading.value || Object.values(loading.value).some(Boolean));

  // ==================== Actions ====================

  /**
   * 设置窗口状态
   */
  function setWindowStatus(status: WindowStatus): void {
    windowStatus.value = status;
  }

  /**
   * 设置窗口焦点
   */
  function setWindowFocused(focused: boolean): void {
    windowFocused.value = focused;
  }

  /**
   * 切换侧边栏
   */
  function toggleSidebar(): void {
    sidebar.value.collapsed = !sidebar.value.collapsed;
  }

  /**
   * 设置侧边栏宽度
   */
  function setSidebarWidth(width: number): void {
    sidebar.value.width = width;
  }

  /**
   * 设置侧边栏活跃 Tab
   */
  function setSidebarTab(tab: SidebarState['activeTab']): void {
    sidebar.value.activeTab = tab;
  }

  /**
   * 设置加载状态
   */
  function setLoading(key: string, value: boolean): void {
    loading.value[key] = value;
  }

  /**
   * 设置全局加载状态
   */
  function setGlobalLoading(value: boolean): void {
    globalLoading.value = value;
  }

  /**
   * 显示/隐藏 Copilot
   */
  function toggleCopilot(): void {
    copilot.value.visible = !copilot.value.visible;
  }

  /**
   * 设置 Copilot 位置
   */
  function setCopilotPosition(x: number, y: number): void {
    copilot.value.position = { x, y };
  }

  /**
   * 最小化/恢复 Copilot
   */
  function toggleCopilotMinimized(): void {
    copilot.value.minimized = !copilot.value.minimized;
  }

  /**
   * 显示日志面板
   */
  function showLog(): void {
    logVisible.value = true;
  }

  /**
   * 隐藏日志面板
   */
  function hideLog(): void {
    logVisible.value = false;
  }

  /**
   * 切换日志面板
   */
  function toggleLog(): void {
    logVisible.value = !logVisible.value;
  }

  /**
   * 显示偏好设置
   */
  function showPreference(): void {
    preferenceVisible.value = true;
  }

  /**
   * 隐藏偏好设置
   */
  function hidePreference(): void {
    preferenceVisible.value = false;
  }

  /**
   * 切换偏好设置
   */
  function togglePreference(): void {
    preferenceVisible.value = !preferenceVisible.value;
  }

  // ==================== 返回 ====================

  return {
    // State
    windowStatus,
    windowFocused,
    sidebar,
    loading,
    globalLoading,
    copilot,
    logVisible,
    preferenceVisible,

    // Getters
    isMaximized,
    isFullscreen,
    isMinimized,
    isLoading,

    // Actions
    setWindowStatus,
    setWindowFocused,
    toggleSidebar,
    setSidebarWidth,
    setSidebarTab,
    setLoading,
    setGlobalLoading,
    toggleCopilot,
    setCopilotPosition,
    toggleCopilotMinimized,
    showLog,
    hideLog,
    toggleLog,
    showPreference,
    hidePreference,
    togglePreference
  };
});
