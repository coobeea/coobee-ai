<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
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

const sessionFiles = ref<FileInfo[]>([]);
const selectedFile = ref<string | null>(null);
const fileContent = ref('');

const newTargetType = ref<CreationTargetType>('skill');
const newRequirement = ref('');
const showNewDialog = ref(false);

const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);

const phaseStatusIcons: Record<string, string> = {
  pending: '○',
  running: '⟳',
  completed: '✓',
  skipped: '⏭',
  failed: '✗'
};

const phaseStatusClasses: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-primary animate-spin',
  completed: 'text-success',
  skipped: 'text-muted-foreground',
  failed: 'text-destructive'
};

const sortedFiles = computed(() => {
  return [...sessionFiles.value].sort((a, b) => a.filename.localeCompare(b.filename));
});

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
      chatMessages.value.push({
        role: 'assistant',
        content: `已生成 ${fileBlocks.length} 个标准化文件。需求分析阶段完成，是否启动自动创建流程？`
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
  pollTimer.value = setInterval(async () => {
    if (!currentSession.value) return;
    const updated = await getSession(currentSession.value.id);
    if (updated) {
      currentSession.value = updated;
      sessionFiles.value = await listSessionFiles(updated.id);
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

async function selectFile(filename: string): Promise<void> {
  if (!currentSession.value) return;
  selectedFile.value = filename;
  fileContent.value = await readSessionFile(currentSession.value.id, filename);
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
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <!-- 列表视图 -->
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
        <div v-if="sessions.length === 0" class="flex h-64 items-center justify-center text-muted-foreground">
          还没有创建会话，点击"新建创建"开始
        </div>

        <div class="space-y-3">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card p-4 transition hover:border-primary/30"
            @click="openSession(s)">
            <div>
              <div class="font-medium text-card-foreground">{{ s.name }}</div>
              <div class="mt-1 text-xs text-muted-foreground">
                {{ s.targetType === 'skill' ? '技能' : '智能体' }}
                ·
                {{
                  s.status === 'requirements'
                    ? '需求分析中'
                    : s.status === 'autopilot'
                      ? '自动创建中'
                      : s.status === 'completed'
                        ? '已完成'
                        : s.status
                }}
                ·
                {{ new Date(s.createdAt).toLocaleString('zh-CN') }}
              </div>
            </div>
            <button
              class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
              创建技能 (Skill)
            </button>
            <button
              class="flex-1 rounded-lg border-2 p-3 text-center text-sm transition"
              :class="
                newTargetType === 'agent'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              "
              @click="newTargetType = 'agent'">
              创建智能体 (Agent)
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
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              :disabled="!newRequirement.trim()"
              @click="createNew">
              开始创建
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 需求分析阶段 -->
    <template v-if="stage === 'requirements' && currentSession">
      <div class="flex items-center gap-3 border-b border-border px-6 py-3">
        <button class="text-muted-foreground hover:text-foreground" @click="goBack">←</button>
        <div>
          <div class="font-medium">{{ currentSession.name }}</div>
          <div class="text-xs text-muted-foreground"> 需求分析中 · 完成后自动执行创建流程 </div>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 对话区域 -->
        <div class="flex flex-1 flex-col">
          <div class="flex-1 overflow-y-auto p-4 space-y-4">
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
              <div class="rounded-xl bg-surface px-4 py-3 text-sm text-muted-foreground"> 思考中... </div>
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
              <button
                v-if="sessionFiles.some((f) => f.filename.startsWith('01-'))"
                class="hover:text-primary"
                @click="doLaunchAutopilot">
                启动自动创建 →
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧文件面板 -->
        <div class="w-72 shrink-0 border-l border-border bg-surface/50 overflow-y-auto">
          <div class="p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">已生成文件</div>
            <div class="mt-2 space-y-1">
              <div
                v-for="f in sortedFiles"
                :key="f.filename"
                class="cursor-pointer rounded-lg px-3 py-2 text-xs transition"
                :class="selectedFile === f.filename ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface'"
                @click="selectFile(f.filename)">
                {{ f.filename }}
              </div>
              <div v-if="sortedFiles.length === 0" class="text-xs text-muted-foreground py-2">
                对话完成后将生成文件
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 自动执行阶段 -->
    <template v-if="(stage === 'autopilot' || stage === 'completed') && currentSession">
      <div class="flex items-center gap-3 border-b border-border px-6 py-3">
        <button class="text-muted-foreground hover:text-foreground" @click="goBack">←</button>
        <div class="flex-1">
          <div class="font-medium">{{ currentSession.name }}</div>
          <div class="text-xs text-muted-foreground">
            {{ stage === 'completed' ? '创建完成' : currentSession.status === 'paused' ? '已暂停' : '自动创建中...' }}
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
            继续
          </button>
        </template>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 左侧文件树 -->
        <div class="w-56 shrink-0 border-r border-border overflow-y-auto bg-surface/30">
          <div class="p-3">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 px-2">
              文件 ({{ sortedFiles.length }})
            </div>
            <div class="mt-2 space-y-0.5">
              <div
                v-for="f in sortedFiles"
                :key="f.filename"
                class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition"
                :class="
                  selectedFile === f.filename
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/80 hover:bg-surface'
                "
                @click="selectFile(f.filename)">
                <span class="text-[10px]" :class="f.status === 'completed' ? 'text-success' : 'text-muted-foreground'">
                  {{ f.status === 'completed' ? '✓' : '○' }}
                </span>
                <span class="truncate">{{ f.filename }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 中间进度 + 预览 -->
        <div class="flex flex-1 flex-col overflow-hidden">
          <!-- Phase 进度条 -->
          <div class="border-b border-border px-6 py-4">
            <div class="flex items-center gap-2">
              <template v-for="(phaseId, idx) in PHASE_ORDER" :key="phaseId">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm" :class="phaseStatusClasses[currentSession.phases[phaseId].status]">
                    {{ phaseStatusIcons[currentSession.phases[phaseId].status] }}
                  </span>
                  <span
                    class="text-xs"
                    :class="
                      currentSession.phases[phaseId].status === 'running'
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground'
                    ">
                    {{ PHASE_LABELS[phaseId] }}
                  </span>
                </div>
                <span v-if="idx < PHASE_ORDER.length - 1" class="text-muted-foreground/30">→</span>
              </template>
            </div>
          </div>

          <!-- 文件内容预览 -->
          <div class="flex-1 overflow-y-auto p-6">
            <template v-if="selectedFile && fileContent">
              <div class="mb-4 text-xs font-mono text-muted-foreground">{{ selectedFile }}</div>
              <div class="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">{{ fileContent }}</div>
            </template>
            <template v-else>
              <div class="flex h-full items-center justify-center text-muted-foreground text-sm">
                点击左侧文件查看内容
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
