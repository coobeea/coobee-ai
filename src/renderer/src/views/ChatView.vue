<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import { useChatStore, type ChatMessage } from '@/stores/chat'

const chatStore = useChatStore()
const inputText = ref('')
const messageContainer = ref<HTMLElement | null>(null)

// 自动滚动到底部
function scrollToBottom(): void {
  nextTick(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight
    }
  })
}

// 监听消息变化，自动滚动
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
)

// 监听最后一条消息的内容变化（流式更新），自动滚动
watch(
  () => {
    const msgs = chatStore.messages
    if (msgs.length === 0) return ''
    const last = msgs[msgs.length - 1]
    return last.content + (last.thinking || '')
  },
  () => scrollToBottom()
)

// 发送消息
async function handleSend(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || chatStore.isStreaming) return

  inputText.value = ''
  await chatStore.sendMessage(text)
}

// Enter 发送，Shift+Enter 换行
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

// 获取状态标签样式
function getStatusClass(msg: ChatMessage): string {
  switch (msg.status) {
    case 'streaming':
      return 'text-blue-500'
    case 'error':
      return 'text-red-500'
    case 'done':
      return 'text-green-500'
    default:
      return 'text-gray-400'
  }
}

onMounted(() => {
  scrollToBottom()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-gray-50">
    <!-- Header -->
    <header class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-gray-800">Agent Chat</h1>
        <span
          v-if="chatStore.sessionId"
          class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
        >
          {{ chatStore.sessionId }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <!-- 连接状态 -->
        <span class="flex items-center gap-1 text-xs">
          <span
            class="inline-block h-2 w-2 rounded-full"
            :class="{
              'bg-green-500': chatStore.connectionState === 'connected',
              'bg-yellow-500': chatStore.connectionState === 'connecting',
              'bg-red-500': chatStore.connectionState === 'error',
              'bg-gray-400': chatStore.connectionState === 'disconnected'
            }"
          ></span>
          <span class="text-gray-500">{{ chatStore.connectionState }}</span>
        </span>
        <!-- 清空按钮 -->
        <button
          class="rounded-md bg-gray-100 px-3 py-1 text-sm text-gray-600 transition hover:bg-gray-200"
          @click="chatStore.clearMessages()"
        >
          清空
        </button>
      </div>
    </header>

    <!-- 消息列表 -->
    <main ref="messageContainer" class="flex-1 overflow-y-auto px-6 py-4">
      <!-- 空状态 -->
      <div v-if="chatStore.messages.length === 0" class="flex h-full items-center justify-center">
        <div class="text-center text-gray-400">
          <p class="mb-2 text-4xl">💬</p>
          <p class="text-lg">输入消息开始对话</p>
        </div>
      </div>

      <!-- 消息列表 -->
      <div v-else class="mx-auto max-w-3xl space-y-4">
        <div
          v-for="msg in chatStore.messages"
          :key="msg.id"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[80%] rounded-2xl px-4 py-3"
            :class="
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-800'
            "
          >
            <!-- 思维链（折叠） -->
            <details
              v-if="msg.thinking"
              class="mb-2 rounded-lg"
              :class="msg.role === 'user' ? 'bg-blue-700/30' : 'bg-gray-50'"
            >
              <summary
                class="cursor-pointer text-xs"
                :class="msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'"
              >
                思考过程
              </summary>
              <pre
                class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap p-2 text-xs"
                :class="msg.role === 'user' ? 'text-blue-100' : 'text-gray-500'"
                >{{ msg.thinking }}</pre
              >
            </details>

            <!-- 消息内容 -->
            <div class="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {{ msg.content }}
              <!-- 流式光标 -->
              <span
                v-if="msg.status === 'streaming'"
                class="ml-0.5 inline-block h-4 w-1 animate-pulse bg-current"
              ></span>
            </div>

            <!-- 工具调用 -->
            <div v-if="msg.toolCalls?.length" class="mt-2 space-y-1">
              <div
                v-for="(tool, idx) in msg.toolCalls"
                :key="idx"
                class="rounded-lg p-2 text-xs"
                :class="msg.role === 'user' ? 'bg-blue-700/30' : 'bg-gray-50'"
              >
                <div class="flex items-center gap-1">
                  <span class="font-mono font-semibold">{{ tool.name }}</span>
                  <span
                    class="rounded-full px-1.5 py-0.5 text-[10px]"
                    :class="{
                      'bg-yellow-100 text-yellow-700': tool.status === 'calling',
                      'bg-green-100 text-green-700': tool.status === 'done',
                      'bg-red-100 text-red-700': tool.status === 'error'
                    }"
                  >
                    {{ tool.status }}
                  </span>
                </div>
                <div
                  v-if="tool.result"
                  class="mt-1 max-h-20 overflow-y-auto font-mono"
                  :class="msg.role === 'user' ? 'text-blue-200' : 'text-gray-500'"
                >
                  {{ tool.result }}
                </div>
              </div>
            </div>

            <!-- 错误信息 -->
            <div
              v-if="msg.status === 'error' && msg.error"
              class="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600"
            >
              {{ msg.error }}
            </div>

            <!-- 状态标识 -->
            <div
              v-if="msg.role === 'assistant'"
              class="mt-1 text-right text-[10px]"
              :class="getStatusClass(msg)"
            >
              {{ msg.status === 'streaming' ? '生成中...' : msg.status === 'error' ? '错误' : '' }}
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 输入区域 -->
    <footer class="border-t border-gray-200 bg-white px-6 py-4">
      <div class="mx-auto flex max-w-3xl gap-3">
        <textarea
          v-model="inputText"
          class="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          rows="1"
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          :disabled="chatStore.isStreaming"
          @keydown="handleKeydown"
        ></textarea>
        <button
          class="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!inputText.trim() || chatStore.isStreaming"
          @click="handleSend"
        >
          {{ chatStore.isStreaming ? '生成中...' : '发送' }}
        </button>
      </div>
      <!-- 错误提示 -->
      <p v-if="chatStore.lastError" class="mx-auto mt-2 max-w-3xl text-xs text-red-500">
        {{ chatStore.lastError }}
      </p>
    </footer>
  </div>
</template>
