# Cron Catch-up 机制（补执行错过的任务）

## 📋 问题描述

**核心问题**：程序不是 24/7 运行的，重启后会错过定时任务的执行时间。

### 场景示例

```
定时任务：每天 9:00 执行数据同步
- 最后一次执行：2026-03-30 09:00
- 程序停止：2026-03-30 10:00
- 程序重启：2026-03-31 14:00

❌ 错过的执行：
  - 2026-03-31 09:00（应该执行但没执行）

传统的 cron 调度器（如 node-cron）不会补执行错过的任务，
只会等待下次调度时间（2026-04-01 09:00）。
```

---

## 🎯 解决方案

### Catch-up 机制（启动时补执行）

在调度器启动时（`CronScheduler.start()`），自动检查每个任务是否有错过的执行：

1. **检查条件**：
   - 任务状态为 `active`
   - 任务已执行过（有 `lastRunAt`）
   - 启用了 catch-up（`catchUpMissedRuns !== false`）

2. **计算错过的时间**：
   - 使用 `cron-parser` 解析 cron 表达式
   - 计算"自上次执行以来，下一次应该执行的时间"
   - 如果该时间已过去 → 说明错过了

3. **补执行策略**：
   - 如果错过的时间在**宽限期内**（默认 24 小时） → 立即补执行一次
   - 如果超过宽限期 → 忽略（等待下次正常调度）

---

## 🔧 使用方法

### 1. 默认行为（自动启用）

新创建的定时任务，**默认启用 catch-up**：

```typescript
const job = await cronStore.create({
  name: '数据同步',
  cronExpression: '0 9 * * *', // 每天 9:00
  task: '同步用户数据到备份服务器'
  // catchUpMissedRuns: true （默认）
  // catchUpGracePeriodHours: 24 （默认）
});
```

**行为**：

- 如果程序在 3 月 31 日 14:00 重启，检测到错过了 9:00 的执行
- 错过时间：5 小时（< 24 小时）
- **✅ 立即补执行一次**
- 然后正常等待下次调度（4 月 1 日 9:00）

---

### 2. 自定义宽限期

```typescript
const job = await cronStore.create({
  name: '紧急告警检查',
  cronExpression: '*/5 * * * *', // 每 5 分钟
  task: '检查系统告警',
  catchUpMissedRuns: true,
  catchUpGracePeriodHours: 1 // 只补执行 1 小时内的
});
```

**行为**：

- 如果程序停机 2 小时后重启 → 错过时间超过 1 小时 → **不补执行**
- 如果程序停机 30 分钟后重启 → 错过时间 < 1 小时 → **补执行**

---

### 3. 禁用 catch-up

```typescript
const job = await cronStore.create({
  name: '定时报表',
  cronExpression: '0 0 * * 0', // 每周日 00:00
  task: '生成周报',
  catchUpMissedRuns: false // 禁用补执行
});
```

**行为**：

- 无论错过多久，都不补执行
- 等待下次正常调度时间

---

## 📊 配置字段

### `catchUpMissedRuns` (boolean)

是否启用补执行机制。

- **默认值**：`true`
- **true**：启动时检查并补执行错过的任务
- **false**：忽略错过的任务，等待下次调度

### `catchUpGracePeriodHours` (number)

补执行的宽限期（单位：小时）。

- **默认值**：`24`
- **含义**：只补执行在宽限期内错过的任务
- **示例**：
  - 设置为 `24`：错过 23 小时 → 补执行，错过 25 小时 → 不补执行
  - 设置为 `1`：错过 50 分钟 → 补执行，错过 2 小时 → 不补执行

---

## 🧪 测试场景

### 场景 1：正常补执行

```
任务：每天 10:00 执行
最后执行：2026-03-30 10:00
程序停止：2026-03-30 12:00
程序重启：2026-03-31 15:00

分析：
  - 应该执行的时间：2026-03-31 10:00
  - 错过时间：5 小时
  - 宽限期：24 小时
  - ✅ 立即补执行
```

### 场景 2：超过宽限期，不补执行

```
任务：每天 10:00 执行，宽限期 12 小时
最后执行：2026-03-25 10:00
程序停止：2026-03-25 12:00
程序重启：2026-03-31 15:00

分析：
  - 应该执行的时间：2026-03-26 10:00
  - 错过时间：5 天 5 小时（> 12 小时）
  - ❌ 不补执行，等待下次调度（2026-04-01 10:00）
```

### 场景 3：从未执行过，不补执行

```
任务：刚创建，从未执行过
程序重启：2026-03-31 15:00

分析：
  - lastRunAt: null
  - ❌ 跳过 catch-up 检查
  - 等待第一次正常调度
```

### 场景 4：高频任务，只补执行一次

```
任务：每 5 分钟执行一次
最后执行：2026-03-31 10:00
程序停止：2026-03-31 10:05
程序重启：2026-03-31 12:00

分析：
  - 理论上错过了 24 次执行（10:05, 10:10, ..., 11:55）
  - 但 catch-up 只补执行**第一次错过的时间**（10:05）
  - ✅ 立即补执行一次
  - 然后正常调度（12:05, 12:10, ...）
```

---

## 🔍 实现细节

### 核心代码

```typescript
// src/main/ai/cron/CronScheduler.ts

private async checkAndCatchUpMissedRuns(job: CronJobDefinition): Promise<void> {
  // 1. 检查是否启用 catch-up
  if (job.catchUpMissedRuns === false) return;

  // 2. 检查是否有执行历史
  if (!job.lastRunAt) return;

  // 3. 使用 cron-parser 计算下一次应该执行的时间
  const interval = cronParser.parseExpression(job.cronExpression, {
    currentDate: new Date(job.lastRunAt)
  });
  const nextScheduledTime = interval.next().toDate();
  const now = new Date();

  // 4. 检查是否错过
  if (nextScheduledTime > now) return;

  // 5. 检查是否在宽限期内
  const missedHours = (now - nextScheduledTime) / (1000 * 60 * 60);
  const gracePeriod = job.catchUpGracePeriodHours ?? 24;
  if (missedHours > gracePeriod) return;

  // 6. 补执行
  await this.executor.execute(job);
}
```

### 使用 cron-parser

```bash
pnpm add cron-parser
```

`cron-parser` 是一个标准库，用于：

- 解析 cron 表达式
- 计算下一次/上一次执行时间
- 支持时区

---

## 🎓 最佳实践

### 1. 高频任务建议设置短宽限期

```typescript
// ❌ 不推荐：每 5 分钟执行，宽限期 24 小时
{
  cronExpression: '*/5 * * * *',
  catchUpGracePeriodHours: 24
}

// ✅ 推荐：每 5 分钟执行，宽限期 1 小时
{
  cronExpression: '*/5 * * * *',
  catchUpGracePeriodHours: 1
}
```

**原因**：高频任务如果停机很久，补执行的意义不大，且可能导致资源浪费。

---

### 2. 低频任务建议启用 catch-up

```typescript
// ✅ 推荐：每天执行的任务，启用 catch-up
{
  cronExpression: '0 9 * * *', // 每天 9:00
  catchUpMissedRuns: true,
  catchUpGracePeriodHours: 48 // 2 天内的都补执行
}
```

**原因**：低频任务错过一次影响大（例如日报、周报），应该补执行。

---

### 3. 幂等性是关键

确保任务的执行是**幂等的**（多次执行结果一致），这样补执行才安全。

```typescript
// ✅ 幂等的任务（安全补执行）
async execute() {
  await syncDataWithTimestamp(); // 根据时间戳增量同步
  await generateReportForYesterday(); // 只生成昨天的报表
}

// ❌ 非幂等的任务（补执行可能有副作用）
async execute() {
  await sendNotificationToAllUsers(); // 多次执行会发送多次通知
  await incrementCounter(); // 多次执行会累加
}
```

---

## 📌 注意事项

### 1. 只补执行一次

catch-up 机制**不会补执行所有错过的次数**，只补执行**最近一次错过的时间**。

**原因**：

- 避免补执行堆积（例如每 5 分钟执行一次，停机 2 小时会错过 24 次）
- 多数场景下，执行一次即可达到目的

### 2. 异步执行，不阻塞启动

补执行使用 `setImmediate()`，不会阻塞调度器启动：

```typescript
setImmediate(async () => {
  await this.executor.execute(job);
});
```

**好处**：

- 应用快速启动
- 补执行在后台进行

### 3. 向后兼容

旧的 job（没有 `catchUpMissedRuns` 字段）会自动启用 catch-up：

```typescript
if (job.catchUpMissedRuns === undefined) {
  job.catchUpMissedRuns = true; // 默认启用
}
```

---

## 🚀 使用示例

### 示例 1：每日数据同步

```typescript
await cronStore.create({
  name: '每日数据同步',
  description: '同步用户数据到备份服务器',
  cronExpression: '0 2 * * *', // 每天凌晨 2:00
  task: '同步数据库到 OSS',
  catchUpMissedRuns: true, // 启用补执行
  catchUpGracePeriodHours: 48 // 2 天内的都补执行
});
```

**场景**：

- 如果凌晨 2:00 时服务器宕机，3 月 31 日早上 10:00 重启
- 检测到错过了 2:00 的执行（错过 8 小时，< 48 小时）
- **✅ 立即补执行一次同步任务**
- 然后正常等待下次调度（4 月 1 日 2:00）

---

### 示例 2：健康检查（高频，短宽限期）

```typescript
await cronStore.create({
  name: 'Worker 健康检查',
  description: '检查所有 Worker 的健康状态',
  cronExpression: '*/10 * * * *', // 每 10 分钟
  task: '检查 Worker 健康状态',
  catchUpMissedRuns: true,
  catchUpGracePeriodHours: 1 // 只补执行 1 小时内的
});
```

**场景**：

- 如果程序停机 2 小时后重启
- 错过时间 > 1 小时
- **❌ 不补执行**（健康检查补执行意义不大）
- 直接等待下次正常调度

---

### 示例 3：通知发送（禁用 catch-up）

```typescript
await cronStore.create({
  name: '早安问候',
  description: '每天早上 8:00 发送问候消息',
  cronExpression: '0 8 * * *', // 每天 8:00
  task: '发送早安问候',
  catchUpMissedRuns: false // 禁用补执行
});
```

**场景**：

- 如果程序在 8:00 时停机，中午 12:00 重启
- 检测到错过了 8:00 的执行
- **❌ 不补执行**（中午发送"早安"不合适）
- 等待下次正常调度（明天 8:00）

---

## 📚 相关资源

- **cron-parser**: https://www.npmjs.com/package/cron-parser
- **node-cron**: https://www.npmjs.com/package/node-cron
- **源码**:
  - `src/main/ai/cron/CronScheduler.ts` - 调度器主逻辑
  - `src/main/ai/cron/types.ts` - 类型定义
  - `src/main/ai/cron/CronJobStore.ts` - 存储层

---

**更新时间**: 2026-03-31  
**功能状态**: ✅ 已实现并集成  
**默认行为**: 所有新任务默认启用 catch-up（24 小时宽限期）
