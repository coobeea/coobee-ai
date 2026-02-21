<script setup lang="ts">
/**
 * ContextMenu - 右键菜单组件
 *
 * 用于显示上下文菜单，支持动态位置和自动关闭。
 */

import { ref, watch, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const menuRef = ref<HTMLElement | null>(null);

// 关闭菜单
function close(): void {
  emit('update:visible', false);
}

// 点击外部关闭
function handleClickOutside(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    close();
  }
}

// ESC 键关闭
function handleEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close();
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      document.addEventListener('click', handleClickOutside, { capture: true });
      document.addEventListener('keydown', handleEscape);
    } else {
      document.removeEventListener('click', handleClickOutside, { capture: true });
      document.removeEventListener('keydown', handleEscape);
    }
  }
);

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, { capture: true });
  document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        :style="{
          left: `${x}px`,
          top: `${y}px`
        }">
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 6px;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 4px 16px hsl(var(--shadow) / 0.15);
}

.context-menu-enter-active,
.context-menu-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
