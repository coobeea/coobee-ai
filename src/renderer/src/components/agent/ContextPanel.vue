<script setup lang="ts">
/**
 * ContextPanel — 任务上下文栏（紧凑单行）
 *
 * 一行高度展示：Agent 名称 + 运行模式 + 模型选择器。
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useAgentsStore, type AgentEntry } from '@/stores/agents';
import { useThreadsStore, type AgentType } from '@/stores/threads';
import { gateway } from '@/plugins/gatewaySetup';

const props = defineProps<{
  threadId: string;
}>();

const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

// ==================== 模型选择器 ====================
interface ModelItem {
  value: string;
  label: string;
  provider: string;
}
const flatModelList = ref<ModelItem[]>([]);
const showModelSelector = ref(false);
const modelSelectorRef = ref<HTMLElement | null>(null);

const currentThread = computed(() => threadsStore.threads.find((t) => t.id === props.threadId));

const currentAgent = computed<AgentEntry | null>(() => {
  const agentId = currentThread.value?.agentId;
  if (!agentId) return null;
  return agentsStore.agents.find((a) => a.id === agentId) ?? null;
});

const agentType = computed<AgentType>(() => currentThread.value?.agentType ?? 'agent');

const agentTypeLabel = computed(() => {
  switch (agentType.value) {
    case 'agent':
      return '自由模式';
    case 'orchestrator':
      return '编排模式';
    case 'swarm':
      return '群体模式';
    case 'quality-loop':
      return '质量闭环';
    case 'discussion':
      return '讨论模式';
    default:
      return '自由模式';
  }
});

const agentTypeIcon = computed(() => {
  switch (agentType.value) {
    case 'agent':
      return 'i-carbon-bot';
    case 'orchestrator':
      return 'i-carbon-flow';
    case 'swarm':
      return 'i-carbon-network-3';
    case 'quality-loop':
      return 'i-carbon-renew';
    case 'discussion':
      return 'i-carbon-chat';
    default:
      return 'i-carbon-bot';
  }
});

const selectedModel = computed(() => {
  return currentThread.value?.overrideModel ?? '';
});

const displayModelName = computed(() => {
  if (!selectedModel.value) return '默认模型';
  const found = flatModelList.value.find((m) => m.value === selectedModel.value);
  return found?.label ?? selectedModel.value;
});

async function loadModelList(): Promise<void> {
  try {
    const data = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = data?.models as Record<string, unknown> | undefined;
    if (!modelsConfig) return;

    const providersConfig = modelsConfig.providers as Record<string, unknown> | undefined;
    if (!providersConfig) return;

    const items: ModelItem[] = [];
    for (const [providerKey, providerVal] of Object.entries(providersConfig)) {
      const provider = providerVal as Record<string, unknown>;

      // 只加载已激活的 provider
      if (provider.enabled !== true) continue;

      const providerName = (provider.name as string) ?? providerKey;
      const models = provider.models as Array<Record<string, unknown>> | undefined;

      if (!Array.isArray(models)) continue;

      for (const model of models) {
        const modelId = model.id as string;
        const modelName = (model.name as string) ?? modelId;
        items.push({
          value: `${providerKey}/${modelId}`,
          label: modelName,
          provider: providerName
        });
      }
    }
    flatModelList.value = items;
  } catch (err) {
    console.warn('[ContextPanel] Failed to load models:', err);
  }
}

async function selectModel(modelValue: string): Promise<void> {
  try {
    console.log('[ContextPanel] Selecting model:', modelValue || 'default', 'for thread:', props.threadId);

    const success = await threadsStore.updateThread(props.threadId, {
      overrideModel: modelValue || undefined
    });

    if (success) {
      console.log('[ContextPanel] Model updated successfully, new model:', currentThread.value?.overrideModel);
      showModelSelector.value = false;
    } else {
      console.error('[ContextPanel] Failed to update model - API returned false');
    }
  } catch (err) {
    console.error('[ContextPanel] Failed to update thread model:', err);
  }
}

// 点击外部关闭弹窗
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as Node;
  if (modelSelectorRef.value && !modelSelectorRef.value.contains(target)) {
    showModelSelector.value = false;
  }
}

// 监听弹窗状态，添加/移除外部点击监听
watch(showModelSelector, (open) => {
  if (open) {
    setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
  } else {
    document.removeEventListener('mousedown', handleClickOutside);
  }
});

onMounted(() => {
  if (agentsStore.agents.length === 0) {
    agentsStore.fetchAgents();
  }
  loadModelList();
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<template>
  <!-- 单行 Context Bar -->
  <div class="context-bar">
    <!-- 左：Agent 信息 -->
    <div class="agent-info">
      <span :class="agentTypeIcon" class="agent-icon inline-block h-3 w-3" />
      <span class="agent-name">{{ currentAgent?.name ?? '默认 Agent' }}</span>
      <span class="agent-mode">{{ agentTypeLabel }}</span>
    </div>

    <!-- 右：模型选择器 -->
    <div ref="modelSelectorRef" class="model-selector-area">
      <button class="model-selector-btn" @click="showModelSelector = !showModelSelector">
        <span class="i-carbon-model inline-block h-3 w-3"></span>
        <span class="model-name">{{ displayModelName }}</span>
        <span class="i-carbon-chevron-down inline-block h-2.5 w-2.5"></span>
      </button>

      <!-- 模型列表弹窗 -->
      <div v-if="showModelSelector" class="model-selector-popup">
        <div class="model-option" :class="{ 'is-selected': !selectedModel }" @click="selectModel('')">
          <div class="model-option-label">默认模型</div>
          <div class="model-option-desc">跟随 Agent 配置</div>
        </div>
        <div
          v-for="model in flatModelList"
          :key="model.value"
          class="model-option"
          :class="{ 'is-selected': selectedModel === model.value }"
          @click="selectModel(model.value)">
          <div class="model-option-label">{{ model.label }}</div>
          <div class="model-option-desc">{{ model.provider }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- Context Bar（单行） --- */
.context-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid hsl(var(--border) / 0.25);
  background: hsl(var(--surface) / 0.3);
  flex-shrink: 0;
}

/* --- Agent info（左） --- */
.agent-info {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.agent-icon {
  color: hsl(var(--muted-foreground) / 0.5);
  flex-shrink: 0;
}

.agent-name {
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-mode {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.5);
  white-space: nowrap;
  flex-shrink: 0;
}

/* --- 模型选择器（右） --- */
.model-selector-area {
  position: relative;
  flex-shrink: 0;
  margin-left: 8px;
}

.model-selector-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--primary) / 0.65);
  background: hsl(var(--primary) / 0.07);
  border: 1px solid hsl(var(--primary) / 0.12);
  transition: all 0.12s ease;
  cursor: pointer;
}

.model-selector-btn:hover {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary) / 0.9);
  border-color: hsl(var(--primary) / 0.2);
}

.model-name {
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-selector-popup {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  max-width: 300px;
  max-height: 300px;
  overflow-y: auto;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  box-shadow: 0 4px 12px hsl(var(--foreground) / 0.1);
  z-index: 100;
}

.model-option {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
  transition: background 0.1s;
}

.model-option:last-child {
  border-bottom: none;
}

.model-option:hover {
  background: hsl(var(--accent));
}

.model-option.is-selected {
  background: hsl(var(--primary) / 0.1);
}

.model-option-label {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.model-option-desc {
  font-size: 9px;
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
}
</style>
