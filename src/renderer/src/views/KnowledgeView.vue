<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  listKnowledgeBases,
  getKnowledgeBase,
  getKnowledgeTree,
  readKnowledgeFile,
  deleteKnowledgeBase,
  createKnowledgeBase,
  uploadSource,
  uploadZipSource,
  buildKnowledgeBase,
  listSources
} from '@/api/knowledge';
import type { KnowledgeBaseMeta, KnowledgeTreeNode, SourceMaterial } from '@shared/types/knowledge';

type ViewMode = 'list' | 'browse';

const router = useRouter();
const mode = ref<ViewMode>('list');
const kbList = ref<KnowledgeBaseMeta[]>([]);
const currentKb = ref<KnowledgeBaseMeta | null>(null);
const tree = ref<KnowledgeTreeNode[]>([]);
const sources = ref<SourceMaterial[]>([]);

const selectedFilePath = ref('');
const selectedFileContent = ref('');
const fileLoading = ref(false);

const expandedDirs = ref<Set<string>>(new Set());

const showCreateDialog = ref(false);
const newName = ref('');
const newDesc = ref('');
const pendingFiles = ref<File[]>([]);
const creating = ref(false);

const showUploadDialog = ref(false);
const uploadFiles = ref<File[]>([]);
const uploading = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const statusLabel = computed(() => {
  const s = currentKb.value?.status;
  const labels: Record<string, string> = {
    empty: '待训练',
    building: '构建中',
    ready: '已就绪',
    error: '构建失败'
  };
  return labels[s ?? ''] || '';
});

const statusClass = computed(() => {
  const s = currentKb.value?.status;
  const cls: Record<string, string> = {
    empty: 'bg-muted text-muted-foreground',
    building: 'bg-info/10 text-info animate-pulse',
    ready: 'bg-success/10 text-success',
    error: 'bg-error/10 text-error'
  };
  return cls[s ?? ''] || '';
});

onMounted(async () => {
  await loadList();
});

async function loadList(): Promise<void> {
  kbList.value = await listKnowledgeBases();
}

async function openKb(kb: KnowledgeBaseMeta): Promise<void> {
  currentKb.value = kb;
  await refreshKb();
  mode.value = 'browse';

  if (kb.status === 'building') startPolling();
}

async function refreshKb(): Promise<void> {
  if (!currentKb.value) return;
  tree.value = await getKnowledgeTree(currentKb.value.id);
  sources.value = await listSources(currentKb.value.id);
  expandedDirs.value.clear();
  for (const node of tree.value) {
    if (node.type === 'directory') expandedDirs.value.add(node.path);
  }
}

function goBack(): void {
  stopPolling();
  mode.value = 'list';
  currentKb.value = null;
  selectedFilePath.value = '';
  selectedFileContent.value = '';
  loadList();
}

async function handleDelete(id: string): Promise<void> {
  if (!confirm('确定删除此知识库？此操作不可恢复。')) return;
  await deleteKnowledgeBase(id);
  await loadList();
}

async function selectFile(filePath: string): Promise<void> {
  if (!currentKb.value) return;
  selectedFilePath.value = filePath;
  selectedFileContent.value = '';
  fileLoading.value = true;
  try {
    selectedFileContent.value = await readKnowledgeFile(currentKb.value.id, filePath);
  } catch {
    selectedFileContent.value = '加载失败';
  } finally {
    fileLoading.value = false;
  }
}

function toggleDir(dirPath: string): void {
  if (expandedDirs.value.has(dirPath)) expandedDirs.value.delete(dirPath);
  else expandedDirs.value.add(dirPath);
}

// ==================== 创建知识库 ====================

function openCreateDialog(): void {
  newName.value = '';
  newDesc.value = '';
  pendingFiles.value = [];
  showCreateDialog.value = true;
}

function handleCreateFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    pendingFiles.value = [...pendingFiles.value, ...Array.from(input.files)];
  }
  input.value = '';
}

function removePendingFile(index: number): void {
  pendingFiles.value.splice(index, 1);
}

async function doCreate(): Promise<void> {
  if (!newName.value.trim()) return;
  creating.value = true;
  try {
    const kb = await createKnowledgeBase(newName.value.trim(), newDesc.value.trim());

    for (const file of pendingFiles.value) {
      const base64 = await fileToBase64(file);
      if (file.name.endsWith('.zip')) {
        await uploadZipSource(kb.id, base64);
      } else {
        await uploadSource(kb.id, file.name, base64);
      }
    }

    if (pendingFiles.value.length > 0) {
      await buildKnowledgeBase(kb.id);
    }

    showCreateDialog.value = false;
    await loadList();

    const updated = await getKnowledgeBase(kb.id);
    if (updated) openKb(updated);
  } catch (err) {
    console.error('创建知识库失败:', err);
  } finally {
    creating.value = false;
  }
}

// ==================== 上传材料 + 训练 ====================

function openUploadDialog(): void {
  uploadFiles.value = [];
  showUploadDialog.value = true;
}

function handleUploadFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    uploadFiles.value = [...uploadFiles.value, ...Array.from(input.files)];
  }
  input.value = '';
}

function removeUploadFile(index: number): void {
  uploadFiles.value.splice(index, 1);
}

async function doUploadAndTrain(): Promise<void> {
  if (!currentKb.value || uploadFiles.value.length === 0) return;
  uploading.value = true;
  try {
    for (const file of uploadFiles.value) {
      const base64 = await fileToBase64(file);
      if (file.name.endsWith('.zip')) {
        await uploadZipSource(currentKb.value.id, base64);
      } else {
        await uploadSource(currentKb.value.id, file.name, base64);
      }
    }

    await buildKnowledgeBase(currentKb.value.id);
    showUploadDialog.value = false;
    startPolling();

    const updated = await getKnowledgeBase(currentKb.value.id);
    if (updated) currentKb.value = updated;
    sources.value = await listSources(currentKb.value!.id);
  } catch (err) {
    console.error('上传训练失败:', err);
  } finally {
    uploading.value = false;
  }
}

async function triggerRebuild(): Promise<void> {
  if (!currentKb.value) return;
  await buildKnowledgeBase(currentKb.value.id);
  startPolling();
  const updated = await getKnowledgeBase(currentKb.value.id);
  if (updated) currentKb.value = updated;
}

// ==================== 轮询构建状态 ====================

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!currentKb.value) return;
    const updated = await getKnowledgeBase(currentKb.value.id);
    if (updated) {
      currentKb.value = updated;
      if (updated.status !== 'building') {
        stopPolling();
        await refreshKb();
      }
    }
  }, 3000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ==================== Utils ====================

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function goToSmartCreation(): void {
  router.push({ name: 'creation', query: { targetType: 'knowledge' } });
}

function getStatusBadge(status: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    empty: { label: '待训练', cls: 'bg-muted text-muted-foreground' },
    building: { label: '构建中', cls: 'bg-info/10 text-info animate-pulse' },
    ready: { label: '已就绪', cls: 'bg-success/10 text-success' },
    error: { label: '失败', cls: 'bg-error/10 text-error' }
  };
  return map[status] || { label: status, cls: 'bg-muted text-muted-foreground' };
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <!-- ==================== 列表视图 ==================== -->
    <template v-if="mode === 'list'">
      <div class="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 class="text-lg font-semibold">知识库</h1>
        <div class="flex items-center gap-2">
          <button
            class="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
            @click="goToSmartCreation">
            <span class="i-carbon-machine-learning-model mr-1 inline-block h-3.5 w-3.5 align-[-3px]" />
            智能构建
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            @click="openCreateDialog">
            <span class="i-carbon-add mr-1 inline-block h-3.5 w-3.5 align-[-3px]" />
            新建知识库
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-6">
        <div
          v-if="kbList.length === 0"
          class="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
          <span class="i-carbon-book inline-block h-12 w-12 opacity-20" />
          <span>还没有知识库</span>
          <span class="text-xs">点击「新建知识库」上传资料，AI 自动构建结构化知识库</span>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="kb in kbList"
            :key="kb.id"
            class="group cursor-pointer rounded-xl border border-border bg-card p-5 transition hover:border-primary/30 hover:shadow-sm"
            @click="openKb(kb)">
            <div class="flex items-start justify-between">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <span class="i-carbon-book inline-block h-5 w-5 text-primary" />
              </div>
              <div class="flex items-center gap-2">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="getStatusBadge(kb.status).cls">
                  {{ getStatusBadge(kb.status).label }}
                </span>
                <button
                  class="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  @click.stop="handleDelete(kb.id)">
                  <span class="i-carbon-trash-can inline-block h-4 w-4" />
                </button>
              </div>
            </div>
            <div class="mt-3">
              <div class="font-medium text-card-foreground">{{ kb.name }}</div>
              <div class="mt-1 text-xs text-muted-foreground line-clamp-2">
                {{ kb.description || '暂无描述' }}
              </div>
            </div>
            <div class="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span v-if="kb.sourceCount > 0">{{ kb.sourceCount }} 份资料</span>
              <span v-if="kb.totalFiles > 0">{{ kb.chapterCount }} 章 {{ kb.totalFiles }} 文件</span>
              <span>{{ new Date(kb.updatedAt).toLocaleDateString('zh-CN') }}</span>
            </div>
            <div v-if="kb.status === 'building' && kb.buildProgress" class="mt-2 text-xs text-info animate-pulse">
              {{ kb.buildProgress }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 新建知识库弹窗 ==================== -->
    <div
      v-if="showCreateDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showCreateDialog = false">
      <div class="w-[520px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-lg font-semibold text-card-foreground">新建知识库</h2>
        <p class="mt-1 text-xs text-muted-foreground">上传资料后，AI 将自动分析并构建结构化知识库</p>

        <input
          v-model="newName"
          class="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          placeholder="知识库名称" />
        <textarea
          v-model="newDesc"
          class="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          rows="2"
          placeholder="知识库用途描述（帮助 AI 更好地组织内容）" />

        <!-- 文件上传区 -->
        <div class="mt-4">
          <div class="mb-2 text-xs font-semibold text-foreground/70">训练资料</div>
          <label
            class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-5 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-surface">
            <span class="i-carbon-cloud-upload inline-block h-5 w-5" />
            <span>点击上传资料文件</span>
            <input
              type="file"
              multiple
              accept=".zip,.md,.txt,.pdf,.doc,.docx,.csv"
              class="hidden"
              @change="handleCreateFileSelect" />
          </label>
          <p class="mt-1 text-[11px] text-muted-foreground/60"> 支持 ZIP、Markdown、TXT、PDF、Word 等格式，可多选 </p>
        </div>

        <!-- 已选文件列表 -->
        <div v-if="pendingFiles.length > 0" class="mt-3 max-h-36 overflow-y-auto rounded-lg border border-border">
          <div
            v-for="(file, i) in pendingFiles"
            :key="i"
            class="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs last:border-b-0">
            <div class="flex items-center gap-2 truncate">
              <span class="i-carbon-document inline-block h-3.5 w-3.5 text-muted-foreground" />
              <span class="truncate text-foreground">{{ file.name }}</span>
              <span class="text-muted-foreground/60">{{ formatSize(file.size) }}</span>
            </div>
            <button class="shrink-0 text-muted-foreground hover:text-destructive" @click="removePendingFile(i)">
              <span class="i-carbon-close inline-block h-3 w-3" />
            </button>
          </div>
        </div>

        <div class="mt-5 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
            @click="showCreateDialog = false">
            取消
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            :disabled="!newName.trim() || creating"
            @click="doCreate">
            {{ creating ? '创建中...' : pendingFiles.length > 0 ? '创建并训练' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 上传材料弹窗 ==================== -->
    <div
      v-if="showUploadDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showUploadDialog = false">
      <div class="w-[520px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-base font-semibold text-card-foreground">上传训练资料</h2>
        <p class="mt-1 text-xs text-muted-foreground">上传新资料后，AI 将重新训练并更新知识库内容</p>

        <label
          class="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-5 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-surface">
          <span class="i-carbon-cloud-upload inline-block h-5 w-5" />
          <span>点击选择文件</span>
          <input
            type="file"
            multiple
            accept=".zip,.md,.txt,.pdf,.doc,.docx,.csv"
            class="hidden"
            @change="handleUploadFileSelect" />
        </label>

        <div v-if="uploadFiles.length > 0" class="mt-3 max-h-36 overflow-y-auto rounded-lg border border-border">
          <div
            v-for="(file, i) in uploadFiles"
            :key="i"
            class="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs last:border-b-0">
            <div class="flex items-center gap-2 truncate">
              <span class="i-carbon-document inline-block h-3.5 w-3.5 text-muted-foreground" />
              <span class="truncate text-foreground">{{ file.name }}</span>
              <span class="text-muted-foreground/60">{{ formatSize(file.size) }}</span>
            </div>
            <button class="shrink-0 text-muted-foreground hover:text-destructive" @click="removeUploadFile(i)">
              <span class="i-carbon-close inline-block h-3 w-3" />
            </button>
          </div>
        </div>

        <div class="mt-5 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
            @click="showUploadDialog = false">
            取消
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            :disabled="uploadFiles.length === 0 || uploading"
            @click="doUploadAndTrain">
            {{ uploading ? '上传中...' : '上传并训练' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 浏览视图 ==================== -->
    <template v-if="mode === 'browse' && currentKb">
      <!-- 顶栏 -->
      <div class="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <button
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
          @click="goBack">
          <span class="i-carbon-arrow-left inline-block h-4 w-4" />
          返回
        </button>
        <div class="h-5 w-px bg-border" />
        <div class="flex-1">
          <span class="font-medium text-foreground">{{ currentKb.name }}</span>
          <span class="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusClass">
            {{ statusLabel }}
          </span>
          <span v-if="currentKb.totalFiles > 0" class="ml-2 text-xs text-muted-foreground">
            {{ currentKb.chapterCount }} 章 · {{ currentKb.totalFiles }} 文件
          </span>
          <span v-if="currentKb.sourceCount > 0" class="ml-2 text-xs text-muted-foreground">
            · {{ currentKb.sourceCount }} 份资料
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            class="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
            @click="openUploadDialog">
            <span class="i-carbon-cloud-upload inline-block h-3.5 w-3.5" />
            {{ currentKb.status === 'ready' ? '继续训练' : '上传资料' }}
          </button>
          <button
            v-if="currentKb.status === 'empty' || currentKb.status === 'error'"
            class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
            :disabled="currentKb.sourceCount === 0"
            @click="triggerRebuild">
            <span class="i-carbon-renew inline-block h-3.5 w-3.5" />
            重新构建
          </button>
        </div>
      </div>

      <!-- 构建中状态 -->
      <div
        v-if="currentKb.status === 'building'"
        class="flex items-center gap-3 border-b border-info/20 bg-info/5 px-6 py-3">
        <span class="i-carbon-renew inline-block h-4 w-4 animate-spin text-info" />
        <span class="text-sm text-info">
          {{ currentKb.buildProgress || 'AI 正在分析资料并构建知识库...' }}
        </span>
      </div>

      <!-- 构建失败状态 -->
      <div
        v-if="currentKb.status === 'error'"
        class="flex items-center gap-3 border-b border-error/20 bg-error/5 px-6 py-3">
        <span class="i-carbon-warning inline-block h-4 w-4 text-error" />
        <span class="text-sm text-error">{{ currentKb.buildProgress || '构建失败' }}</span>
        <button class="ml-auto text-xs text-error underline" @click="triggerRebuild">重试</button>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 左侧：空状态或目录树 -->
        <div class="w-72 shrink-0 overflow-y-auto border-r border-border bg-surface/30">
          <div class="p-4">
            <!-- 有内容时：目录树 -->
            <template v-if="tree.length > 0">
              <div class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">知识库结构</div>
              <div class="space-y-0.5">
                <template v-for="node in tree" :key="node.path">
                  <div
                    v-if="node.type === 'file'"
                    class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                    :class="
                      selectedFilePath === node.path
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground/80 hover:bg-surface'
                    "
                    @click="selectFile(node.path)">
                    <span class="i-carbon-document inline-block h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ node.name }}</span>
                  </div>
                  <div v-else>
                    <div
                      class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
                      @click="toggleDir(node.path)">
                      <span class="i-carbon-folder inline-block h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{{ node.name }}</span>
                    </div>
                    <div v-if="expandedDirs.has(node.path) && node.children" class="ml-4 space-y-0.5">
                      <template v-for="child in node.children" :key="child.path">
                        <div
                          v-if="child.type === 'file'"
                          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                          :class="
                            selectedFilePath === child.path
                              ? 'bg-primary/10 font-medium text-primary'
                              : 'text-foreground/70 hover:bg-surface'
                          "
                          @click="selectFile(child.path)">
                          <span class="i-carbon-document inline-block h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span class="truncate">{{ child.name }}</span>
                        </div>
                        <div v-else>
                          <div
                            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 hover:bg-surface"
                            @click="toggleDir(child.path)">
                            <span class="i-carbon-folder inline-block h-3.5 w-3.5 shrink-0" />
                            <span class="truncate">{{ child.name }}</span>
                          </div>
                          <div v-if="expandedDirs.has(child.path) && child.children" class="ml-4 space-y-0.5">
                            <div
                              v-for="leaf in child.children"
                              :key="leaf.path"
                              class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                              :class="
                                selectedFilePath === leaf.path
                                  ? 'bg-primary/10 font-medium text-primary'
                                  : 'text-foreground/60 hover:bg-surface'
                              "
                              @click="selectFile(leaf.path)">
                              <span
                                class="inline-block h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                :class="leaf.type === 'file' ? 'i-carbon-document' : 'i-carbon-folder'" />
                              <span class="truncate">{{ leaf.name }}</span>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </template>

            <!-- 源材料列表 -->
            <template v-if="sources.length > 0">
              <div
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70"
                :class="tree.length > 0 ? 'mt-6 mb-3 border-t border-border pt-4' : 'mb-3'">
                训练资料 ({{ sources.length }})
              </div>
              <div class="space-y-1">
                <div
                  v-for="src in sources"
                  :key="src.path"
                  class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground">
                  <span class="i-carbon-data-base inline-block h-3 w-3 shrink-0" />
                  <span class="flex-1 truncate">{{ src.name }}</span>
                  <span class="text-[10px] text-muted-foreground/50">{{ formatSize(src.size) }}</span>
                </div>
              </div>
            </template>

            <!-- 完全空状态 -->
            <template v-if="tree.length === 0 && sources.length === 0">
              <div class="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                <span class="i-carbon-cloud-upload inline-block h-10 w-10 opacity-20" />
                <p class="text-xs">还没有上传训练资料</p>
                <button
                  class="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
                  @click="openUploadDialog">
                  上传资料开始训练
                </button>
              </div>
            </template>
          </div>
        </div>

        <!-- 右侧内容区 -->
        <div class="flex flex-1 flex-col overflow-hidden">
          <template v-if="selectedFilePath">
            <div class="flex items-center gap-2 border-b border-border px-5 py-2">
              <span class="i-carbon-document inline-block h-4 w-4 text-muted-foreground" />
              <span class="font-mono text-sm font-medium text-foreground">{{ selectedFilePath }}</span>
            </div>
            <div class="flex-1 overflow-y-auto">
              <template v-if="fileLoading">
                <div class="flex h-full items-center justify-center text-muted-foreground">
                  <span class="i-carbon-renew mr-2 inline-block h-4 w-4 animate-spin" /> 加载中...
                </div>
              </template>
              <template v-else>
                <pre class="whitespace-pre-wrap p-6 font-sans text-sm leading-relaxed text-foreground">{{
                  selectedFileContent
                }}</pre>
              </template>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
              <span class="i-carbon-book inline-block h-12 w-12 opacity-20" />
              <template v-if="tree.length > 0">
                <p class="text-sm">点击左侧文件查看内容</p>
              </template>
              <template v-else-if="currentKb.status === 'building'">
                <p class="text-sm">AI 正在构建知识库，请稍候...</p>
              </template>
              <template v-else>
                <p class="text-sm">上传训练资料，AI 将自动构建知识库</p>
                <button
                  class="mt-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
                  @click="openUploadDialog">
                  上传资料
                </button>
              </template>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
