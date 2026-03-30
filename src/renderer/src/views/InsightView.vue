<script setup lang="ts">
/**
 * InsightView — 实时洞察主视图
 *
 * 支持录音 + 手动文本输入两种数据采集方式
 */
import { ref, computed, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAudioRecorder } from '@/composables/useAudioRecorder';
import DimensionRenderer from '@/components/insight/DimensionRenderer.vue';
import SnapshotTimeline from '@/components/insight/SnapshotTimeline.vue';
import * as insightApi from '@/api/insight';
import type {
  AnalysisTemplate,
  InsightSession,
  AnalysisSnapshot,
  AnalysisResult,
  DimensionChange,
  SessionConfig
} from '@shared/types/insight';

const router = useRouter();

// ==================== State ====================

const templates = ref<AnalysisTemplate[]>([]);
const sessions = ref<InsightSession[]>([]);
const activeSession = ref<InsightSession | null>(null);
const snapshots = ref<AnalysisSnapshot[]>([]);
const activeSnapshotSeq = ref<number | undefined>(undefined);
const transcript = ref('');
const latestResult = ref<AnalysisResult | null>(null);
const latestChanges = ref<DimensionChange[]>([]);

const showTemplateSelector = ref(false);
const selectedTemplateId = ref('');
const loading = ref(false);
const tab = ref<'active' | 'history'>('active');
const inputMode = ref<'record' | 'text'>('text');
const manualText = ref('');
const copySuccess = ref('');
const showConfigPanel = ref(false);
const configPrompt = ref('');
const showTemplateEditor = ref(false);
const editingTemplate = ref<AnalysisTemplate | null>(null);
const editTemplateName = ref('');
const editTemplateDesc = ref('');
const editTemplatePrompt = ref('');

const currentTemplate = computed<AnalysisTemplate | null>(() => {
  if (!activeSession.value) return null;
  return templates.value.find((t) => t.id === activeSession.value!.templateId) ?? null;
});

const isRecording = computed(() => activeSession.value?.status === 'recording');
const isPaused = computed(() => activeSession.value?.status === 'paused');
const isAnalyzing = computed(() => activeSession.value?.status === 'analyzing');
const hasSession = computed(() => !!activeSession.value);

const triggerLabel = computed(() => {
  const strategy = currentTemplate.value?.refreshStrategy;
  if (!strategy) return '';
  const labels: Record<string, string> = {
    smart: '智能',
    content: '内容驱动',
    interval: '定时',
    silence: '静默',
    hybrid: '混合',
    manual: '手动'
  };
  const mode = labels[strategy.trigger] || strategy.trigger;
  if (strategy.trigger === 'smart' || strategy.trigger === 'content') {
    const debounce = (strategy.debounceMs ?? 3000) / 1000;
    return `${mode} · ${debounce}s防抖`;
  }
  if (strategy.trigger === 'interval' || strategy.trigger === 'hybrid') {
    return `${mode} · ${strategy.intervalSeconds ?? 45}s`;
  }
  return mode;
});

const elapsedTime = ref('00:00:00');
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

let lastPartialLength = 0;

// ==================== Audio Recorder ====================

const audioRecorder = useAudioRecorder({
  onPartialResult: (text: string) => {
    if (!activeSession.value) return;
    const delta = text.substring(lastPartialLength);
    lastPartialLength = text.length;
    if (delta) {
      transcript.value += delta;
      insightApi.appendTranscript(activeSession.value.id, delta).catch(() => {});
    }
  },
  onSilence: () => {
    if (!activeSession.value) return;
    insightApi.notifySilence(activeSession.value.id).catch(() => {});
  }
});

// ==================== Lifecycle ====================

async function init(): Promise<void> {
  loading.value = true;
  try {
    templates.value = await insightApi.listTemplates();
    sessions.value = await insightApi.listSessions();
    const active = await insightApi.getActiveSession();
    if (active && active.status !== 'completed') {
      activeSession.value = active;
      transcript.value = active.transcript || '';
      latestResult.value = active.latestResult ?? null;
      snapshots.value = await insightApi.getSnapshots(active.id);
      if (snapshots.value.length) {
        activeSnapshotSeq.value = snapshots.value[snapshots.value.length - 1].sequence;
      }
      startElapsedTimer();
    }
  } catch (err) {
    console.error('[InsightView] Init failed:', err);
  } finally {
    loading.value = false;
  }
}

init();

onUnmounted(() => {
  stopElapsedTimer();
  if (audioRecorder.isRecording.value) {
    audioRecorder.stopRecording();
    audioRecorder.disconnect();
  }
});

// ==================== Session Actions ====================

async function startNewSession(): Promise<void> {
  if (!selectedTemplateId.value) return;
  try {
    const session = await insightApi.startSession(selectedTemplateId.value);
    activeSession.value = session;
    transcript.value = '';
    latestResult.value = null;
    latestChanges.value = [];
    snapshots.value = [];
    activeSnapshotSeq.value = undefined;
    showTemplateSelector.value = false;
    tab.value = 'active';
    lastPartialLength = 0;

    if (inputMode.value === 'record') {
      await audioRecorder.connect();
      await audioRecorder.startRecording();
    }
    startElapsedTimer();
    startPolling();

    const tpl = templates.value.find((t) => t.id === selectedTemplateId.value);
    if (tpl) {
      configPrompt.value = tpl.analysisPrompt;
    }
  } catch (err) {
    console.error('[InsightView] Start failed:', err);
  }
}

async function pauseCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  if (inputMode.value === 'record') {
    audioRecorder.stopRecording();
  }
  const updated = await insightApi.pauseSession(activeSession.value.id);
  if (updated) activeSession.value = updated;
}

async function resumeCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  if (inputMode.value === 'record') {
    await audioRecorder.startRecording();
  }
  const updated = await insightApi.resumeSession(activeSession.value.id);
  if (updated) activeSession.value = updated;
}

async function completeCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  if (inputMode.value === 'record') {
    audioRecorder.stopRecording();
    audioRecorder.disconnect();
  }
  const updated = await insightApi.completeSession(activeSession.value.id);
  if (updated) {
    activeSession.value = null;
    stopElapsedTimer();
    stopPolling();
    sessions.value = await insightApi.listSessions();
  }
}

async function manualAnalyze(): Promise<void> {
  if (!activeSession.value) return;
  await insightApi.triggerAnalysis(activeSession.value.id);
}

async function submitManualText(): Promise<void> {
  if (!activeSession.value || !manualText.value.trim()) return;
  const text = manualText.value.trim();
  transcript.value += (transcript.value ? '\n' : '') + text;
  await insightApi.appendTranscript(activeSession.value.id, '\n' + text);
  manualText.value = '';
  await manualAnalyze();
}

// ==================== Config ====================

async function saveSessionConfig(): Promise<void> {
  if (!activeSession.value) return;
  const config: SessionConfig = {
    analysisPrompt: configPrompt.value
  };
  const updated = await insightApi.updateSessionConfig(activeSession.value.id, config);
  if (updated) {
    activeSession.value = updated;
    showConfigPanel.value = false;
  }
}

function openTemplateEditor(tpl: AnalysisTemplate): void {
  editingTemplate.value = { ...tpl };
  editTemplateName.value = tpl.name;
  editTemplateDesc.value = tpl.description;
  editTemplatePrompt.value = tpl.analysisPrompt;
  showTemplateEditor.value = true;
}

async function saveTemplateEdit(): Promise<void> {
  if (!editingTemplate.value) return;
  if (editingTemplate.value.builtIn) {
    const created = await insightApi.createTemplate({
      ...editingTemplate.value,
      name: editTemplateName.value,
      description: editTemplateDesc.value,
      analysisPrompt: editTemplatePrompt.value
    });
    if (created) templates.value.push(created);
  } else {
    const updated = await insightApi.updateTemplate(editingTemplate.value.id, {
      name: editTemplateName.value,
      description: editTemplateDesc.value,
      analysisPrompt: editTemplatePrompt.value
    });
    if (updated) {
      const idx = templates.value.findIndex((t) => t.id === updated.id);
      if (idx >= 0) templates.value[idx] = updated;
    }
  }
  showTemplateEditor.value = false;
  editingTemplate.value = null;
}

// ==================== Copy ====================

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copySuccess.value = label;
    setTimeout(() => {
      copySuccess.value = '';
    }, 2000);
  } catch {
    /* ignore */
  }
}

function copyTranscript(): void {
  copyToClipboard(transcript.value, 'transcript');
}

function copyResult(): void {
  if (!latestResult.value) return;
  const lines: string[] = [];
  if (latestResult.value.summary) lines.push(`摘要：${latestResult.value.summary}\n`);
  for (const [, dim] of Object.entries(latestResult.value.dimensions)) {
    const val = Array.isArray(dim.value) ? (dim.value as string[]).join('、') : String(dim.value);
    lines.push(`${dim.label}：${val}`);
    if (dim.rawText) lines.push(`  → ${dim.rawText}`);
  }
  copyToClipboard(lines.join('\n'), 'result');
}

// ==================== Polling ====================

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!activeSession.value) return;
    try {
      const result = await insightApi.getLatestResult(activeSession.value.id);
      if (result) latestResult.value = result;

      const snaps = await insightApi.getSnapshots(activeSession.value.id);
      if (snaps.length > snapshots.value.length) {
        const newSnap = snaps[snaps.length - 1];
        latestChanges.value = newSnap.changes ?? [];
        activeSnapshotSeq.value = newSnap.sequence;
      }
      snapshots.value = snaps;

      const session = await insightApi.getActiveSession();
      if (session) activeSession.value = session;
    } catch {
      /* ignore polling errors */
    }
  }, 3000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(hasSession, (v) => {
  if (v) startPolling();
  else stopPolling();
});

// ==================== Elapsed Timer ====================

function startElapsedTimer(): void {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (!activeSession.value) return;
    const diff = Date.now() - activeSession.value.startTime;
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    elapsedTime.value = `${h}:${m}:${s}`;
  }, 1000);
}

function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

// ==================== Snapshot ====================

function onSelectSnapshot(seq: number): void {
  activeSnapshotSeq.value = seq;
  const snap = snapshots.value.find((s) => s.sequence === seq);
  if (snap) {
    latestResult.value = snap.result;
    latestChanges.value = snap.changes ?? [];
  }
}

function getChangesMap(): Map<string, DimensionChange> {
  const map = new Map<string, DimensionChange>();
  for (const c of latestChanges.value) map.set(c.key, c);
  return map;
}

// ==================== History ====================

async function viewHistorySession(sessionId: string): Promise<void> {
  router.push(`/insight/session/${sessionId}`);
}

async function deleteHistorySession(sessionId: string): Promise<void> {
  await insightApi.deleteSession(sessionId);
  sessions.value = await insightApi.listSessions();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(start: number, end?: number): string {
  const diff = (end ?? Date.now()) - start;
  const m = Math.floor(diff / 60000);
  return m < 60 ? `${m}分钟` : `${Math.floor(m / 60)}小时${m % 60}分`;
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 顶栏 -->
    <header class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span class="i-carbon-analytics inline-block h-4 w-4" />
        </div>
        <h1 class="text-base font-bold text-foreground">实时洞察</h1>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex gap-0.5 rounded-lg bg-surface-variant p-0.5">
          <button
            class="rounded-md px-3.5 py-1 text-xs transition-all"
            :class="
              tab === 'active'
                ? 'bg-surface font-semibold text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="tab = 'active'">
            实时分析
          </button>
          <button
            class="flex items-center gap-1 rounded-md px-3.5 py-1 text-xs transition-all"
            :class="
              tab === 'history'
                ? 'bg-surface font-semibold text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="tab = 'history'">
            历史记录
            <span
              v-if="sessions.length"
              class="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-bold text-primary">
              {{ sessions.length }}
            </span>
          </button>
        </div>
        <button
          v-if="!hasSession"
          class="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          @click="showTemplateSelector = true">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          新建会话
        </button>
      </div>
    </header>

    <!-- 实时分析 Tab -->
    <div v-if="tab === 'active'" class="flex flex-1 flex-col overflow-hidden">
      <!-- 无活跃会话：空态 -->
      <div v-if="!hasSession && !loading" class="flex flex-1 flex-col items-center justify-center gap-2 p-12">
        <span class="i-carbon-analytics inline-block h-12 w-12 text-muted-foreground/20" />
        <h3 class="mt-2 text-base font-semibold text-foreground/70">开始实时洞察</h3>
        <p class="text-sm text-muted-foreground/60">选择一个分析模板，开始录音或输入文本进行实时分析</p>
        <button
          class="mt-3 flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          @click="showTemplateSelector = true">
          <span class="i-carbon-add inline-block h-4 w-4" />
          选择模板开始
        </button>
        <div class="mt-6 grid w-full max-w-xl grid-cols-2 gap-2.5">
          <div
            v-for="tpl in templates"
            :key="tpl.id"
            class="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/30 hover:bg-primary/5"
            @click="
              selectedTemplateId = tpl.id;
              showTemplateSelector = false;
              startNewSession();
            ">
            <span class="mt-0.5 shrink-0 text-xl">{{ tpl.icon }}</span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-card-foreground/85">{{ tpl.name }}</div>
              <div class="mt-0.5 text-xs leading-relaxed text-muted-foreground/60">{{ tpl.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 有活跃会话 -->
      <template v-if="hasSession">
        <!-- 录音/输入控制面板 -->
        <div
          class="flex shrink-0 items-center justify-between border-b-2 border-border bg-surface px-5 py-2.5 shadow-sm">
          <div class="flex items-center gap-3">
            <span
              class="h-2.5 w-2.5 rounded-full ring-2 ring-offset-1 ring-offset-surface"
              :class="{
                'animate-pulse bg-error ring-error/30': isRecording,
                'bg-warning ring-warning/30': isPaused,
                'animate-pulse bg-info ring-info/30': isAnalyzing,
                'bg-muted-foreground/30 ring-muted/30': !isRecording && !isPaused && !isAnalyzing
              }" />
            <span class="text-xs font-bold text-foreground/80">
              {{ isRecording ? '采集中' : isPaused ? '已暂停' : isAnalyzing ? '分析中' : '就绪' }}
            </span>
            <div class="h-4 w-px bg-border" />
            <span class="font-mono text-sm font-bold tabular-nums text-foreground/60">{{ elapsedTime }}</span>
            <div class="h-4 w-px bg-border" />
            <span class="rounded-md bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              {{ currentTemplate?.name }}
            </span>
            <span
              v-if="triggerLabel"
              class="rounded-md bg-accent/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              :title="`分析触发策略：${triggerLabel}`">
              <span class="i-carbon-timer mr-0.5 inline-block h-3 w-3 align-[-2px]" />
              {{ triggerLabel }}
            </span>
            <span
              v-if="snapshots.length"
              class="rounded-md bg-surface-variant px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
              快照 #{{ snapshots.length }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <!-- 输入模式切换 -->
            <div class="mr-2 flex gap-0.5 rounded-md bg-surface-variant p-0.5">
              <button
                class="rounded px-2 py-1 text-[11px] transition-all"
                :class="
                  inputMode === 'text'
                    ? 'bg-surface font-semibold text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="inputMode = 'text'">
                文本
              </button>
              <button
                class="rounded px-2 py-1 text-[11px] transition-all"
                :class="
                  inputMode === 'record'
                    ? 'bg-surface font-semibold text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="inputMode = 'record'">
                录音
              </button>
            </div>
            <button
              v-if="isRecording && inputMode === 'record'"
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-variant text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              title="暂停"
              @click="pauseCurrentSession">
              <span class="i-carbon-pause inline-block h-3.5 w-3.5" />
            </button>
            <button
              v-if="isPaused"
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-variant text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              title="继续"
              @click="resumeCurrentSession">
              <span class="i-carbon-play inline-block h-3.5 w-3.5" />
            </button>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-variant text-foreground/60 transition-colors hover:bg-primary/15 hover:text-primary"
              title="手动分析"
              @click="manualAnalyze">
              <span class="i-carbon-analytics inline-block h-3.5 w-3.5" />
            </button>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-variant text-foreground/60 transition-colors hover:bg-primary/15 hover:text-primary"
              title="会话配置"
              @click="showConfigPanel = !showConfigPanel">
              <span class="i-carbon-settings inline-block h-3.5 w-3.5" />
            </button>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-variant text-foreground/60 transition-colors hover:bg-error/15 hover:text-error"
              title="结束会话"
              @click="completeCurrentSession">
              <span class="i-carbon-stop inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- 会话配置面板 -->
        <div v-if="showConfigPanel" class="shrink-0 border-b border-border bg-card px-5 py-3">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">分析提示词</div>
          <textarea
            v-model="configPrompt"
            class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none"
            rows="3"
            placeholder="自定义分析提示词..." />
          <div class="mt-2 flex justify-end gap-2">
            <button
              class="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
              @click="showConfigPanel = false">
              取消
            </button>
            <button
              class="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              @click="saveSessionConfig">
              保存
            </button>
          </div>
        </div>

        <!-- 主内容：左右分栏 -->
        <div class="flex min-h-0 flex-1 gap-px overflow-hidden bg-border">
          <!-- 左：文字流 + 输入 -->
          <div class="flex min-w-0 flex-1 flex-col bg-background">
            <div
              class="flex shrink-0 items-center justify-between border-b-2 border-primary/20 bg-surface/60 px-5 py-2.5">
              <div class="flex items-center gap-2">
                <span class="i-carbon-text-align-left inline-block h-4 w-4 text-primary/60" />
                <span class="text-xs font-bold tracking-wide text-foreground/80">
                  {{ inputMode === 'record' ? '实时文字流' : '文本输入' }}
                </span>
              </div>
              <button
                v-if="transcript"
                class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors"
                :class="
                  copySuccess === 'transcript'
                    ? 'bg-success/10 text-success'
                    : 'text-muted-foreground/60 hover:bg-accent hover:text-foreground'
                "
                @click="copyTranscript">
                <span
                  class="inline-block h-3 w-3"
                  :class="copySuccess === 'transcript' ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
                {{ copySuccess === 'transcript' ? '已复制' : '复制' }}
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4">
              <p v-if="transcript" class="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/85">
                {{ transcript }}
              </p>
              <p v-else class="text-sm text-muted-foreground/35">
                {{ inputMode === 'record' ? '等待语音输入...' : '在下方输入文本内容...' }}
              </p>
            </div>
            <!-- 手动文本输入区域 -->
            <div v-if="inputMode === 'text'" class="shrink-0 border-t-2 border-border bg-surface/40 px-5 py-3">
              <div class="flex gap-2">
                <textarea
                  v-model="manualText"
                  class="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none"
                  rows="3"
                  placeholder="粘贴或输入对话内容..."
                  @keydown.ctrl.enter="submitManualText"
                  @keydown.meta.enter="submitManualText" />
                <button
                  class="shrink-0 self-end rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!manualText.trim()"
                  @click="submitManualText">
                  提交并分析
                </button>
              </div>
              <p class="mt-1 text-[11px] text-muted-foreground/40">Ctrl+Enter 快捷提交</p>
            </div>
          </div>

          <!-- 右：分析结果卡片 -->
          <div class="flex min-w-0 flex-1 flex-col bg-card">
            <div class="flex shrink-0 items-center justify-between border-b-2 border-accent/30 bg-accent/5 px-5 py-2.5">
              <div class="flex items-center gap-2">
                <span class="i-carbon-chart-area inline-block h-4 w-4 text-accent" />
                <span class="text-xs font-bold tracking-wide text-foreground/80">分析结果</span>
              </div>
              <div class="flex items-center gap-2">
                <span
                  v-if="latestResult?.confidence"
                  class="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                  置信度 {{ Math.round(latestResult.confidence * 100) }}%
                </span>
                <button
                  v-if="latestResult"
                  class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors"
                  :class="
                    copySuccess === 'result'
                      ? 'bg-success/10 text-success'
                      : 'text-muted-foreground/60 hover:bg-accent hover:text-foreground'
                  "
                  @click="copyResult">
                  <span
                    class="inline-block h-3 w-3"
                    :class="copySuccess === 'result' ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
                  {{ copySuccess === 'result' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
            <div v-if="latestResult" class="flex-1 overflow-y-auto px-5 py-4">
              <div
                v-if="latestResult.summary"
                class="mb-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground/80">
                {{ latestResult.summary }}
              </div>
              <div class="flex flex-col gap-2.5">
                <DimensionRenderer
                  v-for="(dim, key) in latestResult.dimensions"
                  :key="String(key)"
                  :dimension="dim"
                  :change="getChangesMap().get(String(key))"
                  :icon="currentTemplate?.dimensions.find((d) => d.key === String(key))?.icon"
                  :show-trend="currentTemplate?.dimensions.find((d) => d.key === String(key))?.showTrend" />
              </div>
            </div>
            <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/40">
              <span class="i-carbon-chart-area inline-block h-8 w-8" />
              <p class="text-sm">等待首次分析...</p>
            </div>
          </div>
        </div>

        <!-- 快照时间线 -->
        <SnapshotTimeline :snapshots="snapshots" :active-sequence="activeSnapshotSeq" @select="onSelectSnapshot" />
      </template>
    </div>

    <!-- 历史记录 Tab -->
    <div v-if="tab === 'history'" class="flex-1 overflow-y-auto">
      <div v-if="sessions.length === 0" class="flex flex-col items-center justify-center gap-2 p-12">
        <span class="i-carbon-document inline-block h-10 w-10 text-muted-foreground/20" />
        <p class="text-sm text-muted-foreground/50">暂无历史记录</p>
      </div>
      <div v-else class="flex flex-col gap-1.5 px-5 py-3">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 transition-all hover:border-border-variant hover:bg-accent/30">
          <div>
            <div class="text-sm font-semibold text-card-foreground/80">{{ s.templateName }}</div>
            <div class="mt-0.5 text-xs text-muted-foreground/55">
              {{ formatDate(s.startTime) }} · {{ formatDuration(s.startTime, s.endTime) }} ·
              {{ s.snapshotCount }} 次分析
            </div>
          </div>
          <div class="flex gap-1">
            <button
              class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              @click="viewHistorySession(s.id)">
              <span class="i-carbon-view inline-block h-3.5 w-3.5" /> 查看
            </button>
            <button
              class="flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-error/10 hover:text-error"
              @click="deleteHistorySession(s.id)">
              <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 模板选择对话框 -->
    <Teleport to="body">
      <div
        v-if="showTemplateSelector"
        class="fixed inset-0 z-[200] flex items-center justify-center bg-overlay/40"
        @click.self="showTemplateSelector = false">
        <div class="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl bg-popover p-6 shadow-2xl">
          <h3 class="mb-4 text-base font-bold text-popover-foreground">选择分析模板</h3>

          <!-- 输入模式选择 -->
          <div class="mb-4 flex items-center gap-3">
            <span class="text-xs text-muted-foreground/70">数据采集方式：</span>
            <div class="flex gap-0.5 rounded-lg bg-surface-variant p-0.5">
              <button
                class="rounded-md px-3 py-1 text-xs transition-all"
                :class="
                  inputMode === 'text'
                    ? 'bg-surface font-semibold text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="inputMode = 'text'">
                手动输入文本
              </button>
              <button
                class="rounded-md px-3 py-1 text-xs transition-all"
                :class="
                  inputMode === 'record'
                    ? 'bg-surface font-semibold text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="inputMode = 'record'">
                实时录音
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all"
              :class="
                selectedTemplateId === tpl.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
              "
              @click="selectedTemplateId = tpl.id">
              <span class="shrink-0 text-[28px]">{{ tpl.icon }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-popover-foreground">{{ tpl.name }}</span>
                  <button
                    class="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
                    title="编辑模板"
                    @click.stop="openTemplateEditor(tpl)">
                    <span class="i-carbon-edit inline-block h-3 w-3" />
                  </button>
                </div>
                <div class="mt-0.5 text-xs text-muted-foreground/60">{{ tpl.description }}</div>
                <div class="mt-1 text-[11px] text-muted-foreground/40">{{ tpl.dimensions.length }} 个分析维度</div>
              </div>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              class="rounded-lg px-5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
              @click="showTemplateSelector = false">
              取消
            </button>
            <button
              class="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!selectedTemplateId"
              @click="startNewSession">
              {{ inputMode === 'record' ? '开始录音' : '开始分析' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 模板编辑对话框 -->
    <Teleport to="body">
      <div
        v-if="showTemplateEditor"
        class="fixed inset-0 z-[210] flex items-center justify-center bg-overlay/40"
        @click.self="showTemplateEditor = false">
        <div class="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl bg-popover p-6 shadow-2xl">
          <h3 class="mb-4 text-base font-bold text-popover-foreground">
            {{ editingTemplate?.builtIn ? '基于内置模板创建' : '编辑模板' }}
          </h3>
          <div v-if="editingTemplate?.builtIn" class="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            内置模板不可修改，保存后将创建一个副本。
          </div>
          <div class="flex flex-col gap-3">
            <div>
              <label class="mb-1 block text-xs font-semibold text-muted-foreground/70">名称</label>
              <input
                v-model="editTemplateName"
                class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold text-muted-foreground/70">描述</label>
              <input
                v-model="editTemplateDesc"
                class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold text-muted-foreground/70">分析提示词</label>
              <textarea
                v-model="editTemplatePrompt"
                class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                rows="5" />
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              class="rounded-lg px-5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
              @click="showTemplateEditor = false">
              取消
            </button>
            <button
              class="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              @click="saveTemplateEdit">
              {{ editingTemplate?.builtIn ? '创建副本' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
