/**
 * StreamService - 流式输出服务
 *
 * 职责：
 * - 管理 StreamEmitter 实例
 * - 处理 SDK 流事件到统一 StreamChunk 的转换
 * - 提供流式输出订阅接口
 */

import { createStreamEmitter, type IStreamEmitter } from '../../streaming/StreamEmitter';
import type { StreamChunk } from '../types';

/**
 * 流式输出服务
 */
export class StreamService {
  private emitter: IStreamEmitter;

  constructor(sessionId: string, agentInfo: { type: 'agent' | 'orchestrator' | 'swarm'; id: string; name: string }) {
    this.emitter = createStreamEmitter(sessionId, agentInfo);
  }

  /**
   * 生成流式事件（简化版本，实际逻辑保留在 OpenAIAgentRuntime 中）
   *
   * 注：由于 SDK 流事件处理逻辑复杂（ThinkTagParser、事件类型转换等），
   * 暂时保留在 Runtime 中，此方法作为未来迁移的占位符。
   */
  async *generateStreamEvents(_streamResult: unknown, _onText?: (text: string) => void): AsyncGenerator<StreamChunk> {
    // 占位实现，实际逻辑保留在 OpenAIAgentRuntime.generateStreamEvents
    yield { type: 'run:start', content: '' };
  }

  /**
   * 获取 Emitter
   */
  getEmitter(): IStreamEmitter {
    return this.emitter;
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    await this.emitter.emit('cleanup', '');
  }
}
