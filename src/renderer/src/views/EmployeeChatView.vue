<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { employeeApi, type DigitalEmployee } from '@/api/employee';
import EmployeeAvatar from '@/components/EmployeeAvatar.vue';
import AudioVisualizer from '@/components/AudioVisualizer.vue';
import { useAudioRecorder } from '@/composables/useAudioRecorder';

const route = useRoute();
const router = useRouter();
const employeeId = route.params.id as string;

const employee = ref<DigitalEmployee | null>(null);
const loading = ref(true);
const status = ref<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
const subtitle = ref('');
const volume = ref(0);

// 录音机
const { startRecording, stopRecording, disconnect } = useAudioRecorder({
  onPartialResult: (text) => {
    subtitle.value = text;
    status.value = 'listening';
  },
  onFinalResult: (text) => {
    subtitle.value = text;
    // TODO: 触发 LLM 回复
    console.log('Final Result:', text);
    status.value = 'thinking';
    // 模拟思考后回复
    setTimeout(() => {
      status.value = 'speaking';
      subtitle.value = `收到：${text}`;
      setTimeout(() => {
        status.value = 'idle';
        subtitle.value = '';
      }, 3000);
    }, 1000);
  },
  onVolumeChange: (vol) => {
    volume.value = vol;
  },
  onSilence: () => {
    // VAD 静音回调
    // console.log('Silence detected');
  }
});

// 加载员工信息
onMounted(async () => {
  try {
    employee.value = await employeeApi.getEmployee(employeeId);
  } catch (error) {
    console.error('Failed to load employee:', error);
    // 出错则返回列表
    router.replace('/employee');
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  disconnect();
});

const toggleMic = async (): Promise<void> => {
  if (status.value === 'listening') {
    status.value = 'idle';
    stopRecording();
  } else {
    status.value = 'listening';
    try {
      await startRecording();
    } catch (_e) {
      status.value = 'idle';
    }
  }
};

const handleExit = (): void => {
  router.push('/employee');
};
</script>

<template>
  <div class="chat-view">
    <!-- 3D Scene Container -->
    <div class="scene-container">
      <EmployeeAvatar :state="status" />
    </div>

    <!-- UI Overlay -->
    <div class="ui-overlay">
      <!-- Top Bar -->
      <header class="top-bar">
        <div v-if="employee" class="employee-info">
          <h2 class="name">{{ employee.name }}</h2>
          <span class="role">{{ employee.role }}</span>
        </div>
        <button class="btn-icon" title="结束对话" @click="handleExit">
          <span class="i-carbon-close h-6 w-6" />
        </button>
      </header>

      <!-- Subtitle Area -->
      <div class="subtitle-area">
        <p v-if="subtitle" class="subtitle-text">{{ subtitle }}</p>
        <p v-else-if="status === 'listening'" class="subtitle-text">...</p>
      </div>

      <!-- Bottom Controls -->
      <footer class="bottom-bar">
        <div class="controls-container">
          <!-- Visualizer -->
          <AudioVisualizer :volume="volume" :is-active="status === 'listening'" />

          <button class="mic-btn" :class="{ active: status === 'listening' }" @click="toggleMic">
            <span class="i-carbon-microphone h-8 w-8" />
            <div v-if="status === 'listening'" class="mic-ripple"></div>
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0f1115; /* 深色沉浸背景 */
  overflow: hidden;
  color: #fff;
}

.scene-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 0;
}

.avatar-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fff;
}

.ui-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  pointer-events: none; /* 让鼠标穿透到 3D 场景 */
}

/* Top Bar */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  pointer-events: auto;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.4), transparent);
}

.employee-info {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.name {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.role {
  font-size: 13px;
  opacity: 0.7;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.btn-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Subtitle */
.subtitle-area {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 120px;
}

.subtitle-text {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 16px;
  max-width: 60%;
  text-align: center;
}

/* Bottom Controls */
.bottom-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 140px; /* 增加高度以容纳波形 */
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
}

.controls-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.mic-btn {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.mic-btn:hover {
  transform: scale(1.05);
  background: rgba(255, 255, 255, 0.25);
}

.mic-btn.active {
  background: #ef4444; /* Recording Red */
  border-color: #ef4444;
}

.mic-ripple {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid #ef4444;
  opacity: 0;
  animation: ripple 1.5s infinite;
}

@keyframes ripple {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
</style>
