/**
 * generate-title task — 自动生成 Thread 标题
 *
 * 根据用户的第一条消息（或前几条消息摘要），自动生成简洁的会话标题。
 * 结果直接更新到 ThreadStore。
 *
 * 参数：
 *   - threadId: string  — Thread ID
 *   - message: string   — 用户消息内容
 */

import type { TaskHandler } from '../AiAssistService';

export const generateTitleTask: TaskHandler = {
  name: 'generate-title',

  validate(params) {
    if (!params.threadId || typeof params.threadId !== 'string') {
      return 'threadId is required';
    }
    if (!params.message || typeof params.message !== 'string') {
      return 'message is required';
    }
    return null;
  },

  buildInstructions() {
    return [
      '你是一个标题生成器。',
      '根据用户提供的消息内容，生成一个简短、准确的会话标题。',
      '',
      '要求：',
      '- 标题控制在 4-15 个字（中文）或 3-8 个单词（英文）',
      '- 直接反映消息的核心意图',
      '- 不要加引号、标点或前缀',
      '- 只输出标题本身，不要有任何额外文字'
    ].join('\n');
  },

  buildMessage(params) {
    return `请为以下消息生成标题：\n\n${params.message as string}`;
  },

  parseResult(output: string) {
    // 清理可能的引号、句号等
    return output
      .replace(/^["'"「]/, '')
      .replace(/["'"」]$/, '')
      .replace(/[。.!！]$/, '')
      .trim();
  },

  needsTools: false
};
