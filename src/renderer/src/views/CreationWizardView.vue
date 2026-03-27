<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import {
  startCreation,
  chatWithAnalyst,
  finishRequirements,
  listSessions,
  getSession,
  deleteSession,
  listSessionFiles,
  readSessionFile,
  addKnowledge,
  launchAutopilot,
  pauseAutopilot,
  resumeAutopilot
} from '@/api/creation';
import type { CreationSessionMeta, CreationTargetType, FileInfo } from '@shared/types/creation';
import { PHASE_ORDER, PHASE_LABELS } from '@shared/types/creation';

type ViewStage = 'list' | 'requirements' | 'autopilot' | 'completed';

const stage = ref<ViewStage>('list');
const sessions = ref<CreationSessionMeta[]>([]);
const currentSession = ref<CreationSessionMeta | null>(null);

const chatMessages = ref<{ role: 'user' | 'assistant'; content: string }[]>([]);
const chatInput = ref('');
const chatLoading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

const sessionFiles = ref<FileInfo[]>([]);
const newlyAddedFiles = ref<Set<string>>(new Set());

const showFileViewer = ref(false);
const viewerFilename = ref('');
const viewerContent = ref('');
const viewerLoading = ref(false);

const newTargetType = ref<CreationTargetType>('skill');
const newRequirement = ref('');
const showNewDialog = ref(false);

const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);

const PHASE_ICONS: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  skipped: '◌',
  failed: '✗'
};

const sortedFiles = computed(() => {
  return [...sessionFiles.value]
    .filter((f) => f.filename !== '00-session.md')
    .sort((a, b) => a.filename.localeCompare(b.filename));
});

const currentPhaseIndex = computed(() => {
  if (!currentSession.value) return -1;
  return PHASE_ORDER.findIndex((p) => currentSession.value!.phases[p].status === 'running');
});

const completedPhaseCount = computed(() => {
  if (!currentSession.value) return 0;
  return PHASE_ORDER.filter(
    (p) =>
      currentSession.value!.phases[p].status === 'completed' || currentSession.value!.phases[p].status === 'skipped'
  ).length;
});

watch(
  chatMessages,
  () => {
    nextTick(() => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
      }
    });
  },
  { deep: true }
);

onMounted(async () => {
  await loadSessions();
});

onUnmounted(() => {
  stopPolling();
});

async function loadSessions(): Promise<void> {
  sessions.value = await listSessions();
}

async function openSession(session: CreationSessionMeta): Promise<void> {
  currentSession.value = session;
  sessionFiles.value = await listSessionFiles(session.id);
  newlyAddedFiles.value.clear();

  if (session.status === 'requirements') {
    stage.value = 'requirements';
    chatMessages.value = [
      {
        role: 'assistant',
        content: `你好！我是需求分析师，帮你创建${session.targetType === 'skill' ? '技能' : '智能体'}。\n\n你的初始需求是：「${session.userRequirement}」\n\n让我来进一步了解你的需求。首先，请描述一下这个${session.targetType === 'skill' ? '技能' : '智能体'}主要解决什么问题？在什么场景下使用？`
      }
    ];
  } else if (session.status === 'autopilot' || session.status === 'paused') {
    stage.value = 'autopilot';
    startPolling();
  } else if (session.status === 'completed') {
    stage.value = 'completed';
  } else {
    stage.value = 'autopilot';
  }
}

async function createNew(): Promise<void> {
  if (!newRequirement.value.trim()) return;

  const session = await startCreation(newRequirement.value.trim(), newTargetType.value);
  if (!session) return;

  showNewDialog.value = false;
  newRequirement.value = '';
  await loadSessions();
  await openSession(session);
}

async function sendChat(): Promise<void> {
  if (!chatInput.value.trim() || !currentSession.value || chatLoading.value) return;

  const message = chatInput.value.trim();
  chatMessages.value.push({ role: 'user', content: message });
  chatInput.value = '';
  chatLoading.value = true;

  try {
    const reply = await chatWithAnalyst(currentSession.value.id, message);
    chatMessages.value.push({ role: 'assistant', content: reply });

    const fileBlocks = parseFileBlocks(reply);
    if (fileBlocks.length > 0) {
      await finishRequirements(currentSession.value.id, fileBlocks);
      sessionFiles.value = await listSessionFiles(currentSession.value.id);
      for (const fb of fileBlocks) {
        newlyAddedFiles.value.add(fb.filename);
      }
      chatMessages.value.push({
        role: 'assistant',
        content: `已生成 ${fileBlocks.length} 个标准化文件（见右侧面板）。需求分析阶段完成，你可以点击右侧文件查看内容，确认后点击「启动自动创建」。`
      });
    }
  } catch (err) {
    chatMessages.value.push({
      role: 'assistant',
      content: `出错了：${err instanceof Error ? err.message : String(err)}`
    });
  } finally {
    chatLoading.value = false;
  }
}

function parseFileBlocks(text: string): { filename: string; content: string }[] {
  const blocks: { filename: string; content: string }[] = [];
  const regex = /```filename:([\w.-]+\.md)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({ filename: match[1], content: match[2].trim() });
  }

  return blocks;
}

async function openFileViewer(filename: string): Promise<void> {
  if (!currentSession.value) return;
  viewerFilename.value = filename;
  viewerContent.value = '';
  viewerLoading.value = true;
  showFileViewer.value = true;
  newlyAddedFiles.value.delete(filename);

  try {
    viewerContent.value = await readSessionFile(currentSession.value.id, filename);
  } catch {
    viewerContent.value = '加载失败';
  } finally {
    viewerLoading.value = false;
  }
}

function closeFileViewer(): void {
  showFileViewer.value = false;
}

async function doLaunchAutopilot(): Promise<void> {
  if (!currentSession.value) return;
  await launchAutopilot(currentSession.value.id);
  stage.value = 'autopilot';
  startPolling();
}

async function doPause(): Promise<void> {
  if (!currentSession.value) return;
  await pauseAutopilot(currentSession.value.id);
}

async function doResume(): Promise<void> {
  if (!currentSession.value) return;
  await resumeAutopilot(currentSession.value.id);
}

function startPolling(): void {
  stopPolling();
  const previousFiles = new Set(sessionFiles.value.map((f) => f.filename));

  pollTimer.value = setInterval(async () => {
    if (!currentSession.value) return;
    const updated = await getSession(currentSession.value.id);
    if (updated) {
      currentSession.value = updated;
      const files = await listSessionFiles(updated.id);
      for (const f of files) {
        if (!previousFiles.has(f.filename)) {
          newlyAddedFiles.value.add(f.filename);
          previousFiles.add(f.filename);
        }
      }
      sessionFiles.value = files;
      if (updated.status === 'completed') {
        stage.value = 'completed';
        stopPolling();
      }
    }
  }, 3000);
}

function stopPolling(): void {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

async function handleDeleteSession(id: string): Promise<void> {
  await deleteSession(id);
  await loadSessions();
  if (currentSession.value?.id === id) {
    currentSession.value = null;
    stage.value = 'list';
  }
}

function goBack(): void {
  stopPolling();
  currentSession.value = null;
  stage.value = 'list';
  loadSessions();
}

async function addTextKnowledge(): Promise<void> {
  if (!currentSession.value) return;
  const text = prompt('请粘贴知识库文本内容：');
  if (!text) return;
  const name = prompt('请输入文件名（如 reference.md）：', 'knowledge.md');
  if (!name) return;

  await addKnowledge(currentSession.value.id, {
    id: `kb-${Date.now()}`,
    type: 'text',
    name,
    content: text,
    addedAt: Date.now()
  });
  sessionFiles.value = await listSessionFiles(currentSession.value.id);
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    running: '执行中...',
    completed: '已完成',
    skipped: '已跳过',
    failed: '失败'
  };
  return map[status] || status;
}

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-primary text-primary-foreground',
    completed: 'bg-success text-white',
    skipped: 'bg-muted text-muted-foreground',
    failed: 'bg-destructive text-white'
  };
  return map[status] || '';
}

function getFilePhaseLabel(filename: string): string {
  const prefix = filename.split('-')[0];
  const num = parseInt(prefix);
  const labels: Record<number, string> = { 1: '需求', 2: '设计', 3: '实施', 4: '验证', 5: '迭代', 6: '发布' };
  return labels[num] || '';
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <!-- ==================== 列表视图 ==================== -->
    <template v-if="stage === 'list'">
      <div class="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 class="text-lg font-semibold">智能创建</h1>
        <button
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          @click="showNewDialog = true">
          新建创建
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6">
        <div
          v-if="sessions.length === 0"
          class="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
          <span class="text-4xl">✦</span>
          <span>还没有创建会话，点击「新建创建」开始</span>
        </div>

        <div class="space-y-3">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card p-4 transition hover:border-primary/30 hover:shadow-sm"
            @click="openSession(s)">
            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg"
                :class="s.targetType === 'skill' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'">
                {{ s.targetType === 'skill' ? '⚡' : '🤖' }}
              </div>
              <div>
                <div class="font-medium text-card-foreground">{{ s.name }}</div>
                <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{{ s.targetType === 'skill' ? '技能' : '智能体' }}</span>
                  <span
                    class="rounded-full px-2 py-0.5"
                    :class="{
                      'bg-primary/10 text-primary': s.status === 'requirements',
                      'bg-warning/10 text-warning': s.status === 'autopilot',
                      'bg-success/10 text-success': s.status === 'completed',
                      'bg-muted text-muted-foreground': s.status === 'paused'
                    }">
                    {{
                      s.status === 'requirements'
                        ? '需求分析中'
                        : s.status === 'autopilot'
                          ? '自动创建中'
                          : s.status === 'completed'
                            ? '已完成'
                            : s.status === 'paused'
                              ? '已暂停'
                              : s.status
                    }}
                  </span>
                  <span>{{ new Date(s.createdAt).toLocaleString('zh-CN') }}</span>
                </div>
              </div>
            </div>
            <button
              class="rounded p-1.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              @click.stop="handleDeleteSession(s.id)">
              ✕
            </button>
          </div>
        </div>
      </div>

      <!-- 新建对话框 -->
      <div
        v-if="showNewDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        @click.self="showNewDialog = false">
        <div class="w-[520px] rounded-2xl bg-card p-6 shadow-2xl">
          <h2 class="text-lg font-semibold text-card-foreground">新建创建</h2>
          <div class="mt-4 flex gap-3">
            <button
              class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
              :class="
                newTargetType === 'skill'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              "
              @click="newTargetType = 'skill'">
              ⚡ 创建技能 (Skill)
            </button>
            <button
              class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
              :class="
                newTargetType === 'agent'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              "
              @click="newTargetType = 'agent'">
              🤖 创建智能体 (Agent)
            </button>
          </div>
          <textarea
            v-model="newRequirement"
            class="mt-4 w-full rounded-lg border border-border bg-surface p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            rows="4"
            placeholder="描述你的需求...（例如：我想创建一个销售话术分析的技能）" />
          <div class="mt-4 flex justify-end gap-3">
            <button
              class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-surface"
              @click="showNewDialog = false">
              取消
            </button>
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              :disabled="!newRequirement.trim()"
              @click="createNew">
              开始创建
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 需求分析阶段 ==================== -->
    <template v-if="stage === 'requirements' && currentSession">
      <div class="flex items-center gap-3 border-b border-border px-6 py-3">
        <button class="rounded-lg p-1 text-muted-foreground hover:bg-surface hover:text-foreground" @click="goBack"
          >←</button
        >
        <div class="flex-1">
          <div class="font-medium">{{ currentSession.name }}</div>
          <div class="text-xs text-muted-foreground"
            >第 1 步 / 共 6 步 · 需求分析中（仅此步骤需要你参与，后续全自动）</div
          >
        </div>
        <button
          v-if="sessionFiles.some((f) => f.filename.startsWith('01-'))"
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          @click="doLaunchAutopilot">
          启动自动创建 →
        </button>
      </div>

      <!-- 流水线总览条 -->
      <div class="flex items-center gap-0 border-b border-border bg-surface/30 px-6 py-2">
        <template v-for="(phaseId, idx) in PHASE_ORDER" :key="phaseId">
          <div class="flex items-center gap-1.5 px-2 py-1 rounded" :class="idx === 0 ? 'bg-primary/10' : ''">
            <span
              class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
              :class="idx === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'">
              {{ idx + 1 }}
            </span>
            <span class="text-xs" :class="idx === 0 ? 'text-primary font-medium' : 'text-muted-foreground'">
              {{ PHASE_LABELS[phaseId] }}
            </span>
          </div>
          <div v-if="idx < PHASE_ORDER.length - 1" class="h-px w-4 bg-border" />
        </template>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 对话区域 -->
        <div class="flex flex-1 flex-col">
          <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">
            <div
              v-for="(msg, i) in chatMessages"
              :key="i"
              class="flex"
              :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
                :class="msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-surface text-foreground'">
                {{ msg.content }}
              </div>
            </div>
            <div v-if="chatLoading" class="flex justify-start">
              <div class="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm text-muted-foreground">
                <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                分析中...
              </div>
            </div>
          </div>

          <div class="border-t border-border p-4">
            <div class="flex gap-2">
              <input
                v-model="chatInput"
                class="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                placeholder="输入你的回答..."
                @keydown.enter.prevent="sendChat" />
              <button
                class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                :disabled="!chatInput.trim() || chatLoading"
                @click="sendChat">
                发送
              </button>
            </div>
            <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <button class="hover:text-primary" @click="addTextKnowledge">+ 添加知识库</button>
            </div>
          </div>
        </div>

        <!-- 右侧文件面板 -->
        <div class="w-72 shrink-0 border-l border-border bg-surface/30 overflow-y-auto">
          <div class="p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              产出文件 ({{ sortedFiles.length }})
            </div>
            <div class="mt-3 space-y-1.5">
              <div
                v-for="f in sortedFiles"
                :key="f.filename"
                class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition hover:shadow-sm"
                :class="
                  newlyAddedFiles.has(f.filename)
                    ? 'border-primary/50 bg-primary/5 animate-pulse'
                    : 'border-border hover:border-primary/30 hover:bg-surface'
                "
                @click="openFileViewer(f.filename)">
                <span class="text-base">📄</span>
                <div class="flex-1 min-w-0">
                  <div class="truncate font-medium text-foreground">{{ f.filename }}</div>
                  <div class="text-[10px] text-muted-foreground">{{ getFilePhaseLabel(f.filename) }} · 点击查看</div>
                </div>
                <span v-if="newlyAddedFiles.has(f.filename)" class="flex h-2 w-2 rounded-full bg-primary" />
              </div>
              <div v-if="sortedFiles.length === 0" class="py-6 text-center text-xs text-muted-foreground">
                <div class="text-2xl mb-2">📋</div>
                对话完成后将自动生成文件
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 自动执行 / 完成阶段 ==================== -->
    <template v-if="(stage === 'autopilot' || stage === 'completed') && currentSession">
      <div class="flex items-center gap-3 border-b border-border px-6 py-3">
        <button class="rounded-lg p-1 text-muted-foreground hover:bg-surface hover:text-foreground" @click="goBack"
          >←</button
        >
        <div class="flex-1">
          <div class="font-medium">{{ currentSession.name }}</div>
          <div class="text-xs text-muted-foreground">
            <template v-if="stage === 'completed'"> 全部 6 个阶段已完成 </template>
            <template v-else-if="currentSession.status === 'paused'">
              已暂停 · {{ completedPhaseCount }} / 6 阶段完成
            </template>
            <template v-else> 自动创建中 · {{ completedPhaseCount }} / 6 阶段完成 </template>
          </div>
        </div>
        <template v-if="stage === 'autopilot'">
          <button
            v-if="currentSession.status === 'autopilot'"
            class="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface"
            @click="doPause">
            暂停
          </button>
          <button
            v-if="currentSession.status === 'paused'"
            class="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary-hover"
            @click="doResume">
            继续执行
          </button>
        </template>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 左侧：流水线进度 -->
        <div class="w-64 shrink-0 border-r border-border overflow-y-auto">
          <div class="p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-4">流水线进度</div>

            <div class="space-y-1">
              <template v-for="(phaseId, idx) in PHASE_ORDER" :key="phaseId">
                <div
                  class="flex items-start gap-3 rounded-lg p-2.5 transition"
                  :class="{
                    'bg-primary/8': currentSession.phases[phaseId].status === 'running',
                    'bg-surface/50': currentSession.phases[phaseId].status === 'completed'
                  }">
                  <!-- 序号圆圈 -->
                  <div class="relative flex flex-col items-center">
                    <div
                      class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all"
                      :class="getStatusColor(currentSession.phases[phaseId].status)">
                      <template v-if="currentSession.phases[phaseId].status === 'running'">
                        <span class="animate-spin">⟳</span>
                      </template>
                      <template v-else-if="currentSession.phases[phaseId].status === 'completed'"> ✓ </template>
                      <template v-else-if="currentSession.phases[phaseId].status === 'failed'"> ✗ </template>
                      <template v-else>
                        {{ idx + 1 }}
                      </template>
                    </div>
                    <!-- 连接线 -->
                    <div
                      v-if="idx < PHASE_ORDER.length - 1"
                      class="mt-1 h-4 w-px"
                      :class="currentSession.phases[phaseId].status === 'completed' ? 'bg-success' : 'bg-border'" />
                  </div>

                  <!-- 文字 -->
                  <div class="flex-1 min-w-0 pt-1">
                    <div
                      class="text-sm font-medium"
                      :class="{
                        'text-primary': currentSession.phases[phaseId].status === 'running',
                        'text-foreground': currentSession.phases[phaseId].status === 'completed',
                        'text-destructive': currentSession.phases[phaseId].status === 'failed',
                        'text-muted-foreground':
                          currentSession.phases[phaseId].status === 'pending' ||
                          currentSession.phases[phaseId].status === 'skipped'
                      }">
                      {{ PHASE_LABELS[phaseId] }}
                    </div>
                    <div
                      class="text-[10px] mt-0.5"
                      :class="
                        currentSession.phases[phaseId].status === 'running'
                          ? 'text-primary/70'
                          : 'text-muted-foreground'
                      ">
                      {{ getStatusLabel(currentSession.phases[phaseId].status) }}
                      <template
                        v-if="currentSession.phases[phaseId].completedAt && currentSession.phases[phaseId].startedAt">
                        ·
                        {{
                          Math.round(
                            ((currentSession.phases[phaseId].completedAt ?? 0) -
                              (currentSession.phases[phaseId].startedAt ?? 0)) /
                              1000
                          )
                        }}s
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- 文件列表 -->
          <div class="border-t border-border p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3">
              产出文件 ({{ sortedFiles.length }})
            </div>
            <div class="space-y-1.5">
              <div
                v-for="f in sortedFiles"
                :key="f.filename"
                class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition hover:shadow-sm"
                :class="
                  newlyAddedFiles.has(f.filename)
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-primary/30'
                "
                @click="openFileViewer(f.filename)">
                <span>📄</span>
                <div class="flex-1 min-w-0">
                  <div class="truncate font-medium text-foreground">{{ f.filename }}</div>
                </div>
                <span
                  v-if="newlyAddedFiles.has(f.filename)"
                  class="flex h-2 w-2 shrink-0 rounded-full bg-primary animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：主内容区 -->
        <div class="flex flex-1 flex-col items-center justify-center overflow-y-auto p-8">
          <template v-if="stage === 'completed'">
            <div class="text-center">
              <div class="text-5xl mb-4">🎉</div>
              <h2 class="text-xl font-semibold text-foreground">创建完成</h2>
              <p class="mt-2 text-sm text-muted-foreground">
                {{ currentSession.targetType === 'skill' ? '技能' : '智能体' }}「{{ currentSession.name }}」已创建成功
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                共生成 {{ sortedFiles.length }} 个文件，点击左侧文件名查看详情
              </p>
            </div>
          </template>
          <template v-else-if="currentPhaseIndex >= 0">
            <div class="text-center">
              <div class="relative inline-flex">
                <div class="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                  <span class="text-3xl animate-pulse">{{ PHASE_ICONS.running }}</span>
                </div>
              </div>
              <h2 class="mt-4 text-lg font-semibold text-foreground">
                正在执行：{{ PHASE_LABELS[PHASE_ORDER[currentPhaseIndex]] }}
              </h2>
              <p class="mt-1 text-sm text-muted-foreground"> 第 {{ currentPhaseIndex + 1 }} / 6 步 · 请耐心等待 </p>
              <p class="mt-4 text-xs text-muted-foreground"> 新生成的文件会实时出现在左侧列表中 </p>
            </div>
          </template>
          <template v-else>
            <div class="text-center text-muted-foreground">
              <div class="text-4xl mb-3">⏳</div>
              <p class="text-sm">等待执行...</p>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- ==================== 文件查看对话框 ==================== -->
    <div
      v-if="showFileViewer"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="closeFileViewer">
      <div class="flex h-[80vh] w-[70vw] max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        <!-- 对话框头部 -->
        <div class="flex items-center justify-between border-b border-border px-6 py-4">
          <div class="flex items-center gap-2">
            <span>📄</span>
            <span class="font-mono text-sm font-medium text-card-foreground">{{ viewerFilename }}</span>
            <span
              v-if="getFilePhaseLabel(viewerFilename)"
              class="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {{ getFilePhaseLabel(viewerFilename) }}
            </span>
          </div>
          <button
            class="rounded-lg p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
            @click="closeFileViewer">
            ✕
          </button>
        </div>
        <!-- 文件内容 -->
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
