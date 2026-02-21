<script setup lang="ts">
/**
 * ChatMessages — 统一对话消息列表组件
 *
 * 封装了优秀的消息排版布局。
 * 支持两种模式：
 * - copilot (应用管家): 不显示 run:start 等历史状态分隔线，紧凑。
 * - thread (任务管理): 显示 run:start 等完整的执行历史轨迹。
 */

import { ref, watch, nextTick, onMounted } from 'vue';
import type { ContentBlock, PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import HitlApprovalCard from '@/components/chat/HitlApprovalCard.vue';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  status?: string;
  timestamp: number;
  error?: string;
  pendingApprovals?: PendingApproval[];
}

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    isStreaming?: boolean;
    mode?: 'copilot' | 'thread';
  }>(),
  {
    isStreaming: false,
    mode: 'copilot' // 默认应用管家模式
  }
);

const emit = defineEmits<{
  decide: [approval: PendingApproval, decision: HitlApprovalDecision];
}>();

const messageContainer = ref<HTMLElement | null>(null);

// ========== 智能滚动：用户往上浏览时不强制拉回底部 ==========
const userScrolledUp = ref(false);

function isNearBottom(): boolean {
  const el = messageContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function handleScroll(): void {
  userScrolledUp.value = !isNearBottom();
}

function scrollToBottom(force = false): void {
  if (!force && userScrolledUp.value) return;
  nextTick(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
      userScrolledUp.value = false;
    }
  });
}

// 暴露给父组件，当发送消息时强制滚动到底部
defineExpose({
  scrollToBottom
});

watch(
  () => props.messages.length,
  () => scrollToBottom()
);

watch(
  () => {
    const msgs = props.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 && last.blocks ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

onMounted(() => {
  scrollToBottom(true);
});

function toolSummary(block: ContentBlock): string {
  if (block.type === 'tool') {
    if (block.tool.status === 'approval-pending') {
      return `${block.tool.name} (等待审批)`;
    }
    if (block.tool.status === 'calling') {
      return `调用 ${block.tool.name}...`;
    }
    if (block.tool.status === 'done') {
      return `${block.tool.name} 完成`;
    }
    return `${block.tool.name} 失败`;
  }
  return '';
}
</script>

<template>
  <div ref="messageContainer" class="panel-messages selectable" @scroll="handleScroll">
    <!-- 空状态 -->
    <div v-if="messages.length === 0" class="panel-empty">
      <slot name="empty">
        <div class="panel-empty-icon">
          <span class="i-mdi-star-four-points inline-block h-8 w-8" />
        </div>
        <p class="panel-empty-title">有什么可以帮您？</p>
        <p class="panel-empty-sub">输入消息开始对话</p>
      </slot>
    </div>

    <!-- 消息列表 -->
    <template v-for="msg in messages" :key="msg.id">
      <div class="msg-block">
        <div class="msg-role-row">
          <span class="msg-role-icon" :class="msg.role === 'user' ? 'msg-role-user' : 'msg-role-assistant'">
            <span
              class="inline-block h-3 w-3"
              :class="msg.role === 'user' ? 'i-carbon-user' : 'i-mdi-star-four-points'" />
          </span>
          <span class="msg-role-name">{{ msg.role === 'user' ? '你' : '管家' }}</span>
          <span class="msg-time">{{
            new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          }}</span>
        </div>

        <div class="msg-content">
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">
            <div class="msg-text">{{ msg.content }}</div>
          </template>

          <!-- 助手消息 -->
          <template v-else>
            <!-- 【Thread 模式】完整的执行历史轨迹 -->
            <template v-if="mode === 'thread'">
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
                      v-if="msg.status === 'streaming' && msg.blocks && bidx === msg.blocks.length - 1"
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
                    'border-red-200': block.tool.status === 'error',
                    'border-blue-300': block.tool.status === 'approval-pending'
                  }">
                  <div
                    class="flex items-center gap-1.5 px-2 py-1"
                    :class="{
                      'bg-amber-50': block.tool.status === 'calling',
                      'bg-emerald-50': block.tool.status === 'done',
                      'bg-red-50': block.tool.status === 'error',
                      'bg-blue-50': block.tool.status === 'approval-pending'
                    }">
                    <span
                      class="inline-block h-3 w-3"
                      :class="
                        block.tool.status === 'approval-pending'
                          ? 'i-carbon-locked text-blue-600'
                          : 'i-carbon-tool-box text-gray-500'
                      " />
                    <span class="font-mono text-[10px] font-semibold text-gray-700">{{ block.tool.name }}</span>
                    <span class="flex-1"></span>
                    <span
                      class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                      :class="{
                        'bg-amber-100 text-amber-700': block.tool.status === 'calling',
                        'bg-emerald-100 text-emerald-700': block.tool.status === 'done',
                        'bg-red-100 text-red-600': block.tool.status === 'error',
                        'bg-blue-100 text-blue-700': block.tool.status === 'approval-pending'
                      }">
                      {{
                        block.tool.status === 'calling'
                          ? '执行中'
                          : block.tool.status === 'approval-pending'
                            ? '等待审批'
                            : block.tool.status === 'done'
                              ? '完成'
                              : '失败'
                      }}
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
                    <div
                      class="max-h-16 overflow-y-auto rounded bg-violet-50/30 px-1.5 py-1 font-mono text-[10px] text-violet-600/80">
                      {{ block.delegate.task }}
                    </div>
                  </div>
                  <div
                    v-if="block.delegate.output && block.delegate.status === 'done'"
                    class="border-t border-violet-100 px-2 py-1">
                    <div
                      class="max-h-20 overflow-y-auto rounded bg-white px-1.5 py-1 font-mono text-[10px] text-gray-600">
                      {{ block.delegate.output }}
                    </div>
                  </div>
                </div>
              </template>

              <div v-if="msg.status === 'streaming' && msg.blocks?.length === 0" class="msg-typing">
                <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
              </div>

              <!-- HITL 审批卡片（必须等到 run:done 后才显示） -->
              <template v-if="msg.pendingApprovals?.length">
                <HitlApprovalCard
                  v-for="approval in msg.pendingApprovals.filter((a) => a.canShow)"
                  :key="'hitl-' + approval.index"
                  :approval="approval"
                  @decide="(d) => emit('decide', approval, d)" />
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
                v-if="msg.status === 'streaming' && msg.blocks && msg.blocks.length > 0"
                class="flex items-center gap-1.5 text-[10px] text-blue-400">
                <span class="i-carbon-in-progress inline-block h-2.5 w-2.5 animate-spin"></span>
                <span class="font-mono">streaming...</span>
                <span class="h-px flex-1 bg-blue-100"></span>
              </div>
            </template>

            <!-- 【Copilot 模式】紧凑版式，不显示复杂的 run 记录框 -->
            <template v-else>
              <template v-if="msg.blocks && msg.blocks.length > 0">
                <template v-for="(block, idx) in msg.blocks" :key="idx">
                  <div v-if="block.type === 'text'" class="msg-text" v-text="block.text" />

                  <div v-else-if="block.type === 'thinking'" class="msg-thinking">
                    <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
                    <span class="msg-thinking-text">{{ block.text }}</span>
                  </div>

                  <div v-else-if="block.type === 'tool'" class="msg-tool">
                    <span
                      class="inline-block h-3 w-3 shrink-0"
                      :class="
                        block.tool.status === 'calling'
                          ? 'i-carbon-renew animate-spin'
                          : block.tool.status === 'approval-pending'
                            ? 'i-carbon-locked text-blue-600'
                            : block.tool.status === 'done'
                              ? 'i-carbon-checkmark'
                              : 'i-carbon-warning-alt'
                      " />
                    <span>{{ toolSummary(block) }}</span>
                  </div>

                  <div v-else-if="block.type === 'delegate'" class="msg-delegate">
                    <span class="i-carbon-bot inline-block h-3 w-3 shrink-0" />
                    <span>{{ block.delegate.agentName || block.delegate.agentId }}</span>
                    <span class="msg-delegate-status">
                      {{ block.delegate.status === 'running' ? '委托中...' : '完成' }}
                    </span>
                  </div>
                </template>
              </template>

              <div v-else-if="msg.status === 'streaming'" class="msg-typing">
                <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
              </div>

              <!-- HITL 审批卡片（必须等到 run:done 后才显示） -->
              <template v-if="msg.pendingApprovals?.length">
                <HitlApprovalCard
                  v-for="approval in msg.pendingApprovals.filter((a) => a.canShow)"
                  :key="'hitl-' + approval.index"
                  :approval="approval"
                  @decide="(d) => emit('decide', approval, d)" />
              </template>

              <div v-if="msg.status === 'error' && msg.error" class="msg-error">
                <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                {{ msg.error }}
              </div>

              <div v-if="msg.status === 'interrupted'" class="msg-interrupted">
                <span class="i-carbon-pause-filled inline-block h-2.5 w-2.5" />
                <span>已中断</span>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>

    <div v-if="isStreaming && mode === 'copilot'" class="stream-indicator">
      <span class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin text-primary" />
      <span class="text-xs font-medium text-muted-foreground ml-1">处理中...</span>
    </div>
  </div>
</template>

<style scoped>
/* ====== 消息区域样式 ====== */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
}

/* 空状态 */
.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 32px;
  opacity: 0.8;
}

.panel-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  margin-bottom: 20px;
}

.panel-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.panel-empty-sub {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
}

/* 消息块 */
.msg-block {
  padding: 6px 16px;
  transition: background-color 0.2s;
}

.msg-block:hover {
  background-color: hsl(var(--foreground) / 0.02);
}

.msg-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.msg-role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
}

.msg-role-user {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}

.msg-role-assistant {
  background: hsl(var(--foreground) / 0.1);
  color: hsl(var(--foreground) / 0.7);
}

.msg-role-name {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.85);
}

.msg-time {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-left: auto;
}

.msg-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.msg-text {
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.9);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 思考块 */
.msg-thinking {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.3);
  padding: 6px 10px;
  border-radius: 6px;
  border-left: 2px solid hsl(var(--muted-foreground) / 0.3);
}

.msg-thinking-text {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 工具块 */
.msg-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.5);
  padding: 4px 8px;
  border-radius: 4px;
  align-self: flex-start;
}

/* 委托块 */
.msg-delegate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  padding: 4px 8px;
  border-radius: 4px;
  align-self: flex-start;
}

.msg-delegate-status {
  opacity: 0.7;
  font-size: 10px;
}

/* 错误与状态 */
.msg-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.1);
  padding: 6px 10px;
  border-radius: 6px;
}

.msg-interrupted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--warning));
  background: hsl(var(--warning) / 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  align-self: flex-start;
}

/* 打字动画 */
.msg-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding-left: 4px;
}

.typing-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: hsl(var(--muted-foreground) / 0.5);
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}
.typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {
  0%,
  80%,
  100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.stream-indicator {
  padding: 6px 16px 12px;
  display: flex;
  align-items: center;
  color: hsl(var(--muted-foreground) / 0.5);
}
</style>
