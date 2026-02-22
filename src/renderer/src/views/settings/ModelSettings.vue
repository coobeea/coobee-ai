<script setup lang="ts">
/**
 * ModelSettings - 模型设置组件
 *
 * 左右分栏：
 * - 左侧：供应商列表
 * - 右侧：供应商配置详情
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

interface Model {
  id: string;
  name: string;
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
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
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
    <!-- 左侧：Provider 列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <!-- 头部区域 -->
      <div class="p-4 border-b border-border">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold flex items-center">
            <span class="i-carbon-cloud-service-management mr-2 inline-block h-4 w-4 text-primary"></span>
            AI 供应商
          </h2>
          <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {{ providers.length }}
          </span>
        </div>
      </div>

      <!-- Provider 列表 -->
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
        <div class="border-b border-border pb-4 flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold">{{ selectedProviderInfo?.name }}</h1>
            <p class="text-sm text-muted-foreground mt-1">{{ selectedProviderInfo?.type }}</p>
          </div>
          <!-- 连通性测试（极简版：只有一个按钮） -->
          <div class="flex items-center gap-3">
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
            <button
              :disabled="testing"
              class="flex items-center gap-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              @click="testConnection">
              <span
                :class="[
                  'inline-block h-4 w-4',
                  testing ? 'i-carbon-in-progress animate-spin' : 'i-carbon-flash'
                ]"></span>
              {{ testing ? '测试中...' : '测试连接' }}
            </button>
          </div>
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

              <div class="pt-6 pb-2 flex justify-end">
                <button
                  class="flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors"
                  @click="saveConfig">
                  <span class="i-carbon-save inline-block h-4 w-4"></span>
                  保存更改
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Section 2: 模型列表 -->
        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-semibold flex items-center gap-2">
              可用模型
              <span class="rounded bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {{ selectedProviderInfo?.models.length || 0 }}
              </span>
            </h2>
            <button class="text-sm text-primary hover:underline">刷新列表</button>
          </div>

          <div class="rounded-lg border border-border bg-card overflow-hidden">
            <div
              v-if="!selectedProviderInfo?.models || selectedProviderInfo.models.length === 0"
              class="py-8 text-center text-muted-foreground">
              <p class="text-sm">暂无模型数据</p>
            </div>
            <div v-else>
              <div
                class="grid grid-cols-2 gap-4 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                <div>模型 ID</div>
                <div>名称</div>
              </div>
              <div class="divide-y divide-border">
                <div
                  v-for="model in selectedProviderInfo.models"
                  :key="model.id"
                  class="grid grid-cols-2 gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
                  <div class="font-mono text-sm">{{ model.id }}</div>
                  <div class="text-sm text-muted-foreground">{{ model.name || model.id }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
