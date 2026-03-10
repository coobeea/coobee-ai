<script setup lang="ts">
/**
 * RemoteAccessSettings — 远程访问 / 手机扫码
 *
 * 展示局域网访问地址和二维码，方便用户通过手机控制 Agent。
 */

import { ref, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

interface NetworkInfo {
  host: string;
  port: number;
  localIPs: string[];
  primaryIP: string;
  isLanEnabled: boolean;
  baseUrl: string;
  qrDataUrl: string;
}

const networkInfo = ref<NetworkInfo | null>(null);
const loading = ref(true);
const error = ref('');
const copied = ref(false);

async function loadNetworkInfo(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await gateway.request<NetworkInfo>('system.networkInfo');
    networkInfo.value = result;
  } catch (err: unknown) {
    console.error('[RemoteAccess] Failed to load network info:', err);
    error.value = '无法获取网络信息，请确认服务已启动';
  } finally {
    loading.value = false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback: execCommand for Electron environments where navigator.clipboard may fail
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

const copiedPort = ref(false);

async function copyUrl(): Promise<void> {
  if (!networkInfo.value?.baseUrl) return;
  const ok = await copyToClipboard(networkInfo.value.baseUrl);
  if (ok) {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}

async function copyPort(): Promise<void> {
  if (!networkInfo.value?.port) return;
  const ok = await copyToClipboard(String(networkInfo.value.port));
  if (ok) {
    copiedPort.value = true;
    setTimeout(() => {
      copiedPort.value = false;
    }, 2000);
  }
}

onMounted(() => {
  loadNetworkInfo();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-xl font-bold mb-2">远程访问</h2>
      <p class="text-sm text-muted-foreground mb-6">通过手机或其他设备扫码访问，远程控制你的 Agent</p>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <span class="i-carbon-in-progress inline-block h-5 w-5 animate-spin text-muted-foreground"></span>
        <span class="ml-2 text-sm text-muted-foreground">加载网络信息...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <span class="i-carbon-warning-alt inline-block h-8 w-8 text-destructive mb-2"></span>
        <p class="text-sm text-destructive">{{ error }}</p>
        <button
          class="mt-3 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="loadNetworkInfo">
          重试
        </button>
      </div>

      <!-- Content -->
      <template v-else-if="networkInfo">
        <!-- LAN Not Enabled Warning -->
        <div
          v-if="!networkInfo.isLanEnabled"
          class="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-start gap-3">
          <span class="i-carbon-warning inline-block h-5 w-5 text-yellow-500 shrink-0 mt-0.5"></span>
          <div>
            <p class="text-sm font-medium text-foreground">局域网访问未开启</p>
            <p class="text-xs text-muted-foreground mt-1">
              当前服务绑定在 <code class="rounded bg-muted px-1 py-0.5">{{ networkInfo.host }}</code
              >，仅限本机访问。如需远程访问，请在 <code class="rounded bg-muted px-1 py-0.5">.env</code> 文件中设置
              <code class="rounded bg-muted px-1 py-0.5">VITE_SERVER_HOST=0.0.0.0</code> 后重启应用。
            </p>
          </div>
        </div>

        <!-- QR Code Section -->
        <section class="mb-6">
          <h3 class="text-sm font-semibold mb-4">扫码访问</h3>
          <div class="rounded-lg border border-border bg-card p-6">
            <div class="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <!-- QR Code -->
              <div class="shrink-0">
                <div v-if="networkInfo.qrDataUrl" class="rounded-xl border border-border bg-white p-3 shadow-sm">
                  <img :src="networkInfo.qrDataUrl" alt="远程访问二维码" class="h-48 w-48" />
                </div>
                <div
                  v-else
                  class="flex h-48 w-48 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
                  <span class="text-xs text-muted-foreground">二维码生成失败</span>
                </div>
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0 text-center sm:text-left">
                <p class="text-sm text-muted-foreground mb-4">使用手机浏览器扫描二维码，即可在移动端控制 Agent 对话</p>

                <!-- URL -->
                <div class="mb-4">
                  <label class="text-xs font-medium text-muted-foreground mb-1.5 block">访问地址</label>
                  <div class="flex items-center gap-2">
                    <code
                      class="flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm font-mono text-foreground select-all truncate">
                      {{ networkInfo.baseUrl }}
                    </code>
                    <button
                      class="shrink-0 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                      @click="copyUrl">
                      <span
                        :class="[copied ? 'i-carbon-checkmark' : 'i-carbon-copy', 'inline-block h-3.5 w-3.5']"></span>
                      {{ copied ? '已复制' : '复制' }}
                    </button>
                  </div>
                </div>

                <!-- Status badges -->
                <div class="flex flex-wrap gap-2">
                  <span
                    :class="[
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                      networkInfo.isLanEnabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                    ]">
                    <span
                      :class="[
                        'inline-block h-1.5 w-1.5 rounded-full',
                        networkInfo.isLanEnabled ? 'bg-green-500' : 'bg-muted-foreground'
                      ]"></span>
                    {{ networkInfo.isLanEnabled ? '局域网已开启' : '仅本机访问' }}
                  </span>
                  <button
                    class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                    title="点击复制端口号"
                    @click="copyPort">
                    <span
                      v-if="copiedPort"
                      :class="[
                        copiedPort ? 'i-carbon-checkmark text-green-500' : '',
                        'inline-block h-3 w-3 transition-colors'
                      ]"></span>
                    {{ copiedPort ? '已复制' : `端口 ${networkInfo.port}` }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Network Details -->
        <section v-if="networkInfo.localIPs.length > 0">
          <h3 class="text-sm font-semibold mb-4">网络详情</h3>
          <div class="rounded-lg border border-border bg-card p-6">
            <div class="flex flex-col divide-y divide-border text-sm">
              <div class="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span class="text-muted-foreground">绑定地址</span>
                <code class="rounded bg-muted px-2 py-0.5 text-xs font-mono">{{ networkInfo.host }}</code>
              </div>
              <div class="flex items-center justify-between py-3">
                <span class="text-muted-foreground">服务端口</span>
                <code class="rounded bg-muted px-2 py-0.5 text-xs font-mono">{{ networkInfo.port }}</code>
              </div>
              <div
                v-for="(ip, idx) in networkInfo.localIPs"
                :key="ip"
                class="flex items-center justify-between py-3 last:pb-0">
                <span class="text-muted-foreground">
                  局域网 IP{{ networkInfo.localIPs.length > 1 ? ` #${idx + 1}` : '' }}
                </span>
                <code class="rounded bg-muted px-2 py-0.5 text-xs font-mono">{{ ip }}</code>
              </div>
            </div>
          </div>
        </section>

        <!-- Tips -->
        <section class="mt-6">
          <div class="rounded-lg border border-border bg-muted/30 p-4">
            <h4 class="text-xs font-semibold text-muted-foreground mb-2">使用提示</h4>
            <ul class="space-y-1.5 text-xs text-muted-foreground">
              <li class="flex items-start gap-2">
                <span class="i-carbon-checkmark-outline inline-block h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500"></span>
                确保手机和电脑在同一局域网（Wi-Fi）下
              </li>
              <li class="flex items-start gap-2">
                <span class="i-carbon-checkmark-outline inline-block h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500"></span>
                支持任何现代浏览器，无需安装 App
              </li>
              <li class="flex items-start gap-2">
                <span class="i-carbon-checkmark-outline inline-block h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500"></span>
                多设备可同时连接，实时同步对话状态
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
