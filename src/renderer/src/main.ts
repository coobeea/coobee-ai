import './assets/tailwind.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import ipcSetup from './plugins/ipcSetup'
import eventbusSetup from './plugins/eventbusSetup'
import pinia from './stores'

// 注意：pinia 必须在 ipcSetup 之前注册，因为 ipcSetup 中使用了 useLogStore()
createApp(App).use(pinia).use(ipcSetup).use(eventbusSetup).mount('#app')
