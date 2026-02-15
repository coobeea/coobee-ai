/**
 * 队列 Drain 策略
 *
 * 在 Agent run 结束后，按不同模式处理排队中的消息。
 */
import type { PendingMessage } from './types'
import type { SessionQueue } from './SessionQueue'

/** drain 回调：执行单条消息 */
export type DrainExecutor = (sessionId: string, message: string) => Promise<void>

/**
 * followup 策略：逐条执行
 *
 * FIFO 顺序，每条消息独立执行一次完整的 Agent run。
 */
export async function drainFollowup(queue: SessionQueue, executor: DrainExecutor): Promise<number> {
  let drained = 0

  while (!queue.isEmpty()) {
    const msg = queue.dequeue()
    if (!msg) break
    await executor(msg.sessionId, msg.message)
    drained++
  }

  return drained
}

/**
 * collect 策略：合并执行
 *
 * 取出所有排队消息，合并为一条 prompt，执行一次 Agent run。
 */
export async function drainCollect(queue: SessionQueue, executor: DrainExecutor): Promise<number> {
  const messages = queue.dequeueAll()
  if (messages.length === 0) return 0

  const merged = buildCollectPrompt(messages)
  await executor(messages[0].sessionId, merged)
  return messages.length
}

/**
 * 构建 collect 合并 prompt
 *
 * 将多条消息格式化为一个清晰的合并提示。
 */
export function buildCollectPrompt(messages: PendingMessage[]): string {
  if (messages.length === 1) {
    return messages[0].message
  }

  const lines = messages.map((m, i) => `[${i + 1}] ${m.message}`)
  return `以下是用户在你处理上一条消息期间发送的 ${messages.length} 条新消息，请一并处理：\n\n${lines.join('\n')}`
}
