<script setup lang="ts">
/**
 * WorkbenchPanel — 工作台（中栏）
 *
 * 展示 Agent 工作空间的内容（workspace/{session-id}/）。
 * 这是 Agent 的主要产出区域：输出文件、自建 Skill、计划等。
 *
 * V1：工作空间概览 + 目录结构展示
 * TODO：文件浏览/编辑、计划视图、多智能体状态
 */

import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

/** 从 sessionId 推导 workspace 路径（展示用，实际路径由后端管理） */
const workspaceHint = computed(() => {
  if (!chatStore.sessionId) return null
  return `workspaces/${chatStore.sessionId}/`
})

/** 工作台子目录说明 */
const directories = [
  {
    name: 'output/',
    icon: 'i-carbon-document',
    desc: '产出文件（报告、代码、文档）',
    color: 'text-blue-500'
  },
  {
    name: 'skills/',
    icon: 'i-carbon-skill-level-advanced',
    desc: 'Agent 自建的 Skill',
    color: 'text-violet-500'
  },
  { name: 'sessions/', icon: 'i-carbon-chat', desc: '会话持久化数据', color: 'text-gray-400' },
  {
    name: 'contexts/',
    icon: 'i-carbon-data-base',
    desc: 'LLM 请求上下文快照',
    color: 'text-gray-400'
  },
  {
    name: 'events/',
    icon: 'i-carbon-event-schedule',
    desc: '流式事件记录',
    color: 'text-gray-400'
  },
  { name: 'logs/', icon: 'i-carbon-report', desc: '运行日志', color: 'text-gray-400' }
]
</script>

<template>
  <main class="flex h-full min-w-0 flex-1 flex-col bg-white">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-4">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-workspace inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">工作台</span>
        <span
          v-if="chatStore.sessionId"
          class="ml-1 max-w-[200px] truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
        >
          {{ chatStore.sessionId }}
        </span>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto p-6">
      <!-- 未创建会话 -->
      <div v-if="!chatStore.sessionId" class="flex h-full flex-col items-center justify-center">
        <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-50">
          <span class="i-carbon-workspace inline-block h-10 w-10 text-gray-300"></span>
        </div>
        <h2 class="mb-2 text-base font-semibold text-gray-500">等待开始</h2>
        <p class="max-w-xs text-center text-sm leading-relaxed text-gray-400">
          发送第一条消息后，Agent 将创建工作空间。<br />
          产出的文件、计划和 Skill 都会显示在这里。
        </p>
      </div>

      <!-- 已有会话 — 工作空间概览 -->
      <div v-else class="mx-auto max-w-2xl">
        <!-- 工作空间路径 -->
        <div class="mb-6 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="i-carbon-folder-shared inline-block h-4 w-4 text-primary"></span>
            <span class="text-sm font-semibold text-gray-700">Agent 工作空间</span>
          </div>
          <p
            class="truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-gray-500 shadow-sm"
            :title="workspaceHint || ''"
          >
            {{ workspaceHint || '...' }}
          </p>
        </div>

        <!-- 目录结构 -->
        <div class="mb-6">
          <h3 class="mb-3 text-xs font-semibold tracking-wide text-gray-400">目录结构</h3>
          <div class="space-y-1">
            <div
              v-for="dir in directories"
              :key="dir.name"
              class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-gray-50"
            >
              <span :class="[dir.icon, dir.color]" class="inline-block h-4 w-4 shrink-0"></span>
              <div class="min-w-0 flex-1">
                <span class="font-mono text-xs font-medium text-gray-700">{{ dir.name }}</span>
                <p class="text-[11px] text-gray-400">{{ dir.desc }}</p>
              </div>
              <span class="i-carbon-chevron-right inline-block h-3 w-3 text-gray-300"></span>
            </div>
          </div>
        </div>

        <!-- 后续功能提示 -->
        <div class="rounded-xl border border-dashed border-gray-200 p-4 text-center">
          <p class="text-xs text-gray-400">
            后续版本将支持：文件浏览与编辑 · 计划（Plan）视图 · 多智能体协作状态
          </p>
        </div>
      </div>
    </div>
  </main>
</template>
