<script setup lang="ts">
/**
 * TavernView — 酒馆任务系统
 *
 * 任务发布平台，支持：
 * - 任务列表展示（块状/列表视图）
 * - 任务发布（描述 + 文件 + 金额）
 * - 任务详情查看
 *
 * 存储：文件系统（每个任务一个文件夹）
 */

import { ref, provide, computed } from 'vue';
import { useThreadsStore } from '@/stores/threads';
import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import TaskList from '@/components/tavern/TaskList.vue';
import TaskForm from '@/components/tavern/TaskForm.vue';

const threadsStore = useThreadsStore();

export interface Task {
  id: string;
  title: string;
  description: string;
  amount: number;
  files: string[];
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

const view = ref<'list' | 'create' | 'detail'>('list');
const selectedTaskId = ref<string | null>(null);
const taskFormRef = ref<InstanceType<typeof TaskForm> | null>(null);
const leftCollapsed = ref(false);

// 从当前活跃 thread 获取项目路径，如果没有则为空
const projectPath = ref<string | null>(null);

// 尝试从当前 thread 获取工作目录
const activeThread = computed(() => {
  if (threadsStore.activeThreadId) {
    return threadsStore.threads.find((t) => t.id === threadsStore.activeThreadId);
  }
  return null;
});

// 如果有活跃的 thread，使用其工作目录
if (activeThread.value?.workspacePath) {
  projectPath.value = activeThread.value.workspacePath;
}

function handleCreateTask(): void {
  view.value = 'create';
  selectedTaskId.value = null;
}

// 提供给文件树的"添加到任务"功能
function addFileToTask(node: { path: string; name: string }): void {
  if (view.value === 'create' || view.value === 'detail') {
    taskFormRef.value?.addFilePath(node.path);
  }
}

provide('addFileToTask', addFileToTask);

function handleViewTask(taskId: string): void {
  view.value = 'detail';
  selectedTaskId.value = taskId;
}

function handleBackToList(): void {
  view.value = 'list';
  selectedTaskId.value = null;
}

function handleTaskCreated(): void {
  view.value = 'list';
}
</script>

<template>
  <div class="tavern-view">
    <!-- 双栏布局 -->
    <div class="tavern-layout">
      <!-- 左侧：任务工作目录（发布任务时显示） -->
      <ProjectPanel
        v-if="view === 'create' || view === 'detail'"
        v-model:collapsed="leftCollapsed"
        v-model:project-path="projectPath" />

      <!-- 右侧：主内容区 -->
      <div class="main-content">
        <!-- 顶栏 -->
        <header class="header">
          <div class="header-left">
            <button
              v-if="(view === 'create' || view === 'detail') && leftCollapsed"
              class="toggle-btn"
              title="显示目录"
              @click="leftCollapsed = false">
              <span class="i-carbon-chevron-right inline-block h-4 w-4" />
            </button>
            <button v-if="view !== 'list'" class="back-btn" @click="handleBackToList">
              <span class="i-carbon-chevron-left inline-block h-4 w-4" />
            </button>
            <div class="header-icon">
              <span class="i-carbon-task-star inline-block h-4 w-4" />
            </div>
            <h1 class="header-title">
              {{ view === 'list' ? '酒馆任务' : view === 'create' ? '发布任务' : '任务详情' }}
            </h1>
          </div>
          <div class="header-right">
            <button v-if="view === 'list'" class="create-btn" @click="handleCreateTask">
              <span class="i-carbon-add inline-block h-3.5 w-3.5" />
              <span>发布任务</span>
            </button>
          </div>
        </header>

        <!-- 内容区域 -->
        <div class="content">
          <!-- 任务列表 -->
          <TaskList v-if="view === 'list'" @view-task="handleViewTask" />

          <!-- 任务发布表单 -->
          <TaskForm
            v-else-if="view === 'create'"
            ref="taskFormRef"
            @cancel="handleBackToList"
            @success="handleTaskCreated" />

          <!-- 任务详情 -->
          <TaskForm
            v-else-if="view === 'detail' && selectedTaskId"
            ref="taskFormRef"
            :task-id="selectedTaskId"
            readonly
            @cancel="handleBackToList" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tavern-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.tavern-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.main-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toggle-btn,
.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.toggle-btn:hover,
.back-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.create-btn:hover {
  background: hsl(var(--primary) / 0.14);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
</style>
