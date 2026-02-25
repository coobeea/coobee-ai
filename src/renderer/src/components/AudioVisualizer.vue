<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  volume: number; // 0 - 100
  isActive: boolean;
  color?: string; // 波形颜色
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let animationId: number;

// 历史数据
const bufferLength = 120; // 点越多越圆滑
const dataBuffer = new Array(bufferLength).fill(0);

const draw = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(w, h) / 2 - 10;
  const minRadius = maxRadius * 0.6;

  ctx.clearRect(0, 0, w, h);

  const targetVal = props.isActive ? props.volume : 0;

  // 模拟波形向外扩散：这里其实是旋转buffer
  // 但为了简单，我们只更新最后一个点是不行的，需要更新整个buffer
  // 这里采用更简单的方案：buffer 存储的是不同角度的幅值
  // 每一帧都随机更新一些点，或者让整体旋转

  // 简化方案：基于当前 volume 生成一个新的随机波形
  for (let i = 0; i < bufferLength; i++) {
    // 基础半径 + 音量驱动的波动
    // 使用 Perlin Noise 或者简单的正弦叠加会更好，这里用随机叠加
    const angle = (i / bufferLength) * Math.PI * 2;
    // 制造 3 个主要波峰
    const wave = Math.sin(angle * 3 + Date.now() / 200) * (targetVal / 100) * 20;
    const random = (Math.random() - 0.5) * (targetVal / 100) * 10;

    // 平滑插值
    const current = dataBuffer[i];
    const target = wave + random;
    dataBuffer[i] = current + (target - current) * 0.2;
  }

  // 绘制闭合曲线
  ctx.beginPath();
  for (let i = 0; i <= bufferLength; i++) {
    const idx = i % bufferLength;
    const angle = (i / bufferLength) * Math.PI * 2;
    const r = minRadius + dataBuffer[idx] + (targetVal / 100) * 10; // 基础呼吸

    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  // 样式
  const gradient = ctx.createRadialGradient(cx, cy, minRadius * 0.5, cx, cy, maxRadius);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.8, props.color || 'rgba(74, 222, 128, 0.4)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fill();

  // 描边
  ctx.strokeStyle = props.color || 'rgba(74, 222, 128, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  animationId = requestAnimationFrame(draw);
};

onMounted(() => {
  draw();
});

onUnmounted(() => {
  cancelAnimationFrame(animationId);
});
</script>

<template>
  <div class="visualizer-container">
    <canvas ref="canvasRef" class="visualizer-canvas"></canvas>
  </div>
</template>

<style scoped>
.visualizer-container {
  width: 100%;
  height: 100%;
  position: relative;
  /* 旋转动画让波形动起来 */
  animation: rotate 10s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.visualizer-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
