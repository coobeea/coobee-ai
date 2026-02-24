# 多 Agent 质量保证闭环设计

## 核心问题分析

### 当前状态

通过代码分析，发现 **Swarm 和 Orchestrator 都缺少质量保证闭环**：

```typescript
// SwarmRuntime.ts (Line 269-273)
const finalOutput = result.output;  // ❌ 直接返回最后一个 Agent 的输出
if (result.rolesUsed.length > 0) {
  const metaInfo = `...`;  // 只添加元信息，没有校验
  yield { type: 'text:delta', content: metaInfo };
}

// OrchestratorRuntime.ts (Line 156-164)
const resultOutput = result.subTaskResults
  .filter((r) => r.status === 'completed' && r.result)
  .map((r) => String(r.result))
  .join('\n\n');  // ❌ 简单拼接，没有汇总和校验
```

### 缺失的环节

```
当前流程（不完整）:
┌──────────────────────────────────────────────┐
│ 用户请求 → 分解任务 → 多 Agent 处理 → 输出  │  ❌ 缺少闭环
└──────────────────────────────────────────────┘

应该有的完整流程:
┌────────────────────────────────────────────────────────────┐
│ 用户请求 → 分解任务 → 多 Agent 处理 → 汇总 → 校验         │
│                        ↑__________________|                 │
│                           如果未达标，自我修复              │
└────────────────────────────────────────────────────────────┘
```

---

## 设计原则

### 1. Agent 五步循环的本质

```
单 Agent:
1. Intent & Goal Extraction (意图理解)
2. Plan & Execute (计划执行)
3. Self-Evaluation (自我评估)
4. Self-Repair (自我修复)
5. Report & Memorize (报告总结)
```

### 2. 多 Agent 协作的映射

```
Swarm/Orchestrator 也应该遵循相同的五步循环：

┌─────────────────────────────────────────────────────────┐
│ 1. Intent & Goal Extraction                            │
│    → Coordinator 理解用户意图并定义验收标准              │
├─────────────────────────────────────────────────────────┤
│ 2. Plan & Execute                                       │
│    → 分解任务 + 多个子 Agent 并行/串行执行              │
├─────────────────────────────────────────────────────────┤
│ 3. Self-Evaluation (关键缺失！)                         │
│    → Coordinator 汇总结果 + 对照验收标准评估            │
├─────────────────────────────────────────────────────────┤
│ 4. Self-Repair (关键缺失！)                             │
│    → 如果未达标，重新规划或修复                          │
├─────────────────────────────────────────────────────────┤
│ 5. Report & Memorize                                    │
│    → 最终报告 + 记录经验                                │
└─────────────────────────────────────────────────────────┘
```

---

## 改进方案

### 方案 1：Coordinator 层面的质量闭环（推荐）

#### 核心思路

在 SwarmCoordinator 和 Orchestrator 中增加 **Aggregator（汇总器）** 和 **Validator（校验器）** 角色。

#### 架构设计

```typescript
interface QualityLoopConfig {
  /** 是否启用质量闭环（默认 true） */
  enabled: boolean;

  /** 最大修复次数（默认 3） */
  maxRepairRounds: number;

  /** 验收标准（可选，如果不提供则由 LLM 推断） */
  acceptanceCriteria?: AcceptanceCriteria[];

  /** 是否允许重新规划（默认 true） */
  allowReplan: boolean;
}

interface AcceptanceCriteria {
  /** 标准描述 */
  description: string;

  /** 标准类型 */
  type: 'quantifiable' | 'qualitative' | 'existence';

  /** 如何验证（可选，LLM 可以推断） */
  verifyMethod?: 'exact_match' | 'contains' | 'regex' | 'llm_judge';

  /** 期望值（如果适用） */
  expectedValue?: unknown;

  /** 权重（1-10，用于计算总分） */
  weight?: number;
}

interface EvaluationResult {
  /** 是否通过 */
  passed: boolean;

  /** 总分（0-1） */
  overallScore: number;

  /** 各项标准评分 */
  criteriaScores: {
    criterion: string;
    passed: boolean;
    score: number;
    reason: string;
  }[];

  /** 问题诊断 */
  issues: {
    severity: 'critical' | 'major' | 'minor';
    description: string;
    suggestedFix: string;
  }[];

  /** 评估耗时 */
  duration: number;
}
```

#### 实现步骤

##### Step 1: 增加 Aggregator 角色

**职责**: 汇总所有子 Agent 的输出，生成结构化的总结

```typescript
// src/main/ai/swarm/Aggregator.ts

export interface AggregationInput {
  /** 用户原始请求 */
  userRequest: string;

  /** 子任务结果列表 */
  subTaskResults: {
    taskId: string;
    agentName: string;
    output: string;
    status: 'success' | 'failed';
  }[];

  /** 协作上下文（handoff 链路） */
  collaborationContext?: string;
}

export interface AggregationResult {
  /** 汇总的最终输出 */
  finalOutput: string;

  /** 结构化摘要 */
  summary: {
    completedTasks: string[];
    failedTasks: string[];
    keyFindings: string[];
    recommendations: string[];
  };

  /** 是否完整（所有子任务都成功） */
  isComplete: boolean;
}

export class Aggregator {
  constructor(private llmClient: LLMClient) {}

  /**
   * 汇总多个子 Agent 的输出
   */
  async aggregate(input: AggregationInput): Promise<AggregationResult> {
    const prompt = `
你是一个多 Agent 协作的汇总器。你的任务是：
1. 理解用户的原始请求
2. 整合所有子 Agent 的输出
3. 生成结构化的最终结果

## 用户请求
${input.userRequest}

## 子任务执行结果
${input.subTaskResults
  .map(
    (r, i) => `
### 子任务 ${i + 1}（${r.agentName}）
状态: ${r.status}
输出:
${r.output}
`
  )
  .join('\n')}

## 你的任务
1. **汇总**: 将所有子任务的输出整合为一个连贯的、结构化的最终答案
2. **去重**: 去除重复信息
3. **补全**: 如果有子任务失败，说明缺失的部分
4. **格式化**: 使用清晰的 Markdown 格式

## 输出格式
{
  "finalOutput": "最终输出（Markdown 格式）",
  "summary": {
    "completedTasks": ["任务1", "任务2"],
    "failedTasks": ["任务3（失败原因）"],
    "keyFindings": ["发现1", "发现2"],
    "recommendations": ["建议1", "建议2"]
  },
  "isComplete": true/false
}
`;

    const response = await this.llmClient.call({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.content) as AggregationResult;
  }
}
```

##### Step 2: 增加 Validator 角色

**职责**: 对照验收标准评估汇总结果

```typescript
// src/main/ai/swarm/Validator.ts

export class Validator {
  constructor(private llmClient: LLMClient) {}

  /**
   * 评估汇总结果是否达标
   */
  async evaluate(userRequest: string, finalOutput: string, criteria?: AcceptanceCriteria[]): Promise<EvaluationResult> {
    // 如果没有提供验收标准，让 LLM 推断
    const effectiveCriteria = criteria || (await this.inferCriteria(userRequest));

    const prompt = `
你是一个严格的质量评估专家。你的任务是评估多 Agent 协作的最终输出是否达标。

## 用户请求
${userRequest}

## 最终输出
${finalOutput}

## 验收标准
${effectiveCriteria
  .map(
    (c, i) => `
${i + 1}. **${c.description}** (权重: ${c.weight || 1})
   类型: ${c.type}
   ${c.expectedValue ? `期望值: ${JSON.stringify(c.expectedValue)}` : ''}
`
  )
  .join('\n')}

## 你的任务
对每个验收标准进行评分（0-1），并诊断问题：

1. **评分**:
   - 1.0: 完全满足
   - 0.7-0.9: 基本满足，有小瑕疵
   - 0.4-0.6: 部分满足，有明显缺陷
   - 0.0-0.3: 不满足或严重缺陷

2. **诊断**:
   - 如果某项不达标，明确指出问题
   - 提供具体的修复建议

3. **总评**:
   - 计算加权总分
   - 判断是否通过（总分 >= 0.7）

## 输出格式（JSON）
{
  "passed": true/false,
  "overallScore": 0.85,
  "criteriaScores": [
    {
      "criterion": "标准1",
      "passed": true,
      "score": 0.9,
      "reason": "完全满足，输出内容包含..."
    }
  ],
  "issues": [
    {
      "severity": "major",
      "description": "缺少对XX的分析",
      "suggestedFix": "补充XX部分的详细分析"
    }
  ],
  "duration": 1234
}
`;

    const startTime = Date.now();
    const response = await this.llmClient.call({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.content) as EvaluationResult;
    result.duration = Date.now() - startTime;

    return result;
  }

  /**
   * 从用户请求推断验收标准
   */
  private async inferCriteria(userRequest: string): Promise<AcceptanceCriteria[]> {
    const prompt = `
根据用户请求推断验收标准。

## 用户请求
${userRequest}

## 你的任务
推断 2-5 个验收标准，每个标准包含：
1. 描述（清晰、可验证）
2. 类型（quantifiable/qualitative/existence）
3. 权重（1-10）

## 输出格式（JSON数组）
[
  {
    "description": "输出应包含XX分析",
    "type": "existence",
    "weight": 8
  }
]
`;

    const response = await this.llmClient.call({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.content).criteria as AcceptanceCriteria[];
  }
}
```

##### Step 3: 增加 Repairer 角色

**职责**: 根据评估结果生成修复计划

```typescript
// src/main/ai/swarm/Repairer.ts

export interface RepairPlan {
  /** 修复策略 */
  strategy: 'patch' | 'rerun_failed' | 'replan' | 'supplement';

  /** 需要重新执行的子任务 */
  tasksToRerun?: string[];

  /** 需要补充的新子任务 */
  newTasks?: {
    taskId: string;
    description: string;
    assignedAgent: string;
  }[];

  /** 对现有输出的修正指令 */
  patchInstructions?: string;

  /** 预估修复耗时 */
  estimatedDuration?: number;
}

export class Repairer {
  constructor(private llmClient: LLMClient) {}

  /**
   * 生成修复计划
   */
  async generateRepairPlan(
    userRequest: string,
    aggregationResult: AggregationResult,
    evaluationResult: EvaluationResult
  ): Promise<RepairPlan> {
    const prompt = `
你是一个多 Agent 协作的修复规划师。根据评估结果，生成修复计划。

## 用户请求
${userRequest}

## 当前输出
${aggregationResult.finalOutput}

## 评估结果
总分: ${evaluationResult.overallScore}
通过: ${evaluationResult.passed}

### 问题诊断
${evaluationResult.issues
  .map(
    (i) => `
- [${i.severity}] ${i.description}
  建议修复: ${i.suggestedFix}
`
  )
  .join('\n')}

## 你的任务
选择最优修复策略：

1. **patch（轻量修正）**: 
   - 适用场景：问题轻微，只需补充或调整
   - 操作：生成修正指令，对现有输出打补丁

2. **rerun_failed（重跑失败任务）**:
   - 适用场景：某些子任务失败导致缺失
   - 操作：重新执行失败的子任务

3. **supplement（补充新任务）**:
   - 适用场景：发现新的缺失内容
   - 操作：添加新的子任务

4. **replan（重新规划）**:
   - 适用场景：问题严重，需要重新分解任务
   - 操作：重新规划整个协作流程

## 输出格式（JSON）
{
  "strategy": "patch | rerun_failed | supplement | replan",
  "tasksToRerun": ["task-1", "task-3"],
  "newTasks": [
    {
      "taskId": "补充任务-1",
      "description": "补充XX分析",
      "assignedAgent": "业务分析专家"
    }
  ],
  "patchInstructions": "在第3段后补充...",
  "estimatedDuration": 30000
}
`;

    const response = await this.llmClient.call({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.content) as RepairPlan;
  }
}
```

##### Step 4: 集成到 SwarmCoordinator

```typescript
// src/main/ai/swarm/SwarmCoordinator.ts

export class SwarmCoordinator {
  // ... 现有代码 ...

  private aggregator: Aggregator;
  private validator: Validator;
  private repairer: Repairer;
  private qualityLoopConfig: QualityLoopConfig;

  constructor(config: SwarmConfig) {
    // ... 现有初始化 ...

    this.aggregator = new Aggregator(this.llmClient);
    this.validator = new Validator(this.llmClient);
    this.repairer = new Repairer(this.llmClient);
    this.qualityLoopConfig = config.qualityLoop || {
      enabled: true,
      maxRepairRounds: 3,
      allowReplan: true
    };
  }

  /**
   * 协作执行（增加质量闭环）
   */
  async coordinate(task: Task): Promise<CoordinationResult> {
    // Phase 1: 分解任务 + 执行
    const subTaskResults = await this.executeSubTasks(task);

    // Phase 2: 汇总（新增）
    this.emit('aggregate:start');
    const aggregationResult = await this.aggregator.aggregate({
      userRequest: task.input,
      subTaskResults
    });
    this.emit('aggregate:done', { summary: aggregationResult.summary });

    // Phase 3: 校验（新增）
    let finalOutput = aggregationResult.finalOutput;
    let repairRound = 0;

    if (this.qualityLoopConfig.enabled) {
      while (repairRound < this.qualityLoopConfig.maxRepairRounds) {
        this.emit('validate:start', { round: repairRound + 1 });

        const evaluation = await this.validator.evaluate(
          task.input,
          finalOutput,
          this.qualityLoopConfig.acceptanceCriteria
        );

        this.emit('validate:done', {
          round: repairRound + 1,
          passed: evaluation.passed,
          score: evaluation.overallScore,
          issues: evaluation.issues
        });

        // Phase 4: 自我修复（新增）
        if (evaluation.passed || evaluation.overallScore >= 0.7) {
          // 达标，跳出循环
          break;
        }

        if (repairRound >= this.qualityLoopConfig.maxRepairRounds - 1) {
          // 达到最大修复次数，报告问题但不再修复
          this.emit('repair:giveup', {
            reason: 'Max repair rounds reached',
            issues: evaluation.issues
          });
          break;
        }

        this.emit('repair:start', {
          round: repairRound + 1,
          score: evaluation.overallScore
        });

        const repairPlan = await this.repairer.generateRepairPlan(task.input, aggregationResult, evaluation);

        // 执行修复
        switch (repairPlan.strategy) {
          case 'patch':
            finalOutput = await this.applyPatch(finalOutput, repairPlan.patchInstructions!);
            break;

          case 'rerun_failed':
            const rerunResults = await this.rerunTasks(repairPlan.tasksToRerun!);
            finalOutput = await this.aggregator
              .aggregate({
                userRequest: task.input,
                subTaskResults: [...subTaskResults, ...rerunResults]
              })
              .then((r) => r.finalOutput);
            break;

          case 'supplement':
            const newResults = await this.executeNewTasks(repairPlan.newTasks!);
            finalOutput = await this.aggregator
              .aggregate({
                userRequest: task.input,
                subTaskResults: [...subTaskResults, ...newResults]
              })
              .then((r) => r.finalOutput);
            break;

          case 'replan':
            // 重新规划整个任务
            return this.coordinate(task); // 递归调用
        }

        this.emit('repair:done', {
          round: repairRound + 1,
          strategy: repairPlan.strategy
        });

        repairRound++;
      }
    }

    return {
      output: finalOutput,
      handoffCount: this.handoffCount,
      rolesUsed: this.rolesUsed,
      duration: Date.now() - this.startTime,
      state: this.state,
      qualityMetrics: {
        repairRounds: repairRound,
        finalScore: evaluation?.overallScore
      }
    };
  }
}
```

---

### 方案 2：Meta-Agent 模式（备选）

#### 核心思路

引入一个 **Meta-Agent（元智能体）** 专门负责质量保证。

```
┌─────────────────────────────────────────────────┐
│                 Meta-Agent                      │
│  职责: 汇总、校验、修复决策                      │
│  ┌───────────────────────────────────────────┐  │
│  │ 1. Aggregate: 汇总所有子 Agent 输出       │  │
│  │ 2. Validate: 对照目标评估                │  │
│  │ 3. Repair: 生成修复计划                  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         ↓ 控制                     ↑ 汇报
┌─────────────────────────────────────────────────┐
│        Swarm / Orchestrator                     │
│  (执行层: 任务分解 + 子 Agent 调度)              │
└─────────────────────────────────────────────────┘
```

#### 优势

- 职责分离更清晰
- Meta-Agent 可以跨 Swarm 和 Orchestrator 复用
- 便于单独测试和优化

#### 劣势

- 增加额外的 LLM 调用
- 需要额外的架构层

---

## UI 展示设计

### 1. 汇总阶段

```
┌─────────────────────────────────────────────────┐
│ 📊 正在汇总结果...                               │
│                                                 │
│ ✅ 证券交易处理专家 - 已完成                     │
│ ✅ 风险评估专家 - 已完成                         │
│ ✅ 业务分析专家 - 已完成                         │
│                                                 │
│ 汇总中... (3/3 完成)                            │
└─────────────────────────────────────────────────┘
```

### 2. 校验阶段

```
┌─────────────────────────────────────────────────┐
│ ✓ 正在校验结果质量...                            │
│                                                 │
│ 验收标准:                                       │
│   ✅ 包含交易数据分析 (1.0/1.0)                  │
│   ⚠️  风险评估完整性 (0.6/1.0)                   │
│   ✅ 格式清晰可读 (0.9/1.0)                      │
│                                                 │
│ 总分: 0.83 / 1.00                               │
│                                                 │
│ ⚠️  发现 1 个问题，正在修复...                    │
└─────────────────────────────────────────────────┘
```

### 3. 修复阶段

```
┌─────────────────────────────────────────────────┐
│ 🔧 自我修复 (第 1 轮)                            │
│                                                 │
│ 问题诊断:                                       │
│   • 风险评估缺少定量指标                         │
│                                                 │
│ 修复策略: supplement（补充新任务）               │
│                                                 │
│ 操作:                                           │
│   → 添加子任务: 补充风险定量分析                 │
│   → 分配给: 风险评估专家                         │
│   → 预估耗时: 30s                               │
│                                                 │
│ 执行中...                                       │
└─────────────────────────────────────────────────┘
```

### 4. 完成状态

```
┌─────────────────────────────────────────────────┐
│ ✅ 任务完成（质量检查通过）                       │
│                                                 │
│ 质量评分: 0.92 / 1.00                           │
│ 修复轮次: 1 次                                  │
│ 总耗时: 2m 45s                                  │
│                                                 │
│ [查看详细报告]                                  │
└─────────────────────────────────────────────────┘
```

---

## 配置示例

### 全局默认配置

```json5
// .home/config/coobee.json5

{
  multiAgent: {
    qualityLoop: {
      enabled: true,
      maxRepairRounds: 3,
      allowReplan: true,
      autoInferCriteria: true, // 自动推断验收标准
      minPassScore: 0.7, // 最低通过分数

      // 超时保护
      timeout: {
        aggregate: 30000, // 汇总超时 30s
        validate: 20000, // 校验超时 20s
        repair: 60000 // 修复超时 60s
      }
    }
  }
}
```

### Agent 级别覆盖

```json5
// .home/agents/证券分析专家组.json

{
  id: 'securities-analyst-swarm',
  name: '证券分析专家组（Swarm）',
  type: 'swarm',
  runtime: {
    swarm: {
      qualityLoop: {
        enabled: true,
        maxRepairRounds: 5, // 覆盖全局配置
        acceptanceCriteria: [
          {
            description: '输出包含风险评分（0-100）',
            type: 'quantifiable',
            verifyMethod: 'regex',
            expectedValue: '风险评分[：:]\\s*\\d+',
            weight: 10
          },
          {
            description: '输出包含交易建议',
            type: 'existence',
            weight: 8
          }
        ]
      }
    }
  }
}
```

---

## 测试验证方案

### 测试 1: 汇总功能

```typescript
// test/aggregator.test.ts

describe('Aggregator', () => {
  it('should aggregate multiple agent outputs', async () => {
    const aggregator = new Aggregator(llmClient);

    const input: AggregationInput = {
      userRequest: '分析证券交易数据并评估风险',
      subTaskResults: [
        {
          taskId: 'task-1',
          agentName: '数据处理专家',
          output: '处理了 1000 条交易记录...',
          status: 'success'
        },
        {
          taskId: 'task-2',
          agentName: '风险评估专家',
          output: '风险评分: 65/100...',
          status: 'success'
        }
      ]
    };

    const result = await aggregator.aggregate(input);

    expect(result.finalOutput).toContain('交易记录');
    expect(result.finalOutput).toContain('风险评分');
    expect(result.summary.completedTasks).toHaveLength(2);
    expect(result.isComplete).toBe(true);
  });
});
```

### 测试 2: 校验功能

```typescript
describe('Validator', () => {
  it('should evaluate output against criteria', async () => {
    const validator = new Validator(llmClient);

    const criteria: AcceptanceCriteria[] = [
      {
        description: '包含风险评分',
        type: 'existence',
        weight: 10
      },
      {
        description: '包含交易建议',
        type: 'existence',
        weight: 8
      }
    ];

    const result = await validator.evaluate('分析证券交易数据', '风险评分: 65/100。建议: 谨慎交易', criteria);

    expect(result.passed).toBe(true);
    expect(result.overallScore).toBeGreaterThan(0.7);
    expect(result.criteriaScores).toHaveLength(2);
  });

  it('should fail when criteria not met', async () => {
    const validator = new Validator(llmClient);

    const result = await validator.evaluate(
      '分析证券交易数据',
      '这是一些数据...', // 缺少风险评分和建议
      [
        { description: '包含风险评分', type: 'existence', weight: 10 },
        { description: '包含交易建议', type: 'existence', weight: 8 }
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
```

### 测试 3: 修复功能

```typescript
describe('Repairer', () => {
  it('should generate patch strategy for minor issues', async () => {
    const repairer = new Repairer(llmClient);

    const evaluationResult: EvaluationResult = {
      passed: false,
      overallScore: 0.65,
      criteriaScores: [
        /* ... */
      ],
      issues: [
        {
          severity: 'minor',
          description: '缺少风险等级分类',
          suggestedFix: '补充风险等级（低/中/高）'
        }
      ],
      duration: 1000
    };

    const plan = await repairer.generateRepairPlan('分析证券交易数据', aggregationResult, evaluationResult);

    expect(plan.strategy).toBe('patch');
    expect(plan.patchInstructions).toContain('补充');
  });

  it('should generate replan strategy for major issues', async () => {
    const evaluationResult: EvaluationResult = {
      passed: false,
      overallScore: 0.3,
      issues: [
        {
          severity: 'critical',
          description: '完全偏离用户需求',
          suggestedFix: '重新理解需求并规划'
        }
      ]
    };

    const plan = await repairer.generateRepairPlan('分析证券交易数据', aggregationResult, evaluationResult);

    expect(plan.strategy).toBe('replan');
  });
});
```

---

## 实施优先级

### P0（立即实施，1-2 天）

1. **Aggregator 基础实现**
   - 汇总多个子 Agent 输出
   - 生成结构化摘要
   - 集成到 SwarmCoordinator

2. **简单校验机制**
   - 推断验收标准
   - 基础评分系统
   - 阈值判断（通过/不通过）

3. **UI 反馈**
   - 汇总阶段提示
   - 校验结果显示
   - 修复进度提示

### P1（后续优化，2-3 天）

1. **Validator 完善**
   - 多维度评分
   - 问题诊断
   - 自定义验收标准

2. **Repairer 实现**
   - 修复策略选择
   - 自动修复执行
   - 最大轮次控制

3. **质量报告**
   - 详细评估报告
   - 修复历史记录
   - 质量趋势分析

### P2（长期优化，按需）

1. **智能化增强**
   - 从历史中学习验收标准
   - 优化修复策略选择
   - 预测质量风险

2. **性能优化**
   - 并行评估
   - 缓存优化
   - 超时控制

---

## 与现有系统的兼容性

### 向后兼容

```typescript
// 默认禁用质量闭环，保持现有行为
const config: SwarmConfig = {
  qualityLoop: {
    enabled: false // 默认值
  }
};

// 用户可以通过配置启用
const config: SwarmConfig = {
  qualityLoop: {
    enabled: true,
    maxRepairRounds: 3
  }
};
```

### 渐进式启用

```
阶段 1: 只启用 Aggregator（汇总）
  → 改善输出的连贯性和结构化

阶段 2: 启用 Validator（校验）
  → 增加质量可见性，但不自动修复

阶段 3: 启用 Repairer（修复）
  → 完整的质量保证闭环
```

---

## 总结

### 核心改进

1. **从"直接输出"变为"汇总→校验→修复"**
2. **引入质量保证闭环，遵循 Agent 五步循环**
3. **提供可配置的验收标准和修复策略**
4. **增加 UI 可观测性，让用户看到质量保证过程**

### 预期效果

- ✅ 多 Agent 协作输出质量显著提升
- ✅ 减少"一轮就给结果"的草率行为
- ✅ 增强用户对系统的信任
- ✅ 积累质量评估经验，持续优化

### 实施建议

**先实施 Swarm**（因为更灵活），再推广到 Orchestrator。

**快速验证**：

1. 先实现 Aggregator（1 天）
2. 观察汇总效果
3. 再实现 Validator + Repairer（1-2 天）
4. 逐步启用质量闭环

---

**文档版本**: v1.0.0  
**创建时间**: 2026-02-24  
**状态**: 📋 设计方案（待讨论实施优先级）
