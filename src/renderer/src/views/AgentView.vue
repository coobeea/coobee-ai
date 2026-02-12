<script setup lang="ts">
/**
 * AgentView — Agent 主视图（三栏布局）
 *
 * 布局：
 *   ┌──────────────┬──────────────────────────────┬──────────────┐
 *   │   项目空间    │          工  作  台           │    对  话     │
 *   │  (Context)   │        (Workbench)           │   (Chat)     │
 *   │   ~250px     │        flex-1 主区域          │   ~380px     │
 *   │   可折叠 ←   │                              │   可折叠 →   │
 *   └──────────────┴──────────────────────────────┴──────────────┘
 *
 * 设计哲学：
 *   - 对话只是控制手段，工作台才是核心产出
 *   - 项目空间提供上下文，工作台展示结果，对话是遥控器
 */

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ProjectPanel from '@/components/agent/ProjectPanel.vue'
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue'
import ChatPanel from '@/components/agent/ChatPanel.vue'

const router = useRouter()

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
</script>

<template>
  <div class="flex h-full w-full flex-col bg-[#f7f7f8]">
    <!-- ========== 顶部导航栏 ========== -->
    <header
      class="flex h-11 shrink-0 items-center justify-between border-b border-gray-200/80 bg-white/90 px-4 backdrop-blur"
    >
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
          <span class="i-carbon-bot inline-block h-3.5 w-3.5 text-primary"></span>
        </div>
        <h1 class="text-sm font-semibold text-gray-800">Coobee Agent</h1>
      </div>

      <div class="flex items-center gap-1">
        <!-- 左栏折叠/展开 -->
        <button
          v-if="leftCollapsed"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          title="展开项目空间"
          @click="leftCollapsed = false"
        >
          <span class="i-carbon-folder-shared inline-block h-3.5 w-3.5"></span>
          项目空间
        </button>

        <!-- 日志 -->
        <button
          class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          @click="router.push('/logs')"
        >
          <span class="i-carbon-report inline-block h-3.5 w-3.5"></span>
          日志
        </button>

        <!-- 右栏折叠/展开 -->
        <button
          v-if="rightCollapsed"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          title="展开对话"
          @click="rightCollapsed = false"
        >
          <span class="i-carbon-chat inline-block h-3.5 w-3.5"></span>
          对话
        </button>
      </div>
    </header>

    <!-- ========== 三栏主体 ========== -->
    <div class="flex min-h-0 flex-1">
      <!-- 左栏：项目空间 -->
      <ProjectPanel v-model:collapsed="leftCollapsed" />

      <!-- 中栏：工作台 -->
      <WorkbenchPanel />

      <!-- 右栏：对话 -->
      <ChatPanel v-model:collapsed="rightCollapsed" />
    </div>
  </div>
</template>
