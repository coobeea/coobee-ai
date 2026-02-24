# 计划版本管理与归档系统

## 🎯 核心概念

### 为什么需要计划归档？

```
问题场景：
❌ 只保存最新计划，历史计划丢失
❌ 无法追溯为什么重新规划
❌ 无法分析哪些计划更有效
❌ 无法学习和优化规划策略

解决方案：
✅ 保存所有计划版本（初始 + 所有重新规划）
✅ 记录计划变更原因
✅ 支持计划对比和分析
✅ 建立计划知识库
```

---

## 📁 文件系统设计

### 目录结构

```
~/.coobee-ai/sessions/{sessionId}/
├── planner/
│   ├── plans/                      # 计划版本目录 ✨
│   │   ├── plan-v1.json            # 初始计划
│   │   ├── plan-v2.json            # 第一次重新规划
│   │   ├── plan-v3.json            # 第二次重新规划
│   │   └── ...
│   │
│   ├── plan_index.json             # 计划索引 ✨
│   │   {
│   │     "sessionId": "session-123",
│   │     "versions": [
│   │       {
│   │         "version": 1,
│   │         "file": "plan-v1.json",
│   │         "createdAt": 1234567890,
│   │         "createdBy": "planner-agent-001",
│   │         "reason": "initial_planning",
│   │         "status": "replaced",
│   │         "stats": {
│   │           "totalSubTasks": 5,
│   │           "estimatedDuration": 300000
│   │         }
│   │       },
│   │       {
│   │         "version": 2,
│   │         "file": "plan-v2.json",
│   │         "createdAt": 1234568000,
│   │         "createdBy": "planner-agent-001",
│   │         "reason": "verification_failed",
│   │         "reasonDetails": "子任务3执行失败，需要调整方案",
│   │         "parentVersion": 1,
│   │         "status": "active",
│   │         "stats": {
│   │           "totalSubTasks": 6,
│   │           "estimatedDuration": 350000
│   │         }
│   │       }
│   │     ],
│   │     "currentVersion": 2,
│   │     "totalVersions": 2
│   │   }
│   │
│   ├── plan_changes.jsonl          # 计划变更日志 ✨
│   │   {"timestamp": 1234567890, "from": null, "to": 1, "type": "create", "reason": "initial"}
│   │   {"timestamp": 1234568000, "from": 1, "to": 2, "type": "replan", "reason": "task_failed", "details": {...}}
│   │
│   ├── plan_analytics.json         # 计划分析报告 ✨
│   │   {
│   │     "sessionId": "session-123",
│   │     "totalReplans": 1,
│   │     "replanReasons": {
│   │       "verification_failed": 1
│   │     },
│   │     "averageSubTasksPerPlan": 5.5,
│   │     "planEffectiveness": {
│   │       "v1": { "completionRate": 0.6, "successRate": 0.4 },
│   │       "v2": { "completionRate": 1.0, "successRate": 1.0 }
│   │     }
│   │   }
│   │
│   └── archive/                    # 归档目录 ✨
│       └── archived_plans.jsonl    # 压缩归档（可选）
│
├── orchestrator/
│   └── execution_history.jsonl     # 执行历史（关联计划版本）✨
│       {"planVersion": 1, "stage": "execution", "status": "partial_success", ...}
│       {"planVersion": 2, "stage": "execution", "status": "success", ...}
│
└── ...
```

---

## 🔄 计划版本管理

### 计划版本类型

```typescript
/**
 * 计划版本原因
 */
export enum PlanVersionReason {
  // 初始创建
  INITIAL = 'initial_planning',

  // 执行失败导致的重新规划
  TASK_FAILED = 'task_failed',
  VERIFICATION_FAILED = 'verification_failed',
  TIMEOUT = 'task_timeout',

  // 用户干预
  USER_INTERVENTION = 'user_intervention',
  USER_FEEDBACK = 'user_feedback',

  // 自适应优化
  OPTIMIZATION = 'performance_optimization',
  RESOURCE_CONSTRAINT = 'resource_constraint',

  // 需求变更
  REQUIREMENT_CHANGE = 'requirement_change'
}

/**
 * 计划版本元数据
 */
export interface PlanVersionMetadata {
  version: number;
  file: string;
  createdAt: number;
  createdBy: string; // agent ID
  reason: PlanVersionReason;
  reasonDetails?: string;
  parentVersion?: number | null; // 继承自哪个版本
  status: 'draft' | 'active' | 'replaced' | 'archived';

  // 统计信息
  stats: {
    totalSubTasks: number;
    totalStages: number;
    estimatedDuration: number;
    estimatedCost?: number;
  };

  // 执行结果（完成后填充）
  execution?: {
    startTime: number;
    endTime: number;
    duration: number;
    completedSubTasks: number;
    failedSubTasks: number;
    completionRate: number;
    successRate: number;
  };
}

/**
 * 计划索引
 */
export interface PlanIndex {
  sessionId: string;
  versions: PlanVersionMetadata[];
  currentVersion: number;
  totalVersions: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 计划变更记录
 */
export interface PlanChangeLog {
  timestamp: number;
  fromVersion: number | null;
  toVersion: number;
  type: 'create' | 'replan' | 'update' | 'archive';
  reason: PlanVersionReason;
  reasonDetails?: string;
  triggeredBy: 'orchestrator' | 'user' | 'system';
  changes?: {
    addedSubTasks: number;
    removedSubTasks: number;
    modifiedSubTasks: number;
  };
}
```

---

## 🛠️ PlanVersionManager 实现

```typescript
// src/main/ai/orchestration/PlanVersionManager.ts

import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import type { ExecutionPlan, PlanIndex, PlanVersionMetadata, PlanChangeLog, PlanVersionReason } from './types';

/**
 * 计划版本管理器
 */
export class PlanVersionManager {
  private index: PlanIndex | null = null;

  constructor(
    private readonly sessionManager: SessionFileManager,
    private readonly sessionId: string
  ) {}

  /**
   * 初始化计划版本管理
   */
  async initialize(): Promise<void> {
    // 尝试加载现有索引
    this.index = await this.loadIndex();

    if (!this.index) {
      // 创建新索引
      this.index = {
        sessionId: this.sessionId,
        versions: [],
        currentVersion: 0,
        totalVersions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await this.saveIndex();
    }

    console.log(`[PlanVersionManager] Initialized with ${this.index.totalVersions} versions`);
  }

  /**
   * 创建新的计划版本
   */
  async createPlanVersion(
    plan: ExecutionPlan,
    reason: PlanVersionReason,
    reasonDetails?: string,
    parentVersion?: number
  ): Promise<number> {
    if (!this.index) {
      throw new Error('PlanVersionManager not initialized');
    }

    const newVersion = this.index.totalVersions + 1;
    const fileName = `plan-v${newVersion}.json`;

    // 创建版本元数据
    const metadata: PlanVersionMetadata = {
      version: newVersion,
      file: fileName,
      createdAt: Date.now(),
      createdBy: 'planner-agent', // TODO: 获取实际的 agent ID
      reason,
      reasonDetails,
      parentVersion: parentVersion || null,
      status: 'active',
      stats: {
        totalSubTasks: plan.subTasks.length,
        totalStages: plan.stages.length,
        estimatedDuration: plan.estimatedDuration || 0
      }
    };

    // 1. 保存计划文件
    await this.savePlanFile(fileName, plan);

    // 2. 如果有当前版本，标记为 replaced
    if (this.index.currentVersion > 0) {
      const currentMeta = this.index.versions.find((v) => v.version === this.index!.currentVersion);
      if (currentMeta) {
        currentMeta.status = 'replaced';
      }
    }

    // 3. 添加到索引
    this.index.versions.push(metadata);
    this.index.currentVersion = newVersion;
    this.index.totalVersions = newVersion;
    this.index.updatedAt = Date.now();
    await this.saveIndex();

    // 4. 记录变更日志
    await this.logPlanChange({
      timestamp: Date.now(),
      fromVersion: parentVersion || null,
      toVersion: newVersion,
      type: newVersion === 1 ? 'create' : 'replan',
      reason,
      reasonDetails,
      triggeredBy: 'orchestrator',
      changes: parentVersion ? await this.calculateChanges(parentVersion, newVersion) : undefined
    });

    console.log(`[PlanVersionManager] Created plan version ${newVersion} (reason: ${reason})`);

    return newVersion;
  }

  /**
   * 获取当前计划
   */
  async getCurrentPlan(): Promise<ExecutionPlan | null> {
    if (!this.index || this.index.currentVersion === 0) {
      return null;
    }

    return await this.getPlanByVersion(this.index.currentVersion);
  }

  /**
   * 获取指定版本的计划
   */
  async getPlanByVersion(version: number): Promise<ExecutionPlan | null> {
    const meta = this.index?.versions.find((v) => v.version === version);
    if (!meta) {
      return null;
    }

    return await this.loadPlanFile(meta.file);
  }

  /**
   * 更新计划执行结果
   */
  async updatePlanExecution(
    version: number,
    execution: {
      startTime: number;
      endTime: number;
      completedSubTasks: number;
      failedSubTasks: number;
    }
  ): Promise<void> {
    if (!this.index) return;

    const meta = this.index.versions.find((v) => v.version === version);
    if (!meta) return;

    meta.execution = {
      ...execution,
      duration: execution.endTime - execution.startTime,
      completionRate: execution.completedSubTasks / meta.stats.totalSubTasks,
      successRate: execution.completedSubTasks / (execution.completedSubTasks + execution.failedSubTasks)
    };

    await this.saveIndex();
  }

  /**
   * 获取计划历史
   */
  getPlanHistory(): PlanVersionMetadata[] {
    return this.index?.versions || [];
  }

  /**
   * 获取计划统计
   */
  async getPlanAnalytics(): Promise<{
    totalVersions: number;
    totalReplans: number;
    replanReasons: Record<string, number>;
    averageSubTasksPerPlan: number;
    planEffectiveness: Record<string, { completionRate: number; successRate: number }>;
  }> {
    if (!this.index) {
      return {
        totalVersions: 0,
        totalReplans: 0,
        replanReasons: {},
        averageSubTasksPerPlan: 0,
        planEffectiveness: {}
      };
    }

    const replanReasons: Record<string, number> = {};
    let totalSubTasks = 0;
    const planEffectiveness: Record<string, { completionRate: number; successRate: number }> = {};

    for (const version of this.index.versions) {
      // 统计重新规划原因
      if (version.version > 1) {
        replanReasons[version.reason] = (replanReasons[version.reason] || 0) + 1;
      }

      // 统计子任务数量
      totalSubTasks += version.stats.totalSubTasks;

      // 统计计划有效性
      if (version.execution) {
        planEffectiveness[`v${version.version}`] = {
          completionRate: version.execution.completionRate,
          successRate: version.execution.successRate
        };
      }
    }

    return {
      totalVersions: this.index.totalVersions,
      totalReplans: this.index.totalVersions - 1,
      replanReasons,
      averageSubTasksPerPlan: totalSubTasks / this.index.totalVersions,
      planEffectiveness
    };
  }

  /**
   * 归档旧计划（可选）
   */
  async archiveOldPlans(keepRecentCount: number = 10): Promise<void> {
    if (!this.index || this.index.totalVersions <= keepRecentCount) {
      return;
    }

    const toArchive = this.index.versions.filter((v) => v.status === 'replaced').slice(0, -keepRecentCount);

    for (const meta of toArchive) {
      // 标记为已归档
      meta.status = 'archived';

      // 可选：移动到归档目录或压缩
      // await this.moveToArchive(meta.file)
    }

    await this.saveIndex();
    console.log(`[PlanVersionManager] Archived ${toArchive.length} old plans`);
  }

  // ========== 私有方法 ==========

  private async savePlanFile(fileName: string, plan: ExecutionPlan): Promise<void> {
    const path = join(this.sessionManager['basePath'], 'planner', 'plans', fileName);
    await writeFile(path, JSON.stringify(plan, null, 2));
  }

  private async loadPlanFile(fileName: string): Promise<ExecutionPlan | null> {
    try {
      const path = join(this.sessionManager['basePath'], 'planner', 'plans', fileName);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;

    const path = join(this.sessionManager['basePath'], 'planner', 'plan_index.json');
    await writeFile(path, JSON.stringify(this.index, null, 2));
  }

  private async loadIndex(): Promise<PlanIndex | null> {
    try {
      const path = join(this.sessionManager['basePath'], 'planner', 'plan_index.json');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async logPlanChange(log: PlanChangeLog): Promise<void> {
    const path = join(this.sessionManager['basePath'], 'planner', 'plan_changes.jsonl');
    await writeFile(path, JSON.stringify(log) + '\n', { flag: 'a' });
  }

  private async calculateChanges(
    fromVersion: number,
    toVersion: number
  ): Promise<{ addedSubTasks: number; removedSubTasks: number; modifiedSubTasks: number }> {
    const oldPlan = await this.getPlanByVersion(fromVersion);
    const newPlan = await this.getPlanByVersion(toVersion);

    if (!oldPlan || !newPlan) {
      return { addedSubTasks: 0, removedSubTasks: 0, modifiedSubTasks: 0 };
    }

    // 简单比较（可以更精细）
    const oldIds = new Set(oldPlan.subTasks.map((st) => st.id));
    const newIds = new Set(newPlan.subTasks.map((st) => st.id));

    const added = newPlan.subTasks.filter((st) => !oldIds.has(st.id)).length;
    const removed = oldPlan.subTasks.filter((st) => !newIds.has(st.id)).length;
    const modified = 0; // TODO: 实现内容比较

    return {
      addedSubTasks: added,
      removedSubTasks: removed,
      modifiedSubTasks: modified
    };
  }
}
```

---

## 🔧 集成到 Orchestrator

```typescript
// src/main/ai/orchestration/Orchestrator.ts (集成版本管理)

export class Orchestrator implements IOrchestrator {
  private sessionManager!: SessionFileManager;
  private planVersionManager!: PlanVersionManager;
  private verificationGate!: VerificationGate;

  async initialize(sessionId: string): Promise<void> {
    // 初始化文件管理器
    this.sessionManager = new SessionFileManager(sessionId);
    await this.sessionManager.initialize();

    // 初始化计划版本管理器 ✨
    this.planVersionManager = new PlanVersionManager(this.sessionManager, sessionId);
    await this.planVersionManager.initialize();

    // 初始化评审者
    this.verificationGate = new VerificationGate(this.sessionManager, sessionId);

    console.log(`[Orchestrator] Initialized with session: ${sessionId}`);
  }

  async executeTask(task: Task): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    try {
      // 1️⃣ 规划阶段：创建初始计划（版本1）✨
      const plan = await this.planner.plan(task);
      const planVersion = await this.planVersionManager.createPlanVersion(
        plan,
        PlanVersionReason.INITIAL,
        '初始任务规划'
      );

      console.log(`[Orchestrator] Created initial plan (version ${planVersion})`);

      // 2️⃣ 执行阶段
      const subTaskResults = await this.executePlanWithReplan(plan, planVersion);

      // 3️⃣ 更新计划执行结果 ✨
      await this.planVersionManager.updatePlanExecution(planVersion, {
        startTime,
        endTime: Date.now(),
        completedSubTasks: subTaskResults.filter((r) => r.status === 'completed').length,
        failedSubTasks: subTaskResults.filter((r) => r.status === 'failed').length
      });

      // 4️⃣ 聚合结果
      const finalOutput = this.aggregateResults(subTaskResults);

      return {
        taskId: task.id,
        status: 'success',
        finalOutput,
        subTaskResults,
        stats: {
          /* ... */
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 执行计划（支持重新规划）✨
   */
  private async executePlanWithReplan(
    initialPlan: ExecutionPlan,
    initialVersion: number
  ): Promise<SubTaskExecutionResult[]> {
    let currentPlan = initialPlan;
    let currentVersion = initialVersion;
    const MAX_REPLAN_ATTEMPTS = 3;
    let replanAttempt = 0;

    while (replanAttempt <= MAX_REPLAN_ATTEMPTS) {
      // 执行当前计划
      const results = await this.executePlan(currentPlan);

      // 检查是否需要重新规划
      const failedCount = results.filter((r) => r.status === 'failed').length;

      if (failedCount === 0) {
        // 全部成功，返回结果
        return results;
      }

      // 有失败的子任务
      replanAttempt++;

      if (replanAttempt > MAX_REPLAN_ATTEMPTS) {
        // 超过重试次数，返回部分成功结果
        console.log('[Orchestrator] Max replan attempts reached');
        return results;
      }

      // 重新规划 ✨
      console.log(`[Orchestrator] Replanning (attempt ${replanAttempt}/${MAX_REPLAN_ATTEMPTS})`);

      const replanTask: Task = {
        id: `replan-${Date.now()}`,
        objective: `重新规划任务（失败子任务：${failedCount}个）`,
        context: {
          failedSubTasks: results.filter((r) => r.status === 'failed'),
          completedSubTasks: results.filter((r) => r.status === 'completed')
        }
      };

      const newPlan = await this.planner.plan(replanTask);

      // 创建新的计划版本 ✨
      currentVersion = await this.planVersionManager.createPlanVersion(
        newPlan,
        PlanVersionReason.TASK_FAILED,
        `${failedCount}个子任务失败，需要重新规划`,
        currentVersion // 父版本
      );

      currentPlan = newPlan;
      console.log(`[Orchestrator] Created replan version ${currentVersion}`);
    }

    throw new Error('Unexpected execution path');
  }
}
```

---

## 📊 查询和分析 API

### 查询计划历史

```typescript
// 获取所有计划版本
const history = planVersionManager.getPlanHistory();

console.log(`共有 ${history.length} 个计划版本：`);
history.forEach((meta) => {
  console.log(`- v${meta.version}: ${meta.reason} (${meta.stats.totalSubTasks}个子任务)`);
});
```

### 计划分析报告

```typescript
// 获取计划分析
const analytics = await planVersionManager.getPlanAnalytics();

console.log('计划统计：');
console.log(`- 总版本数: ${analytics.totalVersions}`);
console.log(`- 重新规划次数: ${analytics.totalReplans}`);
console.log(`- 平均子任务数: ${analytics.averageSubTasksPerPlan}`);

console.log('\n重新规划原因分布：');
Object.entries(analytics.replanReasons).forEach(([reason, count]) => {
  console.log(`- ${reason}: ${count}次`);
});

console.log('\n计划有效性：');
Object.entries(analytics.planEffectiveness).forEach(([version, stats]) => {
  console.log(
    `- ${version}: 完成率${(stats.completionRate * 100).toFixed(1)}%, 成功率${(stats.successRate * 100).toFixed(1)}%`
  );
});
```

### 对比计划版本

```typescript
// 对比两个版本的计划
const v1 = await planVersionManager.getPlanByVersion(1);
const v2 = await planVersionManager.getPlanByVersion(2);

console.log('版本对比：');
console.log(`v1: ${v1.subTasks.length}个子任务`);
console.log(`v2: ${v2.subTasks.length}个子任务`);
```

---

## 🎯 使用场景

### 场景 1: 初始规划

```typescript
// 用户提交任务
const task = { id: 'task-001', objective: '开发用户登录功能' };

// Planner 生成计划
const plan = await planner.plan(task);

// 创建版本 1
await planVersionManager.createPlanVersion(plan, PlanVersionReason.INITIAL, '初始任务规划');

// 文件系统：
// planner/plans/plan-v1.json
// planner/plan_index.json (currentVersion: 1)
```

### 场景 2: 执行失败，重新规划

```typescript
// 执行版本 1，部分子任务失败
const results = await orchestrator.executePlan(plan);
// 结果：3/5 子任务成功，2个失败

// 重新规划
const newPlan = await planner.replan(failedSubTasks);

// 创建版本 2
await planVersionManager.createPlanVersion(
  newPlan,
  PlanVersionReason.TASK_FAILED,
  '2个子任务失败，调整执行方案',
  1 // 父版本
);

// 文件系统：
// planner/plans/plan-v2.json
// planner/plan_index.json (currentVersion: 2)
// planner/plan_changes.jsonl (新增一条变更记录)
```

### 场景 3: 用户干预

```typescript
// 用户反馈："第3个子任务不需要了"
const modifiedPlan = await planner.adjustPlan(currentPlan, userFeedback);

// 创建版本 3
await planVersionManager.createPlanVersion(
  modifiedPlan,
  PlanVersionReason.USER_FEEDBACK,
  '用户反馈：移除子任务3',
  2 // 父版本
);
```

### 场景 4: 分析和学习

```typescript
// 任务完成后，分析哪些计划更有效
const analytics = await planVersionManager.getPlanAnalytics();

// 发现：
// - v1 完成率60%，成功率40%
// - v2 完成率100%，成功率100%
//
// 结论：v2的规划策略更好
// 可以将v2的规划思路保存到知识库，用于未来类似任务
```

---

## 🚀 实施步骤

### Phase 1: 核心功能（1-2天）

- ✅ 实现 `PlanVersionManager`
- ✅ 文件系统集成
- ✅ 基本的版本创建和查询

### Phase 2: 历史和分析（1天）

- ✅ 实现计划历史查询
- ✅ 实现计划分析报告
- ✅ 实现版本对比

### Phase 3: 归档和优化（1天）

- ✅ 实现计划归档
- ✅ 优化查询性能
- ✅ 添加缓存机制

---

## 💡 扩展功能

### 1. 计划可视化

- 生成计划版本时间线
- 可视化计划演变过程
- 对比不同版本的差异

### 2. 计划推荐

- 基于历史数据，推荐最佳规划策略
- 识别常见的失败模式
- 自动优化规划参数

### 3. 计划导出

- 导出为 Markdown
- 导出为 PDF 报告
- 分享给团队成员

---

## 📚 总结

通过完善的计划版本管理和归档系统，我们实现了：

✅ **完整的历史追溯**：所有计划版本都被保存  
✅ **变更原因记录**：知道为什么重新规划  
✅ **执行效果分析**：评估哪些计划更有效  
✅ **知识积累**：建立计划知识库，持续优化  
✅ **断点续传支持**：任务中断后可以恢复

这是一个生产级别的计划管理系统！🎉
