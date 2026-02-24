<script setup lang="ts">
/**
 * ModelSettings - 模型设置组件
 *
 * 左右分栏：
 * - 左侧：供应商列表 / 分组列表（Tab 切换）
 * - 右侧：供应商配置详情 / 分组配置详情
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

type LeftTab = 'providers' | 'groups';

interface Model {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  features?: string[];
}

interface Provider {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error';
  apiKey?: string;
  baseUrl?: string;
  models: Model[];
  modelCount: number;
}

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

// ===== 左侧 Tab =====
const leftTab = ref<LeftTab>('providers');

// ===== 供应商相关 =====
const providers = ref<Provider[]>([]);
const selectedProvider = ref<string>('');
const loading = ref(true);
const error = ref<string | null>(null);

// 配置表单
const config = ref({
  apiKey: '',
  baseUrl: '',
  enabled: true
});

// 测试相关
const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testErrorMsg = ref('');

// ===== 分组相关 =====
const groups = ref<ModelGroup[]>([]);
const selectedGroup = ref<string>('');
const groupSaving = ref(false);
const groupError = ref<string | null>(null);
const showGroupForm = ref(false);

const STRATEGIES: { value: LoadBalanceStrategy; label: string }[] = [
  { value: 'round-robin', label: '轮询 (round-robin)' },
  { value: 'random', label: '随机 (random)' },
  { value: 'weighted', label: '加权 (weighted)' },
  { value: 'quota-aware', label: '配额感知 (quota-aware)' },
  { value: 'fallback', label: '故障转移 (fallback)' }
];

// 分组编辑表单
const groupForm = ref<Omit<ModelGroup, 'id'> & { id: string }>({
  id: '',
  name: '',
  description: '',
  models: [],
  strategy: 'round-robin',
  enabled: true
});
const groupFormModelsText = ref(''); // 模型列表（换行分隔）
const isEditingGroup = ref(false); // 是否编辑已有分组

// 加载 Providers
async function loadProviders(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = result.models as Record<string, unknown> | undefined;
    const providersConfig = modelsConfig?.providers as Record<string, unknown> | undefined;

    if (providersConfig) {
      providers.value = Object.entries(providersConfig).map(([id, cfg]) => {
        const providerCfg = cfg as Record<string, unknown>;
        return {
          id,
          name: (providerCfg.name as string) || id,
          type: (providerCfg.type as string) || 'OpenAI Compatible',
          status: providerCfg.apiKey ? ('connected' as const) : ('disconnected' as const),
          apiKey: providerCfg.apiKey as string | undefined,
          baseUrl: providerCfg.baseUrl as string | undefined,
          models: (providerCfg.models as Model[]) || [],
          modelCount: (providerCfg.models as Model[])?.length || 0
        };
      });

      // 默认选中第一个
      if (providers.value.length > 0 && !selectedProvider.value) {
        selectProvider(providers.value[0].id);
      }
    }

    // 同时加载分组
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
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

// ===== 分组操作 =====
const selectedGroupInfo = computed(() => groups.value.find((g) => g.id === selectedGroup.value));

function selectGroup(id: string): void {
  selectedGroup.value = id;
  showGroupForm.value = false;
}

function openNewGroupForm(): void {
  isEditingGroup.value = false;
  groupForm.value = { id: '', name: '', description: '', models: [], strategy: 'round-robin', enabled: true };
  groupFormModelsText.value = '';
  showGroupForm.value = true;
  selectedGroup.value = '';
}

function openEditGroupForm(group: ModelGroup): void {
  isEditingGroup.value = true;
  groupForm.value = { ...group, models: [...group.models] };
  groupFormModelsText.value = group.models.join('\n');
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
  const models = groupFormModelsText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!groupForm.value.id.trim() || !groupForm.value.name.trim() || models.length === 0) {
    groupError.value = '分组 ID、名称和模型列表均不能为空';
    return;
  }

  groupSaving.value = true;
  groupError.value = null;
  try {
    await gateway.request('config.patch', {
      path: `models.groups.${groupForm.value.id}`,
      value: {
        name: groupForm.value.name,
        description: groupForm.value.description || undefined,
        models,
        strategy: groupForm.value.strategy,
        enabled: groupForm.value.enabled
      }
    });
    // 更新本地列表
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
    await gateway.request('config.patch', {
      path: `models.groups.${group.id}.enabled`,
      value: !group.enabled
    });
    group.enabled = !group.enabled;
  } catch (err: unknown) {
    groupError.value = err instanceof Error ? err.message : String(err);
  }
}

// 选中的 Provider 信息
const selectedProviderInfo = computed(() => {
  return providers.value.find((p) => p.id === selectedProvider.value);
});

// 选择 Provider
function selectProvider(id: string): void {
  selectedProvider.value = id;
  const provider = providers.value.find((p) => p.id === id);
  if (provider) {
    config.value = {
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl || '',
      enabled: true
    };
  }
  // 重置测试状态
  testStatus.value = 'idle';
  testErrorMsg.value = '';
}

// 保存配置
async function saveConfig(): Promise<void> {
  if (!selectedProvider.value) return;
  // TODO: 这里应该调用 API 真实保存
  // await gateway.request('config.patch', { ... })

  // 更新本地状态
  const provider = providers.value.find((p) => p.id === selectedProvider.value);
  if (provider) {
    provider.apiKey = config.value.apiKey;
    provider.baseUrl = config.value.baseUrl;
    provider.status = provider.apiKey ? 'connected' : 'disconnected';
  }
}

// 测试连通性
async function testConnection(): Promise<void> {
  testing.value = true;
  testStatus.value = 'idle';
  testErrorMsg.value = '';

  try {
    // TODO: 调用实际的连通性测试 API
    await new Promise((resolve) => setTimeout(resolve, 1500));
    testStatus.value = 'success';
  } catch (err: unknown) {
    testStatus.value = 'error';
    testErrorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    testing.value = false;
    // 3秒后恢复默认状态
    setTimeout(() => {
      if (testStatus.value === 'success') {
        testStatus.value = 'idle';
      }
    }, 3000);
  }
}

// 获取状态文本
function getStatusText(status: string): string {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'error':
      return '错误';
    default:
      return '未配置';
  }
}

onMounted(() => {
  loadProviders();
});
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧：供应商/分组 列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <!-- Tab 切换 -->
      <div class="flex border-b border-border">
        <button
          :class="[
            'flex-1 py-2.5 text-xs font-medium transition-colors',
            leftTab === 'providers'
              ? 'text-primary border-b-2 border-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="leftTab = 'providers'">
          <span class="i-carbon-cloud-service-management mr-1 inline-block h-3 w-3"></span>
          供应商
        </button>
        <button
          :class="[
            'flex-1 py-2.5 text-xs font-medium transition-colors',
            leftTab === 'groups'
              ? 'text-primary border-b-2 border-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="leftTab = 'groups'">
          <span class="i-carbon-group-objects mr-1 inline-block h-3 w-3"></span>
          模型分组
        </button>
      </div>

      <!-- 供应商列表 -->
      <div v-if="leftTab === 'providers'" class="flex-1 overflow-y-auto p-3">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-2 inline-block h-6 w-6 animate-spin"></span>
          <p class="text-sm">加载中...</p>
        </div>

        <!-- Provider 卡片 -->
        <div v-else class="flex flex-col gap-3">
          <div
            v-for="provider in providers"
            :key="provider.id"
            :class="[
              'cursor-pointer rounded-lg border p-3 transition-colors',
              selectedProvider === provider.id ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted'
            ]"
            @click="selectProvider(provider.id)">
            <!-- 头部：名称 + 选中状态 -->
            <div class="mb-1 flex items-center justify-between">
              <h3 :class="['truncate text-sm font-semibold', selectedProvider === provider.id ? 'text-primary' : '']">
                {{ provider.name }}
              </h3>
              <div
                v-if="selectedProvider === provider.id"
                class="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <span class="i-carbon-checkmark inline-block h-2.5 w-2.5 text-primary-foreground"></span>
              </div>
            </div>

            <p class="mb-2 text-xs text-muted-foreground line-clamp-1">{{ provider.type }}</p>

            <!-- 状态 + 模型数 -->
            <div class="flex items-center justify-between text-xs mt-2 pt-2 border-t border-border/50">
              <div class="flex items-center gap-1.5">
                <span
                  :class="[
                    'h-2 w-2 rounded-full',
                    provider.status === 'connected'
                      ? 'bg-green-500'
                      : provider.status === 'error'
                        ? 'bg-red-500'
                        : 'bg-gray-400'
                  ]">
                </span>
                <span
                  :class="[
                    provider.status === 'connected'
                      ? 'text-green-600'
                      : provider.status === 'error'
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                  ]">
                  {{ getStatusText(provider.status) }}
                </span>
              </div>
              <span class="text-muted-foreground">{{ provider.modelCount }} 模型</span>
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-if="providers.length === 0"
            class="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <span class="i-carbon-cloud-offline mb-2 inline-block h-8 w-8"></span>
            <p class="text-sm">未找到供应商</p>
          </div>
        </div>
      </div>

      <!-- 分组列表 -->
      <div v-else class="flex flex-1 flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span class="text-xs text-muted-foreground">{{ groups.length }} 个分组</span>
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
            @click="openNewGroupForm">
            <span class="i-carbon-add inline-block h-3 w-3"></span>
            新建
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <div v-if="groups.length === 0" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <span class="i-carbon-group-objects mb-2 inline-block h-8 w-8 opacity-40"></span>
            <p class="text-xs">暂无模型分组</p>
          </div>
          <div v-else class="flex flex-col gap-1.5">
            <div
              v-for="group in groups"
              :key="group.id"
              :class="[
                'cursor-pointer rounded-lg border px-3 py-2 transition-colors',
                selectedGroup === group.id && !showGroupForm
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent hover:bg-muted'
              ]"
              @click="selectGroup(group.id)">
              <div class="flex items-center justify-between">
                <span :class="['truncate text-xs font-semibold', selectedGroup === group.id ? 'text-primary' : '']">
                  {{ group.name }}
                </span>
                <span
                  :class="['h-1.5 w-1.5 rounded-full flex-shrink-0', group.enabled ? 'bg-green-500' : 'bg-gray-300']">
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{{ group.models.length }} 个模型</span>
                <span>·</span>
                <span>{{ group.strategy }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：配置详情 -->
    <div class="flex-1 overflow-y-auto bg-background p-6 lg:p-10">
      <!-- ===== 分组视图 ===== -->
      <template v-if="leftTab === 'groups'">
        <!-- 分组表单（新建/编辑） -->
        <div v-if="showGroupForm" class="mx-auto max-w-2xl flex flex-col gap-6">
          <div class="border-b border-border pb-4">
            <h1 class="text-xl font-bold">{{ isEditingGroup ? '编辑分组' : '新建模型分组' }}</h1>
            <p class="text-sm text-muted-foreground mt-1">通过分组让 Agent 自动在多个模型间进行负载均衡</p>
          </div>

          <div v-if="groupError" class="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {{ groupError }}
          </div>

          <div class="rounded-lg border border-border bg-card p-6 flex flex-col gap-5">
            <!-- ID -->
            <div>
              <label class="mb-1.5 block text-sm font-medium">分组 ID <span class="text-red-500">*</span></label>
              <input
                v-model="groupForm.id"
                :disabled="isEditingGroup"
                type="text"
                placeholder="my-group"
                class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed font-mono" />
              <p class="mt-1 text-xs text-muted-foreground"
                >Agent 通过 <code class="text-primary">@group:&lt;ID&gt;</code> 引用此分组</p
              >
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
              <label class="mb-1.5 block text-sm font-medium">模型列表 <span class="text-red-500">*</span></label>
              <textarea
                v-model="groupFormModelsText"
                rows="4"
                placeholder="每行一个模型 ID&#10;gpt-4o&#10;claude-3-5-sonnet-20241022&#10;qwen-plus"
                class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"></textarea>
              <p class="mt-1 text-xs text-muted-foreground"
                >每行一个完整的模型 ID（如 gpt-4o、claude-3-5-sonnet-20241022）</p
              >
            </div>
            <!-- 策略 -->
            <div>
              <label class="mb-1.5 block text-sm font-medium">负载均衡策略</label>
              <select
                v-model="groupForm.strategy"
                class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option v-for="s in STRATEGIES" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <!-- 启用开关 -->
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">启用分组</p>
                <p class="text-xs text-muted-foreground mt-0.5">禁用后 Agent 将无法使用此分组</p>
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
              class="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              @click="cancelGroupForm">
              取消
            </button>
            <button
              :disabled="groupSaving"
              class="flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
        <div v-else-if="selectedGroupInfo" class="mx-auto max-w-2xl flex flex-col gap-6">
          <div class="border-b border-border pb-4 flex items-start justify-between">
            <div>
              <h1 class="text-xl font-bold">{{ selectedGroupInfo.name }}</h1>
              <p class="text-sm text-muted-foreground mt-1 font-mono">@group:{{ selectedGroupInfo.id }}</p>
              <p v-if="selectedGroupInfo.description" class="text-sm text-muted-foreground mt-1">{{
                selectedGroupInfo.description
              }}</p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
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
                class="flex items-center gap-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 text-xs font-medium transition-colors"
                @click="openEditGroupForm(selectedGroupInfo)">
                <span class="i-carbon-edit inline-block h-3 w-3"></span>
                编辑
              </button>
            </div>
          </div>

          <!-- 基本信息 -->
          <div class="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">负载均衡策略</span>
              <span class="font-medium">{{ selectedGroupInfo.strategy }}</span>
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
            <h2 class="text-sm font-semibold mb-3">模型列表</h2>
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
                  <span class="text-sm font-mono">{{ modelId }}</span>
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
            <span class="i-carbon-group-objects inline-block h-12 w-12 mb-4 opacity-40"></span>
            <p class="text-sm">选择左侧分组查看详情，或点击「新建」创建分组</p>
          </div>
        </div>
      </template>

      <!-- ===== 供应商视图 ===== -->
      <template v-else>
        <!-- 未选中提示 -->
        <div v-if="!selectedProvider" class="flex h-full items-center justify-center text-muted-foreground">
          <div class="flex flex-col items-center text-center">
            <span class="i-carbon-settings inline-block h-12 w-12 mb-4 opacity-50"></span>
            <p class="text-sm">请在左侧选择一个供应商以进行配置</p>
          </div>
        </div>

        <!-- 详细配置内容 -->
        <div v-else class="mx-auto max-w-3xl flex flex-col gap-8">
          <!-- Header -->
          <div class="border-b border-border pb-4">
            <h1 class="text-xl font-bold">{{ selectedProviderInfo?.name }}</h1>
            <p class="text-sm text-muted-foreground mt-1">{{ selectedProviderInfo?.type }}</p>
          </div>

          <!-- Section 1: API 配置 -->
          <section>
            <h2 class="text-sm font-semibold mb-4">API 配置</h2>
            <div class="rounded-lg border border-border bg-card p-6">
              <div class="flex flex-col divide-y divide-border">
                <!-- API Key -->
                <div class="py-4">
                  <label class="mb-3 block text-sm font-medium"> API Key <span class="text-red-500">*</span> </label>
                  <input
                    v-model="config.apiKey"
                    type="password"
                    placeholder="sk-..."
                    class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>

                <!-- Base URL -->
                <div class="py-4">
                  <label class="mb-3 block text-sm font-medium"> Base URL </label>
                  <input
                    v-model="config.baseUrl"
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    class="w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>

                <div class="pt-6 pb-2 flex items-center justify-between">
                  <!-- 测试状态提示 -->
                  <div class="flex items-center gap-2">
                    <span v-if="testStatus === 'success'" class="text-sm text-green-600 flex items-center gap-1">
                      <span class="i-carbon-checkmark-outline inline-block h-4 w-4"></span>
                      连接成功
                    </span>
                    <span
                      v-if="testStatus === 'error'"
                      class="text-sm text-red-600 flex items-center gap-1"
                      :title="testErrorMsg">
                      <span class="i-carbon-warning-alt inline-block h-4 w-4"></span>
                      测试失败
                    </span>
                  </div>

                  <!-- 操作按钮组 -->
                  <div class="flex items-center gap-3">
                    <button
                      :disabled="testing"
                      class="flex items-center gap-2 rounded-md border border-border bg-background text-foreground hover:bg-muted px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                      @click="testConnection">
                      <span
                        :class="[
                          'inline-block h-4 w-4',
                          testing ? 'i-carbon-in-progress animate-spin' : 'i-carbon-flash'
                        ]"></span>
                      {{ testing ? '测试中...' : '测试连接' }}
                    </button>
                    <button
                      class="flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors"
                      @click="saveConfig">
                      <span class="i-carbon-save inline-block h-4 w-4"></span>
                      保存更改
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 2: 模型列表 -->
          <section>
            <div class="mb-4">
              <h2 class="text-sm font-semibold flex items-center gap-2">
                可用模型
                <span class="rounded bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  {{ selectedProviderInfo?.models.length || 0 }}
                </span>
              </h2>
            </div>

            <!-- 空状态 -->
            <div
              v-if="!selectedProviderInfo?.models || selectedProviderInfo.models.length === 0"
              class="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
              <span class="i-carbon-model-alt inline-block h-10 w-10 mb-3 opacity-40"></span>
              <p class="text-sm">暂无模型数据</p>
            </div>

            <!-- 模型卡片列表 -->
            <div v-else class="flex flex-col gap-3">
              <div
                v-for="model in selectedProviderInfo.models"
                :key="model.id"
                class="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
                <!-- 模型名称 -->
                <h3 class="text-sm font-semibold text-foreground mb-3">
                  {{ model.name || model.id }}
                </h3>

                <!-- 参数信息 -->
                <div v-if="model.params" class="mb-3">
                  <p class="text-xs text-muted-foreground mb-2">参数配置</p>
                  <div class="flex flex-wrap gap-2">
                    <span
                      v-for="(value, key) in model.params"
                      :key="key"
                      class="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                      <span class="font-medium text-foreground">{{ key }}:</span>
                      <span class="text-muted-foreground">{{ value }}</span>
                    </span>
                  </div>
                </div>

                <!-- 特性标签 -->
                <div v-if="model.features && model.features.length > 0">
                  <p class="text-xs text-muted-foreground mb-2">支持特性</p>
                  <div class="flex flex-wrap gap-2">
                    <span
                      v-for="feature in model.features"
                      :key="feature"
                      class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      <span class="i-carbon-checkmark inline-block h-3 w-3"></span>
                      {{ feature }}
                    </span>
                  </div>
                </div>

                <!-- 如果既没有参数也没有特性，显示模型ID -->
                <div v-if="!model.params && (!model.features || model.features.length === 0)">
                  <p class="text-xs text-muted-foreground"
                    >模型 ID: <span class="font-mono">{{ model.id }}</span></p
                  >
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
