# Extension 开发指南

## 📋 核心原则

Extension 通过 `jiti` 动态加载，必须遵循以下规范以避免模块加载失败。

---

## 🚨 禁止：Extension 方法中动态导入顶层调用 logger 的模块

### ❌ 错误示例

```typescript
// extensions/my-extension/index.ts
export default {
  register(api: ExtensionApi) {
    api.registerChannel({
      id: 'my-channel',
      inbound: {
        handleMessage: async (msg) => {
          // ❌ 错误：运行时动态导入顶层调用 logger 的模块
          const { SomeClass } = await import('../../src/main/ai/SomeClass');
          // 如果 SomeClass.ts 顶层有 const log = createLogger()，会导致：
          // TypeError: Cannot read properties of undefined (reading 'getAppPath')
        }
      }
    });
  }
};
```

### ✅ 正确示例

**方案 A：静态导入（推荐，适用于简单类）**

```typescript
// extensions/my-extension/DiscussionChannel.ts
import { SomeClass } from '../../src/main/ai/SomeClass'; // ← 静态导入

export function createDiscussionChannel(extensionApi: ExtensionApi) {
  return {
    id: 'my-channel',
    inbound: {
      handleMessage: async (msg) => {
        const instance = new SomeClass(); // ← 直接使用
      }
    }
  };
}
```

**方案 B：依赖注入（推荐，适用于复杂对象）**

```typescript
// 1. 在 src/main/common/extension/types.ts 添加方法定义
export interface ExtensionApi {
  getSomeClass(): Promise<SomeClass>;
}

// 2. 在 src/main/common/extension/ExtensionApi.ts 实现
async getSomeClass() {
  const { SomeClass } = await import('../../ai/SomeClass');
  return SomeClass.getInstance();
}

// 3. Extension 中使用
export default {
  register(api: ExtensionApi) {
    api.registerChannel({
      inbound: {
        handleMessage: async (msg) => {
          const instance = await api.getSomeClass(); // ← 依赖注入
        }
      }
    });
  }
};
```

**方案 C：路径缓存（适用于只需路径的场景）**

```typescript
export class MyExtension {
  private workspacesDir: string | null = null;

  async start(api: ExtensionApi) {
    // 在 start() 阶段缓存路径
    try {
      const { Env } = await import('../../src/main/common/env');
      this.workspacesDir = Env.paths.workspacesDir;
    } catch {
      this.workspacesDir = null;
    }
  }

  async handleMessage(msg: Message) {
    if (!this.workspacesDir) return;
    const filePath = path.join(this.workspacesDir, 'some-file');
    // 使用缓存的路径
  }
}
```

---

## ✅ 允许：EventBus 回调中动态导入

EventBus 回调在**主进程上下文**中执行（脱离了 jiti），可以安全地动态导入：

```typescript
export default {
  register(api: ExtensionApi) {
    // ✅ 正确：EventBus 回调中动态导入
    api.eventBus.on('some-event', async (payload) => {
      const { AgentStore } = await import('@main/ai/agents/AgentStore');
      const store = await AgentStore.getInstance();
      // 安全，回调在主进程上下文中执行
    });
  }
};
```

---

## 🎯 根本原因

### 问题链条

1. `logger.ts` 在模块顶层访问 `Env.paths.logPath`（第 8 行）
2. 任何在顶层调用 `createLogger()` 的模块（如 ConsensusDetector, AgentStore, ThreadStore）都会立即触发 Env 访问
3. Extension 方法（如 ChannelPlugin.handleMessage）中的 `await import()` **保留 jiti 上下文**
4. 嵌套 jiti 导入时，`electron` 模块的 `app` 对象是 `undefined`

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

## 🛡️ 预防措施

1. **Extension 方法中禁止动态导入 `src/main/` 模块**（除非确认目标模块顶层不调用 logger）
2. **优先使用 ExtensionApi 提供的依赖**（如 `api.logger`, `api.eventBus`, `api.services.*`）
3. **使用相对路径导入**（`../../src/main/*` 而非 `@main/*`）
4. **需要路径时在 start() 阶段缓存**
5. **EventBus 回调可以安全地动态导入**

---

## 🔍 检查清单

开发 Extension 时，检查以下项：

- [ ] 是否在 ChannelPlugin 方法中使用了 `await import()`？
- [ ] 动态导入的模块是否在顶层调用了 `createLogger()`？
- [ ] 是否可以改为静态导入或依赖注入？
- [ ] 是否只需要路径？考虑在 start() 缓存
- [ ] 是否使用相对路径而非 @main/\* 别名？

---

## 📖 参考

- Extension API: `src/main/common/extension/types.ts`
- Extension 加载: `src/main/common/extension/ExtensionLoader.ts`
- 依赖注入示例: `extensions/discussion-channel/DiscussionChannel.ts`
- 路径缓存示例: `extensions/workspace-file-watcher/WorkspaceFileWatcher.ts`
