<script setup lang="ts">
/**
 * BrainMonitorView — Brain Skill 使用监控视图
 *
 * 功能：
 *   1. 显示 Brain 工具使用统计
 *   2. 显示搜索命中率
 *   3. 显示最近调用记录
 *   4. 按 Agent 分组统计
 */

import { ref, onMounted, computed } from 'vue';
import configManager from '@/config';

interface BrainCallRecord {
  id: string;
  toolType: 'search' | 'publish';
  agentId: string;
  timestamp: string;
  success: boolean;
  hit?: boolean;
  query?: string;
  resultCount?: number;
  topic?: string;
  error?: string;
}

interface BrainStats {
  totalSearches: number;
  totalPublishes: number;
  searchHits: number;
  hitRate: number;
  successRate: number;
  byAgent: Record<
    string,
    {
      searches: number;
      publishes: number;
      hits: number;
      hitRate: number;
    }
  >;
  recentRecords: BrainCallRecord[];
}

const stats = ref<BrainStats | null>(null);
const records = ref<BrainCallRecord[]>([]);
const loading = ref(false);
const selectedAgent = ref<string>('all');

const BASE_URL = `${configManager.getBaseUrl()}/gateway/brain-metrics`;

onMounted(() => {
  loadStats();
  loadRecords();

  // 每 30 秒自动刷新
  setInterval(() => {
    loadStats();
    loadRecords();
  }, 30000);
});

/**
 * 加载统计数据
 */
async function loadStats(): Promise<void> {
  loading.value = true;
  try {
    const url =
      selectedAgent.value === 'all' ? `${BASE_URL}/stats` : `${BASE_URL}/stats?agentId=${selectedAgent.value}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load stats');

    const data = await res.json();
    stats.value = data.stats;
  } catch (err) {
    console.error('[BrainMonitorView] 加载统计失败:', err);
  } finally {
    loading.value = false;
  }
}

/**
 * 加载调用记录
 */
async function loadRecords(): Promise<void> {
  try {
    const url =
      selectedAgent.value === 'all'
        ? `${BASE_URL}/records?limit=100`
        : `${BASE_URL}/records?limit=100&agentId=${selectedAgent.value}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load records');

    const data = await res.json();
    records.value = data.records;
  } catch (err) {
    console.error('[BrainMonitorView] 加载记录失败:', err);
  }
}

/**
 * 清空记录
 */
async function clearRecords(): Promise<void> {
  if (!confirm('确定要清空所有记录吗？此操作不可撤销。')) return;

  try {
    const res = await fetch(`${BASE_URL}/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear records');

    await loadStats();
    await loadRecords();
  } catch (err) {
    console.error('[BrainMonitorView] 清空记录失败:', err);
    alert('清空失败');
  }
}

/**
 * 格式化时间
 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

/**
 * 获取所有 Agent ID
 */
const agentIds = computed(() => {
  if (!stats.value) return [];
  return Object.keys(stats.value.byAgent);
});
</script>

<template>
  <div class="brain-monitor-view">
    <!-- 头部 -->
    <div class="view-header">
      <h1 class="view-title">智库使用监控</h1>
      <div class="header-actions">
        <select
          v-model="selectedAgent"
          class="agent-select"
          @change="
            loadStats();
            loadRecords();
          ">
          <option value="all">全部 Agent</option>
          <option v-for="agentId in agentIds" :key="agentId" :value="agentId">
            {{ agentId }}
          </option>
        </select>
        <button class="btn-text text-red-600" @click="clearRecords">
          <span class="i-carbon-trash-can inline-block h-4 w-4" />
          清空记录
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && !stats" class="loading-state">
      <span class="i-carbon-circle-dash animate-spin inline-block h-8 w-8 text-blue-500" />
      <p>加载中...</p>
    </div>

    <!-- 统计卡片 -->
    <div v-else-if="stats" class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon bg-blue-100 text-blue-600">
          <span class="i-carbon-search inline-block h-6 w-6" />
        </div>
        <div class="stat-content">
          <div class="stat-label">总搜索次数</div>
          <div class="stat-value">{{ stats.totalSearches }}</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon bg-green-100 text-green-600">
          <span class="i-carbon-upload inline-block h-6 w-6" />
        </div>
        <div class="stat-content">
          <div class="stat-label">总发布次数</div>
          <div class="stat-value">{{ stats.totalPublishes }}</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon bg-purple-100 text-purple-600">
          <span class="i-carbon-percentage inline-block h-6 w-6" />
        </div>
        <div class="stat-content">
          <div class="stat-label">搜索命中率</div>
          <div class="stat-value">{{ (stats.hitRate * 100).toFixed(1) }}%</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon bg-orange-100 text-orange-600">
          <span class="i-carbon-checkmark-filled inline-block h-6 w-6" />
        </div>
        <div class="stat-content">
          <div class="stat-label">成功率</div>
          <div class="stat-value">{{ (stats.successRate * 100).toFixed(1) }}%</div>
        </div>
      </div>
    </div>

    <!-- 按 Agent 统计 -->
    <div v-if="stats && selectedAgent === 'all' && agentIds.length > 0" class="agent-stats">
      <h2 class="section-title">按 Agent 统计</h2>
      <div class="agent-stats-grid">
        <div v-for="(agentId, index) in agentIds" :key="index" class="agent-stat-card">
          <div class="agent-stat-header">
            <span class="agent-id">{{ agentId }}</span>
          </div>
          <div class="agent-stat-body">
            <div class="agent-stat-item">
              <span class="label">搜索:</span>
              <span class="value">{{ stats.byAgent[agentId].searches }}</span>
            </div>
            <div class="agent-stat-item">
              <span class="label">发布:</span>
              <span class="value">{{ stats.byAgent[agentId].publishes }}</span>
            </div>
            <div class="agent-stat-item">
              <span class="label">命中率:</span>
              <span class="value">{{ (stats.byAgent[agentId].hitRate * 100).toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近记录 -->
    <div v-if="records.length > 0" class="recent-records">
      <h2 class="section-title">最近调用记录</h2>
      <div class="records-table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>Agent</th>
              <th>内容</th>
              <th>结果</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record.id">
              <td class="time-cell">{{ formatTime(record.timestamp) }}</td>
              <td>
                <span v-if="record.toolType === 'search'" class="badge badge-blue"> 搜索 </span>
                <span v-else class="badge badge-green">发布</span>
              </td>
              <td class="agent-cell">{{ record.agentId }}</td>
              <td class="content-cell">
                <span v-if="record.toolType === 'search'">{{ record.query || '-' }}</span>
                <span v-else>{{ record.topic || '-' }}</span>
              </td>
              <td class="result-cell">
                <span v-if="record.toolType === 'search'">
                  {{ record.hit ? `命中 (${record.resultCount} 条)` : '未命中' }}
                </span>
                <span v-else>-</span>
              </td>
              <td>
                <span v-if="record.success" class="badge badge-success">成功</span>
                <span v-else class="badge badge-error" :title="record.error">失败</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading" class="empty-state">
      <span class="i-carbon-chart-area inline-block h-16 w-16 text-gray-300" />
      <p class="empty-text">暂无调用记录</p>
      <p class="empty-hint">Brain 工具被调用后，相关统计会显示在这里</p>
    </div>
  </div>
</template>

<style scoped>
.brain-monitor-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
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

.agent-select {
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  display: flex;
  gap: 1rem;
  padding: 1.5rem;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.75rem;
  flex-shrink: 0;
}

.stat-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--text-primary);
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.agent-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.agent-stat-card {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  overflow: hidden;
}

.agent-stat-header {
  padding: 0.75rem 1rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.agent-id {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.agent-stat-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.agent-stat-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
}

.agent-stat-item .label {
  color: var(--text-secondary);
}

.agent-stat-item .value {
  font-weight: 600;
  color: var(--text-primary);
}

.recent-records {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  padding: 1.5rem;
}

.records-table {
  overflow-x: auto;
}

.records-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.records-table th {
  text-align: left;
  padding: 0.75rem;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.records-table td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.time-cell {
  color: var(--text-secondary);
  white-space: nowrap;
}

.agent-cell {
  font-family: monospace;
  font-size: 0.8125rem;
}

.content-cell {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-cell {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.badge-blue {
  background: #dbeafe;
  color: #1e40af;
}

.badge-green {
  background: #d1fae5;
  color: #065f46;
}

.badge-success {
  background: #d1fae5;
  color: #065f46;
}

.badge-error {
  background: #fee2e2;
  color: #991b1b;
  cursor: help;
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
