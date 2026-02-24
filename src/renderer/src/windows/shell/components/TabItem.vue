<script setup lang="ts">
import { ref } from 'vue';
import IconMdiClose from '~icons/mdi/close';

defineProps<{
  active: boolean;
  canClose: boolean;
}>();

const emit = defineEmits<{
  click: [];
  close: [];
}>();

const tabItem = ref<HTMLElement | null>(null);

const onClick = (): void => {
  emit('click');

  // 平滑滚动到可见区域
  setTimeout(() => {
    tabItem.value?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, 100);
};

const onClose = (): void => {
  emit('close');
};
</script>

<template>
  <div
    ref="tabItem"
    class="window-no-drag-region group flex h-full shrink-0 cursor-pointer items-center justify-between px-3 text-xs font-medium transition-colors"
    :class="[
      active
        ? 'bg-gray-600 text-white hover:bg-gray-500 active:bg-gray-500'
        : 'bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500'
    ]"
    @click="onClick">
    <!-- Tab Content -->
    <div class="flex max-w-36 items-center truncate">
      <slot></slot>
    </div>

    <!-- Close Button -->
    <button
      v-if="canClose"
      type="button"
      class="ml-2 rounded p-0.5 text-gray-300 opacity-0 transition-all hover:bg-gray-400 hover:text-white active:bg-gray-300 group-hover:opacity-100"
      @click.stop="onClose">
      <IconMdiClose class="text-sm" />
    </button>
  </div>
</template>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
</style>
