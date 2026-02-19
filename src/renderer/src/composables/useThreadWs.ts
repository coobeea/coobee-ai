/**
 * Thread 领域 WebSocket 组合式
 *
 * 监听 Gateway 推送的 thread.* 事件，实时同步到 threadsStore：
 *   thread.created  — 新 Thread 创建，插入列表头部
 *   thread.updated  — Thread 元信息变更（标题、消息数等），更新对应条目
 *   thread.deleted  — Thread 被删除，从列表中移除
 *   thread.status   — runStatus 变更，就地更新
 */

import { gateway } from '@/plugins/gatewaySetup';
import { useThreadsStore, type ThreadEntry, type ThreadRunStatus } from '@/stores/threads';

let initialized = false;
let cleanups: (() => void)[] = [];

export function initThreadWs(): void {
  if (initialized) return;
  initialized = true;

  const store = useThreadsStore();

  cleanups.push(
    gateway.on('thread.created', (payload) => {
      const { thread } = payload as { thread: ThreadEntry };
      if (!thread?.id) return;
      store.handleThreadCreated(thread);
    })
  );

  cleanups.push(
    gateway.on('thread.updated', (payload) => {
      const { thread } = payload as { thread: ThreadEntry };
      if (!thread?.id) return;
      store.handleThreadUpdated(thread);
    })
  );

  cleanups.push(
    gateway.on('thread.deleted', (payload) => {
      const { threadId } = payload as { threadId: string };
      if (!threadId) return;
      store.handleThreadDeleted(threadId);
    })
  );

  cleanups.push(
    gateway.on('thread.status', (payload) => {
      const { threadId, runStatus } = payload as { threadId: string; runStatus: ThreadRunStatus };
      if (!threadId) return;
      store.handleThreadStatusChanged(threadId, runStatus);
    })
  );

  console.log('[useThreadWs] Thread 事件监听初始化完成');
}

export function cleanupThreadWs(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  initialized = false;
}
