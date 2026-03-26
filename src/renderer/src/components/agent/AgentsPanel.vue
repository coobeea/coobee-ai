<script setup lang="ts">
/**
 * AgentsPanel — Agent 列表面板
 *
 * 展示所有已注册的 Agent，支持：
 * - 查看 Agent 列表（名称、描述、创建者、版本）
 * - 创建新 Agent（简单表单）
 * - 选中 Agent 用于对话
 * - 删除 Agent
 */

import { onMounted, ref, reactive } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import { gateway } from '@/plugins/gatewaySetup';

const isCollapsed = defineModel<boolean>('collapsed', { default: false });
const agentsStore = useAgentsStore();
const confirmDeleteId = ref<string | null>(null);
const showCreateForm = ref(false);

const newAgent = reactive({
  id: '',
  name: '',
  description: '',
  instructions: '',
  model: ''
});

// 模型选项（单模型 + 分组）
interface ModelOption {
  value: string;
  label: string;
  isGroup: boolean;
}

const modelOptions = ref<ModelOption[]>([]);

async function loadModelOptions(): Promise<void> {
  try {
    const data = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = data?.models as Record<string, unknown> | undefined;

    const options: ModelOption[] = [];

    const groups = modelsConfig?.groups as Record<string, unknown> | undefined;
    if (groups) {
      for (const [id, cfg] of Object.entries(groups)) {
        const g = cfg as Record<string, unknown>;
        if (g.enabled !== false) {
          options.push({ value: `@group:${id}`, label: `[分组] ${(g.name as string) || id}`, isGroup: true });
        }
      }
    }

    const providers = modelsConfig?.providers as Record<string, unknown> | undefined;
    if (providers) {
      for (const [, provCfg] of Object.entries(providers)) {
        const prov = provCfg as Record<string, unknown>;
        if (prov.enabled === false) continue;
        const models = prov.models as Array<{ id: string; name?: string }> | undefined;
        if (models) {
          for (const m of models) {
            options.push({ value: m.id, label: m.name || m.id, isGroup: false });
          }
        }
      }
    }

    modelOptions.value = options;
  } catch {
    // 静默忽略
  }
}

onMounted(() => {
  agentsStore.fetchAgents();
  loadModelOptions();
});

function handleSelect(agentId: string): void {
  if (agentsStore.selectedAgentId === agentId) {
    agentsStore.selectAgent(null);
  } else {
    agentsStore.selectAgent(agentId);
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

function cancelDelete(): void {
  confirmDeleteId.value = null;
}

function toggleCreateForm(): void {
  showCreateForm.value = !showCreateForm.value;
  if (showCreateForm.value) {
    newAgent.id = '';
    newAgent.name = '';
    newAgent.description = '';
    newAgent.instructions = '';
    newAgent.model = '';
    loadModelOptions();
  }
}

async function handleCreate(): Promise<void> {
  if (!newAgent.id.trim() || !newAgent.name.trim() || !newAgent.instructions.trim()) return;

  const ok = await agentsStore.createAgent({
    id: newAgent.id.trim(),
    name: newAgent.name.trim(),
    description: newAgent.description.trim() || newAgent.name.trim(),
    instructions: newAgent.instructions.trim(),
    model: newAgent.model.trim() || undefined
  });

  if (ok) {
    showCreateForm.value = false;
  }
}
</script>

<template>
  <aside v-show="!isCollapsed" class="flex h-full w-56 shrink-0 flex-col border-l border-gray-200/80 bg-gray-50/50">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-bot inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">Agents</span>
        <span
          v-if="agentsStore.agentCount > 0"
          class="ml-1 rounded-full bg-gray-200 px-1.5 text-[10px] font-medium text-gray-500">
          {{ agentsStore.agentCount }}
        </span>
      </div>
      <div class="flex items-center gap-0.5">
        <!-- 创建按钮 -->
        <button
          class="flex h-5 w-5 items-center justify-center rounded transition"
          :class="[
            showCreateForm ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
          ]"
          title="创建 Agent"
          @click="toggleCreateForm">
          <span class="i-carbon-add inline-block h-3 w-3"></span>
        </button>
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="刷新"
          @click="agentsStore.fetchAgents()">
          <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': agentsStore.loading }"></span>
        </button>
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="折叠"
          @click="isCollapsed = true">
          <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 创建表单 -->
    <div v-if="showCreateForm" class="shrink-0 border-b border-gray-200/60 bg-white p-2.5">
      <div class="space-y-2">
        <div class="flex gap-2">
          <input
            v-model="newAgent.id"
            placeholder="ID (如 code-reviewer)"
            class="w-1/2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 outline-none transition focus:border-primary/40 focus:bg-white" />
          <input
            v-model="newAgent.name"
            placeholder="名称"
            class="w-1/2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 outline-none transition focus:border-primary/40 focus:bg-white" />
        </div>
        <input
          v-model="newAgent.description"
          placeholder="一句话描述（可选）"
          class="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 outline-none transition focus:border-primary/40 focus:bg-white" />
        <textarea
          v-model="newAgent.instructions"
          placeholder="系统指令：定义角色、行为规范、输出格式..."
          rows="3"
          class="w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] leading-relaxed text-gray-700 outline-none transition focus:border-primary/40 focus:bg-white"></textarea>
        <!-- 模型选择 -->
        <select
          v-model="newAgent.model"
          class="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 outline-none transition focus:border-primary/40 focus:bg-white">
          <option value="">自动选择模型</option>
          <optgroup v-if="modelOptions.filter((o) => o.isGroup).length > 0" label="── 模型分组 ──">
            <option v-for="opt in modelOptions.filter((o) => o.isGroup)" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </optgroup>
          <optgroup v-if="modelOptions.filter((o) => !o.isGroup).length > 0" label="── 单个模型 ──">
            <option v-for="opt in modelOptions.filter((o) => !o.isGroup)" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </optgroup>
        </select>
        <div class="flex justify-end gap-1">
          <button
            class="rounded-md px-2.5 py-1 text-[11px] text-gray-500 transition hover:bg-gray-100"
            @click="showCreateForm = false">
            取消
          </button>
          <button
            class="rounded-md bg-primary px-2.5 py-1 text-[11px] text-white transition hover:bg-primary/90 disabled:opacity-40"
            :disabled="!newAgent.id.trim() || !newAgent.name.trim() || !newAgent.instructions.trim()"
            @click="handleCreate">
            创建
          </button>
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto p-2">
      <!-- 错误提示 -->
      <div v-if="agentsStore.error" class="mb-2 rounded-md bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
        <div class="flex items-center gap-1.5">
          <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0"></span>
          <span>{{ agentsStore.error }}</span>
        </div>
        <button
          class="mt-1.5 rounded px-2 py-0.5 text-[10px] text-red-500 transition hover:bg-red-100"
          @click="agentsStore.fetchAgents()">
          重试
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="agentsStore.loading && agentsStore.agents.length === 0" class="flex flex-col items-center pt-12">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin text-gray-300"></span>
        <p class="mt-2 text-[11px] text-gray-400">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading" class="flex flex-col items-center pt-12">
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
          <span class="i-carbon-bot inline-block h-5 w-5 text-gray-400"></span>
        </div>
        <p class="mb-1 text-xs font-medium text-gray-500">暂无 Agent</p>
        <p class="mb-3 text-center text-[10px] leading-relaxed text-gray-400">
          点击上方 + 手动创建<br />或在对话中让 AI 自动创建
        </p>
        <button
          class="rounded-md bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/20"
          @click="toggleCreateForm">
          创建第一个 Agent
        </button>
      </div>

      <!-- Agent 列表 -->
      <div v-else class="space-y-1">
        <!-- 当前选中提示 -->
        <div v-if="agentsStore.selectedAgent" class="mb-2 rounded-md bg-primary/5 px-2 py-1.5">
          <div class="flex items-center gap-1">
            <span class="i-carbon-checkmark-filled inline-block h-3 w-3 text-primary"></span>
            <span class="text-[10px] font-medium text-primary"> 使用: {{ agentsStore.selectedAgent.name }} </span>
          </div>
        </div>

        <!-- Agent 卡片 -->
        <div
          v-for="agent in agentsStore.agents"
          :key="agent.id"
          class="group cursor-pointer rounded-lg border p-2 transition-all"
          :class="[
            agentsStore.selectedAgentId === agent.id
              ? 'border-primary/30 bg-primary/5'
              : 'border-transparent bg-white hover:border-gray-200 hover:shadow-sm'
          ]"
          @click="handleSelect(agent.id)">
          <!-- 标题行 -->
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="truncate text-[11px] font-medium text-gray-700">
                  {{ agent.name }}
                </span>
                <span class="shrink-0 text-[9px] text-gray-400">v{{ agent.version }}</span>
              </div>
              <p class="mt-0.5 text-[10px] leading-snug text-gray-400" :title="agent.description">
                {{ agent.description.length > 40 ? agent.description.slice(0, 40) + '...' : agent.description }}
              </p>
            </div>

            <!-- 删除按钮 -->
            <button
              v-if="confirmDeleteId !== agent.id"
              class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-400"
              title="删除"
              @click.stop="handleDelete(agent.id)">
              <span class="i-carbon-trash-can inline-block h-3 w-3"></span>
            </button>
            <div v-else class="ml-1 flex shrink-0 items-center gap-0.5" @click.stop>
              <button
                class="rounded px-1 py-0.5 text-[9px] text-red-500 transition hover:bg-red-50"
                @click.stop="handleDelete(agent.id)">
                确认
              </button>
              <button
                class="rounded px-1 py-0.5 text-[9px] text-gray-400 transition hover:bg-gray-100"
                @click.stop="cancelDelete">
                取消
              </button>
            </div>
          </div>

          <!-- 技能标签 -->
          <div v-if="agent.skills && agent.skills.length > 0" class="mt-1.5 flex flex-wrap items-center gap-1">
            <span
              v-for="skill in agent.skills.slice(0, 2)"
              :key="skill"
              class="rounded-sm bg-primary/6 px-1 py-px text-[9px] text-primary/60">
              {{ skill }}
            </span>
            <span v-if="agent.skills.length > 2" class="text-[9px] text-gray-400">
              +{{ agent.skills.length - 2 }}
            </span>
          </div>

          <!-- 底部标签 -->
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <span
              class="rounded-sm px-1 py-px text-[9px]"
              :class="[agent.createdBy === 'agent' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500']">
              {{ agent.createdBy === 'agent' ? 'AI 创建' : '手动创建' }}
            </span>
            <span
              v-if="agent.model"
              class="rounded-sm bg-amber-50 px-1 py-px text-[9px] text-amber-600 font-mono"
              :title="agent.model">
              {{
                agent.model.startsWith('@group:')
                  ? agent.model
                  : agent.model.slice(0, 12) + (agent.model.length > 12 ? '…' : '')
              }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
