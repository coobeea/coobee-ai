import '@/assets/tailwind.css';
import '@/assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ConsoleApp from './ConsoleApp.vue';

// 创建 Vue 应用
const app = createApp(ConsoleApp);

// 创建 Pinia 实例
const pinia = createPinia();

app.use(pinia);

// 挂载到 DOM
app.mount('#app');
