<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLogStore, type LogLevel, type LogCategory } from '@/stores/log'

const router = useRouter()
const logStore = useLogStore()

// ---- 过滤器 ----
const levelFilter = ref<LogLevel | 'all'>('all')
const categoryFilter = ref<LogCategory | 'all'>('all')
const searchText = ref('')
const autoScroll = ref(true)
const logContainer = ref<HTMLElement | null>(null)

// 同步过滤器到 store
watch(levelFilter, (v) => logStore.setLevelFilter(v))
watch(categoryFilter, (v) => logStore.setCategoryFilter(v))
watch(searchText, (v) => logStore.setSearchText(v))

// 自动滚动
watch(
  () => logStore.filteredLogs.length,
  () => {
    if (autoScroll.value) {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    }
  }
)

// ---- 样式映射 ----

const levelStyles: Record<LogLevel, { bg: string; text: string; label: string }> = {
  debug: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'DEBUG' },
  info: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'INFO' },
  warn: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'WARN' },
  error: { bg: 'bg-red-50', text: 'text-red-600', label: 'ERROR' }
}

const categoryStyles: Record<LogCategory, string> = {
  event: 'text-purple-600',
  ipc: 'text-cyan-600',
  window: 'text-blue-600',
  tab: 'text-indigo-600',
  app: 'text-green-600',
  system: 'text-gray-600',
  user: 'text-orange-600'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 })
}

// 所有可选的 level / category（用于下拉）
const levelOptions: (LogLevel | 'all')[] = ['all', 'debug', 'info', 'warn', 'error']
const categoryOptions: (LogCategory | 'all')[] = [
  'all',
  'event',
  'ipc',
  'window',
  'tab',
  'app',
  'system',
  'user'
]

// 统计
const stats = computed(() => logStore.stats)
</script>

<template>
  <div class="flex h-screen flex-col bg-[#f7f7f8]">
    <!-- Header -->
    <header
      class="flex h-12 shrink-0 items-center justify-between border-b border-gray-200/80 bg-white/80 px-5 backdrop-blur"
    >
      <div class="flex items-center gap-2.5">
        <!-- 返回按钮 -->
        <button
          class="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          title="返回聊天"
          @click="router.push('/chat')"
        >
          <span class="i-carbon-arrow-left inline-block h-4 w-4"></span>
        </button>
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10">
          <span class="i-carbon-report inline-block h-4 w-4 text-indigo-500"></span>
        </div>
        <h1 class="text-sm font-semibold text-gray-800">日志查看器</h1>
      </div>

      <!-- 统计 -->
      <div class="flex items-center gap-3 text-[11px]">
        <span class="text-gray-400">总计 {{ stats.total }}</span>
        <span v-if="stats.error > 0" class="font-medium text-red-500">
          {{ stats.error }} 错误
        </span>
        <span v-if="stats.warn > 0" class="font-medium text-amber-500">
          {{ stats.warn }} 警告
        </span>

        <!-- 清空按钮 -->
        <button
          class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          @click="logStore.clearLogs()"
        >
          <span class="i-carbon-trash-can inline-block h-3.5 w-3.5"></span>
          清空
        </button>
      </div>
    </header>

    <!-- 过滤栏 -->
    <div class="flex shrink-0 items-center gap-3 border-b border-gray-200/80 bg-white px-5 py-2">
      <!-- 级别过滤 -->
      <select
        v-model="levelFilter"
        class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-indigo-300"
      >
        <option v-for="opt in levelOptions" :key="opt" :value="opt">
          {{ opt === 'all' ? '全部级别' : opt.toUpperCase() }}
        </option>
      </select>

      <!-- 分类过滤 -->
      <select
        v-model="categoryFilter"
        class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-indigo-300"
      >
        <option v-for="opt in categoryOptions" :key="opt" :value="opt">
          {{ opt === 'all' ? '全部分类' : opt }}
        </option>
      </select>

      <!-- 搜索框 -->
      <div class="relative flex-1">
        <span
          class="i-carbon-search pointer-events-none absolute left-2 top-1/2 inline-block h-3.5 w-3.5 -translate-y-1/2 text-gray-300"
        ></span>
        <input
          v-model="searchText"
          type="text"
          placeholder="搜索日志..."
          class="w-full rounded-md border border-gray-200 bg-white py-1 pl-7 pr-2 text-xs text-gray-700 outline-none placeholder:text-gray-300 focus:border-indigo-300"
        />
      </div>

      <!-- 自动滚动开关 -->
      <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
        <input v-model="autoScroll" type="checkbox" class="accent-indigo-500" />
        自动滚动
      </label>
    </div>

    <!-- 日志列表 -->
    <main ref="logContainer" class="flex-1 overflow-y-auto font-mono text-[12px] leading-5">
      <!-- 空状态 -->
      <div
        v-if="logStore.filteredLogs.length === 0"
        class="flex h-full flex-col items-center justify-center"
      >
        <span class="i-carbon-document-blank mb-3 inline-block h-10 w-10 text-gray-300"></span>
        <p class="text-sm text-gray-400">暂无日志记录</p>
      </div>

      <!-- 日志条目（倒序显示，最新在最下面，filteredLogs 已是 unshift 顺序，需要翻转） -->
      <div class="px-4 py-2">
        <div
          v-for="entry in [...logStore.filteredLogs].reverse()"
          :key="entry.id"
          class="group flex items-start gap-2 border-b border-gray-100 py-1 transition hover:bg-gray-50/80"
        >
          <!-- 时间 -->
          <span class="shrink-0 text-gray-300">{{ formatTime(entry.timestamp) }}</span>

          <!-- 级别标签 -->
          <span
            class="mt-px shrink-0 rounded px-1 text-[10px] font-semibold"
            :class="[levelStyles[entry.level].bg, levelStyles[entry.level].text]"
          >
            {{ levelStyles[entry.level].label }}
          </span>

          <!-- 分类 -->
          <span
            class="mt-px shrink-0 text-[10px] font-medium"
            :class="categoryStyles[entry.category]"
          >
            [{{ entry.category }}]
          </span>

          <!-- 消息 -->
          <span class="min-w-0 flex-1 break-words text-gray-700">
            {{ entry.message }}
          </span>

          <!-- 附加数据（悬停展开） -->
          <span
            v-if="entry.data"
            class="invisible shrink-0 text-[10px] text-gray-400 group-hover:visible"
            :title="JSON.stringify(entry.data, null, 2)"
          >
            [data]
          </span>
        </div>
      </div>
    </main>
  </div>
</template>
