/**
 * FileMessageBus - 持久化的 MessageBus
 *
 * 扩展 MessageBus，将所有消息同步写入文件：
 * - 消息历史 → messages.jsonl
 *
 * 程序重启时自动从文件恢复消息历史。
 */

import { createLogger } from '@main/common/logger';
import { MessageBus } from './MessageBus';

const log = createLogger('FileMessageBus');
import type { SwarmMessage } from './MessageBus';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 持久化的 MessageBus
 *
 * 所有消息同步写入文件，程序重启时自动恢复。
 */
export class FileMessageBus extends MessageBus {
  private readonly messagesPath: string;

  /**
   * @param workspaceDir Workspace 根目录
   */
  constructor(workspaceDir: string) {
    super();

    const swarmDir = join(workspaceDir, 'swarm');
    this.messagesPath = join(swarmDir, 'messages.jsonl');

    this.init();
  }

  /**
   * 初始化：创建目录并恢复消息历史
   */
  private init(): void {
    const dir = dirname(this.messagesPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.messagesPath)) {
      writeFileSync(this.messagesPath, '', 'utf-8');
      return;
    }

    // 恢复消息历史
    this.replay();
  }

  /**
   * 从文件恢复消息历史
   */
  private replay(): void {
    if (!existsSync(this.messagesPath)) {
      return;
    }

    const content = readFileSync(this.messagesPath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l);

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as SwarmMessage;
        // 直接添加到内存（不触发持久化）
        this.restoreMessage(message);
      } catch (error) {
        log.error('Failed to restore message:', line, error);
      }
    }
  }

  /**
   * 恢复单条消息到内存（不触发持久化）
   *
   * 注意：这是内部方法，直接访问父类的 private 成员
   * 如果父类结构变化，需要调整
   */
  private restoreMessage(message: SwarmMessage): void {
    // 使用 any 绕过 TypeScript 检查，直接访问 private 成员
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bus = this as any;
    bus.messages.push(message);

    // 更新计数器
    const idNum = parseInt(message.id.split('-')[1]);
    if (!isNaN(idNum) && idNum >= bus.messageCounter) {
      bus.messageCounter = idNum + 1;
    }
  }

  // ========== 覆盖方法：消息持久化 ==========

  override send(
    fromRoleId: string,
    toRoleId: string,
    content: string,
    options?: Record<string, unknown>
  ): SwarmMessage {
    const message = super.send(fromRoleId, toRoleId, content, options);

    // 同步写入文件
    this.appendMessage(message);

    return message;
  }

  // ========== 辅助方法 ==========

  /**
   * 追加消息到文件
   */
  private appendMessage(message: SwarmMessage): void {
    try {
      const line = JSON.stringify(message) + '\n';
      appendFileSync(this.messagesPath, line, 'utf-8');
    } catch (error) {
      log.error('Failed to append message:', error);
    }
  }

  /**
   * 获取文件路径（用于测试/调试）
   */
  getFilePath(): string {
    return this.messagesPath;
  }
}
