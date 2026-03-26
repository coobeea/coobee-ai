<script setup lang="ts">
/**
 * InsightSessionView — 历史会话详情/回顾
 */
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DimensionRenderer from '@/components/insight/DimensionRenderer.vue';
import SnapshotTimeline from '@/components/insight/SnapshotTimeline.vue';
import * as insightApi from '@/api/insight';
import type { InsightSession, AnalysisSnapshot, AnalysisTemplate } from '@shared/types/insight';

const route = useRoute();
const router = useRouter();

const sessionId = computed(() => route.params.id as string);
const session = ref<InsightSession | null>(null);
const snapshots = ref<AnalysisSnapshot[]>([]);
const templates = ref<AnalysisTemplate[]>([]);
const activeSnapshotSeq = ref<number | undefined>(undefined);
const activeSnapshot = ref<AnalysisSnapshot | null>(null);
const loading = ref(true);

const template = computed<AnalysisTemplate | null>(() => {
  if (!session.value) return null;
  return templates.value.find((t) => t.id === session.value!.templateId) ?? null;
});

onMounted(async () => {
  try {
    templates.value = await insightApi.listTemplates();
    session.value = await insightApi.getSession(sessionId.value);
    snapshots.value = await insightApi.getSnapshots(sessionId.value);
    if (snapshots.value.length) {
      const last = snapshots.value[snapshots.value.length - 1];
      activeSnapshotSeq.value = last.sequence;
      activeSnapshot.value = last;
    }
  } catch (err) {
    console.error('[InsightSessionView] Load failed:', err);
  } finally {
    loading.value = false;
  }
});

function onSelectSnapshot(seq: number): void {
  activeSnapshotSeq.value = seq;
  activeSnapshot.value = snapshots.value.find((s) => s.sequence === seq) ?? null;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

function formatDuration(start: number, end?: number): string {
  const diff = (end ?? start) - start;
  const m = Math.floor(diff / 60000);
  return m < 60 ? `${m}分钟` : `${Math.floor(m / 60)}小时${m % 60}分`;
}
</script>

<template>
  <div class="session-view">
    <!-- 顶栏 -->
    <header class="header">
      <button class="back-btn" @click="router.push('/insight')">
        <span class="i-carbon-arrow-left inline-block h-4 w-4" />
        返回
      </button>
      <div v-if="session" class="header-info">
        <h1 class="header-title">{{ session.templateName }}</h1>
        <span class="header-meta">
          {{ formatDate(session.startTime) }} · {{ formatDuration(session.startTime, session.endTime) }} ·
          {{ session.snapshotCount }} 次分析
        </span>
      </div>
    </header>

    <div v-if="loading" class="loading">加载中...</div>

    <template v-if="!loading && session">
      <!-- 主体 -->
      <div class="main-split">
        <!-- 左：文字流 -->
        <div class="transcript-panel">
          <div class="panel-header">
            完整转写文本
            <span v-if="activeSnapshot" class="range-badge">
              快照 #{{ activeSnapshot.sequence }}：新增 {{ activeSnapshot.newText.length }} 字
            </span>
          </div>
          <div class="transcript-body">
            <p v-if="activeSnapshot" class="transcript-text">{{ activeSnapshot.fullTranscript }}</p>
            <p v-else class="transcript-text">{{ session.transcript || '（无转写内容）' }}</p>
          </div>
        </div>

        <!-- 右：分析结果 -->
        <div class="result-panel">
          <div class="panel-header">
            分析结果
            <span v-if="activeSnapshot?.result.confidence" class="confidence-badge">
              置信度 {{ Math.round(activeSnapshot.result.confidence * 100) }}%
            </span>
          </div>
          <div v-if="activeSnapshot" class="result-body">
            <div v-if="activeSnapshot.result.summary" class="result-summary">
              {{ activeSnapshot.result.summary }}
            </div>
            <div class="dim-grid">
              <DimensionRenderer
                v-for="(dim, key) in activeSnapshot.result.dimensions"
                :key="String(key)"
                :dimension="dim"
                :icon="template?.dimensions.find((d) => d.key === String(key))?.icon"
                :change="activeSnapshot.changes?.find((c) => c.key === String(key))"
                :show-trend="template?.dimensions.find((d) => d.key === String(key))?.showTrend" />
            </div>
            <div class="snap-meta"> 分析耗时 {{ activeSnapshot.latencyMs }}ms </div>
          </div>
          <div v-else class="result-empty"> 选择一个快照查看分析结果 </div>
        </div>
      </div>

      <!-- 快照时间线 -->
      <SnapshotTimeline :snapshots="snapshots" :active-sequence="activeSnapshotSeq" @select="onSelectSnapshot" />
    </template>
  </div>
</template>

<style scoped>
.session-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  flex-shrink: 0;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.12s;
}
.back-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground));
}
.header-title {
  font-size: 16px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0;
}
.header-meta {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: hsl(var(--muted-foreground) / 0.5);
}
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
}
.result-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
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
.range-badge,
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
.snap-meta {
  margin-top: 12px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
  text-align: right;
}
.result-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 13px;
}
</style>
