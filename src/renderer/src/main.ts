import './assets/tailwind.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import ipcSetup from './plugins/ipcSetup'
import eventbusSetup from './plugins/eventbusSetup'
import wsSetup from './plugins/wsSetup'
import pinia from './stores'

// 注意：pinia 必须在其他插件之前注册，因为 ipcSetup / wsSetup 中使用了 Store
createApp(App).use(pinia).use(router).use(ipcSetup).use(eventbusSetup).use(wsSetup).mount('#app')
