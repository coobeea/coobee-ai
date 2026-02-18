<script setup lang="ts">
/**
 * SettingsView — 设置页面
 *
 * 提供配置管理、模型选择、Provider 管理的 UI 入口。
 * 通过 Gateway RPC 与后端 config / provider 系统交互。
 */

import { ref, onMounted, computed } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

// ---- 状态 ----

const configData = ref<Record<string, unknown> | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const editingJson = ref('');
const isEditing = ref(false);
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');

// ---- 加载配置 ----

async function loadConfig(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');
    configData.value = result;
    editingJson.value = JSON.stringify(result, null, 2);
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
    console.warn('[SettingsView] config.getAll failed (config system may not be initialized):', err);
  } finally {
    loading.value = false;
  }
}

// ---- 保存配置 ----

async function saveConfig(): Promise<void> {
  if (!isEditing.value) return;
  saveStatus.value = 'saving';
  try {
    const parsed = JSON.parse(editingJson.value) as Record<string, unknown>;
    await gateway.request('config.patch', { partial: parsed });
    configData.value = parsed;
    isEditing.value = false;
    saveStatus.value = 'saved';
    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (err: unknown) {
    saveStatus.value = 'error';
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function startEditing(): void {
  editingJson.value = JSON.stringify(configData.value, null, 2);
  isEditing.value = true;
}

function cancelEditing(): void {
  isEditing.value = false;
  editingJson.value = JSON.stringify(configData.value, null, 2);
}

// 计算属性：从配置中提取显示值
const defaultModel = computed(() => {
  const models = configData.value?.models as Record<string, unknown> | undefined;
  const defaults = models?.defaults as Record<string, unknown> | undefined;
  const model = defaults?.model as Record<string, string> | undefined;
  return model?.primary ?? 'openai/gpt-4o';
});

const providersList = computed(() => {
  const models = configData.value?.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, unknown> | undefined;
  return providers ? Object.keys(providers).join(', ') || '无' : '使用内置默认';
});

const queueMode = computed(() => {
  const messages = configData.value?.messages as Record<string, unknown> | undefined;
  const queue = messages?.queue as Record<string, unknown> | undefined;
  return (queue?.mode as string) ?? 'followup';
});

const maxQueueSize = computed(() => {
  const messages = configData.value?.messages as Record<string, unknown> | undefined;
  const queue = messages?.queue as Record<string, unknown> | undefined;
  return (queue?.cap as number) ?? 20;
});

const dropPolicy = computed(() => {
  const messages = configData.value?.messages as Record<string, unknown> | undefined;
  const queue = messages?.queue as Record<string, unknown> | undefined;
  return (queue?.dropPolicy as string) ?? 'old';
});

onMounted(() => {
  loadConfig();
});
</script>

<template>
  <div class="flex h-full flex-col bg-[#f7f7f8]">
    <!-- 标题栏 -->
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-gray-200/60 px-6">
      <div class="flex items-center gap-2">
        <span class="i-carbon-settings inline-block h-4 w-4 text-gray-500"></span>
        <h1 class="text-sm font-semibold text-gray-700">设置</h1>
      </div>
      <router-link
        to="/agent"
        class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-200 hover:text-gray-700">
        <span class="i-carbon-arrow-left inline-block h-3 w-3"></span>
        返回
      </router-link>
    </div>

    <div class="flex-1 overflow-y-auto px-6 py-6">
      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center gap-2 text-sm text-gray-400">
        <span class="i-carbon-in-progress inline-block h-4 w-4 animate-spin"></span>
        加载配置...
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <span class="i-carbon-warning-alt mt-0.5 inline-block h-4 w-4 shrink-0 text-red-500"></span>
        <div>
          <p class="text-xs font-medium text-red-700">加载配置失败</p>
          <p class="mt-0.5 text-xs text-red-600">{{ error }}</p>
          <p class="mt-1 text-[10px] text-red-400"> 配置系统可能尚未初始化。请确保 coobee.json5 文件存在。 </p>
        </div>
      </div>

      <template v-if="configData && !loading">
        <!-- 快速设置区域 -->
        <div class="space-y-6">
          <!-- 模型配置 -->
          <section>
            <h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <span class="i-carbon-machine-learning-model inline-block h-3.5 w-3.5"></span>
              模型配置
            </h2>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="grid grid-cols-2 gap-4">
                <!-- 默认模型 -->
                <div>
                  <label class="mb-1 block text-[10px] font-medium text-gray-500">默认模型</label>
                  <div class="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700">
                    {{ defaultModel }}
                  </div>
                </div>
                <!-- Provider 列表 -->
                <div>
                  <label class="mb-1 block text-[10px] font-medium text-gray-500">已配置 Provider</label>
                  <div class="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                    {{ providersList }}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 消息管线配置 -->
          <section>
            <h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <span class="i-carbon-flow inline-block h-3.5 w-3.5"></span>
              消息管线
            </h2>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <label class="mb-1 block text-[10px] font-medium text-gray-500">队列模式</label>
                  <div class="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700">
                    {{ queueMode }}
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-[10px] font-medium text-gray-500">最大队列深度</label>
                  <div class="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700">
                    {{ maxQueueSize }}
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-[10px] font-medium text-gray-500">丢弃策略</label>
                  <div class="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700">
                    {{ dropPolicy }}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- JSON 编辑器 -->
          <section>
            <div class="mb-3 flex items-center justify-between">
              <h2 class="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <span class="i-carbon-code inline-block h-3.5 w-3.5"></span>
                配置源码 (coobee.json5)
              </h2>
              <div class="flex gap-2">
                <button
                  v-if="!isEditing"
                  class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-[10px] font-medium text-gray-600 transition hover:bg-gray-200"
                  @click="startEditing">
                  <span class="i-carbon-edit inline-block h-3 w-3"></span>
                  编辑
                </button>
                <template v-else>
                  <button
                    class="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-primary/90"
                    @click="saveConfig">
                    <span class="i-carbon-save inline-block h-3 w-3"></span>
                    保存
                  </button>
                  <button
                    class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-[10px] font-medium text-gray-600 transition hover:bg-gray-200"
                    @click="cancelEditing">
                    取消
                  </button>
                </template>
                <span v-if="saveStatus === 'saved'" class="flex items-center gap-1 text-[10px] text-emerald-500">
                  <span class="i-carbon-checkmark inline-block h-3 w-3"></span>
                  已保存
                </span>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white">
              <textarea
                v-model="editingJson"
                class="h-80 w-full resize-y rounded-lg bg-white p-4 font-mono text-[11px] leading-relaxed text-gray-700 outline-none"
                :readonly="!isEditing"
                :class="isEditing ? 'bg-white' : 'bg-gray-50/50 text-gray-500'"
                spellcheck="false"></textarea>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
