<template>
  <teleport to="body">
    <!-- 加载动画遮罩层 -->
    <OverlayMask
      v-if="loadingStore.isLoading"
      :visible="loadingStore.isLoading"
      :z-index="9998"
      :blur="true"
      :opacity="0.8"
      :background-color="'hsl(var(--background))'"
      class="transition-opacity duration-300" />

    <!-- 加载动画 -->
    <div
      v-show="loadingStore.isLoading"
      class="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      <transition name="drop">
        <span
          v-if="loadingStore.isLoading"
          :class="`i-svg-spinners-${loadingStore.spinnerType}`"
          class="h-20 w-20 text-primary" />
      </transition>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import OverlayMask from '@/components/OverlayMask/index.vue';
import { useLoadingStore } from '@/stores/loading';

const loadingStore = useLoadingStore();
</script>

<style scoped>
.drop-enter-active {
  /* 动画持续0.5秒，并使用平滑减速的缓动函数 */
  transition: all 0.3s ease-out;
}

.drop-leave-active {
  transition: all 0.3s ease-in;
}

.drop-enter-from,
.drop-leave-to {
  /* 从屏幕视口之外的上方开始动画，确保它从 top: 0 的位置进入画面 */
  transform: translateY(-100vh);
  opacity: 0;
}
</style>
