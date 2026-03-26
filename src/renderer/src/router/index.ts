import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layout/index.vue'),
      redirect: '/agent',
      children: [
        {
          path: 'agent',
          name: 'agent',
          component: () => import('@/views/AgentView.vue')
        },
        {
          path: 'employee',
          name: 'employee',
          component: () => import('@/views/EmployeeView.vue')
        },
        {
          path: 'employee/:id/chat',
          name: 'employee-chat',
          component: () => import('@/views/EmployeeChatView.vue'),
          meta: { fullscreen: true } // 标记为全屏模式，隐藏侧边栏（需要在 Layout 处理）
        },
        {
          path: 'thread/:id',
          name: 'thread',
          component: () => import('@/views/ThreadView.vue')
        },
        {
          path: 'skills',
          name: 'skills',
          component: () => import('@/views/SkillsView.vue')
        },
        {
          path: 'tavern',
          name: 'tavern',
          component: () => import('@/views/TavernView.vue')
        },
        {
          path: 'brain',
          name: 'brain',
          component: () => import('@/views/BrainView.vue')
        },
        {
          path: 'brain-monitor',
          name: 'brain-monitor',
          component: () => import('@/views/BrainMonitorView.vue')
        },
        {
          path: 'cron',
          name: 'cron',
          component: () => import('@/views/CronView.vue')
        },
        {
          path: 'shared-drive',
          name: 'shared-drive',
          component: () => import('@/views/SharedDriveView.vue')
        },
        {
          path: 'logs',
          name: 'logs',
          component: () => import('@/views/LogViewer.vue')
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue')
        },
        {
          path: 'observability',
          name: 'observability',
          component: () => import('@/views/observability/ObservabilityView.vue')
        },
        {
          path: 'discussion',
          name: 'discussion',
          component: () => import('@/views/DiscussionView.vue')
        },
        {
          path: 'consultation',
          name: 'consultation',
          component: () => import('@/views/DiscussionView.vue') // ✅ 复用 DiscussionView
        },
        {
          path: 'groupchat',
          name: 'groupchat',
          component: () => import('@/views/GroupChatView.vue')
        },
        {
          path: 'insight',
          name: 'insight',
          component: () => import('@/views/InsightView.vue')
        },
        {
          path: 'insight/session/:id',
          name: 'insight-session',
          component: () => import('@/views/InsightSessionView.vue')
        },
        {
          path: 'training',
          name: 'training',
          component: () => import('@/views/TrainingView.vue')
        },
        {
          path: 'training/:id',
          name: 'training-detail',
          component: () => import('@/views/TrainingDetailView.vue')
        },
        {
          path: 'designer',
          name: 'designer',
          component: () => import('@/views/AgentDesigner.vue')
        }
      ]
    }
  ]
});

export default router;
