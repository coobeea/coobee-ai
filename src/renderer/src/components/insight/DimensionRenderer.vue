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

function getEnumBadgeClass(value: unknown): string {
  const s = String(value);
  if (['强烈', '优秀', '高', '强烈推荐', '推荐'].includes(s)) return 'bg-success/12 text-success';
  if (['偏强', '良好', '中'].includes(s)) return 'bg-info/12 text-info';
  if (['一般', '待定'].includes(s)) return 'bg-warning/12 text-warning';
  if (['观望', '较差', '低', '不推荐', '拒绝'].includes(s)) return 'bg-error/12 text-error';
  return 'bg-muted text-muted-foreground';
}
</script>

<template>
  <div class="rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:bg-accent/30">
    <div class="mb-1.5 flex items-center gap-1.5">
      <span v-if="props.icon" class="text-sm">{{ props.icon }}</span>
      <span class="text-xs font-semibold text-muted-foreground/80">{{ props.dimension.label }}</span>
      <span
        v-if="props.showTrend && props.change"
        class="ml-auto text-sm font-bold"
        :class="{
          'text-success': props.change.direction === 'up',
          'text-error': props.change.direction === 'down',
          'text-muted-foreground/50': props.change.direction === 'stable' || props.change.direction === 'changed'
        }">
        {{ getTrendIcon(props.change.direction) }}
      </span>
    </div>
    <div class="text-sm text-foreground/85">
      <!-- enum -->
      <template v-if="props.dimension.type === 'enum'">
        <span
          class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="getEnumBadgeClass(props.dimension.value)">
          {{ props.dimension.value }}
        </span>
      </template>

      <!-- score -->
      <template v-else-if="props.dimension.type === 'score'">
        <div class="flex items-center gap-2">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-info transition-all duration-400"
              :style="{ width: `${Number(props.dimension.value)}%` }" />
          </div>
          <span class="min-w-7 text-right text-sm font-bold text-info">
            {{ props.dimension.value }}
          </span>
        </div>
      </template>

      <!-- text -->
      <template v-else-if="props.dimension.type === 'text'">
        <p class="leading-relaxed">{{ props.dimension.value || '—' }}</p>
      </template>

      <!-- list -->
      <template v-else-if="props.dimension.type === 'list'">
        <ul
          v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length"
          class="list-disc space-y-0.5 pl-4 text-sm">
          <li v-for="(item, i) in props.dimension.value as string[]" :key="i">{{ item }}</li>
        </ul>
        <span v-else class="text-xs text-muted-foreground/50">暂无数据</span>
      </template>

      <!-- tags -->
      <template v-else-if="props.dimension.type === 'tags'">
        <div
          v-if="Array.isArray(props.dimension.value) && (props.dimension.value as string[]).length"
          class="flex flex-wrap gap-1">
          <span
            v-for="(tag, i) in props.dimension.value as string[]"
            :key="i"
            class="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {{ tag }}
          </span>
        </div>
        <span v-else class="text-xs text-muted-foreground/50">暂无</span>
      </template>

      <!-- progress -->
      <template v-else-if="props.dimension.type === 'progress'">
        <span class="inline-block rounded-full bg-info/12 px-2.5 py-0.5 text-xs font-semibold text-info">
          {{ props.dimension.value || '—' }}
        </span>
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
