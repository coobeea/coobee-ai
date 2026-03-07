# S004: EventBus 回调（天然脱离 jiti）

> 方案编号：S004  
> 优先级：⭐ 低（架构限制）  
> 验证状态：✅ 已验证  
> 应用次数：多次（memory-auto, shared-drive-task-router）  
> 成功率：100%

---

## 一、具体实现

### ✅ 安全示例

```typescript
// extensions/shared-drive-task-router/index.ts
export default {
  register(api: ExtensionApi) {
    // ✅ 正确：在 EventBus 回调中动态导入
    api.eventBus.on('shared-drive:entry-created', async (payload) => {
      // 这里的动态导入在主进程上下文中执行（脱离了 jiti）
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const { AgentStore } = await import('@main/ai/agents/AgentStore');
      const { ThreadStore } = await import('@main/ai/threads/ThreadStore');

      // 安全使用...
      const store = await AgentStore.getInstance();
    });
  }
};
```

### ❌ 错误示例（对比）

```typescript
// extensions/discussion-channel/DiscussionChannel.ts
export default {
  register(api: ExtensionApi) {
    api.registerChannel({
      inbound: {
        // ❌ 错误：在 ChannelPlugin 方法中动态导入（还在 jiti 上下文）
        handleMessage: async (msg) => {
          const { SomeClass } = await import('../../src/main/ai/SomeClass');
          // 失败：嵌套 jiti 调用
        }
      }
    });
  }
};
```

---

## 二、推导过程（为什么）

### 为什么 EventBus 回调安全？

**EventBus 事件由主进程代码触发，回调在主进程上下文中执行**：

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Extension (jiti) 注册 EventBus 监听                         │
│    → api.eventBus.on('event', handler)                         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. 主进程代码（Vite 编译）触发事件                             │
│    → eventBus.emit('event', payload) ← src/main/gateway/...   │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. handler 在主进程上下文中执行 ← ✅ 脱离了 jiti！             │
│    → await import('@main/ai/AgentStore') ← 成功                │
│    → AgentStore 顶层 createLogger() ← app 对象可用            │
└─────────────────────────────────────────────────────────────────┘
```

### 关键区别

| 场景                   | 调用路径                                 | 上下文    | 结果    |
| ---------------------- | ---------------------------------------- | --------- | ------- |
| **EventBus 回调**      | 主进程 emit → Extension handler          | 主进程    | ✅ 成功 |
| **ChannelPlugin 方法** | 主进程 → Extension method → await import | jiti 嵌套 | ❌ 失败 |

### 权衡取舍

**优点**：

- ✅ 天然脱离 jiti 上下文（无需特殊处理）
- ✅ 支持按需加载
- ✅ 无需修改 ExtensionApi
- ✅ 适合事件驱动架构

**缺点**：

- ⚠️ 仅适用于事件驱动场景
- ⚠️ 不适用于 HTTP 请求、定时任务等
- ⚠️ 需要设计合适的事件机制

**适用范围**：

- ✅ 事件驱动场景（shared-drive:entry-created, session:start）
- ✅ 后台任务（定时触发事件）
- ❌ HTTP 请求处理（用 S001 或 S002）
- ❌ ChannelPlugin 方法（用 S001 或 S002）

---

## 三、相关案例

### 成功案例

- **memory-auto**: 在 EventBus 回调中动态导入 Env（✅ 成功）
- **shared-drive-task-router**: 在 EventBus 回调中动态导入 AgentStore / ThreadStore（✅ 成功）

### 代码位置

- `extensions/memory-auto/index.ts` - getWorkspace() / getAgentHome()
- `extensions/shared-drive-task-router/index.ts` - dispatchToAnalyzer()

---

## 四、注意事项

1. ✅ 确认事件由主进程代码 emit（`src/main/` 目录）
2. ✅ 避免在 Extension 内部 emit 事件再监听自己（可能还在 jiti 上下文）
3. ✅ 考虑使用 setTimeout() 延迟执行（给主进程时间稳定上下文）
