<script setup lang="ts">
/**
 * AgentsPanel — Agent 列表面板
 *
 * 展示所有已注册的 Agent，支持：
 * - 查看 Agent 列表（名称、描述、创建者、版本）
 * - 选中 Agent 用于对话
 * - 删除 Agent
 * - 刷新列表
 */

import { onMounted, ref } from 'vue'
import { useAgentsStore } from '@/stores/agents'

const isCollapsed = defineModel<boolean>('collapsed', { default: false })
const agentsStore = useAgentsStore()
const confirmDeleteId = ref<string | null>(null)

onMounted(() => {
  agentsStore.fetchAgents()
})

function handleSelect(agentId: string): void {
  if (agentsStore.selectedAgentId === agentId) {
    agentsStore.selectAgent(null)
  } else {
    agentsStore.selectAgent(agentId)
  }
}

async function handleDelete(agentId: string): Promise<void> {
  if (confirmDeleteId.value !== agentId) {
    confirmDeleteId.value = agentId
    return
  }
  confirmDeleteId.value = null
  await agentsStore.deleteAgent(agentId)
}

function cancelDelete(): void {
  confirmDeleteId.value = null
}
</script>

<template>
  <aside
    v-show="!isCollapsed"
    class="flex h-full w-56 shrink-0 flex-col border-l border-gray-200/80 bg-gray-50/50"
  >
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-bot inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">Agents</span>
        <span
          v-if="agentsStore.agentCount > 0"
          class="ml-1 rounded-full bg-gray-200 px-1.5 text-[10px] font-medium text-gray-500"
        >
          {{ agentsStore.agentCount }}
        </span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="刷新"
          @click="agentsStore.fetchAgents()"
        >
          <span
            class="i-carbon-renew inline-block h-3 w-3"
            :class="{ 'animate-spin': agentsStore.loading }"
          ></span>
        </button>
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="折叠"
          @click="isCollapsed = true"
        >
          <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto p-2">
      <!-- 加载中 -->
      <div
        v-if="agentsStore.loading && agentsStore.agents.length === 0"
        class="flex flex-col items-center pt-12"
      >
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin text-gray-300"></span>
        <p class="mt-2 text-[11px] text-gray-400">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading"
        class="flex flex-col items-center pt-12"
      >
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
          <span class="i-carbon-bot inline-block h-5 w-5 text-gray-400"></span>
        </div>
        <p class="mb-1 text-xs font-medium text-gray-500">暂无 Agent</p>
        <p class="text-center text-[10px] leading-relaxed text-gray-400">
          在对话中让 AI 创建专业 Agent<br />或使用 manage_agent 工具
        </p>
      </div>

      <!-- Agent 列表 -->
      <div v-else class="space-y-1">
        <!-- 当前选中提示 -->
        <div v-if="agentsStore.selectedAgent" class="mb-2 rounded-md bg-primary/5 px-2 py-1.5">
          <div class="flex items-center gap-1">
            <span class="i-carbon-checkmark-filled inline-block h-3 w-3 text-primary"></span>
            <span class="text-[10px] font-medium text-primary">
              使用: {{ agentsStore.selectedAgent.name }}
            </span>
          </div>
        </div>

        <!-- Agent 卡片 -->
        <div
          v-for="agent in agentsStore.agents"
          :key="agent.id"
          class="group cursor-pointer rounded-lg border p-2 transition-all"
          :class="[
            agentsStore.selectedAgentId === agent.id
              ? 'border-primary/30 bg-primary/5'
              : 'border-transparent bg-white hover:border-gray-200 hover:shadow-sm'
          ]"
          @click="handleSelect(agent.id)"
        >
          <!-- 标题行 -->
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="truncate text-[11px] font-medium text-gray-700">
                  {{ agent.name }}
                </span>
                <span class="shrink-0 text-[9px] text-gray-400">v{{ agent.version }}</span>
              </div>
              <p class="mt-0.5 text-[10px] leading-snug text-gray-400" :title="agent.description">
                {{
                  agent.description.length > 40
                    ? agent.description.slice(0, 40) + '...'
                    : agent.description
                }}
              </p>
            </div>

            <!-- 删除按钮 -->
            <button
              v-if="confirmDeleteId !== agent.id"
              class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-400"
              title="删除"
              @click.stop="handleDelete(agent.id)"
            >
              <span class="i-carbon-trash-can inline-block h-3 w-3"></span>
            </button>
            <div v-else class="ml-1 flex shrink-0 items-center gap-0.5" @click.stop>
              <button
                class="rounded px-1 py-0.5 text-[9px] text-red-500 transition hover:bg-red-50"
                @click.stop="handleDelete(agent.id)"
              >
                确认
              </button>
              <button
                class="rounded px-1 py-0.5 text-[9px] text-gray-400 transition hover:bg-gray-100"
                @click.stop="cancelDelete"
              >
                取消
              </button>
            </div>
          </div>

          <!-- 底部标签 -->
          <div class="mt-1.5 flex items-center gap-1">
            <span
              class="rounded-sm px-1 py-px text-[9px]"
              :class="[
                agent.createdBy === 'agent'
                  ? 'bg-blue-50 text-blue-500'
                  : 'bg-green-50 text-green-500'
              ]"
            >
              {{ agent.createdBy === 'agent' ? 'AI 创建' : '手动创建' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
