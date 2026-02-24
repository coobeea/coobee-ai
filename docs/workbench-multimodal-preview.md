# Workbench 多模态内容预览系统

## 问题分析

### 当前状态（WorkbenchPanel.vue）

```typescript
// 当前只有 Monaco Editor
<div ref="editorContainer" class="monaco-editor"></div>
```

**问题**：

1. ❌ 所有文件都用代码编辑器显示（包括 PDF、图片、HTML）
2. ❌ 无法预览 Agent 启动的本地服务（如 `http://localhost:3000`）
3. ❌ 没有终端 UI，看不到服务启动日志
4. ❌ 用户体验差，需要跳出系统才能看效果

---

## 设计方案

### 核心思路

**根据文件类型/内容类型，动态切换预览模式：**

```
┌─────────────────────────────────────────────────┐
│              WorkbenchPanel                     │
├─────────────────────────────────────────────────┤
│ [文件树] [代码] [预览] [浏览器] [终端]          │
│                                                 │
│  动态内容区：                                   │
│  ┌───────────────────────────────────────────┐  │
│  │ 📝 Monaco Editor (代码文件)               │  │
│  │ 📄 PDF Viewer (PDF)                       │  │
│  │ 🖼️  Image Viewer (图片)                   │  │
│  │ 🌐 iframe (HTML/本地服务)                 │  │
│  │ 🎬 Video Player (视频)                    │  │
│  │ 💻 Terminal (命令行输出)                  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 实现方案

### 1. 文件类型识别与路由

#### 类型定义

```typescript
// src/renderer/src/types/preview.ts

export type PreviewMode =
  | 'code' // 代码编辑器 (Monaco)
  | 'pdf' // PDF 阅读器
  | 'image' // 图片查看器
  | 'video' // 视频播放器
  | 'audio' // 音频播放器
  | 'html' // HTML 预览 (iframe)
  | 'markdown' // Markdown 渲染
  | 'browser' // 浏览器 (内嵌本地服务)
  | 'terminal' // 终端输出
  | 'unknown'; // 不支持预览

export interface PreviewItem {
  /** 唯一标识 */
  id: string;

  /** 预览模式 */
  mode: PreviewMode;

  /** 标题 */
  title: string;

  /** 内容来源 */
  source: FileSource | URLSource | TerminalSource;

  /** 是否可编辑 */
  editable: boolean;

  /** 元数据 */
  metadata?: {
    fileSize?: number;
    mimeType?: string;
    language?: string;
  };
}

export type FileSource = {
  type: 'file';
  path: string;
  content?: string;
};

export type URLSource = {
  type: 'url';
  url: string;
};

export type TerminalSource = {
  type: 'terminal';
  terminalId: string;
};
```

#### 文件类型路由器

```typescript
// src/renderer/src/utils/previewRouter.ts

export class PreviewRouter {
  /**
   * 根据文件路径判断预览模式
   */
  static getPreviewMode(filePath: string, mimeType?: string): PreviewMode {
    const ext = filePath.split('.').pop()?.toLowerCase();

    // 1. 代码文件
    const codeExts = [
      'js',
      'ts',
      'jsx',
      'tsx',
      'vue',
      'py',
      'java',
      'cpp',
      'c',
      'h',
      'go',
      'rs',
      'php',
      'rb',
      'swift',
      'kt',
      'cs',
      'sql',
      'json',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'conf',
      'sh',
      'bash',
      'zsh',
      'css',
      'scss',
      'less',
      'sass'
    ];
    if (ext && codeExts.includes(ext)) {
      return 'code';
    }

    // 2. PDF
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      return 'pdf';
    }

    // 3. 图片
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    if (ext && imageExts.includes(ext)) {
      return 'image';
    }

    // 4. 视频
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    if (ext && videoExts.includes(ext)) {
      return 'video';
    }

    // 5. 音频
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];
    if (ext && audioExts.includes(ext)) {
      return 'audio';
    }

    // 6. HTML
    if (ext === 'html' || ext === 'htm') {
      return 'html';
    }

    // 7. Markdown
    if (ext === 'md' || ext === 'markdown') {
      return 'markdown';
    }

    // 8. 默认代码编辑器（可编辑的文本文件）
    return 'code';
  }

  /**
   * 判断是否可编辑
   */
  static isEditable(mode: PreviewMode): boolean {
    return mode === 'code' || mode === 'markdown';
  }
}
```

---

### 2. WorkbenchPanel 重构

#### 组件结构

```vue
<!-- src/renderer/src/components/agent/WorkbenchPanel.vue -->

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useOpenFiles } from '@/composables/useOpenFiles';
import { PreviewRouter } from '@/utils/previewRouter';
import type { PreviewItem } from '@/types/preview';

// 组件导入
import CodeEditor from './preview/CodeEditor.vue';
import PDFViewer from './preview/PDFViewer.vue';
import ImageViewer from './preview/ImageViewer.vue';
import VideoPlayer from './preview/VideoPlayer.vue';
import HTMLPreview from './preview/HTMLPreview.vue';
import MarkdownPreview from './preview/MarkdownPreview.vue';
import BrowserFrame from './preview/BrowserFrame.vue';
import TerminalViewer from './preview/TerminalViewer.vue';

const { openFiles, activeFile } = useOpenFiles();

// 当前预览项
const currentPreview = computed<PreviewItem | null>(() => {
  if (!activeFile.value) return null;

  const mode = PreviewRouter.getPreviewMode(activeFile.value.path);

  return {
    id: activeFile.value.path,
    mode,
    title: activeFile.value.name,
    source: {
      type: 'file',
      path: activeFile.value.path,
      content: activeFile.value.content
    },
    editable: PreviewRouter.isEditable(mode),
    metadata: {
      language: activeFile.value.language
    }
  };
});

// 浏览器预览项（Agent 启动的服务）
const browserPreviews = ref<PreviewItem[]>([]);

/**
 * 添加浏览器预览（Agent 启动服务后调用）
 */
function addBrowserPreview(url: string, title: string) {
  const preview: PreviewItem = {
    id: `browser-${Date.now()}`,
    mode: 'browser',
    title: title || url,
    source: {
      type: 'url',
      url
    },
    editable: false
  };

  browserPreviews.value.push(preview);
}

// 暴露方法供外部调用
defineExpose({
  addBrowserPreview
});
</script>

<template>
  <div class="workbench-panel">
    <!-- Tab 栏 -->
    <div class="tab-bar">
      <!-- 文件 Tabs -->
      <div
        v-for="file in openFiles"
        :key="file.path"
        class="tab"
        :class="{ active: activeFile?.path === file.path }"
        @click="setActiveFile(file.path)">
        {{ file.name }}
        <button class="close-btn" @click.stop="closeFile(file.path)">×</button>
      </div>

      <!-- 浏览器 Tabs -->
      <div
        v-for="preview in browserPreviews"
        :key="preview.id"
        class="tab browser-tab"
        :class="{ active: currentPreview?.id === preview.id }"
        @click="setActivePreview(preview.id)">
        🌐 {{ preview.title }}
        <button class="close-btn" @click.stop="closeBrowserPreview(preview.id)">×</button>
      </div>
    </div>

    <!-- 内容区（动态组件） -->
    <div class="content-area">
      <!-- 代码编辑器 -->
      <CodeEditor
        v-if="currentPreview?.mode === 'code'"
        :content="currentPreview.source.content"
        :language="currentPreview.metadata?.language"
        :editable="currentPreview.editable"
        @update:content="handleContentUpdate" />

      <!-- PDF 查看器 -->
      <PDFViewer v-else-if="currentPreview?.mode === 'pdf'" :file-path="currentPreview.source.path" />

      <!-- 图片查看器 -->
      <ImageViewer v-else-if="currentPreview?.mode === 'image'" :file-path="currentPreview.source.path" />

      <!-- 视频播放器 -->
      <VideoPlayer v-else-if="currentPreview?.mode === 'video'" :file-path="currentPreview.source.path" />

      <!-- HTML 预览 -->
      <HTMLPreview v-else-if="currentPreview?.mode === 'html'" :content="currentPreview.source.content" />

      <!-- Markdown 渲染 -->
      <MarkdownPreview
        v-else-if="currentPreview?.mode === 'markdown'"
        :content="currentPreview.source.content"
        :editable="true"
        @update:content="handleContentUpdate" />

      <!-- 浏览器 iframe -->
      <BrowserFrame v-else-if="currentPreview?.mode === 'browser'" :url="currentPreview.source.url" />

      <!-- 终端输出 -->
      <TerminalViewer v-else-if="currentPreview?.mode === 'terminal'" :terminal-id="currentPreview.source.terminalId" />

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <span class="i-carbon-document text-4xl text-gray-400" />
        <p class="text-gray-500">选择文件以预览</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workbench-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-bar {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  overflow-x: auto;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab.active {
  background: #0066ff;
  color: white;
  border-color: #0066ff;
}

.tab.browser-tab {
  background: #e8f4ff;
  border-color: #0066ff;
}

.close-btn {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.6;
}

.close-btn:hover {
  opacity: 1;
}

.content-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}
</style>
```

---

### 3. 预览组件实现

#### 3.1 BrowserFrame（关键组件）

```vue
<!-- src/renderer/src/components/agent/preview/BrowserFrame.vue -->

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{
  url: string;
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

// 刷新按钮
function refresh() {
  if (iframeRef.value) {
    isLoading.value = true;
    loadError.value = null;
    iframeRef.value.src = props.url;
  }
}

// 在新窗口打开
function openInNewWindow() {
  window.open(props.url, '_blank');
}

// iframe 加载完成
function handleLoad() {
  isLoading.value = false;
}

// iframe 加载错误
function handleError() {
  isLoading.value = false;
  loadError.value = '无法加载页面';
}

watch(
  () => props.url,
  () => {
    isLoading.value = true;
    loadError.value = null;
  }
);
</script>

<template>
  <div class="browser-frame">
    <!-- 地址栏 -->
    <div class="address-bar">
      <span class="url">{{ url }}</span>
      <div class="actions">
        <button class="action-btn" title="刷新" @click="refresh">
          <span class="i-carbon-renew" />
        </button>
        <button class="action-btn" title="在新窗口打开" @click="openInNewWindow">
          <span class="i-carbon-launch" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner" />
      <p>加载中...</p>
    </div>

    <!-- Error -->
    <div v-if="loadError" class="error-overlay">
      <span class="i-carbon-warning text-4xl text-red-500" />
      <p>{{ loadError }}</p>
      <button class="retry-btn" @click="refresh">重试</button>
    </div>

    <!-- iframe -->
    <iframe
      ref="iframeRef"
      :src="url"
      class="preview-iframe"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      @load="handleLoad"
      @error="handleError" />
  </div>
</template>

<style scoped>
.browser-frame {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
}

.address-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.url {
  flex: 1;
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover {
  background: #e0e0e0;
}

.preview-iframe {
  flex: 1;
  width: 100%;
  border: none;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: white;
  z-index: 10;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f0f0f0;
  border-top-color: #0066ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.retry-btn {
  padding: 8px 16px;
  background: #0066ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
</style>
```

#### 3.2 PDFViewer

```vue
<!-- src/renderer/src/components/agent/preview/PDFViewer.vue -->

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getFileUrl } from '@/utils/fileUtils';

const props = defineProps<{
  filePath: string;
}>();

const pdfUrl = ref<string>('');
const currentPage = ref(1);
const totalPages = ref(0);

onMounted(async () => {
  // 获取文件 URL（通过 Gateway API）
  pdfUrl.value = await getFileUrl(props.filePath);
});

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--;
  }
}
</script>

<template>
  <div class="pdf-viewer">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button @click="prevPage" :disabled="currentPage === 1">上一页</button>
      <span>{{ currentPage }} / {{ totalPages }}</span>
      <button @click="nextPage" :disabled="currentPage === totalPages">下一页</button>
    </div>

    <!-- PDF 内容（使用 iframe 或 PDF.js） -->
    <iframe :src="`/pdfjs-4.0.379-dist/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`" class="pdf-frame" />
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.pdf-frame {
  flex: 1;
  width: 100%;
  border: none;
}
</style>
```

#### 3.3 ImageViewer

```vue
<!-- src/renderer/src/components/agent/preview/ImageViewer.vue -->

<script setup lang="ts">
import { ref, computed } from 'vue';
import { getFileUrl } from '@/utils/fileUtils';

const props = defineProps<{
  filePath: string;
}>();

const imageUrl = computed(() => getFileUrl(props.filePath));
const zoom = ref(100);

function zoomIn() {
  zoom.value = Math.min(zoom.value + 10, 200);
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 10, 50);
}

function resetZoom() {
  zoom.value = 100;
}
</script>

<template>
  <div class="image-viewer">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button @click="zoomOut">-</button>
      <span>{{ zoom }}%</span>
      <button @click="zoomIn">+</button>
      <button @click="resetZoom">重置</button>
    </div>

    <!-- 图片 -->
    <div class="image-container">
      <img :src="imageUrl" :style="{ transform: `scale(${zoom / 100})` }" alt="预览" />
    </div>
  </div>
</template>

<style scoped>
.image-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fafafa;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.image-container img {
  max-width: 100%;
  max-height: 100%;
  transition: transform 0.2s;
}
</style>
```

---

### 4. Agent 启动服务时的集成

#### Agent 指令中增加服务启动提示

```typescript
// src/main/ai/AgentEnvInjector.ts

function buildExecutionProtocol(): string {
  return `
...existing protocol...

## Local Service Preview

When you start a local service (e.g., \`npm run dev\`, \`python -m http.server\`):

1. **启动服务**：使用 \`exec\` 工具执行启动命令
2. **获取地址**：从输出中提取服务地址（如 \`http://localhost:3000\`）
3. **通知用户**：使用 \`notify_service\` 工具通知前端打开预览

Example:
\`\`\`
exec({ command: "cd frontend && npm run dev" })
→ Output: "Local: http://localhost:5173"
→ notify_service({ url: "http://localhost:5173", title: "Frontend Dev Server" })
\`\`\`

The frontend will automatically open an iframe preview in the Workbench Panel.
`;
}
```

#### 新增 notify_service 工具

```typescript
// src/main/ai/tools/builtin/notify-service.ts

export const notifyServiceTool: ToolDefinition = {
  name: 'notify_service',
  description: '通知前端打开本地服务预览（在 Workbench 中嵌入 iframe）',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '服务地址（如 http://localhost:3000）'
      },
      title: {
        type: 'string',
        description: '服务名称（用于 Tab 标题）'
      }
    },
    required: ['url', 'title']
  },

  async execute(params: { url: string; title: string }, ctx: ToolExecutionContext) {
    const { url, title } = params;

    // 通过 Gateway 发送事件到前端
    const { gateway } = await import('@main/gateway');
    gateway.broadcastToSubscribers(
      {
        type: 'event',
        event: 'service:started',
        data: { url, title, sessionId: ctx.sessionId }
      },
      ctx.sessionId
    );

    return {
      success: true,
      message: `已通知前端打开服务预览：${title} (${url})`
    };
  }
};
```

#### 前端监听服务事件

```typescript
// src/renderer/src/views/ThreadView.vue

import { onMounted, ref } from 'vue';
import { useGateway } from '@/composables/useGateway';

const gateway = useGateway();
const workbenchPanelRef = ref<InstanceType<typeof WorkbenchPanel> | null>(null);

onMounted(() => {
  // 监听服务启动事件
  gateway.on('service:started', (data) => {
    if (data.sessionId === currentSessionId.value) {
      // 在 Workbench 中打开浏览器预览
      workbenchPanelRef.value?.addBrowserPreview(data.url, data.title);

      // Toast 提示
      showToast(`服务已启动：${data.title}`, 'success');
    }
  });
});
```

---

### 5. 终端支持

#### 终端 UI 组件

```vue
<!-- src/renderer/src/components/agent/TerminalPanel.vue -->

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useGateway } from '@/composables/useGateway';

const props = defineProps<{
  sessionId: string;
}>();

const gateway = useGateway();
const terminalOutput = ref<string>('');
const terminalRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  // 监听终端输出
  gateway.on('terminal:output', (data) => {
    if (data.sessionId === props.sessionId) {
      terminalOutput.value += data.output;
      scrollToBottom();
    }
  });
});

function scrollToBottom() {
  if (terminalRef.value) {
    terminalRef.value.scrollTop = terminalRef.value.scrollHeight;
  }
}

watch(terminalOutput, () => {
  scrollToBottom();
});
</script>

<template>
  <div class="terminal-panel">
    <div class="terminal-header">
      <span class="i-carbon-terminal" />
      <span>终端</span>
    </div>

    <div ref="terminalRef" class="terminal-content">
      <pre>{{ terminalOutput }}</pre>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Monaco', monospace;
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #404040;
}

.terminal-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.terminal-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
```

#### exec 工具输出到终端

```typescript
// src/main/ai/tools/builtin/exec.ts

export async function execute(params: ExecParams, ctx: ToolExecutionContext) {
  // ... 现有代码 ...

  // 将输出发送到前端终端
  const { gateway } = await import('@main/gateway');
  gateway.broadcastToSubscribers(
    {
      type: 'event',
      event: 'terminal:output',
      data: {
        sessionId: ctx.sessionId,
        output: stdout || stderr
      }
    },
    ctx.sessionId
  );

  return result;
}
```

---

## 完整工作流演示

### 场景 1：Agent 启动前端开发服务器

```
用户: 帮我启动前端开发服务器

Agent:
  1. exec({ command: "cd frontend && npm run dev" })
     → 输出到终端: "VITE v5.0.0  ready in 320 ms
                    ➜  Local:   http://localhost:5173/"

  2. 解析输出，提取 URL

  3. notify_service({
       url: "http://localhost:5173",
       title: "Frontend Dev Server"
     })

前端:
  → 收到 service:started 事件
  → WorkbenchPanel 新增 Tab: "🌐 Frontend Dev Server"
  → iframe 加载 http://localhost:5173
  → 用户可以直接在系统内预览，无需跳出
```

### 场景 2：Agent 生成 HTML 报告

```
用户: 帮我生成数据分析报告

Agent:
  1. 分析数据...

  2. write({
       path: "report.html",
       content: "<html>...报告内容...</html>"
     })

前端:
  → 文件树显示 report.html
  → 用户点击 report.html
  → WorkbenchPanel 自动识别为 HTML
  → 使用 HTMLPreview 组件渲染
  → 用户可以直接查看渲染后的报告
```

### 场景 3：Agent 生成 PDF 文档

```
用户: 把报告导出为 PDF

Agent:
  1. exec({ command: "wkhtmltopdf report.html report.pdf" })

  2. → 文件树显示 report.pdf

前端:
  → 用户点击 report.pdf
  → WorkbenchPanel 自动识别为 PDF
  → 使用 PDFViewer 组件（PDF.js）渲染
  → 用户可以翻页、缩放
```

---

## 实施优先级

### P0（立即实施，2-3 天）

1. **BrowserFrame 组件**（1 天）
   - iframe 基础功能
   - 地址栏、刷新、新窗口打开
   - Loading 和错误处理

2. **notify_service 工具**（0.5 天）
   - 后端工具实现
   - 前端事件监听
   - Workbench 集成

3. **PreviewRouter**（0.5 天）
   - 文件类型识别
   - 路由逻辑

4. **基础预览组件**（1 天）
   - ImageViewer
   - PDFViewer（使用 PDF.js）

### P1（后续优化，2-3 天）

1. **VideoPlayer**（0.5 天）
2. **MarkdownPreview**（0.5 天，使用 marked.js）
3. **终端 UI**（1 天）
4. **HTMLPreview 增强**（0.5 天，支持实时刷新）

### P2（锦上添花）

1. **代码编辑器增强**（支持 diff 视图）
2. **预览历史记录**
3. **多窗口预览**（分屏显示代码和预览）

---

## 技术选型

### PDF 预览

**推荐**: [PDF.js](https://mozilla.github.io/pdf.js/)

- Mozilla 官方，成熟稳定
- 纯前端渲染，无需后端
- 支持缩放、搜索、打印

```bash
pnpm add pdfjs-dist
```

### Markdown 渲染

**推荐**: [marked.js](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)

- 轻量、快速
- 支持 GitHub Flavored Markdown
- 代码高亮

```bash
pnpm add marked highlight.js
```

### 终端模拟器（可选）

**推荐**: [xterm.js](https://xtermjs.org/)

- 完整的终端模拟器
- 支持 ANSI 颜色
- 可交互（如果需要）

```bash
pnpm add @xterm/xterm
```

---

## 安全考虑

### iframe 安全

```html
<iframe src="..." sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer" />
```

**sandbox 属性**：

- `allow-scripts`: 允许运行 JavaScript（必需）
- `allow-same-origin`: 允许访问同源资源
- `allow-forms`: 允许表单提交
- `allow-popups`: 允许弹窗

**限制**：

- ❌ 不允许 `allow-top-navigation`（防止劫持父窗口）
- ❌ 不允许 `allow-modals`（防止弹窗干扰）

### 本地服务访问

**只允许 localhost**：

```typescript
function validateServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = ['localhost', '127.0.0.1', '[::1]'];
    return allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}
```

---

## 总结

### 核心改进

1. **从"万能代码编辑器"变为"智能多模态预览"**
2. **支持 Agent 启动的本地服务内嵌预览**
3. **终端 UI 显示命令输出**
4. **用户无需跳出系统即可查看所有内容**

### 用户体验提升

- ✅ PDF/图片/视频原生预览
- ✅ HTML 报告直接渲染
- ✅ 本地服务实时预览（iframe）
- ✅ 终端输出实时显示
- ✅ 一站式体验，无需切换窗口

### 技术亮点

- 动态组件切换（Vue `<component :is>`）
- iframe 安全沙箱
- Gateway 事件驱动（service:started, terminal:output）
- 文件类型智能路由

---

**文档版本**: v1.0.0  
**创建时间**: 2026-02-24  
**状态**: 📋 设计方案（待实施）
