<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
      <!-- 标题 -->
      <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">创建训练</h2>
        <button class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors" @click="emit('close')">
          <i class="i-carbon-close text-gray-600 dark:text-gray-400"></i>
        </button>
      </div>

      <!-- 表单 -->
      <div class="p-6 space-y-6">
        <!-- 步骤 1：选择智能体 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> 选择智能体 </label>
          <select
            v-model="form.agentId"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="">请选择...</option>
            <option value="app-copilot">应用管家</option>
            <option value="one-line-summary">一句话总结</option>
            <option value="knowledge-keeper">知识管理员</option>
          </select>
        </div>

        <!-- 步骤 2：选择训练目标 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> 训练目标 </label>
          <select
            v-model="form.goalName"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="">请选择...</option>
            <option value="代码生成能力">代码生成能力</option>
            <option value="文本总结能力">文本总结能力（开发中）</option>
            <option value="问题分析能力">问题分析能力（开发中）</option>
          </select>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400"> 选择智能体需要提升的能力维度 </p>
        </div>

        <!-- 步骤 3：配置参数 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> 训练轮次 </label>
            <input
              v-model.number="form.maxRounds"
              type="number"
              min="10"
              max="10000"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400"> 建议：100-1000 轮 </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> 训练策略 </label>
            <select
              v-model="form.strategy"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="sequential">串行（稳定）</option>
              <option value="parallel">并行（快速）</option>
              <option value="adaptive">自适应（智能）</option>
            </select>
          </div>
        </div>

        <!-- 并行度配置（仅并行模式） -->
        <div v-if="form.strategy === 'parallel'">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> 并行度 </label>
          <input
            v-model.number="form.parallelCount"
            type="number"
            min="2"
            max="5"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400"> 同时执行的任务数（2-5，推荐 3） </p>
        </div>

        <!-- 预估信息 -->
        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div class="flex items-start gap-2">
            <i class="i-carbon-information text-blue-600 dark:text-blue-400 text-lg mt-0.5"></i>
            <div class="text-sm text-blue-900 dark:text-blue-100">
              <div class="font-medium mb-1">预估信息</div>
              <div class="space-y-1 text-blue-700 dark:text-blue-300">
                <div>· 预计耗时: {{ estimatedTime }}</div>
                <div>· 预计成本: {{ estimatedCost }}</div>
                <div>· API 调用次数: {{ estimatedCalls }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
        <button
          class="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          @click="emit('close')">
          取消
        </button>
        <button
          :disabled="!isFormValid || submitting"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          @click="handleSubmit">
          <i v-if="submitting" class="i-carbon-circle-dash animate-spin"></i>
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
