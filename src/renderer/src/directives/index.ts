/**
 * 自定义指令导出
 */

import type { App } from 'vue';

import vAiGenerate from './aiGenerate';

export default {
  install(app: App) {
    app.directive('ai-generate', vAiGenerate);
  }
};

// 单独导出指令
export { vAiGenerate };

// 导出类型
export type { AIDirectiveConfig, AIDirectiveValue } from './aiGenerate';
