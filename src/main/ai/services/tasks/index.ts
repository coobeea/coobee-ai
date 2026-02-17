/**
 * AI 辅助任务注册入口
 *
 * 导入所有 task handler 并注册到 AiAssistService。
 * 新增任务只需：
 *   1. 在 tasks/ 目录下创建 handler 文件
 *   2. 在此文件中导入并注册
 */

import { registerTask } from '../AiAssistService';
import { generateTitleTask } from './generate-title';

export function registerBuiltinTasks(): void {
  registerTask(generateTitleTask);
}
