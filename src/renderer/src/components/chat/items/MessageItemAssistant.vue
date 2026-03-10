<script setup lang="ts">
import type { ChatMessage } from '../ChatMessages.vue';
import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import BlockText from '../blocks/BlockText.vue';
import BlockThinking from '../blocks/BlockThinking.vue';
import BlockTool from '../blocks/BlockTool.vue';
import BlockDelegate from '../blocks/BlockDelegate.vue';
import BlockQuality from '../blocks/BlockQuality.vue';
import BlockAudio from '../blocks/BlockAudio.vue';
import HitlApprovalCard from '../HitlApprovalCard.vue';

defineProps<{
  message: ChatMessage;
}>();

const emit = defineEmits<{
  decide: [approval: PendingApproval, decision: HitlApprovalDecision];
}>();
</script>

<template>
  <div class="msg-block">
    <div class="msg-role-row">
      <span class="msg-role-icon msg-role-assistant">
        <span class="inline-block h-3 w-3 i-mdi-star-four-points" />
      </span>
      <span class="msg-role-name">管家</span>
      <span class="msg-time">{{
        new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }}</span>
    </div>

    <div class="msg-content">
      <template v-if="message.blocks && message.blocks.length > 0">
        <template v-for="(block, idx) in message.blocks" :key="idx">
          <BlockText v-if="block.type === 'text'" :block="block" />
          <BlockThinking v-else-if="block.type === 'thinking'" :block="block" />
          <BlockTool v-else-if="block.type === 'tool'" :block="block" />
          <BlockDelegate v-else-if="block.type === 'delegate'" :block="block" />
          <BlockQuality v-else-if="block.type === 'quality'" :block="block" />
          <BlockAudio v-else-if="block.type === 'audio'" :block="block" />
        </template>
      </template>

      <div v-else-if="message.status === 'streaming'" class="msg-typing">
        <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
      </div>

      <!-- HITL 审批卡片（必须等到 run:done 后才显示） -->
      <template v-if="message.pendingApprovals?.length">
        <HitlApprovalCard
          v-for="approval in message.pendingApprovals.filter((a) => a.canShow)"
          :key="'hitl-' + approval.index"
          :approval="approval"
          @decide="(d) => emit('decide', approval, d)" />
      </template>

      <div v-if="message.status === 'error' && message.error" class="msg-error">
        <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
        {{ message.error }}
      </div>

      <div v-if="message.status === 'interrupted'" class="msg-interrupted">
        <span class="i-carbon-pause-filled inline-block h-2.5 w-2.5" />
        <span>已中断</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
</style>
