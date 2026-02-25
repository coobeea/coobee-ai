<script setup lang="ts">
const props = defineProps<{
  volume: number; // 0 - 100
  isActive: boolean;
}>();

// 生成 12 个条，每个条有不同的高度系数，模拟无规则波形
const bars = [0.4, 0.7, 1.0, 0.6, 0.8, 1.2, 0.9, 0.5, 1.1, 0.7, 0.4, 0.6];

const barStyle = (factor: number, index: number): Record<string, string> => {
  // 基础高度 + 音量驱动的增量
  // 当静音时，保持一个微小的高度
  const minHeight = 4;
  const variableHeight = (props.volume / 100) * 40 * factor; // 最大高度 40px * factor

  // 增加一点随机抖动，让它看起来更像是在动
  const height = props.isActive ? Math.max(minHeight, variableHeight) : minHeight;

  return {
    height: `${height}px`,
    transition: 'height 0.1s ease-out', // 平滑过渡
    animationDelay: `${index * 0.05}s`
  };
};
</script>

<template>
  <div class="visualizer" :class="{ active: isActive }">
    <div v-for="(factor, index) in bars" :key="index" class="bar" :style="barStyle(factor, index)"></div>
  </div>
</template>

<style scoped>
.visualizer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 60px;
}

.bar {
  width: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  will-change: height;
}

.visualizer.active .bar {
  background: #4ade80; /* 激活时变绿，或者用 primary color */
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.4);
}
</style>
