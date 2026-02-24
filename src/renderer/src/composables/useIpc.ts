/**
 * IPC 通信 Composable
 *
 * 职责：
 * - 初始化 IPC 事件监听
 * - 注册前端 EventBus 到 preload
 * - 提供 IPC 相关的工具方法
 */
import type { WindowInfoResponse } from '@shared/ipc';

/**
 * IPC 通信 Composable
 *
 * @returns IPC 相关的方法
 */
export function useIpc(): {
  getPlatform: () => string;
  getWindowInfo: () => Promise<WindowInfoResponse | null>;
  tab: {
    create: typeof window.api.tab.create;
    close: typeof window.api.tab.close;
    switch: typeof window.api.tab.switch;
    update: typeof window.api.tab.update;
  };
} {
  /**
   * 获取平台信息
   */
  const getPlatform = (): string => {
    return window.api.getPlatform();
  };

  /**
   * 获取窗口信息
   */
  const getWindowInfo = async (): Promise<WindowInfoResponse | null> => {
    return await window.api.getWindowInfo();
  };

  /**
   * Tab 操作
   */
  const tab = {
    create: window.api.tab.create,
    close: window.api.tab.close,
    switch: window.api.tab.switch,
    update: window.api.tab.update
  };

  return {
    getPlatform,
    getWindowInfo,
    tab
  };
}

/**
 * 默认导出
 */
export default useIpc;
