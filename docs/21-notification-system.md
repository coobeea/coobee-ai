# 通知系统（Notification System）

## 📋 概述

coobee-ai 提供了完整的通知系统，支持 Agent 和后台任务向前端发送实时通知。

通知系统由以下部分组成：

1. **emit_event 工具** - Agent 可以在执行过程中发送通知
2. **AgentEventBridge** - 桥接后端事件到前端 WebSocket
3. **MessageContainer** - 前端 UI 通知组件（Toast 样式）
4. **useAgentEvents** - 前端事件监听和分发
5. **自动通知** - 定时任务执行完成后自动发送通知

---

## 🎯 使用方式

### 1. Agent 发送通知（通过 emit_event 工具）

Agent 在执行任务时，可以使用 `emit_event` 工具发送通知：

```typescript
// Agent 使用示例（在 Agent 的对话中）
await tools.emit_event({
  event: 'notify',
  payload: {
    message: '数据同步已完成！',
    level: 'success' // 可选：info | success | warning | error
  }
});
```

**通知级别**：

- `info`（默认） - 蓝色，普通信息
- `success` - 绿色，成功提示
- `warning` - 黄色，警告信息
- `error` - 红色，错误提示

---

### 2. 后端代码发送通知（通过 EventBus）

后端代码可以直接发送通知事件：

```typescript
import { eventBus } from '@main/common/eventbus';

// 发送成功通知
eventBus.emit('agent:event', {
  _event: 'notify',
  message: '操作成功！',
  level: 'success',
  _timestamp: Date.now()
});

// 发送错误通知
eventBus.emit('agent:event', {
  _event: 'notify',
  message: '操作失败：文件未找到',
  level: 'error',
  _timestamp: Date.now()
});
```

**示例**：定时任务执行完成后自动发送通知（已实现）

```typescript
// src/main/ai/cron/CronJobExecutor.ts

// ✅ 执行成功
eventBus.emit('agent:event', {
  _event: 'notify',
  message: `定时任务「${job.name}」执行成功`,
  level: 'success',
  _timestamp: Date.now()
});

// ❌ 执行失败
eventBus.emit('agent:event', {
  _event: 'notify',
  message: `定时任务「${job.name}」执行失败：${errorMessage}`,
  level: 'error',
  _timestamp: Date.now()
});
```

---

### 3. 前端直接显示通知（在 Vue 组件中）

在 Vue 组件中，可以使用 `useMessageStore` 直接显示通知：

```vue
<script setup lang="ts">
import { useMessageStore } from '@/components/Message/store';

const messageStore = useMessageStore();

function showSuccessNotification() {
  messageStore.success('操作成功！');
}

function showErrorNotification() {
  messageStore.error('操作失败！', {
    duration: 5000, // 持续时间（毫秒）
    position: 'topRight' // 位置
  });
}

function showCustomNotification() {
  messageStore.addMessage({
    content: '自定义消息',
    type: 'info',
    duration: 3000,
    position: 'topCenter',
    onClose: () => {
      console.log('通知已关闭');
    }
  });
}
</script>
```

---

## 🎨 通知样式和位置

### 通知类型

| 类型      | 颜色 | 图标 | 使用场景     |
| --------- | ---- | ---- | ------------ |
| `info`    | 蓝色 | ℹ️   | 普通信息提示 |
| `success` | 绿色 | ✅   | 操作成功     |
| `warning` | 黄色 | ⚠️   | 警告信息     |
| `error`   | 红色 | ❌   | 错误提示     |

### 通知位置

```typescript
type MessagePosition =
  | 'topLeft'
  | 'topCenter' // 默认位置
  | 'topRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'center';
```

### 默认配置

```typescript
{
  duration: 3000,        // 3 秒后自动关闭
  position: 'topCenter', // 顶部居中显示
  showClose: true        // 显示关闭按钮
}
```

---

## 🔄 通知流程

### Agent 发送通知

```
Agent 执行
  ↓
emit_event 工具
  ↓
后端 EventBus ('agent:event')
  ↓
AgentEventBridge
  ↓
Gateway WebSocket ('agent.event')
  ↓
前端 useAgentEvents
  ↓
useMessageStore
  ↓
MessageContainer 显示通知
```

### 定时任务通知

```
定时任务执行完成
  ↓
CronJobExecutor.execute()
  ↓
后端 EventBus ('agent:event')
  ↓
AgentEventBridge
  ↓
Gateway WebSocket ('agent.event')
  ↓
前端 useAgentEvents
  ↓
useMessageStore
  ↓
MessageContainer 显示通知
```

---

## 📝 实际使用示例

### 示例 1：定时任务执行通知（自动）

```typescript
// 无需手动调用，系统自动发送
// 定时任务执行成功 → 显示绿色成功通知
// 定时任务执行失败 → 显示红色错误通知
// 连续失败 3 次自动禁用 → 显示黄色警告通知
```

**效果**：

- ✅ 定时任务「每日数据同步」执行成功
- ❌ 定时任务「Worker 健康检查」执行失败：连接超时
- ⚠️ 定时任务「定时报表」连续失败 3 次，已自动禁用

---

### 示例 2：Agent 任务进度通知

```typescript
// Agent 在执行长任务时，可以分阶段通知进度

// 步骤 1：开始
await tools.emit_event({
  event: 'notify',
  payload: {
    message: '开始生成报表...',
    level: 'info'
  }
});

// 步骤 2：进行中
await tools.emit_event({
  event: 'notify',
  payload: {
    message: '正在处理数据（1/3）...',
    level: 'info'
  }
});

// 步骤 3：完成
await tools.emit_event({
  event: 'notify',
  payload: {
    message: '报表生成成功！',
    level: 'success'
  }
});
```

---

### 示例 3：文件操作通知

```typescript
// Agent 写入文件后通知用户
await tools.write({
  path: '/workspace/report.md',
  content: '...'
});

await tools.emit_event({
  event: 'notify',
  payload: {
    message: '报表已保存到 report.md',
    level: 'success'
  }
});

// 同时打开文件
await tools.emit_event({
  event: 'open-file',
  payload: {
    path: '/workspace/report.md'
  }
});
```

---

### 示例 4：错误处理通知

```typescript
// 在 try-catch 中捕获错误并通知
try {
  await someRiskyOperation();
} catch (error) {
  eventBus.emit('agent:event', {
    _event: 'notify',
    message: `操作失败：${error.message}`,
    level: 'error',
    _timestamp: Date.now()
  });
}
```

---

## 🎓 最佳实践

### 1. 选择合适的通知级别

```typescript
// ✅ 好的做法
messageStore.success('文件上传成功'); // 操作成功
messageStore.warning('磁盘空间不足'); // 警告
messageStore.error('网络连接失败'); // 错误
messageStore.info('正在处理...'); // 普通信息

// ❌ 不好的做法
messageStore.error('操作成功'); // 级别不匹配
messageStore.success('发生错误'); // 级别不匹配
```

### 2. 控制通知频率

```typescript
// ❌ 不好：高频通知会淹没用户
for (const file of files) {
  messageStore.success(`处理 ${file}`); // 太多通知
}

// ✅ 好：合并通知
messageStore.success(`已处理 ${files.length} 个文件`);
```

### 3. 提供有用的错误信息

```typescript
// ❌ 不好：错误信息太模糊
messageStore.error('操作失败');

// ✅ 好：提供详细的错误信息
messageStore.error(`文件上传失败：${error.message}`);
```

### 4. 使用合适的持续时间

```typescript
// 普通信息：3 秒（默认）
messageStore.info('正在加载...');

// 成功提示：2 秒（快速消失）
messageStore.success('保存成功', { duration: 2000 });

// 错误提示：5 秒（给用户更多时间阅读）
messageStore.error('操作失败，请重试', { duration: 5000 });

// 不自动关闭（需要用户手动关闭）
messageStore.error('严重错误，请联系管理员', { duration: 0 });
```

---

## 🔍 调试技巧

### 1. 查看控制台日志

所有通知都会同时输出到控制台：

```
[Agent] 定时任务「每日数据同步」执行成功
```

### 2. 检查 WebSocket 事件

在浏览器开发者工具中：

```javascript
// 监听所有 agent.event
gateway.on('agent.event', (payload) => {
  console.log('Agent Event:', payload);
});
```

### 3. 测试通知

在浏览器控制台中：

```javascript
// 测试各种通知
const messageStore = useMessageStore();
messageStore.info('测试信息');
messageStore.success('测试成功');
messageStore.warning('测试警告');
messageStore.error('测试错误');
```

---

## 📚 相关文件

### 后端

- `src/main/ai/tools/builtin/emit-event.ts` - emit_event 工具定义
- `src/main/gateway/events/AgentEventBridge.ts` - 事件桥接
- `src/main/ai/cron/CronJobExecutor.ts` - 定时任务通知

### 前端

- `src/renderer/src/composables/useAgentEvents.ts` - Agent 事件监听
- `src/renderer/src/components/Message/store.ts` - 通知状态管理
- `src/renderer/src/components/Message/MessageContainer.vue` - 通知 UI 组件
- `src/renderer/src/components/Message/types.ts` - 类型定义

---

## ⚙️ 定时任务通知配置

### 问题场景

对于高频执行的定时任务（例如每 10 秒执行一次），每次都发送通知会非常烦人，干扰用户工作。

### 解决方案：可配置的通知开关

每个定时任务都可以单独配置是否发送通知。

#### 配置选项

```typescript
interface CronJobDefinition {
  // ... 其他字段
  sendNotification?: boolean; // 默认 true
}
```

#### 前端 UI

在创建和编辑定时任务的表单中，有一个复选框：

```
☑️ 执行完成后发送通知
建议：高频任务（每分钟、每10秒）关闭通知，低频任务（每天、每周）开启通知
```

#### 行为说明

1. **sendNotification: true（默认）**
   - 执行成功 → 发送绿色通知
   - 执行失败 → 发送红色通知
   - 连续失败 3 次自动禁用 → 发送黄色警告

2. **sendNotification: false**
   - 执行成功 → 不发送通知
   - 执行失败 → 不发送通知
   - 连续失败 3 次自动禁用 → **仍然发送警告**（重要！）

#### 使用建议

| 任务频率            | 建议配置    | 示例               |
| ------------------- | ----------- | ------------------ |
| 高频（每秒/每分钟） | ❌ 关闭通知 | 健康检查、实时监控 |
| 中频（每小时）      | ✅ 根据需要 | 数据清理、缓存刷新 |
| 低频（每天/每周）   | ✅ 开启通知 | 备份、报表生成     |

#### 实际示例

```typescript
// ❌ 高频任务 - 关闭通知
{
  name: 'Worker 健康检查',
  cronExpression: '*/10 * * * *', // 每 10 秒
  task: '检查所有 Worker 状态',
  sendNotification: false
}

// ✅ 低频任务 - 开启通知
{
  name: '每日数据备份',
  cronExpression: '0 2 * * *', // 每天凌晨 2:00
  task: '备份数据库到 OSS',
  sendNotification: true
}
```

---

## 🚀 未来改进

### 计划中的功能

1. **通知历史** - 记录所有通知，用户可以查看历史
2. **通知分组** - 相同类型的通知自动合并
3. **通知声音** - 可选的声音提示
4. **桌面通知** - 使用 Electron 的原生通知 API
5. **通知优先级** - 紧急通知置顶显示

---

**更新时间**: 2026-03-31  
**功能状态**: ✅ 已实现并集成  
**默认行为**: Agent 和定时任务可以自动发送通知（定时任务可配置）
