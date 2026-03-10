/**
 * useAgentEvents — 监听 Agent 发出的 UI 事件
 *
 * Agent 通过 emit_event 工具发送事件，经 Gateway WebSocket 到达前端。
 * 本 composable 注册一次监听，根据事件类型分发处理。
 *
 * 支持的事件类型：
 *   - open-preview: 在工作台打开 URL 预览
 *   - open-file:    在工作台打开文件
 *   - notify:       显示通知（暂用 console）
 */

import { gateway } from '@/plugins/gatewaySetup';
import { useOpenFiles } from './useOpenFiles';

let initialized = false;
let cleanup: (() => void) | null = null;

export function initAgentEvents(): void {
  if (initialized) return;
  initialized = true;

  const { openUrl, openFile } = useOpenFiles();

  cleanup = gateway.on('agent.event', (payload) => {
    const data = payload as Record<string, unknown>;
    const event = data._event as string;

    switch (event) {
      case 'open-preview': {
        const url = data.url as string | undefined;
        if (url) {
          openUrl(url, data.title as string | undefined);
        }
        break;
      }
      case 'open-file': {
        const path = data.path as string | undefined;
        if (path) {
          openFile(path);
        }
        break;
      }
      case 'notify': {
        const message = data.message as string | undefined;
        if (message) {
          console.info(`[Agent] ${message}`);
        }
        break;
      }
      default:
        console.debug('[AgentEvent] Unhandled event:', event, data);
    }
  });
}

export function cleanupAgentEvents(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  initialized = false;
}
