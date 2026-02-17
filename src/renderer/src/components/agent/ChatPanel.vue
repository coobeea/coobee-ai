<script setup lang="ts">
/**
 * ChatPanel — 对话面板（右栏）
 *
 * Agent 的对话交互区域：消息流、工具调用、HITL 审批。
 * 从原 ChatView.vue 提取，适配窄面板布局。
 */

import { ref, nextTick, watch, onMounted, computed } from 'vue';
import { useChatStore, type PendingApproval } from '@/stores/chat';
import { gateway } from '@/plugins/gatewaySetup';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

const chatStore = useChatStore();
const inputText = ref('');
const messageContainer = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

// ========== 智能滚动：用户往上浏览时不强制拉回底部 ==========

/** 用户是否已手动向上滚动（脱离底部） */
const userScrolledUp = ref(false);

/** 判断是否在底部附近（容差 60px） */
function isNearBottom(): boolean {
  const el = messageContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

/** 监听用户滚动 — 检测是否脱离底部 */
function handleScroll(): void {
  userScrolledUp.value = !isNearBottom();
}

/** 滚动到底部（仅在用户没有向上浏览时执行） */
function scrollToBottom(force = false): void {
  if (!force && userScrolledUp.value) return;
  nextTick(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
      userScrolledUp.value = false;
    }
  });
}

// 新消息到达 → 自动滚动（除非用户在看上面的内容）
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
);

// 流式内容增量更新 → 自动滚动（除非用户在看上面的内容）
watch(
  () => {
    const msgs = chatStore.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

async function handleSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text) return;

  // 用户发送消息 → 强制滚到底部（要看回复）
  inputText.value = '';
  resetTextareaHeight();
  scrollToBottom(true);
  await chatStore.sendMessage(text);
}

async function handleAbort(): Promise<void> {
  await chatStore.abortSession();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    handleSend();
  }
}

function autoResize(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function resetTextareaHeight(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
}

const connectionLabel = computed(() => {
  switch (gateway.connectionState.value) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中...';
    case 'error':
      return '连接错误';
    default:
      return '未连接';
  }
});

function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (!chatStore.sessionId || approval.decision) return;
  chatStore.submitDecision(chatStore.sessionId, approval.index, decision);
}

function getDecisionLabel(decision: HitlApprovalDecision): string {
  switch (decision) {
    case 'approve-once':
      return '已允许';
    case 'approve-always':
      return '始终允许';
    case 'reject':
      return '已拒绝';
  }
}

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <aside v-show="!isCollapsed" class="flex h-full w-[380px] shrink-0 flex-col border-l border-gray-200/80 bg-[#f7f7f8]">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-chat inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">对话</span>
      </div>

      <div class="flex items-center gap-2">
        <!-- 连接状态 -->
        <div class="flex items-center gap-1">
          <span
            class="inline-block h-1.5 w-1.5 rounded-full"
            :class="{
              'bg-emerald-500': gateway.connectionState.value === 'connected',
              'bg-amber-400': gateway.connectionState.value === 'connecting',
              'bg-red-400': gateway.connectionState.value === 'error',
              'bg-gray-300': gateway.connectionState.value === 'disconnected'
            }"></span>
          <span class="text-[10px] text-gray-400">{{ connectionLabel }}</span>
        </div>

        <!-- 新对话 -->
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="新对话"
          @click="chatStore.clearMessages()">
          <span class="i-carbon-add inline-block h-3 w-3"></span>
        </button>

        <!-- 折叠 -->
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="折叠"
          @click="isCollapsed = true">
          <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 消息区域 -->
    <div ref="messageContainer" class="flex-1 overflow-y-auto" @scroll="handleScroll">
      <!-- 空状态 -->
      <div v-if="chatStore.messages.length === 0" class="flex h-full flex-col items-center justify-center px-6">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <span class="i-carbon-chat-bot inline-block h-6 w-6 text-primary"></span>
        </div>
        <h2 class="mb-1 text-sm font-semibold text-gray-600">有什么可以帮您？</h2>
        <p class="text-center text-xs text-gray-400">输入消息开始对话</p>
      </div>

      <!-- 消息列表 -->
      <div v-else class="px-3 py-3">
        <div v-for="msg in chatStore.messages" :key="msg.id" class="mb-4">
          <!-- 角色行：图标 + 角色名 -->
          <div class="mb-1 flex items-center gap-1.5">
            <div
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
              :class="msg.role === 'user' ? 'bg-gray-200/60' : 'bg-primary/10'">
              <span
                class="inline-block h-3 w-3"
                :class="msg.role === 'user' ? 'i-carbon-user text-gray-500' : 'i-carbon-bot text-primary'"></span>
            </div>
            <span class="text-[11px] font-semibold text-gray-600">
              {{ msg.role === 'user' ? '你' : '助手' }}
            </span>
          </div>

          <!-- 消息内容（全宽，统一左对齐，缩进对齐角色图标） -->
          <div class="space-y-1.5 pl-[26px]">
            <!-- 用户消息 -->
            <div
              v-if="msg.role === 'user'"
              class="text-xs leading-relaxed text-gray-800 whitespace-pre-wrap break-words">
              {{ msg.content }}
            </div>

            <!-- 助手消息 -->
            <template v-else>
              <!-- run:start -->
              <div v-if="msg.status !== 'sending'" class="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span class="i-carbon-play-filled inline-block h-2.5 w-2.5 text-emerald-400"></span>
                <span class="font-mono">run:start</span>
                <span class="h-px flex-1 bg-gray-200"></span>
              </div>

              <!-- 按时序渲染内容块 -->
              <template v-for="(block, bidx) in msg.blocks" :key="'b-' + bidx">
                <!-- thinking block -->
                <div
                  v-if="block.type === 'thinking'"
                  class="rounded-md border-l-2 border-l-violet-300 bg-violet-50/50 px-2 py-1.5">
                  <div class="mb-0.5 flex items-center gap-1">
                    <span class="rounded bg-violet-100 px-1 py-px font-mono text-[9px] font-semibold text-violet-500">
                      thinking
                    </span>
                  </div>
                  <details>
                    <summary class="cursor-pointer text-[10px] text-violet-400 select-none hover:text-violet-500">
                      思考过程
                    </summary>
                    <div
                      class="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-gray-500 whitespace-pre-wrap">
                      {{ block.text }}
                    </div>
                  </details>
                </div>

                <!-- text block -->
                <div
                  v-else-if="block.type === 'text'"
                  class="rounded-md border-l-2 border-l-blue-300 bg-white px-2 py-1.5">
                  <div class="mb-0.5">
                    <span class="rounded bg-blue-100 px-1 py-px font-mono text-[9px] font-semibold text-blue-500">
                      text
                    </span>
                  </div>
                  <div class="text-xs leading-relaxed text-gray-800 whitespace-pre-wrap break-words">
                    {{ block.text }}
                    <span
                      v-if="msg.status === 'streaming' && bidx === msg.blocks.length - 1"
                      class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-gray-400 align-text-bottom"></span>
                  </div>
                </div>

                <!-- tool block -->
                <div
                  v-else-if="block.type === 'tool'"
                  class="overflow-hidden rounded-md border text-[11px] shadow-sm"
                  :class="{
                    'border-amber-200': block.tool.status === 'calling',
                    'border-emerald-200': block.tool.status === 'done',
                    'border-red-200': block.tool.status === 'error'
                  }">
                  <div
                    class="flex items-center gap-1.5 px-2 py-1"
                    :class="{
                      'bg-amber-50': block.tool.status === 'calling',
                      'bg-emerald-50': block.tool.status === 'done',
                      'bg-red-50': block.tool.status === 'error'
                    }">
                    <span class="i-carbon-tool-box inline-block h-3 w-3 text-gray-500"></span>
                    <span class="font-mono text-[10px] font-semibold text-gray-700">{{ block.tool.name }}</span>
                    <span class="flex-1"></span>
                    <span
                      class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                      :class="{
                        'bg-amber-100 text-amber-700': block.tool.status === 'calling',
                        'bg-emerald-100 text-emerald-700': block.tool.status === 'done',
                        'bg-red-100 text-red-600': block.tool.status === 'error'
                      }">
                      {{ block.tool.status === 'calling' ? '执行中' : block.tool.status === 'done' ? '完成' : '失败' }}
                    </span>
                  </div>
                  <div v-if="block.tool.arguments" class="border-t border-gray-100 bg-white px-2 py-1">
                    <div
                      class="max-h-16 overflow-y-auto rounded bg-gray-50 px-1.5 py-1 font-mono text-[10px] text-gray-500">
                      {{ block.tool.arguments }}
                    </div>
                  </div>
                  <div v-if="block.tool.result" class="border-t border-gray-100 px-2 py-1">
                    <div
                      class="max-h-20 overflow-y-auto rounded bg-white px-1.5 py-1 font-mono text-[10px] text-gray-500">
                      {{ block.tool.result }}
                    </div>
                  </div>
                </div>

                <!-- delegate block -->
                <div
                  v-else-if="block.type === 'delegate'"
                  class="overflow-hidden rounded-md border text-[11px] shadow-sm"
                  :class="{
                    'border-violet-200': block.delegate.status === 'running',
                    'border-violet-300': block.delegate.status === 'done'
                  }">
                  <div
                    class="flex items-center gap-1.5 px-2 py-1"
                    :class="{
                      'bg-violet-50': block.delegate.status === 'running',
                      'bg-violet-50/50': block.delegate.status === 'done'
                    }">
                    <span class="i-carbon-bot inline-block h-3 w-3 text-violet-500"></span>
                    <span class="text-[10px] font-semibold text-violet-700">
                      {{ block.delegate.agentName || block.delegate.agentId }}
                    </span>
                    <span class="flex-1"></span>
                    <span
                      class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                      :class="{
                        'bg-violet-100 text-violet-600': block.delegate.status === 'running',
                        'bg-violet-100 text-violet-700': block.delegate.status === 'done'
                      }">
                      {{
                        block.delegate.status === 'running'
                          ? '委托中...'
                          : `完成${block.delegate.duration ? ` (${Math.round(block.delegate.duration / 1000)}s)` : ''}`
                      }}
                    </span>
                  </div>
                  <div v-if="block.delegate.task" class="border-t border-violet-100 bg-white px-2 py-1">
                    <p class="text-[10px] text-gray-500">
                      {{ block.delegate.task }}
                    </p>
                  </div>
                  <div
                    v-if="block.delegate.output && block.delegate.status === 'done'"
                    class="border-t border-violet-100 px-2 py-1">
                    <div
                      class="max-h-20 overflow-y-auto rounded bg-white px-1.5 py-1 font-mono text-[10px] text-gray-500">
                      {{ block.delegate.output }}
                    </div>
                  </div>
                </div>
              </template>

              <!-- 等待中（streaming 且无内容块） -->
              <div
                v-if="msg.status === 'streaming' && msg.blocks.length === 0"
                class="rounded-md border-l-2 border-l-blue-300 bg-white px-2 py-1.5">
                <div class="mb-0.5">
                  <span class="rounded bg-blue-100 px-1 py-px font-mono text-[9px] font-semibold text-blue-500">
                    text
                  </span>
                </div>
                <span class="inline-flex gap-1">
                  <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400"></span>
                  <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400" style="animation-delay: 0.15s"></span>
                  <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400" style="animation-delay: 0.3s"></span>
                </span>
              </div>

              <!-- HITL approvals: 已决策的折叠为摘要行，未决策的完整展开 -->
              <template v-if="msg.pendingApprovals?.length">
                <!-- 已决策的审批 — 压缩为单行摘要 -->
                <div
                  v-for="approval in msg.pendingApprovals.filter((a) => a.decision)"
                  :key="'hitl-done-' + approval.index"
                  class="flex items-center gap-1.5 rounded px-2 py-1 text-[10px]"
                  :class="
                    approval.decision === 'reject' ? 'bg-red-50/40 text-red-400' : 'bg-emerald-50/40 text-emerald-500'
                  ">
                  <span
                    class="inline-block h-2.5 w-2.5"
                    :class="
                      approval.decision === 'reject' ? 'i-carbon-close-filled' : 'i-carbon-checkmark-filled'
                    "></span>
                  <span>{{ getDecisionLabel(approval.decision!) }}</span>
                  <span class="font-mono text-gray-400">{{ approval.toolName }}</span>
                </div>

                <!-- 未决策的审批 — 完整展开（通常只有最后一个） -->
                <div
                  v-for="approval in msg.pendingApprovals.filter((a) => !a.decision)"
                  :key="'hitl-pending-' + approval.index"
                  class="rounded-md border-l-2 border-l-amber-400 bg-amber-50/60 px-2 py-2">
                  <div class="mb-1 flex items-center gap-1.5">
                    <span class="i-carbon-locked inline-block h-3 w-3 text-amber-600"></span>
                    <span class="text-[11px] font-medium text-gray-700">需要审批</span>
                    <span class="font-mono text-[10px] text-gray-400">{{ approval.toolName }}</span>
                  </div>

                  <div class="mt-2 flex gap-1.5">
                    <button
                      class="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-600"
                      @click="handleApproval(approval, 'approve-once')">
                      允许
                    </button>
                    <button
                      class="rounded bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-600"
                      @click="handleApproval(approval, 'approve-always')">
                      始终允许
                    </button>
                    <button
                      class="rounded bg-red-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-600"
                      @click="handleApproval(approval, 'reject')">
                      拒绝
                    </button>
                  </div>
                </div>
              </template>

              <!-- error -->
              <div
                v-if="msg.status === 'error' && msg.error"
                class="rounded-md border-l-2 border-l-red-400 bg-red-50/60 px-2 py-1.5">
                <span class="rounded bg-red-100 px-1 py-px font-mono text-[9px] font-semibold text-red-500">
                  run:error
                </span>
                <div class="mt-1 flex items-start gap-1 text-[11px] text-red-600">
                  <span class="i-carbon-warning-alt mt-0.5 inline-block h-3 w-3 shrink-0"></span>
                  <span>{{ msg.error }}</span>
                </div>
              </div>

              <!-- interrupted -->
              <div v-if="msg.status === 'interrupted'" class="flex items-center gap-1.5 text-[10px] text-amber-500">
                <span class="i-carbon-pause-filled inline-block h-2.5 w-2.5"></span>
                <span class="font-mono">run:interrupted</span>
                <span class="h-px flex-1 bg-amber-200"></span>
              </div>

              <!-- done -->
              <div v-if="msg.status === 'done'" class="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span class="i-carbon-checkmark-filled inline-block h-2.5 w-2.5 text-emerald-400"></span>
                <span class="font-mono">run:done</span>
                <span class="h-px flex-1 bg-gray-200"></span>
              </div>

              <!-- streaming (after blocks) -->
              <div
                v-if="msg.status === 'streaming' && msg.blocks.length > 0"
                class="flex items-center gap-1.5 text-[10px] text-blue-400">
                <span class="i-carbon-in-progress inline-block h-2.5 w-2.5 animate-spin"></span>
                <span class="font-mono">streaming...</span>
                <span class="h-px flex-1 bg-blue-100"></span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 队列状态提示 -->
    <div
      v-if="chatStore.isQueued && chatStore.queueStatus"
      class="flex items-center gap-1.5 border-t border-amber-200/80 bg-amber-50/60 px-3 py-1.5">
      <span class="i-carbon-queue inline-block h-3 w-3 text-amber-500"></span>
      <span class="text-[10px] text-amber-600">
        消息已排队 (位置:
        {{ chatStore.queueStatus.queueLength }})
      </span>
    </div>

    <!-- 输入区域 -->
    <div class="shrink-0 border-t border-gray-200/80 bg-white px-3 pb-3 pt-2">
      <div
        class="flex items-end gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm transition-colors focus-within:border-primary/40">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          class="max-h-[160px] min-h-[20px] flex-1 resize-none bg-transparent text-xs leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
          rows="1"
          :placeholder="chatStore.isStreaming ? '可继续输入（消息将排队处理）' : '输入消息... (Enter 发送)'"
          @keydown="handleKeydown"
          @input="autoResize"></textarea>

        <!-- 中断按钮（流式执行中显示） -->
        <button
          v-if="chatStore.isStreaming"
          class="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-500 text-white transition hover:bg-red-600"
          title="中断当前执行"
          @click="handleAbort">
          <span class="i-carbon-stop-filled inline-block h-3.5 w-3.5"></span>
        </button>
      </div>
      <p v-if="gateway.lastError.value" class="mt-1 flex items-center gap-1 text-[10px] text-red-500">
        <span class="i-carbon-warning inline-block h-2.5 w-2.5"></span>
        {{ gateway.lastError.value }}
      </p>
    </div>
  </aside>
</template>
