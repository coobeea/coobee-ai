<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import type { TrainingRoundResult } from '@shared/types/training';

/**
 * 维度雷达图组件
 * 对比初始和最终的各维度得分
 */

const props = defineProps<{
  results: TrainingRoundResult[];
  title?: string;
}>();

// 提取所有维度
const extractDimensions = (results: TrainingRoundResult[]): Map<string, { initial: number[]; final: number[] }> => {
  const dimensionMap = new Map<string, { initial: number[]; final: number[] }>();

  // 收集前 10% 和后 10% 的数据
  const initialCount = Math.max(1, Math.floor(results.length * 0.1));
  const finalCount = Math.max(1, Math.floor(results.length * 0.1));

  const initialResults = results.slice(0, initialCount);
  const finalResults = results.slice(-finalCount);

  // 遍历所有结果，收集维度数据
  const processResults = (resGroup: TrainingRoundResult[], target: 'initial' | 'final'): void => {
    resGroup.forEach((r) => {
      Object.entries(r.evaluation.dimensions).forEach(([dimension, score]) => {
        if (!dimensionMap.has(dimension)) {
          dimensionMap.set(dimension, { initial: [], final: [] });
        }
        dimensionMap.get(dimension)![target].push(score);
      });
    });
  };

  processResults(initialResults, 'initial');
  processResults(finalResults, 'final');

  return dimensionMap;
};

// 计算维度平均分
const calculateAverageScores = (): {
  indicators: Array<{ name: string; max: number }>;
  initialScores: number[];
  finalScores: number[];
} => {
  if (props.results.length === 0) {
    return {
      indicators: [],
      initialScores: [],
      finalScores: []
    };
  }

  const dimensionMap = extractDimensions(props.results);

  const indicators: Array<{ name: string; max: number }> = [];
  const initialScores: number[] = [];
  const finalScores: number[] = [];

  dimensionMap.forEach((scores, dimension) => {
    const initialAvg = scores.initial.reduce((sum, s) => sum + s, 0) / scores.initial.length;
    const finalAvg = scores.final.reduce((sum, s) => sum + s, 0) / scores.final.length;

    indicators.push({ name: dimension, max: 100 });
    initialScores.push(Math.round(initialAvg * 10) / 10);
    finalScores.push(Math.round(finalAvg * 10) / 10);
  });

  return { indicators, initialScores, finalScores };
};

// Echarts 配置
const chartOption = computed(() => {
  const { indicators, initialScores, finalScores } = calculateAverageScores();

  if (indicators.length === 0) {
    return {
      title: {
        text: props.title || '维度雷达图',
        left: 'center',
        subtext: '暂无数据'
      }
    };
  }

  return {
    title: {
      text: props.title || '维度雷达图',
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 'normal'
      }
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const param = params as { name: string; value: number[] };
        const dimension = indicators.map((ind) => ind.name);
        return `${param.name}<br/>${dimension.map((d, i) => `${d}: ${param.value[i]}`).join('<br/>')}`;
      }
    },
    legend: {
      data: ['初始', '最终'],
      bottom: 10
    },
    radar: {
      indicator: indicators,
      splitNumber: 5,
      splitLine: {
        lineStyle: {
          color: '#e5e7eb'
        }
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ['rgba(250, 250, 250, 0.3)', 'rgba(200, 200, 200, 0.3)']
        }
      },
      axisName: {
        color: '#6b7280'
      }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: initialScores,
            name: '初始',
            itemStyle: {
              color: '#94a3b8'
            },
            areaStyle: {
              color: 'rgba(148, 163, 184, 0.2)'
            }
          },
          {
            value: finalScores,
            name: '最终',
            itemStyle: {
              color: '#3b82f6'
            },
            areaStyle: {
              color: 'rgba(59, 130, 246, 0.2)'
            }
          }
        ],
        emphasis: {
          lineStyle: {
            width: 3
          }
        }
      }
    ]
  } as EChartsOption;
});
</script>

<template>
  <div class="dimension-radar-chart">
    <VChart :option="chartOption" style="height: 400px" autoresize />
  </div>
</template>

<style scoped>
.dimension-radar-chart {
  width: 100%;
  min-height: 400px;
}
</style>
