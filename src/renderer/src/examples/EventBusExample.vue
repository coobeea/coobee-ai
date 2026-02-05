<template>
  <div class="p-6">
    <h2 class="mb-4 text-2xl font-bold">EventBus 使用示例</h2>

    <!-- 事件日志 -->
    <div class="mb-6 rounded-lg bg-gray-100 p-4">
      <h3 class="mb-2 font-semibold">事件日志</h3>
      <div class="max-h-60 overflow-y-auto">
        <div
          v-for="(log, index) in eventLogs"
          :key="index"
          class="mb-1 rounded bg-white px-3 py-2 text-sm"
        >
          <span class="font-mono text-blue-600">{{ log.type }}</span>
          <span class="ml-2 text-gray-600">{{ log.time }}</span>
          <pre class="mt-1 text-xs text-gray-700">{{ JSON.stringify(log.payload, null, 2) }}</pre>
        </div>
      </div>
      <button
        class="mt-2 rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
        @click="clearLogs"
      >
        清空日志
      </button>
    </div>

    <!-- Tab 事件监听状态 -->
    <div class="mb-6 rounded-lg bg-blue-50 p-4">
      <h3 class="mb-2 font-semibold">Tab 事件监听</h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-gray-600">Tab 创建次数: {{ tabCreatedCount }}</p>
          <p class="text-sm text-gray-600">Tab 关闭次数: {{ tabClosedCount }}</p>
        </div>
        <div>
          <p class="text-sm text-gray-600">Tab 激活次数: {{ tabActivatedCount }}</p>
          <p class="text-sm text-gray-600">Tab 更新次数: {{ tabUpdatedCount }}</p>
        </div>
      </div>
    </div>

    <!-- 前端触发事件示例 -->
    <div class="rounded-lg bg-green-50 p-4">
      <h3 class="mb-2 font-semibold">前端触发事件（测试）</h3>
      <p class="mb-3 text-sm text-gray-600">这些事件只在前端内部触发，不会发送到主进程</p>
      <div class="flex gap-2">
        <button
          class="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          @click="emitTestEvent('tab:created')"
        >
          触发 Tab 创建
        </button>
        <button
          class="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          @click="emitTestEvent('tab:closed')"
        >
          触发 Tab 关闭
        </button>
        <button
          class="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
          @click="emitTestEvent('tab:activated')"
        >
          触发 Tab 激活
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEventBus } from '@/composables/useEventBus'
import { EventTypes } from '@shared/ipc/events'
import type { EventPayloads } from '@shared/ipc/events'

// 使用 EventBus Composable
const { on, emit } = useEventBus()

// 事件日志
interface EventLog {
  type: string
  time: string
  payload: unknown
}

const eventLogs = ref<EventLog[]>([])
const tabCreatedCount = ref(0)
const tabClosedCount = ref(0)
const tabActivatedCount = ref(0)
const tabUpdatedCount = ref(0)

// 添加日志
function addLog(type: string, payload: unknown): void {
  const now = new Date()
  const time = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`
  eventLogs.value.unshift({ type, time, payload })

  // 限制日志数量
  if (eventLogs.value.length > 20) {
    eventLogs.value.pop()
  }
}

// 监听 Tab 事件
on(EventTypes.TAB_CREATED, (payload) => {
  tabCreatedCount.value++
  addLog(EventTypes.TAB_CREATED, payload)
})

on(EventTypes.TAB_CLOSED, (payload) => {
  tabClosedCount.value++
  addLog(EventTypes.TAB_CLOSED, payload)
})

on(EventTypes.TAB_ACTIVATED, (payload) => {
  tabActivatedCount.value++
  addLog(EventTypes.TAB_ACTIVATED, payload)
})

on(EventTypes.TAB_UPDATED, (payload) => {
  tabUpdatedCount.value++
  addLog(EventTypes.TAB_UPDATED, payload)
})

// 前端触发测试事件
function emitTestEvent(type: 'tab:created' | 'tab:closed' | 'tab:activated'): void {
  const testPayloads = {
    'tab:created': {
      windowId: 999,
      tabId: Math.floor(Math.random() * 1000),
      title: '测试 Tab',
      url: 'local://test',
      position: 0
    },
    'tab:closed': {
      windowId: 999,
      tabId: Math.floor(Math.random() * 1000)
    },
    'tab:activated': {
      windowId: 999,
      tabId: Math.floor(Math.random() * 1000),
      previousTabId: null
    }
  }

  const payload = testPayloads[type] as EventPayloads[keyof EventPayloads]
  emit(type as keyof EventPayloads, payload)
}

// 清空日志
function clearLogs(): void {
  eventLogs.value = []
  tabCreatedCount.value = 0
  tabClosedCount.value = 0
  tabActivatedCount.value = 0
  tabUpdatedCount.value = 0
}
</script>
