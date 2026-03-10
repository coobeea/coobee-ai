# 定时任务推送机制 - 实施计划

> 关联设计文档：[cron-notification-design.md](./cron-notification-design.md)
> 创建日期：2026-03-02

---

## 一、实施阶段

### Phase 1: 核心推送功能（P0）

| 任务                     | 文件                                    | 预计工作量 | 依赖 |
| ------------------------ | --------------------------------------- | ---------- | ---- |
| 1.1 定义事件类型         | `src/shared/ipc/events.ts`              | 0.5h       | -    |
| 2.1 修改 CronJobExecutor | `src/main/ai/cron/CronJobExecutor.ts`   | 1h         | 1.1  |
| 2.2 创建 CronBridge      | `src/main/gateway/events/CronBridge.ts` | 1h         | 1.1  |
| 3.1 前端添加事件监听     | `src/renderer/src/views/CronView.vue`   | 1h         | 2.2  |

**阶段目标**: 实现基本的 WebSocket 推送，前端能实时接收任务开始/完成/失败事件

---

### Phase 2: 用户体验优化（P1）

| 任务                   | 文件                                  | 预计工作量 | 依赖    |
| ---------------------- | ------------------------------------- | ---------- | ------- |
| 3.2 Toast 通知样式优化 | `src/renderer/src/views/CronView.vue` | 0.5h       | Phase 1 |
| 3.3 执行状态实时更新   | `src/renderer/src/views/CronView.vue` | 1h         | Phase 1 |
| 3.4 添加执行中状态显示 | `src/renderer/src/views/CronView.vue` | 1h         | Phase 1 |

**阶段目标**: 优化前端展示，提供清晰的任务状态反馈

---

### Phase 3: 可选扩展功能（P2）

| 任务               | 文件                                    | 预计工作量 | 依赖    |
| ------------------ | --------------------------------------- | ---------- | ------- |
| 4.1 系统通知配置   | `src/main/ai/cron/types.ts`             | 0.5h       | -       |
| 4.2 添加系统通知   | `src/main/ai/cron/CronJobExecutor.ts`   | 1h         | 4.1     |
| 4.3 执行进度推送   | `src/main/ai/cron/CronJobExecutor.ts`   | 2h         | Phase 1 |
| 4.4 客户端订阅机制 | `src/main/gateway/events/CronBridge.ts` | 1.5h       | Phase 1 |

**阶段目标**: 提供高级功能，如系统通知、执行进度、订阅机制

---

## 二、详细任务拆解

### 任务 1.1: 定义事件类型

**文件**: `src/shared/ipc/events.ts`

**工作内容**:

```typescript
// 添加 Cron 事件类型定义
export interface CronEventMap {
  'cron:job-started': {
    jobId: string;
    jobName: string;
    startedAt: number;
  };
  'cron:job-completed': {
    jobId: string;
    jobName: string;
    status: 'success';
    result: string;
    duration: number;
  };
  'cron:job-failed': {
    jobId: string;
    jobName: string;
    status: 'failed';
    error: string;
    failCount: number;
    willDisable: boolean;
  };
  'cron:job-disabled': {
    jobId: string;
    jobName: string;
    reason: string;
    failCount: number;
  };
}
```

**验收标准**:

- [ ] 事件类型定义完整
- [ ] TypeScript 类型检查通过

---

### 任务 2.1: 修改 CronJobExecutor

**文件**: `src/main/ai/cron/CronJobExecutor.ts`

**工作内容**:

1. 导入 eventBus
2. 在执行开始时 emit `cron:job-started`
3. 在执行成功时 emit `cron:job-completed`
4. 在执行失败时 emit `cron:job-failed`
5. 在连续失败 3 次时 emit `cron:job-disabled`

**关键代码**:

```typescript
import { eventBus } from '@main/common/eventbus';

async execute(job: CronJobDefinition): Promise<void> {
  const startedAt = Date.now();

  // emit 开始事件
  eventBus.emit('cron:job-started', {
    jobId: job.id,
    jobName: job.name,
    startedAt
  });

  try {
    // ... 执行逻辑 ...

    // emit 完成事件
    eventBus.emit('cron:job-completed', {...});
  } catch (error) {
    // emit 失败事件
    eventBus.emit('cron:job-failed', {...});
  }
}
```

**验收标准**:

- [ ] 4 个事件都能正确 emit
- [ ] 事件 payload 数据完整
- [ ] 不影响原有执行逻辑

---

### 任务 2.2: 创建 CronBridge

**文件**: `src/main/gateway/events/CronBridge.ts`（新建）

**工作内容**:

1. 创建 EventBridge 初始化函数
2. 监听 4 个 cron 事件
3. 转发到 Gateway.broadcastEvent
4. 返回清理函数

**验收标准**:

- [ ] 事件桥接正常工作
- [ ] 清理函数正确注销监听
- [ ] Gateway 自动发现并注册桥接

---

### 任务 3.1: 前端添加事件监听

**文件**: `src/renderer/src/views/CronView.vue`

**工作内容**:

1. 导入 gatewayClient
2. 在 onMounted 中注册事件监听
3. 在 onUnmounted 中注销事件监听
4. 实现事件处理函数

**验收标准**:

- [ ] 组件挂载后能收到 cron 事件
- [ ] 组件卸载后不会内存泄漏
- [ ] Toast 通知正常显示

---

### 任务 3.2: Toast 通知样式优化

**工作内容**:

- 成功：绿色 Toast，显示执行结果
- 失败：红色 Toast，显示错误信息
- 开始：蓝色 Toast，简洁提示
- 禁用：橙色 Toast，显示原因

---

### 任务 3.3: 执行状态实时更新

**工作内容**:

- 收到事件后自动刷新作业列表
- 更新执行计数、最后运行时间等

---

### 任务 3.4: 添加执行中状态显示

**工作内容**:

- 作业列表显示"执行中"标记
- 收到 `cron:job-started` 时设置执行中状态
- 收到 `cron:job-completed` 或 `cron:job-failed` 时清除状态

---

## 三、测试清单

### 后端测试

```bash
# 运行单元测试
pnpm test

# 测试 CronJobExecutor
pnpm test -- CronJobExecutor

# 测试 CronBridge
pnpm test -- CronBridge
```

| 测试用例           | 预期结果                           |
| ------------------ | ---------------------------------- |
| 创建定时任务并触发 | 前端收到 `cron.job.started` 事件   |
| 任务执行成功       | 前端收到 `cron.job.completed` 事件 |
| 任务执行失败       | 前端收到 `cron.job.failed` 事件    |
| 连续失败 3 次      | 前端收到 `cron.job.disabled` 事件  |

### 前端测试

| 测试用例       | 预期结果                     |
| -------------- | ---------------------------- |
| 打开 Cron 页面 | 正常加载作业列表             |
| 任务执行完成   | Toast 通知显示，列表自动刷新 |
| 关闭页面       | 事件监听器正确注销           |
| 网络断开重连   | 能重新接收事件               |

---

## 四、回滚计划

如果实施后出现问题，按以下步骤回滚：

1. **回滚代码**: `git revert <commit-hash>`
2. **重启应用**: 确保 Gateway 重新加载
3. **验证功能**: 确认定时任务恢复正常

---

## 五、实施检查清单

### 实施前

- [ ] 已阅读设计文档
- [ ] 已备份当前代码
- [ ] 已了解现有 Cron 系统架构

### 实施中

- [ ] 按 Phase 顺序实施
- [ ] 每个任务完成后自测
- [ ] 及时提交代码

### 实施后

- [ ] 运行完整测试
- [ ] 验证所有事件类型
- [ ] 更新文档（如有变更）

---

## 六、时间估算

| 阶段         | 工作量  | 建议时间 |
| ------------ | ------- | -------- |
| Phase 1 (P0) | 3.5h    | 第 1 天  |
| Phase 2 (P1) | 2.5h    | 第 2 天  |
| Phase 3 (P2) | 5h      | 第 3 天  |
| **总计**     | **11h** | **3 天** |

---

## 七、负责人

| 角色 | 人员 |
| ---- | ---- |
| 开发 | TBD  |
| 测试 | TBD  |
| 审核 | TBD  |

---

## 八、备注

- 优先实施 Phase 1，满足核心推送需求
- Phase 2 和 Phase 3 可根据实际需求调整优先级
- 实施过程中如发现问题，及时更新文档
