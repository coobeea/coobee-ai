<script setup lang="ts">
/**
 * AgentView — 智能体管理列表
 *
 * 纯粹的智能体 CRUD 界面：列表展示、AI 创建、技能编辑、删除。
 * 点击智能体卡片 → 创建 Thread → 跳转 /thread/:id。
 */

import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore, type AgentType } from '@/stores/threads';
import { useChatStore } from '@/stores/chat';
import { gateway } from '@/plugins/gatewaySetup';
import configManager from '@/config';

const isMac = navigator.platform?.includes('Mac') ?? false;

const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

/** AI 创建：用户需求输入 */
const aiRequirement = ref('');
const aiInputRef = ref<HTMLTextAreaElement | null>(null);

/** 是否显示创建区域 */
const showCreateArea = ref(false);

/** 编辑弹窗：当前编辑的 Agent ID */
const editAgentId = ref<string | null>(null);
const editSkillsList = ref<string[]>([]);
const editToolsList = ref<string[]>([]);
const editModel = ref('');
const editActiveTab = ref<'skills' | 'tools' | 'model'>('skills');

/** 可用技能列表（从后端获取） */
interface SkillInfo {
  name: string;
  description: string;
}
const availableSkills = ref<SkillInfo[]>([]);
const skillsLoading = ref(false);

/** 可用工具列表 */
interface ToolInfo {
  name: string;
  description: string;
  category: string;
}
const availableTools = ref<ToolInfo[]>([]);

/** 运行弹窗的临时模型覆盖 */
// const runModelOverride = ref('');

/** 模型平铺列表 */
interface ModelItem {
  value: string;
  label: string;
  description: string;
  provider: string;
  type: 'group' | 'model';
  features?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
  functionCalling?: boolean;
  vision?: boolean;
  webSearch?: boolean;
}
const flatModelList = ref<ModelItem[]>([]);
const modelSearchQuery = ref('');

const filteredModelList = computed(() => {
  const q = modelSearchQuery.value.trim().toLowerCase();
  if (!q) return flatModelList.value;
  return flatModelList.value.filter(
    (m) =>
      m.label.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
  );
});

/** 文件/目录选择相关 */
interface AttachmentRef {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

onMounted(() => {
  agentsStore.fetchAgents();
});

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

/** 运行弹窗状态 */
const showRunDialog = ref(false);
const pendingAgentId = ref<string | null>(null);
const selectedMode = ref<AgentType>('agent');
/** 弹窗中的可选配置（默认折叠） */
const showAdvancedOptions = ref(false);
const taskDescription = ref('');
const taskAttachments = ref<AttachmentRef[]>([]);
const taskSkills = ref<string[]>([]);
const taskTools = ref<string[]>([]); // Added for run dialog tool selection

/** 运行模式选项 */
const modeOptions: { value: AgentType; label: string; description: string; icon: string }[] = [
  {
    value: 'agent',
    label: '自主模式',
    description: '智能体独立执行，可按需调度子智能体协助',
    icon: 'i-carbon-bot'
  },
  {
    value: 'orchestrator',
    label: '编排模式',
    description: '自动分解任务，多个子智能体并行协作',
    icon: 'i-carbon-flow'
  },
  {
    value: 'swarm',
    label: '蜂群模式',
    description: '智能体群组，动态切换处理不同子任务',
    icon: 'i-carbon-network-3'
  },
  {
    value: 'discussion',
    label: '讨论模式',
    description: '多智能体围绕话题讨论，最终达成共识结论',
    icon: 'i-carbon-chat-launch'
  }
];

async function openRunDialog(agentId: string): Promise<void> {
  pendingAgentId.value = agentId;
  selectedMode.value = 'agent';
  showAdvancedOptions.value = false;
  taskDescription.value = '';
  taskAttachments.value = [];

  const agent = agentsStore.agents.find((a) => a.id === agentId);
  taskSkills.value = agent?.skills ? [...agent.skills] : [];

  // 运行弹窗：默认使用该 Agent 配置的工具；如果 Agent 未配置，则使用全部可用工具
  if (agent?.tools && agent.tools.length > 0) {
    taskTools.value = [...agent.tools];
  } else {
    taskTools.value = []; // 等待 availableTools 加载
  }

  showRunDialog.value = true;

  // 并行加载，提高速度
  await Promise.all([loadAvailableSkills(), loadAvailableTools()]);

  // 如果此时 taskTools 仍为空（说明 Agent 没配置特定工具），则全选
  if (taskTools.value.length === 0 && availableTools.value.length > 0) {
    taskTools.value = availableTools.value.map((t) => t.name);
  }
}

function closeRunDialog(): void {
  showRunDialog.value = false;
  pendingAgentId.value = null;
}

async function loadAvailableSkills(): Promise<void> {
  if (skillsLoading.value) return;
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

async function loadAvailableTools(): Promise<void> {
  if (availableTools.value.length > 0) return;
  try {
    const url = `${configManager.getBaseUrl()}/gateway/agents/tools`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as { tools: ToolInfo[] };
      availableTools.value = data.tools;
    }
  } catch (err) {
    console.warn('[AgentView] Failed to fetch tools:', err);
  }
}

async function loadModelList(): Promise<void> {
  if (flatModelList.value.length > 0) return;
  try {
    const data = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = data?.models as Record<string, unknown> | undefined;
    const items: ModelItem[] = [];

    const groups = modelsConfig?.groups as Record<string, unknown> | undefined;
    if (groups) {
      for (const [id, cfg] of Object.entries(groups)) {
        const g = cfg as Record<string, unknown>;
        if (g.enabled !== false) {
          const models = (g.models as string[]) || [];
          const strategy = (g.strategy as string) || 'round-robin';
          items.push({
            value: `@group:${id}`,
            label: (g.name as string) || id,
            description: `${models.length} 个模型 · ${strategy}`,
            provider: '模型分组',
            type: 'group'
          });
        }
      }
    }

    const providers = modelsConfig?.providers as Record<string, unknown> | undefined;
    if (providers) {
      for (const [providerId, provCfg] of Object.entries(providers)) {
        const prov = provCfg as Record<string, unknown>;
        const provName = (prov.name as string) || providerId;
        const models = prov.models as Array<Record<string, unknown>> | undefined;
        if (models) {
          for (const m of models) {
            items.push({
              value: `${providerId}/${m.id as string}`,
              label: (m.name as string) || (m.id as string),
              description: (m.description as string) || '',
              provider: provName,
              type: 'model',
              features: (m.features as string[]) || undefined,
              contextWindow: m.contextWindow as number | undefined,
              maxOutputTokens: m.maxOutputTokens as number | undefined,
              reasoning: m.reasoning as boolean | undefined,
              functionCalling: m.functionCalling as boolean | undefined,
              vision: m.vision as boolean | undefined,
              webSearch: m.webSearch as boolean | undefined
            });
          }
        }
      }
    }
    flatModelList.value = items;
  } catch (err) {
    console.warn('[AgentView] Failed to load models:', err);
  }
}

function toggleRunSkill(skillName: string): void {
  const idx = taskSkills.value.indexOf(skillName);
  if (idx >= 0) {
    taskSkills.value.splice(idx, 1);
  } else {
    taskSkills.value.push(skillName);
  }
}

function toggleRunTool(toolName: string): void {
  const idx = taskTools.value.indexOf(toolName);
  if (idx >= 0) {
    taskTools.value.splice(idx, 1);
  } else {
    taskTools.value.push(toolName);
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
        const exists = taskAttachments.value.some((a) => a.path === filePath);
        if (!exists) {
          taskAttachments.value.push({ path: filePath, name, type: 'file' });
        }
      }
    }
  } catch (err) {
    console.warn('[AgentView] File dialog failed:', err);
  }
}

function removeAttachment(index: number): void {
  taskAttachments.value.splice(index, 1);
}

/** 构建初始消息 */
function buildInitialMessage(): string {
  const parts: string[] = [];

  if (taskDescription.value.trim()) {
    parts.push(taskDescription.value.trim());
  } else {
    parts.push('你好');
  }

  if (taskAttachments.value.length > 0) {
    parts.push('');
    parts.push('相关资料：');
    for (const att of taskAttachments.value) {
      parts.push(`- ${att.path}`);
    }
  }

  return parts.join('\n');
}

async function confirmStartTask(background = false): Promise<void> {
  if (!pendingAgentId.value) return;
  const agentId = pendingAgentId.value;
  const mode = selectedMode.value;
  const message = buildInitialMessage();
  closeRunDialog();
  await handleStartTask(agentId, mode, message, background);
}

async function handleStartTask(
  agentId: string,
  mode: AgentType = 'agent',
  initialMessage = '你好',
  background = false
): Promise<void> {
  agentsStore.selectAgent(agentId);
  const agent = agentsStore.agents.find((a) => a.id === agentId);
  const title = taskDescription.value.trim()
    ? taskDescription.value.trim().slice(0, 30) + (taskDescription.value.trim().length > 30 ? '...' : '')
    : agent
      ? `${agent.name} 的任务`
      : '新任务';
  const thread = await threadsStore.createThread(title, agentId, mode);
  if (thread) {
    if (!background) {
      await router.push(`/thread/${thread.id}`);
    }

    await nextTick();
    setTimeout(
      () => {
        const chatStore = useChatStore();
        chatStore.sendMessage(initialMessage);
      },
      background ? 100 : 300
    );
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

async function openAgentEditor(agentId: string): Promise<void> {
  const agent = agentsStore.agents.find((a) => a.id === agentId);
  if (!agent) return;
  editAgentId.value = agentId;
  editSkillsList.value = [...(agent.skills ?? [])];

  // 默认全选工具：如果 agent.tools 为空或 undefined，则视为使用全部工具
  if (agent.tools && agent.tools.length > 0) {
    editToolsList.value = [...agent.tools];
  } else {
    // 等待工具列表加载完成后全选
    editToolsList.value = [];
  }

  editModel.value = agent.model ?? '';
  editActiveTab.value = 'skills';

  modelSearchQuery.value = '';
  await Promise.all([loadAvailableSkills(), loadAvailableTools(), loadModelList()]);

  // 如果是空（即默认状态），加载完工具后自动全选
  if (editToolsList.value.length === 0 && availableTools.value.length > 0) {
    editToolsList.value = availableTools.value.map((t) => t.name);
  }
}

function toggleSkill(skillName: string): void {
  const idx = editSkillsList.value.indexOf(skillName);
  if (idx >= 0) {
    editSkillsList.value.splice(idx, 1);
  } else {
    editSkillsList.value.push(skillName);
  }
}

function toggleEditTool(toolName: string): void {
  const idx = editToolsList.value.indexOf(toolName);
  if (idx >= 0) {
    editToolsList.value.splice(idx, 1);
  } else {
    editToolsList.value.push(toolName);
  }
}

async function saveAgentConfig(): Promise<void> {
  if (!editAgentId.value) return;
  await agentsStore.updateAgent(editAgentId.value, {
    skills: editSkillsList.value,
    tools: editToolsList.value.length > 0 ? editToolsList.value : undefined,
    model: editModel.value || undefined
  });
  editAgentId.value = null;
}

function cancelAgentEdit(): void {
  editAgentId.value = null;
}

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
    <div class="landing">
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
          <div v-for="agent in agentsStore.agents" :key="agent.id" class="agent-card">
            <div class="card-header">
              <div class="card-avatar">
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

            <p class="card-desc">{{ agent.description }}</p>

            <div v-if="agent.skills && agent.skills.length > 0" class="card-skills">
              <span v-for="skill in agent.skills.slice(0, 3)" :key="skill" class="skill-tag">
                {{ skill }}
              </span>
              <span v-if="agent.skills.length > 3" class="skill-more"> +{{ agent.skills.length - 3 }} </span>
            </div>

            <!-- 模型 & 工具标签 -->
            <div class="card-meta">
              <span v-if="agent.model" class="meta-tag model" :title="agent.model">
                <span class="i-carbon-machine-learning-model inline-block h-3 w-3" />
                {{ agent.model.startsWith('@group:') ? agent.model.slice(7) : agent.model.split('/').pop() }}
              </span>
              <span v-if="agent.tools && agent.tools.length > 0" class="meta-tag tools">
                <span class="i-carbon-tool-box inline-block h-3 w-3" />
                {{ agent.tools.length }} 个工具
              </span>
            </div>

            <div class="card-footer">
              <button class="start-task-btn" @click="openRunDialog(agent.id)">
                <span class="i-carbon-play-filled-alt inline-block h-3.5 w-3.5" />
                <span>运行任务</span>
              </button>
              <div class="card-actions-right">
                <template v-if="confirmDeleteId !== agent.id">
                  <button class="action-icon" title="编辑配置" @click="openAgentEditor(agent.id)">
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

    <!-- 编辑智能体弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="editAgentId" class="skills-overlay" @click.self="cancelAgentEdit">
          <div class="skills-dialog edit-agent-dialog">
            <div class="skills-dialog-header">
              <span class="i-carbon-settings-adjust inline-block h-4 w-4" />
              <span>编辑配置</span>
            </div>

            <!-- Tab 切换 -->
            <div class="edit-tabs">
              <button :class="['edit-tab', { active: editActiveTab === 'model' }]" @click="editActiveTab = 'model'">
                <span class="i-carbon-machine-learning-model inline-block h-3 w-3" />
                模型
              </button>
              <button :class="['edit-tab', { active: editActiveTab === 'tools' }]" @click="editActiveTab = 'tools'">
                <span class="i-carbon-tool-box inline-block h-3 w-3" />
                工具
                <span v-if="editToolsList.length > 0" class="edit-tab-count">{{ editToolsList.length }}</span>
              </button>
              <button :class="['edit-tab', { active: editActiveTab === 'skills' }]" @click="editActiveTab = 'skills'">
                <span class="i-carbon-skill-level-advanced inline-block h-3 w-3" />
                技能
                <span v-if="editSkillsList.length > 0" class="edit-tab-count">{{ editSkillsList.length }}</span>
              </button>
            </div>

            <div class="skills-dialog-body">
              <!-- 模型 Tab -->
              <template v-if="editActiveTab === 'model'">
                <div class="edit-section-hint">选择此智能体使用的模型，留空则使用系统默认模型</div>
                <!-- 搜索框 -->
                <div class="model-search">
                  <span class="i-carbon-search inline-block h-3 w-3 model-search-icon" />
                  <input
                    v-model="modelSearchQuery"
                    type="text"
                    placeholder="搜索模型名称或供应商..."
                    class="model-search-input" />
                </div>
                <!-- 默认选项 -->
                <label class="skill-checkbox" :class="{ checked: !editModel }" @click="editModel = ''">
                  <input type="radio" name="editModel" :checked="!editModel" class="model-radio" />
                  <div class="skill-label">
                    <span class="skill-label-name">默认模型</span>
                    <span class="skill-label-desc">跟随系统配置</span>
                  </div>
                </label>
                <!-- 模型分组 -->
                <template v-if="filteredModelList.filter((m) => m.type === 'group').length > 0">
                  <div class="model-group-header">
                    <span class="i-carbon-group-objects inline-block h-3 w-3" />
                    模型分组
                  </div>
                  <label
                    v-for="item in filteredModelList.filter((m) => m.type === 'group')"
                    :key="item.value"
                    class="skill-checkbox"
                    :class="{ checked: editModel === item.value }"
                    @click="editModel = item.value">
                    <input type="radio" name="editModel" :checked="editModel === item.value" class="model-radio" />
                    <div class="skill-label">
                      <span class="skill-label-name">{{ item.label }}</span>
                      <span class="skill-label-desc">{{ item.description }}</span>
                    </div>
                  </label>
                </template>
                <!-- 按供应商展示模型 -->
                <template
                  v-for="providerName in [
                    ...new Set(filteredModelList.filter((m) => m.type === 'model').map((m) => m.provider))
                  ]"
                  :key="providerName">
                  <div class="model-group-header">
                    <span class="i-carbon-cloud inline-block h-3 w-3" />
                    {{ providerName }}
                  </div>
                  <label
                    v-for="item in filteredModelList.filter((m) => m.type === 'model' && m.provider === providerName)"
                    :key="item.value"
                    class="model-item"
                    :class="{ checked: editModel === item.value }"
                    @click="editModel = item.value">
                    <input type="radio" name="editModel" :checked="editModel === item.value" class="model-radio" />
                    <div class="model-item-body">
                      <div class="model-item-header">
                        <span class="model-item-name">{{ item.label }}</span>
                        <!-- 能力图标 -->
                        <span v-if="item.reasoning" class="model-cap" title="推理/思考">
                          <span class="i-carbon-watson inline-block h-3 w-3" />
                        </span>
                        <span v-if="item.vision" class="model-cap" title="视觉理解">
                          <span class="i-carbon-view inline-block h-3 w-3" />
                        </span>
                        <span v-if="item.functionCalling" class="model-cap" title="工具调用">
                          <span class="i-carbon-function inline-block h-3 w-3" />
                        </span>
                        <span v-if="item.webSearch" class="model-cap" title="联网搜索">
                          <span class="i-carbon-search inline-block h-3 w-3" />
                        </span>
                      </div>
                      <!-- 特性标签 -->
                      <div v-if="item.features && item.features.length > 0" class="model-features">
                        <span v-for="feat in item.features" :key="feat" class="model-feat-tag">{{ feat }}</span>
                      </div>
                    </div>
                  </label>
                </template>
                <p v-if="filteredModelList.length === 0 && modelSearchQuery" class="skills-empty"> 未找到匹配的模型 </p>
              </template>

              <!-- 工具 Tab -->
              <template v-if="editActiveTab === 'tools'">
                <div class="edit-section-hint">选择此智能体可使用的工具，不选则使用全部工具</div>
                <label
                  v-for="tool in availableTools"
                  :key="tool.name"
                  class="skill-checkbox"
                  :class="{ checked: editToolsList.includes(tool.name) }">
                  <input
                    type="checkbox"
                    :checked="editToolsList.includes(tool.name)"
                    @change="toggleEditTool(tool.name)" />
                  <div class="skill-label">
                    <span class="skill-label-name">{{ tool.name }}</span>
                    <span v-if="tool.description" class="skill-label-desc">{{ tool.description }}</span>
                  </div>
                </label>
              </template>

              <!-- 技能 Tab -->
              <template v-if="editActiveTab === 'skills'">
                <div v-if="skillsLoading" class="skills-loading">
                  <span class="i-carbon-renew inline-block h-4 w-4 animate-spin" />
                  <span>加载技能列表...</span>
                </div>
                <p v-else-if="availableSkills.length === 0" class="skills-empty"> 暂无可用技能 </p>
                <template v-else>
                  <label
                    v-for="skill in availableSkills"
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
                </template>
              </template>
            </div>
            <div class="skills-dialog-footer">
              <button class="text-btn" @click="cancelAgentEdit">取消</button>
              <button class="primary-btn" @click="saveAgentConfig">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 运行任务弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showRunDialog" class="skills-overlay" @click.self="closeRunDialog">
          <div class="skills-dialog run-dialog">
            <div class="skills-dialog-header">
              <span class="i-carbon-play-filled-alt inline-block h-4 w-4" />
              <span>运行任务</span>
            </div>

            <div class="run-dialog-body">
              <!-- 运行模式选择 -->
              <section class="run-section">
                <h4 class="run-section-title">运行模式</h4>
                <div class="mode-options-compact">
                  <label
                    v-for="option in modeOptions"
                    :key="option.value"
                    class="mode-chip"
                    :class="{ selected: selectedMode === option.value }">
                    <input
                      v-model="selectedMode"
                      type="radio"
                      name="agentMode"
                      :value="option.value"
                      class="mode-radio" />
                    <span :class="option.icon" class="inline-block h-3.5 w-3.5" />
                    <span class="mode-chip-label">{{ option.label }}</span>
                  </label>
                </div>
                <p class="run-section-hint">
                  {{ modeOptions.find((o) => o.value === selectedMode)?.description }}
                </p>
              </section>

              <!-- 折叠区：高级选项 -->
              <button class="advanced-toggle" @click="showAdvancedOptions = !showAdvancedOptions">
                <span
                  class="i-carbon-chevron-right inline-block h-3 w-3 transition-transform"
                  :class="{ 'rotate-90': showAdvancedOptions }" />
                <span>高级选项</span>
                <span
                  v-if="taskDescription || taskAttachments.length > 0 || taskSkills.length > 0 || taskTools.length > 0"
                  class="advanced-dot">
                </span>
              </button>

              <Transition name="slide-down">
                <div v-if="showAdvancedOptions" class="advanced-options">
                  <!-- 任务描述 -->
                  <div class="run-field">
                    <label class="run-field-label">
                      <span class="i-carbon-document inline-block h-3 w-3" />
                      任务描述
                    </label>
                    <textarea
                      v-model="taskDescription"
                      placeholder="描述你想完成的任务..."
                      rows="2"
                      class="run-textarea"></textarea>
                  </div>

                  <!-- 相关资料 -->
                  <div class="run-field">
                    <label class="run-field-label">
                      <span class="i-carbon-folder-add inline-block h-3 w-3" />
                      相关资料
                    </label>
                    <div v-if="taskAttachments.length > 0" class="attachment-list">
                      <div v-for="(att, idx) in taskAttachments" :key="att.path" class="attachment-item">
                        <span class="i-carbon-document inline-block h-3 w-3 shrink-0 text-muted-foreground" />
                        <span class="attachment-path" :title="att.path">{{ att.name }}</span>
                        <button class="attachment-remove" @click="removeAttachment(idx)">
                          <span class="i-carbon-close inline-block h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <button class="add-attachment-btn" @click="handleAddAttachment">
                      <span class="i-carbon-add inline-block h-3 w-3" />
                      添加文件或目录
                    </button>
                    <p class="run-field-hint">选择的路径将作为上下文信息传递给智能体</p>
                  </div>

                  <!-- 技能选择 -->
                  <div class="run-field">
                    <label class="run-field-label">
                      <span class="i-carbon-tool-box inline-block h-3 w-3" />
                      工具
                      <span v-if="taskTools.length > 0" class="skill-count">{{ taskTools.length }}</span>
                    </label>
                    <div class="skill-chips">
                      <label
                        v-for="tool in availableTools"
                        :key="tool.name"
                        class="skill-chip"
                        :class="{ active: taskTools.includes(tool.name) }"
                        :title="tool.description">
                        <input
                          type="checkbox"
                          :checked="taskTools.includes(tool.name)"
                          class="sr-only"
                          @change="toggleRunTool(tool.name)" />
                        {{ tool.name }}
                      </label>
                    </div>
                  </div>

                  <!-- 技能选择 -->
                  <div class="run-field">
                    <label class="run-field-label">
                      <span class="i-carbon-skill-level-advanced inline-block h-3 w-3" />
                      技能
                      <span v-if="taskSkills.length > 0" class="skill-count">{{ taskSkills.length }}</span>
                    </label>
                    <div v-if="skillsLoading" class="run-field-hint">
                      <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
                      加载中...
                    </div>
                    <div v-else class="skill-chips">
                      <label
                        v-for="skill in availableSkills"
                        :key="skill.name"
                        class="skill-chip"
                        :class="{ active: taskSkills.includes(skill.name) }"
                        :title="skill.description">
                        <input
                          type="checkbox"
                          :checked="taskSkills.includes(skill.name)"
                          class="sr-only"
                          @change="toggleRunSkill(skill.name)" />
                        {{ skill.name }}
                      </label>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <div class="skills-dialog-footer run-footer">
              <button class="text-btn" @click="closeRunDialog">取消</button>
              <div class="flex items-center gap-2">
                <button class="secondary-btn" title="创建任务但不跳转" @click="confirmStartTask(true)">
                  <span class="i-carbon-send-to-back inline-block h-3.5 w-3.5" />
                  后台运行
                </button>
                <button class="primary-btn" @click="confirmStartTask(false)">
                  <span class="i-carbon-play-filled-alt inline-block h-3.5 w-3.5" />
                  运行
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
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

.header {
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

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 13px;
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

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

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
  padding: 0 11px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.start-task-btn:hover {
  background: hsl(var(--primary) / 0.14);
  color: hsl(var(--primary));
}

.card-actions-right {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .card-actions-right {
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

/* 运行任务弹窗样式 */
.run-dialog {
  width: 460px;
  max-height: 600px;
}

.run-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.run-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.run-section-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
}

.run-section-hint {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.4;
}

.mode-options-compact {
  display: flex;
  gap: 6px;
}

.mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.5);
  color: hsl(var(--muted-foreground) / 0.7);
}

.mode-chip:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
}

.mode-chip.selected {
  background: hsl(var(--primary) / 0.08);
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--primary));
}

.mode-chip-label {
  line-height: 1;
}

.mode-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

/* 高级选项折叠 */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: color 0.15s ease;
}

.advanced-toggle:hover {
  color: hsl(var(--foreground) / 0.7);
}

.advanced-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: hsl(var(--primary));
}

.advanced-options {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
}

.run-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-field-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.6);
}

.run-field-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.run-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: hsl(var(--foreground));
  background: hsl(var(--background) / 0.5);
  border: 1px solid hsl(var(--border) / 0.4);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  min-height: 48px;
  transition: border-color 0.15s ease;
}

.run-textarea:focus {
  border-color: hsl(var(--primary) / 0.4);
}

.run-textarea::placeholder {
  color: hsl(var(--muted-foreground) / 0.3);
}

/* 附件列表 */
.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: hsl(var(--foreground) / 0.03);
  font-size: 11.5px;
}

.attachment-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: hsl(var(--foreground) / 0.7);
}

.attachment-remove {
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

.attachment-remove:hover {
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error));
}

.add-attachment-btn {
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

.add-attachment-btn:hover {
  background: hsl(var(--foreground) / 0.03);
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--primary));
}

/* 技能选择 */
.skill-count {
  font-size: 10px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  line-height: 1.6;
}

.skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.6);
  border: 1px solid transparent;
}

.skill-chip:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.skill-chip.active {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  border-color: hsl(var(--primary) / 0.2);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

/* 弹窗底部 */
.run-footer {
  justify-content: space-between;
}

.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.7);
  background: hsl(var(--foreground) / 0.05);
  transition: all 0.15s ease;
}

.secondary-btn:hover {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground) / 0.8);
}

/* Agent 卡片 meta 标签 */
.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.meta-tag.model {
  background: hsl(var(--warning) / 0.08);
  color: hsl(var(--warning) / 0.7);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-tag.tools {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.55);
}

/* 编辑弹窗增强 */
.edit-agent-dialog {
  width: 440px;
  max-height: 560px;
}

.edit-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px 0;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
}

.edit-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.55);
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
  cursor: pointer;
  margin-bottom: -1px;
}

.edit-tab:hover {
  color: hsl(var(--foreground) / 0.7);
}

.edit-tab.active {
  color: hsl(var(--primary));
  border-bottom-color: hsl(var(--primary));
}

.edit-tab-count {
  font-size: 9px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  line-height: 1.6;
}

.edit-section-hint {
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.5;
  margin-bottom: 8px;
}

/* 模型搜索框 */
.model-search {
  position: relative;
  margin-bottom: 8px;
}

.model-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: hsl(var(--muted-foreground) / 0.35);
  pointer-events: none;
}

.model-search-input {
  width: 100%;
  padding: 7px 10px 7px 30px;
  font-size: 12px;
  color: hsl(var(--foreground));
  background: hsl(var(--background) / 0.5);
  border: 1px solid hsl(var(--border) / 0.4);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s ease;
}

.model-search-input:focus {
  border-color: hsl(var(--primary) / 0.4);
}

.model-search-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.3);
}

/* 模型分组标题 */
.model-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.model-radio {
  width: 14px;
  height: 14px;
  accent-color: hsl(var(--primary));
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 2px;
}

/* 模型列表项（富信息版） */
.model-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.12s ease;
  border: 1px solid transparent;
}

.model-item:hover {
  background: hsl(var(--foreground) / 0.03);
}

.model-item.checked {
  background: hsl(var(--primary) / 0.04);
  border-color: hsl(var(--primary) / 0.12);
}

.model-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.model-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.model-item-name {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.85);
  line-height: 1.3;
}

.model-cap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.5);
}

.model-features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.model-feat-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.6);
  white-space: nowrap;
  line-height: 1.6;
}

/* 运行弹窗中的模型 chip 选择 */
.run-model-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.run-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.6);
  border: 1px solid transparent;
  white-space: nowrap;
}

.run-model-chip:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.run-model-chip.selected {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  border-color: hsl(var(--primary) / 0.2);
}
</style>
