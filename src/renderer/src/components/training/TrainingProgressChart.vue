<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import VChart from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import type { TrainingRoundResult } from '@shared/types/training';

/**
 * 训练进度图表组件
 * 显示得分随轮次变化的折线图
 */

const props = defineProps<{
  results: TrainingRoundResult[];
  title?: string;
}>();

// 计算移动平均（平滑曲线）
const calculateMovingAverage = (data: number[], windowSize: number = 5): number[] => {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
    result.push(Math.round(avg * 10) / 10);
  }
  return result;
};

// Echarts 配置
const chartOption = computed<EChartsOption>(() => {
  const rounds = props.results.map((r) => r.round);
  const scores = props.results.map((r) => r.evaluation.score);
  const movingAvg = calculateMovingAverage(scores);

  return {
    title: {
      text: props.title || '训练进度曲线',
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 'normal'
      }
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const paramsArray = params as Array<{ seriesName: string; data: number; axisValue: string }>;
        const round = paramsArray[0].axisValue;
        const score = paramsArray[0].data;
        const avg = paramsArray[1].data;
        return `轮次 ${round}<br/>当前得分: ${score}<br/>移动平均: ${avg}`;
      }
    },
    legend: {
      data: ['当前得分', '移动平均'],
      bottom: 10
    },
    xAxis: {
      type: 'category',
      data: rounds,
      name: '训练轮次',
      nameLocation: 'middle',
      nameGap: 30,
      boundaryGap: false
    },
    yAxis: {
      type: 'value',
      name: '得分',
      min: 0,
      max: 100
    },
    series: [
      {
        name: '当前得分',
        type: 'line',
        data: scores,
        smooth: false,
        itemStyle: {
          color: '#3b82f6'
        },
        emphasis: {
          focus: 'series'
        }
      },
      {
        name: '移动平均',
        type: 'line',
        data: movingAvg,
        smooth: true,
        itemStyle: {
          color: '#10b981'
        },
        lineStyle: {
          width: 2
        },
        emphasis: {
          focus: 'series'
        }
      }
    ],
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      containLabel: true
    }
  };
});

// 响应式图表大小
const chartHeight = ref('400px');

// 监听数据变化，自动更新图表
watch(
  () => props.results,
  () => {
    // 图表会自动重新渲染
  },
  { deep: true }
);
</script>

<template>
  <div class="training-progress-chart">
    <VChart :option="chartOption" :style="{ height: chartHeight }" autoresize />
  </div>
</template>

<style scoped>
.training-progress-chart {
  width: 100%;
  min-height: 400px;
}
</style>
