import { createRouter, createWebHashHistory } from 'vue-router'

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
          // 兼容旧路由：/chat → /agent
          path: 'chat',
          redirect: '/agent'
        },
        {
          path: 'logs',
          name: 'logs',
          component: () => import('@/views/LogViewer.vue')
        }
      ]
    }
  ]
})

export default router
