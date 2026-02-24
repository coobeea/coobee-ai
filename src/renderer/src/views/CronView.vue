<script setup lang="ts">
/**
 * CronView — 定时任务管理视图
 *
 * 功能：
 *   1. 列出所有定时任务
 *   2. 创建新的定时任务
 *   3. 编辑/删除已有任务
 *   4. 显示任务状态和执行记录
 */

import { ref, onMounted } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import configManager from '@/config';
import ErrorDisplay from '@/components/common/ErrorDisplay.vue';

interface CronJobDefinition {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  status: 'active' | 'paused' | 'disabled' | 'error';
  agentId?: string;
  task: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  failCount: number;
  lastError?: string;
}

const agentsStore = useAgentsStore();
const cronJobs = ref<CronJobDefinition[]>([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const error = ref<{ message: string; details?: string } | null>(null);

// 新任务表单
const newJob = ref({
  name: '',
  description: '',
  cronExpression: '0 9 * * *', // 默认每天上午9点
  agentId: ''
});

const BASE_URL = `${configManager.getBaseUrl()}/gateway/cron-jobs`;

onMounted(() => {
  loadCronJobs();
});

/**
 * 加载定时任务列表
 */
async function loadCronJobs(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(BASE_URL);
    if (!res.ok) throw new Error('Failed to load cron jobs');
    const data = await res.json();
    cronJobs.value = data.jobs || [];
  } catch (err) {
    error.value = {
      message: '加载任务列表失败',
      details: err instanceof Error ? err.message : String(err)
    };
  } finally {
    loading.value = false;
  }
}

/**
 * 创建定时任务
 */
async function createCronJob(): Promise<void> {
  error.value = null;

  if (!newJob.value.name || !newJob.value.description || !newJob.value.agentId) {
    error.value = {
      message: '请填写所有必填字段',
      details: '任务名称、任务描述和智能体都是必填项'
    };
    return;
  }

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newJob.value)
    });

    if (!res.ok) throw new Error('Failed to create cron job');

    // 重置表单
    newJob.value = {
      name: '',
      description: '',
      cronExpression: '0 9 * * *',
      agentId: ''
    };
    showCreateDialog.value = false;

    // 重新加载列表
    await loadCronJobs();
  } catch (err) {
    error.value = {
      message: '创建任务失败',
      details: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * 删除定时任务
 */
async function deleteCronJob(id: string): Promise<void> {
  if (!confirm('确定要删除这个定时任务吗？')) return;

  error.value = null;
  try {
    const res = await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete cron job');
    await loadCronJobs();
  } catch (err) {
    error.value = {
      message: '删除任务失败',
      details: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * 切换任务状态（暂停/恢复）
 */
async function toggleJobStatus(job: CronJobDefinition): Promise<void> {
  const newStatus = job.status === 'active' ? 'paused' : 'active';

  error.value = null;
  try {
    const res = await fetch(`${BASE_URL}/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error('Failed to update job status');
    await loadCronJobs();
  } catch (err) {
    error.value = {
      message: '更新任务状态失败',
      details: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * 格式化时间
 */
function formatTime(iso?: string): string {
  if (!iso) return '无';
  const date = new Date(iso);
  return date.toLocaleString('zh-CN');
}

/**
 * 获取状态颜色
 */
function getStatusColor(status: CronJobDefinition['status']): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-700';
    case 'paused':
      return 'bg-gray-100 text-gray-600';
    case 'error':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

/**
 * 获取状态文本
 */
function getStatusText(status: CronJobDefinition['status']): string {
  switch (status) {
    case 'active':
      return '运行中';
    case 'paused':
      return '已暂停';
    case 'error':
      return '错误';
    default:
      return '未知';
  }
}
</script>

<template>
  <div class="cron-view">
    <!-- 顶部工具栏 -->
    <div class="header">
      <div class="header-left">
        <h1 class="title">定时任务</h1>
        <p class="subtitle">自动化执行定期任务</p>
      </div>
      <button class="btn-primary" @click="showCreateDialog = true">
        <span class="i-carbon-add inline-block h-4 w-4" />
        <span>创建任务</span>
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="px-6 pt-4">
      <ErrorDisplay :error="error" level="error" title="操作失败" :dismissible="true" @dismiss="error = null" />
    </div>

    <!-- 任务列表 -->
    <div class="content">
      <!-- 加载中 -->
      <div v-if="loading" class="empty-state">
        <span class="i-carbon-renew inline-block h-6 w-6 animate-spin opacity-20" />
        <p>加载中...</p>
      </div>

      <!-- 空态 -->
      <div v-else-if="cronJobs.length === 0" class="empty-state">
        <span class="i-carbon-time inline-block h-12 w-12 opacity-10" />
        <p>还没有定时任务</p>
        <button class="btn-secondary" @click="showCreateDialog = true">创建第一个任务</button>
      </div>

      <!-- 任务卡片列表 -->
      <div v-else class="job-grid">
        <div v-for="job in cronJobs" :key="job.id" class="job-card">
          <div class="job-header">
            <div class="job-title-row">
              <h3 class="job-name">{{ job.name }}</h3>
              <span class="status-badge" :class="getStatusColor(job.status)">
                {{ getStatusText(job.status) }}
              </span>
            </div>
            <p class="job-description">{{ job.description }}</p>
          </div>

          <div class="job-body">
            <div class="job-meta">
              <div class="meta-item">
                <span class="meta-label">调度规则</span>
                <span class="meta-value font-mono">{{ job.cronExpression }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">执行次数</span>
                <span class="meta-value">{{ job.runCount }} 次</span>
              </div>
              <div v-if="job.lastRunAt" class="meta-item">
                <span class="meta-label">上次执行</span>
                <span class="meta-value">{{ formatTime(job.lastRunAt) }}</span>
              </div>
              <div v-if="job.nextRunAt" class="meta-item">
                <span class="meta-label">下次执行</span>
                <span class="meta-value">{{ formatTime(job.nextRunAt) }}</span>
              </div>
            </div>
          </div>

          <div class="job-footer">
            <button
              class="btn-text"
              :class="job.status === 'active' ? 'text-amber-600' : 'text-emerald-600'"
              @click="toggleJobStatus(job)">
              <span
                class="inline-block h-3.5 w-3.5"
                :class="job.status === 'active' ? 'i-carbon-pause' : 'i-carbon-play'" />
              <span>{{ job.status === 'active' ? '暂停' : '恢复' }}</span>
            </button>
            <button class="btn-text text-red-600" @click="deleteCronJob(job.id)">
              <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
              <span>删除</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建任务对话框 -->
    <div v-if="showCreateDialog" class="dialog-overlay" @click.self="showCreateDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <h2 class="dialog-title">创建定时任务</h2>
          <button class="dialog-close" @click="showCreateDialog = false">
            <span class="i-carbon-close inline-block h-5 w-5" />
          </button>
        </div>

        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">任务名称</label>
            <input v-model="newJob.name" type="text" class="form-input" placeholder="例如：每日数据汇总" />
          </div>

          <div class="form-group">
            <label class="form-label">任务描述</label>
            <textarea
              v-model="newJob.description"
              class="form-textarea"
              rows="3"
              placeholder="描述这个任务要做什么..."></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">定时规则 (Cron 表达式)</label>
            <input v-model="newJob.cronExpression" type="text" class="form-input" placeholder="0 9 * * *" />
            <p class="form-hint">例如: "0 9 * * *" 表示每天上午9点</p>
          </div>

          <div class="form-group">
            <label class="form-label">选择智能体</label>
            <select v-model="newJob.agentId" class="form-select">
              <option value="">-- 请选择 --</option>
              <option v-for="agent in agentsStore.agents" :key="agent.id" :value="agent.id">
                {{ agent.name }}
              </option>
            </select>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" @click="showCreateDialog = false">取消</button>
          <button class="btn-primary" @click="createCronJob">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cron-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: hsl(var(--background));
}

/* ====== 顶部工具栏 ====== */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  border-bottom: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface));
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.subtitle {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.6);
}

/* ====== 内容区 ====== */

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 80px 32px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 14px;
}

.job-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

/* ====== 任务卡片 ====== */

.job-card {
  display: flex;
  flex-direction: column;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.4);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.job-card:hover {
  border-color: hsl(var(--border));
  box-shadow: 0 2px 8px hsl(var(--foreground) / 0.04);
}

.job-header {
  padding: 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
}

.job-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.job-name {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  line-height: 1.4;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
}

.job-description {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.7);
  line-height: 1.5;
}

.job-body {
  padding: 16px;
  flex: 1;
}

.job-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-label {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-value {
  font-size: 13px;
  color: hsl(var(--foreground) / 0.8);
}

.job-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid hsl(var(--border) / 0.3);
}

/* ====== 按钮 ====== */

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.btn-primary:hover {
  background: hsl(var(--primary-hover));
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.7);
  background: hsl(var(--foreground) / 0.05);
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  background: hsl(var(--foreground) / 0.1);
}

.btn-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-text:hover {
  background: hsl(var(--foreground) / 0.05);
}

/* ====== 对话框 ====== */

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--foreground) / 0.2);
  backdrop-filter: blur(4px);
}

.dialog {
  width: 500px;
  max-width: 90vw;
  background: hsl(var(--surface));
  border-radius: 16px;
  box-shadow: 0 12px 40px hsl(var(--foreground) / 0.15);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid hsl(var(--border) / 0.4);
}

.dialog-title {
  font-size: 17px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.dialog-close:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground));
}

.dialog-body {
  padding: 24px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.8);
}

.form-input,
.form-textarea,
.form-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid hsl(var(--border) / 0.4);
  border-radius: 8px;
  font-size: 14px;
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  transition: all 0.15s ease;
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-hint {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid hsl(var(--border) / 0.4);
}
</style>
