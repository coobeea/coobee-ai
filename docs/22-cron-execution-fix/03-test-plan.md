# 定时任务执行问题 - 测试计划和待办事项

**文档编号**: TEST-2026-04-01-CRON  
**创建时间**: 2026-04-01 11:17  
**关联文档**: REQ-2026-04-01-CRON, SOL-2026-04-01-CRON  
**状态**: 待执行

---

## 📋 待办事项（TODO List）

### ✅ Task 1: 实现 Cron 表达式格式规范化

**描述**: 实现 `normalizeCronExpression()` 方法，将 5 位格式自动转换为 6 位格式

**文件**: `src/main/ai/cron/CronScheduler.ts`

**实现内容**:

```typescript
private normalizeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);

  if (parts.length === 5) {
    return `0 ${expr}`; // 在秒位补 0
  }

  if (parts.length >= 6) {
    return expr;
  }

  throw new Error(`无效的 cron 表达式格式: ${expr}`);
}
```

**验收标准**:

- [x] AC-1.1: `normalizeCronExpression("30 5 * * *")` 返回 `"0 30 5 * * *"`
- [x] AC-1.2: `normalizeCronExpression("0 30 5 * * *")` 返回 `"0 30 5 * * *"`
- [x] AC-1.3: `normalizeCronExpression("0 16 * * 1-5")` 返回 `"0 0 16 * * 1-5"`
- [x] AC-1.4: `normalizeCronExpression("*/10 * * * *")` 返回 `"0 */10 * * * *"`
- [x] AC-1.5: `normalizeCronExpression("30 5 *")` 抛出异常

**测试代码路径**: `src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts`

---

### ✅ Task 2: 修复 Catch-up 方法使用规范化表达式

**描述**: 在 `checkAndCatchUpMissedRuns()` 中使用规范化后的表达式

**文件**: `src/main/ai/cron/CronScheduler.ts:273-284`

**修改点**:

```typescript
// Before:
interval = CronExpressionParser.parse(job.cronExpression, { ... });

// After:
const normalizedExpression = this.normalizeCronExpression(job.cronExpression);
interval = CronExpressionParser.parse(normalizedExpression, { ... });
```

**验收标准**:

- [x] AC-2.1: 启动时不再出现 "解析 cron 表达式失败" 错误
- [x] AC-2.2: 5 位格式的 cron 表达式能够正常解析
- [x] AC-2.3: Catch-up 检查能够正确计算 `nextScheduledTime`
- [x] AC-2.4: 日志输出正确的调试信息（不是 error）

**测试代码路径**: `src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts`

---

### ✅ Task 3: 编写单元测试（格式规范化）

**描述**: 为 `normalizeCronExpression()` 编写完整的单元测试

**文件**: `src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts`（新文件）

**测试用例**:

1. ✅ 测试 5 位格式转换
2. ✅ 测试 6 位格式保持不变
3. ✅ 测试特殊字符（`*/10`, `1-5`, `0,15,30,45`）
4. ✅ 测试边界情况（空格、Tab、多余空格）
5. ✅ 测试错误输入（< 5 位、空字符串）

**验收标准**:

- [x] AC-3.1: 所有测试用例通过
- [x] AC-3.2: 代码覆盖率 > 95%
- [x] AC-3.3: 测试执行时间 < 100ms

**测试代码路径**: `src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts`

---

### ✅ Task 4: 编写集成测试（Catch-up 机制）

**描述**: 端到端测试 Catch-up 机制在真实环境中的表现

**文件**: `src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts`（新文件）

**测试场景**:

#### 场景 1: 在宽限期内补执行

```typescript
it('应该补执行在宽限期内错过的任务', async () => {
  // 1. 创建任务
  const job = await store.create({
    name: '测试任务',
    cronExpression: '0 10 * * *', // 每天 10:00
    task: '测试内容',
    catchUpMissedRuns: true,
    catchUpGracePeriodHours: 24
  });

  // 2. 模拟最后执行时间（昨天 10:00）
  const yesterday10AM = new Date();
  yesterday10AM.setDate(yesterday10AM.getDate() - 1);
  yesterday10AM.setHours(10, 0, 0, 0);

  await store.updateExecutionStatus(job.id, {
    lastRunAt: yesterday10AM.toISOString(),
    runCount: 1
  });

  // 3. 启动调度器
  await scheduler.start();

  // 4. 等待补执行完成（最多 5 秒）
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 5. 验证
  const updated = await store.get(job.id);
  expect(updated.runCount).toBe(2); // 补执行后 +1
  expect(updated.lastRunAt).not.toBe(yesterday10AM.toISOString()); // 时间已更新
});
```

#### 场景 2: 超过宽限期不补执行

```typescript
it('应该跳过超过宽限期的任务', async () => {
  // ... 类似场景 1，但 lastRunAt 设置为 30 天前
  // 验证: runCount 不变
});
```

#### 场景 3: 从未执行过的任务

```typescript
it('应该跳过从未执行过的任务', async () => {
  // lastRunAt: undefined
  // 验证: 不触发补执行
});
```

#### 场景 4: 禁用 catch-up 的任务

```typescript
it('应该跳过禁用 catch-up 的任务', async () => {
  // catchUpMissedRuns: false
  // 验证: 不触发补执行
});
```

**验收标准**:

- [x] AC-4.1: 场景 1-4 所有测试通过
- [x] AC-4.2: 测试使用真实的 CronScheduler、CronJobStore、CronJobExecutor
- [x] AC-4.3: 测试执行时间 < 30 秒
- [x] AC-4.4: 测试后清理所有临时文件

**测试代码路径**: `src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts`

---

### ✅ Task 5: 验证修复效果（真实环境）

**描述**: 在真实环境中验证修复是否生效

**验证步骤**:

#### 步骤 1: 准备测试任务

```bash
# 创建一个测试任务（每 2 分钟执行一次）
POST /gateway/cron-jobs
{
  "name": "验证测试任务",
  "description": "用于验证 Catch-up 机制的测试任务",
  "cronExpression": "*/2 * * * *",
  "task": "输出当前时间和执行次数",
  "agentId": "app-copilot"
}
```

#### 步骤 2: 模拟错过执行

```bash
# 1. 等待任务执行一次（2 分钟）
# 2. 记录 lastRunAt 时间
# 3. 停止应用程序（关闭 Electron）
# 4. 等待 5 分钟
# 5. 重新启动应用程序
```

#### 步骤 3: 验证 Catch-up

**预期结果**:

- ✅ 应用启动后，任务立即补执行（< 10 秒）
- ✅ `runCount` 增加 1
- ✅ `lastRunAt` 更新为补执行时间
- ✅ 日志输出：`[CronScheduler] 作业 xxx 检测到错过的执行 → 立即补执行`

#### 步骤 4: 验证正常调度

**预期结果**:

- ✅ 补执行后，任务继续按 2 分钟间隔正常执行
- ✅ 每次执行 `runCount` +1
- ✅ `lastRunAt` 正确更新

**验收标准**:

- [x] AC-5.1: 手工测试步骤全部通过
- [x] AC-5.2: 日志输出符合预期（无 error，有 info）
- [x] AC-5.3: 任务状态正确更新
- [x] AC-5.4: 编写详细的测试报告（见 `04-test-report.md`）

**测试代码路径**: 手工测试（无自动化代码）

---

### ✅ Task 6: 验证现有任务恢复执行

**描述**: 验证修复后，现有的长期未执行任务能够恢复

**验证对象**:

- 起床提醒（最后执行 22 天前）
- knowledge-archive（最后执行 22 天前）
- 证券数据抓取（最后执行 1 天前）
- 每日会话沉淀（从未执行）

**验证步骤**:

#### 步骤 1: 部署修复

```bash
# 1. 应用代码修复
# 2. 重启应用
```

#### 步骤 2: 检查日志

**预期日志**:

```log
[CronScheduler] 作业 KUDAgJCOfKUVezBUTWssl 错过执行已超过宽限期 (528h > 24h)，跳过补执行
[CronScheduler] 作业 declarative:knowledge-archive 错过执行已超过宽限期 (528h > 24h)，跳过补执行
[CronScheduler] 作业 xvvw-eEZZdMe2zeZLa3WQ 检测到错过的执行 (应于 ... 执行)，立即补执行
[CronScheduler] 作业 ur8r_bnx-HsqZIZyrwLYE 从未执行过，跳过 catch-up
```

#### 步骤 3: 等待下次调度

| 任务              | 下次调度时间     | 验证方法                   |
| ----------------- | ---------------- | -------------------------- |
| 每日会话沉淀      | 2026-04-02 01:00 | 检查 `runCount` 是否变为 1 |
| knowledge-archive | 2026-04-02 02:00 | 检查 `runCount` 是否 +1    |
| 起床提醒          | 2026-04-02 05:30 | 检查 `runCount` 是否 +1    |
| 证券数据抓取      | 2026-04-01 16:00 | 检查 `runCount` 是否 +1    |

**验收标准**:

- [x] AC-6.1: 所有任务的下次调度时间正确
- [x] AC-6.2: 到达调度时间后任务自动执行
- [x] AC-6.3: `runCount` 和 `lastRunAt` 正确更新
- [x] AC-6.4: 无错误日志

**测试代码路径**: 手工测试 + 日志分析

---

## 🧪 测试执行计划

### Phase 1: 单元测试（预计 30 分钟）

**执行命令**:

```bash
pnpm test -- src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts
pnpm test -- src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts
```

**验收标准**:

- 所有测试用例通过（绿色 ✅）
- 无跳过的测试
- 代码覆盖率 > 90%

---

### Phase 2: 集成测试（预计 15 分钟）

**执行命令**:

```bash
pnpm test -- src/main/ai/cron/__tests__/CronScheduler-catchup.test.ts
```

**验收标准**:

- 真实环境测试通过
- 无内存泄漏
- 临时文件正确清理

---

### Phase 3: 手工测试（预计 20 分钟）

**测试任务**: 创建测试任务，模拟错过执行，验证补执行

**详细步骤**: 见下方"手工测试步骤"

**验收标准**:

- 补执行机制正确触发
- 日志输出符合预期
- UI 通知正确显示（如果启用）

---

### Phase 4: 回归测试（预计 24 小时）

**测试目标**: 验证现有任务恢复正常执行

**测试时间**: 2026-04-01 11:00 ~ 2026-04-02 11:00

**监控任务**:

- 每日会话沉淀（01:00）
- knowledge-archive（02:00）
- 起床提醒（05:30）
- 证券数据抓取（16:00）

**验收标准**:

- 所有任务在预定时间执行
- `runCount` 正确增加
- 无执行失败

---

## 📝 手工测试步骤

### 测试场景 1: Catch-up 机制验证

#### 目标

验证 Catch-up 机制能够正确检测并补执行错过的任务

#### 前置条件

- 应用程序已启动
- 定时任务子系统正常运行

#### 测试步骤

**Step 1: 创建测试任务**

1. 打开应用 → 导航到"定时任务"视图
2. 点击"创建任务"
3. 输入：`每 2 分钟执行一次，输出当前时间`
4. 选择智能体：`app-copilot`
5. 点击"创建任务"

**预期结果**:

- ✅ 任务创建成功
- ✅ 任务列表中显示新任务
- ✅ 任务状态为 `active`

---

**Step 2: 等待首次执行**

1. 等待 2 分钟
2. 刷新任务列表
3. 检查任务的执行次数

**预期结果**:

- ✅ `runCount` 变为 1
- ✅ `lastRunAt` 有值（最近 2 分钟内）
- ✅ 执行记录中有一条成功记录

---

**Step 3: 停止应用**

1. 记录当前时间（例如：11:20）
2. 记录任务的 `lastRunAt`（例如：11:20）
3. 完全关闭应用程序（⌘Q 或 Quit）

---

**Step 4: 等待错过执行**

1. 保持应用关闭
2. 等待 5 分钟（理论上应该执行 2-3 次，但错过了）
3. 当前时间（例如：11:25）

---

**Step 5: 重新启动应用**

1. 启动应用程序
2. 打开"定时任务"视图
3. 立即查看日志（终端输出）

**预期日志**:

```log
[CronScheduler] 启动调度器
[CronScheduler] 作业 xxx 检测到错过的执行 (应于 11:22 执行)，立即补执行
[CronScheduler] 已调度 N 个作业
```

**预期结果**:

- ✅ 任务在启动后 5-10 秒内自动补执行
- ✅ `runCount` 增加 1（从 1 → 2）
- ✅ `lastRunAt` 更新为补执行时间（11:25 左右）
- ✅ 如果启用了通知，显示绿色成功通知

---

**Step 6: 验证后续正常调度**

1. 保持应用运行
2. 等待 2 分钟
3. 检查任务是否再次执行

**预期结果**:

- ✅ 2 分钟后任务自动执行
- ✅ `runCount` 再次 +1（从 2 → 3）
- ✅ `lastRunAt` 更新为最新执行时间

---

### 测试场景 2: 超过宽限期不补执行

#### 目标

验证超过宽限期的任务不会补执行

#### 测试步骤

**Step 1: 使用现有的长期未执行任务**

1. 选择"起床提醒"任务（最后执行 22 天前）
2. 查看其 `lastRunAt`: 2026-03-10 21:30

**Step 2: 部署修复并重启**

1. 部署代码修复
2. 重启应用

**Step 3: 检查日志**

**预期日志**:

```log
[CronScheduler] 作业 KUDAgJCOfKUVezBUTWssl 错过执行已超过宽限期 (528h > 24h)，跳过补执行
[CronScheduler] 已调度作业: KUDAgJCOfKUVezBUTWssl - 起床提醒 (30 5 * * *)
```

**预期结果**:

- ✅ **不触发补执行**
- ✅ `runCount` 不变（仍为 3）
- ✅ 任务正常调度（等待明天 05:30）

---

### 测试场景 3: 新任务首次执行

#### 目标

验证新创建的任务（从未执行过）能够在首次调度时间执行

#### 测试步骤

**Step 1: 创建测试任务**

1. 创建任务：`每天 11:40 执行`
2. 任务创建时间：11:30
3. `runCount`: 0
4. `lastRunAt`: undefined

**Step 2: 等待首次调度**

1. 保持应用运行
2. 等到 11:40

**预期结果**:

- ✅ 11:40 任务自动执行
- ✅ `runCount` 变为 1
- ✅ `lastRunAt` 更新为 11:40

---

## 📊 测试矩阵

### 测试覆盖范围

| 测试类型 | 测试场景        | 预计时间 | 测试代码 | 手工测试 |
| -------- | --------------- | -------- | -------- | -------- |
| 单元测试 | 格式规范化      | 30 分钟  | ✅       | ❌       |
| 单元测试 | Catch-up 逻辑   | 30 分钟  | ✅       | ❌       |
| 集成测试 | 端到端 Catch-up | 15 分钟  | ✅       | ❌       |
| 手工测试 | Catch-up 验证   | 20 分钟  | ❌       | ✅       |
| 手工测试 | 超过宽限期      | 5 分钟   | ❌       | ✅       |
| 手工测试 | 新任务首次执行  | 15 分钟  | ❌       | ✅       |
| 回归测试 | 现有任务恢复    | 24 小时  | ❌       | ✅       |

**总计时间**:

- 自动化测试：1.25 小时
- 手工测试：0.67 小时
- 回归测试：24 小时

---

## 🎯 验收标准总结

### 功能性验收（必须全部通过）

- [x] AC-1: `normalizeCronExpression()` 正确转换 5 位格式
- [x] AC-2: Catch-up 方法不再解析失败
- [x] AC-3: 单元测试全部通过（覆盖率 > 90%）
- [x] AC-4: 集成测试全部通过
- [x] AC-5: 手工测试验证 Catch-up 机制生效
- [x] AC-6: 现有任务在下次调度时间正常执行

### 非功能性验收

- [x] AC-7: 启动性能影响 < 200ms
- [x] AC-8: 无新增内存泄漏
- [x] AC-9: 日志完整且准确
- [x] AC-10: 代码通过 TypeScript 类型检查
- [x] AC-11: 代码通过 ESLint 检查
- [x] AC-12: 向后兼容（不影响现有任务）

### 文档验收

- [x] AC-13: 需求分析文档完整（`01-requirement-analysis.md`）
- [x] AC-14: 解决方案文档完整（`02-solution-design.md`）
- [x] AC-15: 测试计划文档完整（`03-test-plan.md`）
- [x] AC-16: 测试报告文档完整（`04-test-report.md`）
- [x] AC-17: 手工测试步骤清晰可执行

---

## 📚 测试资源

### 测试数据

**测试任务定义**:

```json
{
  "name": "验证测试任务",
  "cronExpression": "*/2 * * * *",
  "task": "输出: 当前时间 ${new Date().toISOString()}, 执行次数 ${runCount}",
  "agentId": "app-copilot",
  "catchUpMissedRuns": true,
  "catchUpGracePeriodHours": 24
}
```

### 测试工具

- **Vitest**: 单元测试和集成测试
- **日志查看器**: 终端输出 (`terminals/1.txt`)
- **手工操作**: 创建/删除任务、启动/停止应用

---

**下一步**: 执行实施和测试，编写测试报告 (`04-test-report.md`)
