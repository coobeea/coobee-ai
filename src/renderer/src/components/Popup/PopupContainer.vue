<template>
  <div id="popup-container">
    <!-- 弹出层容器会通过 teleport 渲染到这里 -->
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

import { zIndexManager } from '@/utils/ZIndexManager';

// 弹出层堆栈管理
const popupStack: string[] = [];

// 添加弹出层到堆栈
const addPopup = (id: string) => {
  if (!popupStack.includes(id)) {
    popupStack.push(id);
  }
  // 使用统一的 z-index 管理器
  return zIndexManager.bringToFront();
};

// 从堆栈中移除弹出层
const removePopup = (id: string) => {
  const index = popupStack.indexOf(id);
  if (index > -1) {
    popupStack.splice(index, 1);
  }
};

// 获取当前最顶层的弹出层
const getTopPopup = () => {
  return popupStack[popupStack.length - 1];
};

// 获取下一个 z-index（保持向后兼容）
const getNextZIndex = () => {
  return zIndexManager.bringToFront();
};

// 处理全局按键事件
const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && popupStack.length > 0) {
    // 只有最顶层的弹出层才能响应 ESC 键
    const topPopupId = getTopPopup();
    const topPopupElement = document.querySelector(`[data-popup-id="${topPopupId}"]`);

    if (topPopupElement) {
      // 触发顶层弹出层的关闭事件
      const closeEvent = new CustomEvent('popup-close', {
        detail: { popupId: topPopupId }
      });
      topPopupElement.dispatchEvent(closeEvent);
    }
  }
};

// 暴露方法给全局使用
const popupManager = {
  addPopup,
  removePopup,
  getTopPopup,
  getNextZIndex
};

// 挂载到全局
onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);

  // 将弹出层管理器挂载到全局
  if (typeof window !== 'undefined') {
    (window as any).__POPUP_MANAGER__ = popupManager;
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);

  // 清理全局引用
  if (typeof window !== 'undefined') {
    delete (window as any).__POPUP_MANAGER__;
  }
});

// 暴露管理器方法
defineExpose({
  addPopup,
  removePopup,
  getTopPopup,
  getNextZIndex
});
</script>

<style lang="scss" scoped>
#popup-container {
  // 确保容器存在但不占用空间
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 9999;
}
</style>
