import './assets/tailwind.css'
import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import ipcSetup from './plugins/ipcSetup'

createApp(App).use(ipcSetup).mount('#app')
