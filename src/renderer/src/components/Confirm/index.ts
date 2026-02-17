/**
 * @description 全局确认对话框，用于替代浏览器原生的 confirm()。
 *
 * @example
 *
 * // 1. 在 <script setup> (组合式 API) 中使用 (推荐):
 * // =================================================================
 *
 * // 在顶层组件 (如 App.vue) 中确保注册了 <Confirm /> 组件
 *
 * // 在需要使用的组件中:
 * import { useConfirm } from '@/composables/useConfirm';
 *
 * const confirm = useConfirm();
 *
 * const handleDelete = async () => {
 *   const isConfirmed = await confirm({
 *     title: '确认删除',
 *     message: '您确定要删除这个项目吗？此操作不可逆。',
 *     confirmText: '确认删除',
 *     cancelText: '取消',
 *     isDangerous: true // 将确认按钮变为危险状态（例如红色）
 *   });
 *
 *   if (isConfirmed) {
 *     // ... 执行删除逻辑
 *   }
 * }
 *
 * // 2. 在 Options API 中使用:
 * // =================================================================
 *
 * export default {
 *   methods: {
 *     async handleDelete() {
 *       const isConfirmed = await this.$confirm({
 *         title: '确认删除',
 *         message: '您确定要删除这个项目吗？此操作不可逆。'
 *       });
 *
 *       if (isConfirmed) {
 *         // ... 执行删除逻辑
 *       }
 *     }
 *   }
 * }
 */
import type { App } from 'vue';

import ConfirmContainer from './ConfirmContainer.vue';
import { useConfirmStore } from './store';
import type { ConfirmAPI } from './types';

const ConfirmPlugin = {
  install(app: App) {
    // 注册组件
    app.component('ConfirmContainer', ConfirmContainer);

    // 创建confirm API
    const confirmStore = useConfirmStore();
    const confirmAPI: ConfirmAPI = {
      show: confirmStore.showConfirm,
      info: confirmStore.info,
      warning: confirmStore.warning,
      error: confirmStore.error,
      success: confirmStore.success
    };

    // 添加到全局属性
    app.config.globalProperties.$confirm = confirmAPI;

    // 提供给组合式API使用
    app.provide('$confirm', confirmAPI);
  }
};

export default ConfirmPlugin;
export { useConfirmStore };
export type { ConfirmAPI, ConfirmInstance, ConfirmOptions } from './types';
