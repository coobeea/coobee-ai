<script setup lang="ts">
/**
 * ContextMenuItem - 右键菜单项
 */

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <div class="context-menu-item" @click="emit('click')">
    <slot />
  </div>
</template>

<style scoped>
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: background-color 0.15s ease;
  user-select: none;
}

.context-menu-item:hover {
  background: hsl(var(--muted) / 0.6);
}

.context-menu-item:active {
  background: hsl(var(--muted) / 0.8);
}
</style>
