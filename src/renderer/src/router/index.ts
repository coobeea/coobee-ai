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
          path: 'logs',
          name: 'logs',
          component: () => import('@/views/LogViewer.vue')
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue')
        }
      ]
    }
  ]
});

export default router;
