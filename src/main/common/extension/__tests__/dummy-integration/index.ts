import type { ExtensionModule } from '@main/common/extension/types';

let state = {
  serviceStarted: false,
  channelStarted: false,
  httpCalled: false,
  channelSignalAborted: false
};

export const resetDummyState = (): void => {
  state = {
    serviceStarted: false,
    channelStarted: false,
    httpCalled: false,
    channelSignalAborted: false
  };
};

export const getDummyState = (): typeof state => state;

export default {
  id: 'dummy-integration',
  name: 'Dummy Integration Extension',
  register: (api) => {
    // 1. 注册 Background Service
    api.registerService({
      id: 'dummy-service',
      start: async () => {
        state.serviceStarted = true;
      },
      stop: async () => {
        state.serviceStarted = false;
      }
    });

    // 2. 注册 Channel
    api.registerChannel({
      id: 'dummy-channel',
      name: 'Dummy Channel',
      gateway: {
        start: async (ctx) => {
          state.channelStarted = true;
          ctx.abortSignal.addEventListener('abort', () => {
            state.channelSignalAborted = true;
            state.channelStarted = false;
          });
        },
        stop: async () => {
          state.channelStarted = false;
        }
      }
    });

    // 3. 注册 HTTP 路由
    api.registerHttpRoute({
      path: '/dummy-route',
      method: 'GET',
      handler: (ctx: Record<string, unknown>) => {
        state.httpCalled = true;
        (ctx as { status: number; body: unknown }).status = 200;
        (ctx as { status: number; body: unknown }).body = { success: true };
      }
    });

    // 4. 注册 Gateway RPC 方法
    api.registerGatewayMethod('dummy.ping', async () => {
      return { pong: true };
    });
  },
  unregister: () => {
    resetDummyState();
  }
} as ExtensionModule;
