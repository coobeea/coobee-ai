import '@/assets/tailwind.css';
import '@/assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ShellApp from './ShellApp.vue';

// 创建 Vue 应用
const app = createApp(ShellApp);

// 创建 Pinia 实例
const pinia = createPinia();

app.use(pinia);

// 挂载到 DOM
app.mount('#app');
