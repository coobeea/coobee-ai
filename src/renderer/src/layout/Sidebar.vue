<script setup lang="ts">
/**
 * Sidebar — 左侧导航栏
 *
 * 布局：
 *   ┌──────────────────────┐
 *   │  🤖 智能体            │  导航菜单
 *   │  🧩 技能              │
 *   ├──────────────────────┤
 *   │  最近任务             │  标题
 *   │  · 任务 A            │  Thread 列表（持久化，可滚动）
 *   │  · 任务 B            │
 *   │  ...                 │
 *   ├──────────────────────┤
 *   │  🔧 日志  ⚙ 设置      │  底部工具栏
 *   └──────────────────────┘
 *
 * 任务列表从后端 HTTP REST API 获取（.home/threads/），
 * 使用 Snowflake ID 有序排列，最新在前。
 */

import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useThreadsStore, type ThreadRunStatus, type AgentType } from '@/stores/threads';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();
const threadsStore = useThreadsStore();

const activeMenuId = ref('agent');
const showMoreMenu = ref(false);

// 常用菜单（显示在侧边栏）
const mainMenuItems: MenuItem[] = [
  { id: 'agent', label: '智能体', icon: 'i-carbon-bot', route: '/agent' },
  { id: 'employee', label: '数字员工', icon: 'i-carbon-user-avatar', route: '/employee' },
  { id: 'skills', label: '技能市场', icon: 'i-carbon-skill-level-advanced', route: '/skills' },
  { id: 'tavern', label: '酒馆任务', icon: 'i-carbon-task-star', route: '/tavern' },
  { id: 'brain', label: '知识智库', icon: 'i-carbon-catalog', route: '/brain' },
  { id: 'cron', label: '定时任务', icon: 'i-carbon-time', route: '/cron' },
  { id: 'shared-drive', label: '共享网盘', icon: 'i-carbon-folder-shared', route: '/shared-drive' }
];

// 更多功能（显示在弹出菜单中）
const moreMenuItems: MenuItem[] = [
  { id: 'creation', label: '智能创建', icon: 'i-carbon-magic-wand', route: '/creation' },
  { id: 'groupchat', label: '群聊', icon: 'i-carbon-group', route: '/groupchat' },
  { id: 'insight', label: '实时洞察', icon: 'i-carbon-analytics', route: '/insight' },
  { id: 'discussion', label: '群聊讨论', icon: 'i-carbon-chat', route: '/discussion' },
  { id: 'consultation', label: '专家会诊', icon: 'i-carbon-user-multiple', route: '/consultation' },
  { id: 'training', label: '智能体训练', icon: 'i-carbon-machine-learning-model', route: '/training' },
  { id: 'designer', label: 'Agent 设计器', icon: 'i-carbon-flow', route: '/designer' },
  { id: 'logs', label: '系统日志', icon: 'i-carbon-document-tasks', route: '/logs' },
  { id: 'settings', label: '系统设置', icon: 'i-carbon-settings', route: '/settings' }
];

onMounted(() => {
  threadsStore.fetchThreads();
});

const handleMenuClick = (item: MenuItem): void => {
  threadsStore.selectThread(null);
  router.push(item.route);
};

const handleThreadClick = (threadId: string): void => {
  threadsStore.selectThread(threadId);
  router.push(`/thread/${threadId}`);
};

/** 格式化相对时间 */
function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
    if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** runStatus 状态配置：每种状态对应颜色 class 和标签 */
function getRunStatusConfig(status?: ThreadRunStatus): { class: string; label: string } {
  switch (status) {
    case 'running':
      return { class: 'status-running', label: '运行中' };
    case 'tool-pending':
      return { class: 'status-tool', label: '工具执行中' };
    case 'approval-pending':
      return { class: 'status-approval', label: '等待审批' };
    case 'error':
      return { class: 'status-error', label: '出错' };
    case 'completed':
      return { class: 'status-completed', label: '已完成' };
    default:
      return { class: 'status-idle', label: '空闲' };
  }
}

/** agentType 标签 */
function getAgentTypeLabel(type?: AgentType): string | null {
  switch (type) {
    case 'orchestrator':
      return '编排';
    case 'swarm':
      return '蜂群';
    case 'quality-loop':
      return '质量循环';
    default:
      return null;
  }
}

const updateActiveState = (): void => {
  const name = route.name as string;
  if (name) {
    activeMenuId.value = name;
  }
};

watch(() => route.name, updateActiveState);
onMounted(() => updateActiveState());
</script>

<template>
  <aside class="sidebar">
    <!-- 导航菜单 -->
    <nav class="nav-main">
      <button
        v-for="item in mainMenuItems"
        :key="item.id"
        class="nav-btn"
        :class="{ active: item.id === activeMenuId && !threadsStore.activeThreadId }"
        @click="handleMenuClick(item)">
        <span :class="item.icon" class="icon-sm" />
        <span>{{ item.label }}</span>
      </button>

      <!-- 更多功能按钮 -->
      <button
        class="nav-btn more-btn"
        :class="{ active: showMoreMenu }"
        title="更多功能"
        @click="showMoreMenu = !showMoreMenu">
        <span class="i-carbon-overflow-menu-horizontal icon-sm" />
        <span>更多</span>
      </button>
    </nav>

    <!-- 会话列表 -->
    <div class="session-section">
      <div class="section-header">
        <span>最近任务</span>
        <button
          v-if="threadsStore.threads.length > 0"
          class="refresh-btn"
          title="刷新"
          @click="threadsStore.fetchThreads()">
          <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': threadsStore.loading }" />
        </button>
      </div>

      <div class="session-list">
        <!-- Thread 列表 -->
        <div
          v-for="thread in threadsStore.threads"
          :key="thread.id"
          class="session-item"
          :class="{ active: threadsStore.activeThreadId === thread.id }"
          @click="handleThreadClick(thread.id)">
          <span
            class="status-dot"
            :class="getRunStatusConfig(thread.runStatus).class"
            :title="getRunStatusConfig(thread.runStatus).label" />
          <div class="session-info">
            <div class="session-title-row">
              <span class="session-title">{{ thread.title }}</span>
              <span v-if="getAgentTypeLabel(thread.agentType)" class="agent-type-badge">
                {{ getAgentTypeLabel(thread.agentType) }}
              </span>
            </div>
            <span class="session-meta">
              {{ formatRelativeTime(thread.updatedAt) }}
            </span>
          </div>
        </div>

        <!-- 空态 -->
        <div v-if="threadsStore.threads.length === 0 && !threadsStore.loading" class="empty-state">
          <span class="i-carbon-task inline-block h-6 w-6 opacity-[0.08]" />
          <p>选择智能体并开启任务后<br />任务将出现在这里</p>
        </div>

        <!-- 加载中 -->
        <div v-if="threadsStore.loading && threadsStore.threads.length === 0" class="empty-state">
          <span class="i-carbon-renew inline-block h-4 w-4 animate-spin opacity-20" />
        </div>
      </div>
    </div>

    <!-- 更多功能弹出菜单 -->
    <Transition name="more-menu">
      <div v-if="showMoreMenu" class="more-menu-popup">
        <div class="more-menu-header">更多功能</div>
        <button
          v-for="item in moreMenuItems"
          :key="item.id"
          class="more-menu-item"
          :class="{ active: item.id === activeMenuId }"
          @click="
            handleMenuClick(item);
            showMoreMenu = false;
          ">
          <span :class="item.icon" class="icon-sm" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </Transition>

    <!-- 点击外部关闭菜单 -->
    <div v-if="showMoreMenu" class="more-menu-overlay" @click="showMoreMenu = false" />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  height: 100%;
  background: hsl(var(--surface));
  border-right: 1px solid hsl(var(--border) / 0.4);
}

/* ====== 顶部导航 ====== */

.nav-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px 0;
}

/* ====== 会话列表区 ====== */

.session-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin-top: 8px;
  border-top: 1px solid hsl(var(--border) / 0.3);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 4px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.7);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  user-select: none;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: hsl(var(--muted-foreground) / 0.4);
  cursor: pointer;
  transition: all 0.12s ease;
}

.refresh-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.7);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  color: hsl(var(--foreground) / 0.65);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.session-item:hover {
  background: hsl(var(--foreground) / 0.04);
}

.session-item.active {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--foreground) / 0.85);
}

/* status dot */

.status-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
}

.status-dot.status-running {
  background: hsl(142 71% 45%);
  box-shadow: 0 0 0 2px hsl(142 71% 45% / 0.2);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-dot.status-tool {
  background: hsl(217 91% 60%);
  box-shadow: 0 0 0 2px hsl(217 91% 60% / 0.2);
}

.status-dot.status-approval {
  background: hsl(38 92% 50%);
  box-shadow: 0 0 0 2px hsl(38 92% 50% / 0.2);
  animation: pulse-dot 2s ease-in-out infinite;
}

.status-dot.status-error {
  background: hsl(0 84% 60%);
}

.status-dot.status-completed {
  background: hsl(var(--muted-foreground) / 0.25);
}

.status-dot.status-idle {
  background: hsl(var(--muted-foreground) / 0.2);
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
  font-size: 12.5px;
  flex: 1;
  min-width: 0;
}

.agent-type-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 500;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary) / 0.7);
  letter-spacing: 0.03em;
}

.session-meta {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1;
}

.session-item.active .session-meta {
  color: hsl(var(--primary) / 0.5);
}

/* 空态 */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 11.5px;
  line-height: 1.5;
  text-align: center;
  user-select: none;
}

/* ====== 公共按钮 ====== */

.nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nav-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground) / 0.8);
}

.nav-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 500;
}

/* ====== 图标 ====== */

.icon-sm {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.icon-xs {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
  opacity: 0.5;
}

/* ====== 滚动条 ====== */

.session-list::-webkit-scrollbar {
  width: 3px;
}

.session-list::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.06);
  border-radius: 3px;
}

.session-list::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.12);
}

/* ====== 更多功能按钮 ====== */

.more-btn {
  margin-top: 4px;
  border-top: 1px solid hsl(var(--border) / 0.2);
  padding-top: 6px !important;
}

/* ====== 更多功能弹出菜单 ====== */

.more-menu-popup {
  position: absolute;
  top: 320px;
  left: 8px;
  width: 204px;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  box-shadow:
    0 4px 16px hsl(var(--foreground) / 0.08),
    0 2px 6px hsl(var(--foreground) / 0.04);
  padding: 8px;
  z-index: 100;
  backdrop-filter: blur(8px);
}

.more-menu-header {
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 12px 4px;
  user-select: none;
}

.more-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.more-menu-item:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground) / 0.8);
}

.more-menu-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 500;
}

.more-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
}

/* 更多菜单动画 */

.more-menu-enter-active,
.more-menu-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.more-menu-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.more-menu-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}
</style>
