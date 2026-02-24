<script setup lang="ts">
/**
 * ObservabilityView — 系统可观测性仪表盘
 *
 * Tab 1: 压缩监控 - 压缩事件时间线、压缩前后 Token 对比
 * Tab 2: Memory 工具统计 - 调用次数、类型分布、内容预览
 * Tab 3: Token 使用 - 按 Agent/Session 统计
 * Tab 4: 系统健康 - 运行时长、请求数、错误率
 */

import { ref, onMounted, onUnmounted } from 'vue';
import configManager from '@/config';

type TimeRange = '1h' | '6h' | '24h';
type TabId = 'compression' | 'memory' | 'tokens' | 'system';

interface CompressionRecord {
  timestamp: string;
  sessionId: string;
  beforeTokens: number;
  afterTokens: number;
  compressionRatio: number;
  duration: number;
}

interface MemoryRecord {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  operation: 'store' | 'retrieve' | 'search';
  success: boolean;
  duration: number;
}

interface TokenRecord {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

const activeTab = ref<TabId>('compression');
const timeRange = ref<TimeRange>('24h');
const loading = ref(false);
const error = ref<string | null>(null);

// 各 Tab 数据
const compressionData = ref<{
  records: CompressionRecord[];
  summary: { total: number; avgCompressionRatio: number; totalTokensSaved: number };
} | null>(null);
const memoryData = ref<{
  records: MemoryRecord[];
  summary: { total: number; byOperation: Record<string, number>; successRate: number };
} | null>(null);
const tokenData = ref<{
  records: TokenRecord[];
  summary: { total: number; prompt: number; completion: number; totalCost: number };
  byModel: Record<string, { requests: number; tokens: number; cost: number }>;
} | null>(null);
const systemData = ref<{
  uptimeSeconds: number;
  requests: { total: number; success: number; failed: number; successRate: number; avgDuration: number };
  tokens: { total: number };
  compressions: { total: number };
  memoryTool: { total: number };
} | null>(null);

const BASE_URL = `${configManager.getBaseUrl()}/gateway/monitoring`;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'compression', label: '压缩监控', icon: 'i-carbon-deployment-pattern' },
  { id: 'memory', label: 'Memory 工具', icon: 'i-carbon-data-base' },
  { id: 'tokens', label: 'Token 使用', icon: 'i-carbon-model-alt' },
  { id: 'system', label: '系统健康', icon: 'i-carbon-status-change' }
];

function getSinceTimestamp(): string {
  const now = new Date();
  let ms = 0;
  switch (timeRange.value) {
    case '1h':
      ms = 60 * 60 * 1000;
      break;
    case '6h':
      ms = 6 * 60 * 60 * 1000;
      break;
    case '24h':
      ms = 24 * 60 * 60 * 1000;
      break;
  }
  return new Date(now.getTime() - ms).toISOString();
}

async function fetchCompression(): Promise<void> {
  const since = getSinceTimestamp();
  const res = await fetch(`${BASE_URL}/compression?since=${since}`);
  if (!res.ok) throw new Error('Failed to load compression');
  const data = await res.json();
  compressionData.value = { records: data.records, summary: data.summary };
}

async function fetchMemory(): Promise<void> {
  const since = getSinceTimestamp();
  const res = await fetch(`${BASE_URL}/memory?since=${since}`);
  if (!res.ok) throw new Error('Failed to load memory');
  const data = await res.json();
  memoryData.value = { records: data.records, summary: data.summary };
}

async function fetchTokens(): Promise<void> {
  const since = getSinceTimestamp();
  const res = await fetch(`${BASE_URL}/tokens?since=${since}`);
  if (!res.ok) throw new Error('Failed to load tokens');
  const data = await res.json();
  tokenData.value = { records: data.records, summary: data.summary, byModel: data.byModel || {} };
}

async function fetchSystem(): Promise<void> {
  const since = getSinceTimestamp();
  const res = await fetch(`${BASE_URL}/system?since=${since}`);
  if (!res.ok) throw new Error('Failed to load system');
  const data = await res.json();
  systemData.value = data;
}

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await Promise.all([fetchCompression(), fetchMemory(), fetchTokens(), fetchSystem()]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    console.error('[ObservabilityView] 加载失败:', err);
  } finally {
    loading.value = false;
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

const operationLabels: Record<string, string> = {
  store: '写入',
  retrieve: '读取',
  search: '搜索'
};

onMounted(() => {
  loadAll();
  refreshInterval = setInterval(loadAll, 5000);
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>

<template>
  <div class="observability-view">
    <div class="view-header">
      <h1 class="view-title">系统可观测性</h1>
      <div class="header-actions">
        <select v-model="timeRange" class="time-range-select" @change="loadAll">
          <option value="1h">过去 1 小时</option>
          <option value="6h">过去 6 小时</option>
          <option value="24h">过去 24 小时</option>
        </select>
        <button class="btn-text" @click="loadAll">
          <span class="i-carbon-renew inline-block h-4 w-4" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
      </div>
    </div>

    <!-- Tab 导航 -->
    <div class="tab-nav">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id">
        <span :class="tab.icon" class="icon-sm" />
        {{ tab.label }}
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-banner">
      <span class="i-carbon-warning inline-block h-4 w-4" />
      {{ error }}
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading && !compressionData" class="loading-state">
      <span class="i-carbon-circle-dash animate-spin inline-block h-8 w-8 text-blue-500" />
      <p>加载中...</p>
    </div>

    <!-- Tab 1: 压缩监控 -->
    <div v-else-if="activeTab === 'compression'" class="tab-content">
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-deployment-pattern inline-block h-5 w-5" />
          压缩统计
        </h2>
        <div v-if="compressionData" class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">压缩次数</div>
            <div class="stat-value">{{ compressionData.summary.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">平均压缩率</div>
            <div class="stat-value">{{ (compressionData.summary.avgCompressionRatio * 100).toFixed(1) }}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">节省 Token</div>
            <div class="stat-value text-green-600">{{ formatNumber(compressionData.summary.totalTokensSaved) }}</div>
          </div>
        </div>
      </div>
      <div class="metric-section">
        <h2 class="section-title">压缩事件时间线</h2>
        <div v-if="compressionData?.records?.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>会话</th>
                <th>压缩前</th>
                <th>压缩后</th>
                <th>压缩率</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in compressionData.records" :key="i">
                <td>{{ formatTime(r.timestamp) }}</td>
                <td class="mono-cell">{{ r.sessionId.slice(-8) }}</td>
                <td>{{ formatNumber(r.beforeTokens) }}</td>
                <td>{{ formatNumber(r.afterTokens) }}</td>
                <td>{{ (r.compressionRatio * 100).toFixed(1) }}%</td>
                <td>{{ formatDuration(r.duration) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-hint">暂无压缩事件</div>
      </div>
    </div>

    <!-- Tab 2: Memory 工具 -->
    <div v-else-if="activeTab === 'memory'" class="tab-content">
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-data-base inline-block h-5 w-5" />
          Memory 工具统计
        </h2>
        <div v-if="memoryData" class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总调用</div>
            <div class="stat-value">{{ memoryData.summary.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Store</div>
            <div class="stat-value">{{ memoryData.summary.byOperation?.store ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Retrieve</div>
            <div class="stat-value">{{ memoryData.summary.byOperation?.retrieve ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Search</div>
            <div class="stat-value">{{ memoryData.summary.byOperation?.search ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功率</div>
            <div class="stat-value">{{ ((memoryData.summary.successRate ?? 0) * 100).toFixed(1) }}%</div>
          </div>
        </div>
      </div>
      <div class="metric-section">
        <h2 class="section-title">调用记录</h2>
        <div v-if="memoryData?.records?.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>会话</th>
                <th>Agent</th>
                <th>状态</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in memoryData.records" :key="i">
                <td>{{ formatTime(r.timestamp) }}</td>
                <td>{{ operationLabels[r.operation] ?? r.operation }}</td>
                <td class="mono-cell">{{ r.sessionId.slice(-8) }}</td>
                <td>{{ r.agentId ?? '-' }}</td>
                <td :class="r.success ? 'text-green-600' : 'text-red-600'">{{ r.success ? '成功' : '失败' }}</td>
                <td>{{ formatDuration(r.duration) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-hint">暂无 Memory 调用记录</div>
      </div>
    </div>

    <!-- Tab 3: Token 使用 -->
    <div v-else-if="activeTab === 'tokens'" class="tab-content">
      <div class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-model-alt inline-block h-5 w-5" />
          Token 统计
        </h2>
        <div v-if="tokenData" class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总 Token</div>
            <div class="stat-value">{{ formatNumber(tokenData.summary.total) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Prompt</div>
            <div class="stat-value">{{ formatNumber(tokenData.summary.prompt) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Completion</div>
            <div class="stat-value">{{ formatNumber(tokenData.summary.completion) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">总成本</div>
            <div class="stat-value text-orange-600">{{ formatCost(tokenData.summary.totalCost) }}</div>
          </div>
        </div>
      </div>
      <div v-if="tokenData && Object.keys(tokenData.byModel).length" class="metric-section">
        <h2 class="section-title">按模型统计</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>请求数</th>
                <th>Token</th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(stat, model) in tokenData.byModel" :key="model">
                <td class="mono-cell">{{ model }}</td>
                <td>{{ stat.requests }}</td>
                <td>{{ formatNumber(stat.tokens) }}</td>
                <td>{{ formatCost(stat.cost) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="metric-section">
        <h2 class="section-title">Token 使用记录（按 Agent/Session）</h2>
        <div v-if="tokenData?.records?.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>会话</th>
                <th>Agent</th>
                <th>Prompt</th>
                <th>Completion</th>
                <th>总计</th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in tokenData.records" :key="i">
                <td>{{ formatTime(r.timestamp) }}</td>
                <td class="mono-cell">{{ r.model }}</td>
                <td class="mono-cell">{{ r.sessionId.slice(-8) }}</td>
                <td>{{ r.agentId ?? '-' }}</td>
                <td>{{ formatNumber(r.promptTokens) }}</td>
                <td>{{ formatNumber(r.completionTokens) }}</td>
                <td>{{ formatNumber(r.totalTokens) }}</td>
                <td>{{ r.cost != null ? formatCost(r.cost) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-hint">暂无 Token 使用记录</div>
      </div>
    </div>

    <!-- Tab 4: 系统健康 -->
    <div v-else-if="activeTab === 'system'" class="tab-content">
      <div v-if="systemData" class="metric-section">
        <h2 class="section-title">
          <span class="i-carbon-status-change inline-block h-5 w-5" />
          系统健康
        </h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">运行时长</div>
            <div class="stat-value">{{ formatUptime(systemData.uptimeSeconds) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">总请求数</div>
            <div class="stat-value">{{ systemData.requests.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功</div>
            <div class="stat-value text-green-600">{{ systemData.requests.success }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">失败</div>
            <div class="stat-value text-red-600">{{ systemData.requests.failed }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功率</div>
            <div class="stat-value">{{ (systemData.requests.successRate * 100).toFixed(1) }}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">平均响应</div>
            <div class="stat-value">{{ formatDuration(systemData.requests.avgDuration) }}</div>
          </div>
        </div>
        <div class="stats-grid mt-4">
          <div class="stat-card">
            <div class="stat-label">总 Token 消耗</div>
            <div class="stat-value">{{ formatNumber(systemData.tokens.total) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">压缩次数</div>
            <div class="stat-value">{{ systemData.compressions.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Memory 调用</div>
            <div class="stat-value">{{ systemData.memoryTool.total }}</div>
          </div>
        </div>
      </div>
      <div v-else class="empty-hint">暂无系统数据</div>
    </div>
  </div>
</template>

<style scoped>
.observability-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
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
  font-size: 1.5rem;
  font-weight: 700;
  color: hsl(var(--foreground));
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.time-range-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--background));
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
  color: hsl(var(--foreground) / 0.8);
  transition: opacity 0.2s;
}

.btn-text:hover {
  opacity: 0.8;
}

.tab-nav {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 0.5rem;
  width: fit-content;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--foreground) / 0.05);
}

.tab-btn.active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-weight: 500;
  box-shadow: 0 1px 2px hsl(var(--foreground) / 0.05);
}

.icon-sm {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: hsl(0 84% 60% / 0.15);
  color: hsl(0 84% 50%);
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.metric-section {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 1rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
}

.stat-card {
  padding: 1rem;
  background: hsl(var(--muted) / 0.3);
  border-radius: 0.5rem;
}

.stat-label {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: hsl(var(--foreground));
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  background: hsl(var(--muted) / 0.4);
  color: hsl(var(--muted-foreground));
  font-weight: 500;
  border-bottom: 1px solid hsl(var(--border));
}

.data-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.mono-cell {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
}

.empty-hint {
  padding: 2rem;
  text-align: center;
  color: hsl(var(--muted-foreground) / 0.7);
  font-size: 0.875rem;
}
</style>
