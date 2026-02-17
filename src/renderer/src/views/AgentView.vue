<script setup lang="ts">
/**
 * AgentView — Agent 主视图
 *
 * 两种状态：
 *   1. 未开始会话 → 显示欢迎页，引导选择工作目录并开始
 *   2. 会话进行中 → 三栏工作区（项目空间 | 工作台 | 对话）
 *
 * 设计哲学：
 *   - 每个会话 = 一个任务，绑定一个工作目录
 *   - 先选目录，再开始对话
 */

import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useAgentsStore } from '@/stores/agents'
import ProjectPanel from '@/components/agent/ProjectPanel.vue'
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue'
import ChatPanel from '@/components/agent/ChatPanel.vue'
import VoicePanel from '@/components/agent/VoicePanel.vue'
import AgentsPanel from '@/components/agent/AgentsPanel.vue'

const route = useRoute()
const chatStore = useChatStore()
const agentsStore = useAgentsStore()

// 监听 Sidebar 的 "新建会话" 操作
watch(
  () => route.query.new,
  (val) => {
    if (val === '1') {
      startNewSession()
    }
  }
)

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
const agentsPanelCollapsed = ref(true)

/** 是否已进入工作区 */
const isInWorkspace = ref(false)

/** 选中的工作目录 */
const selectedDir = ref<string | null>(null)

/** 是否显示 Agent 选择 */
const showAgentPicker = ref(false)

/** 是否处于工作状态（有会话或已手动进入） */
const isActive = computed(() => isInWorkspace.value || chatStore.sessionId !== null)

async function selectDirectory(): Promise<void> {
  try {
    const result = await window.electron?.ipcRenderer.invoke('dialog:openDirectory')
    if (result) {
      selectedDir.value = result
    }
  } catch (err) {
    console.warn('[AgentView] 选择目录失败:', err)
  }
}

function startSession(): void {
  isInWorkspace.value = true
  // 展开 Agent 面板供用户选择
  if (agentsStore.agentCount > 0) {
    agentsPanelCollapsed.value = false
  }
}

function startNewSession(): void {
  chatStore.clearMessages()
  isInWorkspace.value = false
  selectedDir.value = null
  agentsPanelCollapsed.value = true
}
</script>

<template>
  <div class="flex h-full w-full flex-col bg-[#f7f7f8]">
    <!-- ========== 状态 1：欢迎页（未开始会话） ========== -->
    <div v-if="!isActive" class="flex flex-1 items-center justify-center">
      <div class="flex w-[420px] flex-col items-center">
        <!-- Logo -->
        <div class="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <span class="i-carbon-bot inline-block h-8 w-8 text-primary"></span>
        </div>

        <h2 class="mb-1 text-lg font-semibold text-gray-800">开始新会话</h2>
        <p class="mb-8 text-sm text-gray-400">选择工作目录，开启一次 Agent 任务</p>

        <!-- 工作目录选择 -->
        <div class="mb-6 w-full rounded-xl border border-gray-200 bg-white p-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="i-carbon-folder-shared inline-block h-4 w-4 text-gray-500"></span>
            <span class="text-xs font-semibold text-gray-600">工作目录</span>
          </div>

          <div v-if="!selectedDir" class="flex flex-col items-center py-4">
            <p class="mb-3 text-[11px] text-gray-400">Agent 将以此目录下的文件作为工作上下文</p>
            <button
              class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
              @click="selectDirectory"
            >
              <span class="i-carbon-folder-add inline-block h-3.5 w-3.5"></span>
              选择目录
            </button>
          </div>

          <div v-else class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-[11px] text-gray-600" :title="selectedDir">
                {{ selectedDir }}
              </p>
            </div>
            <button
              class="ml-2 shrink-0 text-[11px] text-gray-400 transition hover:text-primary"
              @click="selectDirectory"
            >
              更换
            </button>
          </div>
        </div>

        <!-- Agent 选择（可选） -->
        <div class="mb-6 w-full rounded-xl border border-gray-200 bg-white p-4">
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="i-carbon-bot inline-block h-4 w-4 text-gray-500"></span>
              <span class="text-xs font-semibold text-gray-600">Agent</span>
              <span class="text-[10px] text-gray-400">（可选）</span>
            </div>
            <button
              v-if="agentsStore.agentCount > 0"
              class="text-[11px] text-gray-400 transition hover:text-primary"
              @click="showAgentPicker = !showAgentPicker"
            >
              {{ showAgentPicker ? '收起' : '选择' }}
            </button>
          </div>

          <div v-if="agentsStore.selectedAgent" class="rounded-lg bg-primary/5 px-3 py-2">
            <div class="flex items-center gap-1.5">
              <span class="i-carbon-checkmark-filled inline-block h-3 w-3 text-primary"></span>
              <span class="text-[11px] font-medium text-primary">
                {{ agentsStore.selectedAgent.name }}
              </span>
            </div>
            <p class="mt-0.5 text-[10px] text-gray-400">
              {{ agentsStore.selectedAgent.description }}
            </p>
          </div>

          <div v-else-if="agentsStore.agentCount === 0" class="py-2">
            <p class="text-[11px] text-gray-400">使用默认 Agent，或稍后在对话中创建专业 Agent</p>
          </div>

          <div v-else-if="!showAgentPicker" class="py-2">
            <p class="text-[11px] text-gray-400">未选择，将使用默认 Agent</p>
          </div>

          <!-- Agent 选择列表 -->
          <div v-if="showAgentPicker && agentsStore.agentCount > 0" class="mt-2 space-y-1">
            <button
              v-for="agent in agentsStore.agents"
              :key="agent.id"
              class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition"
              :class="[
                agentsStore.selectedAgentId === agent.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-gray-50 text-gray-600'
              ]"
              @click="
                agentsStore.selectAgent(agentsStore.selectedAgentId === agent.id ? null : agent.id)
              "
            >
              <span class="text-[11px] font-medium">{{ agent.name }}</span>
              <span class="text-[10px] text-gray-400">{{ agent.description.slice(0, 30) }}</span>
            </button>
          </div>
        </div>

        <!-- 开始按钮 -->
        <button
          class="flex items-center gap-2 rounded-xl bg-primary px-8 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90 hover:shadow-md disabled:opacity-40"
          :disabled="!selectedDir"
          @click="startSession"
        >
          <span class="i-carbon-play-filled inline-block h-4 w-4"></span>
          开始会话
        </button>

        <p v-if="!selectedDir" class="mt-3 text-[11px] text-gray-400">请先选择工作目录</p>
      </div>
    </div>

    <!-- ========== 状态 2：三栏工作区 ========== -->
    <template v-else>
      <!-- 顶部状态栏（极简） -->
      <div
        class="flex h-7 shrink-0 items-center justify-between border-b border-gray-200/60 bg-white/80 px-3"
      >
        <div class="flex items-center gap-2">
          <span
            v-if="selectedDir"
            class="truncate font-mono text-[10px] text-gray-400"
            :title="selectedDir"
          >
            {{ selectedDir }}
          </span>
          <span
            v-if="agentsStore.selectedAgent"
            class="rounded-sm bg-primary/10 px-1.5 py-px text-[10px] text-primary"
          >
            {{ agentsStore.selectedAgent.name }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="rounded px-1.5 py-0.5 text-[10px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            @click="agentsPanelCollapsed = !agentsPanelCollapsed"
          >
            Agents
          </button>
          <button
            class="rounded px-1.5 py-0.5 text-[10px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            @click="startNewSession"
          >
            新会话
          </button>
        </div>
      </div>

      <!-- 三栏主体 -->
      <div class="flex min-h-0 flex-1">
        <ProjectPanel v-model:collapsed="leftCollapsed" />
        <WorkbenchPanel />
        <ChatPanel v-model:collapsed="rightCollapsed" />
        <AgentsPanel v-model:collapsed="agentsPanelCollapsed" />
      </div>

      <!-- 底部语音栏 -->
      <VoicePanel />
    </template>
  </div>
</template>
