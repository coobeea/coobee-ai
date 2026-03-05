import type { ChannelPlugin, InboundMessage, OutboundMessage } from '../../src/main/channels/types';
import type { ExtensionLogger } from '../../src/main/common/extension/types';

let logger: ExtensionLogger;

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

      // 从 ctx.config 获取 storePath（由 ChannelManager 传入）
      const storePath = ctx.config?.storePath as string | undefined;
      if (!storePath) {
        throw new Error('DiscussionChannel: storePath is required in config');
      }

      // 动态导入并初始化 DiscussionStore
      const { DiscussionStore } = await import('../../src/main/ai/discussion/DiscussionStore');
      await DiscussionStore.getInstance(storePath);
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
        const store = await DiscussionStore.getInstance(); // 已在 start 时初始化

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

        // 3. 构建 Channel 上下文
        const context = {
          channel: 'discussion',
          roomId: msg.peer,
          role: participant.role || participant.name,
          topic: session.topic,
          recentMessages: session.messages.slice(-5).map((m) => ({
            sender: m.agentId,
            content: m.content
          }))
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

        // 6. 触发下一个发言者（自动轮转）
        const nextSpeaker = getNextSpeaker(session, msg.from);
        if (nextSpeaker && session.status === 'active') {
          // 延迟 1 秒后触发下一轮
          setTimeout(() => {
            discussionChannel.inbound!.handleMessage({
              peer: msg.peer,
              from: nextSpeaker.agentId,
              text: `Continue the discussion. Previous messages: ${session.messages
                .slice(-3)
                .map((m) => `${m.agentId}: ${m.content}`)
                .join('\n')}`,
              context: {
                ...context,
                role: nextSpeaker.role || nextSpeaker.name
              }
            });
          }, 1000);
        }
      } catch (err) {
        logger.error('[DiscussionChannel] Error handling message:', err);
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

        const store = await DiscussionStore.getInstance(); // 已在 start 时初始化

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

/**
 * 获取下一个发言者（轮询策略）
 */
function getNextSpeaker(
  session: { participants: Array<{ agentId: string; name: string; role?: string; active: boolean }> },
  currentSpeakerId: string
): { agentId: string; name: string; role?: string } | null {
  const activeParticipants = session.participants.filter((p) => p.active);
  if (activeParticipants.length === 0) return null;

  const currentIndex = activeParticipants.findIndex((p) => p.agentId === currentSpeakerId);
  const nextIndex = (currentIndex + 1) % activeParticipants.length;
  return activeParticipants[nextIndex];
}
