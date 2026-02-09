/**
 * 内置工具
 * 基于 @openai/agents SDK 的 tool() 函数
 */
import { tool } from '@openai/agents'
import { z } from 'zod'
import { readFile as fsReadFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * 文件读取工具
 */
export const readFileTool = tool({
  name: 'read_file',
  description: '读取文件内容',
  parameters: z.object({
    path: z.string().describe('文件路径')
  }),
  execute: async ({ path }) => {
    try {
      // 解析路径
      const absolutePath = resolve(path)

      // 检查文件是否存在
      if (!existsSync(absolutePath)) {
        return JSON.stringify({
          success: false,
          error: `文件不存在: ${path}`
        })
      }

      // 读取文件内容
      const content = await fsReadFile(absolutePath, 'utf-8')

      return JSON.stringify({
        success: true,
        path: absolutePath,
        content,
        size: content.length
      })
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
})

/**
 * 网页搜索工具
 * 注意：需要配置搜索API密钥（如 Google Custom Search API）
 */
export const webSearchTool = tool({
  name: 'web_search',
  description: '搜索网页内容',
  parameters: z.object({
    query: z.string().describe('搜索关键词')
  }),
  execute: async ({ query }) => {
    // 暂时返回模拟结果，实际使用时需要集成真实的搜索API
    // 可选方案：
    // 1. Google Custom Search API
    // 2. Bing Search API
    // 3. DuckDuckGo API
    // 4. 自建搜索引擎

    console.log(`[WebSearch] Searching for: ${query}`)

    return JSON.stringify({
      success: true,
      query,
      results: [
        {
          title: '搜索功能待配置',
          snippet: '请配置搜索 API（如 Google Custom Search）以启用真实的网页搜索功能',
          url: 'https://developers.google.com/custom-search'
        }
      ],
      message: '搜索工具需要配置外部 API。请在环境变量中设置 SEARCH_API_KEY 和 SEARCH_ENGINE_ID'
    })
  }
})

/**
 * 所有内置工具
 */
export const builtinTools = [readFileTool, webSearchTool]
