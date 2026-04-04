<script setup lang="ts">
/**
 * TerminalPanel — 终端面板（重构版）
 *
 * 三个 Tab：
 *   1. 终端 — 真正的 xterm.js PTY 终端，支持交互式命令
 *   2. 输出 — exec 工具的实时输出（只读文本流）
 *   3. 进程 — 后台进程列表及状态
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
import { useTerminal, initTerminalWs } from '@/composables/useTerminal';

// ==================== Props ====================
const props = defineProps<{
  threadId: string;
}>();

// ==================== Store & Refs ====================
const chatStore = useChatStore();
const state = chatStore.getState(props.threadId);
const { processes, outputBuffer } = useProcessState();
const {
  terminals,
  activeTerminalId,
  createTerminal,
  destroyTerminal,
  attachToContainer,
  showTerminal,
  fitAllTerminals
} = useTerminal();

const activeTab = ref<'terminal' | 'output' | 'processes'>('terminal');
const outputEl = ref<HTMLDivElement | null>(null);
const terminalContainerEl = ref<HTMLDivElement | null>(null);
const autoScroll = ref(true);
const selectedProcessId = ref<string | null>(null);

// ResizeObserver 和定时器变量
let resizeObserver: ResizeObserver | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const execOutputs = computed<ExecOutputEntry[]>(() => state.value.execOutputs);

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

// ==================== 终端管理 ====================

const isCreatingTerminal = ref(false);

async function handleCreateTerminal(): Promise<void> {
  if (isCreatingTerminal.value) return;
  isCreatingTerminal.value = true;

  try {
    const term = await createTerminal();
    if (term && terminalContainerEl.value) {
      await nextTick();
      await attachToContainer(term.id, terminalContainerEl.value);
      showTerminal(term.id);
    }
  } finally {
    isCreatingTerminal.value = false;
  }
}

async function handleDestroyTerminal(id: string): Promise<void> {
  await destroyTerminal(id);
  if (activeTerminalId.value) {
    showTerminal(activeTerminalId.value);
  }
}

async function switchTerminal(id: string): Promise<void> {
  activeTerminalId.value = id;
  await nextTick();

  const term = terminals.value.find((t) => t.id === id);
  if (term && terminalContainerEl.value) {
    if (!term.xterm) {
      await attachToContainer(id, terminalContainerEl.value);
    }
    showTerminal(id);
  }
}

watch(activeTab, async (tab) => {
  if (tab === 'terminal') {
    await nextTick();
    if (activeTerminalId.value) {
      // 等待 DOM 完全渲染后再适配终端尺寸
      const id = activeTerminalId.value;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (id) showTerminal(id);
          fitAllTerminals();
        });
      });
    }
  }
});

// 使用 ResizeObserver 让终端自适应大小
function setupResizeObserver(): void {
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (activeTab.value === 'terminal') {
      // 延迟一点执行，确保容器尺寸已经稳定
      requestAnimationFrame(() => {
        fitAllTerminals();
      });
    }
  });
  if (terminalContainerEl.value) {
    resizeObserver.observe(terminalContainerEl.value);
  }
}

// 关键修复：监听容器可见性变化，确保折叠后展开时正确初始化
let lastVisibleHeight = 0;

function checkContainerVisibility(): void {
  if (!terminalContainerEl.value) return;

  const currentHeight = terminalContainerEl.value.clientHeight;
  const isVisible = currentHeight > 0 && terminalContainerEl.value.offsetParent !== null;

  // 从不可见到可见的转变，需要重新适配
  if (isVisible && lastVisibleHeight === 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAllTerminals();
        if (activeTerminalId.value) {
          showTerminal(activeTerminalId.value);
        }
      });
    });
  }

  lastVisibleHeight = isVisible ? currentHeight : 0;
}

onMounted(() => {
  initProcessWs();
  initTerminalWs();
  refreshTimer = setInterval(refreshProcessList, 10000);

  nextTick(() => {
    setupResizeObserver();
    // 初始检查
    checkContainerVisibility();
  });

  if (terminals.value.length === 0) {
    handleCreateTerminal();
  }

  // 使用 MutationObserver 监听 DOM 可见性变化
  const observer = new MutationObserver(() => {
    checkContainerVisibility();
  });

  if (terminalContainerEl.value) {
    observer.observe(terminalContainerEl.value, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (resizeObserver) resizeObserver.disconnect();
});
</script>

<template>
  <div class="terminal-panel">
    <!-- 标签栏 -->
    <div class="terminal-tabs">
      <div class="flex items-center gap-1">
        <button class="terminal-tab" :class="{ active: activeTab === 'terminal' }" @click="activeTab = 'terminal'">
          <span class="i-carbon-terminal inline-block h-3 w-3"></span>
          <span>终端</span>
          <span v-if="terminals.length > 0" class="tab-badge terminal-badge">{{ terminals.length }}</span>
        </button>
        <button class="terminal-tab" :class="{ active: activeTab === 'output' }" @click="activeTab = 'output'">
          <span class="i-carbon-data-vis-1 inline-block h-3 w-3"></span>
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
        <!-- 终端 Tab 的操作按钮 -->
        <template v-if="activeTab === 'terminal'">
          <!-- 终端切换下拉 -->
          <div v-if="terminals.length > 1" class="terminal-switcher">
            <select
              class="terminal-select"
              :value="activeTerminalId"
              @change="switchTerminal(($event.target as HTMLSelectElement).value)">
              <option v-for="t in terminals" :key="t.id" :value="t.id">{{ t.id }} ({{ t.shell }})</option>
            </select>
          </div>
          <button class="terminal-action" title="新建终端" :disabled="isCreatingTerminal" @click="handleCreateTerminal">
            <span class="i-carbon-add inline-block h-3 w-3"></span>
          </button>
          <button
            v-if="activeTerminalId"
            class="terminal-action"
            title="关闭当前终端"
            @click="handleDestroyTerminal(activeTerminalId)">
            <span class="i-carbon-close inline-block h-3 w-3"></span>
          </button>
        </template>
        <!-- 输出 Tab 的操作按钮 -->
        <template v-if="activeTab === 'output'">
          <button
            v-if="selectedProcessId"
            class="terminal-action"
            title="查看全部输出"
            @click="selectedProcessId = null">
            <span class="i-carbon-filter-remove inline-block h-3 w-3"></span>
          </button>
          <button
            class="terminal-action"
            :title="autoScroll ? '自动滚动: 开' : '自动滚动: 关'"
            :class="{ active: autoScroll }"
            @click="autoScroll = !autoScroll">
            <span class="i-carbon-arrow-down inline-block h-3 w-3"></span>
          </button>
        </template>
      </div>
    </div>

    <!-- 终端内容 -->
    <div v-show="activeTab === 'terminal'" ref="terminalContainerEl" class="xterm-container">
      <div v-if="terminals.length === 0 && !isCreatingTerminal" class="terminal-empty">
        <span class="i-carbon-terminal inline-block h-5 w-5 text-gray-300"></span>
        <span class="text-xs text-gray-400">点击 + 创建终端</span>
      </div>
    </div>

    <!-- 输出内容 -->
    <div v-if="activeTab === 'output'" ref="outputEl" class="terminal-output">
      <template v-if="execOutputs.length > 0 || filteredProcessOutput.length > 0">
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

.tab-badge.terminal-badge {
  background: hsl(217 91% 60% / 0.15);
  color: hsl(217 91% 60%);
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

.terminal-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.terminal-switcher {
  display: flex;
  align-items: center;
}

.terminal-select {
  appearance: none;
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border) / 0.3);
  border-radius: 4px;
  font-size: 10px;
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  color: hsl(var(--foreground) / 0.7);
  padding: 1px 16px 1px 6px;
  height: 18px;
  cursor: pointer;
}

.xterm-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 2px;
  background-color: #ffffff;
}

.terminal-output {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.6;
  background-color: #ffffff;
  color: #1e1e1e;
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

<style>
.xterm-container .xterm {
  height: 100%;
}

.xterm-container .xterm-viewport {
  overflow-y: auto !important;
}
</style>
