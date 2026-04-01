<script setup lang="ts">
/**
 * LifecycleProgress - 任务生命周期进度展示
 *
 * 显示五阶段任务的执行进度
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { GatewayClient } from '@/services/GatewayClient';

const props = defineProps<{
  taskId: string;
  currentStage?: string;
}>();

const gateway = new GatewayClient('ws://localhost:28888');
const localStage = ref(props.currentStage || '');

const stages = [
  { key: 'requirement-analysis', name: '需求分析', icon: 'i-carbon-document' },
  { key: 'solution-design', name: '方案设计', icon: 'i-carbon-plan' },
  { key: 'reflection', name: '反思优化', icon: 'i-carbon-idea' },
  { key: 'implementation', name: '实施跟踪', icon: 'i-carbon-tools' },
  { key: 'acceptance', name: '验收报告', icon: 'i-carbon-checkmark' }
];

const currentStageIndex = computed(() => {
  const index = stages.findIndex((s) => s.key === localStage.value);
  return index >= 0 ? index : -1;
});

const progressPercent = computed(() => {
  if (currentStageIndex.value < 0) return 0;
  return Math.round(((currentStageIndex.value + 1) / stages.length) * 100);
});

const isStageCompleted = (index: number): boolean => {
  return currentStageIndex.value >= index;
};

const isStageCurrent = (index: number): boolean => {
  return currentStageIndex.value === index;
};

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  gateway.connect();
  unsubscribe = gateway.on('tavern.stage-changed', (data: unknown) => {
    const eventData = data as { taskId: string; stage: string };
    if (eventData.taskId === props.taskId) {
      localStage.value = eventData.stage;
    }
  });
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
  gateway.disconnect();
});
</script>

<template>
  <div class="lifecycle-progress">
    <!-- 进度条 -->
    <div class="progress-bar-container">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <span class="progress-text">{{ progressPercent }}%</span>
    </div>

    <!-- 阶段列表 -->
    <div class="stages">
      <div
        v-for="(stage, index) in stages"
        :key="stage.key"
        class="stage"
        :class="{
          completed: isStageCompleted(index),
          current: isStageCurrent(index),
          pending: index > currentStageIndex
        }">
        <!-- 阶段图标 -->
        <div class="stage-icon">
          <span :class="[stage.icon, 'inline-block h-5 w-5']" />
          <div v-if="index < stages.length - 1" class="stage-line" />
        </div>

        <!-- 阶段信息 -->
        <div class="stage-info">
          <div class="stage-name">{{ stage.name }}</div>
          <div class="stage-status">
            <span v-if="isStageCompleted(index) && !isStageCurrent(index)" class="status-text completed"> 已完成 </span>
            <span v-else-if="isStageCurrent(index)" class="status-text current">进行中</span>
            <span v-else class="status-text pending">待执行</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lifecycle-progress {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 进度条 */
.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: hsl(var(--muted) / 0.25);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--primary));
  min-width: 42px;
  text-align: right;
}

/* 阶段列表 */
.stages {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.stage {
  display: flex;
  gap: 14px;
  position: relative;
}

/* 阶段图标 */
.stage-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: hsl(var(--muted) / 0.25);
  border: 2px solid hsl(var(--border) / 0.3);
  flex-shrink: 0;
  transition: all 0.2s ease;
  z-index: 1;
}

.stage.completed .stage-icon {
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.5);
  color: hsl(var(--primary));
}

.stage.current .stage-icon {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 0 0 4px hsl(var(--primary) / 0.15);
}

.stage.pending .stage-icon {
  color: hsl(var(--muted-foreground) / 0.5);
}

/* 阶段连接线 */
.stage-line {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 24px;
  background: hsl(var(--border) / 0.3);
  transition: background 0.2s ease;
}

.stage.completed .stage-line {
  background: hsl(var(--primary) / 0.5);
}

.stage.current .stage-line {
  background: hsl(var(--primary) / 0.3);
}

/* 阶段信息 */
.stage-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  flex: 1;
}

.stage-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.stage.completed .stage-name {
  color: hsl(var(--primary));
}

.stage.current .stage-name {
  color: hsl(var(--primary));
}

.stage.pending .stage-name {
  color: hsl(var(--muted-foreground) / 0.6);
}

.stage-status {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-text {
  font-size: 12px;
  font-weight: 500;
}

.status-text.completed {
  color: hsl(var(--primary));
}

.status-text.current {
  color: hsl(var(--primary));
}

.status-text.pending {
  color: hsl(var(--muted-foreground) / 0.5);
}
</style>
