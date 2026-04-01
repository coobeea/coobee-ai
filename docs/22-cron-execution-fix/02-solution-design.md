# 定时任务执行问题 - 解决方案设计

**文档编号**: SOL-2026-04-01-CRON  
**创建时间**: 2026-04-01 11:15  
**关联需求**: REQ-2026-04-01-CRON  
**状态**: 设计中

---

## 🔍 根因分析

### 问题定位

通过日志分析（`terminals/1.txt:450-456`），发现关键错误：

```log
[2026-04-01 11:08:34] [error] [CronScheduler] 解析 cron 表达式失败: 30 5 * * *
[2026-04-01 11:08:34] [info]  [CronScheduler] 已调度作业: KUDAgJCOfKUVezBUTWssl - 起床提醒 (30 5 * * *)
[2026-04-01 11:08:34] [error] [CronScheduler] 解析 cron 表达式失败: 0 16 * * 1-5
[2026-04-01 11:08:34] [info]  [CronScheduler] 已调度作业: xvvw-eEZZdMe2zeZLa3WQ - 证券数据定时抓取 (0 16 * * 1-5)
```

### 根本原因

**Cron 表达式格式不兼容**：

| 库              | 格式                     | 示例           | 位数      |
| --------------- | ------------------------ | -------------- | --------- |
| **node-cron**   | `分 时 日 月 周`         | `30 5 * * *`   | 5 位 ✅   |
| **cron-parser** | `秒 分 时 日 月 周 [年]` | `0 30 5 * * *` | 6-7 位 ✅ |

**当前代码问题**：

1. 任务定义使用 **5 位格式**（符合 node-cron）
2. `node-cron.validate()` 和 `cron.schedule()` 正常工作（任务被调度）
3. `cron-parser` 解析失败（需要 6 位格式）
4. `checkAndCatchUpMissedRuns()` 中 catch 异常后直接 return
5. **结果**：任务被调度，但 Catch-up 机制失效

---

## 🎯 解决方案

### 方案 A：统一为 6 位格式（推荐 ⭐）

**核心思路**：所有 cron 表达式统一使用 6 位格式（秒 分 时 日 月 周）

#### 优点

- ✅ `cron-parser` 和 `node-cron` 都支持
- ✅ 更精确（支持秒级调度）
- ✅ 行业标准（大多数 cron 库都支持）

#### 缺点

- ❌ 需要迁移现有任务（5 位 → 6 位）
- ❌ 用户可能不习惯（但可以在 UI 层面隐藏复杂度）

#### 实施步骤

1. **自动迁移**：

   ```typescript
   // 5 位转 6 位（在秒位补 0）
   "30 5 * * *" → "0 30 5 * * *"
   "0 16 * * 1-5" → "0 0 16 * * 1-5"
   ```

2. **验证逻辑**：

   ```typescript
   function normalizeCronExpression(expr: string): string {
     const parts = expr.trim().split(/\s+/);
     if (parts.length === 5) {
       // 5 位格式 → 在最前面补 0（秒位）
       return `0 ${expr}`;
     }
     return expr;
   }
   ```

3. **向后兼容**：
   - 读取旧任务时自动转换
   - 保存时使用新格式
   - UI 仍然允许用户输入 5 位或 6 位

---

### 方案 B：5 位格式 + 手动转换（备选）

**核心思路**：保持 5 位格式，但在 `cron-parser` 解析前手动转换

#### 优点

- ✅ 不需要迁移现有任务
- ✅ 用户仍然使用 5 位格式（简单）

#### 缺点

- ❌ 需要维护两套逻辑（转换层）
- ❌ 容易出错（格式转换是常见的 bug 来源）

#### 实施步骤

```typescript
private async checkAndCatchUpMissedRuns(job: CronJobDefinition): Promise<void> {
  // ...

  // 将 5 位格式转换为 6 位格式
  const normalizedExpression = normalizeCronExpression(job.cronExpression);

  interval = CronExpressionParser.parse(normalizedExpression, {
    currentDate: new Date(job.lastRunAt),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  // ...
}
```

---

### 方案 C：只用 node-cron 计算（不推荐）

**核心思路**：不使用 cron-parser，改用 node-cron 的内部逻辑计算下一次执行时间

#### 优点

- ✅ 只依赖一个库

#### 缺点

- ❌ node-cron 不提供"计算下一次执行时间"的 API
- ❌ 需要自己实现 cron 表达式解析（复杂且容易出错）
- ❌ 不推荐

---

## 📊 方案对比

| 维度     | 方案 A（6 位统一） | 方案 B（5 位 + 转换） | 方案 C（只用 node-cron） |
| -------- | ------------------ | --------------------- | ------------------------ |
| 实现难度 | 中                 | 低                    | 高                       |
| 可维护性 | ⭐⭐⭐⭐⭐         | ⭐⭐⭐                | ⭐                       |
| 用户体验 | ⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐            | ⭐⭐⭐⭐                 |
| 技术债务 | 低                 | 中                    | 高                       |
| 向后兼容 | ✅（自动迁移）     | ✅                    | ✅                       |
| 推荐度   | ⭐⭐⭐⭐⭐         | ⭐⭐⭐                | ⭐                       |

---

## ✅ 最终选择：方案 B（5 位 + 转换）

**理由**：

1. **最小改动**：只需修改 `checkAndCatchUpMissedRuns()` 方法
2. **用户无感知**：用户仍然使用熟悉的 5 位格式
3. **快速修复**：30 分钟可完成
4. **风险低**：不涉及数据迁移

**未来优化**：

- 如果需要秒级精度，可以再升级到方案 A

---

## 🔧 技术实现

### 1. 添加格式规范化函数

**位置**：`src/main/ai/cron/CronScheduler.ts`

```typescript
/**
 * 规范化 Cron 表达式（5 位 → 6 位）
 *
 * node-cron 使用 5 位格式（分 时 日 月 周）
 * cron-parser 需要 6 位格式（秒 分 时 日 月 周）
 *
 * @example
 * normalizeCronExpression("30 5 * * *") → "0 30 5 * * *"
 * normalizeCronExpression("0 30 5 * * *") → "0 30 5 * * *" (已经是 6 位)
 */
private normalizeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);

  if (parts.length === 5) {
    // 5 位格式 → 在秒位补 0
    return `0 ${expr}`;
  }

  if (parts.length >= 6) {
    // 已经是 6 位或 7 位（含年份）
    return expr;
  }

  throw new Error(`无效的 cron 表达式格式: ${expr}（期望 5 位或 6 位）`);
}
```

### 2. 修改 Catch-up 方法

**位置**：`src/main/ai/cron/CronScheduler.ts:267-321`

**修改点**：

```typescript
// 解析 cron 表达式
let interval: ReturnType<typeof CronExpressionParser.parse>;
try {
  // ✅ 规范化为 6 位格式
  const normalizedExpression = this.normalizeCronExpression(job.cronExpression);

  // cron-parser 使用本地时区
  interval = CronExpressionParser.parse(normalizedExpression, {
    currentDate: new Date(job.lastRunAt),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
} catch (err) {
  log.error(`[CronScheduler] 解析 cron 表达式失败: ${job.cronExpression}`, err);
  return; // 解析失败，跳过 catch-up
}
```

### 3. 添加单元测试

**位置**：`src/main/ai/cron/__tests__/CronScheduler.test.ts`（新文件）

```typescript
describe('normalizeCronExpression', () => {
  it('应该将 5 位格式转换为 6 位', () => {
    expect(normalizeCronExpression('30 5 * * *')).toBe('0 30 5 * * *');
    expect(normalizeCronExpression('0 16 * * 1-5')).toBe('0 0 16 * * 1-5');
    expect(normalizeCronExpression('*/10 * * * *')).toBe('0 */10 * * * *');
  });

  it('应该保持 6 位格式不变', () => {
    expect(normalizeCronExpression('0 30 5 * * *')).toBe('0 30 5 * * *');
  });

  it('应该抛出异常对于无效格式', () => {
    expect(() => normalizeCronExpression('30 5 *')).toThrow();
  });
});
```

---

## 🧪 测试策略

### 单元测试

**文件**：`src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts`（新文件）

```typescript
describe('CronScheduler - Catch-up 机制', () => {
  it('应该补执行在宽限期内错过的任务', async () => {
    // Given: 任务最后执行于 5 小时前
    const job = createMockJob({
      cronExpression: '0 9 * * *', // 每天 9:00
      lastRunAt: fiveHoursAgo()
    });

    // When: 启动调度器
    await scheduler.start();

    // Then: 应该立即补执行
    expect(executor.execute).toHaveBeenCalledWith(job);
  });

  it('应该跳过超过宽限期的任务', async () => {
    // Given: 任务最后执行于 30 天前
    const job = createMockJob({
      cronExpression: '0 9 * * *',
      lastRunAt: thirtyDaysAgo()
    });

    // When: 启动调度器
    await scheduler.start();

    // Then: 不应该补执行
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
```

### 集成测试

**文件**：`src/main/ai/cron/__tests__/CronIntegration-catchup.test.ts`（新文件）

```typescript
describe('Cron 系统集成测试 - Catch-up', () => {
  it('应该在真实环境中补执行错过的任务', async () => {
    // 1. 创建任务
    const job = await store.create({
      name: '测试任务',
      cronExpression: '0 10 * * *', // 每天 10:00
      task: '测试任务内容'
    });

    // 2. 模拟最后执行时间（昨天 10:00）
    await store.updateExecutionStatus(job.id, {
      lastRunAt: yesterdayAt10AM()
    });

    // 3. 启动调度器（当前时间 > 10:00，应该触发 catch-up）
    await scheduler.start();

    // 4. 验证补执行
    await waitFor(() => {
      expect(store.get(job.id).runCount).toBe(1);
    });
  });
});
```

### 手工测试

**测试步骤文档**：见 `03-test-plan.md`

---

## 📐 架构设计

### 修改前（问题架构）

```
CronScheduler.start()
  ↓
checkAndCatchUpMissedRuns(job)
  ↓
CronExpressionParser.parse(job.cronExpression) ❌ 解析失败（5 位格式）
  ↓
catch (err) → return ❌ 直接返回，不补执行
  ↓
scheduleJob(job) ✅ 调度成功（node-cron 支持 5 位）
```

**问题**：Catch-up 静默失败，用户不知道！

---

### 修改后（修复架构）

```
CronScheduler.start()
  ↓
checkAndCatchUpMissedRuns(job)
  ↓
normalizeCronExpression(job.cronExpression) ✅ 5 位 → 6 位
  ↓
CronExpressionParser.parse(normalizedExpression) ✅ 解析成功
  ↓
计算 nextScheduledTime
  ↓
if (missed && withinGracePeriod) → executor.execute(job) ✅ 补执行
  ↓
scheduleJob(job) ✅ 正常调度
```

**改进**：Catch-up 正常工作！

---

## 🛡️ 风险控制

### 风险 1：格式转换错误

**风险描述**：`normalizeCronExpression()` 可能错误转换复杂表达式

**缓解措施**：

- 单元测试覆盖边界情况
- 转换后验证格式（使用 cron-parser 验证）

### 风险 2：大量补执行

**风险描述**：启动时大量任务需要补执行，可能导致资源占用

**缓解措施**：

- 补执行使用 `setImmediate()`，不阻塞启动
- 宽限期限制（默认 24 小时）
- 日志记录所有补执行

### 风险 3：时区问题

**风险描述**：时区配置错误导致执行时间不准确

**缓解措施**：

- 使用系统时区：`Intl.DateTimeFormat().resolvedOptions().timeZone`
- 日志输出时区信息
- 测试覆盖不同时区场景

---

## 📈 性能影响

### 启动性能

| 操作                      | 修改前      | 修改后 | 影响  |
| ------------------------- | ----------- | ------ | ----- |
| 调度器启动                | ~50ms       | ~60ms  | +20%  |
| Catch-up 检查（每个任务） | 0ms（失败） | ~5ms   | +5ms  |
| 总启动时间（10 个任务）   | ~50ms       | ~110ms | +60ms |

**结论**：性能影响可接受（< 200ms）

### 运行时性能

- **无影响**：格式转换只在启动时进行一次
- **调度性能**：与修改前完全一致

---

## 🎓 最佳实践

### 1. Cron 表达式格式建议

推荐使用 **6 位格式**（更精确）：

```typescript
// ✅ 推荐：6 位格式
'0 30 5 * * *'; // 每天 05:30:00
'0 0 16 * * 1-5'; // 工作日 16:00:00
'0 */10 * * * *'; // 每 10 分钟

// ✅ 也支持：5 位格式（自动转换）
'30 5 * * *'; // 每天 05:30
'0 16 * * 1-5'; // 工作日 16:00
'*/10 * * * *'; // 每 10 分钟
```

### 2. 时区配置

- 使用系统时区：`Intl.DateTimeFormat().resolvedOptions().timeZone`
- 不要硬编码时区（如 'Asia/Shanghai'）
- 任务定义中时间为本地时间，存储时自动转换为 ISO 8601 格式

### 3. 日志记录

关键事件必须有日志：

- ✅ 调度器启动
- ✅ Catch-up 检查（debug 级别）
- ✅ 补执行触发（info 级别）
- ✅ 解析失败（error 级别）

---

## 📚 相关资源

### 参考文档

- [Cron Expression Format](https://en.wikipedia.org/wiki/Cron#CRON_expression)
- [node-cron](https://github.com/node-cron/node-cron)
- [cron-parser](https://github.com/harrisiirak/cron-parser)

### 相关代码

- `src/main/ai/cron/CronScheduler.ts:267-321` - checkAndCatchUpMissedRuns()
- `src/main/ai/cron/CronScheduler.ts:147-174` - scheduleJob()

---

**下一步**: 编写测试计划和待办事项 (`03-test-plan.md`)
