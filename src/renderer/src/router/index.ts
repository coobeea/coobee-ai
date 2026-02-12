import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layout/index.vue'),
      redirect: '/chat',
      children: [
        {
          path: 'chat',
          name: 'chat',
          component: () => import('@/views/ChatView.vue')
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
