<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import { useChatStore, type ChatMessage, type PendingApproval } from '@/stores/chat'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

const chatStore = useChatStore()
const inputText = ref('')
const messageContainer = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

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
  resetTextareaHeight()
  await chatStore.sendMessage(text)
}

// Enter 发送，Shift+Enter 换行
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

// Textarea 自动高度
function autoResize(): void {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

function resetTextareaHeight(): void {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
}

// 连接状态文字
const connectionLabel = computed(() => {
  switch (chatStore.connectionState) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中...'
    case 'error':
      return '连接错误'
    default:
      return '未连接'
  }
})

// 获取状态标签样式
function getStatusIcon(msg: ChatMessage): string {
  switch (msg.status) {
    case 'streaming':
      return '正在生成...'
    case 'interrupted':
      return '等待审批...'
    case 'error':
      return '生成失败'
    default:
      return ''
  }
}

// HITL 审批决策
function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (!chatStore.sessionId || approval.decision) return
  chatStore.submitDecision(chatStore.sessionId, approval.index, decision)
}

// 获取决策标签
function getDecisionLabel(decision: HitlApprovalDecision): string {
  switch (decision) {
    case 'approve-once':
      return '已允许'
    case 'approve-always':
      return '始终允许'
    case 'reject':
      return '已拒绝'
  }
}

onMounted(() => {
  scrollToBottom()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-[#f7f7f8]">
    <!-- Header: 简洁顶栏 -->
    <header
      class="flex h-12 shrink-0 items-center justify-between border-b border-gray-200/80 bg-white/80 px-5 backdrop-blur"
    >
      <div class="flex items-center gap-2.5">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <span class="i-carbon-bot inline-block h-4 w-4 text-primary"></span>
        </div>
        <h1 class="text-sm font-semibold text-gray-800">Coobee Agent</h1>
        <span
          v-if="chatStore.sessionId"
          class="ml-1 max-w-[180px] truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
        >
          {{ chatStore.sessionId }}
        </span>
      </div>

      <div class="flex items-center gap-3">
        <!-- 连接状态指示 -->
        <div class="flex items-center gap-1.5">
          <span
            class="inline-block h-1.5 w-1.5 rounded-full"
            :class="{
              'bg-emerald-500': chatStore.connectionState === 'connected',
              'bg-amber-400': chatStore.connectionState === 'connecting',
              'bg-red-400': chatStore.connectionState === 'error',
              'bg-gray-300': chatStore.connectionState === 'disconnected'
            }"
          ></span>
          <span class="text-[11px] text-gray-400">{{ connectionLabel }}</span>
        </div>

        <!-- 新对话按钮 -->
        <button
          class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          @click="chatStore.clearMessages()"
        >
          <span class="i-carbon-add inline-block h-3.5 w-3.5"></span>
          新对话
        </button>
      </div>
    </header>

    <!-- 消息区域 -->
    <main ref="messageContainer" class="flex-1 overflow-y-auto">
      <!-- 空状态 -->
      <div
        v-if="chatStore.messages.length === 0"
        class="flex h-full flex-col items-center justify-center"
      >
        <div class="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <span class="i-carbon-chat-bot inline-block h-8 w-8 text-primary"></span>
        </div>
        <h2 class="mb-2 text-xl font-semibold text-gray-700">有什么可以帮您？</h2>
        <p class="max-w-sm text-center text-sm text-gray-400">
          输入您的问题，AI 助手将为您提供帮助。支持多轮对话、工具调用和推理分析。
        </p>
      </div>

      <!-- 消息列表 -->
      <div v-else class="mx-auto max-w-4xl px-6 py-6">
        <div v-for="msg in chatStore.messages" :key="msg.id" class="mb-6">
          <!-- 用户消息 -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div
              class="max-w-[75%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-white shadow-sm"
            >
              <div class="whitespace-pre-wrap break-words">{{ msg.content }}</div>
            </div>
          </div>

          <!-- 助手消息 -->
          <div v-else class="flex gap-3">
            <!-- 头像 -->
            <div
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10"
            >
              <span class="i-carbon-bot inline-block h-4 w-4 text-primary"></span>
            </div>

            <!-- 消息体 -->
            <div class="min-w-0 flex-1">
              <!-- 思维链（折叠） -->
              <details
                v-if="msg.thinking"
                class="mb-2 rounded-lg border border-gray-200/80 bg-gray-50"
              >
                <summary
                  class="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs text-gray-400 select-none hover:text-gray-500"
                >
                  <span class="i-carbon-idea inline-block h-3.5 w-3.5"></span>
                  思考过程
                </summary>
                <div
                  class="max-h-48 overflow-y-auto border-t border-gray-100 px-3 py-2 font-mono text-xs leading-relaxed text-gray-500 whitespace-pre-wrap"
                >
                  {{ msg.thinking }}
                </div>
              </details>

              <!-- 文本内容 -->
              <div class="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words">
                {{ msg.content }}
                <!-- 流式光标 -->
                <span v-if="msg.status === 'streaming' && !msg.content" class="inline-flex gap-1">
                  <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"></span>
                  <span
                    class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                    style="animation-delay: 0.15s"
                  ></span>
                  <span
                    class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                    style="animation-delay: 0.3s"
                  ></span>
                </span>
                <span
                  v-else-if="msg.status === 'streaming'"
                  class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-gray-400 align-text-bottom"
                ></span>
              </div>

              <!-- 工具调用 -->
              <div v-if="msg.toolCalls?.length" class="mt-3 space-y-2">
                <div
                  v-for="(tool, idx) in msg.toolCalls"
                  :key="idx"
                  class="rounded-lg border border-gray-200/80 bg-white px-3 py-2"
                >
                  <div class="flex items-center gap-2">
                    <span class="i-carbon-tool-box inline-block h-3.5 w-3.5 text-gray-400"></span>
                    <span class="font-mono text-xs font-medium text-gray-700">{{ tool.name }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      :class="{
                        'bg-amber-50 text-amber-600': tool.status === 'calling',
                        'bg-emerald-50 text-emerald-600': tool.status === 'done',
                        'bg-red-50 text-red-500': tool.status === 'error'
                      }"
                    >
                      {{
                        tool.status === 'calling'
                          ? '执行中'
                          : tool.status === 'done'
                            ? '完成'
                            : '错误'
                      }}
                    </span>
                  </div>
                  <div
                    v-if="tool.result"
                    class="mt-1.5 max-h-24 overflow-y-auto rounded bg-gray-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-500"
                  >
                    {{ tool.result }}
                  </div>
                </div>
              </div>

              <!-- HITL 审批卡片 -->
              <div v-if="msg.pendingApprovals?.length" class="mt-3 space-y-2">
                <div
                  v-for="approval in msg.pendingApprovals"
                  :key="approval.index"
                  class="rounded-lg border px-3 py-2.5"
                  :class="
                    approval.decision
                      ? approval.decision === 'reject'
                        ? 'border-red-200/80 bg-red-50/50'
                        : 'border-emerald-200/80 bg-emerald-50/50'
                      : 'border-amber-300/80 bg-amber-50/60'
                  "
                >
                  <!-- 标题行 -->
                  <div class="flex items-center gap-2">
                    <span
                      class="i-carbon-locked inline-block h-3.5 w-3.5"
                      :class="
                        approval.decision
                          ? approval.decision === 'reject'
                            ? 'text-red-500'
                            : 'text-emerald-500'
                          : 'text-amber-600'
                      "
                    ></span>
                    <span class="text-xs font-medium text-gray-700">
                      {{ approval.decision ? getDecisionLabel(approval.decision) : '需要审批' }}
                    </span>
                  </div>

                  <!-- 工具信息 -->
                  <div class="mt-1.5 flex items-center gap-2">
                    <span class="i-carbon-tool-box inline-block h-3 w-3 text-gray-400"></span>
                    <span class="font-mono text-[11px] font-medium text-gray-600">
                      {{ approval.toolName }}
                    </span>
                  </div>

                  <!-- 参数（可折叠） -->
                  <details v-if="approval.arguments" class="mt-1.5">
                    <summary
                      class="cursor-pointer text-[10px] text-gray-400 select-none hover:text-gray-500"
                    >
                      查看参数
                    </summary>
                    <div
                      class="mt-1 max-h-20 overflow-y-auto rounded bg-white/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-gray-500 whitespace-pre-wrap"
                    >
                      {{ approval.arguments }}
                    </div>
                  </details>

                  <!-- 决策按钮（未决策时显示） -->
                  <div v-if="!approval.decision" class="mt-2.5 flex gap-2">
                    <button
                      class="flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-600"
                      @click="handleApproval(approval, 'approve-once')"
                    >
                      <span class="i-carbon-checkmark inline-block h-3 w-3"></span>
                      允许一次
                    </button>
                    <button
                      class="flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-600"
                      @click="handleApproval(approval, 'approve-always')"
                    >
                      <span class="i-carbon-checkmark-filled inline-block h-3 w-3"></span>
                      始终允许
                    </button>
                    <button
                      class="flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-red-600"
                      @click="handleApproval(approval, 'reject')"
                    >
                      <span class="i-carbon-close inline-block h-3 w-3"></span>
                      拒绝
                    </button>
                  </div>
                </div>
              </div>

              <!-- 错误信息 -->
              <div
                v-if="msg.status === 'error' && msg.error"
                class="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"
              >
                <span class="i-carbon-warning-alt mt-0.5 inline-block h-3.5 w-3.5 shrink-0"></span>
                <span>{{ msg.error }}</span>
              </div>

              <!-- 状态标识 -->
              <div v-if="getStatusIcon(msg)" class="mt-1.5 text-[11px] text-gray-400">
                {{ getStatusIcon(msg) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 输入区域 -->
    <footer class="shrink-0 border-t border-gray-200/80 bg-white px-6 pb-5 pt-4">
      <div class="mx-auto max-w-4xl">
        <div
          class="flex items-end gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-sm transition-colors focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
        >
          <textarea
            ref="textareaRef"
            v-model="inputText"
            class="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
            rows="1"
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            :disabled="chatStore.isStreaming"
            @keydown="handleKeydown"
            @input="autoResize"
          ></textarea>
          <button
            class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition"
            :class="
              inputText.trim() && !chatStore.isStreaming
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-gray-100 text-gray-300'
            "
            :disabled="!inputText.trim() || chatStore.isStreaming"
            @click="handleSend"
          >
            <span
              v-if="chatStore.isStreaming"
              class="i-carbon-stop-filled inline-block h-4 w-4"
            ></span>
            <span v-else class="i-carbon-send-alt inline-block h-4 w-4"></span>
          </button>
        </div>
        <!-- 错误提示 -->
        <p v-if="chatStore.lastError" class="mt-2 flex items-center gap-1 text-xs text-red-500">
          <span class="i-carbon-warning inline-block h-3 w-3"></span>
          {{ chatStore.lastError }}
        </p>
      </div>
    </footer>
  </div>
</template>
