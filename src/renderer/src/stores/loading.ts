import { defineStore } from 'pinia';
import { ref } from 'vue';

import { Spinner, type SpinnerType } from '../types/spinner';

export const useLoadingStore = defineStore('loading', () => {
  const isLoading = ref(false);
  const spinnerType = ref<SpinnerType>(Spinner.BLOCKS_WAVE); // 恢复默认加载动画

  function show(type: SpinnerType = Spinner.BLOCKS_WAVE): void {
    spinnerType.value = type;
    isLoading.value = true;
  }

  function hide(): void {
    isLoading.value = false;
  }

  return { isLoading, spinnerType, show, hide };
});
