# Console 输出清理清单

本文档记录需要将 `console.log/warn/error` 替换为 `useLogStore` 的文件。

> **创建时间**：2026-03-04
> **优先级**：P0（高优先级）
> **目标**：使用统一的日志系统 `useLogStore` 替代 console 输出

---

## 📋 日志系统说明

项目已有完整的日志系统：`src/renderer/src/stores/log.ts`

**使用方法：**

```typescript
import { useLogStore } from '@/stores/log';

const logStore = useLogStore();

// 替换 console.log
logStore.info('category', 'message', { data });

// 替换 console.warn
logStore.warn('category', 'message', { data });

// 替换 console.error
logStore.error('category', 'message', { error });

// 替换 console.debug（开发调试用）
logStore.debug('category', 'message', { data });
```

**日志分类（category）：**

- `'event'` - 事件相关
- `'ipc'` - IPC 通信
- `'window'` - 窗口管理
- `'tab'` - 标签页
- `'app'` - 应用生命周期
- `'system'` - 系统级操作
- `'user'` - 用户操作

---

## 🔴 P0 - 关键文件（优先处理）

### 1. src/renderer/src/plugins/ipcSetup.ts

- [ ] Line 17: `console.warn('[ipcSetup] IPC events already initialized')` → `logStore.warn('system', '...')`
- [ ] Line 28: `console.error('[ipcSetup] window.api.onEvent 不可用！')` → `logStore.error('system', '...')`
- [ ] Line 36: `console.log('[ipcSetup] IPC events initialized')` → **已有 logStore.info，可删除 console.log**

### 2. src/renderer/src/plugins/eventbusSetup.ts

- [ ] Line 17: `console.log('[EventHandlers] 所有事件处理器已注册')` → `logStore.info('system', '...')`

### 3. src/renderer/src/components/agent/ProjectPanel.vue

- [ ] Line 113: `console.error('[ProjectPanel] 删除失败:')` → `logStore.error('user', '...')`
- [ ] Line 117: `console.log('[ProjectPanel] 删除成功:')` → `logStore.info('user', '...')`
- [ ] Line 121: `console.error('[ProjectPanel] 删除错误:')` → `logStore.error('user', '...')`
- [ ] Line 135: `console.log('[ProjectPanel] 剪贴板中没有文件')` → `logStore.debug('user', '...')`
- [ ] Line 152: `console.error('[ProjectPanel] 无法确定目标目录')` → `logStore.error('user', '...')`
- [ ] Line 156: `console.log('[ProjectPanel] 粘贴文件到:')` → `logStore.info('user', '...')`
- [ ] Line 163: `console.error('[ProjectPanel] 粘贴失败:')` → `logStore.error('user', '...')`
- [ ] Line 197: `console.warn('[ProjectPanel] 选择目录失败:')` → `logStore.warn('user', '...')`
- [ ] Line 226: `console.log('[ProjectPanel] 检测到文件变化:')` → `logStore.debug('event', '...')`
- [ ] Line 256-264: 复制相关的 console → logStore
- [ ] Line 291-299: 上传相关的 console → logStore

### 4. src/renderer/src/views/settings/AgentHomeSettings.vue

- [ ] 检查并替换所有 console.warn

---

## 🟡 P1 - 重要文件（后续处理）

### Stores

- [ ] src/renderer/src/stores/agents.ts
- [ ] src/renderer/src/stores/copilot.ts
- [ ] src/renderer/src/stores/threads.ts
- [ ] src/renderer/src/stores/window.ts
- [ ] src/renderer/src/stores/core/CoreStore.ts
- [ ] src/renderer/src/stores/helpers/storeHelpers.ts
- [ ] src/renderer/src/stores/chat.ts
- [ ] src/renderer/src/stores/worker.ts
- [ ] src/renderer/src/stores/preference.ts
- [ ] src/renderer/src/stores/modules/WorkspaceStore.ts
- [ ] src/renderer/src/stores/modules/SkillStore.ts
- [ ] src/renderer/src/stores/skills.ts

### Components

- [ ] src/renderer/src/components/common/ErrorDisplay.vue
- [ ] src/renderer/src/components/tavern/TaskForm.vue
- [ ] src/renderer/src/components/agent/ContextPanel.vue
- [ ] src/renderer/src/components/agent/ChatPanel.vue
- [ ] src/renderer/src/components/agent/VoicePanel.vue
- [ ] src/renderer/src/components/agent/FileTreeNode.vue
- [ ] src/renderer/src/components/common/AIGenerate.vue
- [ ] src/renderer/src/components/ModelSelector.vue
- [ ] src/renderer/src/components/Confirm/store.ts

### Views

- [ ] src/renderer/src/views/settings/RemoteAccessSettings.vue
- [ ] src/renderer/src/views/settings/BasicSettings.vue
- [ ] src/renderer/src/views/settings/WorkersSettings.vue
- [ ] src/renderer/src/views/EmployeeView.vue
- [ ] src/renderer/src/views/HomeView.vue
- [ ] src/renderer/src/views/ThreadView.vue
- [ ] src/renderer/src/views/observability/ObservabilityView.vue
- [ ] src/renderer/src/views/AgentView.vue
- [ ] src/renderer/src/views/CronView.vue

### Composables

- [ ] src/renderer/src/composables/useThreadWs.ts
- [ ] src/renderer/src/composables/useTerminal.ts
- [ ] src/renderer/src/composables/useWorkerWs.ts
- [ ] src/renderer/src/composables/useStreamWs.ts
- [ ] src/renderer/src/composables/useOpenFiles.ts
- [ ] src/renderer/src/composables/useQuickChat.ts
- [ ] src/renderer/src/composables/useAudioRecorder.ts
- [ ] src/renderer/src/composables/useWorkspaceWatcher.ts

### Others

- [ ] src/renderer/src/eventbus/event_handles/windowEventsHandle.ts
- [ ] src/renderer/src/eventbus/event_handles/tabEventsHandle.ts
- [ ] src/renderer/src/eventbus/event_handles/appEventsHandle.ts
- [ ] src/renderer/src/plugins/gatewaySetup.ts
- [ ] src/renderer/src/services/GatewayClient.ts
- [ ] src/renderer/src/directives/aiGenerate.ts
- [ ] src/renderer/src/App.vue
- [ ] src/renderer/src/api/request.ts
- [ ] src/renderer/src/types/sse.ts

### Shell Window

- [ ] src/renderer/src/windows/shell/stores/tab.ts
- [ ] src/renderer/src/windows/shell/components/AppBar.vue

### Console Window

- [ ] src/renderer/src/windows/console/ConsoleApp.vue

---

## ⚪ 不需要替换的文件

以下文件中的 console 输出可保留：

- **测试文件**：`**/__tests__/**/*.test.ts` - 测试调试输出
- **构建脚本**：`scripts/**/*.js` - 构建时输出
- **配置文件**：`electron.vite.config.ts` - 构建配置输出
- **主进程**：`src/main/index.ts` - 主进程异常处理（已使用 electron-log）

---

## 📝 实施建议

1. **分批次处理**：
   - 第一批：P0 关键文件（4 个）
   - 第二批：P1 Stores（12 个）
   - 第三批：P1 Components（9 个）
   - 第四批：P1 Views 和其他（剩余）

2. **统一模式**：

   ```typescript
   // 导入
   import { useLogStore } from '@/stores/log';

   // 在 setup() 中初始化
   const logStore = useLogStore();

   // 替换规则
   console.log → logStore.info
   console.warn → logStore.warn
   console.error → logStore.error
   console.debug → logStore.debug（仅开发时）
   ```

3. **分类选择**：
   - 用户操作（点击、输入）→ `'user'`
   - 事件触发 → `'event'`
   - IPC 通信 → `'ipc'`
   - 窗口管理 → `'window'`
   - 系统初始化 → `'system'`

4. **测试验证**：
   每批次完成后，运行 `pnpm dev` 检查：
   - 应用启动正常
   - 功能运行正常
   - 日志可在 LogViewer 中查看

---

## 🎯 进度跟踪

- [x] 创建清理清单（本文档）
- [ ] P0 批次完成（0/4）
- [ ] P1 Stores 批次完成（0/12）
- [ ] P1 Components 批次完成（0/9）
- [ ] P1 其他批次完成（0/剩余）
- [ ] ESLint 规则：禁止生产代码使用 console

---

## 🔗 相关文档

- 日志系统实现：`src/renderer/src/stores/log.ts`
- 日志查看器：`src/renderer/src/components/LogViewer.vue`
- 日志查看页面：`src/renderer/src/views/LogViewer.vue`
