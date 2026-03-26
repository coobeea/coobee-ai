<script setup lang="ts">
/**
 * ModelSettings - 模型供应商管理
 *
 * 左右分栏：
 * - 左侧：供应商列表（含启用状态）
 * - 右侧：供应商配置详情（API Key / Base URL / 启用开关）
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

interface Model {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  features?: string[];
}

interface Provider {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error';
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models: Model[];
  modelCount: number;
  websites?: Record<string, string>;
}

const providers = ref<Provider[]>([]);
const selectedProvider = ref<string>('');
const loading = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const saveStatus = ref<'idle' | 'success' | 'error'>('idle');

const config = ref({
  apiKey: '',
  baseUrl: '',
  enabled: false
});

const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testErrorMsg = ref('');

async function loadProviders(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = result.models as Record<string, unknown> | undefined;
    const providersConfig = modelsConfig?.providers as Record<string, unknown> | undefined;

    if (providersConfig) {
      providers.value = Object.entries(providersConfig).map(([id, cfg]) => {
        const p = cfg as Record<string, unknown>;
        const hasKey = !!(p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 0);
        const enabled = p.enabled !== false;
        return {
          id,
          name: (p.name as string) || id,
          description: p.description as string | undefined,
          type: (p.api as string) || 'OpenAI Compatible',
          status: hasKey && enabled ? ('connected' as const) : ('disconnected' as const),
          enabled,
          apiKey: p.apiKey as string | undefined,
          baseUrl: p.baseUrl as string | undefined,
          models: (p.models as Model[]) || [],
          modelCount: (p.models as Model[])?.length || 0,
          websites: p.websites as Record<string, string> | undefined
        };
      });

      if (providers.value.length > 0 && !selectedProvider.value) {
        selectProvider(providers.value[0].id);
      }
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

const selectedProviderInfo = computed(() => {
  return providers.value.find((p) => p.id === selectedProvider.value);
});

function selectProvider(id: string): void {
  selectedProvider.value = id;
  const provider = providers.value.find((p) => p.id === id);
  if (provider) {
    config.value = {
      apiKey: '',
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled
    };
  }
  testStatus.value = 'idle';
  testErrorMsg.value = '';
  saveStatus.value = 'idle';
}

async function saveConfig(): Promise<void> {
  if (!selectedProvider.value) return;

  saving.value = true;
  saveStatus.value = 'idle';

  try {
    const providerId = selectedProvider.value;

    // 1. 保存 API Key 到 secrets.json5（仅当用户输入了新值时）
    if (config.value.apiKey) {
      await gateway.request('config.saveProviderKey', {
        providerId,
        apiKey: config.value.apiKey
      });
    }

    // 2. 保存 Base URL 到 coobee.json5
    if (config.value.baseUrl) {
      await gateway.request('config.updateProviderBaseUrl', {
        providerId,
        baseUrl: config.value.baseUrl
      });
    }

    // 3. 保存启用状态
    await gateway.request('config.toggleProvider', {
      providerId,
      enabled: config.value.enabled
    });

    saveStatus.value = 'success';

    // 重新加载以更新状态
    await loadProviders();
    selectProvider(providerId);

    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (err: unknown) {
    saveStatus.value = 'error';
    console.error('保存配置失败:', err);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(): Promise<void> {
  if (!selectedProvider.value) return;
  config.value.enabled = !config.value.enabled;

  try {
    await gateway.request('config.toggleProvider', {
      providerId: selectedProvider.value,
      enabled: config.value.enabled
    });
    const provider = providers.value.find((p) => p.id === selectedProvider.value);
    if (provider) {
      provider.enabled = config.value.enabled;
      provider.status = provider.enabled && provider.apiKey ? 'connected' : 'disconnected';
    }
  } catch (err: unknown) {
    config.value.enabled = !config.value.enabled;
    console.error('切换启用状态失败:', err);
  }
}

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
    setTimeout(() => {
      if (testStatus.value === 'success') {
        testStatus.value = 'idle';
      }
    }, 3000);
  }
}

function getStatusText(provider: Provider): string {
  if (!provider.enabled) return '未启用';
  if (provider.apiKey) return '已配置';
  return '未配置';
}

function getStatusColor(provider: Provider): string {
  if (!provider.enabled) return 'bg-gray-400';
  if (provider.apiKey) return 'bg-green-500';
  return 'bg-orange-400';
}

function getStatusTextColor(provider: Provider): string {
  if (!provider.enabled) return 'text-muted-foreground';
  if (provider.apiKey) return 'text-green-600';
  return 'text-orange-600';
}

onMounted(() => {
  loadProviders();
});
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧：供应商列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <div class="border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold">模型供应商</h2>
        <p class="mt-0.5 text-[10px] text-muted-foreground">{{ providers.length }} 个供应商</p>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
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
                <span :class="['h-2 w-2 rounded-full', getStatusColor(provider)]"></span>
                <span :class="getStatusTextColor(provider)">
                  {{ getStatusText(provider) }}
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
    </div>

    <!-- 右侧：配置详情 -->
    <div class="flex-1 overflow-y-auto bg-background p-6 lg:p-10">
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
        <div class="flex items-start justify-between border-b border-border pb-4">
          <div>
            <h1 class="text-xl font-bold">{{ selectedProviderInfo?.name }}</h1>
            <p class="text-sm text-muted-foreground mt-1">{{
              selectedProviderInfo?.description || selectedProviderInfo?.type
            }}</p>
            <div v-if="selectedProviderInfo?.websites" class="mt-2 flex gap-3">
              <a
                v-if="selectedProviderInfo.websites.official"
                :href="selectedProviderInfo.websites.official"
                target="_blank"
                class="text-xs text-primary hover:underline"
                >官网</a
              >
              <a
                v-if="selectedProviderInfo.websites.apiKey"
                :href="selectedProviderInfo.websites.apiKey"
                target="_blank"
                class="text-xs text-primary hover:underline"
                >获取 API Key</a
              >
              <a
                v-if="selectedProviderInfo.websites.docs"
                :href="selectedProviderInfo.websites.docs"
                target="_blank"
                class="text-xs text-primary hover:underline"
                >文档</a
              >
            </div>
          </div>
          <!-- 启用开关 -->
          <button
            :class="[
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              config.enabled ? 'bg-primary' : 'bg-muted'
            ]"
            role="switch"
            :aria-checked="config.enabled"
            @click="toggleEnabled">
            <span
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                config.enabled ? 'translate-x-5' : 'translate-x-0'
              ]" />
          </button>
        </div>

        <!-- Section 1: API 配置 -->
        <section>
          <h2 class="text-sm font-semibold mb-4">API 配置</h2>
          <div class="rounded-lg border border-border bg-card p-6">
            <div class="flex flex-col divide-y divide-border">
              <!-- API Key -->
              <div class="py-4">
                <label class="mb-2 block text-sm font-medium"> API Key <span class="text-red-500">*</span> </label>
                <p class="mb-3 text-xs text-muted-foreground">
                  {{ selectedProviderInfo?.apiKey ? '已配置（输入新值覆盖，留空保持不变）' : '未配置，请输入 API Key' }}
                </p>
                <input
                  v-model="config.apiKey"
                  type="password"
                  :placeholder="selectedProviderInfo?.apiKey ? '已配置 · 输入新值覆盖' : 'sk-...'"
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
                <!-- 状态提示 -->
                <div class="flex items-center gap-2">
                  <span v-if="saveStatus === 'success'" class="text-sm text-green-600 flex items-center gap-1">
                    <span class="i-carbon-checkmark-outline inline-block h-4 w-4"></span>
                    保存成功
                  </span>
                  <span v-if="saveStatus === 'error'" class="text-sm text-red-600 flex items-center gap-1">
                    <span class="i-carbon-warning-alt inline-block h-4 w-4"></span>
                    保存失败
                  </span>
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
                    :disabled="saving"
                    class="flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    @click="saveConfig">
                    <span
                      :class="[
                        'inline-block h-4 w-4',
                        saving ? 'i-carbon-in-progress animate-spin' : 'i-carbon-save'
                      ]"></span>
                    {{ saving ? '保存中...' : '保存更改' }}
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
    </div>
  </div>
</template>
