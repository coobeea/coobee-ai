<script setup lang="ts">
/**
 * CronView — 定时任务管理视图
 *
 * 功能：
 *   1. 列出所有定时任务
 *   2. 创建新的定时任务（AI 解析自然语言）
 *   3. 编辑/删除已有任务
 *   4. 显示任务状态和执行记录
 */

import { ref, onMounted, nextTick } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import configManager from '@/config';
import ErrorDisplay from '@/components/common/ErrorDisplay.vue';
import { quickChat } from '@/composables/useQuickChat';

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

interface AttachmentRef {
  path: string;
  name: string;
}

interface ParsedCronResult {
  name: string;
  description: string;
  cronExpression: string;
  task: string;
  cronHumanReadable?: string;
}

const agentsStore = useAgentsStore();
const cronJobs = ref<CronJobDefinition[]>([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const editingJob = ref<CronJobDefinition | null>(null);
const error = ref<{ message: string; details?: string } | null>(null);

const isMac = navigator.platform?.includes('Mac') ?? false;

// 创建表单状态
const userInput = ref('');
const inputRef = ref<HTMLTextAreaElement | null>(null);
const selectedAgentId = ref('');
const taskAttachments = ref<AttachmentRef[]>([]);
const parsing = ref(false);
const parsedResult = ref<ParsedCronResult | null>(null);
const parseError = ref('');
const creating = ref(false);

// 编辑表单状态
const editForm = ref({
  name: '',
  description: '',
  cronExpression: '',
  task: '',
  agentId: ''
});
const updating = ref(false);

const BASE_URL = `${configManager.getBaseUrl()}/gateway/cron-jobs`;

onMounted(() => {
  loadCronJobs();
  agentsStore.fetchAgents();
});

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

function openCreateDialog(): void {
  userInput.value = '';
  selectedAgentId.value = '';
  taskAttachments.value = [];
  parsedResult.value = null;
  parseError.value = '';
  showCreateDialog.value = true;
  nextTick(() => inputRef.value?.focus());
}

function closeCreateDialog(): void {
  showCreateDialog.value = false;
  parsedResult.value = null;
  parseError.value = '';
}

function openEditDialog(job: CronJobDefinition): void {
  editingJob.value = job;
  editForm.value = {
    name: job.name,
    description: job.description,
    cronExpression: job.cronExpression,
    task: job.task,
    agentId: job.agentId || ''
  };
  parseError.value = '';
  showEditDialog.value = true;
}

function closeEditDialog(): void {
  showEditDialog.value = false;
  editingJob.value = null;
  parseError.value = '';
}

async function handleParse(): Promise<void> {
  const input = userInput.value.trim();
  if (!input || parsing.value) return;

  parsing.value = true;
  parseError.value = '';
  parsedResult.value = null;

  try {
    const prompt = `你是一个定时任务解析助手。用户会用自然语言描述一个定时任务，你需要解析为结构化参数。
必须严格输出 JSON 对象，不要有其他文字。字段如下：
- name: 简短的任务名称（4-10字）
- description: 任务详细描述
- cronExpression: 标准 cron 表达式（5位：分 时 日 月 周）
- task: 执行的具体指令（智能体收到的提示词）
- cronHumanReadable: cron 表达式的中文解释

示例：
输入："每天早上9点帮我汇总项目进度"
输出：{"name":"每日进度汇总","description":"每天早上自动汇总项目进度并生成报告","cronExpression":"0 9 * * *","task":"请汇总今天的项目进度，整理成报告格式输出","cronHumanReadable":"每天上午 9:00"}

当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

用户输入：${input}`;

    const result = await quickChat('app-copilot', prompt);
    if (!result) throw new Error('AI 未返回结果');

    const jsonStr = result
      .replace(/```json?\s*\n?/g, '')
      .replace(/```\s*$/g, '')
      .trim();
    parsedResult.value = JSON.parse(jsonStr);
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : 'AI 解析失败';
  } finally {
    parsing.value = false;
  }
}

async function createCronJob(): Promise<void> {
  if (!parsedResult.value) return;
  if (!selectedAgentId.value) {
    parseError.value = '请选择一个智能体';
    return;
  }

  creating.value = true;
  parseError.value = '';

  // 构建 task：包含原始描述和附件路径
  let task = parsedResult.value.task;
  if (taskAttachments.value.length > 0) {
    task += '\n\n相关资料：\n' + taskAttachments.value.map((a) => `- ${a.path}`).join('\n');
  }

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: parsedResult.value.name,
        description: parsedResult.value.description,
        cronExpression: parsedResult.value.cronExpression,
        task,
        agentId: selectedAgentId.value
      })
    });

    if (!res.ok) throw new Error('Failed to create cron job');

    closeCreateDialog();
    await loadCronJobs();
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

async function deleteCronJob(id: string): Promise<void> {
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

async function updateCronJob(): Promise<void> {
  if (!editingJob.value || !editForm.value.agentId) {
    parseError.value = '请选择一个智能体';
    return;
  }

  updating.value = true;
  parseError.value = '';

  try {
    const res = await fetch(`${BASE_URL}/${editingJob.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.value.name,
        description: editForm.value.description,
        cronExpression: editForm.value.cronExpression,
        task: editForm.value.task,
        agentId: editForm.value.agentId
      })
    });

    if (!res.ok) throw new Error('Failed to update cron job');

    closeEditDialog();
    await loadCronJobs();
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : '更新失败';
  } finally {
    updating.value = false;
  }
}

async function handleAddAttachment(): Promise<void> {
  try {
    const result = await window.api.openFile({
      properties: ['openFile', 'openDirectory', 'multiSelections']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        const name = filePath.split('/').pop() || filePath;
        if (!taskAttachments.value.some((a) => a.path === filePath)) {
          taskAttachments.value.push({ path: filePath, name });
        }
      }
    }
  } catch (err) {
    console.warn('[CronView] File dialog failed:', err);
  }
}

function removeAttachment(index: number): void {
  taskAttachments.value.splice(index, 1);
}

function formatTime(iso?: string): string {
  if (!iso) return '无';
  const date = new Date(iso);
  return date.toLocaleString('zh-CN');
}

function getStatusColor(status: CronJobDefinition['status']): string {
  switch (status) {
    case 'active':
      return 'status-active';
    case 'paused':
      return 'status-paused';
    case 'error':
      return 'status-error';
    default:
      return 'status-paused';
  }
}

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

function getAgentName(agentId?: string): string {
  if (!agentId) return '默认';
  const agent = agentsStore.agents.find((a) => a.id === agentId);
  return agent?.name || agentId;
}
</script>

<template>
  <div class="cron-view">
    <!-- 顶部工具栏 -->
    <div class="cv-header">
      <div class="cv-header-left">
        <div class="cv-header-icon">
          <span class="i-carbon-time inline-block h-4 w-4" />
        </div>
        <h1 class="cv-header-title">定时任务</h1>
        <span v-if="cronJobs.length > 0" class="cv-header-count">{{ cronJobs.length }}</span>
      </div>
      <div class="cv-header-right">
        <button class="cv-icon-btn" title="刷新" @click="loadCronJobs">
          <span class="i-carbon-renew inline-block h-[15px] w-[15px]" :class="{ 'animate-spin': loading }" />
        </button>
        <button class="cv-create-btn" @click="openCreateDialog">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          <span>创建</span>
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="px-5 pt-3">
      <ErrorDisplay :error="error" level="error" title="操作失败" :dismissible="true" @dismiss="error = null" />
    </div>

    <!-- 任务列表 -->
    <div class="cv-content">
      <div v-if="loading && cronJobs.length === 0" class="cv-empty">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin opacity-20" />
        <p class="cv-empty-text">加载中...</p>
      </div>

      <div v-else-if="cronJobs.length === 0 && !loading" class="cv-empty">
        <div class="cv-empty-visual">
          <div class="cv-empty-circle">
            <span class="i-carbon-time inline-block h-7 w-7" />
          </div>
        </div>
        <p class="cv-empty-heading">创建你的第一个定时任务</p>
        <p class="cv-empty-sub">用自然语言描述任务，AI 自动生成调度规则</p>
        <button class="cv-primary-btn mt-5" @click="openCreateDialog">
          <span class="i-carbon-watson inline-block h-3.5 w-3.5" />
          开始创建
        </button>
      </div>

      <!-- 任务卡片列表 -->
      <div v-else class="cv-job-grid">
        <div v-for="job in cronJobs" :key="job.id" class="cv-job-card">
          <div class="cv-job-header">
            <div class="cv-job-title-row">
              <span class="cv-job-name">{{ job.name }}</span>
              <span class="cv-status-badge" :class="getStatusColor(job.status)">
                {{ getStatusText(job.status) }}
              </span>
            </div>
            <p class="cv-job-desc">{{ job.description }}</p>
          </div>

          <div class="cv-job-meta">
            <div class="cv-meta-row">
              <span class="i-carbon-timer inline-block h-3 w-3 shrink-0 opacity-40" />
              <span class="cv-meta-value font-mono">{{ job.cronExpression }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="i-carbon-bot inline-block h-3 w-3 shrink-0 opacity-40" />
              <span class="cv-meta-value">{{ getAgentName(job.agentId) }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="i-carbon-checkmark inline-block h-3 w-3 shrink-0 opacity-40" />
              <span class="cv-meta-value">{{ job.runCount }} 次执行</span>
              <span v-if="job.failCount > 0" class="cv-meta-fail">{{ job.failCount }} 失败</span>
            </div>
            <div v-if="job.nextRunAt" class="cv-meta-row">
              <span class="i-carbon-calendar inline-block h-3 w-3 shrink-0 opacity-40" />
              <span class="cv-meta-value">下次：{{ formatTime(job.nextRunAt) }}</span>
            </div>
          </div>

          <div class="cv-job-footer">
            <div class="cv-job-footer-left">
              <button
                class="cv-action-btn"
                :class="job.status === 'active' ? 'cv-warn' : 'cv-success'"
                @click="toggleJobStatus(job)">
                <span
                  class="inline-block h-3.5 w-3.5"
                  :class="job.status === 'active' ? 'i-carbon-pause' : 'i-carbon-play'" />
                <span>{{ job.status === 'active' ? '暂停' : '恢复' }}</span>
              </button>
              <button class="cv-action-btn" @click="openEditDialog(job)">
                <span class="i-carbon-edit inline-block h-3.5 w-3.5" />
                <span>编辑</span>
              </button>
            </div>
            <button class="cv-action-btn cv-danger" @click="deleteCronJob(job.id)">
              <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑任务弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showEditDialog" class="cv-overlay" @click.self="closeEditDialog">
          <div class="cv-dialog">
            <div class="cv-dialog-header">
              <span class="i-carbon-edit inline-block h-4 w-4" />
              <span>编辑定时任务</span>
            </div>

            <div class="cv-dialog-body">
              <!-- 任务名称 -->
              <div class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-text-font inline-block h-3 w-3" />
                  任务名称
                </h4>
                <input
                  v-model="editForm.name"
                  type="text"
                  class="cv-text-input"
                  placeholder="简短的任务名称（4-10字）" />
              </div>

              <!-- 任务描述 -->
              <div class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-document inline-block h-3 w-3" />
                  任务描述
                </h4>
                <textarea
                  v-model="editForm.description"
                  rows="2"
                  class="cv-text-input"
                  placeholder="详细描述任务的目的和内容"></textarea>
              </div>

              <!-- Cron 表达式 -->
              <div class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-timer inline-block h-3 w-3" />
                  调度规则
                </h4>
                <input
                  v-model="editForm.cronExpression"
                  type="text"
                  class="cv-text-input font-mono"
                  placeholder="例如：0 9 * * * （每天 9 点）" />
                <p class="cv-hint">标准 Cron 表达式（5 位：分 时 日 月 周）</p>
              </div>

              <!-- 执行指令 -->
              <div class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-task inline-block h-3 w-3" />
                  执行指令
                </h4>
                <textarea
                  v-model="editForm.task"
                  rows="4"
                  class="cv-text-input"
                  placeholder="智能体将收到的具体指令"></textarea>
              </div>

              <!-- 执行智能体 -->
              <div class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-bot inline-block h-3 w-3" />
                  执行智能体
                </h4>
                <div class="cv-agent-chips">
                  <label
                    v-for="agent in agentsStore.agents"
                    :key="agent.id"
                    class="cv-agent-chip"
                    :class="{ selected: editForm.agentId === agent.id }">
                    <input
                      v-model="editForm.agentId"
                      type="radio"
                      name="editAgent"
                      :value="agent.id"
                      class="cv-radio-hidden" />
                    <span class="i-carbon-bot inline-block h-3 w-3" />
                    <span>{{ agent.name }}</span>
                  </label>
                </div>
              </div>

              <!-- 错误提示 -->
              <div v-if="parseError" class="cv-parse-error">
                <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                {{ parseError }}
              </div>
            </div>

            <div class="cv-dialog-footer">
              <button class="cv-text-btn" @click="closeEditDialog">取消</button>
              <button
                class="cv-primary-btn"
                :disabled="!editForm.name || !editForm.agentId || updating"
                @click="updateCronJob">
                <span v-if="updating" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
                <span v-else class="i-carbon-checkmark inline-block h-3.5 w-3.5" />
                保存修改
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 创建任务弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showCreateDialog" class="cv-overlay" @click.self="closeCreateDialog">
          <div class="cv-dialog">
            <div class="cv-dialog-header">
              <span class="i-carbon-watson inline-block h-4 w-4" />
              <span>创建定时任务</span>
            </div>

            <div class="cv-dialog-body">
              <!-- 主输入区 -->
              <div class="cv-input-card" :class="{ focused: parsing }">
                <div class="cv-input-card-header">
                  <span class="i-carbon-watson inline-block h-3.5 w-3.5 cv-ai-icon" />
                  <span class="cv-input-card-label">用自然语言描述你的定时任务</span>
                </div>
                <textarea
                  ref="inputRef"
                  v-model="userInput"
                  placeholder="例如：&#10;· 每天早上 9 点汇总项目进度&#10;· 每周一下午 3 点做代码审查&#10;· 每小时检查一次服务状态"
                  rows="3"
                  class="cv-input-textarea"
                  :disabled="parsing"
                  @keydown.meta.enter="handleParse"
                  @keydown.ctrl.enter="handleParse"></textarea>
                <div class="cv-input-footer">
                  <span v-if="!parsing" class="cv-input-tip">
                    <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd>
                    <kbd>↵</kbd>
                    生成
                  </span>
                  <span v-else class="cv-input-tip">
                    <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
                    AI 解析中...
                  </span>
                  <button class="cv-generate-btn" :disabled="!userInput.trim() || parsing" @click="handleParse">
                    <span v-if="parsing" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
                    <span v-else class="i-carbon-watson inline-block h-3.5 w-3.5" />
                    <span>{{ parsing ? '解析中...' : '生成' }}</span>
                  </button>
                </div>
              </div>

              <!-- 解析错误 -->
              <div v-if="parseError" class="cv-parse-error">
                <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                {{ parseError }}
              </div>

              <!-- AI 解析结果预览 -->
              <Transition name="slide-down">
                <div v-if="parsedResult" class="cv-parsed-result">
                  <div class="cv-parsed-header">
                    <span class="i-carbon-checkmark-filled inline-block h-3.5 w-3.5 cv-parsed-icon" />
                    <span>AI 解析结果</span>
                  </div>
                  <div class="cv-parsed-fields">
                    <div class="cv-parsed-field">
                      <span class="cv-parsed-label">名称</span>
                      <span class="cv-parsed-value">{{ parsedResult.name }}</span>
                    </div>
                    <div class="cv-parsed-field">
                      <span class="cv-parsed-label">描述</span>
                      <span class="cv-parsed-value">{{ parsedResult.description }}</span>
                    </div>
                    <div class="cv-parsed-field">
                      <span class="cv-parsed-label">调度</span>
                      <span class="cv-parsed-value">
                        <code>{{ parsedResult.cronExpression }}</code>
                        <span v-if="parsedResult.cronHumanReadable" class="cv-cron-hint">
                          {{ parsedResult.cronHumanReadable }}
                        </span>
                      </span>
                    </div>
                    <div class="cv-parsed-field">
                      <span class="cv-parsed-label">指令</span>
                      <span class="cv-parsed-value cv-parsed-task">{{ parsedResult.task }}</span>
                    </div>
                  </div>
                </div>
              </Transition>

              <!-- 智能体选择 -->
              <div v-if="parsedResult" class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-bot inline-block h-3 w-3" />
                  执行智能体
                </h4>
                <div class="cv-agent-chips">
                  <label
                    v-for="agent in agentsStore.agents"
                    :key="agent.id"
                    class="cv-agent-chip"
                    :class="{ selected: selectedAgentId === agent.id }">
                    <input
                      v-model="selectedAgentId"
                      type="radio"
                      name="cronAgent"
                      :value="agent.id"
                      class="cv-radio-hidden" />
                    <span class="i-carbon-bot inline-block h-3 w-3" />
                    <span>{{ agent.name }}</span>
                  </label>
                </div>
              </div>

              <!-- 相关资料 -->
              <div v-if="parsedResult" class="cv-section">
                <h4 class="cv-section-title">
                  <span class="i-carbon-folder-add inline-block h-3 w-3" />
                  相关资料
                  <span class="cv-section-optional">可选</span>
                </h4>
                <div v-if="taskAttachments.length > 0" class="cv-attachment-list">
                  <div v-for="(att, idx) in taskAttachments" :key="att.path" class="cv-attachment-item">
                    <span class="i-carbon-document inline-block h-3 w-3 shrink-0 opacity-50" />
                    <span class="cv-attachment-path" :title="att.path">{{ att.name }}</span>
                    <button class="cv-attachment-remove" @click="removeAttachment(idx)">
                      <span class="i-carbon-close inline-block h-3 w-3" />
                    </button>
                  </div>
                </div>
                <button class="cv-add-file-btn" @click="handleAddAttachment">
                  <span class="i-carbon-add inline-block h-3 w-3" />
                  添加文件或目录
                </button>
              </div>
            </div>

            <div class="cv-dialog-footer">
              <button class="cv-text-btn" @click="closeCreateDialog">取消</button>
              <button
                class="cv-primary-btn"
                :disabled="!parsedResult || !selectedAgentId || creating"
                @click="createCronJob">
                <span v-if="creating" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
                <span v-else class="i-carbon-add inline-block h-3.5 w-3.5" />
                创建任务
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.cron-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

/* ====== Header ====== */
.cv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.cv-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cv-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.cv-header-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.cv-header-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground));
}

.cv-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.cv-icon-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.cv-create-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.cv-create-btn:hover {
  background: hsl(var(--primary) / 0.14);
}

/* ====== Content ====== */
.cv-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.cv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 10vh;
  text-align: center;
}

.cv-empty-text {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.cv-empty-visual {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 24px;
}

.cv-empty-circle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.35);
}

.cv-empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 6px;
}

.cv-empty-sub {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.55);
  line-height: 1.6;
  max-width: 260px;
}

/* ====== Job Grid ====== */
.cv-job-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.cv-job-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.6);
  transition: all 0.2s ease;
}

.cv-job-card:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
  box-shadow: 0 2px 8px hsl(var(--shadow) / 0.06);
}

.cv-job-header {
  margin-bottom: 10px;
}

.cv-job-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.cv-job-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  line-height: 1.3;
}

.cv-status-badge {
  padding: 1px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.6;
  flex-shrink: 0;
}

.cv-status-badge.status-active {
  background: hsl(142 72% 50% / 0.1);
  color: hsl(142 72% 40%);
}

.cv-status-badge.status-paused {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground) / 0.6);
}

.cv-status-badge.status-error {
  background: hsl(0 72% 50% / 0.1);
  color: hsl(0 72% 45%);
}

.cv-job-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cv-job-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.cv-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: hsl(var(--foreground) / 0.6);
}

.cv-meta-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-meta-fail {
  font-size: 10px;
  color: hsl(0 72% 45%);
  font-weight: 500;
}

.cv-job-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
}

.cv-job-footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.12s ease;
}

.cv-action-btn.cv-warn {
  color: hsl(40 80% 45%);
}

.cv-action-btn.cv-warn:hover {
  background: hsl(40 80% 50% / 0.08);
}

.cv-action-btn.cv-success {
  color: hsl(142 72% 40%);
}

.cv-action-btn.cv-success:hover {
  background: hsl(142 72% 50% / 0.08);
}

.cv-action-btn.cv-danger {
  color: hsl(var(--muted-foreground) / 0.4);
}

.cv-action-btn.cv-danger:hover {
  color: hsl(0 72% 50%);
  background: hsl(0 72% 50% / 0.08);
}

/* ====== Dialog ====== */
.cv-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(0 0% 0% / 0.35);
  backdrop-filter: blur(4px);
  z-index: 1000;
}

.cv-dialog {
  width: 500px;
  max-height: 85vh;
  border-radius: 14px;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  box-shadow: 0 8px 32px hsl(var(--shadow) / 0.15);
  display: flex;
  flex-direction: column;
}

.cv-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border) / 0.25);
}

.cv-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cv-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid hsl(var(--border) / 0.25);
}

/* ====== Input Card ====== */
.cv-input-card {
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  background: hsl(var(--surface));
  overflow: hidden;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px hsl(var(--shadow) / 0.04);
}

.cv-input-card:focus-within {
  border-color: hsl(var(--primary) / 0.3);
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.06);
}

.cv-input-card.focused {
  border-color: hsl(var(--primary) / 0.25);
}

.cv-input-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 0;
}

.cv-ai-icon {
  color: hsl(var(--primary));
}

.cv-input-card-label {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--primary));
  letter-spacing: 0.02em;
}

.cv-input-textarea {
  width: 100%;
  padding: 8px 14px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  background: transparent;
  border: none;
  outline: none;
  resize: none;
}

.cv-input-textarea::placeholder {
  color: hsl(var(--muted-foreground) / 0.3);
}

.cv-input-textarea:disabled {
  opacity: 0.5;
}

.cv-input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
  background: hsl(var(--background) / 0.4);
}

.cv-input-tip {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.cv-input-tip kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
  font-family: var(--font-family-mono);
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.5);
  border: 1px solid hsl(var(--border) / 0.3);
}

.cv-generate-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.cv-generate-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.cv-generate-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ====== Parse Result ====== */
.cv-parse-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--error));
  background: hsl(var(--error) / 0.06);
  border: 1px solid hsl(var(--error) / 0.1);
}

.cv-parsed-result {
  border: 1px solid hsl(142 72% 50% / 0.2);
  border-radius: 10px;
  background: hsl(142 72% 50% / 0.03);
  overflow: hidden;
}

.cv-parsed-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: hsl(142 72% 40%);
  border-bottom: 1px solid hsl(142 72% 50% / 0.1);
}

.cv-parsed-icon {
  color: hsl(142 72% 45%);
}

.cv-parsed-fields {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cv-parsed-field {
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 1.5;
}

.cv-parsed-label {
  width: 36px;
  flex-shrink: 0;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
}

.cv-parsed-value {
  flex: 1;
  color: hsl(var(--foreground) / 0.8);
  min-width: 0;
}

.cv-parsed-value code {
  font-family: var(--font-family-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--primary));
}

.cv-cron-hint {
  margin-left: 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.cv-parsed-task {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ====== Section ====== */
.cv-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cv-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.6);
}

.cv-section-optional {
  font-size: 10px;
  font-weight: 400;
  color: hsl(var(--muted-foreground) / 0.4);
}

/* ====== Text Input ====== */
.cv-text-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  background: hsl(var(--surface) / 0.5);
  transition: all 0.15s ease;
  resize: vertical;
}

.cv-text-input:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.3);
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.06);
  background: hsl(var(--surface));
}

.cv-text-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.3);
}

.cv-hint {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
  margin-top: 4px;
}

/* ====== Agent Chips ====== */
.cv-agent-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cv-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.5);
  color: hsl(var(--muted-foreground) / 0.7);
}

.cv-agent-chip:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
}

.cv-agent-chip.selected {
  background: hsl(var(--primary) / 0.08);
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--primary));
}

.cv-radio-hidden {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

/* ====== Attachments ====== */
.cv-attachment-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cv-attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: hsl(var(--foreground) / 0.03);
  font-size: 11.5px;
}

.cv-attachment-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: hsl(var(--foreground) / 0.7);
}

.cv-attachment-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: hsl(var(--muted-foreground) / 0.4);
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.cv-attachment-remove:hover {
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error));
}

.cv-add-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  border: 1px dashed hsl(var(--border) / 0.4);
  transition: all 0.15s ease;
  align-self: flex-start;
}

.cv-add-file-btn:hover {
  background: hsl(var(--foreground) / 0.03);
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--primary));
}

/* ====== Buttons ====== */
.cv-text-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.12s ease;
}

.cv-text-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.7);
}

.cv-primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.cv-primary-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.cv-primary-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ====== Transitions ====== */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>
