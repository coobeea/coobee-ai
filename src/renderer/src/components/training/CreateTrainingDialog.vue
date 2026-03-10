<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <!-- 标题 -->
      <div class="dialog-header">
        <span class="i-carbon-machine-learning-model inline-block h-4 w-4" />
        <span>创建训练</span>
        <button class="close-btn" @click="emit('close')">
          <span class="i-carbon-close inline-block h-4 w-4" />
        </button>
      </div>

      <!-- 表单 -->
      <div class="dialog-body">
        <!-- 选择智能体 -->
        <div class="form-group">
          <label class="form-label">选择智能体</label>
          <select v-model="form.agentId" class="form-select">
            <option value="">请选择...</option>
            <option value="app-copilot">应用管家</option>
            <option value="one-line-summary">一句话总结</option>
            <option value="knowledge-keeper">知识管理员</option>
          </select>
        </div>

        <!-- 选择训练目标 -->
        <div class="form-group">
          <label class="form-label">训练目标</label>
          <select v-model="form.goalName" class="form-select">
            <option value="">请选择...</option>
            <option value="代码生成能力">代码生成能力</option>
            <option value="文本总结能力">文本总结能力（开发中）</option>
            <option value="问题分析能力">问题分析能力（开发中）</option>
          </select>
          <p class="form-hint">选择智能体需要提升的能力维度</p>
        </div>

        <!-- 配置参数 -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">训练轮次</label>
            <input v-model.number="form.maxRounds" type="number" min="10" max="10000" class="form-input" />
            <p class="form-hint">建议：100-1000 轮</p>
          </div>

          <div class="form-group">
            <label class="form-label">训练策略</label>
            <select v-model="form.strategy" class="form-select">
              <option value="sequential">串行（稳定）</option>
              <option value="parallel">并行（快速）</option>
              <option value="adaptive">自适应（智能）</option>
            </select>
          </div>
        </div>

        <!-- 并行度配置 -->
        <div v-if="form.strategy === 'parallel'" class="form-group">
          <label class="form-label">并行度</label>
          <input v-model.number="form.parallelCount" type="number" min="2" max="5" class="form-input" />
          <p class="form-hint">同时执行的任务数（2-5，推荐 3）</p>
        </div>

        <!-- 预估信息 -->
        <div class="estimate-card">
          <span class="i-carbon-information inline-block h-4 w-4 estimate-icon" />
          <div class="estimate-content">
            <div class="estimate-title">预估信息</div>
            <div class="estimate-list">
              <div>· 预计耗时: {{ estimatedTime }}</div>
              <div>· 预计成本: {{ estimatedCost }}</div>
              <div>· API 调用次数: {{ estimatedCalls }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('close')">取消</button>
        <button :disabled="!isFormValid || submitting" class="btn-primary" @click="handleSubmit">
          <span v-if="submitting" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
          <span>{{ submitting ? '创建中...' : '开始训练' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import * as trainingApi from '@/api/training';
import type { TrainingSession } from '@shared/types/training';

const emit = defineEmits<{
  close: [];
  created: [session: TrainingSession];
}>();

// 表单数据
const form = ref({
  agentId: '',
  goalName: '',
  maxRounds: 500,
  strategy: 'sequential' as 'sequential' | 'parallel' | 'adaptive',
  parallelCount: 3
});

const submitting = ref(false);

// 表单验证
const isFormValid = computed(() => {
  return form.value.agentId && form.value.goalName && form.value.maxRounds >= 10;
});

// 预估信息
const estimatedTime = computed(() => {
  const rounds = form.value.maxRounds;
  const parallel = form.value.strategy === 'parallel' ? form.value.parallelCount : 1;
  const secondsPerRound = 12; // 平均每轮 12 秒
  const totalSeconds = (rounds / parallel) * secondsPerRound;

  if (totalSeconds < 60) return `约 ${Math.ceil(totalSeconds)} 秒`;
  if (totalSeconds < 3600) return `约 ${Math.ceil(totalSeconds / 60)} 分钟`;
  return `约 ${(totalSeconds / 3600).toFixed(1)} 小时`;
});

const estimatedCost = computed(() => {
  const rounds = form.value.maxRounds;
  const callsPerRound = 3; // 平均每轮 3 次 Agent 调用
  const costPerCall = 0.0001; // deepseek-chat 约 $0.0001/次
  const total = rounds * callsPerRound * costPerCall;

  if (total < 0.1) return `< $0.1`;
  return `约 $${total.toFixed(2)}`;
});

const estimatedCalls = computed(() => {
  const rounds = form.value.maxRounds;
  const callsPerRound = 3;
  return `约 ${rounds * callsPerRound} 次`;
});

// 提交创建
async function handleSubmit(): Promise<void> {
  if (!isFormValid.value || submitting.value) return;

  submitting.value = true;
  try {
    const session = await trainingApi.createTraining({
      agentId: form.value.agentId,
      goalName: form.value.goalName,
      maxRounds: form.value.maxRounds,
      strategy: form.value.strategy,
      parallelCount: form.value.strategy === 'parallel' ? form.value.parallelCount : undefined
    });

    emit('created', session);
  } catch (err) {
    console.error('创建训练失败:', err);
    alert(`创建失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
/* ====== 对话框遮罩 ====== */

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: hsl(var(--overlay) / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

/* ====== 对话框容器 ====== */

.dialog {
  background: hsl(var(--surface));
  border-radius: 12px;
  box-shadow: 0 8px 32px hsl(var(--shadow) / 0.12);
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ====== 对话框头部 ====== */

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.close-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: hsl(var(--text-secondary));
  cursor: pointer;
  transition: all 0.12s ease;
}

.close-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

/* ====== 对话框内容 ====== */

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ====== 表单元素 ====== */

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.form-input,
.form-select {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--input-background));
  color: hsl(var(--foreground));
  font-size: 13px;
  transition: all 0.12s ease;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
}

.form-hint {
  font-size: 11px;
  color: hsl(var(--text-muted));
}

/* ====== 预估信息卡片 ====== */

.estimate-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  background: hsl(var(--info) / 0.08);
  border: 1px solid hsl(var(--info) / 0.2);
}

.estimate-icon {
  flex-shrink: 0;
  color: hsl(var(--info));
}

.estimate-content {
  flex: 1;
}

.estimate-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.estimate-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: hsl(var(--text-secondary));
}

/* ====== 对话框底部 ====== */

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid hsl(var(--border) / 0.5);
}

.btn-secondary,
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.btn-secondary {
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
}

.btn-secondary:hover {
  background: hsl(var(--secondary-hover));
}

.btn-primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.btn-primary:hover {
  background: hsl(var(--primary-hover));
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
