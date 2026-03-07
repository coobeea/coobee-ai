# P001: Extension 方法中动态导入导致 app.getAppPath() undefined 错误

> 问题编号：P001  
> 涉及skill：extension-creator  
> 问题类别：模块加载 / jiti 上下文  
> 难度：中等  
> 标签：#jiti #Extension #logger #动态导入 #app-undefined  
> 历史出现：4次（b73eb08, b7cb697, 8df5db9, 3f20449）

---

## 一、问题描述

### 业务场景

开发 Extension 扩展时，在 ChannelPlugin 的 `handleMessage()` 方法或其他运行时方法中，使用 `await import()` 动态导入 `src/main/` 目录下的模块。

### 核心困惑

为什么同样的动态导入，在 EventBus 回调中成功，在 ChannelPlugin 方法中就失败？

### 错误表现

```
TypeError: Cannot read properties of undefined (reading 'getAppPath')
    at EnvClass._computePaths (env.ts:123:38)
    at get paths (env.ts:84:26)
    at logger.ts:8:31
    at async import (jiti.cjs:1:158301)  ← 第二层 jiti
    at async ConsensusDetector.ts:7:15
    at async import (jiti.cjs:1:158301)  ← 第一层 jiti
    at async Object.handleMessage (DiscussionChannel.ts:132:41)
```

---

## 二、解决思路（概要）

**问题根源**：Extension 通过 `jiti` 加载，Extension 方法中的 `await import()` 保留 jiti 上下文，形成嵌套 jiti 调用。当导入的模块在顶层调用 `createLogger()` 时，会触发 `logger.ts` 顶层访问 `Env.paths.logPath`，最终在嵌套 jiti 上下文中访问 `app` 对象失败（`app` 为 `undefined`）。

**解决思路**：

1. ✅ **避免嵌套 jiti** - 改为静态导入或依赖注入
2. ✅ **延迟初始化** - 不在模块顶层访问 Env
3. ✅ **路径缓存** - 在安全时机（如 start()）缓存路径
4. ✅ **使用 EventBus** - 让回调在主进程上下文中执行

**方案对比**：

| 方案           | 优点                   | 缺点                       | 适用场景         |
| -------------- | ---------------------- | -------------------------- | ---------------- |
| S001: 静态导入 | 简单直接，无运行时开销 | 增加 Extension bundle 大小 | 简单类、工具函数 |
| S002: 依赖注入 | 解耦，符合 DI 模式     | 需要修改 ExtensionApi      | 复杂单例对象     |
| S003: 路径缓存 | 轻量，只缓存必要信息   | 需要管理缓存生命周期       | 只需要路径/配置  |
| S004: EventBus | 天然脱离 jiti 上下文   | 架构限制，不适用所有场景   | 事件驱动场景     |

---

## 三、相关信息

### 涉及文件

- `src/main/common/logger.ts` - 顶层访问 `Env.paths.logPath`（第 8 行）
- `src/main/common/env.ts` - 调用 `app.getAppPath()`（第 123 行）
- `src/main/common/extension/ExtensionLoader.ts` - jiti 加载 Extension
- `extensions/discussion-channel/DiscussionChannel.ts` - 触发错误的场景

### 典型失败案例

1. **ConsensusDetector**（3f20449）- Extension 的 handleMessage 中动态导入
2. **ChannelRuntime/DiscussionStore**（8df5db9）- 改用依赖注入
3. **WorkspaceFileWatcher 访问 Env.paths**（b7cb697）- 改用路径缓存

### 成功案例（对比）

- `memory-auto` - 在 EventBus 回调中动态导入 Env（✅ 成功）
- `shared-drive-task-router` - 在 EventBus 回调中动态导入 AgentStore（✅ 成功）
- `src/main/gateway/http/files.ts` - 主进程代码静态导入（✅ 成功）

---

## 四、解决方案链接

- [S001: 静态导入](./solutions/S001-静态导入.md) ⭐ 推荐（简单类）
- [S002: 依赖注入](./solutions/S002-依赖注入.md) ⭐ 推荐（复杂对象）
- [S003: 路径缓存](./solutions/S003-路径缓存.md)
- [S004: EventBus 回调](./solutions/S004-EventBus回调.md)

---

## 五、预防措施

### 开发规范

1. ✅ **优先使用 ExtensionApi 提供的依赖**（`api.logger`, `api.eventBus`, `api.services.*`）
2. ✅ **Extension 方法中避免动态导入 `src/main/` 模块**
3. ✅ **使用相对路径而非 @main/\* 别名**
4. ✅ **需要路径时在 start() 阶段缓存**
5. ✅ **EventBus 回调可以安全地动态导入**

### 检查清单

开发 Extension 时：

- [ ] 是否在 ChannelPlugin/Service 方法中使用了 `await import()`？
- [ ] 动态导入的模块是否在顶层调用了 `createLogger()`？
- [ ] 是否可以改为静态导入或依赖注入？
- [ ] 是否使用相对路径导入？

---

## 六、参考文档

- [Extension Development Guide](../../../../docs/extension-development-guide.md)
- [Extension API](../../../src/main/common/extension/types.ts)
- [Extension Loader](../../../src/main/common/extension/ExtensionLoader.ts)
