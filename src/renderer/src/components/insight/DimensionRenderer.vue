<script setup lang="ts">
/**
 * DimensionRenderer — 维度结果渲染器
 *
 * 根据维度类型动态渲染不同 UI：enum/score/text/list/tags/progress/boolean
 */
import type { DimensionValue, DimensionChange } from '@shared/types/insight';

const props = defineProps<{
  dimension: DimensionValue;
  change?: DimensionChange;
  icon?: string;
  showTrend?: boolean;
}>();

function getTrendIcon(direction?: string): string {
  switch (direction) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
      return '→';
    case 'changed':
      return '⟳';
    default:
      return '';
  }
}

function getTrendClass(direction?: string): string {
  switch (direction) {
    case 'up':
      return 'trend-up';
    case 'down':
      return 'trend-down';
    default:
      return 'trend-neutral';
  }
}

function getEnumColor(value: unknown): string {
  const s = String(value);
  if (['强烈', '优秀', '高', '强烈推荐', '推荐'].includes(s)) return 'badge-success';
  if (['偏强', '良好', '中'].includes(s)) return 'badge-info';
  if (['一般', '待定'].includes(s)) return 'badge-warning';
  if (['观望', '较差', '低', '不推荐', '拒绝'].includes(s)) return 'badge-danger';
  return 'badge-default';
}
</script>

<template>
  <div class="dim-card">
    <div class="dim-header">
      <span v-if="props.icon" class="dim-icon">{{ props.icon }}</span>
      <span class="dim-label">{{ props.dimension.label }}</span>
      <span v-if="props.showTrend && props.change" class="dim-trend" :class="getTrendClass(props.change.direction)">
        {{ getTrendIcon(props.change.direction) }}
      </span>
    </div>
    <div class="dim-value">
      <!-- enum -->
      <template v-if="props.dimension.type === 'enum'">
        <span class="badge" :class="getEnumColor(props.dimension.value)">
          {{ props.dimension.value }}
        </span>
      </template>

      <!-- score -->
      <template v-else-if="props.dimension.type === 'score'">
        <div class="score-row">
          <div class="score-bar">
            <div class="score-fill" :style="{ width: `${Number(props.dimension.value)}%` }" />
          </div>
          <span class="score-num">{{ props.dimension.value }}</span>
        </div>
      </template>

      <!-- text -->
      <template v-else-if="props.dimension.type === 'text'">
        <p class="dim-text">{{ props.dimension.value || '—' }}</p>
      </template>

      <!-- list -->
      <template v-else-if="props.dimension.type === 'list'">
        <ul v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length" class="dim-list">
          <li v-for="(item, i) in props.dimension.value as string[]" :key="i">{{ item }}</li>
        </ul>
        <span v-else class="dim-empty">暂无数据</span>
      </template>

      <!-- tags -->
      <template v-else-if="props.dimension.type === 'tags'">
        <div v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length" class="tags-row">
          <span v-for="(tag, i) in props.dimension.value as string[]" :key="i" class="tag">{{ tag }}</span>
        </div>
        <span v-else class="dim-empty">暂无</span>
      </template>

      <!-- progress -->
      <template v-else-if="props.dimension.type === 'progress'">
        <span class="badge badge-info">{{ props.dimension.value || '—' }}</span>
      </template>

      <!-- boolean -->
      <template v-else-if="props.dimension.type === 'boolean'">
        <span>{{ props.dimension.value ? '✅ 是' : '❌ 否' }}</span>
      </template>

      <!-- fallback -->
      <template v-else>
        <span>{{ props.dimension.value ?? '—' }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dim-card {
  padding: 10px 14px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.02);
  border: 1px solid hsl(var(--border) / 0.3);
  transition: background 0.15s;
}
.dim-card:hover {
  background: hsl(var(--foreground) / 0.04);
}
.dim-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.dim-icon {
  font-size: 14px;
}
.dim-label {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.8);
}
.dim-trend {
  font-size: 13px;
  font-weight: 700;
  margin-left: auto;
}
.trend-up {
  color: hsl(142 71% 45%);
}
.trend-down {
  color: hsl(0 84% 60%);
}
.trend-neutral {
  color: hsl(var(--muted-foreground) / 0.5);
}
.dim-value {
  font-size: 13px;
  color: hsl(var(--foreground) / 0.85);
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
}
.badge-success {
  background: hsl(142 71% 45% / 0.12);
  color: hsl(142 71% 35%);
}
.badge-info {
  background: hsl(217 91% 60% / 0.12);
  color: hsl(217 91% 45%);
}
.badge-warning {
  background: hsl(38 92% 50% / 0.12);
  color: hsl(38 92% 38%);
}
.badge-danger {
  background: hsl(0 84% 60% / 0.12);
  color: hsl(0 84% 48%);
}
.badge-default {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}
.score-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.score-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: hsl(var(--foreground) / 0.06);
  overflow: hidden;
}
.score-fill {
  height: 100%;
  border-radius: 3px;
  background: hsl(217 91% 60%);
  transition: width 0.4s ease;
}
.score-num {
  font-size: 13px;
  font-weight: 700;
  color: hsl(217 91% 55%);
  min-width: 28px;
  text-align: right;
}
.dim-text {
  line-height: 1.5;
  margin: 0;
}
.dim-list {
  margin: 0;
  padding-left: 16px;
}
.dim-list li {
  line-height: 1.6;
}
.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}
.dim-empty {
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 12px;
}
</style>
