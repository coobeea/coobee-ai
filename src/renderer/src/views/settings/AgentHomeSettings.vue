<script setup lang="ts">
/**
 * AgentHomeSettings - Agent 人格与记忆管理
 *
 * 三栏布局：左侧 Agent 列表、中间文件列表、右侧 Monaco 编辑器
 * 通过 Gateway HTTP API 对 Agent Home 目录进行 CRUD 操作
 */

import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { monaco } from '@/utils/monaco-setup';
import configManager from '@/config';

const GATEWAY_BASE = `${configManager.getBaseUrl()}/gateway`;

// ==================== Types ====================

interface AgentHome {
  id: string;
  name: string;
}

interface HomeFile {
  name: string;
  size: number;
  mtime: string;
  category: 'config' | 'memory';
}

// ==================== State ====================

const agents = ref<AgentHome[]>([]);
const agentsLoading = ref(true);
const selectedAgentId = ref<string | null>(null);

const files = ref<HomeFile[]>([]);
const filesLoading = ref(false);
const selectedFileName = ref<string | null>(null);

const fileContent = ref('');
const originalContent = ref('');
const contentLoading = ref(false);
const saving = ref(false);
const saveSuccess = ref(false);

const editorContainer = ref<HTMLDivElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
let pendingContent: string | null = null;

const confirmDeleteFile = ref<string | null>(null);
const creatingMemory = ref(false);

// ==================== Computed helpers ====================

function isDirty(): boolean {
  return fileContent.value !== originalContent.value;
}

function configFiles(): HomeFile[] {
  return files.value.filter((f) => f.category === 'config');
}

function memoryFiles(): HomeFile[] {
  return files.value.filter((f) => f.category === 'memory');
}

// ==================== Theme ====================

function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function getMonacoTheme(): 'vs' | 'vs-dark' {
  return isDarkMode() ? 'vs-dark' : 'vs';
}

// ==================== API ====================

async function loadAgents(): Promise<void> {
  agentsLoading.value = true;
  try {
    const res = await fetch(`${GATEWAY_BASE}/agents/homes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    agents.value = data.homes || [];
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to load agents:', err);
  } finally {
    agentsLoading.value = false;
  }
}

async function loadFiles(agentId: string): Promise<void> {
  filesLoading.value = true;
  files.value = [];
  try {
    const res = await fetch(`${GATEWAY_BASE}/agents/${agentId}/home/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    files.value = data.files || [];
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to load files:', err);
  } finally {
    filesLoading.value = false;
  }
}

async function loadFileContent(agentId: string, fileName: string): Promise<void> {
  contentLoading.value = true;
  saveSuccess.value = false;
  try {
    const res = await fetch(`${GATEWAY_BASE}/agents/${agentId}/home/file?name=${encodeURIComponent(fileName)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fileContent.value = data.content ?? '';
    originalContent.value = fileContent.value;
    setEditorContent(fileContent.value);
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to read file:', err);
    fileContent.value = '(读取失败)';
    originalContent.value = '';
  } finally {
    contentLoading.value = false;
  }
}

function setEditorContent(content: string): void {
  if (editorInstance) {
    editorInstance.setValue(content);
  } else {
    pendingContent = content;
  }
}

async function saveFile(): Promise<void> {
  if (!selectedAgentId.value || !selectedFileName.value || saving.value) return;
  saving.value = true;
  saveSuccess.value = false;
  try {
    const res = await fetch(`${GATEWAY_BASE}/agents/${selectedAgentId.value}/home/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedFileName.value, content: fileContent.value })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    originalContent.value = fileContent.value;
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
    }, 2000);
    if (selectedAgentId.value) {
      await loadFiles(selectedAgentId.value);
    }
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to save file:', err);
  } finally {
    saving.value = false;
  }
}

async function deleteFile(fileName: string): Promise<void> {
  if (!selectedAgentId.value) return;
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/agents/${selectedAgentId.value}/home/file?name=${encodeURIComponent(fileName)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    confirmDeleteFile.value = null;
    if (selectedFileName.value === fileName) {
      selectedFileName.value = null;
      fileContent.value = '';
      originalContent.value = '';
      setEditorContent('');
    }
    await loadFiles(selectedAgentId.value);
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to delete file:', err);
  }
}

async function createTodayMemory(): Promise<void> {
  if (!selectedAgentId.value || creatingMemory.value) return;
  creatingMemory.value = true;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fileName = `memory/${today}.md`;
    const existing = files.value.find((f) => f.name === fileName);
    if (existing) {
      selectFile(fileName);
      creatingMemory.value = false;
      return;
    }
    const template = `# ${today} 每日记忆\n\n## 今日交互摘要\n- \n\n## 关键信息\n- \n`;
    const res = await fetch(`${GATEWAY_BASE}/agents/${selectedAgentId.value}/home/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName, content: template })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadFiles(selectedAgentId.value);
    selectFile(fileName);
  } catch (err) {
    console.warn('[AgentHomeSettings] Failed to create memory:', err);
  } finally {
    creatingMemory.value = false;
  }
}

// ==================== Handlers ====================

function selectAgent(agentId: string): void {
  selectedAgentId.value = agentId;
  selectedFileName.value = null;
  fileContent.value = '';
  originalContent.value = '';
  setEditorContent('');
  loadFiles(agentId);
}

function selectFile(fileName: string): void {
  if (!selectedAgentId.value) return;
  selectedFileName.value = fileName;
  loadFileContent(selectedAgentId.value, fileName);
}

function revertFile(): void {
  fileContent.value = originalContent.value;
  setEditorContent(originalContent.value);
}

function handleDeleteClick(fileName: string): void {
  if (confirmDeleteFile.value === fileName) {
    deleteFile(fileName);
  } else {
    confirmDeleteFile.value = fileName;
  }
}

// ==================== Monaco Editor ====================

function initEditor(): void {
  if (!editorContainer.value || editorInstance) return;

  editorInstance = monaco.editor.create(editorContainer.value, {
    value: '',
    language: 'markdown',
    theme: getMonacoTheme(),
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    lineNumbers: 'on',
    renderLineHighlight: 'line',
    padding: { top: 12, bottom: 12 },
    tabSize: 2,
    folding: true,
    bracketPairColorization: { enabled: true }
  });

  editorInstance.onDidChangeModelContent(() => {
    fileContent.value = editorInstance?.getValue() ?? '';
  });

  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveFile();
  });

  if (pendingContent !== null) {
    editorInstance.setValue(pendingContent);
    pendingContent = null;
  }
}

function disposeEditor(): void {
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
}

// ==================== Format helpers ====================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fileIcon(name: string): string {
  if (name === 'SOUL.md') return 'i-carbon-favorite';
  if (name === 'IDENTITY.md') return 'i-carbon-user-avatar';
  if (name === 'USER.md') return 'i-carbon-user';
  if (name === 'MEMORY.md') return 'i-carbon-cognitive';
  if (name === 'NOTES.md') return 'i-carbon-notebook';
  if (name === 'AGENTS.md') return 'i-carbon-rule';
  if (name === 'HEARTBEAT.md') return 'i-carbon-activity';
  if (name === 'BOOTSTRAP.md') return 'i-carbon-rocket';
  if (name.startsWith('memory/')) return 'i-carbon-calendar';
  return 'i-carbon-document';
}

function fileLabel(name: string): string {
  if (name === 'SOUL.md') return '人格灵魂';
  if (name === 'IDENTITY.md') return '身份名片';
  if (name === 'USER.md') return '主人档案';
  if (name === 'MEMORY.md') return '长期记忆';
  if (name === 'NOTES.md') return '环境备注';
  if (name === 'AGENTS.md') return 'Agent 规则';
  if (name === 'HEARTBEAT.md') return '心跳任务';
  if (name === 'BOOTSTRAP.md') return '首次引导';
  return '';
}

function memoryDateLabel(name: string): string {
  const baseName = name.replace('memory/', '').replace('.md', '');
  return baseName;
}

// ==================== Theme observer ====================

let themeObserver: MutationObserver | null = null;

function watchTheme(): void {
  themeObserver = new MutationObserver(() => {
    if (editorInstance) {
      monaco.editor.setTheme(getMonacoTheme());
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });
}

// ==================== Lifecycle ====================

onMounted(() => {
  loadAgents();
  watchTheme();
});

onBeforeUnmount(() => {
  disposeEditor();
  themeObserver?.disconnect();
});

watch(editorContainer, async (el, oldEl) => {
  if (!el && oldEl && editorInstance) {
    disposeEditor();
  }
  if (el && !editorInstance) {
    await nextTick();
    initEditor();
  }
});

watch(
  () => selectedFileName.value,
  () => {
    confirmDeleteFile.value = null;
  }
);
</script>

<template>
  <div class="flex h-full">
    <!-- 左栏：Agent 列表 -->
    <div class="flex w-52 flex-col border-r border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold">Agent</h2>
          <p class="text-[10px] text-muted-foreground">{{ agents.length }} 个智能体</p>
        </div>
        <button
          class="flex items-center rounded px-1.5 py-1 text-muted-foreground hover:bg-muted transition-colors"
          @click="loadAgents">
          <span class="i-carbon-renew inline-block h-3 w-3"></span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="agentsLoading" class="flex items-center justify-center py-8 text-muted-foreground">
          <span class="i-carbon-circle-dash inline-block h-4 w-4 animate-spin"></span>
        </div>
        <template v-else>
          <button
            v-for="agent in agents"
            :key="agent.id"
            :class="[
              'w-full text-left rounded-lg px-3 py-2 mb-0.5 transition-colors text-xs',
              selectedAgentId === agent.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground/70 hover:bg-muted'
            ]"
            @click="selectAgent(agent.id)">
            <div class="truncate font-medium">{{ agent.name }}</div>
            <div class="truncate text-[10px] text-muted-foreground/60 mt-0.5">{{ agent.id }}</div>
          </button>
        </template>
      </div>
    </div>

    <!-- 中栏：文件列表 -->
    <div class="flex w-56 flex-col border-r border-border bg-card/50">
      <template v-if="selectedAgentId">
        <div class="border-b border-border px-4 py-3">
          <h2 class="text-sm font-semibold">配置文件</h2>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div v-if="filesLoading" class="flex items-center justify-center py-8 text-muted-foreground">
            <span class="i-carbon-circle-dash inline-block h-4 w-4 animate-spin"></span>
          </div>
          <template v-else>
            <!-- 配置文件 -->
            <div class="p-2">
              <button
                v-for="file in configFiles()"
                :key="file.name"
                :class="[
                  'w-full text-left rounded-lg px-3 py-2 mb-0.5 transition-colors',
                  selectedFileName === file.name
                    ? 'bg-primary/8 border border-primary/15'
                    : 'border border-transparent hover:bg-muted'
                ]"
                @click="selectFile(file.name)">
                <div class="flex items-center gap-2">
                  <span
                    :class="[fileIcon(file.name), 'inline-block h-3.5 w-3.5 shrink-0 text-muted-foreground']"></span>
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium truncate">{{ file.name }}</div>
                    <div v-if="fileLabel(file.name)" class="text-[10px] text-muted-foreground/50">
                      {{ fileLabel(file.name) }}
                    </div>
                  </div>
                </div>
                <div class="mt-1 pl-5.5 text-[10px] text-muted-foreground/40">
                  {{ formatSize(file.size) }} · {{ formatDate(file.mtime) }}
                </div>
              </button>
            </div>

            <!-- 每日记忆 -->
            <div class="flex items-center justify-between px-4 py-2 border-t border-border/50">
              <div class="flex items-center gap-2">
                <span class="i-carbon-calendar inline-block h-3 w-3 text-muted-foreground/50"></span>
                <span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  每日记忆 ({{ memoryFiles().length }})
                </span>
              </div>
              <button
                class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="新增今日记忆"
                :disabled="creatingMemory"
                @click="createTodayMemory">
                <span
                  :class="[
                    creatingMemory ? 'i-carbon-circle-dash animate-spin' : 'i-carbon-add',
                    'inline-block h-3 w-3'
                  ]"></span>
              </button>
            </div>
            <template v-if="memoryFiles().length > 0">
              <div class="p-2 pt-0">
                <div
                  v-for="file in memoryFiles()"
                  :key="file.name"
                  :class="[
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 mb-0.5 transition-colors group',
                    selectedFileName === file.name
                      ? 'bg-primary/8 border border-primary/15'
                      : 'border border-transparent hover:bg-muted'
                  ]">
                  <button class="flex-1 text-left min-w-0" @click="selectFile(file.name)">
                    <div class="flex items-center gap-2">
                      <span class="i-carbon-calendar inline-block h-3 w-3 shrink-0 text-muted-foreground/50"></span>
                      <span class="text-xs truncate">{{ memoryDateLabel(file.name) }}</span>
                      <span class="text-[10px] text-muted-foreground/40">{{ formatSize(file.size) }}</span>
                    </div>
                  </button>
                  <button
                    v-if="confirmDeleteFile === file.name"
                    class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    @click.stop="handleDeleteClick(file.name)">
                    确认
                  </button>
                  <button
                    v-else
                    class="shrink-0 rounded p-0.5 text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="删除"
                    @click.stop="handleDeleteClick(file.name)">
                    <span class="i-carbon-close inline-block h-3 w-3"></span>
                  </button>
                </div>
              </div>
            </template>
          </template>
        </div>
      </template>

      <div v-else class="flex h-full flex-col items-center justify-center px-4 text-muted-foreground/40">
        <span class="i-carbon-arrow-left inline-block h-5 w-5 mb-2 opacity-40"></span>
        <p class="text-[11px] text-center">选择左侧 Agent 查看配置</p>
      </div>
    </div>

    <!-- 右栏：编辑器 -->
    <div class="flex-1 flex flex-col overflow-hidden bg-background">
      <template v-if="selectedFileName">
        <!-- 编辑器头部 -->
        <div class="flex items-center justify-between border-b border-border px-5 py-2.5 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <span :class="[fileIcon(selectedFileName), 'inline-block h-4 w-4 text-muted-foreground shrink-0']"></span>
            <div class="min-w-0">
              <span class="text-sm font-semibold">{{ selectedFileName }}</span>
              <span v-if="fileLabel(selectedFileName)" class="text-xs text-muted-foreground/50 ml-2">
                {{ fileLabel(selectedFileName) }}
              </span>
            </div>
            <span v-if="isDirty()" class="text-[10px] text-amber-500 font-medium ml-1">未保存</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="isDirty()"
              class="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
              @click="revertFile">
              <span class="i-carbon-undo inline-block h-3 w-3"></span>
              撤销
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                saveSuccess
                  ? 'bg-green-500/10 text-green-600'
                  : isDirty()
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-default'
              "
              :disabled="!isDirty() || saving"
              @click="saveFile">
              <span v-if="saving" class="i-carbon-circle-dash inline-block h-3 w-3 animate-spin"></span>
              <span v-else-if="saveSuccess" class="i-carbon-checkmark inline-block h-3 w-3"></span>
              <span v-else class="i-carbon-save inline-block h-3 w-3"></span>
              {{ saveSuccess ? '已保存' : '保存' }}
            </button>
          </div>
        </div>

        <!-- Monaco 编辑器 -->
        <div class="flex-1 relative">
          <div v-if="contentLoading" class="absolute inset-0 flex items-center justify-center z-10 bg-background/80">
            <span class="i-carbon-circle-dash inline-block h-5 w-5 animate-spin text-muted-foreground"></span>
          </div>
          <div ref="editorContainer" class="absolute inset-0"></div>
        </div>

        <!-- 底部状态栏 -->
        <div
          class="flex items-center justify-between border-t border-border/50 px-5 py-1.5 text-[10px] text-muted-foreground/40 shrink-0">
          <span>Markdown · {{ selectedAgentId }}</span>
          <span> <kbd class="rounded border border-border/40 px-1 py-px font-mono">Ctrl+S</kbd> 保存 </span>
        </div>
      </template>

      <div v-else class="flex h-full flex-col items-center justify-center text-muted-foreground/30">
        <span class="i-carbon-edit inline-block h-8 w-8 mb-3 opacity-30"></span>
        <p class="text-sm">选择文件进行编辑</p>
        <p class="mt-1 text-[10px]">Agent 的人格、记忆、规则等配置文件</p>
      </div>
    </div>
  </div>
</template>
