<!--
  Modal - 通用模态框组件
-->

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';

interface ModalProps {
  visible?: boolean;
  title?: string;
  width?: string;
  closable?: boolean;
  maskClosable?: boolean;
}

const props = withDefaults(defineProps<ModalProps>(), {
  visible: false,
  title: '',
  width: '600px',
  closable: true,
  maskClosable: true
});

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'close'): void;
}>();

const handleClose = (): void => {
  emit('update:visible', false);
  emit('close');
};

const handleMaskClick = (): void => {
  if (props.maskClosable) {
    handleClose();
  }
};

const handleEscape = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.visible && props.closable) {
    handleClose();
  }
};

watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }
);

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="modal-mask" @click.self="handleMaskClick">
        <Transition name="modal-slide">
          <div v-if="visible" class="modal-container" :style="{ width }" @click.stop>
            <!-- 头部 -->
            <div v-if="title || closable" class="modal-header">
              <h3 v-if="title" class="modal-title">{{ title }}</h3>
              <button v-if="closable" class="modal-close" @click="handleClose">
                <span class="i-mdi-close w-5 h-5" />
              </button>
            </div>

            <!-- 内容 -->
            <div class="modal-body">
              <slot />
            </div>

            <!-- 底部 -->
            <div v-if="$slots.footer" class="modal-footer">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.modal-container {
  background: var(--color-background);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

/* 动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-slide-enter-active,
.modal-slide-leave-active {
  transition: all 0.3s;
}

.modal-slide-enter-from,
.modal-slide-leave-to {
  transform: scale(0.95) translateY(-20px);
  opacity: 0;
}
</style>
