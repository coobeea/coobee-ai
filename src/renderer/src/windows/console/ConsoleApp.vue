<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import IconMdiMonitor from '~icons/mdi/monitor'
import IconMdiWindowMaximize from '~icons/mdi/window-maximize'
import IconMdiRefresh from '~icons/mdi/refresh'
import IconMdiConsole from '~icons/mdi/console'
import IconMdiClose from '~icons/mdi/close'
import IconSvgSpinnersPulse from '~icons/svg-spinners/pulse'

// 窗口信息接口
interface WindowInfo {
  id: number
  type: string
  title: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  isVisible: boolean
  isFocused: boolean
  isMinimized: boolean
  isMaximized: boolean
  isFullScreen: boolean
}

const windows = ref<WindowInfo[]>([])
const loading = ref(false)
const autoRefresh = ref(true)
const refreshInterval = ref(3000) // 3秒刷新一次
let refreshTimer: number | null = null

// 刷新窗口列表
async function refreshWindows(): Promise<void> {
  try {
    loading.value = true
    // TODO: 等后端实现 window:getAllWindows IPC 接口后，使用真实数据
    // 目前使用模拟数据
    const result: WindowInfo[] = [
      {
        id: 1,
        type: 'agent',
        title: 'Coobee AI Shell - 窗口 1',
        bounds: { x: 100, y: 100, width: 1200, height: 800 },
        isVisible: true,
        isFocused: true,
        isMinimized: false,
        isMaximized: false,
        isFullScreen: false
      },
      {
        id: 2,
        type: 'browser',
        title: 'Browser - 窗口 2',
        bounds: { x: 150, y: 150, width: 1024, height: 768 },
        isVisible: true,
        isFocused: false,
        isMinimized: false,
        isMaximized: false,
        isFullScreen: false
      },
      {
        id: 3,
        type: 'console',
        title: 'Console - 控制台窗口',
        bounds: { x: 200, y: 200, width: 1400, height: 900 },
        isVisible: true,
        isFocused: false,
        isMinimized: false,
        isMaximized: false,
        isFullScreen: false
      }
    ]
    windows.value = result
  } catch (error) {
    console.error('[Console] 获取窗口列表失败:', error)
  } finally {
    loading.value = false
  }
}

// 启动自动刷新
function startAutoRefresh(): void {
  if (refreshTimer) return
  refreshTimer = window.setInterval(() => {
    if (autoRefresh.value) {
      refreshWindows()
    }
  }, refreshInterval.value)
  console.log('[Console] 自动刷新已启动')
}

// 停止自动刷新
function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
    console.log('[Console] 自动刷新已停止')
  }
}

// 切换自动刷新
function toggleAutoRefresh(): void {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

// 关闭窗口
function closeWindow(): void {
  window.close()
}

// 获取窗口状态样式类
function getWindowStatusClass(window: WindowInfo): string {
  if (window.isFocused) return 'border-blue-400 bg-blue-50'
  if (window.isMinimized) return 'border-gray-300 bg-gray-50'
  return 'border-gray-200 bg-white'
}

// 获取窗口状态文本
function getWindowStatus(window: WindowInfo): string {
  if (window.isFocused) return '已聚焦'
  if (window.isMinimized) return '最小化'
  if (window.isMaximized) return '最大化'
  if (window.isFullScreen) return '全屏'
  return '正常'
}

onMounted(async () => {
  await refreshWindows()
  if (autoRefresh.value) {
    startAutoRefresh()
  }
})

onBeforeUnmount(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div
    class="flex h-screen w-screen flex-col overflow-hidden bg-gradient-to-b from-gray-50 to-gray-100"
  >
    <!-- 自定义标题栏 - 可拖动 -->
    <header class="drag-region border-b border-gray-200 bg-white shadow-sm">
      <div class="flex items-center justify-between px-4 py-3">
        <!-- 左侧标题 -->
        <div class="flex items-center gap-2">
          <IconMdiConsole class="text-xl text-indigo-600" />
          <h1 class="text-sm font-semibold text-gray-800">控制台</h1>
        </div>

        <!-- 右侧关闭按钮 -->
        <button
          class="no-drag group flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-red-500"
          @click="closeWindow"
        >
          <IconMdiClose class="text-lg text-gray-600 transition group-hover:text-white" />
        </button>
      </div>
    </header>

    <!-- 操作按钮栏 -->
    <div class="border-b border-gray-200 bg-white px-4 py-2">
      <div class="flex items-center gap-2">
        <!-- 自动刷新开关 -->
        <button
          :class="[
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
            autoRefresh
              ? 'bg-green-50 text-green-700 hover:bg-green-100'
              : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
          ]"
          @click="toggleAutoRefresh"
        >
          <IconSvgSpinnersPulse v-if="autoRefresh" class="text-sm" />
          <span>{{ autoRefresh ? '自动' : '手动' }}</span>
        </button>

        <!-- 手动刷新按钮 -->
        <button
          :disabled="loading"
          class="flex items-center gap-1.5 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          @click="refreshWindows"
        >
          <IconMdiRefresh :class="{ 'animate-spin': loading }" class="text-sm" />
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto p-4">
      <!-- 统计信息卡片 -->
      <div class="mb-4 grid grid-cols-3 gap-2">
        <div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div class="flex flex-col items-center">
            <IconMdiMonitor class="mb-1 text-2xl text-blue-600" />
            <p class="text-xs text-gray-600">总数</p>
            <p class="text-xl font-bold text-gray-800">{{ windows.length }}</p>
          </div>
        </div>

        <div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div class="flex flex-col items-center">
            <IconMdiWindowMaximize class="mb-1 text-2xl text-green-600" />
            <p class="text-xs text-gray-600">可见</p>
            <p class="text-xl font-bold text-gray-800">
              {{ windows.filter((w) => w.isVisible).length }}
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div class="flex flex-col items-center">
            <span class="i-mdi-star mb-1 text-2xl text-yellow-600"></span>
            <p class="text-xs text-gray-600">聚焦</p>
            <p class="text-xl font-bold text-gray-800">
              {{ windows.filter((w) => w.isFocused).length }}
            </p>
          </div>
        </div>
      </div>

      <!-- 窗口列表 -->
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-gray-800">窗口列表</h2>

        <div
          v-if="windows.length === 0"
          class="rounded-lg border border-gray-200 bg-white p-8 text-center"
        >
          <p class="text-gray-600">暂无窗口信息</p>
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="window in windows"
            :key="window.id"
            :class="['rounded-lg border p-3 transition', getWindowStatusClass(window)]"
          >
            <!-- 窗口标题和状态 -->
            <div class="mb-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-gray-400">#{{ window.id }}</span>
                <span class="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {{ window.type }}
                </span>
                <span
                  :class="[
                    'rounded px-2 py-0.5 text-xs font-medium',
                    window.isFocused ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                  ]"
                >
                  {{ getWindowStatus(window) }}
                </span>
              </div>
            </div>

            <h3 class="mb-2 text-sm font-medium text-gray-800">{{ window.title }}</h3>

            <!-- 窗口详细信息 -->
            <div class="mb-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-gray-600">位置: </span>
                <span class="font-medium text-gray-800">
                  {{ window.bounds.x }}, {{ window.bounds.y }}
                </span>
              </div>
              <div>
                <span class="text-gray-600">尺寸: </span>
                <span class="font-medium text-gray-800">
                  {{ window.bounds.width }}×{{ window.bounds.height }}
                </span>
              </div>
            </div>

            <!-- 窗口状态标签 -->
            <div class="flex flex-wrap gap-1">
              <span
                v-if="window.isVisible"
                class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
              >
                可见
              </span>
              <span
                v-if="window.isMinimized"
                class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
              >
                最小化
              </span>
              <span
                v-if="window.isMaximized"
                class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
              >
                最大化
              </span>
              <span
                v-if="window.isFullScreen"
                class="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700"
              >
                全屏
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 拖动区域 */
.drag-region {
  -webkit-app-region: drag;
  user-select: none;
}

/* 非拖动区域（按钮等） */
.no-drag {
  -webkit-app-region: no-drag;
}
</style>
