<script setup lang="ts">
/**
 * BrainView — 智库系统
 *
 * 经验包浏览和管理：
 * - 经验包列表展示
 * - 统计信息展示
 * - 按类别/状态筛选
 *
 * 数据源：Gateway brain.* 方法
 */

import { ref, computed, onMounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

interface Package {
  package_id: string;
  pattern: {
    name: string;
    summary: string;
    category: string;
  };
  practice: {
    name: string;
    summary: string;
    confidence: number;
  };
  status: string;
  usage_count: number;
  created_at: string;
}

interface Stats {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  recentPackages: Array<{ package_id: string; pattern_name: string; created_at: string }>;
}

const loading = ref(false);
const stats = ref<Stats | null>(null);
const packages = ref<Package[]>([]);
const selectedCategory = ref<string | null>(null);
const selectedStatus = ref<string | null>(null);

// 加载统计信息
async function loadStats(): Promise<void> {
  try {
    const result = (await gateway.request('brain.stats', {})) as { data: Stats };
    stats.value = result.data;
  } catch (err: unknown) {
    console.error('[BrainView] Failed to load stats:', err);
  }
}

// 加载经验包列表
async function loadPackages(): Promise<void> {
  loading.value = true;
  try {
    const result = (await gateway.request('brain.list', {
      limit: 50,
      offset: 0,
      category: selectedCategory.value || undefined,
      status: selectedStatus.value || undefined
    })) as { data: { packages: Package[] } };

    packages.value = result.data.packages;
  } catch (err: unknown) {
    console.error('[BrainView] Failed to load packages:', err);
    packages.value = [];
  } finally {
    loading.value = false;
  }
}

// 刷新
async function handleRefresh(): Promise<void> {
  await Promise.all([loadStats(), loadPackages()]);
}

// 筛选
function filterByCategory(category: string | null): void {
  selectedCategory.value = category;
  loadPackages();
}

function filterByStatus(status: string | null): void {
  selectedStatus.value = status;
  loadPackages();
}

// 类别标签
const categoryLabels: Record<string, string> = {
  repair: '修复',
  optimize: '优化',
  innovate: '创新'
};

// 状态标签
const statusLabels: Record<string, string> = {
  candidate: '候选',
  validated: '已验证',
  promoted: '已推广'
};

// 计算类别按钮
const categoryButtons = computed(() => {
  if (!stats.value) return [];
  return Object.entries(stats.value.byCategory).map(([category, count]) => ({
    category,
    label: categoryLabels[category] || category,
    count
  }));
});

// 计算状态按钮
const statusButtons = computed(() => {
  if (!stats.value) return [];
  return Object.entries(stats.value.byStatus).map(([status, count]) => ({
    status,
    label: statusLabels[status] || status,
    count
  }));
});

onMounted(() => {
  handleRefresh();
});
</script>

<template>
  <div class="brain-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <div class="header-icon">
          <span class="i-carbon-catalog inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">智库</h1>
        <span v-if="stats" class="task-count">共 {{ stats.total }} 个经验包</span>
      </div>
      <div class="header-right">
        <button class="refresh-btn" title="刷新" @click="handleRefresh">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
        </button>
      </div>
    </header>

    <!-- 内容区域 -->
    <div class="content">
      <!-- 统计卡片 -->
      <section v-if="stats" class="stats-section">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">
              <span class="i-carbon-catalog inline-block h-5 w-5" />
            </div>
            <div class="stat-content">
              <div class="stat-value">{{ stats.total }}</div>
              <div class="stat-label">总经验包</div>
            </div>
          </div>

          <div v-for="cat in categoryButtons" :key="cat.category" class="stat-card">
            <div class="stat-icon" :class="`category-${cat.category}`">
              <span
                :class="[
                  'inline-block h-5 w-5',
                  cat.category === 'repair'
                    ? 'i-carbon-rule-test'
                    : cat.category === 'optimize'
                      ? 'i-carbon-improve-relevance'
                      : 'i-carbon-innovation'
                ]" />
            </div>
            <div class="stat-content">
              <div class="stat-value">{{ cat.count }}</div>
              <div class="stat-label">{{ cat.label }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 筛选器 -->
      <section class="filter-section">
        <div class="filter-group">
          <span class="filter-label">类别：</span>
          <button :class="['filter-btn', { active: selectedCategory === null }]" @click="filterByCategory(null)">
            全部
          </button>
          <button
            v-for="cat in categoryButtons"
            :key="cat.category"
            :class="['filter-btn', { active: selectedCategory === cat.category }]"
            @click="filterByCategory(cat.category)">
            {{ cat.label }} ({{ cat.count }})
          </button>
        </div>

        <div class="filter-group">
          <span class="filter-label">状态：</span>
          <button :class="['filter-btn', { active: selectedStatus === null }]" @click="filterByStatus(null)">
            全部
          </button>
          <button
            v-for="st in statusButtons"
            :key="st.status"
            :class="['filter-btn', { active: selectedStatus === st.status }]"
            @click="filterByStatus(st.status)">
            {{ st.label }} ({{ st.count }})
          </button>
        </div>
      </section>

      <!-- 经验包列表 -->
      <section class="packages-section">
        <div v-if="loading" class="loading">
          <span class="i-carbon-in-progress inline-block h-6 w-6 animate-spin" />
          <p>加载中...</p>
        </div>

        <div v-else-if="packages.length === 0" class="empty">
          <span class="i-carbon-catalog inline-block h-12 w-12 opacity-20" />
          <p>暂无经验包</p>
        </div>

        <div v-else class="packages-grid">
          <div v-for="pkg in packages" :key="pkg.package_id" class="package-card">
            <div class="package-header">
              <span
                :class="[
                  'category-badge',
                  pkg.pattern.category === 'repair'
                    ? 'repair'
                    : pkg.pattern.category === 'optimize'
                      ? 'optimize'
                      : 'innovate'
                ]">
                {{ categoryLabels[pkg.pattern.category] }}
              </span>
              <span class="confidence">{{ Math.round(pkg.practice.confidence * 100) }}%</span>
            </div>

            <h3 class="package-title">{{ pkg.pattern.name }}</h3>
            <p class="package-summary">{{ pkg.pattern.summary }}</p>

            <div class="package-meta">
              <span class="meta-item">
                <span class="i-carbon-document inline-block h-3.5 w-3.5" />
                {{ pkg.practice.name }}
              </span>
              <span class="meta-item">
                <span class="i-carbon-view inline-block h-3.5 w-3.5" />
                使用 {{ pkg.usage_count }} 次
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.brain-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.task-count {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.7);
  margin-left: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.refresh-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground) / 0.7);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* 统计卡片 */
.stats-section {
  margin-bottom: 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card));
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.stat-icon.category-repair {
  background: hsl(220 70% 50% / 0.1);
  color: hsl(220 70% 50%);
}

.stat-icon.category-optimize {
  background: hsl(160 60% 50% / 0.1);
  color: hsl(160 60% 50%);
}

.stat-icon.category-innovate {
  background: hsl(280 60% 60% / 0.1);
  color: hsl(280 60% 60%);
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: hsl(var(--foreground));
  line-height: 1;
}

.stat-label {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-top: 4px;
}

/* 筛选器 */
.filter-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card));
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.filter-btn {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border) / 0.3);
  transition: all 0.15s ease;
}

.filter-btn:hover {
  background: hsl(var(--muted) / 0.6);
  color: hsl(var(--foreground));
}

.filter-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  border-color: hsl(var(--primary) / 0.3);
}

/* 经验包列表 */
.packages-section {
  min-height: 300px;
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: hsl(var(--muted-foreground));
}

.packages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.package-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card));
  transition: all 0.2s ease;
}

.package-card:hover {
  border-color: hsl(var(--border));
  box-shadow: 0 4px 12px hsl(var(--foreground) / 0.05);
  transform: translateY(-2px);
}

.package-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.category-badge {
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.category-badge.repair {
  background: hsl(220 70% 50% / 0.1);
  color: hsl(220 70% 50%);
}

.category-badge.optimize {
  background: hsl(160 60% 50% / 0.1);
  color: hsl(160 60% 50%);
}

.category-badge.innovate {
  background: hsl(280 60% 60% / 0.1);
  color: hsl(280 60% 60%);
}

.confidence {
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  padding: 3px 8px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.4);
}

.package-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
  line-height: 1.4;
}

.package-summary {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.package-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid hsl(var(--border) / 0.3);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
