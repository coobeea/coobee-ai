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
const copySuccess = ref('');

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
  const text = activeSnapshot.value?.fullTranscript || session.value?.transcript || '';
  copyToClipboard(text, 'transcript');
}

function copyResult(): void {
  if (!activeSnapshot.value?.result) return;
  const r = activeSnapshot.value.result;
  const lines: string[] = [];
  if (r.summary) lines.push(`摘要：${r.summary}\n`);
  for (const [, dim] of Object.entries(r.dimensions)) {
    const val = Array.isArray(dim.value) ? (dim.value as string[]).join('、') : String(dim.value);
    lines.push(`${dim.label}：${val}`);
    if (dim.rawText) lines.push(`  → ${dim.rawText}`);
  }
  copyToClipboard(lines.join('\n'), 'result');
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
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 顶栏 -->
    <header class="flex shrink-0 items-center gap-4 border-b border-border px-6 py-3">
      <button
        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="router.push('/insight')">
        <span class="i-carbon-arrow-left inline-block h-4 w-4" />
        返回
      </button>
      <div v-if="session">
        <h1 class="text-base font-bold text-foreground">{{ session.templateName }}</h1>
        <span class="text-xs text-muted-foreground/60">
          {{ formatDate(session.startTime) }} · {{ formatDuration(session.startTime, session.endTime) }} ·
          {{ session.snapshotCount }} 次分析
        </span>
      </div>
    </header>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-muted-foreground/50">加载中...</div>

    <template v-if="!loading && session">
      <!-- 主体 -->
      <div class="flex min-h-0 flex-1 gap-px overflow-hidden bg-border">
        <!-- 左：文字流 -->
        <div class="flex min-w-0 flex-1 flex-col bg-background">
          <div
            class="flex shrink-0 items-center justify-between border-b-2 border-primary/20 bg-surface/60 px-5 py-2.5">
            <div class="flex items-center gap-2">
              <span class="i-carbon-text-align-left inline-block h-4 w-4 text-primary/60" />
              <span class="text-xs font-bold tracking-wide text-foreground/80">完整转写文本</span>
              <span
                v-if="activeSnapshot"
                class="ml-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                快照 #{{ activeSnapshot.sequence }}：新增 {{ activeSnapshot.newText.length }} 字
              </span>
            </div>
            <button
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
            <p v-if="activeSnapshot" class="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/85">
              {{ activeSnapshot.fullTranscript }}
            </p>
            <p v-else class="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/85">
              {{ session.transcript || '（无转写内容）' }}
            </p>
          </div>
        </div>

        <!-- 右：分析结果 -->
        <div class="flex min-w-0 flex-1 flex-col bg-card">
          <div class="flex shrink-0 items-center justify-between border-b-2 border-accent/30 bg-accent/5 px-5 py-2.5">
            <div class="flex items-center gap-2">
              <span class="i-carbon-chart-area inline-block h-4 w-4 text-accent" />
              <span class="text-xs font-bold tracking-wide text-foreground/80">分析结果</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="activeSnapshot?.result.confidence"
                class="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                置信度 {{ Math.round(activeSnapshot.result.confidence * 100) }}%
              </span>
              <button
                v-if="activeSnapshot"
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
          <div v-if="activeSnapshot" class="flex-1 overflow-y-auto px-5 py-4">
            <div
              v-if="activeSnapshot.result.summary"
              class="mb-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground/80">
              {{ activeSnapshot.result.summary }}
            </div>
            <div class="flex flex-col gap-2.5">
              <DimensionRenderer
                v-for="(dim, key) in activeSnapshot.result.dimensions"
                :key="String(key)"
                :dimension="dim"
                :icon="template?.dimensions.find((d) => d.key === String(key))?.icon"
                :change="activeSnapshot.changes?.find((c) => c.key === String(key))"
                :show-trend="template?.dimensions.find((d) => d.key === String(key))?.showTrend" />
            </div>
            <div class="mt-3 text-right text-[11px] text-muted-foreground/40">
              分析耗时 {{ activeSnapshot.latencyMs }}ms
            </div>
          </div>
          <div v-else class="flex flex-1 items-center justify-center text-sm text-muted-foreground/40">
            选择一个快照查看分析结果
          </div>
        </div>
      </div>

      <!-- 快照时间线 -->
      <SnapshotTimeline :snapshots="snapshots" :active-sequence="activeSnapshotSeq" @select="onSelectSnapshot" />
    </template>
  </div>
</template>
