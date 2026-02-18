<template>
  <teleport to="body">
    <div v-if="visible" class="popup-wrapper" :style="{ zIndex: layerZIndex }">
      <!-- 遮罩层 - 始终使用 fade 动画 -->
      <transition name="popup-fade">
        <OverlayMask
          v-if="showMask && visible"
          :visible="visible"
          :z-index="0"
          :opacity="0.5"
          :background-color="'#000000'"
          :class="overlayClass"
          @click="handleOverlayClick" />
      </transition>

      <!-- 内容容器 - 使用自定义动画 -->
      <transition :name="transitionName" @enter="onEnter" @leave="onLeave">
        <div
          v-if="visible"
          ref="popupRef"
          :class="['popup-container', containerClass]"
          :style="contentContainerStyle"
          @click.stop>
          <slot />
        </div>
      </transition>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import OverlayMask from '@/components/OverlayMask/index.vue';
import { layerManager } from '@/utils/LayerManager';

export type PopupPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'custom';

export type PopupTransition = 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'bounce';

interface Props {
  /** 是否显示弹出层 */
  visible: boolean;
  /** 定位方式 */
  position?: PopupPosition;
  /** 是否为模态弹出层 */
  modal?: boolean;
  /** 是否显示遮罩层 */
  showMask?: boolean;
  /** 点击遮罩层是否关闭 */
  closeOnClickOverlay?: boolean;
  /** 按ESC键是否关闭 */
  closeOnEsc?: boolean;
  /** 是否锁定滚动 */
  lockScroll?: boolean;
  /** 动画类型 */
  transition?: PopupTransition;
  /** z-index 层级（不传则由 LayerManager 自动分配） */
  zIndex?: number;
  /** 自定义遮罩层类名 */
  overlayClass?: string;
  /** 自定义容器类名 */
  containerClass?: string;
  /** 自定义遮罩层样式 */
  overlayStyle?: Record<string, any>;
  /** 自定义容器样式 */
  containerStyle?: Record<string, any>;
  /** 自定义定位（当position为custom时使用） */
  customPosition?: {
    top?: string | number;
    left?: string | number;
    right?: string | number;
    bottom?: string | number;
    transform?: string;
  };
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'open'): void;
  (e: 'close'): void;
  (e: 'opened'): void;
  (e: 'closed'): void;
}

const props = withDefaults(defineProps<Props>(), {
  position: 'center',
  modal: true,
  showMask: true,
  closeOnClickOverlay: true,
  closeOnEsc: true,
  lockScroll: true,
  transition: 'fade'
});

const emit = defineEmits<Emits>();

const popupRef = ref<HTMLElement>();
const originalBodyOverflow = ref<string>('');

const layerId = `popup_${Math.random().toString(36).slice(2, 9)}`;
const layerZIndex = ref(props.zIndex ?? 0);

// 计算动画名称
const transitionName = computed(() => `popup-${props.transition}`);

// 各 position 对应的默认 margin（与 SCSS 中的 class 保持一致）
const POSITION_MARGINS: Record<string, Record<string, string>> = {
  center: { marginLeft: 'auto', marginRight: 'auto', marginTop: 'auto', marginBottom: 'auto' },
  top: { marginLeft: 'auto', marginRight: 'auto', marginTop: '0', marginBottom: 'auto' },
  bottom: { marginLeft: 'auto', marginRight: 'auto', marginTop: 'auto', marginBottom: '0' },
  left: { marginLeft: '0', marginRight: 'auto', marginTop: 'auto', marginBottom: 'auto' },
  right: { marginLeft: 'auto', marginRight: '0', marginTop: 'auto', marginBottom: 'auto' },
  'top-left': { marginLeft: '0', marginRight: 'auto', marginTop: '0', marginBottom: 'auto' },
  'top-right': { marginLeft: 'auto', marginRight: '0', marginTop: '0', marginBottom: 'auto' },
  'bottom-left': { marginLeft: '0', marginRight: 'auto', marginTop: 'auto', marginBottom: '0' },
  'bottom-right': { marginLeft: 'auto', marginRight: '0', marginTop: 'auto', marginBottom: '0' }
};

const contentContainerStyle = computed(() => {
  const style: Record<string, any> = {};

  // 先填入 position 对应的 margin 基线
  const posMargins = POSITION_MARGINS[props.position];
  if (posMargins) {
    Object.assign(style, posMargins);
  }

  // 自定义定位
  if (props.position === 'custom' && props.customPosition) {
    Object.assign(style, props.customPosition);
  }

  // containerStyle 最后覆盖（调用方可局部覆盖 margin）
  if (props.containerStyle) {
    Object.assign(style, props.containerStyle);
  }

  style.zIndex = 1;
  return style;
});

// ─── LayerManager 注册 / 注销 ───────────────────────────

function registerLayer(): void {
  const escCallback = props.closeOnEsc ? () => close() : undefined;
  const z = layerManager.register(layerId, escCallback);
  layerZIndex.value = props.zIndex ?? z;
}

function unregisterLayer(): void {
  layerManager.unregister(layerId);
}

// ─── 交互处理 ────────────────────────────────────────────

const handleOverlayClick = () => {
  if (props.closeOnClickOverlay) {
    close();
  }
};

const lockBodyScroll = () => {
  if (!props.lockScroll) return;
  originalBodyOverflow.value = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
};

const unlockBodyScroll = () => {
  if (!props.lockScroll) return;
  document.body.style.overflow = originalBodyOverflow.value;
};

const close = () => {
  emit('update:visible', false);
  emit('close');
};

// 动画事件
const onEnter = () => {
  emit('open');
  lockBodyScroll();
  nextTick(() => {
    emit('opened');
  });
};

const onLeave = () => {
  unlockBodyScroll();
  nextTick(() => {
    emit('closed');
  });
};

// ─── visible 变化驱动注册 / 注销 ─────────────────────────

watch(
  () => props.visible,
  (val) => {
    if (val) {
      registerLayer();
      nextTick(() => {
        popupRef.value?.focus();
      });
    } else {
      unregisterLayer();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  unregisterLayer();
  unlockBodyScroll();
});

defineExpose({ close });
</script>

<style lang="scss" scoped>
.popup-wrapper {
  @apply fixed inset-0 flex;
  overflow-y: auto;
  pointer-events: none;

  &:has(.popup-container) {
    pointer-events: auto;
  }
}

.popup-container {
  position: relative;
  outline: none;
  pointer-events: auto;
  z-index: 1;
}

// ─── 动画 ────────────────────────────────────────────────

.popup-fade-enter-active,
.popup-fade-leave-active {
  transition: opacity 0.3s ease;
}

.popup-fade-enter-from,
.popup-fade-leave-to {
  opacity: 0;
}

.popup-slide-up-enter-active,
.popup-slide-up-leave-active {
  transition: all 0.3s ease;
}

.popup-slide-up-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.popup-slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.popup-slide-down-enter-active,
.popup-slide-down-leave-active {
  transition: all 0.3s ease;
}

.popup-slide-down-enter-from {
  opacity: 0;
  transform: translateY(-100%);
}

.popup-slide-down-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

.popup-slide-left-enter-active,
.popup-slide-left-leave-active {
  transition: all 0.3s ease;
}

.popup-slide-left-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.popup-slide-left-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.popup-slide-right-enter-active,
.popup-slide-right-leave-active {
  transition: all 0.3s ease;
}

.popup-slide-right-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}

.popup-slide-right-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

.popup-zoom-enter-active,
.popup-zoom-leave-active {
  transition: all 0.3s ease;
}

.popup-zoom-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.popup-zoom-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.popup-bounce-enter-active {
  animation: popup-bounce-in 0.5s ease;
}

.popup-bounce-leave-active {
  animation: popup-bounce-out 0.3s ease;
}

@keyframes popup-bounce-in {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes popup-bounce-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.3);
  }
}
</style>
