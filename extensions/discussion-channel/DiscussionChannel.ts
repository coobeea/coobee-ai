import type { ChannelPlugin, InboundMessage, OutboundMessage } from '../../src/main/channels/types';
import type { ExtensionApi, ExtensionLogger } from '../../src/main/common/extension/types';
import type { DiscussionSession, DiscussionParticipant } from '../../src/main/ai/discussion/types';

let logger: ExtensionLogger;
let extensionApi: ExtensionApi;

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
 * 创建 Discussion ChannelPlugin
 *
 * @param api - ExtensionApi 实例，用于访问系统服务
 */
export function createDiscussionChannel(api: ExtensionApi): ChannelPlugin {
  extensionApi = api;

  // 创建 Plugin 对象（需要保存引用以便在 setTimeout 中调用 inbound）
  const plugin: ChannelPlugin = {
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
          // 通过 ExtensionApi 获取依赖（避免 jiti 加载时触发 app 对象访问）
          const runtime = await extensionApi.getChannelRuntime();
          const store = await extensionApi.getDiscussionStore();

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
          await plugin.outbound!.sendMessage({
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

          // 7. 检查是否应该结束讨论
          const { ConsensusDetector } = await import('../../src/main/ai/discussion/ConsensusDetector');
          const detector = new ConsensusDetector();

          // 计算当前轮次（每个参与者发言一次算一轮）
          const participantCount = updatedSession.participants.filter((p) => p.active !== false).length;
          const currentRound = Math.ceil(updatedSession.messages.length / participantCount);
          const maxRounds = updatedSession.maxRounds || 20;

          // 检测共识
          const consensus = await detector.detect(updatedSession.messages, updatedSession.consensusThreshold || 0.7);
          updatedSession.consensusLevel = consensus.level;
          await store.save(updatedSession);

          logger.info(
            `[DiscussionChannel] Round ${currentRound}/${maxRounds}, Consensus: ${(consensus.level * 100).toFixed(1)}%`
          );

          // 判断是否自动结束
          let shouldEnd = false;
          let endReason = '';

          if (currentRound >= maxRounds) {
            shouldEnd = true;
            endReason = `达到最大轮次 ${maxRounds}`;
          } else if (consensus.achieved) {
            shouldEnd = true;
            endReason = `达成共识（${(consensus.level * 100).toFixed(1)}%）`;
          }

          if (shouldEnd) {
            logger.info(`[DiscussionChannel] Auto-ending discussion: ${endReason}`);
            updatedSession.status = 'completed';
            await store.save(updatedSession);

            // 发送结束通知
            extensionApi.eventBus.emit('discussion:ended', {
              roomId: msg.peer,
              reason: endReason,
              consensusLevel: consensus.level,
              messageCount: updatedSession.messages.length
            });

            return;
          }

          // 8. 触发下一个发言者（自动轮转）
          const nextSpeaker = getNextSpeaker(updatedSession, msg.from);
          if (nextSpeaker && updatedSession.status === 'active') {
            logger.info(`[DiscussionChannel] Scheduling next speaker: ${nextSpeaker.agentId}`);

            // 延迟 2 秒后触发下一轮（给用户时间看到回复）
            setTimeout(() => {
              const recentMessages = updatedSession.messages
                .slice(-5)
                .map((m) => `${m.agentId}: ${m.content}`)
                .join('\n');

              plugin.inbound!.handleMessage({
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
          // 通过 ExtensionApi 获取依赖
          const store = await extensionApi.getDiscussionStore();

          // 1. 保存消息到数据库
          await store.addMessage(msg.to, {
            participant: msg.agentId,
            content: msg.text,
            timestamp: Date.now()
          });

          logger.info(`[DiscussionChannel] Message sent to room ${msg.to} from ${msg.agentId}`);

          // 2. 广播到前端（通过 ExtensionApi 的 EventBus）
          extensionApi.eventBus.emit('discussion:message', {
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

  return plugin;
}
