/**
 * 内置工具
 * 基于 @openai/agents SDK 的 tool() 函数
 */
import { tool } from '@openai/agents'
import { z } from 'zod'

/**
 * 示例：文件读取工具
 */
export const readFileTool = tool({
  name: 'read_file',
  description: '读取文件内容',
  parameters: z.object({
    path: z.string().describe('文件路径')
  }),
  execute: async ({ path }) => {
    // TODO: 实现文件读取
    return `TODO: Read file from ${path}`
  }
})

/**
 * 示例：网页搜索工具
 */
export const webSearchTool = tool({
  name: 'web_search',
  description: '搜索网页',
  parameters: z.object({
    query: z.string().describe('搜索关键词')
  }),
  execute: async ({ query }) => {
    // TODO: 实现网页搜索
    return `TODO: Search web for ${query}`
  }
})

/**
 * 所有内置工具
 */
export const builtinTools = [readFileTool, webSearchTool]
