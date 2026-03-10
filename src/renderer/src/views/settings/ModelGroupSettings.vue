<script setup lang="ts">
/**
 * ModelGroupSettings - 模型分组管理（独立页面）
 *
 * 左右分栏：
 * - 左侧：分组列表
 * - 右侧：分组详情 / 新建编辑表单
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

type LoadBalanceStrategy = 'round-robin' | 'random' | 'weighted' | 'quota-aware' | 'fallback';

interface ModelGroup {
  id: string;
  name: string;
  description?: string;
  models: string[];
  strategy: LoadBalanceStrategy;
  weights?: Record<string, number>;
  enabled: boolean;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
}

const groups = ref<ModelGroup[]>([]);
const selectedGroup = ref<string>('');
const groupSaving = ref(false);
const groupError = ref<string | null>(null);
const showGroupForm = ref(false);
const loading = ref(true);

const providers = ref<ProviderInfo[]>([]);
const allModels = ref<AvailableModel[]>([]);
const modelSearchQuery = ref('');

const filteredModels = computed(() => {
  const q = modelSearchQuery.value.toLowerCase().trim();
  if (!q) return allModels.value;
  return allModels.value.filter(
    (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  );
});

const providerMap = computed(() => {
  const map: Record<string, string> = {};
  for (const p of providers.value) {
    for (const modelId of p.models) {
      map[modelId] = p.name;
    }
  }
  return map;
});

function getProviderName(modelId: string): string {
  if (providerMap.value[modelId]) return providerMap.value[modelId];
  const parts = modelId.split('/');
  if (parts.length >= 2) return parts[0];
  return '未知';
}

const STRATEGIES: { value: LoadBalanceStrategy; label: string; desc: string }[] = [
  { value: 'round-robin', label: '轮询', desc: '依次使用每个模型' },
  { value: 'random', label: '随机', desc: '随机选择模型' },
  { value: 'weighted', label: '加权', desc: '按权重分配请求' },
  { value: 'quota-aware', label: '配额感知', desc: '优先使用剩余额度多的模型' },
  { value: 'fallback', label: '故障转移', desc: '优先使用第一个，失败则切换' }
];

const groupForm = ref<Omit<ModelGroup, 'id'> & { id: string }>({
  id: '',
  name: '',
  description: '',
  models: [],
  strategy: 'round-robin',
  enabled: true
});
const isEditingGroup = ref(false);

function isModelSelected(modelId: string): boolean {
  return groupForm.value.models.includes(modelId);
}

function toggleModel(modelId: string): void {
  const idx = groupForm.value.models.indexOf(modelId);
  if (idx >= 0) {
    groupForm.value.models.splice(idx, 1);
  } else {
    groupForm.value.models.push(modelId);
  }
}

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = result.models as Record<string, unknown> | undefined;

    const groupsConfig = modelsConfig?.groups as Record<string, unknown> | undefined;
    if (groupsConfig) {
      groups.value = Object.entries(groupsConfig).map(([id, cfg]) => {
        const g = cfg as Record<string, unknown>;
        return {
          id,
          name: (g.name as string) || id,
          description: g.description as string | undefined,
          models: (g.models as string[]) || [],
          strategy: (g.strategy as LoadBalanceStrategy) || 'round-robin',
          weights: g.weights as Record<string, number> | undefined,
          enabled: g.enabled !== false
        };
      });
      if (groups.value.length > 0 && !selectedGroup.value) {
        selectedGroup.value = groups.value[0].id;
      }
    }

    const providersConfig = modelsConfig?.providers as Record<string, unknown> | undefined;
    if (providersConfig) {
      const provList: ProviderInfo[] = [];
      const modelList: AvailableModel[] = [];
      for (const [id, cfg] of Object.entries(providersConfig)) {
        const p = cfg as Record<string, unknown>;
        const provName = (p.name as string) || id;
        const models = (p.models as { id: string; name?: string }[]) || [];
        provList.push({ id, name: provName, models: models.map((m) => m.id) });
        for (const m of models) {
          modelList.push({ id: m.id, name: m.name || m.id, provider: provName });
        }
      }
      providers.value = provList;
      allModels.value = modelList;
    }
  } catch {
    groupError.value = '加载配置失败';
  } finally {
    loading.value = false;
  }
}

const selectedGroupInfo = computed(() => groups.value.find((g) => g.id === selectedGroup.value));

function selectGroup(id: string): void {
  selectedGroup.value = id;
  showGroupForm.value = false;
}

function openNewGroupForm(): void {
  isEditingGroup.value = false;
  groupForm.value = { id: '', name: '', description: '', models: [], strategy: 'round-robin', enabled: true };
  modelSearchQuery.value = '';
  showGroupForm.value = true;
  selectedGroup.value = '';
}

function openEditGroupForm(group: ModelGroup): void {
  isEditingGroup.value = true;
  groupForm.value = { ...group, models: [...group.models] };
  modelSearchQuery.value = '';
  showGroupForm.value = true;
  selectedGroup.value = group.id;
}

function cancelGroupForm(): void {
  showGroupForm.value = false;
  if (!selectedGroup.value && groups.value.length > 0) {
    selectedGroup.value = groups.value[0].id;
  }
}

async function saveGroup(): Promise<void> {
  const models = groupForm.value.models;
  if (!groupForm.value.id.trim() || !groupForm.value.name.trim() || models.length === 0) {
    groupError.value = '分组 ID、名称和模型列表均不能为空';
    return;
  }

  groupSaving.value = true;
  groupError.value = null;
  try {
    const groupId = groupForm.value.id.trim();
    const groupsUpdate: Record<string, unknown> = {};
    groupsUpdate[groupId] = {
      id: groupId,
      name: groupForm.value.name,
      description: groupForm.value.description || undefined,
      models,
      strategy: groupForm.value.strategy,
      enabled: groupForm.value.enabled
    };
    await gateway.request('config.patch', {
      partial: { models: { groups: groupsUpdate } }
    });
    const updated: ModelGroup = { ...groupForm.value, models };
    const idx = groups.value.findIndex((g) => g.id === updated.id);
    if (idx >= 0) {
      groups.value[idx] = updated;
    } else {
      groups.value.push(updated);
    }
    selectedGroup.value = updated.id;
    showGroupForm.value = false;
  } catch (err: unknown) {
    groupError.value = err instanceof Error ? err.message : String(err);
  } finally {
    groupSaving.value = false;
  }
}

async function toggleGroupEnabled(group: ModelGroup): Promise<void> {
  try {
    const groupsUpdate: Record<string, unknown> = {};
    groupsUpdate[group.id] = { enabled: !group.enabled };
    await gateway.request('config.patch', {
      partial: { models: { groups: groupsUpdate } }
    });
    group.enabled = !group.enabled;
  } catch (err: unknown) {
    groupError.value = err instanceof Error ? err.message : String(err);
  }
}

function getStrategyLabel(strategy: string): string {
  return STRATEGIES.find((s) => s.value === strategy)?.label || strategy;
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧：分组列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold">模型分组</h2>
          <p class="mt-0.5 text-[10px] text-muted-foreground">{{ groups.length }} 个分组</p>
        </div>
        <button
          class="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          @click="openNewGroupForm">
          <span class="i-carbon-add inline-block h-3 w-3"></span>
          新建
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-2 inline-block h-6 w-6 animate-spin"></span>
          <p class="text-xs">加载中...</p>
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="groups.length === 0"
          class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-group-objects mb-2 inline-block h-8 w-8 opacity-40"></span>
          <p class="text-xs">暂无模型分组</p>
          <p class="mt-1 text-[10px]">点击「新建」创建你的第一个分组</p>
        </div>

        <!-- 分组卡片 -->
        <div v-else class="flex flex-col gap-1.5">
          <div
            v-for="group in groups"
            :key="group.id"
            :class="[
              'cursor-pointer rounded-lg border px-3 py-2.5 transition-colors',
              selectedGroup === group.id && !showGroupForm
                ? 'border-primary bg-primary/5'
                : 'border-transparent hover:bg-muted'
            ]"
            @click="selectGroup(group.id)">
            <div class="flex items-center justify-between">
              <span :class="['truncate text-xs font-semibold', selectedGroup === group.id ? 'text-primary' : '']">
                {{ group.name }}
              </span>
              <span :class="['h-1.5 w-1.5 flex-shrink-0 rounded-full', group.enabled ? 'bg-green-500' : 'bg-gray-300']">
              </span>
            </div>
            <div class="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{{ group.models.length }} 个模型</span>
              <span>·</span>
              <span>{{ getStrategyLabel(group.strategy) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：详情 / 表单 -->
    <div class="flex-1 overflow-y-auto bg-background p-6 lg:p-10">
      <!-- 分组表单（新建/编辑） -->
      <div v-if="showGroupForm" class="mx-auto flex max-w-2xl flex-col gap-6">
        <div class="border-b border-border pb-4">
          <h1 class="text-xl font-bold">{{ isEditingGroup ? '编辑分组' : '新建模型分组' }}</h1>
          <p class="mt-1 text-sm text-muted-foreground">通过分组让 Agent 自动在多个模型间进行负载均衡</p>
        </div>

        <div v-if="groupError" class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {{ groupError }}
        </div>

        <div class="flex flex-col gap-5 rounded-lg border border-border bg-card p-6">
          <!-- ID -->
          <div>
            <label class="mb-1.5 block text-sm font-medium">分组 ID <span class="text-red-500">*</span></label>
            <input
              v-model="groupForm.id"
              :disabled="isEditingGroup"
              type="text"
              placeholder="high-performance"
              class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50" />
            <p class="mt-1 text-xs text-muted-foreground">
              Agent 通过 <code class="text-primary">@group:&lt;ID&gt;</code> 引用此分组
            </p>
          </div>
          <!-- 名称 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium">显示名称 <span class="text-red-500">*</span></label>
            <input
              v-model="groupForm.name"
              type="text"
              placeholder="生产环境模型组"
              class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <!-- 描述 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium">描述</label>
            <input
              v-model="groupForm.description"
              type="text"
              placeholder="用于生产环境的高性能模型集合"
              class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <!-- 模型列表 -->
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label class="text-sm font-medium"
                >选择模型 <span class="text-red-500">*</span>
                <span v-if="groupForm.models.length > 0" class="ml-1 text-xs font-normal text-muted-foreground"
                  >(已选 {{ groupForm.models.length }} 个)</span
                >
              </label>
            </div>
            <!-- 搜索框 -->
            <div class="relative mb-2">
              <span
                class="i-carbon-search pointer-events-none absolute left-3 top-1/2 inline-block h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"></span>
              <input
                v-model="modelSearchQuery"
                type="text"
                placeholder="搜索模型名称或供应商..."
                class="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <!-- 模型复选框列表 -->
            <div class="max-h-52 overflow-y-auto rounded-md border border-input bg-background">
              <div v-if="filteredModels.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground">
                {{ allModels.length === 0 ? '暂无可用模型，请先在「模型设置」中配置供应商' : '未找到匹配的模型' }}
              </div>
              <label
                v-for="m in filteredModels"
                :key="m.id"
                class="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/50"
                :class="{ 'bg-primary/5': isModelSelected(m.id) }">
                <input
                  type="checkbox"
                  :checked="isModelSelected(m.id)"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-primary accent-primary"
                  @change="toggleModel(m.id)" />
                <div class="min-w-0 flex-1">
                  <div class="truncate font-mono text-xs">{{ m.id }}</div>
                  <div class="truncate text-[10px] text-muted-foreground">{{ m.provider }}</div>
                </div>
              </label>
            </div>
            <!-- 已选标签 -->
            <div v-if="groupForm.models.length > 0" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="modelId in groupForm.models"
                :key="modelId"
                class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {{ modelId }}
                <button class="ml-0.5 hover:text-red-500" @click="toggleModel(modelId)">
                  <span class="i-carbon-close inline-block h-2.5 w-2.5"></span>
                </button>
              </span>
            </div>
          </div>
          <!-- 策略 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium">负载均衡策略</label>
            <select
              v-model="groupForm.strategy"
              class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option v-for="s in STRATEGIES" :key="s.value" :value="s.value">{{ s.label }} — {{ s.desc }}</option>
            </select>
          </div>
          <!-- 启用开关 -->
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium">启用分组</p>
              <p class="mt-0.5 text-xs text-muted-foreground">禁用后 Agent 将无法使用此分组</p>
            </div>
            <button
              :class="[
                'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                groupForm.enabled ? 'bg-primary' : 'bg-muted'
              ]"
              @click="groupForm.enabled = !groupForm.enabled">
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  groupForm.enabled ? 'translate-x-4' : 'translate-x-0'
                ]"></span>
            </button>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-end gap-3">
          <button
            class="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            @click="cancelGroupForm">
            取消
          </button>
          <button
            :disabled="groupSaving"
            class="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            @click="saveGroup">
            <span
              :class="[
                'inline-block h-4 w-4',
                groupSaving ? 'i-carbon-in-progress animate-spin' : 'i-carbon-save'
              ]"></span>
            {{ groupSaving ? '保存中...' : '保存分组' }}
          </button>
        </div>
      </div>

      <!-- 分组详情（只读） -->
      <div v-else-if="selectedGroupInfo" class="mx-auto flex max-w-2xl flex-col gap-6">
        <div class="flex items-start justify-between border-b border-border pb-4">
          <div>
            <h1 class="text-xl font-bold">{{ selectedGroupInfo.name }}</h1>
            <p class="mt-1 font-mono text-sm text-muted-foreground">@group:{{ selectedGroupInfo.id }}</p>
            <p v-if="selectedGroupInfo.description" class="mt-1 text-sm text-muted-foreground">
              {{ selectedGroupInfo.description }}
            </p>
          </div>
          <div class="flex flex-shrink-0 items-center gap-2">
            <button
              :class="[
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                selectedGroupInfo.enabled
                  ? 'border border-border bg-background text-muted-foreground hover:bg-muted'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              ]"
              @click="toggleGroupEnabled(selectedGroupInfo)">
              <span
                :class="[
                  'inline-block h-3 w-3',
                  selectedGroupInfo.enabled ? 'i-carbon-close' : 'i-carbon-play'
                ]"></span>
              {{ selectedGroupInfo.enabled ? '禁用' : '启用' }}
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              @click="openEditGroupForm(selectedGroupInfo)">
              <span class="i-carbon-edit inline-block h-3 w-3"></span>
              编辑
            </button>
          </div>
        </div>

        <!-- 基本信息卡片 -->
        <div class="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">负载均衡策略</span>
            <span class="font-medium">{{ getStrategyLabel(selectedGroupInfo.strategy) }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">状态</span>
            <span
              :class="[
                'flex items-center gap-1.5 font-medium',
                selectedGroupInfo.enabled ? 'text-green-600' : 'text-muted-foreground'
              ]">
              <span
                :class="['h-2 w-2 rounded-full', selectedGroupInfo.enabled ? 'bg-green-500' : 'bg-gray-300']"></span>
              {{ selectedGroupInfo.enabled ? '已启用' : '已禁用' }}
            </span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">模型数量</span>
            <span class="font-medium">{{ selectedGroupInfo.models.length }} 个</span>
          </div>
        </div>

        <!-- 模型列表 -->
        <section>
          <h2 class="mb-3 text-sm font-semibold">模型列表</h2>
          <div class="flex flex-col gap-2">
            <div
              v-for="(modelId, idx) in selectedGroupInfo.models"
              :key="modelId"
              class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                  {{ idx + 1 }}
                </span>
                <div class="flex flex-col">
                  <span class="font-mono text-sm">{{ modelId }}</span>
                  <span class="text-[10px] text-muted-foreground">{{ getProviderName(modelId) }}</span>
                </div>
              </div>
              <span v-if="selectedGroupInfo.weights?.[modelId]" class="text-xs text-muted-foreground">
                权重: {{ selectedGroupInfo.weights[modelId] }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- 空状态 -->
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="flex flex-col items-center text-center">
          <span class="i-carbon-group-objects mb-4 inline-block h-12 w-12 opacity-40"></span>
          <p class="text-sm font-medium">模型分组管理</p>
          <p class="mt-1 text-xs">选择左侧分组查看详情，或点击「新建」创建分组</p>
          <p class="mt-3 text-[10px] text-muted-foreground/60">
            Agent 可通过 <code class="text-primary">@group:&lt;ID&gt;</code> 使用分组，自动实现多模型负载均衡
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
