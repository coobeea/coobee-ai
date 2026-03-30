<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  listKnowledgeBases,
  getKnowledgeTree,
  readKnowledgeFile,
  deleteKnowledgeBase,
  createKnowledgeBase,
  importKnowledgeBase,
  saveKnowledgeFile,
  deleteKnowledgeFile,
  importIntoKnowledgeBase,
  regenerateIndex
} from '@/api/knowledge';
import type { KnowledgeBaseMeta, KnowledgeTreeNode } from '@shared/types/knowledge';

type ViewMode = 'list' | 'browse';
type CreateMode = 'simple' | 'import';

const router = useRouter();
const mode = ref<ViewMode>('list');
const kbList = ref<KnowledgeBaseMeta[]>([]);
const currentKb = ref<KnowledgeBaseMeta | null>(null);
const tree = ref<KnowledgeTreeNode[]>([]);

const selectedFilePath = ref('');
const selectedFileContent = ref('');
const fileLoading = ref(false);

const isEditing = ref(false);
const editContent = ref('');
const saving = ref(false);

const expandedDirs = ref<Set<string>>(new Set());

const showNewDialog = ref(false);
const createMode = ref<CreateMode>('simple');
const newName = ref('');
const newDesc = ref('');
const zipFile = ref<File | null>(null);
const creating = ref(false);

const showNewFileDialog = ref(false);
const newFilePath = ref('');

const showImportDialog = ref(false);
const importZipFile = ref<File | null>(null);
const importing = ref(false);

const hasUnsavedChanges = computed(() => isEditing.value && editContent.value !== selectedFileContent.value);

onMounted(async () => {
  await loadList();
});

async function loadList(): Promise<void> {
  kbList.value = await listKnowledgeBases();
}

async function openKb(kb: KnowledgeBaseMeta): Promise<void> {
  currentKb.value = kb;
  await refreshTree();
  selectedFilePath.value = '';
  selectedFileContent.value = '';
  isEditing.value = false;
  mode.value = 'browse';
}

async function refreshTree(): Promise<void> {
  if (!currentKb.value) return;
  tree.value = await getKnowledgeTree(currentKb.value.id);
  expandedDirs.value.clear();
  for (const node of tree.value) {
    if (node.type === 'directory') {
      expandedDirs.value.add(node.path);
    }
  }
}

function goBack(): void {
  if (hasUnsavedChanges.value && !confirm('有未保存的修改，确定离开？')) return;
  mode.value = 'list';
  currentKb.value = null;
  selectedFilePath.value = '';
  selectedFileContent.value = '';
  isEditing.value = false;
  loadList();
}

async function handleDelete(id: string): Promise<void> {
  if (!confirm('确定删除此知识库？此操作不可恢复。')) return;
  await deleteKnowledgeBase(id);
  await loadList();
}

async function selectFile(filePath: string): Promise<void> {
  if (!currentKb.value) return;
  if (hasUnsavedChanges.value && !confirm('有未保存的修改，确定切换文件？')) return;

  selectedFilePath.value = filePath;
  selectedFileContent.value = '';
  isEditing.value = false;
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
  if (expandedDirs.value.has(dirPath)) {
    expandedDirs.value.delete(dirPath);
  } else {
    expandedDirs.value.add(dirPath);
  }
}

function startEditing(): void {
  editContent.value = selectedFileContent.value;
  isEditing.value = true;
}

function cancelEditing(): void {
  if (hasUnsavedChanges.value && !confirm('放弃修改？')) return;
  isEditing.value = false;
}

async function saveFile(): Promise<void> {
  if (!currentKb.value || !selectedFilePath.value) return;
  saving.value = true;
  try {
    await saveKnowledgeFile(currentKb.value.id, selectedFilePath.value, editContent.value);
    selectedFileContent.value = editContent.value;
    isEditing.value = false;
  } catch (err) {
    console.error('保存失败:', err);
  } finally {
    saving.value = false;
  }
}

async function handleDeleteFile(): Promise<void> {
  if (!currentKb.value || !selectedFilePath.value) return;
  if (!confirm(`确定删除文件 "${selectedFilePath.value}" ？`)) return;

  try {
    await deleteKnowledgeFile(currentKb.value.id, selectedFilePath.value);
    selectedFilePath.value = '';
    selectedFileContent.value = '';
    isEditing.value = false;
    await refreshTree();
  } catch (err) {
    console.error('删除失败:', err);
  }
}

// ==================== 新建知识库 ====================

function openCreateDialog(): void {
  newName.value = '';
  newDesc.value = '';
  zipFile.value = null;
  createMode.value = 'simple';
  showNewDialog.value = true;
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    zipFile.value = input.files[0];
  }
}

async function doCreate(): Promise<void> {
  if (!newName.value.trim()) return;
  creating.value = true;

  try {
    if (createMode.value === 'simple') {
      const kb = await createKnowledgeBase(newName.value.trim(), newDesc.value.trim());
      showNewDialog.value = false;
      await loadList();
      openKb(kb);
    } else if (createMode.value === 'import' && zipFile.value) {
      const base64 = await fileToBase64(zipFile.value);
      await importKnowledgeBase(newName.value.trim(), newDesc.value.trim(), base64);
      showNewDialog.value = false;
      await loadList();
    }
  } catch (err) {
    console.error('创建知识库失败:', err);
  } finally {
    creating.value = false;
  }
}

// ==================== 新建文件 ====================

function openNewFileDialog(): void {
  const prefix =
    selectedFilePath.value && selectedFilePath.value.includes('/')
      ? selectedFilePath.value.substring(0, selectedFilePath.value.lastIndexOf('/') + 1)
      : '';
  newFilePath.value = prefix;
  showNewFileDialog.value = true;
}

async function doCreateFile(): Promise<void> {
  if (!currentKb.value || !newFilePath.value.trim()) return;
  let fp = newFilePath.value.trim();
  if (!fp.endsWith('.md')) fp += '.md';

  try {
    await saveKnowledgeFile(currentKb.value.id, fp, `# ${fp.split('/').pop()?.replace('.md', '') || '新文件'}\n\n`);
    showNewFileDialog.value = false;
    await refreshTree();
    await selectFile(fp);
    startEditing();
  } catch (err) {
    console.error('创建文件失败:', err);
  }
}

// ==================== 导入内容到已有知识库 ====================

function openImportDialog(): void {
  importZipFile.value = null;
  showImportDialog.value = true;
}

function handleImportFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    importZipFile.value = input.files[0];
  }
}

async function doImport(): Promise<void> {
  if (!currentKb.value || !importZipFile.value) return;
  importing.value = true;
  try {
    const base64 = await fileToBase64(importZipFile.value);
    const updated = await importIntoKnowledgeBase(currentKb.value.id, base64);
    currentKb.value = updated;
    showImportDialog.value = false;
    await refreshTree();
  } catch (err) {
    console.error('导入失败:', err);
  } finally {
    importing.value = false;
  }
}

// ==================== 重建索引 ====================

async function handleReindex(): Promise<void> {
  if (!currentKb.value) return;
  try {
    await regenerateIndex(currentKb.value.id);
    await refreshTree();
    if (selectedFilePath.value === 'index.md') {
      selectedFileContent.value = await readKnowledgeFile(currentKb.value.id, 'index.md');
    }
  } catch (err) {
    console.error('重建索引失败:', err);
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

function goToSmartCreation(): void {
  router.push({ name: 'creation', query: { targetType: 'knowledge' } });
}

function goToSmartExpand(): void {
  if (!currentKb.value) return;
  router.push({ name: 'creation', query: { targetType: 'knowledge', kbId: currentKb.value.id } });
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
          <span class="text-xs">点击「新建知识库」手动创建，或使用「智能构建」AI 自动生成</span>
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
              <button
                class="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                @click.stop="handleDelete(kb.id)">
                <span class="i-carbon-trash-can inline-block h-4 w-4" />
              </button>
            </div>
            <div class="mt-3">
              <div class="font-medium text-card-foreground">{{ kb.name }}</div>
              <div class="mt-1 text-xs text-muted-foreground line-clamp-2">
                {{ kb.description || '暂无描述' }}
              </div>
            </div>
            <div class="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{{ kb.chapterCount }} 章</span>
              <span>{{ kb.totalFiles }} 文件</span>
              <span>{{ new Date(kb.createdAt).toLocaleDateString('zh-CN') }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 新建知识库弹窗 ==================== -->
    <div
      v-if="showNewDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showNewDialog = false">
      <div class="w-[480px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-lg font-semibold text-card-foreground">新建知识库</h2>
        <div class="mt-4 flex gap-2">
          <button
            class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
            :class="
              createMode === 'simple'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            "
            @click="createMode = 'simple'">
            <span class="i-carbon-document-add mb-1 inline-block h-5 w-5" /><br />
            手动创建
          </button>
          <button
            class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
            :class="
              createMode === 'import'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            "
            @click="createMode = 'import'">
            <span class="i-carbon-upload mb-1 inline-block h-5 w-5" /><br />
            导入 ZIP
          </button>
        </div>
        <input
          v-model="newName"
          class="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          placeholder="知识库名称" />
        <textarea
          v-model="newDesc"
          class="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          rows="2"
          placeholder="简要描述（可选）" />
        <div v-if="createMode === 'import'" class="mt-3">
          <label
            class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-surface">
            <span class="i-carbon-cloud-upload inline-block h-5 w-5" />
            <span>{{ zipFile ? zipFile.name : '点击选择 ZIP 文件' }}</span>
            <input type="file" accept=".zip" class="hidden" @change="handleFileChange" />
          </label>
        </div>
        <p v-if="createMode === 'simple'" class="mt-3 text-xs text-muted-foreground">
          创建后可直接在知识库中新建文件、编辑内容或导入 ZIP 补充资料
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
            @click="showNewDialog = false">
            取消
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            :disabled="!newName.trim() || (createMode === 'import' && !zipFile) || creating"
            @click="doCreate">
            {{ creating ? '创建中...' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 新建文件弹窗 ==================== -->
    <div
      v-if="showNewFileDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showNewFileDialog = false">
      <div class="w-[420px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-base font-semibold text-card-foreground">新建文件</h2>
        <p class="mt-1 text-xs text-muted-foreground">输入文件路径（可包含目录），如：01-chapter/intro.md</p>
        <input
          v-model="newFilePath"
          class="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          placeholder="path/to/file.md"
          @keydown.enter="doCreateFile" />
        <div class="mt-4 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
            @click="showNewFileDialog = false">
            取消
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            :disabled="!newFilePath.trim()"
            @click="doCreateFile">
            创建
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 追加导入弹窗 ==================== -->
    <div
      v-if="showImportDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showImportDialog = false">
      <div class="w-[420px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-base font-semibold text-card-foreground">导入内容</h2>
        <p class="mt-1 text-xs text-muted-foreground">上传 ZIP 文件，内容将合并到当前知识库中</p>
        <label
          class="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-surface">
          <span class="i-carbon-cloud-upload inline-block h-5 w-5" />
          <span>{{ importZipFile ? importZipFile.name : '点击选择 ZIP 文件' }}</span>
          <input type="file" accept=".zip" class="hidden" @change="handleImportFileChange" />
        </label>
        <div class="mt-4 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
            @click="showImportDialog = false">
            取消
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            :disabled="!importZipFile || importing"
            @click="doImport">
            {{ importing ? '导入中...' : '导入' }}
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
          <span class="ml-2 text-xs text-muted-foreground">
            {{ currentKb.chapterCount }} 章 · {{ currentKb.totalFiles }} 文件
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
            title="新建文件"
            @click="openNewFileDialog">
            <span class="i-carbon-document-add inline-block h-3.5 w-3.5" />
            新建文件
          </button>
          <button
            class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
            title="导入 ZIP 内容到当前知识库"
            @click="openImportDialog">
            <span class="i-carbon-upload inline-block h-3.5 w-3.5" />
            导入内容
          </button>
          <button
            class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
            title="根据当前目录结构重新生成 index.md"
            @click="handleReindex">
            <span class="i-carbon-renew inline-block h-3.5 w-3.5" />
            重建索引
          </button>
          <div class="h-5 w-px bg-border" />
          <button
            class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
            title="通过 AI 智能扩展当前知识库"
            @click="goToSmartExpand">
            <span class="i-carbon-machine-learning-model inline-block h-3.5 w-3.5" />
            智能扩展
          </button>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 左侧目录树 -->
        <div class="w-72 shrink-0 overflow-y-auto border-r border-border bg-surface/30">
          <div class="p-4">
            <div class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">目录结构</div>
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
                    <span
                      class="inline-block h-3.5 w-3.5 shrink-0"
                      :class="expandedDirs.has(node.path) ? 'i-carbon-folder' : 'i-carbon-folder'" />
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
          </div>
        </div>

        <!-- 右侧内容区 -->
        <div class="flex flex-1 flex-col overflow-hidden">
          <template v-if="selectedFilePath">
            <!-- 文件工具栏 -->
            <div class="flex items-center justify-between border-b border-border px-5 py-2">
              <div class="flex items-center gap-2">
                <span class="i-carbon-document inline-block h-4 w-4 text-muted-foreground" />
                <span class="font-mono text-sm font-medium text-foreground">{{ selectedFilePath }}</span>
                <span
                  v-if="hasUnsavedChanges"
                  class="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  未保存
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <template v-if="isEditing">
                  <button
                    class="rounded-md px-3 py-1 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
                    @click="cancelEditing">
                    取消
                  </button>
                  <button
                    class="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
                    :disabled="saving || !hasUnsavedChanges"
                    @click="saveFile">
                    {{ saving ? '保存中...' : '保存' }}
                  </button>
                </template>
                <template v-else>
                  <button
                    class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-surface hover:text-foreground"
                    @click="startEditing">
                    <span class="i-carbon-edit inline-block h-3 w-3" />
                    编辑
                  </button>
                  <button
                    class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    @click="handleDeleteFile">
                    <span class="i-carbon-trash-can inline-block h-3 w-3" />
                    删除
                  </button>
                </template>
              </div>
            </div>
            <!-- 内容区域 -->
            <div class="flex-1 overflow-y-auto">
              <template v-if="fileLoading">
                <div class="flex h-full items-center justify-center text-muted-foreground">
                  <span class="i-carbon-renew mr-2 inline-block h-4 w-4 animate-spin" /> 加载中...
                </div>
              </template>
              <template v-else-if="isEditing">
                <textarea
                  v-model="editContent"
                  class="h-full w-full resize-none border-none bg-background p-6 font-mono text-sm leading-relaxed text-foreground outline-none"
                  spellcheck="false" />
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
              <p class="text-sm">点击左侧文件查看或编辑内容</p>
              <p class="text-xs text-muted-foreground/60"> 可通过工具栏「新建文件」添加内容，或「导入内容」批量添加 </p>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
