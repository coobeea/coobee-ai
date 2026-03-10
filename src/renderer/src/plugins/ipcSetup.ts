import type { App } from 'vue';
import eventBus from '@/eventbus';
import { useLogStore } from '@/stores/log';

/**
 * 是否已初始化
 */
let isInitialized = false;

/**
 * 初始化 IPC 事件系统
 *
 * 此方法应该在应用启动时调用一次
 */
export function initIpcEvents(): void {
  const logStore = useLogStore();

  if (isInitialized) {
    logStore.warn('system', 'IPC 事件系统已初始化，跳过重复初始化');
    return;
  }

  // 监听 IPC 事件并转发到 EventBus
  if (window.api?.onEvent) {
    window.api.onEvent((message) => {
      // 转发到 EventBus（由 event_handles 统一记录业务日志）
      eventBus.emit(message.type, message.payload);
    });
  } else {
    logStore.error('system', 'window.api.onEvent 不可用，IPC 事件系统初始化失败');
    return;
  }

  isInitialized = true;
  logStore.info('system', 'IPC 事件系统已初始化');
}

/**
 * IPC 事件系统安装插件
 */
export default {
  install(_app: App) {
    initIpcEvents();
  }
};
