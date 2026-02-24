<script setup lang="ts">
/**
 * ObservabilityView — 系统可观测性仪表盘
 *
 * 功能：
 *   1. Token 使用统计
 *   2. 请求统计
 *   3. 对话压缩监控
 *   4. Memory 工具监控
 *   5. 按模型分组统计
 */

import { ref, onMounted, onUnmounted } from 'vue';
import configManager from '@/config';

interface AggregatedMetrics {
  timeRange: {
    start: string;
    end: string;
  };
  tokens: {
    total: number;
    prompt: number;
    completion: number;
    totalCost: number;
  };
  requests: {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  };
  compressions: {
    total: number;
    avgCompressionRatio: number;
    totalTokensSaved: number;
  };
  memoryTool: {
    total: number;
    byOperation: Record<'store' | 'retrieve' | 'search', number>;
    successRate: number;
  };
  byModel: Record<
    string,
    {
      requests: number;
      tokens: number;
      cost: number;
    }
  >;
}

const metrics = ref<AggregatedMetrics | null>(null);
const loading = ref(false);
const timeRange = ref<'1h' | '24h' | '7d'>('24h');
let refreshInterval: ReturnType<typeof setInterval> | null = null;

const BASE_URL = `${configManager.getBaseUrl()}/gateway/metrics`;

onMounted(() => {
  loadMetrics();

  // 每 30 秒自动刷新
  refreshInterval = setInterval(() => {
    loadMetrics();
  }, 30000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

/**
 * 加载指标数据
 */
async function loadMetrics(): Promise<void> {
  loading.value = true;
  try {
    const since = getSinceTimestamp();
    const url = `${BASE_URL}/aggregated?since=${since}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load metrics');

    const data = await res.json();
    metrics.value = data.metrics;
  } catch (err) {
    console.error('[ObservabilityView] 加载指标失败:', err);
  } finally {
    loading.value = false;
  }
}

/**
 * 获取 since 时间戳
 */
function getSinceTimestamp(): string {
  const now = new Date();
  let ms = 0;

  switch (timeRange.value) {
    case '1h':
      ms = 60 * 60 * 1000;
      break;
    case '24h':
      ms = 24 * 60 * 60 * 1000;
      break;
    case '7d':
      ms = 7 * 24 * 60 * 60 * 1000;
      break;
  }

  return new Date(now.getTime() - ms).toISOString();
}

/**
 * 格式化数字
 */
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * 格式化成本
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/**
 * 格式化持续时间
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
</script>

<template>
  <div class="observability-view">
    <!-- 头部 -->
    <div class="view-header">
      <h1 class="view-title">系统可观测性</h1>
      <div class="header-actions">
        <select v-model="timeRange" class="time-range-select" @change="loadMetrics">
          <option value="1h">过去 1 小时</option>
          <option value="24h">过去 24 小时</option>
          <option value="7d">过去 7 天</option>
        </select>
        <button class="btn-text" @click="loadMetrics">
          <span class="i-carbon-renew inline-block h-4 w-4" />
          刷新
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && !metrics" class="loading-state">
      <span class="i-carbon-circle-dash animate-spin inline-block h-8 w-8 text-blue-500" />
      <p>加载中...</p>
    </div>

    <!-- 核心指标 -->
    <div v-else-if="metrics" class="metrics-container">
      <!-- Token 使用 -->
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-model-alt inline-block h-5 w-5" />
          Token 使用
        </h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总 Token</div>
            <div class="stat-value">{{ formatNumber(metrics.tokens.total) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Prompt Token</div>
            <div class="stat-value">{{ formatNumber(metrics.tokens.prompt) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Completion Token</div>
            <div class="stat-value">{{ formatNumber(metrics.tokens.completion) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">总成本</div>
            <div class="stat-value text-orange-600">{{ formatCost(metrics.tokens.totalCost) }}</div>
          </div>
        </div>
      </div>

      <!-- 请求统计 -->
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-status-change inline-block h-5 w-5" />
          请求统计
        </h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总请求</div>
            <div class="stat-value">{{ metrics.requests.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功</div>
            <div class="stat-value text-green-600">{{ metrics.requests.success }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">失败</div>
            <div class="stat-value text-red-600">{{ metrics.requests.failed }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功率</div>
            <div class="stat-value">{{ (metrics.requests.successRate * 100).toFixed(1) }}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">平均响应时间</div>
            <div class="stat-value">{{ formatDuration(metrics.requests.avgDuration) }}</div>
          </div>
        </div>
      </div>

      <!-- 对话压缩 -->
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-deployment-pattern inline-block h-5 w-5" />
          对话压缩
        </h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">压缩次数</div>
            <div class="stat-value">{{ metrics.compressions.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">平均压缩率</div>
            <div class="stat-value">{{ (metrics.compressions.avgCompressionRatio * 100).toFixed(1) }}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">节省 Token</div>
            <div class="stat-value text-green-600">
              {{ formatNumber(metrics.compressions.totalTokensSaved) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Memory 工具 -->
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-data-base inline-block h-5 w-5" />
          Memory 工具
        </h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总调用</div>
            <div class="stat-value">{{ metrics.memoryTool.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Store</div>
            <div class="stat-value">{{ metrics.memoryTool.byOperation.store }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Retrieve</div>
            <div class="stat-value">{{ metrics.memoryTool.byOperation.retrieve }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Search</div>
            <div class="stat-value">{{ metrics.memoryTool.byOperation.search }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功率</div>
            <div class="stat-value">{{ (metrics.memoryTool.successRate * 100).toFixed(1) }}%</div>
          </div>
        </div>
      </div>

      <!-- 按模型统计 -->
      <div v-if="Object.keys(metrics.byModel).length > 0" class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-model-builder inline-block h-5 w-5" />
          按模型统计
        </h2>
        <div class="model-stats-table">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>请求数</th>
                <th>Token</th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(stat, model) in metrics.byModel" :key="model">
                <td class="model-cell">{{ model }}</td>
                <td>{{ stat.requests }}</td>
                <td>{{ formatNumber(stat.tokens) }}</td>
                <td>{{ formatCost(stat.cost) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading" class="empty-state">
      <span class="i-carbon-chart-area inline-block h-16 w-16 text-gray-300" />
      <p class="empty-text">暂无数据</p>
      <p class="empty-hint">系统运行后，相关指标会显示在这里</p>
    </div>
  </div>
</template>

<style scoped>
.observability-view {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.time-range-select {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: white;
  font-size: 0.875rem;
  cursor: pointer;
}

.btn-text {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: opacity 0.2s;
}

.btn-text:hover {
  opacity: 0.7;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem;
}

.metrics-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.metric-section {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.5rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.stat-card {
  padding: 1rem;
  background: var(--bg-secondary);
  border-radius: 0.5rem;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.model-stats-table {
  overflow-x: auto;
}

.model-stats-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.model-stats-table th {
  text-align: left;
  padding: 0.75rem;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.model-stats-table td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.model-cell {
  font-family: monospace;
  font-size: 0.8125rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  gap: 1rem;
}

.empty-text {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-hint {
  font-size: 0.875rem;
  color: var(--text-tertiary);
}
</style>
