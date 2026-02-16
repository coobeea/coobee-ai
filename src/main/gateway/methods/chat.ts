/**
 * Gateway Chat 方法组
 *
 * 支持两种运行模式：
 *   - chat: 对话 + 文件操作 — 禁用 exec（脚本执行），保留文件读写等工具
 *   - agent: 完整 Agent — 全部工具 + 执行协议 + Skill + HITL
 *
 * 方法：
 *   chat.send  — 发送消息并启动流式处理（支持 mode 参数）
 *   chat.abort — 中止当前会话（预留）
 */

import { log } from '@main/common/logger'
import { agentExecutor } from '@main/ai/AgentExecutor'
import { builtinTools } from '@main/ai/tools'
import { ToolRegistry } from '@main/ai/tools/registry'
import { resolveApiKey } from '@main/ai/provider/ApiKeyResolver'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'
import type { AgentMode } from '@main/ai/runtime/types'

/** Chat 模式禁用的工具名称列表 */
const CHAT_MODE_BLOCKED_TOOLS = new Set(['exec'])

/** 默认 Chat 模式指令（有文件工具，但无脚本执行） */
const CHAT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你可以读写文件来辅助回答问题，但不能执行脚本命令。请用中文回答用户的问题。'

/** 默认 Agent 模式指令（完整，有工具能力） */
const AGENT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你拥有文件操作、命令执行、记忆管理等工具。请用中文回答用户的问题，必要时使用工具完成任务。'

/** 生成 session ID */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建 Builder（根据模式决定工具集合）
 *
 * 模型解析优先级：
 * 1. ModelSelector（如果配置系统已初始化）
 * 2. ProviderRegistry（如果有匹配的 Provider）
 * 3. 环境变量 / coobee.json5 默认值（兜底）
 */
function createBuilder(agentMode: AgentMode): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(agentMode === 'chat' ? 'chat-assistant' : 'chat-agent')
    .mode(agentMode)
    .sessionMode('file')

  // 合并 builtin + Extension 工具（Extension 可覆盖同名 builtin）
  const extensionTools = ToolRegistry.getInstance().getAll()
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]))
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext)
  }
  const allTools = Array.from(toolMap.values())

  if (agentMode === 'agent') {
    builder.instructions(AGENT_INSTRUCTIONS).tools(allTools)
  } else {
    // Chat 模式：加载工具但排除 exec（脚本执行）
    const chatTools = allTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name))
    builder.instructions(CHAT_INSTRUCTIONS).tools(chatTools)
  }

  // 尝试从 Provider 系统获取模型配置
  applyProviderConfig(builder)

  return builder
}

/**
 * 尝试从 Provider 系统注入模型配置
 *
 * 如果 Provider 系统未初始化或无可用配置，则不做任何操作（使用 coobee.json5 / 环境变量兜底）。
 */
function applyProviderConfig(builder: ReturnType<typeof agentExecutor.piMono>): void {
  try {
    const providerSystem = agentExecutor.getProviderSystem?.()
    if (!providerSystem) return

    const { selector, registry } = providerSystem
    const ref = selector.resolve()
    const provider = registry.get(ref.provider)
    if (!provider) return

    // 解析 API Key
    const apiKey = resolveApiKey(provider.apiKey, provider.id)
    if (!apiKey) return

    builder.fromProviderConfig(provider, ref.model)
  } catch {
    // Provider 系统未就绪，静默回退到默认配置
  }
}

// 注册 Builder 工厂，供 Pipeline executor 使用
agentExecutor.setBuilderFactory((mode) => createBuilder(mode))

export const chatMethods: MethodGroup = {
  namespace: 'chat',
  methods: {
    send: async (params) => {
      const {
        message,
        sessionId,
        mode = 'agent'
      } = params as { message?: string; sessionId?: string; mode?: AgentMode }

      if (!message) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required')
      }

      // 校验 mode 参数
      if (mode !== 'chat' && mode !== 'agent') {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          `Invalid mode "${mode}". Must be "chat" or "agent".`
        )
      }

      const sid = sessionId || generateSessionId()
      log.info(`[chat.send] sessionId=${sid}, mode=${mode}`)

      try {
        // 优先使用管线（支持排队/合并/中断）
        const pipelineResult = agentExecutor.submitViaPipeline(sid, message, mode)
        if (pipelineResult) {
          return {
            sessionId: sid,
            status: pipelineResult.status,
            mode,
            queuePosition: pipelineResult.queuePosition
          }
        }

        // 回退到原始 submit
        const result = agentExecutor.submit({
          sessionId: sid,
          message,
          builder: createBuilder(mode)
        })

        if (result.status === 'busy') {
          throw new GatewayMethodError(GatewayErrorCode.SESSION_BUSY, '当前会话正在处理中')
        }

        return { sessionId: sid, status: 'streaming', mode }
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error
        const msg = error instanceof Error ? error.message : String(error)
        log.error(`[chat.send] Failed: sessionId=${sid}`, error)
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg)
      }
    },

    abort: async (params) => {
      const { sessionId } = params as { sessionId?: string }

      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required')
      }

      log.info(`[chat.abort] sessionId=${sessionId}`)
      const aborted = agentExecutor.abort(sessionId)

      return { sessionId, aborted }
    }
  }
}
