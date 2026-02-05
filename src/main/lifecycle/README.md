# Lifecycle Hooks

此目录存放应用生命周期 Hook，用于在应用启动、运行和退出的不同阶段执行特定逻辑。

## 📁 目录结构

```
src/main/lifecycle/
├── IpcRegistrationHook.ts    # IPC 处理器注册
├── WindowBootstrapHook.ts    # 主窗口创建
└── README.md                  # 说明文档
```

## 🔄 生命周期阶段

应用有三个主要的生命周期阶段：

### 1. **INIT** - 初始化阶段

- **触发时机**：应用启动时，在 `app.whenReady()` 之前
- **用途**：数据库初始化、配置加载等不依赖 Electron API 的操作
- **示例**：数据库连接、日志系统初始化

### 2. **READY** - 就绪阶段

- **触发时机**：`app.whenReady()` 完成后
- **用途**：需要 Electron API 的操作（IPC 注册、窗口创建等）
- **示例**：IPC 处理器注册、主窗口创建

### 3. **BEFORE_QUIT** - 退出前阶段

- **触发时机**：应用退出前
- **用途**：资源清理、数据保存
- **示例**：关闭数据库连接、保存用户数据

## 📝 Hook 结构

每个 Hook 必须遵循以下结构：

```typescript
import { LifecyclePhase, LifecycleContext } from '@main/common/types'
import { log } from '@main/common/logger'

export const YourHookNameHook = {
  // Hook 名称（用于日志）
  name: 'your-hook-name',

  // 生命周期阶段
  phase: LifecyclePhase.READY,

  // 优先级（数字越小越先执行）
  priority: 50,

  // 是否关键（失败时是否中断启动）
  critical: true,

  // 执行函数
  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[YourHookNameHook] Starting...')

    // 你的逻辑

    log.info('[YourHookNameHook] Completed')
  }
}
```

## 🎯 命名规范

**重要**：导出的变量名必须以 `Hook` 结尾，才能被自动扫描系统识别！

✅ **正确示例**：

```typescript
export const IpcRegistrationHook = { ... }
export const WindowBootstrapHook = { ... }
export const DatabaseInitHook = { ... }
```

❌ **错误示例**：

```typescript
export const ipcRegistration = { ... }      // 缺少 Hook 后缀
export const windowBootstrap = { ... }      // 缺少 Hook 后缀
export default { name: '...' }              // 不能使用 default export
```

## 🔢 优先级设置

优先级决定 Hook 的执行顺序，数字越小越先执行：

### READY 阶段推荐优先级：

- **0-49**: 基础设施（日志、配置等）
- **50-99**: IPC 注册、中间件、服务
  - `50`: IPC 处理器注册 ✅
- **100-199**: UI 相关（窗口、菜单等）
  - `100`: 主窗口创建 ✅
- **200+**: 可选功能、插件等

### 当前已注册的 Hook：

| Hook                  | 阶段  | 优先级 | 关键 | 说明                |
| --------------------- | ----- | ------ | ---- | ------------------- |
| `IpcRegistrationHook` | READY | 50     | ✅   | 注册所有 IPC 处理器 |
| `WindowBootstrapHook` | READY | 100    | ✅   | 创建主窗口          |

## 🔄 自动扫描机制

`LifecycleManager` 会自动扫描 `src/main/lifecycle/**/*Hook.ts` 文件并注册所有符合规范的 Hook：

1. **扫描阶段**：应用启动时自动扫描此目录
2. **注册阶段**：找到所有以 `Hook` 结尾的导出变量
3. **排序阶段**：按优先级和阶段排序
4. **执行阶段**：在相应生命周期阶段执行

### 扫描规则：

- ✅ 文件名以 `Hook.ts` 结尾
- ✅ 导出变量名以 `Hook` 结尾
- ✅ 符合 `LifecycleHook` 接口定义
- ✅ 可以一个文件导出多个 Hook

## ✅ Hook 最佳实践

### 1. **保持单一职责**

每个 Hook 只做一件事：

```typescript
// ✅ 好的例子
export const IpcRegistrationHook = { ... }  // 只注册 IPC
export const WindowBootstrapHook = { ... }  // 只创建窗口

// ❌ 不好的例子
export const InitEverythingHook = {
  // 做太多事情：IPC、窗口、数据库...
}
```

### 2. **使用动态导入避免循环依赖**

```typescript
async execute(_context: LifecycleContext): Promise<void> {
  // ✅ 使用动态 import
  const { windowManager } = await import('@main/common/window')

  // ❌ 不要在顶层导入
  // import { windowManager } from '@main/common/window'
}
```

### 3. **正确设置关键标志**

```typescript
// ✅ 关键 Hook（失败时应该中断启动）
export const DatabaseInitHook = {
  critical: true // 数据库初始化失败，应用不能运行
}

// ✅ 非关键 Hook（失败时继续运行）
export const AnalyticsHook = {
  critical: false // 分析服务失败，应用仍可运行
}
```

### 4. **添加详细日志**

```typescript
async execute(_context: LifecycleContext): Promise<void> {
  log.info('[YourHook] Starting...')

  try {
    // 逻辑
    log.info('[YourHook] Completed successfully')
  } catch (error) {
    log.error('[YourHook] Failed:', error)
    throw error
  }
}
```

## 📦 添加新 Hook

### 步骤 1：创建 Hook 文件

```typescript
// src/main/lifecycle/YourFeatureHook.ts
import { LifecyclePhase, LifecycleContext } from '@main/common/types'
import { log } from '@main/common/logger'

export const YourFeatureHook = {
  name: 'your-feature',
  phase: LifecyclePhase.READY,
  priority: 150, // 根据需要设置优先级
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[YourFeatureHook] Initializing...')

    // 实现你的逻辑

    log.info('[YourFeatureHook] Initialized')
  }
}
```

### 步骤 2：无需手动注册！

Hook 会被 `LifecycleManager` 自动扫描和注册，无需修改其他文件。

### 步骤 3：验证

启动应用，查看日志确认 Hook 被注册和执行：

```
[LifecycleManager] 自动注册 Hook: YourFeatureHook (来自 src/main/lifecycle/YourFeatureHook.ts)
[LifecycleManager] 执行 Hook: your-feature (优先级: 150, 关键: false)
[YourFeatureHook] Initialized
```

## 🔍 调试 Hook

### 查看已注册的 Hook

在应用启动日志中查找：

```
[LifecycleManager] Hook 自动扫描完成，共注册 2 个 Hook
[LifecycleManager] 执行阶段: ready (2 个 Hook)
[LifecycleManager] 执行优先级组: 50 (1 个 Hook)
[LifecycleManager] 执行 Hook: ipc-registration
[LifecycleManager] 执行优先级组: 100 (1 个 Hook)
[LifecycleManager] 执行 Hook: window-bootstrap
```

### Hook 执行顺序

同优先级的 Hook **并行执行**，不同优先级按顺序执行：

```
Priority 50:  [Hook A] [Hook B]  ← 并行执行
              ↓
Priority 100: [Hook C] [Hook D]  ← 并行执行
```

## 🎯 实际示例

### 示例 1：数据库初始化 Hook

```typescript
// src/main/lifecycle/DatabaseInitHook.ts
export const DatabaseInitHook = {
  name: 'database-init',
  phase: LifecyclePhase.INIT, // INIT 阶段
  priority: 10, // 高优先级
  critical: true, // 关键服务

  async execute(_context: LifecycleContext): Promise<void> {
    const { initDatabase } = await import('@main/common/database')
    await initDatabase()
  }
}
```

### 示例 2：插件加载 Hook

```typescript
// src/main/lifecycle/PluginLoaderHook.ts
export const PluginLoaderHook = {
  name: 'plugin-loader',
  phase: LifecyclePhase.READY,
  priority: 200, // 低优先级（在窗口创建后）
  critical: false, // 非关键

  async execute(_context: LifecycleContext): Promise<void> {
    const { loadPlugins } = await import('@main/plugins')
    await loadPlugins()
  }
}
```

## 📚 相关文档

- [LifecycleManager 实现](../common/lifecycle.ts)
- [生命周期类型定义](../common/types.ts)
- [应用管理器](../common/app/index.ts)
