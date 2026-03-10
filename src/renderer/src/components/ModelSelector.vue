<script setup lang="ts">
/**
 * ModelSelector - 可复用的模型选择器组件
 *
 * 特性：
 * - 按 Provider 分组展示所有可用模型
 * - 支持搜索和能力过滤
 * - 可选的模型详情和能力标签展示
 */

import { computed, onMounted, ref } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import { SelectInput } from '@/components/Form';
import type { SelectOptionGroup } from '@/components/Form/types';

// 模型接口定义
interface Model {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  params?: Record<string, unknown>;
  features?: string[];
  text_flag?: boolean;
  vision_flag?: boolean;
  embedding_flag?: boolean;
  reranking_flag?: boolean;
  function_calling_flag?: boolean;
  reasoning_flag?: boolean;
  web_search_flag?: boolean;
}

interface Provider {
  id: string;
  name: string;
  models: Model[];
}

// Props 定义
interface Props {
  modelValue?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  showDetails?: boolean;
  showCapabilities?: boolean;
  // 过滤选项
  filterByCapabilities?: {
    text?: boolean;
    vision?: boolean;
    embedding?: boolean;
    reranking?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
    webSearch?: boolean;
  };
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  placeholder: '请选择一个模型',
  disabled: false,
  required: false,
  showDetails: false,
  showCapabilities: true
});

// Emits 定义
interface Emits {
  (e: 'update:modelValue', value: string): void;
  (e: 'change', model: Model | undefined): void;
}

const emit = defineEmits<Emits>();

interface ModelGroup {
  id: string;
  name: string;
  description?: string;
  models: string[];
  strategy: string;
  enabled: boolean;
}

// 状态
const providers = ref<Provider[]>([]);
const modelGroups = ref<ModelGroup[]>([]);
const loading = ref(true);

// 加载所有 Providers、模型和模型分组
async function loadProviders(): Promise<void> {
  loading.value = true;
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
          models: (providerCfg.models as Model[]) || []
        };
      });
    }

    // 加载模型分组
    const groupsConfig = modelsConfig?.groups as Record<string, unknown> | undefined;
    if (groupsConfig) {
      modelGroups.value = Object.entries(groupsConfig)
        .map(([id, cfg]) => {
          const g = cfg as Record<string, unknown>;
          return {
            id,
            name: (g.name as string) || id,
            description: g.description as string | undefined,
            models: (g.models as string[]) || [],
            strategy: (g.strategy as string) || 'round-robin',
            enabled: g.enabled !== false
          };
        })
        .filter((g) => g.enabled);
    }
  } catch (err: unknown) {
    console.error('[ModelSelector] Failed to load providers:', err);
  } finally {
    loading.value = false;
  }
}

// 过滤模型
const filterModel = (model: Model): boolean => {
  if (!props.filterByCapabilities) return true;

  const filter = props.filterByCapabilities;

  if (filter.text && !model.text_flag) return false;
  if (filter.vision && !model.vision_flag) return false;
  if (filter.embedding && !model.embedding_flag) return false;
  if (filter.reranking && !model.reranking_flag) return false;
  if (filter.functionCalling && !model.function_calling_flag) return false;
  if (filter.reasoning && !model.reasoning_flag) return false;
  if (filter.webSearch && !model.web_search_flag) return false;

  return true;
};

// 生成分组选项
const groupedOptions = computed((): SelectOptionGroup[] => {
  const groups: SelectOptionGroup[] = [];

  // 模型分组（@group:xxx 引用）
  if (modelGroups.value.length > 0) {
    groups.push({
      label: '模型分组',
      options: modelGroups.value.map((g) => ({
        label: g.name,
        value: `@group:${g.id}`,
        description: g.description || `${g.models.length} 个模型 · ${g.strategy}`,
        icon: 'i-carbon-group-objects'
      }))
    });
  }

  // 单个模型（按 Provider 分组）
  const providerGroups = providers.value
    .map((provider) => ({
      label: provider.name,
      options: provider.models
        .filter((model) => filterModel(model))
        .map((model) => {
          let description = model.description || '';
          if (model.features && model.features.length > 0) {
            const featuresText = model.features.join(' • ');
            description = description ? `${description} | ${featuresText}` : featuresText;
          }

          // 使用 provider/model 格式作为 value，保证全局唯一性
          const fullModelId = `${provider.id}/${model.id}`;

          return {
            label: model.name,
            value: fullModelId,
            description,
            icon: 'i-carbon-machine-learning-model',
            model: { ...model, provider: provider.name }
          };
        })
    }))
    .filter((group) => group.options.length > 0);

  return [...groups, ...providerGroups];
});

// 获取当前选中的模型（或分组伪模型）
const selectedModel = computed((): Model | undefined => {
  if (!props.modelValue) return undefined;

  // @group:xxx 格式 → 返回分组伪模型
  if (props.modelValue.startsWith('@group:')) {
    const groupId = props.modelValue.slice(7);
    const group = modelGroups.value.find((g) => g.id === groupId);
    if (group) {
      return {
        id: props.modelValue,
        name: group.name,
        description: group.description || `${group.models.length} 个模型 · ${group.strategy}`
      };
    }
    return { id: props.modelValue, name: `分组: ${groupId}` };
  }

  // 解析 provider/model 格式
  const parts = props.modelValue.split('/');
  if (parts.length !== 2) return undefined;

  const [providerId, modelId] = parts;
  const provider = providers.value.find((p) => p.id === providerId);
  if (!provider) return undefined;

  const model = provider.models.find((m) => m.id === modelId);
  if (model) {
    return { ...model, provider: provider.name };
  }

  return undefined;
});

// 处理模型变化
const handleModelChange = (value: string | number | (string | number)[] | undefined): void => {
  const fullModelId = value as string;
  emit('update:modelValue', fullModelId);

  // 查找对应的模型（解析 provider/model 格式）
  let foundModel: Model | undefined;
  if (fullModelId) {
    const parts = fullModelId.split('/');
    if (parts.length === 2) {
      const [providerId, modelId] = parts;
      const provider = providers.value.find((p) => p.id === providerId);
      if (provider) {
        const model = provider.models.find((m) => m.id === modelId);
        if (model) {
          foundModel = { ...model, provider: provider.name };
        }
      }
    }
  }

  emit('change', foundModel);
};

onMounted(() => {
  loadProviders();
});
</script>

<template>
  <div class="model-selector">
    <SelectInput
      :model-value="modelValue"
      :label="label"
      :placeholder="loading ? '加载中...' : placeholder"
      :options="groupedOptions"
      :disabled="disabled || loading"
      :required="required"
      :error="error"
      :readonly="false"
      :searchable="true"
      grouped
      @update:model-value="handleModelChange" />

    <!-- 可选的模型详情显示 -->
    <div v-if="showDetails && selectedModel" class="mt-3 p-3 bg-card rounded-lg border border-border">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-sm font-semibold text-foreground">{{ selectedModel.name }}</span>
        <span class="text-xs text-muted-foreground">({{ selectedModel.provider }})</span>
      </div>

      <div v-if="selectedModel.description" class="text-xs text-muted-foreground mb-3">
        {{ selectedModel.description }}
      </div>

      <!-- 模型能力标签 -->
      <div v-if="showCapabilities" class="flex flex-wrap gap-2">
        <span
          v-if="selectedModel.text_flag"
          class="px-2 py-1 text-xs bg-blue-500/10 text-blue-600 rounded-full font-medium">
          文本
        </span>
        <span
          v-if="selectedModel.vision_flag"
          class="px-2 py-1 text-xs bg-green-500/10 text-green-600 rounded-full font-medium">
          视觉
        </span>
        <span
          v-if="selectedModel.embedding_flag"
          class="px-2 py-1 text-xs bg-purple-500/10 text-purple-600 rounded-full font-medium">
          嵌入
        </span>
        <span
          v-if="selectedModel.reranking_flag"
          class="px-2 py-1 text-xs bg-purple-500/10 text-purple-600 rounded-full font-medium">
          重排序
        </span>
        <span
          v-if="selectedModel.function_calling_flag"
          class="px-2 py-1 text-xs bg-orange-500/10 text-orange-600 rounded-full font-medium">
          函数调用
        </span>
        <span
          v-if="selectedModel.reasoning_flag"
          class="px-2 py-1 text-xs bg-indigo-500/10 text-indigo-600 rounded-full font-medium">
          推理
        </span>
        <span
          v-if="selectedModel.web_search_flag"
          class="px-2 py-1 text-xs bg-teal-500/10 text-teal-600 rounded-full font-medium">
          网络搜索
        </span>
      </div>

      <!-- 自定义特性标签 -->
      <div v-if="selectedModel.features && selectedModel.features.length > 0" class="flex flex-wrap gap-2 mt-2">
        <span
          v-for="feature in selectedModel.features"
          :key="feature"
          class="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full font-medium">
          {{ feature }}
        </span>
      </div>
    </div>
  </div>
</template>
