import './assets/tailwind.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { initIpcEvents } from './composables/useIpc'

// 初始化 IPC 事件系统（必须在创建 Vue 应用之前）
initIpcEvents()

createApp(App).mount('#app')
