<script setup lang="ts">
import { ref } from 'vue'
import { useLogStore, type LogLevel, type LogCategory, type LogEntry } from '@/stores/log'

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

// 复制日志
async function copyLog(log: LogEntry): Promise<void> {
  const text = `[${formatTime(log.timestamp)}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? `\nData: ${formatData(log.data)}` : ''}`
  await navigator.clipboard.writeText(text)
}

// 复制所有日志
async function copyAllLogs(): Promise<void> {
  const text = logStore.exportLogsAsText()
  await navigator.clipboard.writeText(text)
}

// 下载日志
function downloadLogs(): void {
  const text = logStore.exportLogsAsText()
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `logs-${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// 级别选项
const levelOptions: Array<{ value: LogLevel | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' }
]

// 分类选项
const categoryOptions: Array<{ value: LogCategory | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'event', label: 'Event' },
  { value: 'ipc', label: 'IPC' },
  { value: 'window', label: 'Window' },
  { value: 'tab', label: 'Tab' },
  { value: 'app', label: 'App' },
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' }
]
</script>

<template>
  <div class="fixed bottom-4 right-4 z-50">
    <!-- 浮动按钮 -->
    <button
      v-if="!isOpen"
      class="relative flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-all hover:bg-blue-600 hover:scale-110"
      title="打开日志查看器"
      @click="isOpen = true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6"
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

    <!-- 日志面板 -->
    <div
      v-if="isOpen"
      class="flex h-[600px] w-[800px] flex-col rounded-lg bg-white shadow-2xl dark:bg-gray-900"
    >
      <!-- 头部 -->
      <div
        class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700"
      >
        <div class="flex items-center gap-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">日志查看器</h3>
          <div class="flex gap-2 text-sm">
            <span class="text-gray-500">总计: {{ logStore.stats.total }}</span>
            <span v-if="logStore.stats.error > 0" class="text-red-500">
              错误: {{ logStore.stats.error }}
            </span>
            <span v-if="logStore.stats.warn > 0" class="text-yellow-500">
              警告: {{ logStore.stats.warn }}
            </span>
          </div>
        </div>
        <button
          class="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="关闭"
          @click="isOpen = false"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
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

      <!-- 过滤器 -->
      <div
        class="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-700"
      >
        <!-- 级别过滤 -->
        <select
          v-model="logStore.filterLevel"
          class="rounded border border-gray-300 bg-white px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          <option v-for="opt in levelOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <!-- 分类过滤 -->
        <select
          v-model="logStore.filterCategory"
          class="rounded border border-gray-300 bg-white px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <!-- 搜索 -->
        <input
          v-model="logStore.searchText"
          type="text"
          placeholder="搜索日志..."
          class="flex-1 rounded border border-gray-300 bg-white px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        />

        <!-- 操作按钮 -->
        <button
          class="rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          title="重置过滤器"
          @click="logStore.resetFilters"
        >
          重置
        </button>
        <button
          class="rounded bg-blue-100 px-3 py-1 text-sm text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40"
          title="复制所有日志"
          @click="copyAllLogs"
        >
          复制
        </button>
        <button
          class="rounded bg-green-100 px-3 py-1 text-sm text-green-700 transition-colors hover:bg-green-200 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40"
          title="下载日志"
          @click="downloadLogs"
        >
          下载
        </button>
        <button
          class="rounded bg-red-100 px-3 py-1 text-sm text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40"
          title="清除所有日志"
          @click="logStore.clearLogs"
        >
          清除
        </button>
      </div>

      <!-- 日志列表 -->
      <div class="flex-1 overflow-y-auto p-4">
        <div
          v-if="logStore.filteredLogs.length === 0"
          class="flex h-full items-center justify-center text-gray-500"
        >
          暂无日志
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="log in logStore.filteredLogs"
            :key="log.id"
            :class="[
              'rounded-lg border p-3 transition-all cursor-pointer',
              levelBgColors[log.level],
              selectedLog === log.id ? 'ring-2 ring-blue-500' : ''
            ]"
            @click="toggleLogDetail(log.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-sm">
                  <span class="font-mono text-xs text-gray-500">{{
                    formatTime(log.timestamp)
                  }}</span>
                  <span :class="['font-semibold uppercase', levelColors[log.level]]">
                    {{ log.level }}
                  </span>
                  <span class="rounded bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">
                    {{ log.category }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-gray-900 dark:text-gray-100">{{ log.message }}</p>

                <!-- 展开的数据 -->
                <div v-if="selectedLog === log.id && log.data" class="mt-2">
                  <pre class="rounded bg-gray-100 p-2 text-xs overflow-x-auto dark:bg-gray-800">{{
                    formatData(log.data)
                  }}</pre>
                </div>
              </div>

              <!-- 复制按钮 -->
              <button
                class="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                title="复制日志"
                @click.stop="copyLog(log)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path
                    d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
