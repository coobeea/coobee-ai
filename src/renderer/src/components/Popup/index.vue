<template>
  <teleport to="body">
    <div v-if="visible" class="popup-wrapper" :style="{ zIndex: zIndex }">
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
          :class="[
            'popup-container',
            positionClass,
            containerClass,
            {
              'popup-container--no-mask': !showMask
            }
          ]"
          :style="contentContainerStyle"
          @click.stop>
          <slot />
        </div>
      </transition>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import OverlayMask from '@/components/OverlayMask/index.vue';

// 定位类型
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

// 动画类型
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
  /** z-index 层级 */
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
  transition: 'fade',
  zIndex: 1000
});

const emit = defineEmits<Emits>();

const popupRef = ref<HTMLElement>();
const originalBodyOverflow = ref<string>('');

// 计算定位类名
const positionClass = computed(() => {
  if (props.position === 'custom') return '';
  return `popup-container--${props.position}`;
});

// 计算动画名称
const transitionName = computed(() => `popup-${props.transition}`);

// 计算容器样式
const containerStyle = computed(() => {
  const style: Record<string, any> = { ...props.containerStyle };

  if (props.position === 'custom' && props.customPosition) {
    Object.assign(style, props.customPosition);
  }

  return style;
});

// 计算内容容器样式（确保z-index高于遮罩层）
const contentContainerStyle = computed(() => {
  const style: Record<string, any> = { ...containerStyle.value };

  // 确保内容容器的z-index高于遮罩层
  // 使用相对定位使z-index生效
  style.position = 'relative';
  style.zIndex = 1; // 相对于popup-wrapper的层级，确保高于遮罩层

  return style;
});

// 处理遮罩层点击
const handleOverlayClick = () => {
  if (props.closeOnClickOverlay) {
    close();
  }
};

// 处理ESC键
const handleEscKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.closeOnEsc && props.visible) {
    close();
  }
};

// 锁定/解锁滚动
const lockBodyScroll = () => {
  if (!props.lockScroll) return;

  originalBodyOverflow.value = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
};

const unlockBodyScroll = () => {
  if (!props.lockScroll) return;

  document.body.style.overflow = originalBodyOverflow.value;
};

// 关闭弹出层
const close = () => {
  emit('update:visible', false);
  emit('close');
};

// 动画事件处理
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

// 监听visible变化
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      nextTick(() => {
        if (popupRef.value) {
          popupRef.value.focus();
        }
      });
    }
  }
);

// 生命周期
onMounted(() => {
  document.addEventListener('keydown', handleEscKey);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscKey);
  unlockBodyScroll();
});

// 暴露方法
defineExpose({
  close
});
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
  @apply relative outline-none;
  pointer-events: auto;
  z-index: 1; /* 确保内容容器始终在遮罩层之上 */

  &--no-mask {
    pointer-events: auto;
  }

  // 定位样式
  &--center {
    @apply mx-auto;
    margin-top: auto;
    margin-bottom: auto;
    min-height: fit-content;
  }

  &--top {
    @apply mx-auto mt-0 mb-auto;
  }

  &--bottom {
    @apply mx-auto mt-auto mb-0;
  }

  &--left {
    @apply my-auto ml-0 mr-auto;
  }

  &--right {
    @apply my-auto ml-auto mr-0;
  }

  &--top-left {
    @apply mt-0 ml-0 mb-auto mr-auto;
  }

  &--top-right {
    @apply mt-0 ml-auto mb-auto mr-0;
  }

  &--bottom-left {
    @apply mt-auto ml-0 mb-0 mr-auto;
  }

  &--bottom-right {
    @apply mt-auto ml-auto mb-0 mr-0;
  }
}

// 动画样式
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
