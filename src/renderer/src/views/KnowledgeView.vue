<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { listKnowledgeBases, getKnowledgeTree, readKnowledgeFile, deleteKnowledgeBase } from '@/api/knowledge';
import type { KnowledgeBaseMeta, KnowledgeTreeNode } from '@shared/types/knowledge';

type ViewMode = 'list' | 'browse';

const router = useRouter();
const mode = ref<ViewMode>('list');
const kbList = ref<KnowledgeBaseMeta[]>([]);
const currentKb = ref<KnowledgeBaseMeta | null>(null);
const tree = ref<KnowledgeTreeNode[]>([]);

const showFileViewer = ref(false);
const viewerPath = ref('');
const viewerContent = ref('');
const viewerLoading = ref(false);

const expandedDirs = ref<Set<string>>(new Set());

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
  mode.value = 'browse';
}

function goBack(): void {
  mode.value = 'list';
  currentKb.value = null;
  loadList();
}

function goToCreation(): void {
  router.push({ name: 'creation', query: { targetType: 'knowledge' } });
}

async function handleDelete(id: string): Promise<void> {
  await deleteKnowledgeBase(id);
  await loadList();
}

async function openFile(filePath: string): Promise<void> {
  if (!currentKb.value) return;
  viewerPath.value = filePath;
  viewerContent.value = '';
  viewerLoading.value = true;
  showFileViewer.value = true;

  try {
    viewerContent.value = await readKnowledgeFile(currentKb.value.id, filePath);
  } catch {
    viewerContent.value = '加载失败';
  } finally {
    viewerLoading.value = false;
  }
}

function toggleDir(path: string): void {
  if (expandedDirs.value.has(path)) {
    expandedDirs.value.delete(path);
  } else {
    expandedDirs.value.add(path);
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <!-- 列表视图 -->
    <template v-if="mode === 'list'">
      <div class="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 class="text-lg font-semibold">知识库</h1>
        <button
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          @click="goToCreation">
          新建知识库
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6">
        <div
          v-if="kbList.length === 0"
          class="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
          <span class="text-4xl">📚</span>
          <span>还没有知识库，点击「新建知识库」通过智能创建流水线构建</span>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="kb in kbList"
            :key="kb.id"
            class="group cursor-pointer rounded-xl border border-border bg-card p-5 transition hover:border-primary/30 hover:shadow-sm"
            @click="openKb(kb)">
            <div class="flex items-start justify-between">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg"> 📚 </div>
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

    <!-- 浏览视图 -->
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
        <div class="w-72 shrink-0 border-r border-border overflow-y-auto bg-surface/30">
          <div class="p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3">目录结构</div>
            <div class="space-y-0.5">
              <template v-for="node in tree" :key="node.path">
                <div
                  v-if="node.type === 'file'"
                  class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 hover:bg-surface"
                  @click="openFile(node.path)">
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
                        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/70 hover:bg-surface"
                        @click="openFile(child.path)">
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
                            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/60 hover:bg-surface"
                            @click="openFile(leaf.path)">
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
        <div class="flex flex-1 items-center justify-center p-8 text-muted-foreground">
          <div class="text-center">
            <div class="text-4xl mb-3">📚</div>
            <p class="text-sm">点击左侧文件查看内容</p>
          </div>
        </div>
      </div>
    </template>

    <!-- 文件查看对话框 -->
    <div
      v-if="showFileViewer"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showFileViewer = false">
      <div class="flex h-[80vh] w-[70vw] max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        <div class="flex items-center justify-between border-b border-border px-6 py-4">
          <div class="flex items-center gap-2">
            <span>📄</span>
            <span class="font-mono text-sm font-medium text-card-foreground">{{ viewerPath }}</span>
          </div>
          <button
            class="rounded-lg p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
            @click="showFileViewer = false">
            ✕
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-6">
          <template v-if="viewerLoading">
            <div class="flex h-full items-center justify-center text-muted-foreground">
              <span class="animate-spin mr-2">⟳</span> 加载中...
            </div>
          </template>
          <template v-else>
            <pre class="whitespace-pre-wrap text-sm leading-relaxed text-foreground font-sans">{{ viewerContent }}</pre>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
