import { createLogger } from '@main/common/logger';
import type { ChannelConfig, ExtensionLogger } from '../common/extension/types';
import type { ManagedChannel, ChannelStatus, ChannelPlugin, ChannelCapabilities } from './types';

const log = createLogger('channels') as ExtensionLogger;

/**
 * 通道管理器
 *
 * 负责统一管理所有 Extension 注册的 Channel。
 * 控制 Channel 的启动、停止，以及通过 AbortController 实现安全退出。
 */
export class ChannelManager {
  private static instance: ChannelManager;
  private channels: Map<string, ManagedChannel> = new Map();
  private channelPlugins: Map<string, ChannelPlugin> = new Map();
  private logger: ExtensionLogger = log;

  private constructor() {
    // Singleton - use getInstance()
  }

  public static getInstance(): ChannelManager {
    if (!ChannelManager.instance) {
      ChannelManager.instance = new ChannelManager();
    }
    return ChannelManager.instance;
  }

  /**
   * 注册通道（旧方法，保留向后兼容）
   */
  public registerChannel(config: ChannelConfig): void {
    if (this.channels.has(config.id)) {
      this.logger.warn(`Channel "${config.id}" is already registered. Overwriting.`);
    }
    this.channels.set(config.id, {
      config,
      status: 'stopped'
    });
    this.logger.info(`Registered channel: ${config.id} (${config.name})`);
  }

  /**
   * 注册 ChannelPlugin（新架构）
   *
   * @param plugin - ChannelPlugin 实例
   */
  public registerChannelPlugin(plugin: ChannelPlugin): void {
    if (this.channelPlugins.has(plugin.id)) {
      this.logger.warn(`ChannelPlugin "${plugin.id}" is already registered. Overwriting.`);
    }

    // 1. 存储 Plugin
    this.channelPlugins.set(plugin.id, plugin);

    // 2. 转换为 ManagedChannel
    this.channels.set(plugin.id, {
      config: {
        id: plugin.id,
        name: plugin.name,
        gateway: {
          start: plugin.lifecycle.start,
          stop: plugin.lifecycle.stop
        }
      },
      status: 'stopped',
      plugin // 保存 Plugin 引用
    });

    this.logger.info(`Registered ChannelPlugin: ${plugin.id} (${plugin.name})`);
  }

  /**
   * 根据 ID 获取 ChannelPlugin
   *
   * @param id - Channel ID
   * @returns ChannelPlugin 或 undefined
   */
  public getChannelPlugin(id: string): ChannelPlugin | undefined {
    return this.channelPlugins.get(id);
  }

  /**
   * 列出所有 ChannelPlugin
   *
   * @returns ChannelPlugin 数组
   */
  public listChannelPlugins(): ChannelPlugin[] {
    return Array.from(this.channelPlugins.values());
  }

  /**
   * 获取 Channel 能力声明
   *
   * @param id - Channel ID
   * @returns ChannelCapabilities 或 undefined
   */
  public getChannelCapabilities(id: string): ChannelCapabilities | undefined {
    const plugin = this.channelPlugins.get(id);
    return plugin?.capabilities;
  }

  /**
   * 检查 Channel 是否支持指定能力
   *
   * @param id - Channel ID
   * @param capability - 能力名称
   * @returns boolean
   */
  public supportsCapability(id: string, capability: keyof ChannelCapabilities): boolean {
    const capabilities = this.getChannelCapabilities(id);
    return capabilities?.[capability] === true;
  }

  /**
   * 卸载通道
   */
  public async unregisterChannel(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (!channel) return;

    if (channel.status === 'running') {
      await this.stopChannel(id);
    }
    this.channels.delete(id);
    this.logger.info(`Unregistered channel: ${id}`);
  }

  /**
   * 启动单个通道
   */
  public async startChannel(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Channel "${id}" not found`);
    }

    if (channel.status === 'running') {
      this.logger.debug(`Channel "${id}" is already running`);
      return;
    }

    if (!channel.config.gateway?.start) {
      this.logger.debug(`Channel "${id}" has no start hook, marking as running`);
      channel.status = 'running';
      return;
    }

    channel.abortController = new AbortController();
    channel.status = 'running';
    channel.error = undefined;

    try {
      this.logger.info(`Starting channel: ${id}`);

      // 为 discussion channel 初始化 DiscussionStore（必须在 Extension 启动前）
      const config: Record<string, unknown> = {};
      if (id === 'discussion') {
        const { Env } = await import('../common/env');
        const storePath = `${Env.paths.userHome}/discussions`;
        config.storePath = storePath;

        // 在这里直接初始化 DiscussionStore，确保模块路径一致
        const { DiscussionStore } = await import('../ai/discussion/DiscussionStore');
        await DiscussionStore.getInstance(storePath);
        this.logger.debug(`[ChannelManager] DiscussionStore initialized at ${storePath}`);
      }

      const ctx: import('./types').ChannelLifecycleContext = {
        abortSignal: channel.abortController.signal,
        log: this.logger,
        config
      };
      await channel.config.gateway.start(ctx);
    } catch (err) {
      channel.status = 'error';
      channel.error = err instanceof Error ? err.message : String(err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Failed to start channel "${id}": ${errorMsg}`, errorStack ? { stack: errorStack } : err);
      throw err;
    }
  }

  /**
   * 停止单个通道
   */
  public async stopChannel(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Channel "${id}" not found`);
    }

    if (channel.status === 'stopped') {
      return;
    }

    this.logger.info(`Stopping channel: ${id}`);

    // 发出 abort 信号
    if (channel.abortController) {
      channel.abortController.abort();
    }

    try {
      if (channel.config.gateway?.stop) {
        await channel.config.gateway.stop({
          abortSignal: channel.abortController?.signal || new AbortController().signal,
          log: this.logger
        });
      }
    } catch (err) {
      this.logger.error(`Error stopping channel "${id}":`, err);
    } finally {
      channel.status = 'stopped';
      channel.abortController = undefined;
    }
  }

  /**
   * 并发启动所有已注册但未运行的通道
   */
  public async startAll(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (const [id, channel] of this.channels.entries()) {
      if (channel.status !== 'running') {
        startPromises.push(
          this.startChannel(id).catch((err) => {
            // catch 错误，防止一个 channel 失败导致整体启动失败
            this.logger.error(`startAll: Failed to start channel ${id}`, err);
          })
        );
      }
    }

    await Promise.all(startPromises);
    this.logger.info('Finished starting all channels');
  }

  /**
   * 停止所有运行中的通道
   */
  public async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [id, channel] of this.channels.entries()) {
      if (channel.status === 'running') {
        stopPromises.push(
          this.stopChannel(id).catch((err) => {
            this.logger.error(`stopAll: Failed to stop channel ${id}`, err);
          })
        );
      }
    }

    await Promise.all(stopPromises);
    this.logger.info('Finished stopping all channels');
  }

  /**
   * 获取所有通道的状态
   */
  public getStatus(): ChannelStatus[] {
    const statuses: ChannelStatus[] = [];
    for (const [id, channel] of this.channels.entries()) {
      statuses.push({
        id,
        name: channel.config.name,
        status: channel.status,
        error: channel.error
      });
    }
    return statuses;
  }

  /**
   * 清除所有状态，仅用于测试
   */
  public clear(): void {
    this.stopAll().finally(() => {
      this.channels.clear();
      this.channelPlugins.clear();
    });
  }
}
