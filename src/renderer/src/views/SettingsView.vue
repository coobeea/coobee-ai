<script setup lang="ts">
/**
 * SettingsView — 设置页面（容器）
 *
 * 左右分栏布局：
 * - 左侧：一级导航菜单
 * - 右侧：动态加载子组件
 */

import { ref, shallowRef, markRaw } from 'vue';
import BasicSettings from './settings/BasicSettings.vue';
import ModelSettings from './settings/ModelSettings.vue';
import ModelGroupSettings from './settings/ModelGroupSettings.vue';
import WorkersSettings from './settings/WorkersSettings.vue';
import MemorySettings from './settings/MemorySettings.vue';
import AboutView from './settings/AboutView.vue';

// 一级导航状态
const menuItems = [
  { id: 'basic', label: '基本配置', icon: 'i-carbon-settings', component: markRaw(BasicSettings) },
  { id: 'models', label: '模型设置', icon: 'i-carbon-machine-learning-model', component: markRaw(ModelSettings) },
  {
    id: 'model-groups',
    label: '模型分组',
    icon: 'i-carbon-group-objects',
    component: markRaw(ModelGroupSettings)
  },
  { id: 'workers', label: '内置服务', icon: 'i-carbon-cube', component: markRaw(WorkersSettings) },
  { id: 'memory', label: '记忆管理', icon: 'i-carbon-cognitive', component: markRaw(MemorySettings) },
  { id: 'about', label: '关于我们', icon: 'i-carbon-information', component: markRaw(AboutView) }
];

const activeMenu = ref('basic'); // 默认显示基本配置

// 获取当前激活的组件 (使用 shallowRef 避免深度响应式)
const activeComponent = shallowRef(menuItems[0].component);

function selectMenu(menuId: string): void {
  activeMenu.value = menuId;
  const menuItem = menuItems.find((item) => item.id === menuId);
  if (menuItem) {
    activeComponent.value = menuItem.component;
  }
}
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- 左侧：一级导航菜单 -->
    <div class="flex w-56 flex-col border-r border-border bg-card">
      <div class="p-4 border-b border-border">
        <h1 class="text-base font-bold">系统设置</h1>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <div class="flex flex-col gap-1">
          <button
            v-for="item in menuItems"
            :key="item.id"
            :class="[
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left',
              activeMenu === item.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            ]"
            @click="selectMenu(item.id)">
            <span :class="[item.icon, 'inline-block h-4 w-4']"></span>
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：动态内容区域 -->
    <div class="flex-1 overflow-hidden">
      <component :is="activeComponent" />
    </div>
  </div>
</template>
