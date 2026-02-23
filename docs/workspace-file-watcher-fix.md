# 工作空间文件监控修复文档

## 问题描述

用户反馈工作空间目录有文件新增时，没有推送事件到前端，文件树无法自动刷新。

## 问题诊断

### ✅ 后端实现（已完整）

1. **Extension 已实现**：`workspace-file-watcher` Extension
   - 使用 `chokidar` 监听 `.home/workspaces/{threadId}/` 目录
   - 监听 `add`/`change`/`unlink` 事件
   - 300ms 去抖批量推送
   - 通过 EventBus 发送 `workspace:file-changed` 事件

2. **事件流程**：
   ```
   新建文件 → chokidar 监听到 "add" 事件
            → onFileChange() 添加到缓冲区
            → 300ms 去抖后 flushChanges()
            → eventBus.emit("workspace:file-changed", {...})
   ```

### ❌ 前端缺失（需修复）

1. **缺少 EventBridge**：没有将 EventBus 的 `workspace:file-changed` 转发到 Gateway WebSocket
2. **缺少前端订阅**：前端没有监听 `workspace.file-changed` 事件
3. **缺少自动刷新**：`ProjectPanel` 没有订阅文件变化事件

## 解决方案

### 1. 创建 WorkspaceBridge（后端）

**文件**：`src/main/gateway/events/WorkspaceBridge.ts`

```typescript
/**
 * Gateway 事件桥接 — Workspace
 *
 * 将内部 EventBus 的 Workspace 文件变化事件转换为 Gateway 事件推送。
 *
 * 桥接映射：
 *   EventBus workspace:file-changed → Gateway event 'workspace.file-changed'
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '../protocol';

interface WorkspaceFileChangedPayload {
  threadId: string;
  files: string[];
  timestamp: number;
}

export const initWorkspaceBridge: EventBridgeInit = (gateway) => {
  const handleFileChanged = (payload: WorkspaceFileChangedPayload): void => {
    if (!payload?.threadId || !payload?.files) return;

    // 广播文件变化事件给所有客户端
    gateway.broadcastEvent('workspace.file-changed', payload);

    log.debug(`[WorkspaceBridge] 转发文件变化事件: ${payload.threadId}, ${payload.files.length} 个文件`);
  };

  eventBus.on('workspace:file-changed', handleFileChanged);

  log.info('[WorkspaceBridge] Workspace 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off('workspace:file-changed', handleFileChanged);
    log.info('[WorkspaceBridge] Workspace 事件桥接已清理');
  };
};
```

**特点**：

- 自动被 Gateway 扫描和初始化（`scanGatewayEventBridges()`）
- 广播给所有客户端（不需要会话过滤）
- 提供清理函数防止内存泄漏

### 2. 创建前端订阅 Composable

**文件**：`src/renderer/src/composables/useWorkspaceWatcher.ts`

```typescript
/**
 * Workspace 文件监控 WebSocket 组合式
 *
 * 监听 Gateway 推送的 workspace.file-changed 事件，实时通知文件变化。
 */

import { gateway } from '@/plugins/gatewaySetup';

export interface WorkspaceFileChangedPayload {
  threadId: string;
  files: string[];
  timestamp: number;
}

export type WorkspaceFileChangeHandler = (payload: WorkspaceFileChangedPayload) => void;

let fileChangeHandlers: Map<string, WorkspaceFileChangeHandler[]> = new Map();
let unregisterFileChanged: (() => void) | null = null;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;

  unregisterFileChanged = gateway.on('workspace.file-changed', (payload) => {
    if (!payload) return;

    const data = payload as WorkspaceFileChangedPayload;
    if (!data.threadId || !data.files || data.files.length === 0) return;

    const handlers = fileChangeHandlers.get(data.threadId);
    if (!handlers || handlers.length === 0) return;

    console.log(`[useWorkspaceWatcher] 文件变化: ${data.threadId}, ${data.files.length} 个文件`);

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error('[useWorkspaceWatcher] Handler error:', err);
      }
    }
  });

  console.log('[useWorkspaceWatcher] 初始化完成');
}

/**
 * 订阅指定 threadId 的文件变化
 */
export function watchThreadFiles(threadId: string, handler: WorkspaceFileChangeHandler): () => void {
  if (!initialized) init();

  if (!fileChangeHandlers.has(threadId)) {
    fileChangeHandlers.set(threadId, []);
  }

  const handlers = fileChangeHandlers.get(threadId)!;
  handlers.push(handler);

  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }

    if (handlers.length === 0) {
      fileChangeHandlers.delete(threadId);
    }
  };
}

init();
```

**特点**：

- 按 threadId 分组管理处理器
- 支持多个组件同时订阅同一个 threadId
- 返回取消订阅函数，防止内存泄漏
- 自动初始化

### 3. 修改 ProjectPanel 组件

**文件**：`src/renderer/src/components/agent/ProjectPanel.vue`

**主要修改**：

1. 添加 `threadId` prop：

   ```typescript
   const props = defineProps<{
     threadId?: string;
   }>();
   ```

2. 订阅文件变化并自动刷新：

   ```typescript
   import { watchThreadFiles, type WorkspaceFileChangedPayload } from '@/composables/useWorkspaceWatcher';

   let unwatchFiles: (() => void) | null = null;

   watch(
     () => props.threadId,
     (newThreadId) => {
       if (unwatchFiles) {
         unwatchFiles();
         unwatchFiles = null;
       }

       if (newThreadId) {
         unwatchFiles = watchThreadFiles(newThreadId, (payload) => {
           console.log(`[ProjectPanel] 检测到文件变化: ${payload.files.join(', ')}`);
           // 自动刷新文件树
           loadTree();
         });
       }
     },
     { immediate: true }
   );

   onUnmounted(() => {
     if (unwatchFiles) {
       unwatchFiles();
     }
   });
   ```

### 4. 修改 ThreadView 组件

**文件**：`src/renderer/src/views/ThreadView.vue`

**主要修改**：

传递 `threadId` 给 `ProjectPanel`：

```vue
<ProjectPanel v-model:collapsed="leftCollapsed" v-model:project-path="projectPath" :thread-id="threadId" />
```

## 完整事件流程

```
1. Agent 创建/修改文件
   ↓
2. workspace-file-watcher Extension 监听到变化
   ↓
3. 300ms 去抖后，EventBus 发送 "workspace:file-changed"
   ↓
4. WorkspaceBridge 转发到 Gateway WebSocket ("workspace.file-changed")
   ↓
5. 前端 useWorkspaceWatcher 接收事件
   ↓
6. ProjectPanel 处理器被调用，自动刷新文件树
   ↓
7. 用户看到最新的文件列表
```

## 测试步骤

1. **启动应用**：

   ```bash
   pnpm dev
   ```

2. **创建任务**：
   - 打开应用，创建一个新的 Agent 任务
   - 任务会自动创建工作空间目录：`.home/workspaces/{threadId}/`

3. **让 Agent 创建文件**：
   - 在对话中输入："创建一个 test.txt 文件，内容是 Hello World"
   - Agent 使用 `write` 工具创建文件

4. **验证文件监控**：
   - 查看后端日志：
     ```
     [WorkspaceFileWatcher] File add: {threadId}/test.txt
     [WorkspaceFileWatcher] Pushed 1 file change(s) for {threadId}
     [WorkspaceBridge] 转发文件变化事件: {threadId}, 1 个文件
     ```
   - 查看前端日志：
     ```
     [useWorkspaceWatcher] 文件变化: {threadId}, 1 个文件
     [ProjectPanel] 检测到文件变化: test.txt
     ```
   - 文件树应自动刷新，显示新创建的 `test.txt`

5. **测试其他操作**：
   - **修改文件**：让 Agent 修改 `test.txt` 内容 → 触发 `change` 事件
   - **删除文件**：让 Agent 删除 `test.txt` → 触发 `unlink` 事件
   - **批量操作**：让 Agent 创建多个文件 → 300ms 内批量推送

## 技术亮点

1. **自动发现机制**：WorkspaceBridge 无需手动注册，Gateway 启动时自动扫描
2. **去抖优化**：300ms 内的多次文件变化合并为一次推送，减少网络开销
3. **内存安全**：所有监听器都提供清理函数，防止内存泄漏
4. **多任务隔离**：每个 threadId 独立的文件监控，任务间互不干扰
5. **自动续期**：60s keepalive 机制，任务活跃时自动延长监控
6. **类型安全**：TypeScript 完整类型定义，编译时错误检查

## 相关文件

### 后端

- `extensions/workspace-file-watcher/WorkspaceFileWatcher.ts` - 文件监控 Extension
- `extensions/workspace-file-watcher/index.ts` - Extension 入口
- `src/main/gateway/events/WorkspaceBridge.ts` - Gateway 事件桥接（新建）

### 前端

- `src/renderer/src/composables/useWorkspaceWatcher.ts` - 文件监控 Composable（新建）
- `src/renderer/src/components/agent/ProjectPanel.vue` - 文件树组件（已修改）
- `src/renderer/src/views/ThreadView.vue` - 任务视图（已修改）

## 后续优化建议

1. **增量更新**：目前是全量刷新文件树，可优化为增量更新（只更新变化的节点）
2. **变化高亮**：在文件树中高亮显示变化的文件（3 秒后淡出）
3. **文件图标动画**：新建/修改文件时显示动画效果
4. **自动打开文件**：新建文件后自动在 Workbench 中打开
5. **撤销/恢复**：监听文件删除事件，提供撤销删除功能
6. **过滤规则配置**：允许用户配置忽略的文件/目录（.git、node_modules 等）
