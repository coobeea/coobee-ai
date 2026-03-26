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
  <div class="timeline">
    <div class="timeline-label">快照时间线</div>
    <div class="timeline-track">
      <button
        v-for="snap in props.snapshots"
        :key="snap.id"
        class="snap-btn"
        :class="{ active: snap.sequence === props.activeSequence }"
        :title="`#${snap.sequence} ${formatTime(snap.timestamp)} (${snap.latencyMs}ms)`"
        @click="emit('select', snap.sequence)">
        <span class="snap-num">#{{ snap.sequence }}</span>
        <span class="snap-time">{{ formatTime(snap.timestamp) }}</span>
      </button>
      <div v-if="!props.snapshots.length" class="timeline-empty"> 尚无分析快照 </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  border-top: 1px solid hsl(var(--border) / 0.3);
  padding: 8px 16px;
}
.timeline-label {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 6px;
}
.timeline-track {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.timeline-track::-webkit-scrollbar {
  height: 3px;
}
.timeline-track::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.06);
  border-radius: 3px;
}
.snap-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 10px;
  border-radius: 8px;
  background: hsl(var(--foreground) / 0.03);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.snap-btn:hover {
  background: hsl(var(--foreground) / 0.06);
}
.snap-btn.active {
  background: hsl(var(--primary) / 0.1);
  border-color: hsl(var(--primary) / 0.3);
}
.snap-num {
  font-size: 11px;
  font-weight: 700;
  color: hsl(var(--foreground) / 0.7);
}
.snap-btn.active .snap-num {
  color: hsl(var(--primary));
}
.snap-time {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.5);
}
.timeline-empty {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.4);
  padding: 4px 0;
}
</style>
