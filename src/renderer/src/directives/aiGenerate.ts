/**
 * v-ai-generate 指令
 *
 * 让任何元素一键添加 AI 生成能力
 *
 * 支持多种使用方式：
 *
 * 1. 完整配置对象（最灵活）
 * <button v-ai-generate="{ agent: 'task-analyzer', prompt: noteContent, onSuccess: handleResult }">
 *   AI 生成
 * </button>
 *
 * 2. 字符串模式（使用默认 agent: 'task-analyzer'）
 * <button v-ai-generate="'根据以下内容生成任务列表'">
 *   AI 生成任务
 * </button>
 *
 * 3. 数组模式 [agent, prompt]（快速指定 agent）
 * <button v-ai-generate="['title-generator', '为这段文字生成标题']">
 *   生成标题
 * </button>
 *
 * 4. 修饰符模式（通过修饰符指定 agent）
 * <button v-ai-generate.title-generator="'为这段文字生成标题'">
 *   生成标题
 * </button>
 *
 * 5. 函数提示词（动态获取内容）
 * <button v-ai-generate="{ agent: 'task-analyzer', prompt: () => editor.getText() }">
 *   分析任务
 * </button>
 */

import type { Directive, DirectiveBinding } from 'vue';
import { quickChat } from '@/composables/useQuickChat';

/**
 * AI 指令配置（完整配置）
 */
export interface AIDirectiveConfig {
  /**
   * Agent ID
   * @default 'task-analyzer'
   * @example 'task-analyzer' | 'title-generator'
   */
  agent?: string;

  /**
   * 提示词（字符串或函数）
   */
  prompt: string | (() => string | Promise<string>) | (() => Promise<string>);

  /**
   * 是否自动解析 JSON 结果
   * @default false
   */
  autoParseJson?: boolean;

  /**
   * 生成进度回调（实时接收生成的内容）
   * @param output - 生成的完整输出
   */
  onProgress?: (output: string) => void;

  /**
   * 成功回调
   * @param result - AI 生成的最终结果（完整文本，或解析后的 JSON）
   */
  onSuccess?: (result: unknown) => void;

  /**
   * 错误回调
   */
  onError?: (error: Error) => void;

  /**
   * 取消回调
   */
  onCancel?: () => void;
}

/**
 * AI 指令值类型（支持多种输入格式）
 */
export type AIDirectiveValue =
  | string // 字符串模式：直接传提示词
  | [string, string] // 数组模式：[agent, prompt]
  | AIDirectiveConfig; // 完整配置对象

/**
 * 解析 JSON 结果
 */
function parseJsonResult(text: string): unknown {
  try {
    // 1. 尝试提取 JSON 代码块（markdown 格式）
    const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }

    // 2. 尝试提取普通代码块
    const codeBlockMatch = text.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      if (content.startsWith('{') || content.startsWith('[')) {
        return JSON.parse(content);
      }
    }

    // 3. 尝试查找第一个 JSON 对象或数组
    const jsonObjectMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonObjectMatch) {
      return JSON.parse(jsonObjectMatch[1]);
    }

    // 4. 尝试直接解析整个文本
    const trimmedText = text.trim();
    if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
      return JSON.parse(trimmedText);
    }

    return text;
  } catch {
    return text;
  }
}

/**
 * 规范化指令配置
 * 将各种简化格式转换为完整的配置对象
 */
function normalizeConfig(value: AIDirectiveValue, modifiers: Partial<Record<string, boolean>>): AIDirectiveConfig {
  // 1. 字符串模式：直接传提示词
  if (typeof value === 'string') {
    // 检查修饰符，从修饰符中获取 agent
    const agentFromModifier = Object.keys(modifiers).find((key) => modifiers[key]);
    return {
      agent: agentFromModifier || 'task-analyzer', // 默认使用 task-analyzer
      prompt: value
    };
  }

  // 2. 数组模式：[agent, prompt]
  if (Array.isArray(value)) {
    const [agent, prompt] = value;
    return {
      agent: agent || 'task-analyzer',
      prompt: prompt
    };
  }

  // 3. 配置对象：确保有默认的 agent
  return {
    ...value,
    agent: value.agent || 'task-analyzer'
  };
}

/**
 * 处理按钮点击
 */
async function handleClick(el: HTMLElement, config: AIDirectiveConfig): Promise<void> {
  // 如果按钮已禁用，不处理
  if (el.hasAttribute('disabled')) {
    return;
  }

  // 禁用按钮并添加 loading 状态
  el.setAttribute('disabled', 'true');
  el.classList.add('ai-generating');

  try {
    // 构建提示词
    const prompt = typeof config.prompt === 'function' ? await config.prompt() : config.prompt;

    if (!prompt || !prompt.trim()) {
      throw new Error('提示词不能为空');
    }

    // 调用 quick-chat
    const output = await quickChat(config.agent || 'task-analyzer', prompt);

    if (!output) {
      throw new Error('AI 返回内容为空');
    }

    // 触发进度回调
    config.onProgress?.(output);

    // 解析结果（如果需要）
    const result = config.autoParseJson ? parseJsonResult(output) : output;

    // 触发成功回调
    config.onSuccess?.(result);
  } catch (error) {
    // 调用错误回调
    config.onError?.(error as Error);
  } finally {
    // 恢复按钮状态
    el.removeAttribute('disabled');
    el.classList.remove('ai-generating');
  }
}

/**
 * v-ai-generate 指令定义
 */
export const vAiGenerate: Directive<HTMLElement, AIDirectiveValue> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<AIDirectiveValue>): void {
    const rawValue = binding.value;
    const modifiers = binding.modifiers;

    // 验证基本输入
    if (!rawValue) {
      console.error('[v-ai-generate] Directive value is required');
      return;
    }

    // 规范化配置
    const config = normalizeConfig(rawValue, modifiers);

    // 验证规范化后的配置
    if (!config.prompt) {
      console.error('[v-ai-generate] Prompt is required');
      return;
    }

    // 创建点击处理函数
    const clickHandler = (): Promise<void> => handleClick(el, config);

    // 保存处理函数到元素上，方便后续清理
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._aiClickHandler = clickHandler;

    // 绑定点击事件
    el.addEventListener('click', clickHandler);

    // 添加指令标记类
    el.classList.add('v-ai-generate-directive');
  },

  updated(el: HTMLElement, binding: DirectiveBinding<AIDirectiveValue>): void {
    // 如果配置更新了，移除旧的事件监听器并添加新的
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldHandler = (el as any)._aiClickHandler;
    if (oldHandler) {
      el.removeEventListener('click', oldHandler);
    }

    const rawValue = binding.value;
    const modifiers = binding.modifiers;

    if (!rawValue) {
      console.error('[v-ai-generate] Directive value is required');
      return;
    }

    // 规范化配置
    const config = normalizeConfig(rawValue, modifiers);

    if (!config.prompt) {
      console.error('[v-ai-generate] Prompt is required');
      return;
    }

    const clickHandler = (): Promise<void> => handleClick(el, config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._aiClickHandler = clickHandler;
    el.addEventListener('click', clickHandler);
  },

  unmounted(el: HTMLElement): void {
    // 清理事件监听器
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clickHandler = (el as any)._aiClickHandler;
    if (clickHandler) {
      el.removeEventListener('click', clickHandler);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (el as any)._aiClickHandler;
    }

    // 移除指令标记类
    el.classList.remove('v-ai-generate-directive');
  }
};

// 默认导出
export default vAiGenerate;
