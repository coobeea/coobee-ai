<script setup lang="ts">
/**
 * TerminalPanel — 终端输出面板
 *
 * 展示 exec 工具的实时输出和后台进程状态。
 * 放置在 WorkbenchPanel 下方（可折叠），提供类似 IDE 底部终端的体验。
 */

import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useChatStore, type ExecOutputEntry } from '@/stores/chat';
import {
  useProcessState,
  initProcessWs,
  refreshProcessList,
  type ProcessInfo,
  type ProcessOutputLine
} from '@/composables/useProcessWs';

const chatStore = useChatStore();
const { processes, outputBuffer } = useProcessState();

const activeTab = ref<'output' | 'processes'>('output');
const outputEl = ref<HTMLDivElement | null>(null);
const autoScroll = ref(true);
const selectedProcessId = ref<string | null>(null);

const execOutputs = computed<ExecOutputEntry[]>(() => chatStore.execOutputs);

const filteredProcessOutput = computed<ProcessOutputLine[]>(() => {
  if (!selectedProcessId.value) return outputBuffer.value;
  return outputBuffer.value.filter((l) => l.processId === selectedProcessId.value);
});

const runningProcesses = computed(() => processes.value.filter((p) => p.status === 'running'));

function scrollToBottom(): void {
  if (autoScroll.value && outputEl.value) {
    nextTick(() => {
      if (outputEl.value) {
        outputEl.value.scrollTop = outputEl.value.scrollHeight;
      }
    });
  }
}

watch(
  () => execOutputs.value.length,
  () => scrollToBottom()
);

watch(
  () => outputBuffer.value.length,
  () => scrollToBottom()
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function statusClass(status: ProcessInfo['status']): string {
  switch (status) {
    case 'running':
      return 'text-green-600';
    case 'exited':
      return 'text-gray-500';
    case 'killed':
      return 'text-amber-600';
    case 'error':
      return 'text-red-600';
    default:
      return 'text-gray-400';
  }
}

function statusLabel(status: ProcessInfo['status']): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'exited':
      return '已退出';
    case 'killed':
      return '已终止';
    case 'error':
      return '错误';
    default:
      return status;
  }
}

function viewProcessOutput(processId: string): void {
  selectedProcessId.value = processId;
  activeTab.value = 'output';
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  initProcessWs();
  refreshTimer = setInterval(refreshProcessList, 10000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="terminal-panel">
    <!-- 标签栏 -->
    <div class="terminal-tabs">
      <div class="flex items-center gap-1">
        <button class="terminal-tab" :class="{ active: activeTab === 'output' }" @click="activeTab = 'output'">
          <span class="i-carbon-terminal inline-block h-3 w-3"></span>
          <span>输出</span>
          <span v-if="execOutputs.length > 0" class="tab-badge">{{ execOutputs.length }}</span>
        </button>
        <button
          class="terminal-tab"
          :class="{ active: activeTab === 'processes' }"
          @click="
            activeTab = 'processes';
            refreshProcessList();
          ">
          <span class="i-carbon-task inline-block h-3 w-3"></span>
          <span>进程</span>
          <span v-if="runningProcesses.length > 0" class="tab-badge running">{{ runningProcesses.length }}</span>
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button v-if="selectedProcessId" class="terminal-action" title="查看全部输出" @click="selectedProcessId = null">
          <span class="i-carbon-filter-remove inline-block h-3 w-3"></span>
        </button>
        <button
          class="terminal-action"
          :title="autoScroll ? '自动滚动: 开' : '自动滚动: 关'"
          :class="{ active: autoScroll }"
          @click="autoScroll = !autoScroll">
          <span class="i-carbon-arrow-down inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 输出内容 -->
    <div v-if="activeTab === 'output'" ref="outputEl" class="terminal-output">
      <template v-if="execOutputs.length > 0 || filteredProcessOutput.length > 0">
        <!-- exec 工具输出 -->
        <div v-for="(entry, i) in execOutputs" :key="'exec-' + i" class="output-line">
          <span class="output-time">{{ formatTime(entry.timestamp) }}</span>
          <span
            class="output-tag"
            :class="{
              'tag-progress': entry.type === 'progress',
              'tag-result': entry.type === 'result'
            }">
            {{ entry.type === 'progress' ? '进度' : '结果' }}
          </span>
          <span class="output-content" :class="{ 'is-command': entry.content.startsWith('$') }">{{
            entry.content
          }}</span>
        </div>

        <!-- 后台进程输出 -->
        <div v-for="(line, i) in filteredProcessOutput" :key="'proc-' + i" class="output-line">
          <span class="output-time">{{ formatTime(line.timestamp) }}</span>
          <span class="output-tag tag-process">{{ line.processId }}</span>
          <span class="output-content">{{ line.text }}</span>
        </div>
      </template>
      <div v-else class="terminal-empty">
        <span class="i-carbon-terminal inline-block h-5 w-5 text-gray-300"></span>
        <span class="text-xs text-gray-400">等待命令执行输出...</span>
      </div>
    </div>

    <!-- 进程列表 -->
    <div v-if="activeTab === 'processes'" class="terminal-output">
      <template v-if="processes.length > 0">
        <div v-for="proc in processes" :key="proc.processId" class="process-item">
          <div class="flex items-center gap-2">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              :class="proc.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'">
            </span>
            <span class="text-[11px] font-mono font-medium" :class="statusClass(proc.status)">
              {{ proc.processId }}
            </span>
            <span class="text-[11px] text-gray-500">{{ statusLabel(proc.status) }}</span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
            <span class="font-mono truncate max-w-[240px]" :title="proc.command">{{ proc.command }}</span>
            <span>{{ formatDuration((proc.exitCode !== undefined ? 0 : Date.now()) - proc.startedAt) }}</span>
          </div>
          <div class="mt-1 flex items-center gap-1">
            <button class="process-action" @click="viewProcessOutput(proc.processId)">
              <span class="i-carbon-view inline-block h-3 w-3"></span>
              查看输出
            </button>
          </div>
        </div>
      </template>
      <div v-else class="terminal-empty">
        <span class="i-carbon-task inline-block h-5 w-5 text-gray-300"></span>
        <span class="text-xs text-gray-400">暂无后台进程</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  border-top: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--background));
  min-height: 0;
  flex: 1;
}

.terminal-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
  background: hsl(var(--muted) / 0.3);
  flex-shrink: 0;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  border-radius: 4px;
  transition: all 0.1s ease;
}

.terminal-tab:hover {
  color: hsl(var(--foreground) / 0.8);
  background: hsl(var(--muted) / 0.5);
}

.terminal-tab.active {
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  font-weight: 500;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  font-size: 9px;
  font-weight: 600;
  background: hsl(var(--muted) / 0.6);
  color: hsl(var(--muted-foreground) / 0.7);
}

.tab-badge.running {
  background: hsl(142 76% 36% / 0.15);
  color: hsl(142 76% 36%);
}

.terminal-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.1s ease;
}

.terminal-action:hover {
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--foreground) / 0.8);
}

.terminal-action.active {
  color: hsl(var(--primary));
}

.terminal-output {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.6;
}

.output-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 0;
}

.output-time {
  flex-shrink: 0;
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.35);
}

.output-tag {
  flex-shrink: 0;
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 500;
}

.tag-progress {
  background: hsl(217 91% 60% / 0.1);
  color: hsl(217 91% 60%);
}

.tag-result {
  background: hsl(142 76% 36% / 0.1);
  color: hsl(142 76% 36%);
}

.tag-process {
  background: hsl(280 67% 55% / 0.1);
  color: hsl(280 67% 55%);
}

.output-content {
  color: hsl(var(--foreground) / 0.8);
  word-break: break-all;
  white-space: pre-wrap;
}

.output-content.is-command {
  color: hsl(217 91% 60%);
  font-weight: 500;
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  min-height: 60px;
}

.process-item {
  padding: 6px 4px;
  border-bottom: 1px solid hsl(var(--border) / 0.1);
}

.process-item:last-child {
  border-bottom: none;
}

.process-action {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.1s ease;
}

.process-action:hover {
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--primary));
}
</style>
