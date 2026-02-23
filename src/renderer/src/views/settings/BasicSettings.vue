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
const execApprovalMode = ref<'auto' | 'always' | 'never'>('auto');
const loading = ref(true);
const saving = ref(false);
const savingApproval = ref(false);

// 加载当前配置
async function loadSettings(): Promise<void> {
  loading.value = true;
  try {
    const result = await gateway.request<Record<string, unknown>>('config.getAll');

    // 加载默认模型
    const modelsConfig = result.models as Record<string, unknown> | undefined;
    const defaults = modelsConfig?.defaults as Record<string, unknown> | undefined;
    const modelDefaults = defaults?.model as Record<string, string> | undefined;
    defaultModel.value = modelDefaults?.primary || '';

    // 加载审批策略
    const security = result.security as Record<string, unknown> | undefined;
    const approvals = security?.approvals as Record<string, unknown> | undefined;
    execApprovalMode.value = (approvals?.exec as 'auto' | 'always' | 'never') || 'auto';
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to load settings:', err);
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

// 保存审批策略
async function saveApprovalMode(): Promise<void> {
  savingApproval.value = true;
  try {
    await gateway.request('config.patch', {
      partial: {
        security: {
          approvals: {
            exec: execApprovalMode.value
          }
        }
      }
    });
    console.log('[BasicSettings] Approval mode saved:', execApprovalMode.value);
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to save approval mode:', err);
  } finally {
    savingApproval.value = false;
  }
}

onMounted(() => {
  loadSettings();
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

            <!-- 命令审批策略 -->
            <div class="py-4">
              <div class="mb-3 flex items-center justify-between">
                <div>
                  <p class="font-medium text-foreground">命令执行审批</p>
                  <p class="text-xs text-muted-foreground mt-1">Agent 执行 Shell 命令时的安全审批策略</p>
                </div>
                <span v-if="savingApproval" class="text-xs text-muted-foreground flex items-center gap-1">
                  <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin"></span>
                  保存中...
                </span>
              </div>
              <div class="flex flex-col gap-2">
                <label
                  v-for="mode in [
                    { value: 'auto', label: '自动判断', desc: '根据命令安全性自动决定是否审批（推荐）' },
                    { value: 'never', label: '从不审批', desc: '所有命令自动执行（风险较高）' },
                    { value: 'always', label: '总是审批', desc: '所有命令都需要手动确认（最安全）' }
                  ]"
                  :key="mode.value"
                  :class="[
                    'flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer transition-colors',
                    execApprovalMode === mode.value ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'
                  ]">
                  <input
                    v-model="execApprovalMode"
                    type="radio"
                    :value="mode.value"
                    :disabled="loading || savingApproval"
                    class="mt-0.5 cursor-pointer"
                    @change="saveApprovalMode" />
                  <div class="flex-1">
                    <p class="text-sm font-medium text-foreground">{{ mode.label }}</p>
                    <p class="text-xs text-muted-foreground mt-0.5">{{ mode.desc }}</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
