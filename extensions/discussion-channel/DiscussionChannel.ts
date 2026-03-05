import type { ChannelPlugin, InboundMessage, OutboundMessage } from '../../src/main/channels/types';
import type { ExtensionLogger } from '../../src/main/common/extension/types';
import type { DiscussionSession, DiscussionParticipant } from '../../src/main/ai/discussion/types';

let logger: ExtensionLogger;

/**
 * 获取下一个发言者（轮流发言）
 */
function getNextSpeaker(session: DiscussionSession, currentAgentId: string): DiscussionParticipant | null {
  const activeParticipants = session.participants.filter((p) => p.active !== false);
  if (activeParticipants.length === 0) return null;

  const currentIndex = activeParticipants.findIndex((p) => p.agentId === currentAgentId);
  if (currentIndex === -1) return activeParticipants[0];

  const nextIndex = (currentIndex + 1) % activeParticipants.length;
  return activeParticipants[nextIndex];
}

/**
 * Discussion ChannelPlugin
 *
 * 将讨论室作为 Channel 实现，与飞书、Slack 等外部 Channel 平等对待
 */
export const discussionChannel: ChannelPlugin = {
  id: 'discussion',
  name: 'Discussion Room',
  description: 'Multi-agent discussion room for collaborative problem solving',

  lifecycle: {
    /**
     * 启动 Discussion Channel
     */
    start: async (ctx) => {
      logger = ctx.log;
      logger.info('[DiscussionChannel] Started');

      // storePath 已由 ChannelManager 在启动前初始化，这里无需再初始化
      // 只做简单验证
      const storePath = ctx.config?.storePath as string | undefined;
      if (!storePath) {
        logger.warn('[DiscussionChannel] storePath not provided in config');
      } else {
        logger.debug(`[DiscussionChannel] Using storePath: ${storePath}`);
      }
    },

    /**
     * 停止 Discussion Channel
     */
    stop: async (_ctx) => {
      logger.info('[DiscussionChannel] Stopped');
    }
  },

  inbound: {
    /**
     * 处理入站消息（讨论室 → Agent）
     *
     * @param msg - 入站消息
     */
    handleMessage: async (msg: InboundMessage) => {
      try {
        // 动态导入依赖
        const { ChannelRuntime } = await import('../../src/main/channels/ChannelRuntime');
        const { DiscussionStore } = await import('../../src/main/ai/discussion/DiscussionStore');

        const runtime = ChannelRuntime.getInstance();
        const store = await DiscussionStore.getInstance(); // 已由 ChannelManager 初始化

        // 1. 获取讨论室信息
        const session = await store.get(msg.peer);
        if (!session) {
          logger.error(`[DiscussionChannel] Session ${msg.peer} not found`);
          return;
        }

        // 2. 找到当前发言的参与者
        const participant = session.participants.find((p) => p.agentId === msg.from);
        if (!participant) {
          logger.error(`[DiscussionChannel] Participant ${msg.from} not found`);
          return;
        }

        // 3. 构建 Channel 上下文（提供完整的讨论历史供 Agent 参考）
        const context = {
          channel: 'discussion',
          roomId: msg.peer,
          role: participant.role || participant.name,
          topic: session.topic,
          // 提供所有讨论消息（Agent 的会话记忆由 ChannelRuntime 管理）
          discussionHistory: session.messages.map((m) => ({
            sender: m.agentId,
            content: m.content,
            timestamp: m.timestamp
          })),
          // 当前 Agent 的历史发言
          myPreviousMessages: session.messages.filter((m) => m.agentId === msg.from).map((m) => m.content)
        };

        // 4. 调用 ChannelRuntime 执行 Agent
        const result = await runtime.executeAgent({
          agentId: msg.from,
          sessionId: `discussion-${msg.peer}-${msg.from}`,
          message: msg.text,
          context
        });

        if (result.error) {
          logger.error(`[DiscussionChannel] Agent execution error: ${result.error}`);
          return;
        }

        // 5. 发送回复到讨论室
        await discussionChannel.outbound!.sendMessage({
          to: msg.peer,
          agentId: msg.from,
          text: result.output
        });

        // 6. 重新获取最新的 session 状态（包含刚刚保存的消息）
        const updatedSession = await store.get(msg.peer);
        if (!updatedSession) {
          logger.error(`[DiscussionChannel] Session ${msg.peer} disappeared after saving message`);
          return;
        }

        // 7. 触发下一个发言者（自动轮转）
        const nextSpeaker = getNextSpeaker(updatedSession, msg.from);
        if (nextSpeaker && updatedSession.status === 'active') {
          logger.info(`[DiscussionChannel] Scheduling next speaker: ${nextSpeaker.agentId}`);

          // 延迟 2 秒后触发下一轮（给用户时间看到回复）
          setTimeout(() => {
            const recentMessages = updatedSession.messages
              .slice(-5)
              .map((m) => `${m.agentId}: ${m.content}`)
              .join('\n');

            discussionChannel.inbound!.handleMessage({
              peer: msg.peer,
              from: nextSpeaker.agentId,
              text: `Continue discussing "${updatedSession.topic}". Recent messages:\n${recentMessages}\n\nPlease share your perspective.`,
              context: {
                channel: 'discussion',
                roomId: msg.peer,
                role: nextSpeaker.role || nextSpeaker.name,
                topic: updatedSession.topic,
                discussionHistory: updatedSession.messages.map((m) => ({
                  sender: m.agentId,
                  content: m.content,
                  timestamp: m.timestamp
                })),
                myPreviousMessages: updatedSession.messages
                  .filter((m) => m.agentId === nextSpeaker.agentId)
                  .map((m) => m.content)
              }
            });
          }, 2000);
        } else {
          logger.info(`[DiscussionChannel] Discussion ${msg.peer} ended or no more speakers`);
        }
      } catch (err) {
        logger.error('[DiscussionChannel] Error handling message:', err instanceof Error ? err.message : String(err));
        logger.error('[DiscussionChannel] Stack:', err instanceof Error ? err.stack : 'no stack');
      }
    }
  },

  outbound: {
    /**
     * 发送出站消息（Agent → 讨论室）
     *
     * @param msg - 出站消息
     */
    sendMessage: async (msg: OutboundMessage) => {
      try {
        // 动态导入依赖
        const { DiscussionStore } = await import('../../src/main/ai/discussion/DiscussionStore');
        const { eventBus } = await import('../../src/main/common/eventbus');

        const store = await DiscussionStore.getInstance(); // 已由 ChannelManager 初始化

        // 1. 保存消息到数据库
        await store.addMessage(msg.to, {
          participant: msg.agentId,
          content: msg.text,
          timestamp: Date.now()
        });

        logger.info(`[DiscussionChannel] Message sent to room ${msg.to} from ${msg.agentId}`);

        // 2. 广播到前端（通过 EventBus）
        eventBus.emit('discussion:message', {
          roomId: msg.to,
          participant: msg.agentId,
          content: msg.text,
          timestamp: Date.now()
        });
      } catch (err) {
        logger.error('[DiscussionChannel] Error sending message:', err);
      }
    }
  },

  capabilities: {
    supportsMultiAgent: true,
    supportsStreaming: false,
    supportsTools: false,
    supportsMedia: false
  }
};
