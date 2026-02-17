/**
 * tool-approval — 统一工具审批 Extension
 *
 * 通过 before_tool_call Hook 实现 SDK 无关的 HITL 审批逻辑。
 *
 * 核心职责：
 *   1. 检查工具是否需要用户审批（needUserConfirm）
 *   2. 对 exec 工具应用命令安全策略（ExecPolicy）
 *   3. 需要审批时：发送 hitl:required 事件 → 等待用户决策 → 放行或拦截
 *   4. 用户 approve-always 时自学习（exec 命令加入动态白名单）
 *
 * 设计特点：
 *   - 完全在 before_tool_call Hook 中运行，不依赖任何 SDK 的 HITL 机制
 *   - OpenAI / PiMono 等任意 Runtime 均可使用
 *   - 通过 HitlApprovalManager 的 per-call API 实现异步等待
 *   - 通过 StreamEmitter 发送 hitl:* 事件到前端
 */

import type { ExtensionApi } from '../../src/main/common/extension'

// ==================== 常量 ====================

/** 默认审批超时（5 分钟） — 可通过 coobee.json5 security.approvals.timeoutMs 覆盖 */
const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000

// ==================== 会话级计数器 ====================

/** 每个 session 的审批索引计数器（从 0 开始递增） */
const sessionCounters = new Map<string, number>()

/** 获取下一个审批索引 */
function getNextApprovalIndex(sessionId: string): number {
  const current = sessionCounters.get(sessionId) ?? 0
  sessionCounters.set(sessionId, current + 1)
  return current
}

/** 重置会话计数器 */
function resetSessionCounter(sessionId: string): void {
  sessionCounters.delete(sessionId)
}

// ==================== Extension 模块 ====================

export default {
  id: 'tool-approval',
  name: 'Tool Approval',
  register(api: ExtensionApi) {
    // ========== session_start: 重置计数器 ==========
    api.on(
      'session_start',
      async (event) => {
        resetSessionCounter(event.sessionId)
      },
      { priority: 100 } // 最高优先级，确保先重置
    )

    // ========== session_end: 清理 pending ==========
    api.on(
      'session_end',
      async (event) => {
        try {
          await api.services.hitl.cleanupSession(event.sessionId)
          resetSessionCounter(event.sessionId)
        } catch {
          // 清理失败不阻断
        }
      },
      { priority: 100 }
    )

    // ========== before_tool_call: 核心审批逻辑 ==========
    api.on(
      'before_tool_call',
      async (event) => {
        const { sessionId, toolName, params, needUserConfirm } = event

        // 1. ExecPolicy 检查（仅对 exec 工具）
        if (toolName === 'exec' && params.command) {
          try {
            const { checkExecPolicy, learnExecCommand } =
              await import('../../src/main/ai/sandbox/exec-policy')
            const policy = checkExecPolicy(params.command as string)

            if (policy.action === 'deny') {
              api.logger.warn(
                `[tool-approval] ExecPolicy deny: "${(params.command as string).slice(0, 50)}", reason=${policy.reason}`
              )
              return {
                block: true,
                blockReason: `Command rejected by security policy: ${policy.reason}`
              }
            }

            if (policy.action === 'allow') {
              api.logger.info(
                `[tool-approval] ExecPolicy allow: "${(params.command as string).slice(0, 50)}", reason=${policy.reason}`
              )
              // 白名单命令自动放行，跳过 HITL
              return
            }

            // policy.action === 'ask' → 需要用户审批，继续到下面的 HITL 逻辑
            // 即使 needUserConfirm 为 false，exec 的 'ask' 策略也需要用户审批
            return await requestApproval(api, sessionId, toolName, params, learnExecCommand)
          } catch (err) {
            api.logger.warn(`[tool-approval] ExecPolicy check failed: ${err}`)
            // ExecPolicy 检查失败，降级到 needUserConfirm 逻辑
          }
        }

        // 2. 非 exec 工具：检查 needUserConfirm
        if (!needUserConfirm) return

        return await requestApproval(api, sessionId, toolName, params)
      },
      { priority: 10 } // 高优先级，在其他 before_tool_call hook 之前
    )
  }
}

// ==================== 辅助函数 ====================

/**
 * 发起审批请求并等待决策
 *
 * @param learnFn 可选的学习函数（approve-always 时调用）
 */
async function requestApproval(
  api: ExtensionApi,
  sessionId: string,
  toolName: string,
  params: Record<string, unknown>,
  learnFn?: (command: string) => void
): Promise<{ block?: boolean; blockReason?: string } | void> {
  const index = getNextApprovalIndex(sessionId)
  const approvalId = `${sessionId}:${index}`

  api.logger.info(`[tool-approval] Requesting approval: approvalId=${approvalId}, tool=${toolName}`)

  // 1. 发送 hitl:required 事件到前端（通过 services.events）
  try {
    api.services.events.emit(sessionId, {
      type: 'hitl:required',
      content: `Approval required: ${toolName}`,
      data: {
        index,
        toolName,
        arguments: JSON.stringify(params),
        action: 'required'
      }
    })
  } catch (err) {
    api.logger.warn(`[tool-approval] Failed to emit hitl:required: ${err}`)
  }

  // 2. 等待用户决策（通过 services.hitl）
  try {
    const timeoutMs = await getApprovalTimeout()
    const decision = await api.services.hitl.waitForSingleDecision(approvalId, timeoutMs)

    if (!decision) {
      api.logger.warn(`[tool-approval] Timeout: approvalId=${approvalId}`)
      emitDecisionEvent(sessionId, index, toolName, 'rejected', 'timeout')
      return { block: true, blockReason: 'Approval timeout — tool execution blocked' }
    }

    if (decision === 'reject') {
      api.logger.info(`[tool-approval] Rejected: approvalId=${approvalId}`)
      emitDecisionEvent(sessionId, index, toolName, 'rejected')
      return { block: true, blockReason: 'User rejected tool execution' }
    }

    // approve-once 或 approve-always
    api.logger.info(`[tool-approval] Approved: approvalId=${approvalId}, decision=${decision}`)
    emitDecisionEvent(sessionId, index, toolName, 'approved')

    // approve-always + exec → 自学习
    if (decision === 'approve-always' && learnFn && toolName === 'exec' && params.command) {
      try {
        learnFn(params.command as string)
        api.logger.info(
          `[tool-approval] Learned exec command: "${(params.command as string).slice(0, 50)}"`
        )
      } catch {
        // 学习失败不阻断
      }
    }

    return // 放行
  } catch (err) {
    api.logger.error(`[tool-approval] Wait failed: ${err}`)
    return { block: true, blockReason: 'Approval wait error — tool execution blocked' }
  }
}

/**
 * 发送审批结果事件（hitl:approved / hitl:rejected）
 *
 * 注意：此函数需要 api 引用才能使用 services.events。
 * 但因为它在 requestApproval 的回调中使用，且 api 已在闭包中可用，
 * 这里保留 sessionId 参数 + 动态 import 作为独立辅助函数的 fallback。
 * 后续可考虑将 api 传入此函数。
 */
async function emitDecisionEvent(
  sessionId: string,
  index: number,
  toolName: string,
  action: 'approved' | 'rejected',
  reason?: string
): Promise<void> {
  const chunkType = action === 'approved' ? 'hitl:approved' : 'hitl:rejected'
  const chunk = {
    type: chunkType as 'hitl:approved' | 'hitl:rejected',
    content: `${action}: ${toolName}`,
    data: { index, toolName, action, ...(reason ? { reason } : {}) }
  }

  // 统一分发：写文件 + 推前端（单一入口）
  try {
    const { AgentEventWriter } = await import('../../src/main/ai/AgentEventWriter')
    AgentEventWriter.dispatchForSession(sessionId, chunk)
  } catch {
    // 分发失败不阻断
  }
}

/**
 * 从配置中读取审批超时时间
 *
 * 优先使用 coobee.json5 中的 security.approvals.timeoutMs，
 * 未配置时使用默认值（5 分钟）。
 */
async function getApprovalTimeout(): Promise<number> {
  try {
    const { ConfigStore } = await import('../../src/main/common/config/ConfigStore')
    const store = ConfigStore.getInstance()
    const approvals = store.get('security')?.approvals
    return approvals?.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
  } catch {
    return DEFAULT_APPROVAL_TIMEOUT_MS
  }
}
