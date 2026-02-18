<template>
  <teleport to="body">
    <div v-if="loadingStore.isLoading" class="fixed inset-0" :style="{ zIndex: loadingZIndex }">
      <!-- 遮罩层 -->
      <OverlayMask
        :visible="loadingStore.isLoading"
        :z-index="0"
        :blur="true"
        :opacity="0.8"
        :background-color="'hsl(var(--background))'"
        class="transition-opacity duration-300" />

      <!-- 加载动画 -->
      <div class="fixed inset-0 z-[1] flex items-center justify-center pointer-events-none">
        <transition name="drop">
          <span
            v-if="loadingStore.isLoading"
            :class="`i-svg-spinners-${loadingStore.spinnerType}`"
            class="h-20 w-20 text-primary" />
        </transition>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { onUnmounted, watch } from 'vue';

import OverlayMask from '@/components/OverlayMask/index.vue';
import { useLoadingStore } from '@/stores/loading';
import { layerManager } from '@/utils/LayerManager';

const loadingStore = useLoadingStore();

const layerId = `loading_${Math.random().toString(36).slice(2, 9)}`;
let loadingZIndex = 0;

watch(
  () => loadingStore.isLoading,
  (isLoading) => {
    if (isLoading) {
      loadingZIndex = layerManager.register(layerId);
    } else {
      layerManager.unregister(layerId);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  layerManager.unregister(layerId);
});
</script>

<style scoped>
.drop-enter-active {
  transition: all 0.3s ease-out;
}

.drop-leave-active {
  transition: all 0.3s ease-in;
}

.drop-enter-from,
.drop-leave-to {
  transform: translateY(-100vh);
  opacity: 0;
}
</style>
