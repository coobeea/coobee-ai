<script setup lang="ts">
/**
 * WorkersSettings - 内置服务管理设置
 *
 * 显示所有内置服务（Worker）的状态，支持启动/停止和模型配置
 * 在线模型支持 API Key / API URL 配置
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

interface WorkerStatus {
  name: string;
  label: string;
  running: boolean;
  healthy: boolean;
  port?: number;
  pid?: number;
  uptime?: number;
}

interface ModelOption {
  id: string;
  label: string;
  type: 'local' | 'online';
  description: string;
  configKey: string;
  provider?: string;
  pricing?: string;
  requiresApiKey?: boolean;
  free?: boolean;
}

interface WorkerModelDef {
  configField: string;
  options: ModelOption[];
}

const WORKER_MODELS: Record<string, WorkerModelDef> = {
  asr: {
    configField: 'model_name',
    options: [
      {
        id: 'fun-asr-nano',
        label: 'FunASR Nano',
        type: 'local',
        description: '轻量级本地模型，速度快，适合日常使用',
        configKey: 'FunAudioLLM/Fun-ASR-Nano-2512',
        provider: 'FunAudioLLM'
      },
      {
        id: 'sensevoice-small',
        label: 'SenseVoice Small',
        type: 'local',
        description: '高精度本地模型，支持 50+ 语种，情感识别',
        configKey: 'FunAudioLLM/SenseVoiceSmall',
        provider: 'FunAudioLLM'
      },
      {
        id: 'aliyun-qwen3-asr',
        label: '阿里云 Qwen3 ASR',
        type: 'online',
        description: '工业级实时语音识别，支持方言/情感识别，首包延迟极低',
        configKey: 'aliyun/qwen3-asr-flash-realtime',
        provider: '阿里云百炼',
        pricing: '按量计费',
        requiresApiKey: true
      }
    ]
  },
  tts: {
    configField: 'model_name',
    options: [
      {
        id: 'qwen3-tts',
        label: 'Qwen3 TTS',
        type: 'local',
        description: '本地语音合成，9 种音色，支持多语种和情绪指令',
        configKey: 'Qwen3-TTS-12Hz-1.7B-CustomVoice',
        provider: 'Qwen'
      },
      {
        id: 'edge-tts',
        label: 'Microsoft Edge TTS',
        type: 'online',
        description: '微软免费在线语音合成，300+ 音色，无需 API Key',
        configKey: 'edge-tts',
        provider: 'Microsoft',
        free: true
      },
      {
        id: 'aliyun-cosyvoice-v3-flash',
        label: '阿里云 CosyVoice v3 Flash',
        type: 'online',
        description: '低成本实时合成，首包延迟 <150ms，支持 SSML 和情感表达',
        configKey: 'aliyun/cosyvoice-v3-flash',
        provider: '阿里云百炼',
        pricing: '¥0.1/万字符',
        requiresApiKey: true
      },
      {
        id: 'aliyun-cosyvoice-v3-plus',
        label: '阿里云 CosyVoice v3 Plus',
        type: 'online',
        description: '最强声音复刻，48kHz 高音质输出，支持 200+ 语言',
        configKey: 'aliyun/cosyvoice-v3-plus',
        provider: '阿里云百炼',
        pricing: '¥0.2/万字符',
        requiresApiKey: true
      },
      {
        id: 'aliyun-cosyvoice-v2',
        label: '阿里云 CosyVoice v2',
        type: 'online',
        description: '支持 SSML 和 LaTeX 公式转语音，稳定可靠',
        configKey: 'aliyun/cosyvoice-v2',
        provider: '阿里云百炼',
        pricing: '¥0.1/万字符',
        requiresApiKey: true
      }
    ]
  },
  ocr: {
    configField: 'model_name',
    options: [
      {
        id: 'glm-ocr',
        label: 'GLM-OCR',
        type: 'local',
        description: '本地 OCR 模型，离线可用',
        configKey: 'GLM-OCR',
        provider: 'THUDM'
      },
      {
        id: 'paddle-ocr',
        label: 'PaddleOCR',
        type: 'local',
        description: '百度 PaddleOCR，轻量高效',
        configKey: 'PaddleOCR-V5',
        provider: 'PaddlePaddle'
      }
    ]
  }
};

const workers = ref<WorkerStatus[]>([]);
const loading = ref(true);
const operationLoading = ref<string | null>(null);

const workerConfigs = ref<Record<string, Record<string, unknown>>>({});
const configExpanded = ref<Record<string, boolean>>({});
const configSaving = ref<string | null>(null);

// API Key 输入状态
const apiKeyInputs = ref<Record<string, string>>({});
const apiUrlInputs = ref<Record<string, string>>({});
const apiKeyVisible = ref<Record<string, boolean>>({});

// 判断选中的模型是否需要 API Key
const selectedNeedsApiKey = computed(() => {
  const result: Record<string, boolean> = {};
  for (const name of Object.keys(WORKER_MODELS)) {
    const opt = getSelectedModelOption(name);
    result[name] = opt?.requiresApiKey === true;
  }
  return result;
});

async function loadWorkers(): Promise<void> {
  loading.value = true;
  try {
    const result = (await gateway.request('worker.list', {})) as {
      workers: WorkerStatus[];
    };
    workers.value = result.workers || [];
    for (const w of workers.value) {
      if (WORKER_MODELS[w.name]) {
        await loadWorkerConfig(w.name);
      }
    }
  } catch (err: unknown) {
    console.error('[WorkersSettings] Failed to load workers:', err);
    workers.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadWorkerConfig(name: string): Promise<void> {
  try {
    const result = (await gateway.request('worker.configGet', { name })) as {
      name: string;
      config: Record<string, unknown>;
    };
    workerConfigs.value[name] = result.config;
    // 同步 API Key 输入框
    apiKeyInputs.value[name] = (result.config.api_key as string) || '';
    apiUrlInputs.value[name] = (result.config.api_url as string) || '';
  } catch (err) {
    console.warn(`[WorkersSettings] Failed to load config for ${name}:`, err);
    workerConfigs.value[name] = {};
  }
}

function getSelectedModel(workerName: string): string | undefined {
  const def = WORKER_MODELS[workerName];
  if (!def) return undefined;
  const config = workerConfigs.value[workerName];
  if (!config) return undefined;
  return config[def.configField] as string | undefined;
}

function getSelectedModelOption(workerName: string): ModelOption | undefined {
  const def = WORKER_MODELS[workerName];
  if (!def) return undefined;
  const selected = getSelectedModel(workerName);
  if (!selected) return def.options[0];
  return def.options.find((o) => o.configKey === selected) ?? def.options[0];
}

function isModelSelected(workerName: string, opt: ModelOption): boolean {
  const selected = getSelectedModel(workerName);
  if (!selected) return opt === WORKER_MODELS[workerName].options[0];
  return selected === opt.configKey;
}

async function selectModel(workerName: string, option: ModelOption): Promise<void> {
  const def = WORKER_MODELS[workerName];
  if (!def) return;

  configSaving.value = workerName;
  try {
    await gateway.request('worker.configUpdate', {
      name: workerName,
      config: { [def.configField]: option.configKey }
    });
    if (!workerConfigs.value[workerName]) workerConfigs.value[workerName] = {};
    workerConfigs.value[workerName][def.configField] = option.configKey;
  } catch (err) {
    console.error(`[WorkersSettings] Failed to save config for ${workerName}:`, err);
  } finally {
    configSaving.value = null;
  }
}

async function saveApiConfig(workerName: string): Promise<void> {
  configSaving.value = workerName;
  try {
    const updates: Record<string, unknown> = {};
    if (apiKeyInputs.value[workerName] !== undefined) {
      updates.api_key = apiKeyInputs.value[workerName];
    }
    if (apiUrlInputs.value[workerName]) {
      updates.api_url = apiUrlInputs.value[workerName];
    }
    await gateway.request('worker.configUpdate', {
      name: workerName,
      config: updates
    });
    if (!workerConfigs.value[workerName]) workerConfigs.value[workerName] = {};
    Object.assign(workerConfigs.value[workerName], updates);
  } catch (err) {
    console.error(`[WorkersSettings] Failed to save API config for ${workerName}:`, err);
  } finally {
    configSaving.value = null;
  }
}

function toggleConfig(name: string): void {
  configExpanded.value[name] = !configExpanded.value[name];
}

function toggleApiKeyVisibility(name: string): void {
  apiKeyVisible.value[name] = !apiKeyVisible.value[name];
}

async function startWorker(name: string): Promise<void> {
  operationLoading.value = name;
  try {
    await gateway.request('worker.start', { name });
    await loadWorkers();
  } catch (err: unknown) {
    console.error(`[WorkersSettings] Failed to start worker ${name}:`, err);
  } finally {
    operationLoading.value = null;
  }
}

async function stopWorker(name: string): Promise<void> {
  operationLoading.value = name;
  try {
    await gateway.request('worker.stop', { name });
    await loadWorkers();
  } catch (err: unknown) {
    console.error(`[WorkersSettings] Failed to stop worker ${name}:`, err);
  } finally {
    operationLoading.value = null;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${seconds}秒`;
}

onMounted(() => {
  loadWorkers();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10">
    <div class="mx-auto max-w-3xl">
      <div class="mb-6 flex items-center justify-between">
        <h2 class="text-xl font-bold">内置服务管理</h2>
        <button
          class="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/80"
          :disabled="loading"
          @click="loadWorkers">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
      </div>

      <section>
        <h3 class="mb-4 text-sm font-semibold">服务进程</h3>
        <div class="rounded-lg border border-border bg-card">
          <div v-if="loading" class="flex items-center justify-center p-12 text-muted-foreground">
            <span class="i-carbon-in-progress mr-2 inline-block h-5 w-5 animate-spin" />
            加载中...
          </div>

          <div
            v-else-if="workers.length === 0"
            class="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <span class="i-carbon-cube inline-block h-8 w-8 opacity-30" />
            <p class="text-sm">暂无内置服务</p>
          </div>

          <div v-else class="divide-y divide-border">
            <div v-for="worker in workers" :key="worker.name" class="transition-colors">
              <!-- Worker 信息行 -->
              <div class="flex items-start justify-between gap-4 p-4 hover:bg-muted/30">
                <div class="flex-1">
                  <div class="mb-2 flex items-center gap-3">
                    <h4 class="text-sm font-semibold text-foreground">{{ worker.label }}</h4>
                    <span
                      :class="[
                        'rounded px-2 py-0.5 text-xs font-medium',
                        worker.running
                          ? worker.healthy
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                          : 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                      ]">
                      {{ worker.running ? (worker.healthy ? '运行中' : '异常') : '已停止' }}
                    </span>
                  </div>

                  <div class="flex flex-col gap-1 text-xs text-muted-foreground">
                    <div class="flex items-center gap-2">
                      <span class="font-mono">{{ worker.name }}</span>
                      <span v-if="worker.port" class="font-mono">· 端口: {{ worker.port }}</span>
                    </div>
                    <div v-if="worker.running" class="flex items-center gap-2">
                      <span v-if="worker.pid">PID: {{ worker.pid }}</span>
                      <span v-if="worker.uptime">· 运行时间: {{ formatUptime(worker.uptime) }}</span>
                    </div>
                    <!-- 当前模型 -->
                    <div v-if="WORKER_MODELS[worker.name]" class="mt-1 flex items-center gap-1.5">
                      <span class="i-carbon-model-alt inline-block h-3 w-3" />
                      <span>{{ getSelectedModelOption(worker.name)?.label || '默认' }}</span>
                      <span v-if="getSelectedModelOption(worker.name)?.provider" class="text-muted-foreground/50">
                        · {{ getSelectedModelOption(worker.name)?.provider }}
                      </span>
                      <span
                        :class="[
                          'rounded px-1.5 py-0.5 text-[10px]',
                          getSelectedModelOption(worker.name)?.type === 'online'
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-emerald-500/10 text-emerald-500'
                        ]">
                        {{ getSelectedModelOption(worker.name)?.type === 'online' ? '在线' : '本地' }}
                      </span>
                      <span
                        v-if="getSelectedModelOption(worker.name)?.free"
                        class="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-500">
                        免费
                      </span>
                    </div>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-2">
                  <button
                    v-if="WORKER_MODELS[worker.name]"
                    class="mr-1 rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                    @click="toggleConfig(worker.name)">
                    <span class="i-carbon-settings mr-1 inline-block h-3 w-3" />
                    模型
                  </button>

                  <button
                    v-if="!worker.running"
                    class="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="operationLoading === worker.name"
                    @click="startWorker(worker.name)">
                    <span
                      v-if="operationLoading === worker.name"
                      class="i-carbon-in-progress mr-1 inline-block h-3 w-3 animate-spin" />
                    <span v-else class="i-carbon-play mr-1 inline-block h-3 w-3" />
                    启动
                  </button>
                  <button
                    v-else
                    class="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                    :disabled="operationLoading === worker.name"
                    @click="stopWorker(worker.name)">
                    <span
                      v-if="operationLoading === worker.name"
                      class="i-carbon-in-progress mr-1 inline-block h-3 w-3 animate-spin" />
                    <span v-else class="i-carbon-stop mr-1 inline-block h-3 w-3" />
                    停止
                  </button>
                </div>
              </div>

              <!-- 模型配置面板 -->
              <div
                v-if="configExpanded[worker.name] && WORKER_MODELS[worker.name]"
                class="border-t border-border/50 bg-muted/20 px-4 py-3">
                <div class="mb-3 text-xs font-medium text-muted-foreground">选择模型</div>

                <!-- 本地模型 -->
                <div v-if="WORKER_MODELS[worker.name].options.some((o) => o.type === 'local')" class="mb-4">
                  <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    本地模型
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label
                      v-for="opt in WORKER_MODELS[worker.name].options.filter((o) => o.type === 'local')"
                      :key="opt.id"
                      class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors"
                      :class="
                        isModelSelected(worker.name, opt)
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-transparent hover:bg-muted/50'
                      "
                      @click="selectModel(worker.name, opt)">
                      <div
                        class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors"
                        :class="
                          isModelSelected(worker.name, opt) ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                        " />
                      <div class="flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-medium">{{ opt.label }}</span>
                          <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-500">
                            本地
                          </span>
                          <span v-if="opt.provider" class="text-[10px] text-muted-foreground/50">
                            {{ opt.provider }}
                          </span>
                        </div>
                        <p class="mt-0.5 text-[11px] text-muted-foreground">{{ opt.description }}</p>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- 在线模型 -->
                <div v-if="WORKER_MODELS[worker.name].options.some((o) => o.type === 'online')" class="mb-3">
                  <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    在线模型
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label
                      v-for="opt in WORKER_MODELS[worker.name].options.filter((o) => o.type === 'online')"
                      :key="opt.id"
                      class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors"
                      :class="
                        isModelSelected(worker.name, opt)
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-transparent hover:bg-muted/50'
                      "
                      @click="selectModel(worker.name, opt)">
                      <div
                        class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors"
                        :class="
                          isModelSelected(worker.name, opt) ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                        " />
                      <div class="flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="text-xs font-medium">{{ opt.label }}</span>
                          <span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-500">在线</span>
                          <span
                            v-if="opt.free"
                            class="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-500">
                            免费
                          </span>
                          <span v-if="opt.pricing" class="text-[10px] text-amber-500">{{ opt.pricing }}</span>
                          <span v-if="opt.provider" class="text-[10px] text-muted-foreground/50">
                            {{ opt.provider }}
                          </span>
                        </div>
                        <p class="mt-0.5 text-[11px] text-muted-foreground">{{ opt.description }}</p>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- API Key 配置区（选中需要 API Key 的在线模型时显示） -->
                <div
                  v-if="selectedNeedsApiKey[worker.name]"
                  class="mt-3 rounded-lg border border-border/50 bg-card/50 p-3">
                  <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span class="i-carbon-key inline-block h-3.5 w-3.5" />
                    API 配置
                  </div>

                  <!-- API Key -->
                  <div class="mb-2">
                    <label class="mb-1 block text-[11px] text-muted-foreground">API Key</label>
                    <div class="flex gap-2">
                      <div class="relative flex-1">
                        <input
                          v-model="apiKeyInputs[worker.name]"
                          :type="apiKeyVisible[worker.name] ? 'text' : 'password'"
                          placeholder="输入 API Key（如 sk-xxx）"
                          class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none" />
                        <button
                          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                          @click="toggleApiKeyVisibility(worker.name)">
                          <span
                            :class="
                              apiKeyVisible[worker.name]
                                ? 'i-carbon-view-off inline-block h-3.5 w-3.5'
                                : 'i-carbon-view inline-block h-3.5 w-3.5'
                            " />
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- API URL（可选） -->
                  <div class="mb-3">
                    <label class="mb-1 block text-[11px] text-muted-foreground">
                      API 地址
                      <span class="text-muted-foreground/40">（可选，留空使用默认地址）</span>
                    </label>
                    <input
                      v-model="apiUrlInputs[worker.name]"
                      type="text"
                      placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/inference"
                      class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none" />
                  </div>

                  <button
                    class="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                    :disabled="configSaving === worker.name"
                    @click="saveApiConfig(worker.name)">
                    <span
                      v-if="configSaving === worker.name"
                      class="i-carbon-in-progress mr-1 inline-block h-3 w-3 animate-spin" />
                    保存 API 配置
                  </button>
                </div>

                <!-- 保存提示 -->
                <div v-if="configSaving === worker.name" class="mt-2 flex items-center gap-1 text-[11px] text-primary">
                  <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin" />
                  保存中...
                </div>
                <p class="mt-2 text-[11px] text-muted-foreground/60">切换模型后需重启服务才能生效</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
