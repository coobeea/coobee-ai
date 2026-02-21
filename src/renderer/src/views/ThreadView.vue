<script setup lang="ts">
/**
 * ThreadView — 任务工作区视图
 *
 * 根据路由参数 :id 加载 Thread，展示三栏工作区（任务工作目录 | 工作台 | 对话）。
 * 与 AgentView（智能体管理列表）完全解耦。
 */

import { ref, computed, watch, onMounted, onUnmounted, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useCopilotStore } from '@/stores/copilot';
import { useOpenFiles } from '@/composables/useOpenFiles';

import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import VoicePanel from '@/components/agent/VoicePanel.vue';
import AgentsPanel from '@/components/agent/AgentsPanel.vue';

const route = useRoute();
const router = useRouter();
const chatStore = useChatStore();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const copilotStore = useCopilotStore();
const { closeAllFiles } = useOpenFiles();

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const agentsPanelCollapsed = ref(true);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);

const projectPath = ref<string | null>(null);
// workspaceReady: 非 null 即为 ready（包括空字符串）
const workspaceReady = computed(() => projectPath.value !== null);

const threadId = computed(() => route.params.id as string);

// 提供 addToChat 方法给 ProjectPanel/FileTreeNode
function addToChat(node: { path: string; name: string; type: 'file' | 'directory' }): void {
  chatPanelRef.value?.insertFileReference({
    path: node.path,
    name: node.name
  });
}

provide('addToChat', addToChat);

function enterWorkspaceForThread(id: string): void {
  const thread = threadsStore.threads.find((t) => t.id === id);
  if (thread) {
    agentsStore.selectAgent(thread.agentId);
    if (thread.workspacePath) {
      projectPath.value = thread.workspacePath;
    } else {
      // 如果 thread 没有 workspacePath，使用空字符串标记为已就绪
      // 用户可以继续使用对话功能，只是项目面板可能为空
      projectPath.value = '';
    }
  }
  threadsStore.selectThread(id);
  closeAllFiles();

  // 在发起网络请求前，直接先切换 Store 的 active sessionId，
  // 以便 loadHistory 能识别过期请求
  chatStore.sessionId = id;
  chatStore.loadHistory(id);
}

async function openDirectoryDialog(): Promise<void> {
  try {
    const result = await window.api?.openDirectory();
    if (result) {
      projectPath.value = result;
    }
  } catch (err) {
    console.warn('[ThreadView] 选择目录失败:', err);
  }
}

function goBackToAgents(): void {
  chatStore.clearMessages();
  closeAllFiles();
  threadsStore.selectThread(null);
  router.push('/agent');
}

onMounted(() => {
  copilotStore.hideBubble();
  if (threadId.value) {
    enterWorkspaceForThread(threadId.value);
  }
});

watch(threadId, (newId) => {
  if (newId) {
    projectPath.value = null;
    enterWorkspaceForThread(newId);
  }
});

onUnmounted(() => {
  copilotStore.showBubble();
});
</script>

<template>
  <div class="thread-view">
    <!-- 未选目录：引导页面 -->
    <div v-if="!workspaceReady" class="dir-prompt">
      <div class="dir-prompt-card">
        <div class="dir-prompt-icon">
          <span class="i-carbon-folder-add inline-block h-8 w-8" />
        </div>
        <h2 class="dir-prompt-title">选择项目目录</h2>
        <p class="dir-prompt-desc">
          请先选择一个本地目录作为工作上下文，<br />
          智能体将以该目录下的文件进行分析和操作。
        </p>
        <button class="dir-prompt-btn" @click="openDirectoryDialog">
          <span class="i-carbon-folder-add inline-block h-4 w-4" />
          <span>选择目录</span>
        </button>
        <button class="dir-prompt-back" @click="goBackToAgents"> &larr; 返回列表 </button>
      </div>
    </div>

    <!-- 已选目录：三栏工作区 -->
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <ProjectPanel v-model:collapsed="leftCollapsed" v-model:project-path="projectPath" />
        <WorkbenchPanel />
        <ChatPanel ref="chatPanelRef" v-model:collapsed="rightCollapsed" />
        <AgentsPanel v-model:collapsed="agentsPanelCollapsed" />
      </div>

      <VoicePanel />
    </template>
  </div>
</template>

<style scoped>
.thread-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.dir-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: hsl(var(--background));
}

.dir-prompt-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 360px;
  padding: 40px;
}

.dir-prompt-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.5);
  margin-bottom: 24px;
}

.dir-prompt-title {
  font-size: 17px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.dir-prompt-desc {
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-bottom: 28px;
}

.dir-prompt-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
  margin-bottom: 16px;
}

.dir-prompt-btn:hover {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 12px hsl(var(--primary) / 0.2);
}

.dir-prompt-back {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.45);
  transition: color 0.15s ease;
}

.dir-prompt-back:hover {
  color: hsl(var(--foreground) / 0.6);
}
</style>
