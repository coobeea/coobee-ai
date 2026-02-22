import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChannelManager } from '../ChannelManager';
import type { ChannelConfig } from '../../common/extension/types';

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    // 因为是单例，所以我们每次清空状态
    manager = ChannelManager.getInstance();
    manager.clear();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should register a channel', () => {
    const config: ChannelConfig = {
      id: 'test-channel',
      name: 'Test Channel'
    };

    manager.registerChannel(config);

    const status = manager.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toEqual({
      id: 'test-channel',
      name: 'Test Channel',
      status: 'stopped'
    });
  });

  it('should start and stop a channel with hooks', async () => {
    let startCalled = false;
    let stopCalled = false;
    let signal: AbortSignal | undefined;

    const config: ChannelConfig = {
      id: 'hook-channel',
      name: 'Hook Channel',
      gateway: {
        start: async (ctx) => {
          startCalled = true;
          signal = ctx.abortSignal;
        },
        stop: async () => {
          stopCalled = true;
        }
      }
    };

    manager.registerChannel(config);

    // Start
    await manager.startChannel('hook-channel');

    expect(startCalled).toBe(true);
    expect(manager.getStatus()[0]?.status).toBe('running');
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    // Stop
    await manager.stopChannel('hook-channel');

    expect(stopCalled).toBe(true);
    expect(manager.getStatus()[0]?.status).toBe('stopped');
    expect(signal?.aborted).toBe(true); // check if abort signal was sent
  });

  it('should start a channel without hooks immediately', async () => {
    const config: ChannelConfig = {
      id: 'no-hook-channel',
      name: 'No Hook Channel'
    };

    manager.registerChannel(config);
    await manager.startChannel('no-hook-channel');

    expect(manager.getStatus()[0]?.status).toBe('running');
  });

  it('should handle start errors', async () => {
    const config: ChannelConfig = {
      id: 'error-channel',
      name: 'Error Channel',
      gateway: {
        start: async () => {
          throw new Error('Start failed');
        }
      }
    };

    manager.registerChannel(config);

    await expect(manager.startChannel('error-channel')).rejects.toThrow('Start failed');

    const status = manager.getStatus()[0];
    expect(status?.status).toBe('error');
    expect(status?.error).toBe('Start failed');
  });

  it('should startAll and stopAll concurrently', async () => {
    let startCount = 0;
    let stopCount = 0;

    const createConfig = (id: string): ChannelConfig => ({
      id,
      name: `Channel ${id}`,
      gateway: {
        start: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10)); // simulate async work
          startCount++;
        },
        stop: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          stopCount++;
        }
      }
    });

    manager.registerChannel(createConfig('channel-1'));
    manager.registerChannel(createConfig('channel-2'));

    await manager.startAll();

    expect(startCount).toBe(2);
    expect(manager.getStatus().every((s) => s.status === 'running')).toBe(true);

    await manager.stopAll();

    expect(stopCount).toBe(2);
    expect(manager.getStatus().every((s) => s.status === 'stopped')).toBe(true);
  });
});
