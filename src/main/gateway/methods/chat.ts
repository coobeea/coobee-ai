/**
 * Gateway Chat 方法组
 *
 * 支持两种运行模式：
 *   - chat: 纯对话 — 无工具、无执行协议，快速响应
 *   - agent: 完整 Agent — 工具 + 执行协议 + Skill + HITL
 *
 * 方法：
 *   chat.send  — 发送消息并启动流式处理（支持 mode 参数）
 *   chat.abort — 中止当前会话（预留）
 */

import { log } from '@main/common/logger'
import { agentExecutor } from '@main/ai/AgentExecutor'
import { builtinTools } from '@main/ai/tools'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'
import type { AgentMode } from '@main/ai/runtime/types'

/** 默认 Chat 模式指令（简洁，无工具提示） */
const CHAT_INSTRUCTIONS = '你是一个友好、专业的 AI 助手。请用中文回答用户的问题。'

/** 默认 Agent 模式指令（完整，有工具能力） */
const AGENT_INSTRUCTIONS =
  '你是一个友好、专业的 AI 助手。你拥有文件操作、命令执行、记忆管理等工具。请用中文回答用户的问题，必要时使用工具完成任务。'

/** 生成 session ID */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建 Builder（根据模式决定是否加载工具） */
function createBuilder(agentMode: AgentMode): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(agentMode === 'chat' ? 'chat-assistant' : 'chat-agent')
    .mode(agentMode)
    .sessionMode('file')

  if (agentMode === 'agent') {
    builder.instructions(AGENT_INSTRUCTIONS).tools(builtinTools)
  } else {
    builder.instructions(CHAT_INSTRUCTIONS)
    // Chat 模式：不设置 tools，LLM 只做纯对话
  }

  return builder
}

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
    }
  }
}
