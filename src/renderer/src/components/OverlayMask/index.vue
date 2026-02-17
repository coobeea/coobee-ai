<template>
  <div
    v-if="visible"
    class="fixed inset-0 bg-black/50"
    :class="{
      '!bg-transparent': transparent,
      'backdrop-blur-sm': blur,
      'cursor-pointer': clickable
    }"
    :style="maskStyle"
    @click="handleClick" />
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  visible?: boolean;
  transparent?: boolean;
  blur?: boolean;
  zIndex?: number;
  clickable?: boolean;
  closeOnClick?: boolean;
  opacity?: number;
  backgroundColor?: string;
  clipPath?: string;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  transparent: false,
  blur: false,
  zIndex: 1000,
  clickable: true,
  closeOnClick: true,
  opacity: 0.5,
  backgroundColor: '#000000'
});

const emit = defineEmits<{
  click: [];
  close: [];
}>();

const maskStyle = computed(() => {
  const style: Record<string, any> = {
    // 使用传入的z-index值
    zIndex: props.zIndex
  };

  // 当不是透明模式且需要自定义背景色或透明度时，使用内联样式
  if (!props.transparent && (props.backgroundColor !== '#000000' || props.opacity !== 0.5)) {
    style.backgroundColor = `rgba(${hexToRgb(props.backgroundColor)}, ${props.opacity})`;
  }

  if (props.clipPath) {
    style.clipPath = props.clipPath;
  }

  return style;
});

const handleClick = () => {
  emit('click');
  if (props.closeOnClick) {
    emit('close');
  }
};

// 辅助函数：将十六进制颜色转换为 RGB
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
  }
  return '0, 0, 0';
}
</script>

<style scoped>
/* 使用 Tailwind CSS 类，无需额外样式 */
</style>
