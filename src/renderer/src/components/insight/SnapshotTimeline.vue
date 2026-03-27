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
  <div class="shrink-0 border-t border-border px-4 py-2">
    <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">快照时间线</div>
    <div class="flex gap-1 overflow-x-auto pb-1">
      <button
        v-for="snap in props.snapshots"
        :key="snap.id"
        class="flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1 transition-all"
        :class="
          snap.sequence === props.activeSequence
            ? 'border-primary/30 bg-primary/10'
            : 'border-transparent bg-surface-variant hover:bg-accent/30'
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
      <div v-if="!props.snapshots.length" class="py-1 text-xs text-muted-foreground/40">尚无分析快照</div>
    </div>
  </div>
</template>
