## Orchestration 模块使用指南

完整的 Orchestrator-Planner-Worker 协作系统，包含计划版本管理、评审验证和文件持久化。

---

## 🚀 快速开始

### 1. 初始化会话文件管理器

```typescript
import { getSessionFileManager } from '@main/ai/storage'

// 创建或获取会话文件管理器
const sessionId = 'session-' + Date.now()
const sessionManager = getSessionFileManager(sessionId)

// 初始化目录结构
await sessionManager.initialize()

// 目录已创建：~/.coobee-ai/sessions/{sessionId}/
```

### 2. 初始化计划版本管理器

```typescript
import { PlanVersionManager } from '@main/ai/orchestration'

// 创建计划版本管理器
const planVersionManager = new PlanVersionManager(sessionManager, sessionId)
await planVersionManager.initialize()
```

### 3. 创建第一个计划

```typescript
import { Planner } from '@main/ai/orchestration'
import { PlanVersionReason } from '@main/ai/orchestration'

// 定义任务
const task = {
  id: 'task-001',
  objective: '开发用户登录功能',
  requirements: ['使用 JWT 进行身份验证', '支持邮箱和手机号登录', '添加登录日志']
}

// 使用 Planner 生成计划
const planner = new Planner()
await planner.initialize()

const plan = await planner.plan(task)

// 创建计划版本 1
const version = await planVersionManager.createPlanVersion(
  plan,
  PlanVersionReason.INITIAL,
  '初始任务规划'
)

console.log(`创建了计划版本 ${version}`)
// 文件已保存：
// - planner/plans/plan-v1.json
// - planner/plan_index.json
```

---

## 📋 计划版本管理

### 查询计划

```typescript
// 获取当前计划
const currentPlan = await planVersionManager.getCurrentPlan()

// 获取当前版本号
const currentVersion = planVersionManager.getCurrentVersion()

// 获取指定版本
const v1 = await planVersionManager.getPlanByVersion(1)
```

### 查看计划历史

```typescript
// 获取所有版本
const history = planVersionManager.getPlanHistory()

console.log(`共有 ${history.length} 个计划版本：`)
history.forEach((meta) => {
  console.log(`v${meta.version}: ${meta.reason}`)
  console.log(`  - 状态: ${meta.status}`)
  console.log(`  - 子任务: ${meta.stats.totalSubTasks}个`)
  if (meta.execution) {
    console.log(`  - 成功率: ${(meta.execution.successRate * 100).toFixed(1)}%`)
  }
})
```

### 重新规划

```typescript
// 假设执行失败，需要重新规划
const failedSubTasks = results.filter((r) => r.status === 'failed')

const newTask = {
  id: `replan-${Date.now()}`,
  objective: `重新规划任务（${failedSubTasks.length}个子任务失败）`,
  context: {
    failedSubTasks,
    completedSubTasks: results.filter((r) => r.status === 'completed')
  }
}

const newPlan = await planner.plan(newTask)

// 创建新版本（版本 2）
const newVersion = await planVersionManager.createPlanVersion(
  newPlan,
  PlanVersionReason.TASK_FAILED,
  `${failedSubTasks.length}个子任务失败，需要调整方案`,
  1 // 父版本
)

// 文件已保存：
// - planner/plans/plan-v2.json
// - planner/plan_index.json (currentVersion: 2)
// - planner/plan_changes.jsonl (新增变更记录)
```

### 更新执行结果

```typescript
// 任务执行完成后，更新计划的执行结果
await planVersionManager.updatePlanExecution(version, {
  startTime: 1234567890,
  endTime: 1234568000,
  completedSubTasks: 4,
  failedSubTasks: 1
})

// 现在 plan_index.json 中会包含执行统计
```

### 分析计划效果

```typescript
const analytics = await planVersionManager.getPlanAnalytics()

console.log('计划分析：')
console.log(`- 总版本数: ${analytics.totalVersions}`)
console.log(`- 重新规划次数: ${analytics.totalReplans}`)
console.log(`- 平均子任务数: ${analytics.averageSubTasksPerPlan.toFixed(1)}`)

console.log('\n重新规划原因分布：')
Object.entries(analytics.replanReasons).forEach(([reason, count]) => {
  console.log(`- ${reason}: ${count}次`)
})

console.log('\n计划有效性：')
Object.entries(analytics.planEffectiveness).forEach(([version, stats]) => {
  console.log(
    `- ${version}: 完成率${(stats.completionRate * 100).toFixed(1)}%, ` +
      `成功率${(stats.successRate * 100).toFixed(1)}%`
  )
})
```

---

## ✅ 评审验证

### 使用内置验证规则

```typescript
import {
  VerificationGate,
  contentCompletenessRule,
  formatValidationRule,
  createMinLengthRule,
  createRequiredFieldsRule
} from '@main/ai/orchestration'

// 创建评审者
const verificationGate = new VerificationGate(sessionManager, sessionId)

// 定义验证规则
const rules = [
  contentCompletenessRule, // 检查内容不为空
  createMinLengthRule(50), // 最小长度50字符
  createRequiredFieldsRule(['code', 'description']) // 必需字段
]

// 验证子任务输出
const { passed, results } = await verificationGate.verify('subtask-001', workerOutput, rules)

if (!passed) {
  console.log('验证失败：')
  results.forEach((result) => {
    if (!result.passed) {
      console.log(`- ${result.ruleName}: ${result.message}`)
    }
  })
}
```

### 生成修复建议

```typescript
if (!passed) {
  // 收集所有问题
  const allIssues = results.flatMap((r) => r.issues || [])

  // 生成修复建议
  const fixSuggestion = await verificationGate.generateFixSuggestions(allIssues)

  console.log('修复建议：')
  console.log(fixSuggestion)

  // 输出：
  // 发现以下问题，需要修复：
  // - ERROR: 输出内容长度不足，当前30字符，要求至少50字符
  // - ERROR: 缺少必需字段: description
}
```

### 自定义验证规则

```typescript
import { createCustomRule } from '@main/ai/orchestration'

// 创建自定义规则：检查代码中是否包含注释
const hasCommentsRule = createCustomRule(
  'has-comments',
  '代码注释检查',
  (output) => {
    const code = typeof output === 'string' ? output : JSON.stringify(output)
    return code.includes('//') || code.includes('/*')
  },
  '代码中缺少注释'
)

// 使用自定义规则
const rules = [contentCompletenessRule, hasCommentsRule]
```

---

## 🔄 完整的执行流程（带验证和修复）

```typescript
import {
  Orchestrator,
  Planner,
  WorkerCoordinator,
  PlanVersionManager,
  VerificationGate,
  PlanVersionReason,
  contentCompletenessRule,
  createMinLengthRule
} from '@main/ai/orchestration'
import { getSessionFileManager } from '@main/ai/storage'

async function executeTaskWithVerification(task) {
  // 1. 初始化会话
  const sessionId = 'session-' + Date.now()
  const sessionManager = getSessionFileManager(sessionId)
  await sessionManager.initialize()

  // 2. 初始化组件
  const planner = new Planner()
  await planner.initialize()

  const workerCoordinator = new WorkerCoordinator()
  await workerCoordinator.initialize()

  const planVersionManager = new PlanVersionManager(sessionManager, sessionId)
  await planVersionManager.initialize()

  const verificationGate = new VerificationGate(sessionManager, sessionId)

  // 3. 生成初始计划
  const plan = await planner.plan(task)
  const planVersion = await planVersionManager.createPlanVersion(
    plan,
    PlanVersionReason.INITIAL,
    '初始任务规划'
  )

  // 4. 执行计划（带验证和修复循环）
  const MAX_FIX_ATTEMPTS = 3
  const results = []

  for (const subTask of plan.subTasks) {
    let attempt = 0
    let subTaskPassed = false

    while (attempt <= MAX_FIX_ATTEMPTS && !subTaskPassed) {
      // 4.1 执行子任务
      const output = await workerCoordinator.executeSubTask(subTask)
      await sessionManager.writeWorkerOutput(subTask.id, output)

      // 4.2 验证输出
      const verification = await verificationGate.verify(subTask.id, output, [
        contentCompletenessRule,
        createMinLengthRule(50)
      ])

      if (verification.passed) {
        // 验证通过
        results.push({
          subTaskId: subTask.id,
          status: 'completed',
          result: output
        })
        subTaskPassed = true
        break
      }

      // 验证失败
      attempt++

      if (attempt > MAX_FIX_ATTEMPTS) {
        // 超过重试次数
        results.push({
          subTaskId: subTask.id,
          status: 'failed',
          error: '超过最大修复尝试次数'
        })
        break
      }

      // 4.3 生成修复建议
      const allIssues = verification.results.flatMap((r) => r.issues || [])
      const fixSuggestion = await verificationGate.generateFixSuggestions(allIssues)

      // 4.4 记录修复尝试
      await sessionManager.writeFixRecord(`fix-${subTask.id}-${attempt}`, {
        subTaskId: subTask.id,
        attempt,
        method: 'llm',
        success: false
      })

      // 4.5 创建修复任务并重新执行
      console.log(`[Orchestrator] 修复尝试 ${attempt}/${MAX_FIX_ATTEMPTS}`)
      // ... 创建修复任务，继续循环
    }
  }

  // 5. 更新计划执行结果
  await planVersionManager.updatePlanExecution(planVersion, {
    startTime: Date.now() - 60000,
    endTime: Date.now(),
    completedSubTasks: results.filter((r) => r.status === 'completed').length,
    failedSubTasks: results.filter((r) => r.status === 'failed').length
  })

  // 6. 返回结果
  return {
    taskId: task.id,
    status: results.every((r) => r.status === 'completed') ? 'success' : 'partial',
    subTaskResults: results,
    planVersion
  }
}
```

---

## 📂 会话文件管理

### 读取会话信息

```typescript
// 获取会话统计
const stats = await sessionManager.getSessionStats()

console.log('会话统计：')
console.log(`- 会话ID: ${stats.sessionId}`)
console.log(`- 目录大小: ${(stats.size / 1024).toFixed(2)} KB`)
console.log(`- Workers数量: ${stats.workerCount}`)
console.log(`- 计划版本: ${stats.planVersions}`)
```

### 读取计划变更日志

```typescript
const changes = await sessionManager.readPlanChanges()

console.log('计划变更历史：')
changes.forEach((change, index) => {
  console.log(`\n变更 ${index + 1}:`)
  console.log(`- 时间: ${new Date(change.timestamp).toLocaleString()}`)
  console.log(`- 类型: ${change.type}`)
  console.log(`- 原因: ${change.reason}`)
  if (change.reasonDetails) {
    console.log(`- 详情: ${change.reasonDetails}`)
  }
})
```

### 读取验证问题

```typescript
const issues = await sessionManager.readVerificationIssues()

console.log('验证问题记录：')
issues.forEach((entry) => {
  console.log(`\n子任务 ${entry.subTaskId}:`)
  entry.issues.forEach((issue) => {
    console.log(`- [${issue.severity}] ${issue.message}`)
  })
})
```

---

## 🎯 实战示例

### 示例 1: 简单任务（单次规划）

```typescript
const task = {
  id: 'task-simple',
  objective: '编写一个排序算法'
}

// 规划 → 执行 → 完成
const result = await executeTaskWithVerification(task)
// 结果：1个计划版本，全部成功
```

### 示例 2: 复杂任务（需要重新规划）

```typescript
const task = {
  id: 'task-complex',
  objective: '开发完整的用户管理系统',
  requirements: ['用户注册、登录、注销', '权限管理', '用户资料编辑']
}

// 规划 → 执行 → 部分失败 → 重新规划 → 执行 → 成功
const result = await executeTaskWithVerification(task)
// 结果：2个计划版本
// v1: 成功率60% (3/5子任务)
// v2: 成功率100% (6/6子任务)
```

---

## 📊 监控和调试

### 查看目录结构

```bash
tree ~/.coobee-ai/sessions/session-xxx/

# 输出：
# session-xxx/
# ├── orchestrator/
# │   ├── progress.json
# │   └── decisions.jsonl
# ├── planner/
# │   ├── plans/
# │   │   ├── plan-v1.json
# │   │   └── plan-v2.json
# │   ├── plan_index.json
# │   └── plan_changes.jsonl
# ├── workers/
# │   ├── worker-001/
# │   │   ├── status.json
# │   │   ├── thinking.jsonl
# │   │   └── output.json
# │   └── worker-002/
# │       └── ...
# ├── verification/
# │   ├── checks/
# │   ├── issues.jsonl
# │   └── fixes/
# └── shared/
#     └── context.json
```

### 查看计划文件

```bash
# 查看计划索引
cat ~/.coobee-ai/sessions/session-xxx/planner/plan_index.json | jq

# 查看具体计划
cat ~/.coobee-ai/sessions/session-xxx/planner/plans/plan-v1.json | jq

# 查看计划变更
cat ~/.coobee-ai/sessions/session-xxx/planner/plan_changes.jsonl
```

---

## 🚀 最佳实践

### 1. 始终初始化会话

```typescript
// ✅ 正确
const sessionManager = getSessionFileManager(sessionId)
await sessionManager.initialize()

// ❌ 错误（未初始化）
const sessionManager = getSessionFileManager(sessionId)
await sessionManager.writePlanFile('plan.json', plan) // 会失败
```

### 2. 合理使用验证规则

```typescript
// ✅ 针对不同类型的输出使用不同的规则
if (subTask.type === 'code') {
  rules = [contentCompletenessRule, createMinLengthRule(100), hasCommentsRule]
} else if (subTask.type === 'documentation') {
  rules = [contentCompletenessRule, createMinLengthRule(200)]
}
```

### 3. 限制修复尝试次数

```typescript
// ✅ 设置合理的重试次数
const MAX_FIX_ATTEMPTS = 3

// ❌ 避免无限循环
while (true) {
  /* ... */
}
```

### 4. 定期归档旧计划

```typescript
// 保留最近10个版本，归档其余
await planVersionManager.archiveOldPlans(10)
```

---

## 📚 相关文档

- [Orchestration 改进方案](./09-orchestration-improvement-plan.md)
- [计划版本管理](./10-plan-versioning-and-archive.md)
- [Orchestrator-Worker 交互机制](./Orchestrator-Worker交互机制深度解析.md)
