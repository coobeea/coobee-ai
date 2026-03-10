# 训练模式实施方案 - 下策（基础方案）

> **定位**：最简单、最快实现的方案，验证核心概念的可行性。

---

## 方案概述

### 目标

快速实现一个可运行的训练模式 MVP，验证：

1. 完全基于 Agent 的训练流程是否可行
2. 评估-改良循环是否有效
3. 训练是否能真正提升智能体能力

### 特点

- ✅ **最简单**：功能最基础，代码量最小
- ✅ **最快**：1-2 周即可完成
- ✅ **低风险**：避免复杂的并发、分布式、UI 开发
- ❌ **功能受限**：不支持 UI、并行训练、增量训练等高级特性

---

## 功能范围

### ✅ 支持的功能

1. **基础训练循环**
   - 串行执行（N=1）
   - 固定轮次（50-100 轮）
   - 手动启动（通过命令行脚本）

2. **固定训练目标**
   - 只支持 1 个训练目标："代码生成能力"
   - 固定的评估维度和权重
   - 固定的达标线（80 分）

3. **静态数据集**
   - 手动准备 50 个训练任务（JSON 文件）
   - 不支持动态生成
   - 循环使用数据集（50 个任务可以训练 100 轮）

4. **基于 Agent 的评估**
   - 使用 `training-evaluator` Agent
   - 简单的评估逻辑（代码能否运行 + 基本代码质量）

5. **文本报告**
   - 训练完成后生成 Markdown 报告
   - 保存到 `{agentHome}/training-history/{date}.md`

### ❌ 不支持的功能

- ❌ UI 界面（Training View）
- ❌ 实时进度显示
- ❌ 并行训练
- ❌ 动态数据生成（training-data-generator Agent）
- ❌ 训练教练（training-coach Agent）
- ❌ 暂停/恢复
- ❌ 增量训练
- ❌ 可视化图表

---

## 实施步骤

### 步骤 1：准备数据集（手动）

**创建文件**：`datasets/code-generation-basic.json`

```json
{
  "name": "代码生成基础训练集",
  "category": "code-generation",
  "tasks": [
    {
      "id": "task-001",
      "description": "用 TypeScript 实现一个快速排序函数",
      "difficulty": 2,
      "expectedOutput": "可运行的快速排序函数，包含类型定义和边界处理",
      "testCase": "sortArray([3,1,4,1,5,9,2,6]) === [1,1,2,3,4,5,6,9]"
    },
    {
      "id": "task-002",
      "description": "用 TypeScript 实现一个 LRU 缓存类",
      "difficulty": 3,
      "expectedOutput": "LRUCache 类，支持 get/put 方法，容量限制",
      "testCase": "见详细测试用例"
    }
    // ... 48 more tasks
  ]
}
```

**工作量**：手动编写 50 个任务，预计 1-2 天

---

### 步骤 2：创建评估 Agent

**文件**：`agents/training-evaluator.json`

```json
{
  "id": "training-evaluator",
  "name": "训练评估器",
  "description": "评估代码生成任务的执行结果，给出量化分数",
  "instructions": [
    "你是一个专业的代码评审专家，负责评估代码质量。",
    "",
    "评估标准（代码生成能力）：",
    "1. 正确性 (40 分)：代码能否正确运行，是否通过测试用例",
    "2. 代码质量 (30 分)：命名规范、结构清晰、可读性好",
    "3. 边界处理 (20 分)：是否处理空输入、大数据、边界情况",
    "4. 性能 (10 分)：时间复杂度是否合理",
    "",
    "输出格式（严格 JSON）：",
    "{",
    "  \"score\": 85,",
    "  \"dimensions\": {",
    "    \"correctness\": 38,",
    "    \"quality\": 28,",
    "    \"edge_cases\": 15,",
    "    \"performance\": 8",
    "  },",
    "  \"passed\": true,",
    "  \"feedback\": \"代码整体质量良好，但缺少对空数组的处理...\"",
    "}",
    "",
    "注意：",
    "- 评估要客观、严格",
    "- 不要轻易给满分",
    "- feedback 要具体指出问题"
  ],
  "skills": ["dimension-architect"],
  "tools": ["exec", "read", "write"]
}
```

---

### 步骤 3：实现训练执行器

**文件**：`src/main/training/TrainingExecutor.ts`

```typescript
/**
 * 训练执行器 - 基础版本
 *
 * 功能：
 * - 串行执行训练循环
 * - 基于 Agent 的评估
 * - 简单的改进重试机制
 */

import { ChannelRuntime } from '../channels/ChannelRuntime';
import type { TrainingSession, TrainingTask, TrainingResult } from './types';

export class TrainingExecutor {
  /**
   * 执行完整训练流程（基础版）
   */
  async executeTraining(session: TrainingSession): Promise<void> {
    console.log(`[Training] 开始训练: ${session.id}, 目标: ${session.goal.name}`);

    for (let round = 1; round <= session.maxRounds; round++) {
      console.log(`[Training] 第 ${round}/${session.maxRounds} 轮...`);

      // 1. 选择训练任务（循环使用数据集）
      const taskIndex = (round - 1) % session.dataset.length;
      const task = session.dataset[taskIndex];

      // 2. 执行任务（通过被训练的 Agent）
      const output = await this.executeTask(session.agentId, task);

      // 3. 评估结果（通过评估 Agent）
      const evaluation = await this.evaluateOutput(task, output);

      // 4. 如果未达标，简单重试 1 次
      if (!evaluation.passed && round <= session.maxRounds - 1) {
        console.log(`[Training] 第 ${round} 轮未达标 (${evaluation.score}分)，重试...`);
        const retryOutput = await this.executeTask(session.agentId, task);
        evaluation = await this.evaluateOutput(task, retryOutput);
      }

      // 5. 记录结果
      const result: TrainingResult = {
        round,
        taskId: task.id,
        taskDescription: task.description,
        output,
        evaluation,
        timestamp: Date.now()
      };
      session.results.push(result);

      // 6. 简单进度日志
      console.log(`[Training] 第 ${round} 轮完成: ${evaluation.score}分 ${evaluation.passed ? '✓' : '✗'}`);

      // 7. 检查提前终止（连续 10 轮达标）
      if (this.checkEarlyStop(session)) {
        console.log(`[Training] 连续 10 轮达标，提前结束训练`);
        break;
      }
    }

    // 8. 生成报告
    await this.generateReport(session);

    console.log(`[Training] 训练完成: ${session.id}`);
  }

  /**
   * 通过 Agent 执行训练任务
   */
  private async executeTask(agentId: string, task: TrainingTask): Promise<string> {
    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId,
      userMessage: task.description,
      sessionId: `training-exec-${Date.now()}`,
      metadata: { isTrainingExecution: true }
    });

    return result.content || '';
  }

  /**
   * 通过评估 Agent 评估输出
   */
  private async evaluateOutput(task: TrainingTask, output: string): Promise<any> {
    const prompt = `
评估以下代码生成任务的结果：

**任务描述**：
${task.description}

**执行结果**：
${output}

**测试用例**：
${task.testCase || '无'}

请严格按照评估标准给出 JSON 格式的评分。
    `.trim();

    const result = await ChannelRuntime.getInstance().executeAgent({
      agentId: 'training-evaluator',
      userMessage: prompt,
      sessionId: `training-eval-${Date.now()}`,
      metadata: { isTrainingEvaluation: true }
    });

    try {
      return JSON.parse(result.content || '{}');
    } catch {
      // 如果解析失败，返回默认分数
      return {
        score: 50,
        passed: false,
        feedback: '评估 Agent 输出格式错误'
      };
    }
  }

  /**
   * 检查是否应该提前终止
   */
  private checkEarlyStop(session: TrainingSession): boolean {
    const recentResults = session.results.slice(-10);
    if (recentResults.length < 10) return false;

    return recentResults.every((r) => r.evaluation.passed);
  }

  /**
   * 生成训练报告（Markdown）
   */
  private async generateReport(session: TrainingSession): Promise<void> {
    const totalRounds = session.results.length;
    const passedCount = session.results.filter((r) => r.evaluation.passed).length;
    const avgScore = session.results.reduce((sum, r) => sum + r.evaluation.score, 0) / totalRounds;
    const finalScore = session.results[session.results.length - 1]?.evaluation.score || 0;

    const report = `
# 训练报告

## 基本信息
- 智能体: ${session.agentId}
- 训练目标: ${session.goal.name}
- 开始时间: ${new Date(session.startTime).toLocaleString()}
- 结束时间: ${new Date().toLocaleString()}
- 总耗时: ${((Date.now() - session.startTime) / 1000 / 60).toFixed(1)} 分钟

## 训练结果
- 训练轮次: ${totalRounds}
- 最终得分: ${finalScore}/100
- 平均得分: ${avgScore.toFixed(1)}/100
- 达标率: ${((passedCount / totalRounds) * 100).toFixed(1)}% (${passedCount}/${totalRounds})

## 详细记录
${session.results.map((r) => `- 第 ${r.round} 轮: ${r.evaluation.score}分 ${r.evaluation.passed ? '✓' : '✗'}`).join('\n')}
    `.trim();

    // 保存到 Agent Home
    const { Env } = await import('@main/common/env');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const agentHome = Env.getAgentHomeDir(session.agentId);
    const reportDir = path.join(agentHome, 'training-history');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `${session.id}.md`);
    fs.writeFileSync(reportPath, report, 'utf-8');

    console.log(`[Training] 报告已保存: ${reportPath}`);
  }
}
```

---

### 步骤 4：定义类型

**文件**：`src/main/training/types.ts`

```typescript
/**
 * 训练系统类型定义 - 基础版
 */

// 训练任务
export interface TrainingTask {
  id: string;
  description: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  testCase?: string;
  expectedOutput?: string;
}

// 训练目标
export interface TrainingGoal {
  name: string;
  threshold: number; // 达标分数线
}

// 训练会话
export interface TrainingSession {
  id: string;
  agentId: string;
  goal: TrainingGoal;
  dataset: TrainingTask[];
  maxRounds: number;
  startTime: number;
  results: TrainingResult[];
}

// 训练结果
export interface TrainingResult {
  round: number;
  taskId: string;
  taskDescription: string;
  output: string;
  evaluation: {
    score: number;
    passed: boolean;
    feedback: string;
    dimensions?: Record<string, number>;
  };
  timestamp: number;
}
```

---

### 步骤 5：创建启动脚本

**文件**：`scripts/run-training.ts`

```typescript
/**
 * 训练启动脚本 - 基础版
 *
 * 使用方式：
 * npm run training -- --agent=app-copilot --rounds=50
 */

import { TrainingExecutor } from '../src/main/training/TrainingExecutor';
import type { TrainingSession } from '../src/main/training/types';
import * as fs from 'node:fs';

async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  const agentId = args.find((a) => a.startsWith('--agent='))?.split('=')[1] || 'app-copilot';
  const rounds = parseInt(args.find((a) => a.startsWith('--rounds='))?.split('=')[1] || '50');

  // 加载数据集
  const datasetPath = './datasets/code-generation-basic.json';
  if (!fs.existsSync(datasetPath)) {
    console.error(`数据集不存在: ${datasetPath}`);
    process.exit(1);
  }

  const datasetRaw = fs.readFileSync(datasetPath, 'utf-8');
  const dataset = JSON.parse(datasetRaw);

  // 创建训练会话
  const session: TrainingSession = {
    id: `training-${Date.now()}`,
    agentId,
    goal: {
      name: '代码生成能力',
      threshold: 80
    },
    dataset: dataset.tasks,
    maxRounds: rounds,
    startTime: Date.now(),
    results: []
  };

  // 执行训练
  const executor = new TrainingExecutor();
  await executor.executeTraining(session);

  console.log('✅ 训练完成！');
  console.log(`📊 查看报告: {agentHome}/training-history/${session.id}.md`);
}

main().catch(console.error);
```

**package.json 添加命令**：

```json
{
  "scripts": {
    "training": "tsx scripts/run-training.ts"
  }
}
```

---

## 数据集设计

### 数据集结构

```json
{
  "name": "代码生成基础训练集",
  "category": "code-generation",
  "version": "1.0",
  "tasks": [
    {
      "id": "task-001",
      "description": "用 TypeScript 实现一个快速排序函数，要求：支持泛型、处理空数组、时间复杂度 O(nlogn)",
      "difficulty": 2,
      "expectedOutput": "function quickSort<T>(arr: T[]): T[] { ... }",
      "testCase": "quickSort([3,1,4,1,5,9,2,6]) 应返回 [1,1,2,3,4,5,6,9]",
      "tags": ["algorithm", "sorting", "array"]
    }
  ]
}
```

### 任务类型分布（50 个任务）

| 类型     | 数量 | 难度 | 示例                 |
| -------- | ---- | ---- | -------------------- |
| 基础算法 | 15   | 1-2  | 排序、查找、数组操作 |
| 数据结构 | 15   | 2-3  | 栈、队列、链表、树   |
| 算法题   | 10   | 3-4  | LeetCode 中等难度    |
| 实用函数 | 10   | 2-3  | 工具函数、辅助方法   |

---

## 评估标准（固定）

```yaml
代码生成能力评估标准：
- 正确性 (40 分)
- 代码可运行：20 分
- 通过测试用例：20 分

- 代码质量 (30 分)
- 命名规范：10 分
- 结构清晰：10 分
- 注释适当：10 分

- 边界处理 (20 分)
- 空输入处理：10 分
- 异常处理：10 分

- 性能 (10 分)
- 时间复杂度合理：5 分
- 空间复杂度合理：5 分

总分：100 分
达标线：80 分
```

---

## 实施计划

### Week 1：基础设施

| 任务                            | 工作量 | 负责人 |
| ------------------------------- | ------ | ------ |
| 准备 50 个训练任务（JSON）      | 2 天   | 人工   |
| 创建 training-evaluator Agent   | 0.5 天 | AI     |
| 实现 TrainingExecutor（基础版） | 1 天   | AI     |
| 实现 types.ts                   | 0.5 天 | AI     |

### Week 2：测试和优化

| 任务                              | 工作量 | 负责人    |
| --------------------------------- | ------ | --------- |
| 创建启动脚本                      | 0.5 天 | AI        |
| 执行首次训练（50 轮）             | 自动   | 程序      |
| 分析训练结果                      | 1 天   | 人工      |
| 优化评估标准和 Agent instructions | 1 天   | AI + 人工 |
| 执行完整训练（100 轮）            | 自动   | 程序      |

---

## 预期产出

### 1. 可运行的训练系统

- ✅ 命令行启动训练
- ✅ 自动循环执行 50-100 轮
- ✅ 基于 Agent 的评估
- ✅ 简单的改进重试
- ✅ 生成训练报告

### 2. 验证结论

- ✅ 证明完全基于 Agent 的训练流程可行
- ✅ 获得真实的训练数据和效果曲线
- ✅ 识别问题和改进点

### 3. 为中策/上策提供基础

- ✅ 核心类型定义
- ✅ Agent 定义和 instructions
- ✅ 基础架构代码

---

## 风险和限制

### 风险

1. **评估主观性**：评估 Agent 可能不够客观
   - 缓解：多次运行取平均，或在评估中使用 exec 工具运行测试

2. **数据集质量**：手动准备的 50 个任务可能不够全面
   - 缓解：先验证核心流程，后续可扩充

3. **成本**：100 轮训练可能消耗 ~10,000 tokens（约 $0.01-0.1）
   - 缓解：使用 deepseek-chat 等低成本模型

### 限制

- ❌ 不支持 UI（只能命令行）
- ❌ 不支持实时监控
- ❌ 不支持动态数据生成
- ❌ 不支持并行训练

---

## 成功标准

### 功能性

- [ ] 能成功启动训练
- [ ] 训练能正常循环 50 轮
- [ ] 评估 Agent 能给出合理分数
- [ ] 训练报告能正确生成

### 效果性

- [ ] 训练后，智能体在训练任务上的得分有提升（如 60 → 75）
- [ ] 达标率提升（如 30% → 60%）

### 稳定性

- [ ] 训练过程不会崩溃
- [ ] Agent 调用失败能优雅处理（重试或跳过）

---

## 下一步

1. **准备数据集**：手动编写 50 个代码生成任务
2. **创建 Agent**：training-evaluator
3. **实现核心代码**：TrainingExecutor + types
4. **首次训练**：运行 50 轮，观察效果
5. **根据结果决定**：是否需要中策/上策

---

**方案状态**：设计完成，待实施
**预期工作量**：2 周
**预期成本**：~$1（API 调用）
**风险等级**：低
