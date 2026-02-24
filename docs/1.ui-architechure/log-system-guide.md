# 日志系统使用指南

## 概述

日志系统提供了统一的事件日志收集和可视化功能，帮助开发者调试和监控应用运行状态。

## 组件

### 1. Log Store (`src/renderer/src/stores/log.ts`)

Pinia store，负责日志的收集、存储和管理。

#### 核心功能

- **日志收集**：自动收集所有 EventBus 事件
- **日志分类**：支持多种日志级别和分类
- **日志过滤**：按级别、分类、关键词过滤
- **日志导出**：导出为 JSON 或文本格式
- **容量管理**：自动限制最大日志数量（默认 1000 条）

#### 日志级别

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

#### 日志分类

```typescript
type LogCategory = 'event' | 'ipc' | 'window' | 'tab' | 'app' | 'system' | 'user';
```

#### 使用方法

```typescript
import { useLogStore } from '@/stores/log';

const logStore = useLogStore();

// 添加不同级别的日志
logStore.debug('system', '调试信息', { data: 'value' });
logStore.info('user', '用户操作', { action: 'click' });
logStore.warn('window', '警告信息', { reason: 'low memory' });
logStore.error('app', '错误信息', { error: 'connection failed' });

// 过滤日志
logStore.setLevelFilter('error'); // 只显示错误日志
logStore.setCategoryFilter('tab'); // 只显示 Tab 相关日志
logStore.setSearchText('创建'); // 搜索包含"创建"的日志

// 重置过滤器
logStore.resetFilters();

// 清除日志
logStore.clearLogs(); // 清除所有日志
logStore.clearByLevel('debug'); // 清除指定级别
logStore.clearByCategory('system'); // 清除指定分类

// 导出日志
const jsonLogs = logStore.exportLogs(); // JSON 格式
const textLogs = logStore.exportLogsAsText(); // 文本格式
```

### 2. Log Viewer 组件 (`src/renderer/src/components/LogViewer.vue`)

可视化日志查看器，提供友好的用户界面。

#### 功能特性

- **浮动按钮**：右下角显示，点击展开日志面板
- **日志徽章**：显示当前日志总数
- **多级过滤**：
  - 按级别过滤（All / Debug / Info / Warn / Error）
  - 按分类过滤（All / Event / IPC / Window / Tab / App / System / User）
  - 搜索关键词
- **日志详情**：点击日志可展开查看完整数据
- **快捷操作**：
  - 重置过滤器
  - 复制单条日志
  - 复制所有日志
  - 下载日志文件
  - 清除所有日志

#### 使用方法

在 `App.vue` 中添加组件：

```vue
<template>
  <div>
    <!-- 你的应用内容 -->

    <!-- 日志查看器 -->
    <LogViewer />
  </div>
</template>

<script setup lang="ts">
import LogViewer from './components/LogViewer.vue';
</script>
```

### 3. 事件处理器集成

所有事件处理器已自动集成日志记录功能。

#### Tab 事件（`tabEventsHandle.ts`）

```typescript
// 自动记录所有 Tab 事件
- Tab 创建
- Tab 关闭
- Tab 激活
- Tab 更新
- Tabs 重新排序
- Tab 移动到另一个窗口
- Tab 复制
- Tab 刷新
```

#### Window 事件（`windowEventsHandle.ts`）

```typescript
// 自动记录所有 Window 事件
-窗口创建 -
  窗口准备就绪 -
  窗口显示 / 隐藏 -
  窗口关闭 -
  窗口聚焦 / 失焦 -
  窗口最小化 / 最大化 / 恢复 -
  窗口全屏进入 / 退出 -
  窗口大小变化;
```

#### App 事件（`appEventsHandle.ts`）

```typescript
// 自动记录所有 App 事件
-应用激活 - 应用获得焦点 - 应用即将退出(warn) - 第二个实例启动 - 子进程崩溃(error);
```

## 自定义日志

### 在业务代码中添加日志

```typescript
import { useLogStore } from '@/stores/log';

function handleUserAction() {
  const logStore = useLogStore();

  try {
    // 你的业务逻辑
    logStore.info('user', '用户完成操作', {
      action: 'submit',
      timestamp: Date.now()
    });
  } catch (error) {
    logStore.error('user', '操作失败', {
      action: 'submit',
      error: String(error)
    });
  }
}
```

### 在新的事件处理器中集成

```typescript
import { useLogStore } from '@/stores/log';

function logEvent(message: string, data?: unknown): void {
  const logStore = useLogStore();
  logStore.info('your-category', message, data);
}

function handleYourEvent(payload: any): void {
  logEvent('你的事件描述', payload);
  // 处理事件...
}
```

## 配置选项

### 修改最大日志数量

```typescript
const logStore = useLogStore();
logStore.maxLogs = 2000; // 默认 1000
```

### 启用/禁用日志收集

```typescript
const logStore = useLogStore();
logStore.isEnabled = false; // 禁用日志收集
logStore.isEnabled = true; // 启用日志收集
```

## 最佳实践

### 1. 合理使用日志级别

- **debug**：详细的调试信息，生产环境应关闭
- **info**：一般信息，正常的业务流程
- **warn**：警告信息，需要注意但不影响运行
- **error**：错误信息，需要立即处理

### 2. 提供有意义的日志消息

```typescript
// ❌ 不好的日志
logStore.info('event', '事件触发');

// ✅ 好的日志
logStore.info('tab', 'Tab 创建成功', {
  tabId: 123,
  windowId: 456,
  url: 'https://example.com'
});
```

### 3. 合理使用分类

根据日志来源选择合适的分类，方便后续过滤和查找：

- `event`：EventBus 内部事件
- `ipc`：IPC 通信相关
- `window`：窗口操作
- `tab`：Tab 操作
- `app`：应用生命周期
- `system`：系统级操作
- `user`：用户交互

### 4. 定期清理日志

在开发环境中，日志会快速积累。建议：

- 使用过滤器只查看关注的日志
- 定期点击"清除"按钮
- 或在代码中定期清理：

```typescript
// 每小时清理一次
setInterval(() => {
  const logStore = useLogStore();
  logStore.clearLogs();
}, 3600000);
```

## 故障排查

### 日志不显示

1. 检查 `LogViewer` 组件是否添加到页面
2. 检查 `logStore.isEnabled` 是否为 `true`
3. 检查过滤器设置，可能过滤掉了日志

### 日志查看器性能问题

如果日志数量过多导致性能问题：

1. 减小 `maxLogs` 值
2. 使用过滤器减少显示的日志数量
3. 定期清理不需要的日志

## 示例

### 完整的使用示例

```typescript
import { useLogStore } from '@/stores/log';

export function setupMonitoring() {
  const logStore = useLogStore();

  // 记录应用启动
  logStore.info('app', '应用启动', {
    version: '1.0.0',
    platform: process.platform
  });

  // 监听错误
  window.addEventListener('error', (event) => {
    logStore.error('system', '全局错误', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  // 监听未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    logStore.error('system', '未处理的 Promise 拒绝', {
      reason: String(event.reason)
    });
  });
}
```

## 总结

日志系统提供了强大而灵活的日志管理能力：

1. ✅ **自动收集**：所有 EventBus 事件自动记录
2. ✅ **可视化查看**：友好的 UI 界面
3. ✅ **强大过滤**：多维度过滤和搜索
4. ✅ **导出功能**：支持 JSON 和文本格式
5. ✅ **易于扩展**：简单集成到任何模块

通过合理使用日志系统，可以大大提升开发和调试效率！
