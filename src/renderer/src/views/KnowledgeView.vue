<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  listKnowledgeBases,
  getKnowledgeTree,
  readKnowledgeFile,
  deleteKnowledgeBase,
  createKnowledgeBase,
  importKnowledgeBase
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

const expandedDirs = ref<Set<string>>(new Set());

const showNewDialog = ref(false);
const createMode = ref<CreateMode>('simple');
const newName = ref('');
const newDesc = ref('');
const zipFile = ref<File | null>(null);
const creating = ref(false);

onMounted(async () => {
  await loadList();
});

async function loadList(): Promise<void> {
  kbList.value = await listKnowledgeBases();
}

async function openKb(kb: KnowledgeBaseMeta): Promise<void> {
  currentKb.value = kb;
  tree.value = await getKnowledgeTree(kb.id);
  expandedDirs.value.clear();
  for (const node of tree.value) {
    if (node.type === 'directory') {
      expandedDirs.value.add(node.path);
    }
  }
  selectedFilePath.value = '';
  selectedFileContent.value = '';
  mode.value = 'browse';
}

function goBack(): void {
  mode.value = 'list';
  currentKb.value = null;
  selectedFilePath.value = '';
  selectedFileContent.value = '';
  loadList();
}

async function handleDelete(id: string): Promise<void> {
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
  if (expandedDirs.value.has(dirPath)) {
    expandedDirs.value.delete(dirPath);
  } else {
    expandedDirs.value.add(dirPath);
  }
}

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
      await createKnowledgeBase(newName.value.trim(), newDesc.value.trim());
    } else if (createMode.value === 'import' && zipFile.value) {
      const base64 = await fileToBase64(zipFile.value);
      await importKnowledgeBase(newName.value.trim(), newDesc.value.trim(), base64);
    }
    showNewDialog.value = false;
    await loadList();
  } catch (err) {
    console.error('创建知识库失败:', err);
  } finally {
    creating.value = false;
  }
}

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
            ✨ 智能构建
          </button>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            @click="openCreateDialog">
            + 新建知识库
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-6">
        <div
          v-if="kbList.length === 0"
          class="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
          <span class="text-4xl">📚</span>
          <span>还没有知识库</span>
          <span class="text-xs">点击「新建知识库」创建空知识库或导入 ZIP，或使用「智能构建」自动生成</span>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="kb in kbList"
            :key="kb.id"
            class="group cursor-pointer rounded-xl border border-border bg-card p-5 transition hover:border-primary/30 hover:shadow-sm"
            @click="openKb(kb)">
            <div class="flex items-start justify-between">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg">📚</div>
              <button
                class="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                @click.stop="handleDelete(kb.id)">
                ✕
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

    <!-- ==================== 新建弹窗 ==================== -->
    <div
      v-if="showNewDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showNewDialog = false">
      <div class="w-[480px] rounded-2xl bg-card p-6 shadow-2xl">
        <h2 class="text-lg font-semibold text-card-foreground">新建知识库</h2>

        <!-- 模式选择 -->
        <div class="mt-4 flex gap-2">
          <button
            class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
            :class="
              createMode === 'simple'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            "
            @click="createMode = 'simple'">
            📝 空白创建
          </button>
          <button
            class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
            :class="
              createMode === 'import'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            "
            @click="createMode = 'import'">
            📦 导入 ZIP
          </button>
        </div>

        <!-- 名称 -->
        <input
          v-model="newName"
          class="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          placeholder="知识库名称" />

        <!-- 描述 -->
        <textarea
          v-model="newDesc"
          class="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          rows="2"
          placeholder="简要描述（可选）" />

        <!-- ZIP 上传 -->
        <div v-if="createMode === 'import'" class="mt-3">
          <label
            class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-surface">
            <span>{{ zipFile ? zipFile.name : '点击选择 ZIP 文件' }}</span>
            <input type="file" accept=".zip" class="hidden" @change="handleFileChange" />
          </label>
          <p class="mt-1 text-xs text-muted-foreground">支持包含 .md 文件的 ZIP 压缩包</p>
        </div>

        <!-- 操作按钮 -->
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

    <!-- ==================== 浏览视图 ==================== -->
    <template v-if="mode === 'browse' && currentKb">
      <div class="flex items-center gap-3 border-b border-border px-6 py-3">
        <button class="rounded-lg p-1 text-muted-foreground hover:bg-surface hover:text-foreground" @click="goBack">
          ←
        </button>
        <div class="flex-1">
          <div class="font-medium">{{ currentKb.name }}</div>
          <div class="text-xs text-muted-foreground">
            {{ currentKb.chapterCount }} 章 · {{ currentKb.totalFiles }} 个文件
          </div>
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
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/80 hover:bg-surface'
                  "
                  @click="selectFile(node.path)">
                  <span class="text-muted-foreground">📄</span>
                  <span class="truncate">{{ node.name }}</span>
                </div>
                <div v-else>
                  <div
                    class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
                    @click="toggleDir(node.path)">
                    <span>{{ expandedDirs.has(node.path) ? '📂' : '📁' }}</span>
                    <span class="truncate">{{ node.name }}</span>
                  </div>
                  <div v-if="expandedDirs.has(node.path) && node.children" class="ml-4 space-y-0.5">
                    <template v-for="child in node.children" :key="child.path">
                      <div
                        v-if="child.type === 'file'"
                        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                        :class="
                          selectedFilePath === child.path
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground/70 hover:bg-surface'
                        "
                        @click="selectFile(child.path)">
                        <span class="text-muted-foreground">📄</span>
                        <span class="truncate">{{ child.name }}</span>
                      </div>
                      <div v-else>
                        <div
                          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 hover:bg-surface"
                          @click="toggleDir(child.path)">
                          <span>{{ expandedDirs.has(child.path) ? '📂' : '📁' }}</span>
                          <span class="truncate">{{ child.name }}</span>
                        </div>
                        <div v-if="expandedDirs.has(child.path) && child.children" class="ml-4 space-y-0.5">
                          <div
                            v-for="leaf in child.children"
                            :key="leaf.path"
                            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                            :class="
                              selectedFilePath === leaf.path
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-foreground/60 hover:bg-surface'
                            "
                            @click="selectFile(leaf.path)">
                            <span class="text-muted-foreground">{{ leaf.type === 'file' ? '📄' : '📁' }}</span>
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
            <div class="flex items-center gap-2 border-b border-border px-6 py-3">
              <span class="text-muted-foreground">📄</span>
              <span class="font-mono text-sm font-medium text-foreground">{{ selectedFilePath }}</span>
            </div>
            <div class="flex-1 overflow-y-auto p-6">
              <template v-if="fileLoading">
                <div class="flex h-full items-center justify-center text-muted-foreground">
                  <span class="mr-2 animate-spin">⟳</span> 加载中...
                </div>
              </template>
              <template v-else>
                <pre class="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{{
                  selectedFileContent
                }}</pre>
              </template>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-1 items-center justify-center p-8 text-muted-foreground">
              <div class="text-center">
                <div class="mb-3 text-4xl">📚</div>
                <p class="text-sm">点击左侧文件查看内容</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
