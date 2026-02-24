/**
 * 内置 Provider 定义
 *
 * 这些是预定义的 Provider 配置，用于快速启动。
 * 用户可以在 coobee.json5 中覆盖或补充。
 */
import type { ProviderConfig } from '../types';

import { aliyunProvider } from './aliyun';
import { anthropicProvider } from './anthropic';
import { minimaxProvider } from './minimax';
import { openaiProvider } from './openai';

/** 所有内置 Provider */
export const builtinProviders: ProviderConfig[] = [openaiProvider, anthropicProvider, aliyunProvider, minimaxProvider];

export { aliyunProvider, anthropicProvider, minimaxProvider, openaiProvider };
