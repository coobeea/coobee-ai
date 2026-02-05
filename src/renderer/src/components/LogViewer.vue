<script setup lang="ts">
import { ref } from 'vue'
import { useLogStore, type LogLevel } from '@/stores/log'

const logStore = useLogStore()

// 组件状态
const isOpen = ref(false)
const selectedLog = ref<string | null>(null)

// 日志级别颜色映射
const levelColors: Record<LogLevel, string> = {
  debug: 'text-gray-500',
  info: 'text-blue-500',
  warn: 'text-yellow-500',
  error: 'text-red-500'
}

const levelBgColors: Record<LogLevel, string> = {
  debug: 'bg-gray-100 dark:bg-gray-800',
  info: 'bg-blue-50 dark:bg-blue-900/20',
  warn: 'bg-yellow-50 dark:bg-yellow-900/20',
  error: 'bg-red-50 dark:bg-red-900/20'
}

// 格式化时间
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}

// 格式化数据
function formatData(data: unknown): string {
  if (!data) return ''
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

// 切换日志详情
function toggleLogDetail(logId: string): void {
  selectedLog.value = selectedLog.value === logId ? null : logId
}
</script>

<template>
  <div class="fixed bottom-4 right-4 z-50">
    <!-- 浮动按钮 -->
    <button
      v-if="!isOpen"
      class="relative flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-all hover:bg-blue-600 hover:scale-110"
      title="打开日志"
      @click="isOpen = true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <!-- 日志数量徽章 -->
      <span
        v-if="logStore.stats.total > 0"
        class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold"
      >
        {{ logStore.stats.total > 99 ? '99+' : logStore.stats.total }}
      </span>
    </button>

    <!-- 日志面板（简化版） -->
    <div
      v-if="isOpen"
      class="flex h-[400px] w-[500px] flex-col rounded-lg bg-white shadow-2xl dark:bg-gray-900"
    >
      <!-- 头部 -->
      <div
        class="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700"
      >
        <div class="flex items-center gap-3">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志</h3>
          <span class="text-xs text-gray-500">{{ logStore.stats.total }} 条</span>
        </div>
        <div class="flex items-center gap-2">
          <!-- 清空按钮 -->
          <button
            class="rounded bg-red-100 px-2 py-1 text-xs text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40"
            title="清空日志"
            @click="logStore.clearLogs"
          >
            清空
          </button>
          <!-- 关闭按钮 -->
          <button
            class="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="关闭"
            @click="isOpen = false"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- 日志列表 -->
      <div class="flex-1 overflow-y-auto p-2">
        <div
          v-if="logStore.logs.length === 0"
          class="flex h-full items-center justify-center text-sm text-gray-500"
        >
          暂无日志
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="log in logStore.logs"
            :key="log.id"
            :class="[
              'rounded border p-2 transition-all cursor-pointer text-xs',
              levelBgColors[log.level],
              selectedLog === log.id ? 'ring-1 ring-blue-500' : ''
            ]"
            @click="toggleLogDetail(log.id)"
          >
            <div class="flex items-start gap-2">
              <span class="font-mono text-[10px] text-gray-500 flex-shrink-0">{{
                formatTime(log.timestamp)
              }}</span>
              <span
                :class="[
                  'font-semibold uppercase text-[10px] flex-shrink-0',
                  levelColors[log.level]
                ]"
              >
                {{ log.level }}
              </span>
              <span
                class="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] flex-shrink-0 dark:bg-gray-700"
              >
                {{ log.category }}
              </span>
              <p class="flex-1 min-w-0 text-gray-900 dark:text-gray-100 break-words">
                {{ log.message }}
              </p>
            </div>

            <!-- 展开的数据 -->
            <div v-if="selectedLog === log.id && log.data" class="mt-1.5 pl-2">
              <pre class="rounded bg-gray-100 p-1.5 text-[10px] overflow-x-auto dark:bg-gray-800">{{
                formatData(log.data)
              }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
