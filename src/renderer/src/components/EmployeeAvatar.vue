<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  volume?: number; // 0.0 - 1.0，用于驱动嘴巴开合度（暂未实现，预留）
}>();

const blinkTimer = ref<number | null>(null);
const isBlinking = ref(false);

// 状态映射到 CSS class
const stateClass = computed(() => {
  switch (props.state) {
    case 'listening':
      return 'state-listen'; // 监听状态（耳朵竖起）
    case 'thinking':
      return 'state-think';
    case 'speaking':
      return 'state-talk';
    default:
      return ''; // idle
  }
});

// 眨眼逻辑
const startBlink = (): void => {
  stopBlink();
  const nextBlink = (): void => {
    isBlinking.value = true;
    setTimeout(() => {
      isBlinking.value = false;
    }, 150);

    // 随机间隔 2-5秒
    blinkTimer.value = window.setTimeout(nextBlink, 2000 + Math.random() * 3000);
  };
  nextBlink();
};

const stopBlink = (): void => {
  if (blinkTimer.value) {
    clearTimeout(blinkTimer.value);
    blinkTimer.value = null;
  }
  isBlinking.value = false;
};

// 监听状态变化
watch(
  () => props.state,
  (newState) => {
    if (newState === 'idle' || newState === 'listening') {
      startBlink();
    } else {
      stopBlink(); // 说话/思考时不眨眼（或减少眨眼）
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.state === 'idle') startBlink();
});

onUnmounted(() => {
  stopBlink();
});
</script>

<template>
  <div class="avatar-wrap" :class="[stateClass]">
    <!-- 呼吸光圈 -->
    <div class="glow"></div>

    <!-- 主体 -->
    <div class="face" :class="{ blink: isBlinking }">
      <div class="ear left"><div class="ear-inner"></div></div>
      <div class="ear right"><div class="ear-inner"></div></div>

      <div class="eyes">
        <div class="eye left"></div>
        <div class="eye right"></div>
      </div>

      <div class="cheek left"></div>
      <div class="cheek right"></div>

      <div class="mouth"></div>
    </div>

    <!-- 声波动画 (说话时显示) -->
    <div v-show="props.state === 'speaking'" class="voice-rings">
      <div class="voice-ring"></div>
      <div class="voice-ring"></div>
      <div class="voice-ring"></div>
      <div class="voice-ring"></div>
      <div class="voice-ring"></div>
    </div>
  </div>
</template>

<style scoped>
/* 移植自 deep-study/3d-avatar/index.html 的 CSS，并适配 Vue Scoped */

.avatar-wrap {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: scale(0.55);
  transition: transform 0.3s;
}

/* 呼吸光圈 */
.glow {
  position: absolute;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(120, 180, 255, 0.15) 0%, transparent 70%);
  animation: breathe 3s ease-in-out infinite;
}
@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.12);
    opacity: 1;
  }
}

/* 主体：圆脸猫 */
.face {
  position: relative;
  width: 200px;
  height: 200px;
  background: linear-gradient(145deg, #6ec6ff 0%, #4a9eff 100%);
  border-radius: 50%;
  box-shadow:
    0 8px 32px rgba(78, 158, 255, 0.3),
    inset 0 -4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
  z-index: 2;
}

/* 耳朵 */
.ear {
  position: absolute;
  width: 50px;
  height: 60px;
  top: -20px;
  background: linear-gradient(145deg, #5bb8ff 0%, #3d8bff 100%);
  border-radius: 50% 50% 0 0;
  transition: transform 0.3s;
}
.ear.left {
  left: 20px;
  transform: rotate(-20deg);
}
.ear.right {
  right: 20px;
  transform: rotate(20deg);
}
.ear-inner {
  position: absolute;
  width: 28px;
  height: 34px;
  top: 6px;
  left: 11px;
  background: linear-gradient(145deg, #ff9ec6 0%, #ff6b9d 100%);
  border-radius: 50% 50% 0 0;
}

/* 眼睛 */
.eyes {
  position: absolute;
  top: 72px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 40px;
}
.eye {
  width: 32px;
  height: 32px;
  background: #1a1a3e;
  border-radius: 50%;
  position: relative;
  transition: all 0.2s;
}
.eye::after {
  content: '';
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  top: 6px;
  left: 6px;
  transition: all 0.2s;
}

/* 腮红 */
.cheek {
  position: absolute;
  width: 30px;
  height: 18px;
  top: 108px;
  background: rgba(255, 130, 170, 0.5);
  border-radius: 50%;
  opacity: 0.7;
  transition: opacity 0.3s;
}
.cheek.left {
  left: 24px;
}
.cheek.right {
  right: 24px;
}

/* 嘴巴 */
.mouth {
  position: absolute;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 10px;
  border-bottom: 3px solid #1a1a3e;
  border-radius: 0 0 50% 50%;
  transition: all 0.3s;
}

/* 声波 */
.voice-rings {
  position: absolute;
  bottom: -60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  align-items: flex-end;
  height: 30px;
  opacity: 0;
  transition: opacity 0.3s;
}
.voice-ring {
  width: 4px;
  background: rgba(120, 180, 255, 0.6);
  border-radius: 2px;
  animation: none;
}

/* ========== 状态样式 ========== */

/* 监听 (新增) */
.state-listen .ear.left {
  transform: rotate(-25deg) translateY(-2px);
}
.state-listen .ear.right {
  transform: rotate(25deg) translateY(-2px);
}
.state-listen .face {
  transform: scale(1.02);
}

/* 说话 */
.state-talk .mouth {
  width: 24px;
  height: 14px;
  background: #1a1a3e;
  border: none;
  border-radius: 50%;
  animation: talkMouth 0.3s ease-in-out infinite alternate;
}
@keyframes talkMouth {
  0% {
    height: 8px;
    width: 20px;
  }
  100% {
    height: 16px;
    width: 26px;
  }
}
.state-talk .face {
  animation: talkNod 1s ease-in-out infinite;
}
@keyframes talkNod {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(2deg);
  }
  75% {
    transform: rotate(-2deg);
  }
}
.state-talk .voice-rings {
  opacity: 1;
}
.state-talk .voice-ring {
  animation: voiceBar 0.4s ease-in-out infinite alternate;
}
.state-talk .voice-ring:nth-child(1) {
  animation-delay: 0s;
  height: 8px;
}
.state-talk .voice-ring:nth-child(2) {
  animation-delay: 0.1s;
  height: 16px;
}
.state-talk .voice-ring:nth-child(3) {
  animation-delay: 0.05s;
  height: 24px;
}
.state-talk .voice-ring:nth-child(4) {
  animation-delay: 0.15s;
  height: 16px;
}
.state-talk .voice-ring:nth-child(5) {
  animation-delay: 0.08s;
  height: 8px;
}
@keyframes voiceBar {
  0% {
    transform: scaleY(0.4);
  }
  100% {
    transform: scaleY(1);
  }
}

/* 思考 */
.state-think .eye.left {
  animation: thinkLook 2s ease-in-out infinite;
}
.state-think .eye.right {
  animation: thinkLook 2s ease-in-out infinite;
}
@keyframes thinkLook {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(4px) translateY(-2px);
  }
}
.state-think .mouth {
  width: 16px;
  height: 0;
  border-bottom: 3px solid #1a1a3e;
  border-radius: 0;
  transform: translateX(-50%) translateX(8px);
}
.state-think .face {
  animation: thinkTilt 3s ease-in-out infinite;
}
@keyframes thinkTilt {
  0%,
  100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(5deg);
  }
}

/* 眨眼 */
.blink .eye {
  height: 4px;
  border-radius: 4px;
  top: 14px;
}
.blink .eye::after {
  opacity: 0;
}
</style>
