<script setup lang="ts">
import { ref } from 'vue'
import IconMdiSend from '~icons/mdi/send'
import IconMdiMenu from '~icons/mdi/menu'
import IconMdiRobot from '~icons/mdi/robot'

import type { Message } from './types'

const messages = ref<Message[]>([
  {
    id: '1',
    role: 'assistant',
    content: '你好！我是 Coobee AI 助手，有什么可以帮助你的？',
    createdAt: new Date()
  }
])

const input = ref('')

const sendMessage = () => {
  if (!input.value.trim()) return

  const userMessage: Message = {
    id: Date.now().toString(),
    role: 'user',
    content: input.value,
    createdAt: new Date()
  }

  messages.value.push(userMessage)

  // TODO: 发送到 AI 处理
  setTimeout(() => {
    messages.value.push({
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '收到你的消息：' + input.value,
      createdAt: new Date()
    })
  }, 500)

  input.value = ''
}
</script>

<template>
  <div class="flex h-screen flex-col bg-gray-50">
    <!-- Header -->
    <header class="flex h-14 items-center border-b border-gray-200 bg-white px-4">
      <button class="mr-3 rounded p-2 hover:bg-gray-100">
        <IconMdiMenu class="text-xl text-gray-600" />
      </button>
      <div class="flex items-center gap-2">
        <IconMdiRobot class="text-2xl text-blue-600" />
        <h1 class="text-lg font-semibold text-gray-800">Coobee AI Shell</h1>
      </div>
    </header>

    <!-- Messages Area -->
    <main class="flex-1 overflow-y-auto p-4">
      <div class="mx-auto max-w-3xl space-y-4">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="[
            'rounded-lg p-4',
            message.role === 'user'
              ? 'ml-auto max-w-[80%] bg-blue-600 text-white'
              : 'mr-auto max-w-[80%] bg-white shadow-sm'
          ]"
        >
          <p class="whitespace-pre-wrap">{{ message.content }}</p>
        </div>
      </div>
    </main>

    <!-- Input Area -->
    <footer class="border-t border-gray-200 bg-white p-4">
      <form @submit.prevent="sendMessage" class="mx-auto flex max-w-3xl gap-2">
        <input
          v-model="input"
          type="text"
          placeholder="输入消息..."
          class="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
          :disabled="!input.trim()"
        >
          <IconMdiSend />
          发送
        </button>
      </form>
    </footer>
  </div>
</template>
