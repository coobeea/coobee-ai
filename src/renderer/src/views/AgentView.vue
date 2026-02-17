<script setup lang="ts">
/**
 * AgentView — 智能体主视图
 *
 * 两种状态：
 *   1. 未开始会话 → 显示智能体列表，选择后开始对话
 *   2. 会话进行中 → 三栏工作区（项目空间 | 工作台 | 对话）
 */

import { ref, computed, onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import VoicePanel from '@/components/agent/VoicePanel.vue';
import AgentsPanel from '@/components/agent/AgentsPanel.vue';

const chatStore = useChatStore();
const agentsStore = useAgentsStore();

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const agentsPanelCollapsed = ref(true);

/** 是否已进入工作区 */
const isInWorkspace = ref(false);

/** 选中的工作目录 */
const selectedDir = ref<string | null>(null);

/** 是否处于工作状态 */
const isActive = computed(() => isInWorkspace.value || chatStore.sessionId !== null);

/** 是否显示创建表单 */
const showCreateForm = ref(false);
const newAgent = ref({ id: '', name: '', description: '', instructions: '' });

onMounted(() => {
  agentsStore.fetchAgents();
});

async function selectDirectory(): Promise<void> {
  try {
    const result = await window.electron?.ipcRenderer.invoke('dialog:openDirectory');
    if (result) {
      selectedDir.value = result;
    }
  } catch (err) {
    console.warn('[AgentView] 选择目录失败:', err);
  }
}

function startSession(): void {
  isInWorkspace.value = true;
}

function startNewSession(): void {
  chatStore.clearMessages();
  isInWorkspace.value = false;
  selectedDir.value = null;
  agentsPanelCollapsed.value = true;
}

function toggleCreateForm(): void {
  showCreateForm.value = !showCreateForm.value;
  if (showCreateForm.value) {
    newAgent.value = { id: '', name: '', description: '', instructions: '' };
  }
}

async function handleCreate(): Promise<void> {
  const a = newAgent.value;
  if (!a.id.trim() || !a.name.trim() || !a.instructions.trim()) return;
  const ok = await agentsStore.createAgent({
    id: a.id.trim(),
    name: a.name.trim(),
    description: a.description.trim() || a.name.trim(),
    instructions: a.instructions.trim()
  });
  if (ok) {
    showCreateForm.value = false;
  }
}

const confirmDeleteId = ref<string | null>(null);

function handleSelect(agentId: string): void {
  agentsStore.selectAgent(agentsStore.selectedAgentId === agentId ? null : agentId);
}

async function handleDelete(agentId: string): Promise<void> {
  if (confirmDeleteId.value !== agentId) {
    confirmDeleteId.value = agentId;
    return;
  }
  confirmDeleteId.value = null;
  await agentsStore.deleteAgent(agentId);
}
</script>

<template>
  <div class="flex h-full w-full flex-col" style="background: hsl(var(--background))">
    <!-- ========== 状态 1：智能体列表 ========== -->
    <div v-if="!isActive" class="flex flex-1 overflow-hidden">
      <!-- 主内容：智能体列表 -->
      <div class="flex flex-1 flex-col">
        <!-- 顶栏 -->
        <div class="top-bar">
          <h1 class="title">智能体</h1>
          <div class="flex items-center gap-2">
            <button
              class="btn-ghost"
              :class="{ '!text-primary !bg-primary/10': showCreateForm }"
              @click="toggleCreateForm">
              <span class="i-carbon-add inline-block h-3.5 w-3.5" />
              <span>创建</span>
            </button>
            <button class="btn-ghost" @click="agentsStore.fetchAgents()">
              <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': agentsStore.loading }" />
            </button>
          </div>
        </div>

        <!-- 创建表单 -->
        <div v-if="showCreateForm" class="create-form">
          <div class="grid grid-cols-2 gap-2">
            <input v-model="newAgent.id" placeholder="ID（如 code-reviewer）" class="form-input" />
            <input v-model="newAgent.name" placeholder="名称" class="form-input" />
          </div>
          <input v-model="newAgent.description" placeholder="一句话描述（可选）" class="form-input" />
          <textarea
            v-model="newAgent.instructions"
            placeholder="系统指令：定义角色、行为规范、输出格式..."
            rows="3"
            class="form-input resize-none"></textarea>
          <div class="flex justify-end gap-2">
            <button class="btn-ghost" @click="showCreateForm = false">取消</button>
            <button
              class="btn-primary"
              :disabled="!newAgent.id.trim() || !newAgent.name.trim() || !newAgent.instructions.trim()"
              @click="handleCreate">
              创建智能体
            </button>
          </div>
        </div>

        <!-- 列表区域 -->
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <!-- 错误 -->
          <div v-if="agentsStore.error" class="error-banner">
            <span class="i-carbon-warning-alt inline-block h-4 w-4 shrink-0" />
            <span>{{ agentsStore.error }}</span>
            <button class="ml-auto text-xs underline" @click="agentsStore.fetchAgents()"> 重试 </button>
          </div>

          <!-- 加载中 -->
          <div v-if="agentsStore.loading && agentsStore.agents.length === 0" class="empty-center">
            <span class="i-carbon-renew inline-block h-6 w-6 animate-spin opacity-20" />
            <p>加载中...</p>
          </div>

          <!-- 空状态 -->
          <div v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading" class="empty-center">
            <div class="empty-icon">
              <span class="i-carbon-bot inline-block h-8 w-8 opacity-30" />
            </div>
            <p class="empty-title">还没有智能体</p>
            <p class="empty-desc"> 点击上方「创建」手动添加，或在对话中让 AI 自动生成 </p>
            <button class="btn-primary mt-4" @click="toggleCreateForm">
              <span class="i-carbon-add inline-block h-3.5 w-3.5" />
              创建第一个智能体
            </button>
          </div>

          <!-- 智能体网格 -->
          <div v-else class="agent-grid">
            <div
              v-for="agent in agentsStore.agents"
              :key="agent.id"
              class="agent-card"
              :class="{ selected: agentsStore.selectedAgentId === agent.id }"
              @click="handleSelect(agent.id)">
              <!-- 图标 -->
              <div class="card-icon" :class="{ selected: agentsStore.selectedAgentId === agent.id }">
                <span class="i-carbon-bot inline-block h-5 w-5" />
              </div>

              <!-- 信息 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="card-name">{{ agent.name }}</span>
                  <span class="card-version">v{{ agent.version }}</span>
                  <span class="card-badge" :class="agent.createdBy === 'agent' ? 'ai' : 'user'">
                    {{ agent.createdBy === 'agent' ? 'AI' : '手动' }}
                  </span>
                </div>
                <p class="card-desc" :title="agent.description">{{ agent.description }}</p>
              </div>

              <!-- 操作 -->
              <div class="card-actions">
                <template v-if="confirmDeleteId !== agent.id">
                  <button class="action-btn delete" title="删除" @click.stop="handleDelete(agent.id)">
                    <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
                  </button>
                </template>
                <template v-else>
                  <button class="action-btn confirm" @click.stop="handleDelete(agent.id)"> 确认 </button>
                  <button class="action-btn" @click.stop="confirmDeleteId = null">取消</button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="bottom-bar">
          <!-- 工作目录 -->
          <div class="flex items-center gap-2 text-xs" style="color: hsl(var(--muted-foreground))">
            <span class="i-carbon-folder inline-block h-3.5 w-3.5" />
            <span v-if="selectedDir" class="max-w-[240px] truncate font-mono text-[11px]">
              {{ selectedDir }}
            </span>
            <span v-else class="text-[11px]">未选择工作目录</span>
            <button class="btn-ghost text-[11px]" @click="selectDirectory">
              {{ selectedDir ? '更换' : '选择目录' }}
            </button>
          </div>

          <div class="flex items-center gap-3">
            <span
              v-if="agentsStore.selectedAgent"
              class="flex items-center gap-1 text-xs"
              style="color: hsl(var(--primary))">
              <span class="i-carbon-checkmark-filled inline-block h-3 w-3" />
              {{ agentsStore.selectedAgent.name }}
            </span>
            <button class="btn-primary" :disabled="!selectedDir" @click="startSession">
              <span class="i-carbon-play-filled inline-block h-3.5 w-3.5" />
              开始会话
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 状态 2：三栏工作区 ========== -->
    <template v-else>
      <div class="top-bar compact">
        <div class="flex items-center gap-2">
          <span
            v-if="selectedDir"
            class="max-w-[200px] truncate font-mono text-[10px]"
            style="color: hsl(var(--muted-foreground))">
            {{ selectedDir }}
          </span>
          <span
            v-if="agentsStore.selectedAgent"
            class="rounded px-1.5 py-px text-[10px]"
            style="background: hsl(var(--primary) / 0.1); color: hsl(var(--primary))">
            {{ agentsStore.selectedAgent.name }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button class="btn-ghost text-[10px]" @click="agentsPanelCollapsed = !agentsPanelCollapsed"> 智能体 </button>
          <button class="btn-ghost text-[10px]" @click="startNewSession">返回列表</button>
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
  </div>
</template>

<style scoped>
/* ====== 顶栏 ====== */

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 24px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface));
}

.top-bar.compact {
  height: 28px;
  padding: 0 12px;
  background: hsl(var(--surface) / 0.8);
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

/* ====== 底部操作栏 ====== */

.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 24px;
  flex-shrink: 0;
  border-top: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface));
}

/* ====== 按钮 ====== */

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.btn-ghost:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground) / 0.8);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
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

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ====== 创建表单 ====== */

.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 24px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface));
}

.form-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  outline: none;
  transition: border-color 0.15s ease;
}

.form-input:focus {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--surface));
}

.form-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.5);
}

/* ====== 错误提示 ====== */

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--error));
  background: hsl(var(--error) / 0.08);
}

/* ====== 空态 ====== */

.empty-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 80px;
  text-align: center;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: hsl(var(--foreground) / 0.04);
  margin-bottom: 16px;
}

.empty-title {
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.6);
  margin-bottom: 4px;
}

.empty-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1.6;
  max-width: 280px;
}

/* ====== 智能体网格 ====== */

.agent-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: hsl(var(--surface));
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-card:hover {
  border-color: hsl(var(--border));
  box-shadow: 0 1px 3px hsl(var(--shadow) / 0.06);
}

.agent-card.selected {
  border-color: hsl(var(--primary) / 0.3);
  background: hsl(var(--primary) / 0.04);
}

/* 卡片图标 */

.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.card-icon.selected {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

/* 卡片信息 */

.card-name {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.card-version {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.card-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
}

.card-badge.ai {
  background: hsl(217 91% 60% / 0.1);
  color: hsl(217 91% 60%);
}

.card-badge.user {
  background: hsl(142 76% 36% / 0.1);
  color: hsl(142 76% 36%);
}

.card-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.7);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 卡片操作 */

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .card-actions {
  opacity: 1;
}

.action-btn {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: hsl(var(--foreground) / 0.06);
}

.action-btn.delete:hover {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.action-btn.confirm {
  color: hsl(var(--error));
}

.action-btn.confirm:hover {
  background: hsl(var(--error) / 0.1);
}
</style>
