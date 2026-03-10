<script setup lang="ts">
/**
 * SharedDriveView — 共享网盘浏览视图
 *
 * 左右分栏布局：
 *   ┌──────────────┬─────────────────────────────┐
 *   │  目录树       │  文件内容预览                │
 *   │  (按 agent/   │  (Markdown / 代码 / 文本)    │
 *   │   date/topic) │                             │
 *   └──────────────┴─────────────────────────────┘
 *
 * 复用 WorkbenchPanel 的 previewRouter + MarkdownPreview 做文件展示。
 */

import { ref, reactive, computed, onMounted, watch } from 'vue';
import configManager from '@/config';
import ErrorDisplay from '@/components/common/ErrorDisplay.vue';
import MarkdownPreview from '@/components/agent/preview/MarkdownPreview.vue';
import { routePreview } from '@/utils/previewRouter';

interface SharedDriveEntry {
  id: string;
  agentId: string;
  topic: string;
  date: string;
  path: string;
  tags: string[];
  summary: string;
  files: string[];
  createdAt: string;
  updatedAt: string;
}

interface EntryDetail {
  entry: SharedDriveEntry;
  readme: string;
  files: string[];
}

interface StatsData {
  total: number;
  byAgent: Record<string, number>;
}

interface TreeNode {
  id: string;
  label: string;
  type: 'agent' | 'date' | 'entry' | 'file';
  children?: TreeNode[];
  entry?: SharedDriveEntry;
  filename?: string;
  entryId?: string;
}

const BASE_URL = `${configManager.getBaseUrl()}/gateway/shared-drive`;

const entries = ref<SharedDriveEntry[]>([]);
const stats = ref<StatsData | null>(null);
const loading = ref(false);
const error = ref<{ message: string; details?: string } | null>(null);
const searchKeyword = ref('');

const expandedIds = reactive(new Set<string>());

const selectedEntryId = ref<string | null>(null);
const selectedFilename = ref<string | null>(null);
const entryDetail = ref<EntryDetail | null>(null);
const fileContent = ref<string>('');
const detailLoading = ref(false);

const treeNodes = computed<TreeNode[]>(() => {
  const agentMap = new Map<string, Map<string, SharedDriveEntry[]>>();

  for (const e of entries.value) {
    if (!agentMap.has(e.agentId)) agentMap.set(e.agentId, new Map());
    const dateMap = agentMap.get(e.agentId)!;
    if (!dateMap.has(e.date)) dateMap.set(e.date, []);
    dateMap.get(e.date)!.push(e);
  }

  const result: TreeNode[] = [];

  for (const [agentId, dateMap] of agentMap) {
    const agentNodeId = `agent:${agentId}`;
    const agentNode: TreeNode = {
      id: agentNodeId,
      label: agentId,
      type: 'agent',
      children: []
    };

    const dates = [...dateMap.keys()].sort().reverse();
    for (const date of dates) {
      const dateNodeId = `date:${agentId}:${date}`;
      const dateNode: TreeNode = {
        id: dateNodeId,
        label: date,
        type: 'date',
        children: []
      };

      const dateEntries = dateMap.get(date)!;
      for (const entry of dateEntries) {
        const entryNodeId = `entry:${entry.id}`;
        const entryNode: TreeNode = {
          id: entryNodeId,
          label: entry.topic,
          type: 'entry',
          entry,
          children: entry.files.map((f) => ({
            id: `file:${entry.id}:${f}`,
            label: f,
            type: 'file' as const,
            filename: f,
            entryId: entry.id
          }))
        };
        dateNode.children!.push(entryNode);
      }

      agentNode.children!.push(dateNode);
    }

    result.push(agentNode);
  }

  return result;
});

function isExpanded(nodeId: string): boolean {
  return expandedIds.has(nodeId);
}

function toggleExpand(nodeId: string): void {
  if (expandedIds.has(nodeId)) {
    expandedIds.delete(nodeId);
  } else {
    expandedIds.add(nodeId);
  }
}

function expandParentsOf(entryId: string): void {
  for (const agentNode of treeNodes.value) {
    for (const dateNode of agentNode.children || []) {
      for (const entryNode of dateNode.children || []) {
        if (entryNode.entry?.id === entryId) {
          expandedIds.add(agentNode.id);
          expandedIds.add(dateNode.id);
          expandedIds.add(entryNode.id);
          return;
        }
      }
    }
  }
}

onMounted(() => {
  loadEntries();
  loadStats();
});

watch(entries, () => {
  for (const agentNode of treeNodes.value) {
    expandedIds.add(agentNode.id);
    for (const dateNode of agentNode.children || []) {
      expandedIds.add(dateNode.id);
    }
  }
});

async function loadEntries(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const url = searchKeyword.value
      ? `${BASE_URL}/search?keyword=${encodeURIComponent(searchKeyword.value)}`
      : `${BASE_URL}/entries?limit=200`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    entries.value = data.entries || [];
  } catch (err) {
    error.value = {
      message: '加载条目失败',
      details: err instanceof Error ? err.message : String(err)
    };
  } finally {
    loading.value = false;
  }
}

async function loadStats(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/stats`);
    if (!res.ok) return;
    stats.value = await res.json();
  } catch {
    /* ignore */
  }
}

async function handleSelectEntry(entry: SharedDriveEntry): Promise<void> {
  selectedEntryId.value = entry.id;
  selectedFilename.value = null;
  fileContent.value = '';
  detailLoading.value = true;

  expandParentsOf(entry.id);

  try {
    const res = await fetch(`${BASE_URL}/entries/${entry.id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entryDetail.value = await res.json();
  } catch (err) {
    error.value = {
      message: '加载条目详情失败',
      details: err instanceof Error ? err.message : String(err)
    };
  } finally {
    detailLoading.value = false;
  }
}

async function handleSelectFile(entryId: string, filename: string): Promise<void> {
  selectedFilename.value = filename;
  detailLoading.value = true;

  try {
    const res = await fetch(`${BASE_URL}/entries/${entryId}/files/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fileContent.value = await res.text();
  } catch (err) {
    fileContent.value = `[加载失败] ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    detailLoading.value = false;
  }
}

function handleEntryClick(entryNode: TreeNode): void {
  if (entryNode.entry) {
    handleSelectEntry(entryNode.entry);
  }
}

function handleFileClick(fileNode: TreeNode): void {
  if (!fileNode.entryId || !fileNode.filename) return;

  if (selectedEntryId.value !== fileNode.entryId) {
    const entry = entries.value.find((e) => e.id === fileNode.entryId);
    if (entry) {
      selectedEntryId.value = entry.id;
      expandParentsOf(entry.id);
      fetch(`${BASE_URL}/entries/${entry.id}`)
        .then((r) => r.json())
        .then((data) => {
          entryDetail.value = data;
        })
        .catch(() => {});
    }
  }
  handleSelectFile(fileNode.entryId, fileNode.filename);
}

function handleSearch(): void {
  loadEntries();
}

function clearSearch(): void {
  searchKeyword.value = '';
  loadEntries();
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    md: 'i-carbon-document',
    ts: 'i-carbon-code',
    js: 'i-carbon-code',
    json: 'i-carbon-json',
    txt: 'i-carbon-text-align-left',
    csv: 'i-carbon-table',
    yml: 'i-carbon-settings',
    yaml: 'i-carbon-settings',
    html: 'i-carbon-html',
    css: 'i-carbon-color-palette',
    py: 'i-carbon-code',
    sh: 'i-carbon-terminal'
  };
  return iconMap[ext] || 'i-carbon-document-blank';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

const previewTitle = computed<string>(() => {
  if (selectedFilename.value) return selectedFilename.value;
  if (entryDetail.value) return entryDetail.value.entry.topic;
  return '';
});

const previewContent = computed<string>(() => {
  if (selectedFilename.value && fileContent.value) return fileContent.value;
  if (entryDetail.value?.readme) return entryDetail.value.readme;
  return '';
});

const previewMode = computed(() => {
  const filename = selectedFilename.value;
  if (filename) {
    return routePreview(filename).mode;
  }
  if (entryDetail.value?.readme) {
    return 'markdown' as const;
  }
  return 'code' as const;
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
watch(searchKeyword, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    handleSearch();
  }, 400);
});
</script>

<template>
  <div class="sd-view">
    <!-- 顶部工具栏 -->
    <div class="sd-header">
      <div class="sd-header-left">
        <div class="sd-header-icon">
          <span class="i-carbon-folder-shared inline-block h-4 w-4" />
        </div>
        <h1 class="sd-header-title">共享网盘</h1>
        <span v-if="stats" class="sd-header-count">{{ stats.total }} 条目</span>
      </div>
      <div class="sd-header-right">
        <div class="sd-search-box">
          <span class="i-carbon-search inline-block h-3.5 w-3.5 sd-search-icon" />
          <input
            v-model="searchKeyword"
            class="sd-search-input"
            placeholder="搜索条目..."
            @keydown.enter="handleSearch" />
          <button v-if="searchKeyword" class="sd-search-clear" @click="clearSearch">
            <span class="i-carbon-close inline-block h-3 w-3" />
          </button>
        </div>
        <button class="sd-icon-btn" title="刷新" @click="loadEntries">
          <span class="i-carbon-renew inline-block h-[15px] w-[15px]" :class="{ 'animate-spin': loading }" />
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="px-4 pt-3">
      <ErrorDisplay :error="error" level="error" title="操作失败" :dismissible="true" @dismiss="error = null" />
    </div>

    <!-- 主内容区：左右分栏 -->
    <div class="sd-body">
      <!-- 左侧目录树 -->
      <aside class="sd-tree-panel">
        <div class="sd-tree-header">
          <span class="sd-tree-title">目录</span>
        </div>

        <div v-if="loading && entries.length === 0" class="sd-tree-empty">
          <span class="i-carbon-renew inline-block h-4 w-4 animate-spin opacity-20" />
        </div>

        <div v-else-if="entries.length === 0" class="sd-tree-empty">
          <span class="i-carbon-folder inline-block h-5 w-5 opacity-[0.08]" />
          <p>暂无条目</p>
        </div>

        <div v-else class="sd-tree-list">
          <template v-for="agentNode in treeNodes" :key="agentNode.id">
            <!-- Agent -->
            <div class="sd-tree-agent" @click="toggleExpand(agentNode.id)">
              <span class="sd-tree-arrow" :class="{ expanded: isExpanded(agentNode.id) }" />
              <span class="i-carbon-bot inline-block h-3.5 w-3.5 shrink-0 opacity-50" />
              <span class="sd-tree-label">{{ agentNode.label }}</span>
            </div>

            <template v-if="isExpanded(agentNode.id)">
              <template v-for="dateNode in agentNode.children" :key="dateNode.id">
                <!-- Date -->
                <div class="sd-tree-date" @click="toggleExpand(dateNode.id)">
                  <span class="sd-tree-arrow" :class="{ expanded: isExpanded(dateNode.id) }" />
                  <span class="i-carbon-calendar inline-block h-3 w-3 shrink-0 opacity-40" />
                  <span class="sd-tree-label">{{ dateNode.label }}</span>
                </div>

                <template v-if="isExpanded(dateNode.id)">
                  <template v-for="entryNode in dateNode.children" :key="entryNode.id">
                    <!-- Entry (topic) -->
                    <div
                      class="sd-tree-entry"
                      :class="{ active: selectedEntryId === entryNode.entry?.id && !selectedFilename }"
                      @click="handleEntryClick(entryNode)">
                      <span
                        v-if="entryNode.children && entryNode.children.length > 0"
                        class="sd-tree-arrow"
                        :class="{ expanded: isExpanded(entryNode.id) }"
                        @click.stop="toggleExpand(entryNode.id)" />
                      <span v-else class="sd-tree-arrow-placeholder" />
                      <span class="i-carbon-folder-details inline-block h-3.5 w-3.5 shrink-0 opacity-50" />
                      <span class="sd-tree-label" :title="entryNode.entry?.summary">
                        {{ entryNode.label }}
                      </span>
                    </div>

                    <!-- Files -->
                    <template v-if="isExpanded(entryNode.id) && entryNode.children">
                      <div
                        v-for="fileNode in entryNode.children"
                        :key="fileNode.id"
                        class="sd-tree-file"
                        :class="{
                          active: selectedFilename === fileNode.filename && selectedEntryId === fileNode.entryId
                        }"
                        @click="handleFileClick(fileNode)">
                        <span :class="getFileIcon(fileNode.label)" class="inline-block h-3 w-3 shrink-0 opacity-40" />
                        <span class="sd-tree-label">{{ fileNode.label }}</span>
                      </div>
                    </template>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </div>
      </aside>

      <!-- 右侧内容预览 -->
      <main class="sd-preview-panel">
        <!-- 未选择状态 -->
        <div v-if="!selectedEntryId" class="sd-preview-empty">
          <div class="sd-preview-empty-icon">
            <span class="i-carbon-folder-shared inline-block h-8 w-8" />
          </div>
          <p class="sd-preview-empty-heading">选择一个条目查看详情</p>
          <p class="sd-preview-empty-sub">从左侧目录树选择文件或条目</p>
        </div>

        <!-- 加载中 -->
        <div v-else-if="detailLoading" class="sd-preview-empty">
          <span class="i-carbon-renew inline-block h-5 w-5 animate-spin opacity-20" />
        </div>

        <!-- 内容展示 -->
        <template v-else-if="entryDetail">
          <!-- 预览头部（条目元信息） -->
          <div class="sd-preview-header">
            <div class="sd-preview-title-row">
              <span class="sd-preview-title">{{ previewTitle }}</span>
              <div v-if="entryDetail.entry.tags.length > 0" class="sd-preview-tags">
                <span v-for="tag in entryDetail.entry.tags" :key="tag" class="sd-tag">{{ tag }}</span>
              </div>
            </div>
            <div class="sd-preview-meta">
              <span class="sd-meta-item">
                <span class="i-carbon-bot inline-block h-3 w-3 opacity-40" />
                {{ entryDetail.entry.agentId }}
              </span>
              <span class="sd-meta-item">
                <span class="i-carbon-calendar inline-block h-3 w-3 opacity-40" />
                {{ entryDetail.entry.date }}
              </span>
              <span class="sd-meta-item">
                <span class="i-carbon-time inline-block h-3 w-3 opacity-40" />
                {{ formatTime(entryDetail.entry.createdAt) }}
              </span>
              <span v-if="entryDetail.files.length > 0" class="sd-meta-item">
                <span class="i-carbon-document inline-block h-3 w-3 opacity-40" />
                {{ entryDetail.files.length }} 文件
              </span>
            </div>
            <p v-if="entryDetail.entry.summary && !selectedFilename" class="sd-preview-summary">
              {{ entryDetail.entry.summary }}
            </p>
          </div>

          <!-- Markdown 预览 -->
          <div v-if="previewMode === 'markdown' && previewContent" class="sd-preview-content sd-md-wrapper">
            <MarkdownPreview file-path="inline.md" :content="previewContent" />
          </div>

          <!-- 代码/文本 预览 -->
          <div v-else-if="previewContent" class="sd-preview-content">
            <pre class="sd-code-block"><code>{{ previewContent }}</code></pre>
          </div>

          <!-- 空内容 -->
          <div v-else class="sd-preview-content sd-empty-content">
            <p>该条目暂无内容</p>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.sd-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

/* ====== Header ====== */
.sd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.sd-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sd-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.sd-header-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.sd-header-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground));
}

.sd-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sd-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.sd-icon-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

/* ====== Search ====== */
.sd-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.5);
  transition: all 0.15s ease;
}

.sd-search-box:focus-within {
  border-color: hsl(var(--primary) / 0.3);
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.06);
}

.sd-search-icon {
  color: hsl(var(--muted-foreground) / 0.4);
  flex-shrink: 0;
}

.sd-search-input {
  width: 160px;
  font-size: 12px;
  color: hsl(var(--foreground));
  background: transparent;
  border: none;
  outline: none;
}

.sd-search-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.35);
}

.sd-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: hsl(var(--muted-foreground) / 0.4);
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.sd-search-clear:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.6);
}

/* ====== Body ====== */
.sd-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ====== Tree Panel ====== */
.sd-tree-panel {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.4);
}

.sd-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.15);
}

.sd-tree-title {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  user-select: none;
}

.sd-tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.sd-tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 12px;
  user-select: none;
}

/* ====== Tree arrows ====== */
.sd-tree-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 3px;
  transition: transform 0.15s ease;
  cursor: pointer;
}

.sd-tree-arrow::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 4px 0 4px 6px;
  border-color: transparent transparent transparent hsl(var(--foreground) / 0.25);
  transition: transform 0.15s ease;
}

.sd-tree-arrow.expanded::before {
  transform: rotate(90deg);
}

.sd-tree-arrow:hover {
  background: hsl(var(--foreground) / 0.06);
}

.sd-tree-arrow-placeholder {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.sd-tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ====== Tree node rows ====== */
.sd-tree-agent {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.75);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}

.sd-tree-agent:hover {
  background: hsl(var(--foreground) / 0.03);
}

.sd-tree-date {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px 24px;
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.7);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}

.sd-tree-date:hover {
  background: hsl(var(--foreground) / 0.03);
}

.sd-tree-entry {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px 42px;
  font-size: 12px;
  color: hsl(var(--foreground) / 0.65);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  margin: 0 4px;
  transition: all 0.12s ease;
}

.sd-tree-entry:hover {
  background: hsl(var(--foreground) / 0.04);
}

.sd-tree-entry.active {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

.sd-tree-file {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 64px;
  font-size: 11.5px;
  color: hsl(var(--foreground) / 0.55);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  margin: 0 4px;
  transition: all 0.12s ease;
}

.sd-tree-file:hover {
  background: hsl(var(--foreground) / 0.04);
}

.sd-tree-file.active {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

/* ====== Preview Panel ====== */
.sd-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.sd-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  user-select: none;
}

.sd-preview-empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.3);
}

.sd-preview-empty-heading {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.6);
}

.sd-preview-empty-sub {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.45);
}

/* ====== Preview header ====== */
.sd-preview-header {
  padding: 14px 20px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
  flex-shrink: 0;
}

.sd-preview-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.sd-preview-title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.sd-preview-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.sd-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.7);
}

.sd-preview-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sd-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.55);
}

.sd-preview-summary {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.6);
}

/* ====== Preview content ====== */
.sd-preview-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.sd-md-wrapper {
  padding: 0;
}

.sd-md-wrapper :deep(.markdown-preview) {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  padding: 20px 24px;
}

.sd-md-wrapper :deep(.prose) {
  max-width: none;
  color: hsl(var(--foreground) / 0.85);
  font-size: 13.5px;
  line-height: 1.7;
}

.sd-md-wrapper :deep(.prose h1) {
  font-size: 1.4em;
  margin-top: 1.2em;
}

.sd-md-wrapper :deep(.prose h2) {
  font-size: 1.2em;
  margin-top: 1em;
}

.sd-md-wrapper :deep(.prose h3) {
  font-size: 1.05em;
}

.sd-md-wrapper :deep(.prose code) {
  font-size: 0.85em;
  padding: 1px 5px;
  border-radius: 4px;
  background: hsl(var(--foreground) / 0.06);
}

.sd-md-wrapper :deep(.prose pre) {
  background: hsl(var(--foreground) / 0.04);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 12px;
  overflow-x: auto;
}

.sd-code-block {
  font-family: var(--font-family-mono, 'SF Mono', 'Fira Code', monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: hsl(var(--foreground) / 0.8);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 16px 20px;
}

.sd-empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 13px;
}

/* ====== Scrollbar ====== */
.sd-tree-list::-webkit-scrollbar,
.sd-preview-content::-webkit-scrollbar {
  width: 4px;
}

.sd-tree-list::-webkit-scrollbar-thumb,
.sd-preview-content::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.06);
  border-radius: 4px;
}

.sd-tree-list::-webkit-scrollbar-thumb:hover,
.sd-preview-content::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.12);
}
</style>
