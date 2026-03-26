<script setup lang="ts">
/**
 * InsightView — 实时洞察主视图
 *
 * 布局：顶栏 → 录音控制 → 左右分栏（文字流 | 分析卡片）→ 快照时间线
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
  DimensionChange
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

const currentTemplate = computed<AnalysisTemplate | null>(() => {
  if (!activeSession.value) return null;
  return templates.value.find((t) => t.id === activeSession.value!.templateId) ?? null;
});

const isRecording = computed(() => activeSession.value?.status === 'recording');
const isPaused = computed(() => activeSession.value?.status === 'paused');
const isAnalyzing = computed(() => activeSession.value?.status === 'analyzing');
const hasSession = computed(() => !!activeSession.value);

const elapsedTime = ref('00:00:00');
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// ==================== Audio Recorder ====================

const audioRecorder = useAudioRecorder({
  onPartialResult: (text: string) => {
    if (!activeSession.value) return;
    transcript.value += text;
    insightApi.appendTranscript(activeSession.value.id, text).catch(() => {});
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

    await audioRecorder.connect();
    await audioRecorder.startRecording();
    startElapsedTimer();
    startPolling();
  } catch (err) {
    console.error('[InsightView] Start failed:', err);
  }
}

async function pauseCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  audioRecorder.stopRecording();
  const updated = await insightApi.pauseSession(activeSession.value.id);
  if (updated) activeSession.value = updated;
}

async function resumeCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  await audioRecorder.startRecording();
  const updated = await insightApi.resumeSession(activeSession.value.id);
  if (updated) activeSession.value = updated;
}

async function completeCurrentSession(): Promise<void> {
  if (!activeSession.value) return;
  audioRecorder.stopRecording();
  audioRecorder.disconnect();
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

// ==================== Polling ====================

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!activeSession.value) return;
    try {
      const result = await insightApi.getLatestResult(activeSession.value.id);
      if (result) {
        latestResult.value = result;
      }
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
  <div class="insight-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <div class="header-icon">
          <span class="i-carbon-analytics inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">实时洞察</h1>
      </div>
      <div class="header-right">
        <div class="tab-group">
          <button :class="['tab-btn', { active: tab === 'active' }]" @click="tab = 'active'">实时分析</button>
          <button :class="['tab-btn', { active: tab === 'history' }]" @click="tab = 'history'">
            历史记录
            <span v-if="sessions.length" class="count-badge">{{ sessions.length }}</span>
          </button>
        </div>
        <button v-if="!hasSession" class="create-btn" @click="showTemplateSelector = true">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          <span>新建会话</span>
        </button>
      </div>
    </header>

    <!-- 实时分析 Tab -->
    <div v-if="tab === 'active'" class="content">
      <!-- 无活跃会话：空态 -->
      <div v-if="!hasSession && !loading" class="empty-state">
        <span class="i-carbon-analytics inline-block h-12 w-12 opacity-[0.06]" />
        <h3>开始实时洞察</h3>
        <p>选择一个分析模板，开始录音并实时分析对话内容</p>
        <button class="create-btn-lg" @click="showTemplateSelector = true">
          <span class="i-carbon-add inline-block h-4 w-4" />
          选择模板开始
        </button>
        <div class="template-cards">
          <div
            v-for="tpl in templates"
            :key="tpl.id"
            class="tpl-card"
            @click="
              selectedTemplateId = tpl.id;
              showTemplateSelector = false;
              startNewSession();
            ">
            <span class="tpl-icon">{{ tpl.icon }}</span>
            <div class="tpl-info">
              <div class="tpl-name">{{ tpl.name }}</div>
              <div class="tpl-desc">{{ tpl.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 有活跃会话 -->
      <template v-if="hasSession">
        <!-- 录音控制面板 -->
        <div class="recording-panel">
          <div class="rec-left">
            <span class="rec-dot" :class="{ recording: isRecording, paused: isPaused, analyzing: isAnalyzing }" />
            <span class="rec-status">
              {{ isRecording ? '录音中' : isPaused ? '已暂停' : isAnalyzing ? '分析中' : '' }}
            </span>
            <span class="rec-time">{{ elapsedTime }}</span>
            <span class="rec-template">{{ currentTemplate?.name }}</span>
            <span v-if="snapshots.length" class="rec-snap-count"> 快照: #{{ snapshots.length }} </span>
          </div>
          <div class="rec-right">
            <button v-if="isRecording" class="ctrl-btn" title="暂停" @click="pauseCurrentSession">
              <span class="i-carbon-pause inline-block h-3.5 w-3.5" />
            </button>
            <button v-if="isPaused" class="ctrl-btn" title="继续" @click="resumeCurrentSession">
              <span class="i-carbon-play inline-block h-3.5 w-3.5" />
            </button>
            <button class="ctrl-btn" title="手动分析" @click="manualAnalyze">
              <span class="i-carbon-analytics inline-block h-3.5 w-3.5" />
            </button>
            <button class="ctrl-btn ctrl-stop" title="结束会话" @click="completeCurrentSession">
              <span class="i-carbon-stop inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- 主内容：左右分栏 -->
        <div class="main-split">
          <!-- 左：文字流 -->
          <div class="transcript-panel">
            <div class="panel-header">实时文字流</div>
            <div class="transcript-body">
              <p v-if="transcript" class="transcript-text">{{ transcript }}</p>
              <p v-else class="transcript-placeholder">等待语音输入...</p>
            </div>
          </div>

          <!-- 右：分析结果卡片 -->
          <div class="result-panel">
            <div class="panel-header">
              分析结果
              <span v-if="latestResult?.confidence" class="confidence-badge">
                置信度 {{ Math.round(latestResult.confidence * 100) }}%
              </span>
            </div>
            <div v-if="latestResult" class="result-body">
              <div v-if="latestResult.summary" class="result-summary">
                {{ latestResult.summary }}
              </div>
              <div class="dim-grid">
                <DimensionRenderer
                  v-for="(dim, key) in latestResult.dimensions"
                  :key="String(key)"
                  :dimension="dim"
                  :change="getChangesMap().get(String(key))"
                  :icon="currentTemplate?.dimensions.find((d) => d.key === String(key))?.icon"
                  :show-trend="currentTemplate?.dimensions.find((d) => d.key === String(key))?.showTrend" />
              </div>
            </div>
            <div v-else class="result-empty">
              <span class="i-carbon-chart-area inline-block h-8 w-8 opacity-[0.06]" />
              <p>等待首次分析...</p>
            </div>
          </div>
        </div>

        <!-- 快照时间线 -->
        <SnapshotTimeline :snapshots="snapshots" :active-sequence="activeSnapshotSeq" @select="onSelectSnapshot" />
      </template>
    </div>

    <!-- 历史记录 Tab -->
    <div v-if="tab === 'history'" class="content">
      <div v-if="sessions.length === 0" class="empty-state">
        <span class="i-carbon-document inline-block h-10 w-10 opacity-[0.06]" />
        <p>暂无历史记录</p>
      </div>
      <div v-else class="history-list">
        <div v-for="s in sessions" :key="s.id" class="history-item">
          <div class="history-info">
            <div class="history-name">{{ s.templateName }}</div>
            <div class="history-meta">
              {{ formatDate(s.startTime) }} · {{ formatDuration(s.startTime, s.endTime) }} ·
              {{ s.snapshotCount }} 次分析
            </div>
          </div>
          <div class="history-actions">
            <button class="action-btn" @click="viewHistorySession(s.id)">
              <span class="i-carbon-view inline-block h-3.5 w-3.5" /> 查看
            </button>
            <button class="action-btn action-delete" @click="deleteHistorySession(s.id)">
              <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 模板选择对话框 -->
    <Teleport to="body">
      <div v-if="showTemplateSelector" class="modal-overlay" @click.self="showTemplateSelector = false">
        <div class="modal-content">
          <h3 class="modal-title">选择分析模板</h3>
          <div class="modal-templates">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="modal-tpl"
              :class="{ selected: selectedTemplateId === tpl.id }"
              @click="selectedTemplateId = tpl.id">
              <span class="tpl-icon-lg">{{ tpl.icon }}</span>
              <div class="tpl-detail">
                <div class="tpl-name">{{ tpl.name }}</div>
                <div class="tpl-desc">{{ tpl.description }}</div>
                <div class="tpl-dims">{{ tpl.dimensions.length }} 个分析维度</div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-cancel" @click="showTemplateSelector = false">取消</button>
            <button class="modal-confirm" :disabled="!selectedTemplateId" @click="startNewSession"> 开始录音 </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.insight-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ====== Header ====== */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}
.header-title {
  font-size: 16px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tab-group {
  display: flex;
  gap: 2px;
  background: hsl(var(--foreground) / 0.04);
  border-radius: 8px;
  padding: 2px;
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12.5px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;
}
.tab-btn.active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-weight: 600;
  box-shadow: 0 1px 3px hsl(var(--foreground) / 0.06);
}
.count-badge {
  font-size: 10px;
  font-weight: 700;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  padding: 1px 5px;
  border-radius: 99px;
}
.create-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: white;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.create-btn:hover {
  opacity: 0.9;
}

/* ====== Content ====== */
.content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ====== Empty State ====== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 8px;
  color: hsl(var(--muted-foreground) / 0.6);
  text-align: center;
}
.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin: 8px 0 0;
}
.empty-state p {
  font-size: 13px;
  margin: 0;
}
.create-btn-lg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 10px;
  background: hsl(var(--primary));
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
}
.template-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 24px;
  width: 100%;
  max-width: 560px;
}
.tpl-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.3);
  cursor: pointer;
  transition: all 0.15s;
}
.tpl-card:hover {
  border-color: hsl(var(--primary) / 0.3);
  background: hsl(var(--primary) / 0.03);
}
.tpl-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}
.tpl-info {
  min-width: 0;
}
.tpl-name {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.85);
}
.tpl-desc {
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-top: 2px;
  line-height: 1.4;
}

/* ====== Recording Panel ====== */
.recording-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: hsl(var(--foreground) / 0.02);
  border-bottom: 1px solid hsl(var(--border) / 0.2);
  flex-shrink: 0;
}
.rec-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(var(--muted-foreground) / 0.3);
}
.rec-dot.recording {
  background: hsl(0 84% 60%);
  animation: pulse-rec 1.2s ease-in-out infinite;
}
.rec-dot.paused {
  background: hsl(38 92% 50%);
}
.rec-dot.analyzing {
  background: hsl(217 91% 60%);
  animation: pulse-rec 1s ease-in-out infinite;
}
@keyframes pulse-rec {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 hsl(0 84% 60% / 0.4);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 0 4px hsl(0 84% 60% / 0);
  }
}
.rec-status {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
}
.rec-time {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--foreground) / 0.5);
}
.rec-template {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.8);
}
.rec-snap-count {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
}
.rec-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.6);
  cursor: pointer;
  transition: all 0.12s;
}
.ctrl-btn:hover {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground));
}
.ctrl-stop:hover {
  background: hsl(0 84% 60% / 0.12);
  color: hsl(0 84% 50%);
}

/* ====== Main Split ====== */
.main-split {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.transcript-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border) / 0.2);
  min-width: 0;
}
.result-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.7);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid hsl(var(--border) / 0.15);
  flex-shrink: 0;
}
.confidence-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.7);
  text-transform: none;
  letter-spacing: 0;
}
.transcript-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.transcript-text {
  font-size: 13.5px;
  line-height: 1.8;
  color: hsl(var(--foreground) / 0.8);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.transcript-placeholder {
  color: hsl(var(--muted-foreground) / 0.35);
  font-size: 13px;
}
.result-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.result-summary {
  font-size: 13px;
  color: hsl(var(--foreground) / 0.75);
  padding: 8px 12px;
  background: hsl(var(--primary) / 0.04);
  border-radius: 8px;
  margin-bottom: 12px;
  line-height: 1.5;
}
.dim-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.result-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8px;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 13px;
}

/* ====== History ====== */
.history-list {
  padding: 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.25);
  transition: all 0.15s;
}
.history-item:hover {
  border-color: hsl(var(--border) / 0.4);
  background: hsl(var(--foreground) / 0.02);
}
.history-name {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.8);
}
.history-meta {
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.55);
  margin-top: 2px;
}
.history-actions {
  display: flex;
  gap: 4px;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.12s;
}
.action-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground));
}
.action-delete:hover {
  background: hsl(0 84% 60% / 0.08);
  color: hsl(0 84% 50%);
}

/* ====== Modal ====== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: hsl(0 0% 0% / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal-content {
  background: hsl(var(--background));
  border-radius: 16px;
  padding: 24px;
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px hsl(0 0% 0% / 0.25);
}
.modal-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 16px;
}
.modal-templates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-tpl {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.3);
  cursor: pointer;
  transition: all 0.15s;
}
.modal-tpl:hover {
  border-color: hsl(var(--primary) / 0.3);
}
.modal-tpl.selected {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.04);
}
.tpl-icon-lg {
  font-size: 28px;
  flex-shrink: 0;
}
.tpl-detail {
  min-width: 0;
}
.tpl-dims {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
  margin-top: 4px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.modal-cancel {
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.modal-cancel:hover {
  background: hsl(var(--foreground) / 0.05);
}
.modal-confirm {
  padding: 8px 24px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: hsl(var(--primary));
  color: white;
  cursor: pointer;
}
.modal-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.modal-confirm:not(:disabled):hover {
  opacity: 0.9;
}
</style>
