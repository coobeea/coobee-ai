<script setup lang="ts">
/**
 * BasicSettings - 基本配置组件
 */

import { ref, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import ModelSelector from '@/components/ModelSelector.vue';

interface Model {
  id: string;
  name: string;
  provider?: string;
}

const defaultModel = ref('');
const loading = ref(true);
const saving = ref(false);

// 加载当前默认模型
async function loadDefaultModel(): Promise<void> {
  loading.value = true;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');
    const modelsConfig = result.models as Record<string, unknown> | undefined;
    const defaults = modelsConfig?.defaults as Record<string, unknown> | undefined;
    const modelDefaults = defaults?.model as Record<string, string> | undefined;
    defaultModel.value = modelDefaults?.primary || '';
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to load default model:', err);
  } finally {
    loading.value = false;
  }
}

// 处理默认模型变化
function handleDefaultModelChange(model: Model | undefined): void {
  if (model) {
    saveDefaultModel();
  }
}

// 保存默认模型
async function saveDefaultModel(): Promise<void> {
  saving.value = true;
  try {
    await gateway.request('config.patch', {
      partial: {
        models: {
          defaults: {
            model: {
              primary: defaultModel.value
            }
          }
        }
      }
    });
    console.log('[BasicSettings] Default model saved:', defaultModel.value);
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to save default model:', err);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadDefaultModel();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-xl font-bold mb-6">基本配置</h2>

      <section>
        <h3 class="text-sm font-semibold mb-4">常规设置</h3>
        <div class="rounded-lg border border-border bg-card p-6">
          <div class="flex flex-col divide-y divide-border text-sm">
            <!-- 开机启动 -->
            <div class="flex items-center justify-between py-4">
              <div>
                <p class="font-medium text-foreground">开机自启动</p>
                <p class="text-xs text-muted-foreground mt-1">登录系统时自动启动应用服务</p>
              </div>
              <div class="h-5 w-9 rounded-full bg-muted cursor-pointer flex items-center p-0.5 border border-border">
                <div class="h-4 w-4 rounded-full bg-background shadow-sm"></div>
              </div>
            </div>

            <!-- 默认模型 -->
            <div class="py-4">
              <div class="mb-3 flex items-center justify-between">
                <div>
                  <p class="font-medium text-foreground">默认模型</p>
                  <p class="text-xs text-muted-foreground mt-1">对话时默认使用的 AI 模型</p>
                </div>
                <span v-if="saving" class="text-xs text-muted-foreground flex items-center gap-1">
                  <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin"></span>
                  保存中...
                </span>
              </div>
              <ModelSelector
                v-model="defaultModel"
                placeholder="请选择默认模型"
                :disabled="loading || saving"
                :show-details="true"
                :show-capabilities="true"
                @change="handleDefaultModelChange" />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
