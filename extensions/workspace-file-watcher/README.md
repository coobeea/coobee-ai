# Workspace File Watcher Extension

## 功能概述

监控 Agent 工作空间（`.home/workspaces/{threadId}/`）的文件变化，并实时推送通知到前端，让用户及时了解任务执行过程中的文件操作。

## 核心特性

### 1. 按需启动 + 自动续期

- **Lazy Load**：首次收到 `stream:message` 事件时才启动对应 `threadId` 的监控
- **智能续期**：每次收到该 `threadId` 的任何 stream 事件（chunk/tool/status 等）都会重置 60s keepalive 计时器
- **自动清理**：60s 内无新事件或任务结束（`stream:end` / `stream:error`）时自动停止监控

### 2. 批量推送 + 去抖

- **300ms 去抖**：文件变化后延迟 300ms 批量推送（避免频繁刷新）
- **批量合并**：300ms 内的多次文件变化合并为一次推送
- **相对路径**：推送的文件路径相对于 workspace 根目录

### 3. 多任务隔离

- 每个 `threadId` 独立的 `FSWatcher` 实例
- 任务间互不干扰，切换任务不会泄漏资源

## 技术实现

### 集成方式

通过 **Extension 机制** 集成，监听 EventBus 的 stream 事件：

- `stream:message` → 启动监控 / 续期
- `stream:end` → 停止监控（任务完成）
- `stream:error` → 停止监控（任务出错）

### 推送协议

推送到 EventBus 的 `workspace:file-changed` 事件，格式：

```typescript
{
  threadId: string;      // 任务 ID
  files: string[];       // 变化的文件相对路径列表
  timestamp: number;     // 时间戳
}
```

前端需要自行订阅该事件并处理（例如：刷新文件树、高亮变化文件等）。

### 监控策略

- **监控目录**：`.home/workspaces/{threadId}/`
- **忽略文件**：隐藏文件、`node_modules`、`.git`
- **防抖参数**：
  - `awaitWriteFinish`: 200ms 稳定期
  - `debounceMs`: 300ms 批量推送延迟
  - `keepaliveTimeout`: 60s 无事件自动停止

## 配置选项

可在初始化时传入 `WatcherOptions`：

```typescript
WorkspaceFileWatcher.getInstance({
  keepaliveTimeout: 60_000, // keepalive 超时（毫秒）
  debounceMs: 300 // 去抖延迟（毫秒）
});
```

## 使用场景

- 用户创建 Agent 任务 → 执行过程中生成文件 → 前端实时显示文件树变化
- 长时间运行任务（如代码生成、数据分析）→ 中间产物实时推送
- Copilot 模式文件编辑 → 用户实时看到修改结果

## 防泄漏保障

1. **keepalive 兜底**：60s 无事件自动停止（防止任务异常终止导致监控残留）
2. **任务完成清理**：`stream:end` / `stream:error` 显式停止
3. **跳过子 Agent**：只监控顶层任务（`sessionId` 不含 `:`）
4. **应用关闭清理**：Extension 卸载时调用 `stopAll()`

## 测试覆盖

- ✅ EventBus 监听器注册/移除
- ✅ 首次 `stream:message` 启动监控
- ✅ 跳过子 Agent sessionId
- ✅ `stream:end` / `stream:error` 停止监控
- ✅ 文件变化 → 去抖 → 批量推送
- ✅ 多任务独立监控
- ✅ `stopAll` 清理所有监控

## 未来改进

- [ ] 支持前端配置是否启用监控
- [ ] 支持过滤文件类型（只推送特定扩展名）
- [ ] 支持增量推送（add/change/unlink 分类）
- [ ] 支持监控目录深度限制
