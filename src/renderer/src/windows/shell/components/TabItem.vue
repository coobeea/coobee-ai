<script setup lang="ts">
import { ref } from 'vue'
import IconMdiClose from '~icons/mdi/close'

defineProps<{
  active: boolean
  canClose: boolean
}>()

const emit = defineEmits<{
  click: []
  close: []
}>()

const tabItem = ref<HTMLElement | null>(null)

const onClick = (): void => {
  emit('click')

  // 平滑滚动到可见区域
  setTimeout(() => {
    tabItem.value?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, 100)
}

const onClose = (): void => {
  emit('close')
}
</script>

<template>
  <div
    ref="tabItem"
    class="window-no-drag-region group flex h-full shrink-0 items-center justify-between border-r border-gray-300 px-3 text-xs font-medium transition-colors hover:bg-gray-200"
    :class="[active ? 'bg-white' : 'bg-gray-100']"
    @click="onClick"
  >
    <!-- Tab Content -->
    <div class="flex max-w-36 items-center truncate">
      <slot></slot>
    </div>

    <!-- Close Button -->
    <button
      v-if="canClose"
      type="button"
      class="ml-2 rounded p-0.5 text-gray-500 opacity-0 transition-opacity hover:bg-gray-300 hover:text-gray-700 group-hover:opacity-100"
      @click.stop="onClose"
    >
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
