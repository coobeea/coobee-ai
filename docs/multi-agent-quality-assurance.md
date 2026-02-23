# 多 Agent 协作质量保证机制设计

## 问题诊断

### 当前实现的缺失

#### 1. Orchestrator（编排模式）

**当前流程**:

```
Planner（分解任务）
   ↓
Worker 1 → 执行子任务
Worker 2 → 执行子任务
Worker 3 → 执行子任务
   ↓
aggregateResults（简单拼接）  ← ❌ 问题在这里
   ↓
直接返回结果
```

**`aggregateResults()` 实现**（`src/main/ai/orchestration/Orchestrator.ts:458`）:

```typescript
private aggregateResults(plan, subTaskResults) {
  const completed = subTaskResults.filter(r => r.status === 'completed');
  const failed = subTaskResults.filter(r => r.status === 'failed');

  // ❌ 只是简单拼接输出，没有质量评估
  const lines = [`Task completed: ${completed.length}/${subTaskResults.length} subtasks succeeded.`];
  for (const r of completed) {
    lines.push(`\n--- ${subTask.name} ---`);
    lines.push(r.result);
  }

  return { summary: lines.join('\n'), results };
}
```

**缺失的环节**:

- ❌ 没有对照原始目标（`task.objective`）评估
- ❌ 没有检查子任务输出是否一致/完整
- ❌ 没有发现问题后的修复循环
- ❌ 没有最终经验沉淀

#### 2. Swarm（蜂群模式）

**当前流程**:

```
Triage（分诊）
   ↓
Specialist A（处理）
   ↓ handoff
Specialist B（继续处理）
   ↓
直接返回最后一个 Agent 的输出  ← ❌ 问题在这里
```

**代码实现**（`src/main/ai/swarm/SwarmCoordinator.ts:204`）:

```typescript
if (!handoffTarget) {
  finalOutput = output; // ❌ 直接使用最后一个 Agent 的输出
  break;
}
```

**缺失的环节**:

- ❌ 没有汇总多个 Agent 的贡献
- ❌ 没有质量评估
- ❌ 没有修复循环
- ❌ 没有经验沉淀

---

## 改进方案

### 核心思路

在多 Agent 协作后，增加一个**质量保证阶段**（QA Phase），包含：

```
1. 汇总（Summarize）  — 整合所有子任务/Agent 输出
2. 评估（Evaluate）   — 对照原始目标检查质量
3. 修复（Repair）     — 发现问题后补充/纠正（最多 3 轮）
4. 报告（Report）     — 最终输出 + 经验沉淀到智库
```

这相当于在多 Agent 层面实现**五步法的后三步**。

---

## 方案 A：专门的 QA Agent（推荐）

### 设计

在 Orchestrator/Swarm 的最后，自动调用一个**内置的 QA Agent**：

```
子任务/专家输出
   ↓
QA Agent（质量保证专家）
   ├─ 汇总所有输出
   ├─ 对照原始目标评估
   ├─ 发现问题 → 标记需要修复的子任务
   ├─ 触发修复循环（最多 3 轮）
   └─ 最终报告 + 发布经验到智库
   ↓
返回给用户
```

### QA Agent 的职责

```typescript
interface QAAgentInput {
  originalObjective: string; // 原始目标
  subTaskResults: SubTaskResult[]; // 所有子任务输出
  executionContext: {
    // 执行上下文
    rolesUsed: string[]; // 使用的角色
    handoffCount: number; // Handoff 次数
    duration: number; // 总耗时
  };
}

interface QAAgentOutput {
  summary: string; // 汇总报告
  evaluation: {
    completeness: number; // 完整性（0-1）
    accuracy: number; // 准确性（0-1）
    consistency: number; // 一致性（0-1）
    issues: string[]; // 发现的问题
  };
  needsRepair: boolean; // 是否需要修复
  repairPlan?: string[]; // 修复计划
  finalOutput: string; // 最终输出
}
```

### QA Agent 的 Instructions

````markdown
你是一个质量保证专家（QA Agent），负责在多 Agent 协作后进行质量把关。

## 核心职责

1. **汇总整合** — 将所有子任务/专家的输出整合为连贯的结果
2. **质量评估** — 对照原始目标，评估输出的完整性、准确性、一致性
3. **问题诊断** — 发现缺失、错误、矛盾之处
4. **修复决策** — 判断是否需要修复，给出修复方案
5. **经验沉淀** — 将解决方案发布到智库（使用 brain Skill）

## 评估维度

### 1. 完整性（Completeness）

- 原始目标的所有要求是否都被满足？
- 是否有遗漏的子任务或步骤？
- 输出是否包含必要的信息？

### 2. 准确性（Accuracy）

- 子任务输出是否正确？
- 是否有明显的事实错误或逻辑错误？
- 计算结果是否准确？

### 3. 一致性（Consistency）

- 不同子任务的输出是否相互矛盾？
- 术语和格式是否统一？
- 数据是否对齐？

## 工作流程

1. **读取输入**
   - 原始目标（objective）
   - 所有子任务结果（subTaskResults）
   - 执行上下文（rolesUsed, duration, etc.）

2. **汇总整合**
   - 按逻辑顺序整合子任务输出
   - 补充必要的连接和解释
   - 生成连贯的报告

3. **质量评估**
   - 对照原始目标逐项检查
   - 给出完整性/准确性/一致性评分（0-1）
   - 列出发现的问题

4. **决策判断**
   - 如果所有维度 >= 0.8 → 通过
   - 如果任一维度 < 0.6 → 必须修复
   - 0.6 - 0.8 之间 → 看问题严重程度

5. **修复或报告**
   - 需要修复 → 输出修复计划（哪个子任务需要重新执行）
   - 通过评估 → 输出最终报告
   - 发布经验到智库（使用 brain Skill）

## 输出格式

```json
{
  "summary": "完整的汇总报告...",
  "evaluation": {
    "completeness": 0.85,
    "accuracy": 0.92,
    "consistency": 0.88,
    "issues": ["子任务 2 的输出中缺少具体的实现步骤", "子任务 1 和子任务 3 的数据格式不一致"]
  },
  "needsRepair": false,
  "finalOutput": "最终给用户的输出..."
}
```
````

## 修复策略

如果 `needsRepair: true`，输出修复计划：

```json
{
  "repairPlan": ["重新执行子任务 2，要求包含具体实现步骤", "统一子任务 1 和 3 的数据格式为 JSON"]
}
```

## 智库集成

评估完成后，使用 brain Skill 发布经验：

```python
# 搜索是否有类似任务的已有方案
python skills/brain/scripts/search.py --signals "TaskType:Analysis"

# 发布新方案
python skills/brain/scripts/publish.py --file /tmp/qa_experience.json
```

````

---

### 实现位置

#### 1. Orchestrator 集成

**文件**: `src/main/ai/orchestration/Orchestrator.ts`

**修改点**（在 `executeTask` 方法的 Phase 3 之后）:

```typescript
// ── 3. 聚合阶段（当前） ──
const aggregated = this.aggregateResults(plan, subTaskResults);

// ── 🆕 4. 质量保证阶段 ──
const qaResult = await this.runQualityAssurance(task, plan, subTaskResults, aggregated);

if (qaResult.needsRepair && qaResult.repairPlan) {
  // 修复循环（最多 3 轮）
  for (let round = 0; round < 3; round++) {
    const repairedResults = await this.executeRepairPlan(task, plan, qaResult.repairPlan);
    const newQaResult = await this.runQualityAssurance(task, plan, repairedResults, aggregated);

    if (!newQaResult.needsRepair) {
      return newQaResult.finalOutput;
    }
  }
}

return qaResult.finalOutput; // 最终输出
````

#### 2. Swarm 集成

**文件**: `src/main/ai/swarm/SwarmCoordinator.ts`

**修改点**（在 `coordinate` 方法的主循环结束后）:

```typescript
// 当前: 直接返回最后一个 Agent 的输出
if (!handoffTarget) {
  finalOutput = output;
  break;
}

// 🆕 改进: 调用 QA Agent 进行质量保证
if (!handoffTarget) {
  finalOutput = await this.runQualityAssurance(task, {
    originalInput: task.input,
    agentOutputs: this.router.getCurrentChain().map((roleId) => ({
      roleId,
      output: this.context.get(roleId) // 从 context 获取每个 Agent 的输出
    })),
    context: this.context.toSummary()
  });
  break;
}
```

---

## 方案 B：嵌入式评估（轻量级）

如果不想增加专门的 QA Agent，可以在 Orchestrator/Swarm 内部实现简化的评估逻辑：

### 评估检查清单（程序化）

```typescript
class QualityChecker {
  check(objective: string, results: SubTaskResult[]): QAReport {
    const checks = [
      this.checkCompleteness(objective, results),
      this.checkConsistency(results),
      this.checkEmptyOutputs(results)
    ];

    const issues = checks.flatMap((c) => c.issues);
    const score = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;

    return {
      passed: score >= 0.8,
      score,
      issues,
      needsRepair: score < 0.6
    };
  }

  private checkCompleteness(objective: string, results: SubTaskResult[]) {
    // 简单规则：检查是否所有子任务都有输出
    const emptyCount = results.filter((r) => !r.result || r.result === '').length;
    return {
      score: 1 - emptyCount / results.length,
      issues: emptyCount > 0 ? [`${emptyCount} 个子任务输出为空`] : []
    };
  }

  private checkConsistency(results: SubTaskResult[]) {
    // 检查输出格式是否一致（简化版）
    // ...
  }
}
```

**优点**: 实现简单，无需额外 LLM 调用  
**缺点**: 无法进行深度语义分析，只能做表面检查

---

## 推荐方案：方案 A（QA Agent）

### 为什么选 QA Agent

1. **更智能**: LLM 可以进行语义层面的质量评估
2. **更灵活**: 可以根据任务类型动态调整评估标准
3. **可扩展**: 未来可以关联领域 Skill（如 `eval-refine-loop`）
4. **符合架构**: 与现有的 Agent 体系一致

### 实施步骤

#### Step 1: 创建 QA Agent 定义

**文件**: `.home/agents/qa-agent.json`（内置）

```json
{
  "id": "qa-agent",
  "name": "质量保证专家",
  "description": "多 Agent 协作后进行质量评估、汇总和修复决策",
  "instructions": "...(见上文)",
  "tools": ["read", "write", "search", "memory"],
  "skills": ["brain", "self-reflection"],
  "model": "dashscope/qwen3.5-plus",
  "thinkingLevel": "high"
}
```

#### Step 2: 修改 Orchestrator

**文件**: `src/main/ai/orchestration/Orchestrator.ts`

**新增方法**:

```typescript
/**
 * 运行质量保证阶段
 */
private async runQualityAssurance(
  task: Task,
  plan: ExecutionPlan,
  subTaskResults: SubTaskExecutionResult[],
  aggregated: { summary: string; results: unknown[] }
): Promise<QAResult> {
  log.info('[Orchestrator] Phase 4: Quality Assurance...');
  this.emit({ type: 'qa:start' });

  // 构建 QA Agent 的输入
  const qaInput = {
    originalObjective: task.objective,
    taskContext: task.context,
    plan: {
      subTasks: plan.subTasks.map(st => ({
        id: st.id,
        name: st.name,
        description: st.description
      })),
      stages: plan.stages
    },
    results: subTaskResults.map(r => ({
      subTaskId: r.subTaskId,
      status: r.status,
      output: r.result || r.error
    })),
    aggregatedSummary: aggregated.summary
  };

  // 加载 QA Agent
  const qaAgent = await this.loadQAAgent();

  // 运行评估
  const qaPrompt = this.buildQAPrompt(qaInput);
  const qaResult = await qaAgent.run(qaPrompt);

  // 解析 QA Agent 的输出
  const parsed = this.parseQAOutput(qaResult.output);

  this.emit({
    type: 'qa:done',
    data: {
      score: parsed.evaluation.score,
      needsRepair: parsed.needsRepair
    }
  });

  return parsed;
}

/**
 * 构建 QA Agent 的 Prompt
 */
private buildQAPrompt(input: QAInput): string {
  return `
请对以下多 Agent 协作任务进行质量评估：

## 原始目标
${input.originalObjective}

## 执行计划
${input.plan.subTasks.map(st => `- ${st.name}: ${st.description}`).join('\n')}

## 子任务执行结果
${input.results.map(r => `
### ${r.subTaskId}
状态: ${r.status}
输出: ${r.output}
`).join('\n')}

## 当前汇总
${input.aggregatedSummary}

请按照你的 instructions 进行评估，并输出 JSON 格式的结果。
`;
}
```

#### Step 3: 修改 Swarm

**文件**: `src/main/ai/swarm/SwarmCoordinator.ts`

**修改 `coordinate()` 方法**:

```typescript
// 当前代码（204行）
if (!handoffTarget) {
  finalOutput = output;
  break;
}

// 🆕 改进后
if (!handoffTarget) {
  // 收集所有 Agent 的输出
  const agentOutputs = this.collectAgentOutputs();

  // 运行 QA Agent
  finalOutput = await this.runQualityAssurance(task, agentOutputs);
  break;
}
```

**新增方法**:

```typescript
/**
 * 收集所有 Agent 的输出（从 SwarmContext 或 MessageBus）
 */
private collectAgentOutputs(): AgentOutput[] {
  const chain = this.router.getCurrentChain();
  return chain.map(roleId => ({
    roleId,
    output: this.context.getAgentOutput(roleId) || '',
    messages: this.messageBus.getMessagesByRole(roleId)
  }));
}

/**
 * 运行质量保证
 */
private async runQualityAssurance(
  task: SwarmTask,
  agentOutputs: AgentOutput[]
): Promise<string> {
  log.info('[Swarm] Running QA Agent...');
  this.emit({ type: 'qa:start' });

  const qaAgent = await this.loadQAAgent();

  const qaPrompt = `
原始任务: ${task.input}

协作链路: ${agentOutputs.map(a => a.roleId).join(' → ')}

各 Agent 输出:
${agentOutputs.map(a => `
## ${a.roleId}
${a.output}
`).join('\n')}

请汇总、评估并输出最终结果。
`;

  const result = await qaAgent.run(qaPrompt);

  this.emit({ type: 'qa:done' });

  return result.output;
}
```

---

## 修复循环设计

### 1. 识别需要修复的子任务

QA Agent 输出中包含 `repairPlan`:

```json
{
  "repairPlan": [
    {
      "subTaskId": "subtask-2",
      "issue": "输出中缺少具体的实现代码",
      "action": "重新执行，要求包含完整代码"
    }
  ]
}
```

### 2. 执行修复

```typescript
async executeRepairPlan(
  task: Task,
  plan: ExecutionPlan,
  repairPlan: RepairItem[]
): Promise<SubTaskExecutionResult[]> {
  const repairedResults: SubTaskExecutionResult[] = [];

  for (const repair of repairPlan) {
    const subTask = plan.subTasks.find(st => st.id === repair.subTaskId);
    if (!subTask) continue;

    // 增强子任务描述（加入修复要求）
    const enhancedSubTask = {
      ...subTask,
      description: `${subTask.description}\n\n修复要求: ${repair.action}`
    };

    // 重新执行
    const result = await this.executeSubTaskWithRetry(enhancedSubTask, task);

    repairedResults.push({
      subTaskId: subTask.id,
      status: 'completed',
      result: result.output
    });
  }

  return repairedResults;
}
```

### 3. 循环控制

```typescript
let round = 0;
const MAX_REPAIR_ROUNDS = 3;

while (qaResult.needsRepair && round < MAX_REPAIR_ROUNDS) {
  log.info(`[Orchestrator] Repair round ${round + 1}/${MAX_REPAIR_ROUNDS}`);

  const repairedResults = await this.executeRepairPlan(task, plan, qaResult.repairPlan);

  // 合并修复后的结果
  const mergedResults = this.mergeResults(subTaskResults, repairedResults);

  // 重新评估
  qaResult = await this.runQualityAssurance(task, plan, mergedResults, aggregated);

  round++;
}

if (qaResult.needsRepair) {
  log.warn('[Orchestrator] Max repair rounds reached, returning best effort result');
}
```

---

## 智库集成（关键！）

QA Agent 在评估完成后，应该自动发布经验到智库：

### 发布时机

1. **成功完成** → 发布完整方案（Pattern + Practice）
2. **部分成功** → 发布教训（哪些失败了，为什么）
3. **多次修复后成功** → 发布演进记录（Evolution）

### 发布内容

```python
# QA Agent 内部执行
experience = {
  "pattern": {
    "name": "multi-agent-data-analysis",
    "summary": "使用多 Agent 协作进行数据分析",
    "category": "optimize",
    "signals": ["DataAnalysis", "MultiStep"],
    "strategy": "先数据清洗，再统计分析，最后风险评估"
  },
  "practice": {
    "name": "securities-trading-analysis",
    "summary": "证券交易数据的三步分析流程",
    "content": f"完整的执行计划和输出...",
    "confidence": 0.85,
    "outcome": {"status": "success", "score": 0.85}
  },
  "evolution": {
    "intent": "optimize",
    "attempts": [
      {"approach": "直接分析", "result": "failure", "reason": "数据格式不一致"},
      {"approach": "先清洗再分析", "result": "success", "reason": "增加数据验证步骤"}
    ],
    "outcome": {
      "status": "success",
      "final_choice": "三步流程：清洗 → 分析 → 评估"
    }
  }
}

# 发布到智库
import json
with open('/tmp/qa_experience.json', 'w') as f:
  json.dump(experience, f, ensure_ascii=False)

exec("python skills/brain/scripts/publish.py --file /tmp/qa_experience.json")
```

---

## 事件流更新

### Orchestrator 事件

**新增事件类型**:

```typescript
export interface OrchestratorEvent {
  type:
    | 'plan:start'
    | 'plan:done'
    | 'stage:start'
    | 'stage:done'
    | 'subtask:start'
    | 'subtask:done'
    | 'subtask:failed'
    | 'subtask:retry'
    | 'aggregate:start'
    | 'aggregate:done'
    | 'qa:start'
    | 'qa:done' // 🆕 质量保证
    | 'repair:start'
    | 'repair:done' // 🆕 修复循环
    | 'brain:publish:start'
    | 'brain:publish:done'; // 🆕 智库发布
}
```

### Swarm 事件

```typescript
export type SwarmEvent =
  | { type: 'triage:start'; ... }
  | { type: 'handoff'; ... }
  | { type: 'agent:start'; ... }
  | { type: 'agent:done'; ... }
  | { type: 'qa:start'; data: { agentCount: number } }    // 🆕
  | { type: 'qa:done'; data: { score: number } }           // 🆕
  | { type: 'repair:start'; data: { round: number } }      // 🆕
  | { type: 'complete'; ... };
```

---

## UI 展示

在 ChatPanel 的执行追踪面板中显示：

```
┌──────────────────────────────────────┐
│ 🔍 Orchestrator 执行追踪             │
├──────────────────────────────────────┤
│ ✅ 规划阶段 - 3 个子任务              │
│ ✅ 执行阶段                           │
│   ✅ 子任务 1: 数据清洗 (3.2s)        │
│   ✅ 子任务 2: 统计分析 (5.1s)        │
│   ✅ 子任务 3: 风险评估 (2.8s)        │
│ ✅ 聚合阶段                           │
│ 🔬 质量保证                           │  ← 🆕
│   ├─ 完整性: 85%                     │
│   ├─ 准确性: 92%                     │
│   ├─ 一致性: 78%                     │
│   └─ 问题: 数据格式不统一             │
│ 🔧 修复循环 (第 1 轮)                 │  ← 🆕
│   └─ 重新执行子任务 1 (2.1s)         │
│ 🔬 质量保证（重新评估）               │
│   └─ 评分: 88% ✅ 通过                │
│ 📚 发布经验到智库                     │  ← 🆕
│ ✅ 完成                               │
└──────────────────────────────────────┘
```

---

## 实现优先级

### Phase 1: 核心 QA Agent（1-2 天）

1. 创建 `qa-agent.json` 定义
2. 在 Orchestrator 中集成 `runQualityAssurance()`
3. 实现基础的评估和修复循环
4. 添加事件通知

### Phase 2: Swarm 集成（1 天）

1. 在 SwarmCoordinator 中集成 QA Agent
2. 实现 `collectAgentOutputs()`
3. 测试 Swarm 模式的质量保证

### Phase 3: 智库集成（0.5 天）

1. QA Agent 自动发布经验到智库
2. 记录成功/失败/修复的案例
3. 供未来任务复用

### Phase 4: UI 展示（0.5 天）

1. 在执行追踪面板显示 QA 阶段
2. 显示评估分数和问题列表
3. 显示修复循环进度

---

## 预期效果

### Before（当前）

```
用户: 帮我分析证券交易数据
  ↓
Orchestrator: 分解为 3 个子任务
  ↓
Worker 1: 数据读取 → "读取了 100 行"
Worker 2: 统计分析 → ""（空输出）
Worker 3: 风险评估 → "风险较高"
  ↓
聚合: 简单拼接
  ↓
返回: 不完整的结果 ❌
```

### After（改进后）

```
用户: 帮我分析证券交易数据
  ↓
Orchestrator: 分解为 3 个子任务
  ↓
Worker 1: 数据读取 → "读取了 100 行"
Worker 2: 统计分析 → ""（空输出）
Worker 3: 风险评估 → "风险较高"
  ↓
聚合: 简单拼接
  ↓
🆕 QA Agent: 评估
  - 完整性: 60%（Worker 2 无输出）❌
  - 准确性: 85%
  - 一致性: 90%
  判断: 需要修复
  ↓
🆕 修复: 重新执行 Worker 2
  ↓
🆕 QA Agent: 重新评估
  - 完整性: 95% ✅
  - 准确性: 90% ✅
  - 一致性: 92% ✅
  判断: 通过
  ↓
🆕 发布经验到智库
  ↓
返回: 完整且准确的结果 ✅
```

---

## 关键配置

### 开启 QA 阶段

**文件**: `coobee.json5`

```json5
{
  orchestrator: {
    enableQA: true, // 是否启用质量保证阶段
    qaThreshold: 0.8, // 通过阈值（0-1）
    maxRepairRounds: 3, // 最大修复轮数
    autoPublishToBrain: true // 自动发布经验到智库
  },
  swarm: {
    enableQA: true,
    qaThreshold: 0.8,
    autoPublishToBrain: true
  }
}
```

---

## 相关技能

- **brain**: 发布和搜索经验
- **self-reflection**: 深度评估方法论
- **eval-refine-loop**: 维度化评估（如需更精细的评估）

---

## 注意事项

### 1. 性能开销

QA Agent 会增加额外的 LLM 调用：

- 评估: 1 次调用
- 修复（如需）: N 次调用（N = 需要修复的子任务数）
- 重新评估: 1 次调用

**优化策略**:

- 使用更快的模型（如 `qwen-turbo`）做初步评估
- 只在关键任务上启用 QA（通过配置控制）
- 设置评估超时（避免 QA 本身耗时过长）

### 2. 避免过度修复

- 设置 `maxRepairRounds = 3`（避免无限循环）
- 如果 3 轮后仍未达标 → 返回最佳努力结果 + 警告
- 记录失败案例到智库（供未来改进）

### 3. 智库污染

- 只发布**成功的**或**有价值的失败**案例
- 设置发布阈值（如 confidence >= 0.7）
- QA Agent 应判断是否值得发布（不是所有任务都需要）

---

## 实施路线图

### Week 1: 核心实现

- [ ] 创建 QA Agent 定义
- [ ] Orchestrator 集成 QA 阶段
- [ ] 基础评估和修复循环
- [ ] 单元测试

### Week 2: 功能完善

- [ ] Swarm 集成 QA 阶段
- [ ] 智库自动发布
- [ ] 配置项支持
- [ ] 事件通知

### Week 3: UI 和优化

- [ ] 执行追踪面板显示 QA
- [ ] 修复循环可视化
- [ ] 性能优化（缓存、并行）
- [ ] 端到端测试

---

**文档版本**: v1.0.0  
**创建时间**: 2026-02-24  
**状态**: 📋 设计方案（待实施）
