# Extension 开发指南

## 📋 核心原则

**Extension 禁止直接 import `src/main/` 模块，统一通过 ExtensionApi 依赖注入获取所有能力。**

### ✅ 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        ExtensionApi                             │
│               （Extension 与主进程的唯一边界）                   │
│                                                                  │
│  api.services.agent.getExecutor()        ← AgentExecutor       │
│  api.services.agent.getStore()           ← AgentStore          │
│  api.services.agent.getTools()           ← Tools               │
│  api.services.thread.getStore()          ← ThreadStore         │
│  api.services.channel.getRuntime()       ← ChannelRuntime      │
│  api.services.discussion.getStore()      ← DiscussionStore     │
│  api.services.paths.getWorkspace()       ← Env.paths.*         │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
                           ↑ 唯一入口
                           │
┌─────────────────────────────────────────────────────────────────┐
│                      Extension 代码                              │
│               ❌ 禁止：import '../../src/main/*'                │
│               ✅ 使用：api.services.xxx()                        │
└─────────────────────────────────────────────────────────────────┘
```

**优势**：

1. ✅ **统一入口** - 所有能力通过 api.services.xxx() 提供
2. ✅ **彻底解耦** - Extension 完全不依赖 src/main/ 模块
3. ✅ **可控安全** - 主进程控制暴露哪些能力
4. ✅ **避免 jiti 问题** - 一次性解决所有嵌套导入错误
5. ✅ **便于测试** - ExtensionApi 可以完整 mock

---

## 🚨 已废弃：Extension 中的其他导入方式

### ❌ 错误示例（已废弃）

```typescript
// ❌ 错误：任何形式的直接导入 src/main/ 模块都已废弃
import { Env } from '@main/common/env'; // ❌ 顶层静态导入
import { SomeClass } from '../../src/main/ai/SomeClass'; // ❌ 相对路径导入

export default {
  register(api: ExtensionApi) {
    api.eventBus.on('event', async () => {
      const { AgentStore } = await import('@main/ai/agents/AgentStore'); // ❌ 动态导入
    });
  }
};
```

### ✅ 正确示例（统一依赖注入）

**所有能力统一通过 api.services.xxx() 获取**：

```typescript
export default {
  id: 'my-extension',
  name: 'My Extension',

  register(api: ExtensionApi) {
    // ✅ 保存 api 引用供辅助函数使用
    let apiRef = api;

    api.eventBus.on('some-event', async (payload) => {
      // ✅ 获取 Agent 相关能力
      const agentExecutor = await api.services.agent.getExecutor();
      const agentStore = await api.services.agent.getStore();
      const toolRegistry = await api.services.agent.getToolRegistry();
      const skillManager = await api.services.agent.getSkillManager();
      const builtinTools = await api.services.agent.getBuiltinTools();

      // ✅ 获取 Thread 能力
      const threadStore = await api.services.thread.getStore();

      // ✅ 获取路径
      const workspace = await api.services.paths.getWorkspace(sessionId);
      const agentHome = await api.services.paths.getAgentHome(agentId);
      const userHome = await api.services.paths.getUserHome();
      const configDir = await api.services.paths.getConfigDir();
      const secretsDir = await api.services.paths.getSecretsDir();
      const workspacesDir = await api.services.paths.getWorkspacesDir();

      // ✅ 获取 Discussion 能力
      const discussionStore = await api.services.discussion.getStore();
      const consensusDetector = await api.services.discussion.createConsensusDetector();

      // ✅ 获取 Channel 能力
      const channelRuntime = await api.services.channel.getRuntime();

      // ✅ 获取类型定义
      const StreamEventType = await api.services.types.getStreamEventType();

      // 使用这些能力...
    });

    api.registerChannel({
      id: 'my-channel',
      inbound: {
        handleMessage: async (msg) => {
          // ✅ 同样通过 api.services.xxx() 获取
          const runtime = await api.services.channel.getRuntime();
        }
      }
    });
  }
};
```

---

## 🎯 为什么采用统一依赖注入？

### 问题背景

早期架构中，Extension 可以通过多种方式访问 `src/main/` 模块：

- 静态导入（顶层 import）
- 动态导入（await import）
- 路径缓存（在 start() 中获取）
- EventBus 回调（主进程上下文）

这导致：

1. ❌ **开发者困惑** - 不知道该用哪种方式
2. ❌ **反复踩坑** - 忘记判断，直接动态导入就出错（app undefined）
3. ❌ **维护困难** - 4种模式并存，难以统一管理

### 根本原因

Extension 通过 `jiti` 加载，某些导入方式会触发 **嵌套 jiti 上下文**，导致 `electron` 模块的 `app` 对象为 `undefined`：

1. `logger.ts` 在模块顶层访问 `Env.paths.logPath`（第 8 行）
2. 任何在顶层调用 `createLogger()` 的模块（如 ConsensusDetector, AgentStore, ThreadStore）都会立即触发 Env 访问
3. Extension 方法（如 ChannelPlugin.handleMessage）中的 `await import()` **保留 jiti 上下文**
4. 嵌套 jiti 导入时，`electron` 模块的 `app` 对象是 `undefined`

### 统一依赖注入的优势

✅ **统一入口** - ExtensionApi 成为唯一边界，所有能力通过 `api.services.xxx()` 提供  
✅ **彻底解耦** - Extension 完全不依赖 src/main/ 模块  
✅ **可控安全** - 主进程控制暴露哪些能力，可加权限校验  
✅ **避免踩坑** - 一劳永逸解决 jiti 嵌套导入问题  
✅ **便于测试** - ExtensionApi 可以完整 mock

### 调用栈示例

```
at async import (jiti.cjs:1:158301)          ← 第二层 jiti（导入 logger.ts）
at async ConsensusDetector.ts:7:15          ← ConsensusDetector 顶层 import logger
at async import (jiti.cjs:1:158301)          ← 第一层 jiti（导入 ConsensusDetector）
at async Object.handleMessage (DiscussionChannel.ts:132:41)  ← Extension 方法
at async DiscussionRoom.start (index.js:34785:5)  ← 主进程调用
at async HTTP handler (Koa)                  ← HTTP 请求
```

---

## 📚 历史案例

| Commit  | 场景                                            | 解决方案                        |
| ------- | ----------------------------------------------- | ------------------------------- |
| b73eb08 | jiti 无法解析 @main/\* 别名                     | 使用相对路径 `../../src/main/*` |
| b7cb697 | WorkspaceFileWatcher 运行时访问 Env.paths       | 在 start() 缓存 workspacesDir   |
| 8df5db9 | DiscussionChannel 动态导入 ChannelRuntime/Store | ExtensionApi 依赖注入           |
| 3f20449 | DiscussionChannel 动态导入 ConsensusDetector    | 改为静态导入                    |

---

## 🛡️ 开发规范

### 必须遵守

1. ✅ **禁止直接 import `src/main/` 模块**（任何形式）
2. ✅ **统一使用 `api.services.xxx()`** 获取所有能力
3. ✅ **保存 api 引用**（供辅助函数使用）

### 推荐模式

```typescript
// 模块级保存 api 引用
let apiRef: ExtensionApi | null = null;

export default {
  register(api: ExtensionApi) {
    // 1. 保存 api 引用
    apiRef = api;

    // 2. 所有能力通过 api.services.xxx() 获取
    api.eventBus.on('event', async () => {
      if (!apiRef) return;

      const executor = await apiRef.services.agent.getExecutor();
      const store = await apiRef.services.agent.getStore();
      const workspace = await apiRef.services.paths.getWorkspace(sessionId);
    });
  }
};
```

---

## 🔍 检查清单

开发 Extension 时：

- [ ] 是否有任何 `import ... from '../../src/main/*'` 或 `import ... from '@main/*'`？
- [ ] 是否有任何 `await import('../../src/main/*')` 或 `await import('@main/*')`？
- [ ] 是否所有能力都通过 `api.services.xxx()` 获取？
- [ ] 是否在 register() 中保存了 api 引用？
- [ ] 是否在辅助函数中检查了 `apiRef` 是否可用？

---

## 📖 参考

- Extension API 定义: `src/main/common/extension/types.ts`
- Extension API 实现: `src/main/common/extension/ExtensionApi.ts`
- Extension 加载: `src/main/common/extension/ExtensionLoader.ts`
- 依赖注入示例: `extensions/discussion-channel/DiscussionChannel.ts`
- 依赖注入示例: `extensions/shared-drive-task-router/index.ts`
- 依赖注入示例: `extensions/memory-thread/index.ts`
