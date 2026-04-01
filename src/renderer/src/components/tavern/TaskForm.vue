<script setup lang="ts">
/**
 * TaskForm — 任务发布/详情表单
 *
 * 支持：
 * - 创建模式：发布新任务
 * - 详情模式：查看任务详情（只读）
 */

import { ref, computed, onMounted } from 'vue';
import configManager from '@/config';
import AIGenerate from '@/components/common/AIGenerate.vue';
import LifecycleProgress from './LifecycleProgress.vue';
import { useConfirm } from '@/composables/useConfirm';

interface TaskResult {
  textResult: string;
  fileResults: string[];
}

interface TaskConfig {
  useLifecycle?: boolean;
  autoSelectSolution?: boolean;
  requireDocumentation?: boolean;
}

interface Task {
  id: string;
  title: string;
  description: string;
  amount: number;
  files: string[];
  agentId?: string;
  executionMode?: 'agent' | 'orchestrator' | 'swarm' | 'discussion' | 'quality-loop';
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled' | 'awaiting-input';
  result?: TaskResult;
  config?: TaskConfig;
  lifecycleStage?: string;
  awaitingInputSince?: number;
  userInputs?: Record<string, unknown>;
  requiredInputs?: string[];
  createdAt: string;
  updatedAt: string;
}

const props = withDefaults(
  defineProps<{
    taskId?: string;
    readonly?: boolean;
  }>(),
  {
    readonly: false
  }
);

const emit = defineEmits<{
  cancel: [];
  success: [];
}>();

const BASE_URL = `${configManager.getBaseUrl()}/gateway/tavern`;
const $confirm = useConfirm();

const title = ref('');
const description = ref('');
const amount = ref(100);
const filePaths = ref<string[]>([]);
const agentId = ref('default'); // 执行智能体 ID
const executionMode = ref<Task['executionMode']>('agent'); // 执行模式
const useLifecycle = ref(true); // 是否使用五阶段生命周期流程（默认启用）
const taskStatus = ref<Task['status']>('pending');
const taskResult = ref<TaskResult | undefined>(undefined);
const taskConfig = ref<TaskConfig | undefined>(undefined);
const lifecycleStage = ref<string | undefined>(undefined);

// awaiting-input 相关状态
const requiredInputs = ref<string[]>([]);
const awaitingInputSince = ref<number | undefined>(undefined);
// TODO: 补充资料相关变量待补充
// const userInputValues = ref<Record<string, string>>({});
// const generalInput = ref('');
// const isContinuing = ref(false);

// 智能体列表
interface AgentOption {
  id: string;
  name: string;
}
const agents = ref<AgentOption[]>([{ id: 'default', name: '默认智能体' }]);

// 执行模式选项
const executionModes = [
  { value: 'agent', label: '单智能体模式', description: '单个智能体独立完成任务' },
  { value: 'orchestrator', label: '编排模式', description: '智能体协调器统筹多个子智能体' },
  { value: 'swarm', label: '蜂群模式', description: '多智能体自组织协作' },
  { value: 'discussion', label: '讨论模式', description: '多智能体圆桌讨论决策' },
  { value: 'quality-loop', label: '质量循环模式', description: '执行→验证→修复闭环' }
] as const;

const loading = ref(false);
const saving = ref(false);
const cancelling = ref(false);
const error = ref<string | null>(null);

const canSubmit = computed(() => title.value.trim() && description.value.trim() && amount.value > 0 && agentId.value);
const canCancel = computed(() => props.readonly && taskStatus.value === 'pending');

// 加载智能体列表
async function loadAgents(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL.replace('/tavern', '')}/agents`);
    if (!res.ok) return;

    const data = await res.json();
    const agentsList = (data.agents || []) as Array<{ id: string; name: string }>;

    agents.value = [{ id: 'default', name: '默认智能体' }, ...agentsList.map((a) => ({ id: a.id, name: a.name }))];
  } catch (err) {
    console.error('加载智能体列表失败:', err);
  }
}

// AI 优化描述
const canOptimize = computed(() => description.value.trim().length > 0 && !props.readonly);

const handleOptimizeSuccess = (result: unknown): void => {
  // app-copilot 返回的是 Markdown 格式的详细描述
  if (typeof result === 'string') {
    description.value = result;
  }
};

// 加载任务详情
async function loadTask(): Promise<void> {
  if (!props.taskId) return;

  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`${BASE_URL}/tasks/${props.taskId}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    const task = (data as { task: Task }).task;
    title.value = task.title;
    description.value = task.description;
    amount.value = task.amount;
    filePaths.value = task.files || [];
    agentId.value = task.agentId || 'default';
    executionMode.value = task.executionMode || 'agent';
    useLifecycle.value = task.config?.useLifecycle ?? true;
    taskStatus.value = task.status;
    taskResult.value = task.result;
    taskConfig.value = task.config;
    lifecycleStage.value = task.lifecycleStage;
    requiredInputs.value = task.requiredInputs || [];
    awaitingInputSince.value = task.awaitingInputSince;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

// 选择文件
async function handleSelectFiles(): Promise<void> {
  try {
    // 使用 Electron 的文件选择对话框
    const result = (await window.electron.ipcRenderer.invoke('shell:open-file', {
      properties: ['openFile', 'multiSelections']
    })) as { canceled: boolean; filePaths: string[] };

    if (result && !result.canceled && result.filePaths) {
      // 添加新选择的文件，避免重复
      result.filePaths.forEach((path: string) => {
        if (!filePaths.value.includes(path)) {
          filePaths.value.push(path);
        }
      });
    }
  } catch (err) {
    console.error('Failed to select files:', err);
  }
}

// 移除文件
function removeFile(index: number): void {
  filePaths.value.splice(index, 1);
}

// 获取文件名（从完整路径）
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

// 取消任务
async function handleCancelTask(): Promise<void> {
  if (!props.taskId || cancelling.value) return;

  const confirmed = await $confirm.warning('确定要取消这个任务吗？', {
    title: '取消任务',
    confirmText: '确定取消',
    cancelText: '暂不取消'
  });

  if (!confirmed) {
    return;
  }

  cancelling.value = true;
  error.value = null;

  try {
    const res = await fetch(`${BASE_URL}/tasks/${props.taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'cancelled'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }

    // 更新本地状态
    taskStatus.value = 'cancelled';
    emit('success');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    cancelling.value = false;
  }
}

// 提交表单
async function handleSubmit(): Promise<void> {
  if (!canSubmit.value || saving.value) return;

  saving.value = true;
  error.value = null;

  try {
    const res = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title.value.trim(),
        description: description.value.trim(),
        amount: amount.value,
        filePaths: filePaths.value,
        agentId: agentId.value,
        executionMode: executionMode.value,
        config: {
          useLifecycle: useLifecycle.value,
          autoSelectSolution: true,
          requireDocumentation: true
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }

    emit('success');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadAgents();
  if (props.taskId) {
    loadTask();
  }
});
</script>

<template>
  <div class="task-form">
    <!-- 加载中 -->
    <div v-if="loading" class="loading-state">
      <span class="i-carbon-renew inline-block h-5 w-5 animate-spin opacity-25" />
      <p>加载中...</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="error && taskId" class="error-banner">
      <span class="i-carbon-warning-alt inline-block h-4 w-4" />
      <span>{{ error }}</span>
    </div>

    <!-- 表单 -->
    <div v-else class="form-container">
      <!-- 标题 -->
      <div class="form-field">
        <label class="form-label">任务标题</label>
        <input
          v-model="title"
          type="text"
          class="form-input"
          placeholder="简要描述任务..."
          :readonly="readonly"
          maxlength="100" />
      </div>

      <!-- 描述 -->
      <div class="form-field">
        <div class="form-label-row">
          <label class="form-label">任务描述</label>
          <!-- AI 优化按钮 -->
          <AIGenerate
            v-if="!readonly"
            v-slot="{ isGenerating, trigger }"
            agent="app-copilot"
            :prompt="`请将以下任务描述优化为更详细、结构化的 Markdown 格式：\n\n${description}`"
            :auto-parse-json="false"
            :require-confirm="true"
            dialog-title="AI 优化任务描述"
            confirm-text="应用优化"
            @success="handleOptimizeSuccess">
            <button class="optimize-btn" :disabled="!canOptimize || isGenerating" @click="trigger">
              <span v-if="isGenerating" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
              <span v-else class="i-carbon-ai-status inline-block h-3.5 w-3.5" />
              <span>{{ isGenerating ? 'AI 优化中...' : 'AI 优化' }}</span>
            </button>
          </AIGenerate>
        </div>
        <textarea
          v-model="description"
          class="form-textarea"
          placeholder="详细描述任务需求、目标、交付物等..."
          :readonly="readonly"
          rows="8" />
      </div>

      <!-- 金额 -->
      <div class="form-field">
        <label class="form-label">任务赏金（虚拟金币）</label>
        <div class="amount-input-wrapper">
          <span class="i-carbon-currency inline-block h-4 w-4 amount-icon" />
          <input
            v-model.number="amount"
            type="number"
            class="amount-input"
            placeholder="100"
            :readonly="readonly"
            min="1" />
          <span class="amount-suffix">金币</span>
        </div>
      </div>

      <!-- 智能体选择 -->
      <div class="form-field">
        <label class="form-label">执行智能体</label>
        <select v-model="agentId" class="form-select" :disabled="readonly">
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }}
          </option>
        </select>
        <p class="form-hint">选择负责执行此任务的智能体</p>
      </div>

      <!-- 执行模式选择 -->
      <div class="form-field">
        <label class="form-label">执行模式</label>
        <select v-model="executionMode" class="form-select" :disabled="readonly">
          <option v-for="mode in executionModes" :key="mode.value" :value="mode.value">
            {{ mode.label }}
          </option>
        </select>
        <p class="form-hint">
          {{ executionModes.find((m) => m.value === executionMode)?.description }}
        </p>
      </div>

      <!-- 生命周期模式（创建模式下显示） -->
      <div v-if="!readonly" class="form-field">
        <label class="form-label">执行模式</label>
        <div class="execution-mode-options">
          <label class="mode-option" :class="{ active: !useLifecycle }">
            <input v-model="useLifecycle" type="radio" :value="false" class="mode-radio" />
            <div class="mode-content">
              <div class="mode-header">
                <span class="i-carbon-flash inline-block h-4 w-4" />
                <span class="mode-name">快速模式</span>
                <span class="mode-badge recommended">默认</span>
              </div>
              <p class="mode-desc">直接执行任务，适合简单明确的任务（30秒-2分钟）</p>
            </div>
          </label>
          <label class="mode-option" :class="{ active: useLifecycle }">
            <input v-model="useLifecycle" type="radio" :value="true" class="mode-radio" />
            <div class="mode-content">
              <div class="mode-header">
                <span class="i-carbon-flow-data inline-block h-4 w-4" />
                <span class="mode-name">标准模式</span>
                <span class="mode-badge">五阶段</span>
              </div>
              <p class="mode-desc">
                标准化流程：需求分析→方案设计→反思优化→实施跟踪→验收报告，适合复杂任务（2-5分钟）
              </p>
            </div>
          </label>
        </div>
      </div>

      <!-- 相关资料文件 -->
      <div class="form-field">
        <label class="form-label">相关资料</label>

        <!-- 已选择的文件列表 -->
        <div v-if="filePaths.length > 0" class="file-list">
          <div v-for="(filePath, index) in filePaths" :key="index" class="file-item">
            <span class="i-carbon-document inline-block h-4 w-4 file-icon" />
            <div class="file-info">
              <span class="file-name">{{ getFileName(filePath) }}</span>
              <span class="file-path">{{ filePath }}</span>
            </div>
            <button v-if="!readonly" class="file-remove-btn" @click="removeFile(index)">
              <span class="i-carbon-close inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- 选择文件按钮 -->
        <button v-if="!readonly" class="select-file-btn" @click="handleSelectFiles">
          <span class="i-carbon-add-alt inline-block h-4 w-4" />
          <span>选择文件</span>
        </button>

        <!-- 提示信息 -->
        <div v-if="!readonly && filePaths.length === 0" class="file-hint">
          <span class="i-carbon-information inline-block h-3.5 w-3.5" />
          <span>支持选择多个文件，仅保存文件路径</span>
        </div>
      </div>

      <!-- 执行进度（只在只读模式且使用 lifecycle 时显示） -->
      <div v-if="readonly && taskConfig?.useLifecycle" class="form-field">
        <label class="form-label">执行进度</label>
        <LifecycleProgress :task-id="taskId!" :current-stage="lifecycleStage" />
      </div>

      <!-- TODO: 补充资料 UI 待完善 (handleContinueTask, formatDuration 函数需添加) -->

      <!-- 任务结果（只在只读模式且有结果时显示） -->
      <div v-if="readonly && taskResult" class="form-field">
        <label class="form-label">任务结果</label>

        <!-- 文字结果 -->
        <div v-if="taskResult.textResult" class="result-section">
          <div class="result-label">
            <span class="i-carbon-document-tasks inline-block h-3.5 w-3.5" />
            <span>文字结果</span>
          </div>
          <div class="result-content">{{ taskResult.textResult }}</div>
        </div>

        <!-- 文件结果 -->
        <div v-if="taskResult.fileResults && taskResult.fileResults.length > 0" class="result-section">
          <div class="result-label">
            <span class="i-carbon-document inline-block h-3.5 w-3.5" />
            <span>文件结果</span>
          </div>
          <div class="file-list">
            <div v-for="(filePath, index) in taskResult.fileResults" :key="index" class="file-item">
              <span class="i-carbon-document inline-block h-4 w-4 file-icon" />
              <div class="file-info">
                <span class="file-name">{{ getFileName(filePath) }}</span>
                <span class="file-path">{{ filePath }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error && !taskId" class="error-message">
        <span class="i-carbon-warning-alt inline-block h-4 w-4" />
        <span>{{ error }}</span>
      </div>

      <!-- 按钮组 -->
      <div class="form-actions">
        <button class="cancel-btn" @click="emit('cancel')">
          {{ readonly ? '关闭' : '取消' }}
        </button>
        <button v-if="canCancel" class="cancel-task-btn" :disabled="cancelling" @click="handleCancelTask">
          <span v-if="cancelling" class="i-carbon-renew inline-block h-4 w-4 animate-spin" />
          <span v-else class="i-carbon-close-filled inline-block h-4 w-4" />
          <span>{{ cancelling ? '取消中...' : '取消任务' }}</span>
        </button>
        <button v-if="!readonly" class="submit-btn" :disabled="!canSubmit || saving" @click="handleSubmit">
          <span v-if="saving" class="i-carbon-renew inline-block h-4 w-4 animate-spin" />
          <span v-else class="i-carbon-send-filled inline-block h-4 w-4" />
          <span>{{ saving ? '发布中...' : '发布任务' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.awaiting-input-section {
  margin-top: 1.5rem;
  padding: 1.5rem;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 8px;
}

.awaiting-input-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.status-icon {
  font-size: 2rem;
  color: #ff9800;
  flex-shrink: 0;
}

.status-text h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  color: #ff9800;
}

.status-text p {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}

.required-inputs,
.no-required-inputs {
  margin-bottom: 1.5rem;
}

.input-field {
  margin-bottom: 1rem;
}

.input-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #333;
}

.input-textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
  transition: border-color 0.2s;
}

.input-textarea:focus {
  outline: none;
  border-color: #007bff;
}

.awaiting-input-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.btn-primary,
.btn-secondary {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover {
  background: #545b62;
}

.awaiting-since {
  font-size: 0.85rem;
  color: #666;
  text-align: right;
}

.task-form {
  max-width: 800px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 32px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 13px;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  background: hsl(var(--error) / 0.1);
  border: 1px solid hsl(var(--error) / 0.2);
  color: hsl(var(--error));
  font-size: 13px;
  margin-bottom: 16px;
}

.form-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.85);
}

.optimize-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.85) 100%);
  color: hsl(var(--primary-foreground));
  font-size: 13px;
  font-weight: 600;
  box-shadow:
    0 2px 8px hsl(var(--primary) / 0.25),
    0 4px 12px hsl(var(--primary) / 0.15);
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.optimize-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: hsl(var(--primary-foreground) / 0.15);
  transform: translate(-50%, -50%);
  transition:
    width 0.3s ease,
    height 0.3s ease;
}

.optimize-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 4px 12px hsl(var(--primary) / 0.35),
    0 6px 20px hsl(var(--primary) / 0.25);
}

.optimize-btn:hover:not(:disabled)::before {
  width: 300px;
  height: 300px;
}

.optimize-btn:active:not(:disabled) {
  transform: translateY(0);
}

.optimize-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.form-input,
.form-textarea,
.form-select {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface) / 0.6);
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.5;
  transition: all 0.15s ease;
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--surface));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.08);
}

.form-input:read-only,
.form-textarea:read-only,
.form-select:disabled {
  background: hsl(var(--muted) / 0.3);
  cursor: default;
}

.form-textarea {
  resize: vertical;
  min-height: 120px;
}

.form-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: hsl(var(--muted-foreground));
}

.amount-input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface) / 0.6);
  transition: all 0.15s ease;
}

.amount-input-wrapper:focus-within {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--surface));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.08);
}

.amount-icon {
  color: hsl(var(--primary));
}

.amount-input {
  flex: 1;
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 15px;
  font-weight: 600;
  outline: none;
}

.amount-suffix {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.3);
}

.file-icon {
  color: hsl(var(--primary) / 0.6);
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path {
  font-size: 11px;
  font-family: var(--font-family-mono);
  color: hsl(var(--muted-foreground) / 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.file-remove-btn:hover {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.select-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px dashed hsl(var(--border) / 0.5);
  background: hsl(var(--surface) / 0.3);
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
  align-self: flex-start;
  margin-top: 8px;
}

.select-file-btn:hover {
  border-color: hsl(var(--primary) / 0.4);
  background: hsl(var(--primary) / 0.05);
  color: hsl(var(--primary));
}

.file-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.2);
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-top: 8px;
}

/* 结果展示 */
.result-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.result-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
}

.result-content {
  padding: 12px 14px;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.15);
  border: 1px solid hsl(var(--border) / 0.25);
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
  word-break: break-word;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error));
  font-size: 12px;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 8px;
}

.cancel-btn,
.cancel-task-btn,
.submit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.cancel-btn {
  color: hsl(var(--muted-foreground));
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.4);
}

.cancel-btn:hover {
  background: hsl(var(--muted) / 0.3);
  border-color: hsl(var(--border) / 0.6);
}

.cancel-task-btn {
  color: hsl(var(--error-foreground));
  background: hsl(var(--error));
}

.cancel-task-btn:hover:not(:disabled) {
  background: hsl(var(--error) / 0.9);
  box-shadow: 0 2px 8px hsl(var(--error) / 0.25);
}

.cancel-task-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
}

.submit-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 执行模式选择 */
.execution-mode-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  border: 2px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface));
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-option:hover {
  border-color: hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.15);
}

.mode-option.active {
  border-color: hsl(var(--primary) / 0.8);
  background: hsl(var(--primary) / 0.05);
}

.mode-radio {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.mode-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mode-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.mode-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--muted-foreground));
}

.mode-badge.recommended {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}

.mode-desc {
  font-size: 12px;
  line-height: 1.5;
  color: hsl(var(--muted-foreground));
  margin: 0;
}
</style>
