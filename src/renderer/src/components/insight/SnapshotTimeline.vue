<script setup lang="ts">
/**
 * SnapshotTimeline — 快照时间线
 */
import type { AnalysisSnapshot } from '@shared/types/insight';

const props = defineProps<{
  snapshots: AnalysisSnapshot[];
  activeSequence?: number;
}>();

const emit = defineEmits<{
  select: [sequence: number];
}>();

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="shrink-0 border-t-2 border-border bg-surface/50 px-5 py-2.5">
    <div class="mb-2 flex items-center gap-2">
      <span class="i-carbon-time inline-block h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/60">快照时间线</span>
      <span v-if="props.snapshots.length" class="text-[10px] text-muted-foreground/40">
        ({{ props.snapshots.length }} 次分析)
      </span>
    </div>
    <div class="flex gap-1.5 overflow-x-auto pb-1">
      <button
        v-for="snap in props.snapshots"
        :key="snap.id"
        class="flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-3 py-1.5 transition-all"
        :class="
          snap.sequence === props.activeSequence
            ? 'border-primary/40 bg-primary/10 shadow-sm'
            : 'border-border bg-card hover:border-primary/20 hover:bg-accent/20'
        "
        :title="`#${snap.sequence} ${formatTime(snap.timestamp)} (${snap.latencyMs}ms)`"
        @click="emit('select', snap.sequence)">
        <span
          class="text-[11px] font-bold"
          :class="snap.sequence === props.activeSequence ? 'text-primary' : 'text-foreground/70'">
          #{{ snap.sequence }}
        </span>
        <span class="text-[10px] text-muted-foreground/50">{{ formatTime(snap.timestamp) }}</span>
      </button>
      <div v-if="!props.snapshots.length" class="py-1.5 text-xs text-muted-foreground/40">尚无分析快照</div>
    </div>
  </div>
</template>
