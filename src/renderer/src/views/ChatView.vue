<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore, type PendingApproval } from '@/stores/chat'
import { wsService } from '@/plugins/wsSetup'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

const router = useRouter()

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

// 连接状态文字（从 wsService 读取，连接管理不属于 chatStore）
const connectionLabel = computed(() => {
  switch (wsService.connectionState.value) {
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
              'bg-emerald-500': wsService.connectionState.value === 'connected',
              'bg-amber-400': wsService.connectionState.value === 'connecting',
              'bg-red-400': wsService.connectionState.value === 'error',
              'bg-gray-300': wsService.connectionState.value === 'disconnected'
            }"
          ></span>
          <span class="text-[11px] text-gray-400">{{ connectionLabel }}</span>
        </div>

        <!-- 日志按钮 -->
        <button
          class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          @click="router.push('/logs')"
        >
          <span class="i-carbon-report inline-block h-3.5 w-3.5"></span>
          日志
        </button>

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

            <!-- 消息体：事件块时间线 -->
            <div class="min-w-0 flex-1 space-y-2">
              <!-- ========== [start] 流开始标记 ========== -->
              <div
                v-if="msg.status !== 'sending'"
                class="flex items-center gap-2 text-[11px] text-gray-400"
              >
                <span class="i-carbon-play-filled inline-block h-3 w-3 text-emerald-400"></span>
                <span class="font-mono">run:start</span>
                <span class="h-px flex-1 bg-gray-200"></span>
              </div>

              <!-- ========== [thinking] 思维链块 ========== -->
              <div
                v-if="msg.thinking"
                class="rounded-lg border-l-[3px] border-l-violet-300 bg-violet-50/50 px-3 py-2"
              >
                <div class="mb-1 flex items-center gap-1.5">
                  <span
                    class="rounded bg-violet-100 px-1 py-px font-mono text-[10px] font-semibold text-violet-500"
                  >
                    thinking
                  </span>
                  <span class="i-carbon-idea inline-block h-3 w-3 text-violet-400"></span>
                </div>
                <details open>
                  <summary
                    class="cursor-pointer text-[11px] text-violet-400 select-none hover:text-violet-500"
                  >
                    思考过程（点击折叠）
                  </summary>
                  <div
                    class="mt-1 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed text-gray-500 whitespace-pre-wrap"
                  >
                    {{ msg.thinking }}
                  </div>
                </details>
              </div>

              <!-- ========== [text] 文本内容块 ========== -->
              <div
                v-if="msg.content || msg.status === 'streaming'"
                class="rounded-lg border-l-[3px] border-l-blue-300 bg-white px-3 py-2"
              >
                <div class="mb-1 flex items-center gap-1.5">
                  <span
                    class="rounded bg-blue-100 px-1 py-px font-mono text-[10px] font-semibold text-blue-500"
                  >
                    text
                  </span>
                </div>
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
              </div>

              <!-- ========== [tool_call → tool_result] 工具调用闭环块 ========== -->
              <div
                v-for="(tool, idx) in msg.toolCalls"
                :key="'tool-' + idx"
                class="overflow-hidden rounded-lg border shadow-sm"
                :class="{
                  'border-amber-200': tool.status === 'calling',
                  'border-emerald-200': tool.status === 'done',
                  'border-red-200': tool.status === 'error'
                }"
              >
                <!-- ---- 顶栏：闭环状态总览 ---- -->
                <div
                  class="flex items-center gap-1.5 px-3 py-1.5"
                  :class="{
                    'bg-amber-50': tool.status === 'calling',
                    'bg-emerald-50': tool.status === 'done',
                    'bg-red-50': tool.status === 'error'
                  }"
                >
                  <span class="i-carbon-tool-box inline-block h-3.5 w-3.5 text-gray-500"></span>
                  <span class="font-mono text-xs font-semibold text-gray-700">{{ tool.name }}</span>
                  <span class="mx-1 h-px flex-1 border-t border-dashed border-gray-300"></span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :class="{
                      'bg-amber-100 text-amber-700': tool.status === 'calling',
                      'bg-emerald-100 text-emerald-700': tool.status === 'done',
                      'bg-red-100 text-red-600': tool.status === 'error'
                    }"
                  >
                    {{
                      tool.status === 'calling'
                        ? '执行中'
                        : tool.status === 'done'
                          ? '完成'
                          : '失败'
                    }}
                  </span>
                </div>

                <!-- ---- tool_call 区域 ---- -->
                <div class="border-t border-gray-100 bg-white px-3 py-2">
                  <div class="mb-1 flex items-center gap-1.5">
                    <span
                      class="rounded px-1 py-px font-mono text-[10px] font-semibold"
                      :class="{
                        'bg-amber-100 text-amber-600': tool.status === 'calling',
                        'bg-emerald-100 text-emerald-600': tool.status === 'done',
                        'bg-red-100 text-red-500': tool.status === 'error'
                      }"
                    >
                      tool_call
                    </span>
                    <span class="text-[10px] text-gray-400">调用参数</span>
                  </div>
                  <div
                    v-if="tool.arguments"
                    class="max-h-20 overflow-y-auto rounded bg-gray-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-500"
                  >
                    {{ tool.arguments }}
                  </div>
                  <span v-else class="text-[11px] text-gray-300 italic"> 无参数 </span>
                </div>

                <!-- ---- 闭环连接线 ---- -->
                <div class="flex items-center gap-2 bg-white px-3">
                  <span
                    class="inline-block h-4 w-px"
                    :class="{
                      'bg-amber-200': tool.status === 'calling',
                      'bg-emerald-300': tool.status === 'done',
                      'bg-red-200': tool.status === 'error'
                    }"
                  ></span>
                  <span class="flex items-center gap-1 text-[10px] text-gray-300">
                    <span
                      class="inline-block h-2.5 w-2.5"
                      :class="{
                        'i-carbon-in-progress animate-spin text-amber-400':
                          tool.status === 'calling',
                        'i-carbon-arrow-down text-emerald-400': tool.status === 'done',
                        'i-carbon-close text-red-400': tool.status === 'error'
                      }"
                    ></span>
                    {{ tool.status === 'calling' ? '等待返回...' : '已返回' }}
                  </span>
                </div>

                <!-- ---- tool_result 区域 ---- -->
                <div
                  class="border-t px-3 py-2"
                  :class="{
                    'border-gray-100 bg-gray-50/50': tool.status === 'calling',
                    'border-emerald-100 bg-emerald-50/30': tool.status === 'done',
                    'border-red-100 bg-red-50/30': tool.status === 'error'
                  }"
                >
                  <div class="mb-1 flex items-center gap-1.5">
                    <span
                      class="rounded px-1 py-px font-mono text-[10px] font-semibold"
                      :class="{
                        'bg-gray-100 text-gray-400': tool.status === 'calling',
                        'bg-emerald-100 text-emerald-600': tool.status === 'done',
                        'bg-red-100 text-red-500': tool.status === 'error'
                      }"
                    >
                      tool_result
                    </span>
                    <span class="text-[10px] text-gray-400">
                      {{ tool.status === 'calling' ? '等待中...' : '返回结果' }}
                    </span>
                  </div>
                  <div v-if="tool.result">
                    <div
                      class="max-h-28 overflow-y-auto rounded bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-500"
                    >
                      {{ tool.result }}
                    </div>
                  </div>
                  <div
                    v-else
                    class="flex items-center gap-1.5 py-1 text-[11px] text-gray-300 italic"
                  >
                    <span v-if="tool.status === 'calling'" class="inline-flex gap-0.5">
                      <span class="h-1 w-1 animate-bounce rounded-full bg-amber-300"></span>
                      <span
                        class="h-1 w-1 animate-bounce rounded-full bg-amber-300"
                        style="animation-delay: 0.15s"
                      ></span>
                      <span
                        class="h-1 w-1 animate-bounce rounded-full bg-amber-300"
                        style="animation-delay: 0.3s"
                      ></span>
                    </span>
                    {{ tool.status === 'calling' ? '等待结果返回' : '无返回数据' }}
                  </div>
                </div>
              </div>

              <!-- ========== [hitl] 审批闭环块 ========== -->
              <div
                v-for="approval in msg.pendingApprovals"
                :key="'hitl-' + approval.index"
                class="rounded-lg border-l-[3px] px-3 py-2.5"
                :class="
                  approval.decision
                    ? approval.decision === 'reject'
                      ? 'border-l-red-400 bg-red-50/50'
                      : 'border-l-emerald-400 bg-emerald-50/50'
                    : 'border-l-amber-400 bg-amber-50/60'
                "
              >
                <!-- hitl 闭环标签 -->
                <div class="mb-1.5 flex items-center gap-1.5">
                  <span
                    class="rounded px-1 py-px font-mono text-[10px] font-semibold"
                    :class="
                      approval.decision
                        ? approval.decision === 'reject'
                          ? 'bg-red-100 text-red-500'
                          : 'bg-emerald-100 text-emerald-600'
                        : 'bg-amber-100 text-amber-600'
                    "
                  >
                    hitl:required
                  </span>
                  <span class="i-carbon-arrow-right inline-block h-2.5 w-2.5 text-gray-300"></span>
                  <span
                    class="rounded px-1 py-px font-mono text-[10px] font-semibold"
                    :class="
                      approval.decision
                        ? approval.decision === 'reject'
                          ? 'bg-red-100 text-red-500'
                          : 'bg-emerald-100 text-emerald-600'
                        : 'bg-gray-100 text-gray-400'
                    "
                  >
                    {{
                      approval.decision
                        ? approval.decision === 'reject'
                          ? 'hitl:rejected'
                          : 'hitl:approved'
                        : 'hitl:??? 等待决策'
                    }}
                  </span>
                  <span
                    v-if="approval.decision"
                    class="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium"
                    :class="
                      approval.decision === 'reject'
                        ? 'bg-red-50 text-red-500'
                        : 'bg-emerald-50 text-emerald-600'
                    "
                  >
                    闭环完成
                  </span>
                </div>

                <!-- 工具信息 -->
                <div class="flex items-center gap-2">
                  <span
                    class="inline-block h-3.5 w-3.5"
                    :class="
                      approval.decision
                        ? approval.decision === 'reject'
                          ? 'i-carbon-close-filled text-red-500'
                          : 'i-carbon-checkmark-filled text-emerald-500'
                        : 'i-carbon-locked text-amber-600'
                    "
                  ></span>
                  <span class="text-xs font-medium text-gray-700">
                    {{ approval.decision ? getDecisionLabel(approval.decision) : '需要审批' }}
                  </span>
                  <span class="font-mono text-[11px] text-gray-400">{{ approval.toolName }}</span>
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

              <!-- ========== [error] 错误块 ========== -->
              <div
                v-if="msg.status === 'error' && msg.error"
                class="rounded-lg border-l-[3px] border-l-red-400 bg-red-50/60 px-3 py-2"
              >
                <div class="mb-1 flex items-center gap-1.5">
                  <span
                    class="rounded bg-red-100 px-1 py-px font-mono text-[10px] font-semibold text-red-500"
                  >
                    run:error
                  </span>
                </div>
                <div class="flex items-start gap-2 text-xs text-red-600">
                  <span
                    class="i-carbon-warning-alt mt-0.5 inline-block h-3.5 w-3.5 shrink-0"
                  ></span>
                  <span>{{ msg.error }}</span>
                </div>
              </div>

              <!-- ========== [interrupted / resumed] 生命周期块 ========== -->
              <div
                v-if="msg.status === 'interrupted'"
                class="flex items-center gap-2 text-[11px] text-amber-500"
              >
                <span class="i-carbon-pause-filled inline-block h-3 w-3"></span>
                <span class="font-mono">run:interrupted</span>
                <span class="text-gray-400">— 等待 HITL 审批...</span>
                <span class="h-px flex-1 bg-amber-200"></span>
              </div>

              <!-- ========== [done] 流结束标记 ========== -->
              <div
                v-if="msg.status === 'done'"
                class="flex items-center gap-2 text-[11px] text-gray-400"
              >
                <span
                  class="i-carbon-checkmark-filled inline-block h-3 w-3 text-emerald-400"
                ></span>
                <span class="font-mono">run:done</span>
                <span class="h-px flex-1 bg-gray-200"></span>
                <span
                  class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500"
                >
                  闭环完成
                </span>
              </div>

              <!-- ========== [streaming] 状态指示 ========== -->
              <div
                v-if="msg.status === 'streaming'"
                class="flex items-center gap-2 text-[11px] text-blue-400"
              >
                <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin"></span>
                <span class="font-mono">streaming...</span>
                <span class="h-px flex-1 bg-blue-100"></span>
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
        <p
          v-if="wsService.lastError.value"
          class="mt-2 flex items-center gap-1 text-xs text-red-500"
        >
          <span class="i-carbon-warning inline-block h-3 w-3"></span>
          {{ wsService.lastError.value }}
        </p>
      </div>
    </footer>
  </div>
</template>
