<script setup lang="ts">
/**
 * Sidebar — 左侧导航栏
 *
 * 布局：
 *   ┌──────────────────────┐
 *   │  🤖 Agent            │  导航菜单
 *   │  📊 日志              │
 *   ├──────────────────────┤
 *   │  最近会话             │  标题
 *   │  · 会话 A            │  会话列表（可滚动）
 *   │  · 会话 B            │
 *   │  ...                 │
 *   ├──────────────────────┤
 *   │  ⚙  设置              │
 *   └──────────────────────┘
 *
 * 会话由 Agent 页发消息时自然产生，这里只做展示和切换。
 */

import { ref, watch, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const router = useRouter();
const route = useRoute();
const chatStore = useChatStore();

const activeMenuId = ref('agent');

const menuItems: MenuItem[] = [
  { id: 'agent', label: '智能体', icon: 'i-carbon-bot', route: '/agent' },
  { id: 'logs', label: '日志', icon: 'i-carbon-report', route: '/logs' }
];

/** 是否有活跃会话 */
const hasActiveSession = computed(() => !!chatStore.sessionId);

/** 当前会话标题（第一条用户消息前 40 字） */
const activeSessionTitle = computed(() => {
  const firstUserMsg = chatStore.messages.find((m) => m.role === 'user');
  if (firstUserMsg?.content) {
    const text = firstUserMsg.content.trim();
    return text.length > 40 ? text.slice(0, 40) + '…' : text;
  }
  return '新对话';
});

/** 当前会话消息数 */
const messageCount = computed(() => chatStore.messages.length);

const handleMenuClick = (item: MenuItem): void => {
  router.push(item.route);
};

const handleSettings = (): void => {
  router.push('/settings');
};

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
        v-for="item in menuItems"
        :key="item.id"
        class="nav-btn"
        :class="{ active: item.id === activeMenuId }"
        @click="handleMenuClick(item)">
        <span :class="item.icon" class="icon-sm" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- 会话列表 -->
    <div class="session-section">
      <div class="section-header">
        <span>最近会话</span>
      </div>

      <div class="session-list">
        <!-- 当前活跃会话 -->
        <div v-if="hasActiveSession" class="session-item active">
          <span class="i-carbon-chat icon-xs" />
          <div class="session-info">
            <span class="session-title">{{ activeSessionTitle }}</span>
            <span class="session-meta">{{ messageCount }} 条消息</span>
          </div>
        </div>

        <!-- TODO: 历史会话列表（待接入后端 session list API） -->

        <!-- 空态 -->
        <div v-if="!hasActiveSession" class="empty-state">
          <span class="i-carbon-chat inline-block h-6 w-6 opacity-[0.08]" />
          <p>在 Agent 页发送消息后<br />会话将出现在这里</p>
        </div>
      </div>
    </div>

    <!-- 底部设置 -->
    <div class="nav-footer">
      <button class="nav-btn" :class="{ active: activeMenuId === 'settings' }" @click="handleSettings">
        <span class="i-carbon-settings icon-sm settings-icon" />
        <span>设置</span>
      </button>
    </div>
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
  padding: 10px 14px 4px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.7);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  user-select: none;
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

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
  font-size: 12.5px;
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

/* ====== 底部导航 ====== */

.nav-footer {
  padding: 8px 8px 12px;
  border-top: 1px solid hsl(var(--border) / 0.3);
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

.settings-icon {
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-btn:hover .settings-icon {
  transform: rotate(90deg);
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
</style>
