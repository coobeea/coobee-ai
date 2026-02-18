<script setup lang="ts">
/**
 * HitlApprovalCard — HITL 审批卡片（通用）
 *
 * 渲染单个待审批/已审批的工具审批项。
 * 被 ChatPanel 和 CopilotBubble 共同使用。
 */

import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

const props = defineProps<{
  approval: PendingApproval;
}>();

const emit = defineEmits<{
  decide: [decision: HitlApprovalDecision];
}>();

function decisionLabel(decision: HitlApprovalDecision): string {
  switch (decision) {
    case 'approve-once':
      return '已允许';
    case 'approve-always':
      return '始终允许';
    case 'reject':
      return '已拒绝';
  }
}
</script>

<template>
  <!-- 已决策 — 压缩为单行摘要 -->
  <div
    v-if="props.approval.decision"
    class="hitl-decided"
    :class="props.approval.decision === 'reject' ? 'hitl-decided--rejected' : 'hitl-decided--approved'">
    <span
      class="inline-block h-2.5 w-2.5"
      :class="props.approval.decision === 'reject' ? 'i-carbon-close-filled' : 'i-carbon-checkmark-filled'" />
    <span>{{ decisionLabel(props.approval.decision) }}</span>
    <span class="font-mono text-gray-400">{{ props.approval.toolName }}</span>
  </div>

  <!-- 未决策 — 完整展开 -->
  <div v-else class="hitl-pending">
    <div class="hitl-pending-header">
      <span class="i-carbon-locked inline-block h-3 w-3 text-amber-600" />
      <span class="hitl-pending-title">需要审批</span>
      <span class="font-mono text-[10px] text-gray-400">{{ props.approval.toolName }}</span>
    </div>

    <div class="hitl-pending-actions">
      <button class="hitl-btn hitl-btn--approve" @click="emit('decide', 'approve-once')">允许</button>
      <button class="hitl-btn hitl-btn--always" @click="emit('decide', 'approve-always')">始终允许</button>
      <button class="hitl-btn hitl-btn--reject" @click="emit('decide', 'reject')">拒绝</button>
    </div>
  </div>
</template>

<style scoped>
.hitl-decided {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 10px;
}

.hitl-decided--approved {
  background: rgb(236 253 245 / 0.4);
  color: rgb(16 185 129);
}

.hitl-decided--rejected {
  background: rgb(254 242 242 / 0.4);
  color: rgb(239 68 68);
}

.hitl-pending {
  border-radius: 6px;
  border-left: 2px solid rgb(251 191 36);
  background: rgb(255 251 235 / 0.6);
  padding: 8px;
}

.hitl-pending-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.hitl-pending-title {
  font-size: 11px;
  font-weight: 500;
  color: rgb(55 65 81);
}

.hitl-pending-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.hitl-btn {
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: background-color 150ms;
}

.hitl-btn--approve {
  background: rgb(16 185 129);
}
.hitl-btn--approve:hover {
  background: rgb(5 150 105);
}

.hitl-btn--always {
  background: rgb(59 130 246);
}
.hitl-btn--always:hover {
  background: rgb(37 99 235);
}

.hitl-btn--reject {
  background: rgb(239 68 68);
}
.hitl-btn--reject:hover {
  background: rgb(220 38 38);
}
</style>
