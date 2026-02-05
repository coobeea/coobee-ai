import './assets/tailwind.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import ipcSetup from './plugins/ipcSetup'
import eventbusSetup from './plugins/eventbusSetup'

createApp(App).use(ipcSetup).use(eventbusSetup).mount('#app')
