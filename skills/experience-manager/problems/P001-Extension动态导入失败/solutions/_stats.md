# 方案统计

## 总览

| 方案                | 应用次数 | 成功率 | 优先级 | 适用场景         |
| ------------------- | -------- | ------ | ------ | ---------------- |
| S001: 静态导入      | 1        | 100%   | ⭐⭐⭐ | 简单类、工具函数 |
| S002: 依赖注入      | 1        | 100%   | ⭐⭐⭐ | 复杂单例对象     |
| S003: 路径缓存      | 1        | 100%   | ⭐⭐   | 只需路径         |
| S004: EventBus 回调 | 2+       | 100%   | ⭐     | 事件驱动场景     |

---

## 推荐决策树

```
需要在 Extension 中使用 src/main/ 模块？
  ├─ 是事件驱动场景？
  │   └─ YES → S004: EventBus 回调
  │
  ├─ 只需要路径/配置？
  │   └─ YES → S003: 路径缓存（在 start() 阶段）
  │
  ├─ 是简单类/工具函数？
  │   └─ YES → S001: 静态导入
  │
  └─ 是复杂单例对象（Store/Manager）？
      └─ YES → S002: 依赖注入（ExtensionApi）
```

---

## 历史应用

### S001: 静态导入

- **3f20449**: ConsensusDetector 改为静态导入

### S002: 依赖注入

- **8df5db9**: DiscussionChannel 使用依赖注入获取 ChannelRuntime 和 DiscussionStore

### S003: 路径缓存

- **b7cb697**: WorkspaceFileWatcher 在 start() 缓存 workspacesDir

### S004: EventBus 回调

- **memory-auto**: 在 EventBus 回调中动态导入 Env
- **shared-drive-task-router**: 在 EventBus 回调中动态导入 AgentStore / ThreadStore / AgentExecutor

---

## 注意事项

### 所有方案共同遵守

1. ✅ 使用相对路径 `../../src/main/*`（jiti 不支持 @main/\* 别名）
2. ✅ 检查目标模块是否在顶层调用 `createLogger()`
3. ✅ 优先使用 ExtensionApi 提供的依赖（`api.logger`, `api.eventBus`）

### 避免的反模式

❌ **在 Extension 方法中动态导入顶层调用 logger 的模块**

```typescript
// ❌ 错误
api.registerChannel({
  inbound: {
    handleMessage: async (msg) => {
      const { SomeClass } = await import('../../src/main/ai/SomeClass');
      // 如果 SomeClass 顶层有 const log = createLogger()，会失败
    }
  }
});
```
