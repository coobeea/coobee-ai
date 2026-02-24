# Agent 管理 Worker 生命周期架构讨论

## 📋 需求背景

**问题**: Agent（如 app-copilot 应用管家）是否应该能够自动启停和管理 Worker 的生命周期？

**当前状态**:

- ✅ `WorkerManager` 已有完整的生命周期管理能力
- ✅ Extension 系统可以注册 Service、Channel、Tool
- ❓ Agent 目前无法直接控制 Worker

---

## 🎯 使用场景分析

### 场景 1: 按需启动 Worker

**需求**: Tavern 有新任务时，自动启动 `tavern-poller` Worker

```
用户发布任务 → Agent 检测到 → 启动 tavern-poller → 自动扫描处理
```

**价值**: 节省资源，Worker 不必常驻运行

### 场景 2: 故障自动恢复

**需求**: Worker 异常停止时，Agent 自动重启

```
Worker 崩溃 → Agent 收到通知 → 自动重启 → 继续服务
```

**价值**: 提高系统可用性

### 场景 3: 资源优化管理

**需求**: 长时间无任务时，Agent 主动停止 Worker

```
15分钟无新任务 → Agent 判断可停止 → 停止 Worker → 释放资源
```

**价值**: 优化资源占用

### 场景 4: 依赖链管理

**需求**: Agent 需要启动某个功能，自动启动依赖的 Worker

```
用户请求功能 → Agent 检查依赖 → 启动必要的 Worker → 执行任务
```

**价值**: 自动化依赖管理

---

## 🏗️ 架构设计方案

### 方案 A: 通过 Tool 暴露（推荐）

**设计**:

```typescript
// 1. 在 Extension 中注册 Worker 管理工具
api.registerTool({
  name: 'worker_start',
  description: 'Start a registered worker by name',
  parameters: {
    type: 'object',
    properties: {
      workerName: { type: 'string', description: 'Worker name (e.g., tavern-poller)' }
    },
    required: ['workerName']
  },
  execute: async ({ workerName }) => {
    const workerManager = WorkerManager.getInstance();
    await workerManager.start(workerName);
    return { success: true, message: `Worker ${workerName} started` };
  }
});

api.registerTool({
  name: 'worker_stop',
  description: 'Stop a running worker by name',
  parameters: {
    /* 同上 */
  },
  execute: async ({ workerName }) => {
    const workerManager = WorkerManager.getInstance();
    await workerManager.stop(workerName);
    return { success: true, message: `Worker ${workerName} stopped` };
  }
});

api.registerTool({
  name: 'worker_status',
  description: 'Get status of all workers or a specific worker',
  parameters: {
    type: 'object',
    properties: {
      workerName: { type: 'string', description: 'Optional worker name' }
    }
  },
  execute: async ({ workerName }) => {
    const workerManager = WorkerManager.getInstance();
    if (workerName) {
      return workerManager.getWorkerInfo(workerName);
    }
    return workerManager.getAllWorkerInfo();
  }
});
```

**优点**:

- ✅ 符合现有架构（通过 Tool 扩展能力）
- ✅ 可审批：工具调用可以经过 Approval 流程
- ✅ 可审计：所有操作都有日志
- ✅ 权限控制：可以配置哪些 Agent 可以使用
- ✅ 灵活性：可以添加更多控制逻辑

**缺点**:

- ⚠️ 需要 Agent 主动调用（不是自动化）
- ⚠️ 增加 Agent 的认知负担

---

### 方案 B: 事件驱动自动化

**设计**:

```typescript
// Extension 监听 Worker 状态变化
api.events?.on('worker:status', (info: WorkerInfo) => {
  if (info.status === 'error' && info.config.autoRestart) {
    // 自动重启策略
    setTimeout(async () => {
      await WorkerManager.getInstance().start(info.name);
    }, 5000);
  }
});

// Extension 监听业务事件
api.events?.on('external.tavern.task.created', async (task) => {
  const workerManager = WorkerManager.getInstance();
  const pollerInfo = workerManager.getWorkerInfo('tavern-poller');

  // 按需启动
  if (!pollerInfo || pollerInfo.status === 'stopped') {
    await workerManager.start('tavern-poller');
  }
});
```

**优点**:

- ✅ 完全自动化，无需 Agent 参与
- ✅ 响应及时
- ✅ 降低 Agent 复杂度

**缺点**:

- ⚠️ 缺乏审批机制
- ⚠️ 逻辑固化在代码中，不够灵活
- ⚠️ 难以适应复杂决策场景

---

### 方案 C: 混合方案（最佳实践）

**设计**:

```
基础自动化 (Extension Service) + Agent 高级控制 (Tool)
```

**分工**:

1. **Extension Service 负责**:
   - 崩溃自动重启（简单规则）
   - 依赖检查和自动启动
   - 基础健康监控

2. **Agent Tool 负责**:
   - 复杂决策（如"是否应该停止 Worker"）
   - 用户主动请求的操作
   - 需要审批的敏感操作

**实现**:

```typescript
// Extension: 基础自动化
api.registerService({
  id: 'worker-guardian',
  start: () => {
    // 监听崩溃，自动重启
    api.events?.on('worker:status', async (info: WorkerInfo) => {
      if (info.status === 'error' && shouldAutoRestart(info)) {
        await WorkerManager.getInstance().start(info.name);
      }
    });
  }
});

// Tool: 高级控制
api.registerTool({
  name: 'worker_lifecycle_control',
  description: 'Advanced worker lifecycle management'
  // ... 完整的启停控制
});
```

---

## 🔒 安全性考虑

### 权限控制

```typescript
// 1. Tool 级别权限
api.registerTool({
  name: 'worker_start',
  permissions: ['system.worker.manage'], // 需要特定权限
  execute: async ({ workerName }, context) => {
    // 检查调用者权限
    if (!context.hasPermission('system.worker.manage')) {
      throw new Error('Permission denied');
    }
    // ...
  }
});

// 2. Worker 级别白名单
const MANAGEABLE_WORKERS = [
  'tavern-poller',
  'embedding-service'
  // 排除关键系统 Worker
];

if (!MANAGEABLE_WORKERS.includes(workerName)) {
  throw new Error('This worker cannot be managed by agents');
}
```

### 审批流程

```typescript
// 敏感操作需要审批
api.registerTool({
  name: 'worker_stop',
  requiresApproval: true, // 需要用户确认
  execute: async ({ workerName }) => {
    // 用户批准后才执行
    await WorkerManager.getInstance().stop(workerName);
  }
});
```

### 频率限制

```typescript
// 防止频繁启停
const rateLimiter = new Map<string, number>();

function canStart(workerName: string): boolean {
  const lastStart = rateLimiter.get(workerName) || 0;
  const now = Date.now();
  if (now - lastStart < 30000) {
    // 30秒冷却
    return false;
  }
  rateLimiter.set(workerName, now);
  return true;
}
```

---

## 📊 方案对比

| 维度           | 方案A (Tool) | 方案B (事件) | 方案C (混合) |
| -------------- | ------------ | ------------ | ------------ |
| **自动化程度** | ⭐⭐☆☆☆      | ⭐⭐⭐⭐⭐   | ⭐⭐⭐⭐☆    |
| **灵活性**     | ⭐⭐⭐⭐⭐   | ⭐⭐☆☆☆      | ⭐⭐⭐⭐⭐   |
| **安全性**     | ⭐⭐⭐⭐⭐   | ⭐⭐⭐☆☆     | ⭐⭐⭐⭐☆    |
| **可审计性**   | ⭐⭐⭐⭐⭐   | ⭐⭐⭐☆☆     | ⭐⭐⭐⭐☆    |
| **实现复杂度** | ⭐⭐⭐☆☆     | ⭐⭐☆☆☆      | ⭐⭐⭐⭐☆    |
| **维护成本**   | ⭐⭐⭐⭐☆    | ⭐⭐⭐☆☆     | ⭐⭐⭐☆☆     |

**推荐**: 方案 C（混合方案）

---

## 🚀 实施计划

### Phase 1: 基础 Tool（2-3小时）

1. 创建 `worker-management` Extension
2. 注册 `worker_start`, `worker_stop`, `worker_status` 三个工具
3. 添加基础权限检查
4. 编写单元测试

### Phase 2: 自动化 Service（1-2小时）

1. 实现 `worker-guardian` Service
2. 崩溃自动重启逻辑
3. 依赖检查逻辑
4. 编写集成测试

### Phase 3: 高级功能（2-3小时）

1. 添加审批流程
2. 实现频率限制
3. 添加监控和日志
4. 性能测试

### Phase 4: Agent 集成（1小时）

1. 更新 app-copilot 指令，说明可用工具
2. 编写使用示例
3. 端到端测试

---

## 💡 使用示例

### 示例 1: Agent 主动启动 Worker

```typescript
// Agent 收到用户请求："帮我处理一下酒馆任务"
Agent 推理:
  1. 检查 tavern-poller 状态 (调用 worker_status)
  2. 发现未运行
  3. 启动 Worker (调用 worker_start)
  4. 等待 Worker 就绪
  5. 处理任务
```

### 示例 2: 自动化按需启动

```typescript
// 用户发布新任务 → Extension 收到事件
→ 检查 Worker 状态
→ 未运行则自动启动
→ 通知 Agent 可以开始工作
```

### 示例 3: 智能资源管理

```typescript
// Agent 定期检查（每10分钟）
Agent 推理:
  1. 查询所有 Worker 状态
  2. 检查最近任务活跃度
  3. 如果 tavern-poller 超过30分钟无新任务
  4. 调用 worker_stop 停止 Worker
```

---

## 🤔 开放问题

### 问题 1: Worker 停止时机

**场景**: Agent 正在处理任务，Worker 被停止
**方案**:

- 增加 Worker 引用计数
- 有 Agent 正在使用时拒绝停止

### 问题 2: 并发控制

**场景**: 多个 Agent 同时启动/停止同一 Worker
**方案**:

- WorkerManager 内部已有状态锁
- Tool 层增加分布式锁（如果多实例）

### 问题 3: 跨机器 Worker

**场景**: Worker 运行在远程机器上
**方案**:

- 提供 HTTP API 代理
- Agent 通过统一接口管理

---

## 📝 总结

### 核心建议

✅ **应该暴露 Worker 管理能力给 Agent**

- 可以实现更智能的资源管理
- 提高系统自动化程度
- 符合"应用管家"的定位

### 实施建议

✅ **采用混合方案（方案C）**

- Tool 提供显式控制
- Service 提供自动化兜底
- 权限和审批保证安全性

### 优先级

**P0**: 基础 Tool（worker_start/stop/status）
**P1**: 自动化 Service（崩溃重启）
**P2**: 高级功能（审批、限流）
**P3**: Agent 智能决策（按需启停）

---

**讨论时间**: 2026-02-22  
**下一步**: 确认方案后开始实施 Phase 1
