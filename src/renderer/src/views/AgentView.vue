<script setup lang="ts">
/**
 * AgentView — 智能体主视图
 *
 * 两种状态：
 *   1. 未开始会话 → 显示智能体列表 + AI 创建入口（含实时进度）
 *   2. 会话进行中 → 三栏工作区（项目空间 | 工作台 | 对话）
 */

import { ref, computed, onMounted, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import configManager from '@/config';

const isMac = navigator.platform?.includes('Mac') ?? false;
import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import VoicePanel from '@/components/agent/VoicePanel.vue';
import AgentsPanel from '@/components/agent/AgentsPanel.vue';

const chatStore = useChatStore();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const agentsPanelCollapsed = ref(true);

/** 是否已进入工作区 */
const isInWorkspace = ref(false);

/** 是否处于工作状态 */
const isActive = computed(() => isInWorkspace.value || chatStore.sessionId !== null);

/** AI 创建：用户需求输入 */
const aiRequirement = ref('');
const aiInputRef = ref<HTMLTextAreaElement | null>(null);

/** 是否显示创建区域 */
const showCreateArea = ref(false);

/** 技能编辑：当前编辑的 Agent ID */
const editSkillsAgentId = ref<string | null>(null);
const editSkillsList = ref<string[]>([]);

/** 可用技能列表（从后端获取） */
interface SkillInfo {
  name: string;
  description: string;
}
const availableSkills = ref<SkillInfo[]>([]);
const skillsLoading = ref(false);

onMounted(() => {
  agentsStore.fetchAgents();
});

function startNewSession(): void {
  chatStore.clearMessages();
  isInWorkspace.value = false;
  agentsPanelCollapsed.value = true;
}

function toggleCreateArea(): void {
  showCreateArea.value = !showCreateArea.value;
  if (showCreateArea.value) {
    aiRequirement.value = '';
    agentsStore.resetAiCreateState();
    nextTick(() => aiInputRef.value?.focus());
  }
}

async function handleAiCreate(): Promise<void> {
  const req = aiRequirement.value.trim();
  if (!req || agentsStore.aiCreating) return;
  const ok = await agentsStore.aiCreateAgent(req);
  if (ok) {
    showCreateArea.value = false;
    aiRequirement.value = '';
  }
}

const confirmDeleteId = ref<string | null>(null);

function handleSelect(agentId: string): void {
  agentsStore.selectAgent(agentsStore.selectedAgentId === agentId ? null : agentId);
}

/** 开启任务：选择智能体 → 创建 Thread → 进入工作区 */
async function handleStartTask(agentId: string): Promise<void> {
  agentsStore.selectAgent(agentId);
  const agent = agentsStore.agents.find((a) => a.id === agentId);
  const title = agent ? `${agent.name} 的任务` : '新任务';
  const thread = await threadsStore.createThread(title, agentId);
  if (thread) {
    isInWorkspace.value = true;
  }
}

async function handleDelete(agentId: string): Promise<void> {
  if (confirmDeleteId.value !== agentId) {
    confirmDeleteId.value = agentId;
    return;
  }
  confirmDeleteId.value = null;
  await agentsStore.deleteAgent(agentId);
}

/** 打开技能编辑面板 */
async function openSkillsEditor(agentId: string): Promise<void> {
  const agent = agentsStore.agents.find((a) => a.id === agentId);
  if (!agent) return;
  editSkillsAgentId.value = agentId;
  editSkillsList.value = [...(agent.skills ?? [])];

  // 从后端获取可用技能列表
  if (availableSkills.value.length === 0) {
    skillsLoading.value = true;
    try {
      const url = `${configManager.getBaseUrl()}/gateway/skills`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as { skills: SkillInfo[] };
        availableSkills.value = data.skills;
      }
    } catch (err) {
      console.warn('[AgentView] Failed to fetch skills:', err);
    } finally {
      skillsLoading.value = false;
    }
  }
}

/** 切换技能勾选 */
function toggleSkill(skillName: string): void {
  const idx = editSkillsList.value.indexOf(skillName);
  if (idx >= 0) {
    editSkillsList.value.splice(idx, 1);
  } else {
    editSkillsList.value.push(skillName);
  }
}

/** 保存技能 */
async function saveSkills(): Promise<void> {
  if (!editSkillsAgentId.value) return;
  await agentsStore.updateAgent(editSkillsAgentId.value, {
    skills: editSkillsList.value
  });
  editSkillsAgentId.value = null;
}

/** 取消技能编辑 */
function cancelSkillsEdit(): void {
  editSkillsAgentId.value = null;
}

/** 步骤图标映射 */
function stepIcon(step: string): string {
  switch (step) {
    case 'analyzing':
      return 'i-carbon-analytics';
    case 'generating':
      return 'i-carbon-watson';
    case 'validating':
      return 'i-carbon-checkmark-outline';
    case 'saving':
      return 'i-carbon-save';
    case 'done':
      return 'i-carbon-checkmark-filled';
    case 'error':
      return 'i-carbon-warning-alt';
    default:
      return 'i-carbon-circle-dash';
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)} 天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
</script>

<template>
  <div class="agent-view">
    <!-- ========== 状态 1：智能体列表 ========== -->
    <div v-if="!isActive" class="landing">
      <!-- 顶栏 -->
      <header class="header">
        <div class="header-left">
          <div class="header-icon">
            <span class="i-carbon-bot inline-block h-4 w-4" />
          </div>
          <h1 class="header-title">智能体</h1>
          <span v-if="agentsStore.agentCount > 0" class="header-count">
            {{ agentsStore.agentCount }}
          </span>
        </div>
        <div class="header-right">
          <button class="icon-btn" title="刷新" @click="agentsStore.fetchAgents()">
            <span
              class="i-carbon-renew inline-block h-[15px] w-[15px]"
              :class="{ 'animate-spin': agentsStore.loading }" />
          </button>
          <button class="create-btn" :class="{ active: showCreateArea }" @click="toggleCreateArea">
            <span class="i-carbon-add inline-block h-3.5 w-3.5" />
            <span>新建</span>
          </button>
        </div>
      </header>

      <!-- AI 创建区域 -->
      <Transition name="slide-down">
        <div v-if="showCreateArea" class="create-section">
          <div class="create-card" :class="{ focused: agentsStore.aiCreating }">
            <div class="create-card-header">
              <span class="i-carbon-watson inline-block h-4 w-4 create-ai-icon" />
              <span class="create-card-label">AI 自动创建</span>
            </div>
            <textarea
              ref="aiInputRef"
              v-model="aiRequirement"
              placeholder="描述你想要的智能体...&#10;例如：一个专业的代码审查助手，能检查代码质量和安全性"
              rows="2"
              class="create-input"
              :disabled="agentsStore.aiCreating"
              @keydown.meta.enter="handleAiCreate"
              @keydown.ctrl.enter="handleAiCreate" />

            <!-- AI 创建进度 -->
            <div v-if="agentsStore.aiCreateSteps.length > 0" class="create-progress">
              <div
                v-for="(progress, idx) in agentsStore.aiCreateSteps"
                :key="idx"
                class="progress-step"
                :class="{
                  active: agentsStore.aiCreateCurrentStep === progress.step,
                  done: progress.step === 'done',
                  error: progress.step === 'error'
                }">
                <span :class="stepIcon(progress.step)" class="inline-block h-3.5 w-3.5 shrink-0 progress-icon" />
                <div class="progress-text">
                  <span class="progress-msg">{{ progress.message }}</span>
                  <span v-if="progress.detail" class="progress-detail">{{ progress.detail }}</span>
                </div>
              </div>
            </div>

            <div class="create-card-footer">
              <div class="create-footer-left">
                <span v-if="agentsStore.aiCreateError" class="create-error">
                  <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                  {{ agentsStore.aiCreateError }}
                </span>
                <span v-else-if="!agentsStore.aiCreating" class="create-tip">
                  <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd>
                  <kbd>↵</kbd>
                  发送
                </span>
                <span v-else class="create-tip">
                  <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
                  处理中...
                </span>
              </div>
              <div class="flex items-center gap-2">
                <button class="text-btn" :disabled="agentsStore.aiCreating" @click="showCreateArea = false">
                  取消
                </button>
                <button
                  class="submit-btn"
                  :disabled="!aiRequirement.trim() || agentsStore.aiCreating"
                  @click="handleAiCreate">
                  <span v-if="agentsStore.aiCreating" class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
                  <span v-else class="i-carbon-send-filled inline-block h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 内容区域 -->
      <div class="content">
        <!-- 错误 -->
        <div v-if="agentsStore.error" class="error-bar">
          <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0" />
          <span class="flex-1 truncate">{{ agentsStore.error }}</span>
          <button class="error-retry" @click="agentsStore.fetchAgents()">重试</button>
        </div>

        <!-- 加载中 -->
        <div v-if="agentsStore.loading && agentsStore.agents.length === 0" class="empty-state">
          <div class="empty-spinner">
            <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
          </div>
          <p class="empty-label">加载中...</p>
        </div>

        <!-- 空状态 -->
        <div v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading" class="empty-state">
          <div class="empty-visual">
            <div class="empty-circle">
              <span class="i-carbon-bot inline-block h-7 w-7" />
            </div>
            <div class="empty-orbit" />
          </div>
          <p class="empty-heading">创建你的第一个智能体</p>
          <p class="empty-sub"> 描述你的需求，AI 将自动生成专业的智能体配置 </p>
          <button class="primary-btn mt-5" @click="toggleCreateArea">
            <span class="i-carbon-watson inline-block h-3.5 w-3.5" />
            开始创建
          </button>
        </div>

        <!-- 智能体列表 -->
        <div v-else class="agent-grid">
          <div
            v-for="agent in agentsStore.agents"
            :key="agent.id"
            class="agent-card"
            :class="{ selected: agentsStore.selectedAgentId === agent.id }"
            @click="handleSelect(agent.id)">
            <!-- 卡片头部：头像 + 名称 + 时间 -->
            <div class="card-header">
              <div class="card-avatar" :class="{ selected: agentsStore.selectedAgentId === agent.id }">
                <span class="i-carbon-bot inline-block h-5 w-5" />
              </div>
              <div class="card-title-area">
                <div class="flex items-center gap-1.5">
                  <span class="card-name">{{ agent.name }}</span>
                  <span v-if="agent.createdBy === 'system'" class="builtin-badge">内置</span>
                </div>
                <span class="card-time">{{ formatTime(agent.updatedAt) }}</span>
              </div>
            </div>

            <!-- 描述 -->
            <p class="card-desc">{{ agent.description }}</p>

            <!-- 技能标签 -->
            <div v-if="agent.skills && agent.skills.length > 0" class="card-skills">
              <span v-for="skill in agent.skills.slice(0, 3)" :key="skill" class="skill-tag">
                {{ skill }}
              </span>
              <span v-if="agent.skills.length > 3" class="skill-more"> +{{ agent.skills.length - 3 }} </span>
            </div>

            <!-- 底部操作栏 -->
            <div class="card-footer" @click.stop>
              <button class="start-task-btn" @click="handleStartTask(agent.id)">
                <span class="i-carbon-play-filled-alt inline-block h-3 w-3" />
                <span>开启任务</span>
              </button>
              <div class="card-actions">
                <template v-if="confirmDeleteId !== agent.id">
                  <button class="action-icon" title="编辑技能" @click="openSkillsEditor(agent.id)">
                    <span class="i-carbon-edit inline-block h-3.5 w-3.5" />
                  </button>
                  <button
                    v-if="agent.createdBy !== 'system'"
                    class="action-icon danger"
                    title="删除"
                    @click="handleDelete(agent.id)">
                    <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
                  </button>
                </template>
                <template v-else>
                  <button class="confirm-btn danger" @click="handleDelete(agent.id)">删除</button>
                  <button class="confirm-btn" @click="confirmDeleteId = null">取消</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 状态 2：三栏工作区 ========== -->
    <template v-else>
      <div class="workspace-bar">
        <div class="flex items-center gap-2">
          <span v-if="agentsStore.selectedAgent" class="workspace-agent">
            {{ agentsStore.selectedAgent.name }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button class="text-btn text-[10px]" @click="agentsPanelCollapsed = !agentsPanelCollapsed"> 智能体 </button>
          <button class="text-btn text-[10px]" @click="startNewSession">返回列表</button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        <ProjectPanel v-model:collapsed="leftCollapsed" />
        <WorkbenchPanel />
        <ChatPanel v-model:collapsed="rightCollapsed" />
        <AgentsPanel v-model:collapsed="agentsPanelCollapsed" />
      </div>

      <VoicePanel />
    </template>

    <!-- 技能编辑弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="editSkillsAgentId" class="skills-overlay" @click.self="cancelSkillsEdit">
          <div class="skills-dialog">
            <div class="skills-dialog-header">
              <span class="i-carbon-skill-level-advanced inline-block h-4 w-4" />
              <span>编辑技能</span>
            </div>
            <div class="skills-dialog-body">
              <!-- 加载中 -->
              <div v-if="skillsLoading" class="skills-loading">
                <span class="i-carbon-renew inline-block h-4 w-4 animate-spin" />
                <span>加载技能列表...</span>
              </div>
              <!-- 空态 -->
              <p v-else-if="availableSkills.length === 0" class="skills-empty"> 暂无可用技能 </p>
              <!-- 技能列表 -->
              <label
                v-for="skill in availableSkills"
                v-else
                :key="skill.name"
                class="skill-checkbox"
                :class="{ checked: editSkillsList.includes(skill.name) }">
                <input
                  type="checkbox"
                  :checked="editSkillsList.includes(skill.name)"
                  @change="toggleSkill(skill.name)" />
                <div class="skill-label">
                  <span class="skill-label-name">{{ skill.name }}</span>
                  <span v-if="skill.description" class="skill-label-desc">{{ skill.description }}</span>
                </div>
              </label>
            </div>
            <div class="skills-dialog-footer">
              <button class="text-btn" @click="cancelSkillsEdit">取消</button>
              <button class="primary-btn" @click="saveSkills">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ====== 根容器 ====== */

.agent-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.landing {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

/* ====== 顶栏 ====== */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.header-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground));
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.create-btn {
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

.create-btn:hover {
  background: hsl(var(--primary) / 0.14);
}

.create-btn.active {
  background: hsl(var(--primary) / 0.15);
  box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.2);
}

/* ====== AI 创建区域 ====== */

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 200px;
}

.create-section {
  padding: 14px 20px;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
  background: hsl(var(--surface) / 0.3);
}

.create-card {
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  background: hsl(var(--surface));
  overflow: hidden;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px hsl(var(--shadow) / 0.04);
}

.create-card:focus-within {
  border-color: hsl(var(--primary) / 0.3);
  box-shadow:
    0 0 0 3px hsl(var(--primary) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
}

.create-card.focused {
  border-color: hsl(var(--primary) / 0.25);
}

.create-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 0;
}

.create-ai-icon {
  color: hsl(var(--primary));
}

.create-card-label {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--primary));
  letter-spacing: 0.02em;
}

.create-input {
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

.create-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.35);
}

.create-input:disabled {
  opacity: 0.5;
}

.create-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
  background: hsl(var(--background) / 0.4);
}

.create-footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.create-tip {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.create-tip kbd {
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

.create-error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--error));
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border-radius: 7px;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.submit-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.submit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ====== AI 创建进度 ====== */

.create-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 14px 8px;
  border-top: 1px solid hsl(var(--border) / 0.1);
}

.progress-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: color 0.2s ease;
}

.progress-step.active {
  color: hsl(var(--primary));
}

.progress-step.done {
  color: hsl(var(--success));
}

.progress-step.error {
  color: hsl(var(--error));
}

.progress-icon {
  margin-top: 1px;
}

.progress-step.active .progress-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.progress-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.progress-msg {
  font-weight: 500;
  line-height: 1.3;
}

.progress-detail {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
  line-height: 1.3;
}

/* ====== 内容区 ====== */

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* ====== 错误横幅 ====== */

.error-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--error));
  background: hsl(var(--error) / 0.06);
  border: 1px solid hsl(var(--error) / 0.1);
}

.error-retry {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--error));
  text-decoration: underline;
  text-underline-offset: 2px;
  flex-shrink: 0;
}

.error-retry:hover {
  opacity: 0.8;
}

/* ====== 空状态 ====== */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 10vh;
  text-align: center;
}

.empty-spinner {
  color: hsl(var(--muted-foreground) / 0.25);
  margin-bottom: 12px;
}

.empty-label {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.empty-visual {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 24px;
}

.empty-circle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.35);
  z-index: 1;
}

.empty-orbit {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 1.5px dashed hsl(var(--primary) / 0.12);
  animation: orbit-spin 20s linear infinite;
}

@keyframes orbit-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.55);
  line-height: 1.6;
  max-width: 260px;
}

/* ====== 智能体卡片网格 ====== */

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.agent-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.6);
  cursor: pointer;
  transition: all 0.2s ease;
}

.agent-card:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
  box-shadow:
    0 2px 8px hsl(var(--shadow) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
  transform: translateY(-1px);
}

.agent-card.selected {
  background: hsl(var(--primary) / 0.03);
  border-color: hsl(var(--primary) / 0.2);
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.05);
}

/* 卡片头部 */

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.card-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.15));
  color: hsl(var(--primary) / 0.6);
  transition: all 0.2s ease;
}

.agent-card:hover .card-avatar {
  color: hsl(var(--primary) / 0.8);
  background: linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.2));
}

.card-avatar.selected {
  background: linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--primary) / 0.25));
  color: hsl(var(--primary));
}

.card-title-area {
  flex: 1;
  min-width: 0;
}

.card-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.card-time {
  display: block;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
  margin-top: 2px;
}

.builtin-badge {
  display: inline-flex;
  align-items: center;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary) / 0.7);
  letter-spacing: 0.03em;
  line-height: 1.4;
  flex-shrink: 0;
}

/* 描述 */

.card-desc {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 10px;
}

/* 技能标签 */

.card-skills {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.skill-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.65);
  font-weight: 500;
  white-space: nowrap;
}

.skill-more {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.4);
}

/* 卡片底部操作栏 */

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
}

.start-task-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.start-task-btn:hover {
  background: hsl(var(--primary) / 0.14);
  box-shadow: 0 1px 4px hsl(var(--primary) / 0.1);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .card-actions {
  opacity: 1;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.4);
  transition: all 0.12s ease;
}

.action-icon:hover {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

.action-icon.danger:hover {
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error));
}

.confirm-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  transition: all 0.12s ease;
}

.confirm-btn:hover {
  background: hsl(var(--foreground) / 0.05);
}

.confirm-btn.danger {
  color: hsl(var(--error));
}

.confirm-btn.danger:hover {
  background: hsl(var(--error) / 0.08);
}

/* ====== 通用按钮 ====== */

.text-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.12s ease;
}

.text-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.7);
}

.primary-btn {
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

.primary-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.primary-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ====== 工作区顶栏 ====== */

.workspace-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.25);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(8px);
}

.workspace-agent {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

/* ====== 技能编辑弹窗 ====== */

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.skills-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(0 0% 0% / 0.35);
  backdrop-filter: blur(4px);
  z-index: 1000;
}

.skills-dialog {
  width: 380px;
  max-height: 480px;
  border-radius: 14px;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  box-shadow:
    0 8px 32px hsl(var(--shadow) / 0.15),
    0 2px 8px hsl(var(--shadow) / 0.08);
  display: flex;
  flex-direction: column;
}

.skills-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border) / 0.25);
}

.skills-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skills-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.skills-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.skill-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--foreground) / 0.8);
  cursor: pointer;
  transition: all 0.12s ease;
  border: 1px solid transparent;
}

.skill-checkbox:hover {
  background: hsl(var(--foreground) / 0.03);
}

.skill-checkbox.checked {
  background: hsl(var(--primary) / 0.04);
  border-color: hsl(var(--primary) / 0.12);
}

.skill-checkbox input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  accent-color: hsl(var(--primary));
  cursor: pointer;
  flex-shrink: 0;
}

.skill-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skill-label-name {
  font-weight: 500;
  color: hsl(var(--foreground) / 0.85);
  line-height: 1.3;
}

.skill-label-desc {
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skills-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid hsl(var(--border) / 0.25);
}
</style>
