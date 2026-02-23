<script setup lang="ts">
/**
 * WorkersSettings - 内置服务管理设置
 *
 * 显示所有内置服务（Worker）的状态，支持启动/停止操作
 */

import { ref, onMounted } from 'vue';
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

const workers = ref<WorkerStatus[]>([]);
const loading = ref(true);
const operationLoading = ref<string | null>(null);

// 加载 Worker 状态
async function loadWorkers(): Promise<void> {
  loading.value = true;
  try {
    // 获取所有 Worker 状态
    const result = (await gateway.request('worker.list', {})) as {
      workers: Array<{
        name: string;
        label: string;
        running: boolean;
        healthy: boolean;
        port?: number;
        pid?: number;
        uptime?: number;
      }>;
    };

    workers.value = result.workers || [];
  } catch (err: unknown) {
    console.error('[WorkersSettings] Failed to load workers:', err);
    workers.value = [];
  } finally {
    loading.value = false;
  }
}

// 启动 Worker
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

// 停止 Worker
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

// 格式化运行时间
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

onMounted(() => {
  loadWorkers();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10">
    <div class="mx-auto max-w-3xl">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">内置服务管理</h2>
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
          :disabled="loading"
          @click="loadWorkers">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
      </div>

      <section>
        <h3 class="text-sm font-semibold mb-4">服务进程</h3>
        <div class="rounded-lg border border-border bg-card">
          <div v-if="loading" class="p-12 flex items-center justify-center text-muted-foreground">
            <span class="i-carbon-in-progress inline-block h-5 w-5 animate-spin mr-2" />
            加载中...
          </div>

          <div
            v-else-if="workers.length === 0"
            class="p-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <span class="i-carbon-cube inline-block h-8 w-8 opacity-30" />
            <p class="text-sm">暂无内置服务</p>
          </div>

          <div v-else class="divide-y divide-border">
            <div v-for="worker in workers" :key="worker.name" class="p-4 hover:bg-muted/30 transition-colors">
              <div class="flex items-start justify-between gap-4">
                <!-- Worker 信息 -->
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <h4 class="font-semibold text-sm text-foreground">{{ worker.label }}</h4>
                    <span
                      :class="[
                        'px-2 py-0.5 rounded text-xs font-medium',
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
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-2">
                  <button
                    v-if="!worker.running"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="operationLoading === worker.name"
                    @click="startWorker(worker.name)">
                    <span
                      v-if="operationLoading === worker.name"
                      class="i-carbon-in-progress inline-block h-3 w-3 animate-spin mr-1" />
                    <span v-else class="i-carbon-play inline-block h-3 w-3 mr-1" />
                    启动
                  </button>

                  <button
                    v-else
                    class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="operationLoading === worker.name"
                    @click="stopWorker(worker.name)">
                    <span
                      v-if="operationLoading === worker.name"
                      class="i-carbon-in-progress inline-block h-3 w-3 animate-spin mr-1" />
                    <span v-else class="i-carbon-stop inline-block h-3 w-3 mr-1" />
                    停止
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
