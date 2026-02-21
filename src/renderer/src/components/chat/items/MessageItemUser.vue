<script setup lang="ts">
import type { ChatMessage } from '../ChatMessages.vue';

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <div class="msg-block">
    <div class="msg-role-row">
      <span class="msg-role-icon msg-role-user">
        <span class="inline-block h-3 w-3 i-carbon-user" />
      </span>
      <span class="msg-role-name">你</span>
      <span class="msg-time">{{
        new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }}</span>
    </div>

    <div class="msg-content">
      <div class="msg-text">{{ message.content }}</div>
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

.msg-role-user {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
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
</style>
