# Agent 自动接任务机制设计

## 概述

本文档描述了 Agent 如何自动从酒馆任务系统接取任务并执行的机制设计。

## 系统架构

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   酒馆系统   │◄───────►│   Gateway    │◄───────►│  Coobee-AI  │
│  (外部系统)  │  HTTP   │              │  Event  │   主系统    │
└─────────────┘         └──────────────┘         └─────────────┘
      │                       │                         │
      │ 1. 发布任务            │ 2. 推送事件             │
      ├──────────────────────►├────────────────────────►│
      │                       │                         │ 3. Agent 选择
      │                       │                         ├─────────┐
      │                       │                         │         │
      │                       │                         │◄────────┘
      │                       │                         │
      │                       │   4. 接受任务           │
      │◄──────────────────────┼─────────────────────────┤
      │                       │                         │
      │                       │   5. 执行状态更新       │
      │◄──────────────────────┼─────────────────────────┤
      │                       │                         │
```

## 核心流程

### 1. 任务发布与监听

#### 1.1 任务发布

酒馆系统通过 HTTP API 发布任务：

```http
POST /gateway/tavern/tasks
Content-Type: application/json

{
  "title": "分析用户反馈数据",
  "description": "分析最近100条用户反馈，提取核心问题和改进建议",
  "amount": 500,
  "filePaths": ["/path/to/feedback.csv"]
}
```

#### 1.2 事件通知

Gateway 在任务创建成功后，通过 EventBridge 广播 `tavern.task.created` 事件：

```typescript
// src/main/gateway/events/TavernBridge.ts (新建)
import { EventBridge } from '@main/events/EventBridge';
import type { GatewayApi } from '@main/gateway/protocol/types';

export class TavernBridge {
  constructor(private gateway: GatewayApi) {
    this.init();
  }

  private init(): void {
    // 监听任务相关事件
    EventBridge.on('tavern.task.created', (task) => {
      // 广播给所有客户端
      this.gateway.broadcast({
        type: 'event',
        event: 'tavern.task.created',
        data: task
      });
    });

    EventBridge.on('tavern.task.updated', (task) => {
      this.gateway.broadcast({
        type: 'event',
        event: 'tavern.task.updated',
        data: task
      });
    });
  }
}
```

### 2. Agent 订阅与选择

#### 2.1 任务订阅

Coobee-AI 主系统在启动时订阅酒馆任务事件：

```typescript
// src/main/tavern/TaskListener.ts (新建)
import { EventBridge } from '@main/events/EventBridge';
import { AgentSelector } from './AgentSelector';
import type { Task } from '@main/gateway/http/tavern';

export class TaskListener {
  private selector: AgentSelector;

  constructor() {
    this.selector = new AgentSelector();
    this.init();
  }

  private init(): void {
    // 订阅新任务事件
    EventBridge.on('tavern.task.created', async (task: Task) => {
      await this.handleNewTask(task);
    });
  }

  private async handleNewTask(task: Task): Promise<void> {
    // 1. 分析任务类型和要求
    const taskType = this.analyzeTaskType(task);

    // 2. 选择合适的 Agent
    const agent = await this.selector.selectAgent(task, taskType);

    if (agent) {
      // 3. 接受任务
      await this.acceptTask(task.id, agent.id);

      // 4. 创建执行线程
      await this.createExecutionThread(task, agent);
    }
  }

  private analyzeTaskType(task: Task): string {
    // 基于任务描述分析类型
    // 可以使用 LLM 进行分类
    if (task.description.includes('分析') || task.description.includes('数据')) {
      return 'data-analysis';
    }
    if (task.description.includes('代码') || task.description.includes('开发')) {
      return 'coding';
    }
    if (task.description.includes('文档') || task.description.includes('写作')) {
      return 'writing';
    }
    return 'general';
  }

  private async acceptTask(taskId: string, agentId: string): Promise<void> {
    // 调用 Gateway API 接受任务
    await fetch(`http://localhost:8765/gateway/tavern/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'accepted',
        assignee: agentId
      })
    });
  }

  private async createExecutionThread(task: Task, agent: any): Promise<void> {
    // 创建新的执行线程
    // 传入任务详情作为初始上下文
    // ...
  }
}
```

#### 2.2 Agent 选择策略

```typescript
// src/main/tavern/AgentSelector.ts (新建)
import { AgentStore } from '@main/ai/AgentStore';
import type { Task } from '@main/gateway/http/tavern';

export interface AgentCapability {
  type: string;
  level: number; // 1-5，能力等级
}

export class AgentSelector {
  /**
   * 根据任务选择最合适的 Agent
   */
  async selectAgent(task: Task, taskType: string): Promise<any | null> {
    const agentStore = AgentStore.getInstance();
    const allAgents = agentStore.getAll();

    // 筛选条件：
    // 1. Agent 具备处理该任务类型的能力
    // 2. Agent 当前不在忙碌状态
    // 3. Agent 的能力等级足够

    const candidates = allAgents.filter((agent) => {
      return this.hasCapability(agent, taskType) && !this.isAgentBusy(agent.id) && this.meetsRequirements(agent, task);
    });

    if (candidates.length === 0) {
      return null;
    }

    // 选择策略：能力等级最高的 Agent
    return candidates.reduce((best, current) => {
      const bestLevel = this.getCapabilityLevel(best, taskType);
      const currentLevel = this.getCapabilityLevel(current, taskType);
      return currentLevel > bestLevel ? current : best;
    });
  }

  private hasCapability(agent: any, taskType: string): boolean {
    // 检查 Agent 是否具备该类型任务的能力
    const capabilities = agent.metadata?.capabilities || [];
    return capabilities.some((cap: AgentCapability) => cap.type === taskType);
  }

  private isAgentBusy(agentId: string): boolean {
    // 检查 Agent 是否正在执行其他任务
    // 可以查询 ThreadStore 看是否有该 Agent 的活跃线程
    // ...
    return false;
  }

  private meetsRequirements(agent: any, task: Task): boolean {
    // 检查 Agent 是否满足任务的特定要求
    // 例如：任务金额、复杂度等
    return true;
  }

  private getCapabilityLevel(agent: any, taskType: string): number {
    const capabilities = agent.metadata?.capabilities || [];
    const capability = capabilities.find((cap: AgentCapability) => cap.type === taskType);
    return capability?.level || 0;
  }
}
```

### 3. 任务执行与状态同步

#### 3.1 执行流程

1. **创建线程**：为任务创建专门的 Thread
2. **加载上下文**：将任务描述和文件加载到 Thread 上下文
3. **执行任务**：Agent 通过 LLM 进行推理和工具调用
4. **状态更新**：定期更新任务状态（in-progress → completed/cancelled）

```typescript
// src/main/tavern/TaskExecutor.ts (新建)
import { ThreadStore } from '@main/ai/ThreadStore';
import type { Task } from '@main/gateway/http/tavern';

export class TaskExecutor {
  async execute(task: Task, agentId: string): Promise<void> {
    // 1. 创建 Thread
    const thread = await this.createThread(task, agentId);

    // 2. 更新任务状态为 in-progress
    await this.updateTaskStatus(task.id, 'in-progress');

    // 3. 发送初始消息
    const initialPrompt = this.buildInitialPrompt(task);
    await this.sendMessage(thread.id, initialPrompt);

    // 4. 监听执行完成
    this.onThreadComplete(thread.id, async (result) => {
      await this.updateTaskStatus(task.id, 'completed');
      await this.submitResult(task.id, result);
    });
  }

  private async createThread(task: Task, agentId: string): Promise<any> {
    const threadStore = ThreadStore.getInstance();
    return await threadStore.create({
      agentId,
      title: `酒馆任务：${task.title}`,
      metadata: {
        type: 'tavern-task',
        taskId: task.id
      }
    });
  }

  private buildInitialPrompt(task: Task): string {
    let prompt = `你收到了一个酒馆任务：\n\n`;
    prompt += `**任务标题**：${task.title}\n\n`;
    prompt += `**任务描述**：\n${task.description}\n\n`;

    if (task.files.length > 0) {
      prompt += `**相关资料**：\n`;
      task.files.forEach((filePath) => {
        prompt += `- ${filePath}\n`;
      });
      prompt += `\n`;
    }

    prompt += `**赏金**：${task.amount} 金币\n\n`;
    prompt += `请分析任务要求，制定执行计划，并完成任务。`;

    return prompt;
  }

  private async updateTaskStatus(taskId: string, status: Task['status']): Promise<void> {
    await fetch(`http://localhost:8765/gateway/tavern/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
  }

  private async submitResult(taskId: string, result: any): Promise<void> {
    // 提交任务结果
    // 可以将结果保存到任务文件夹中
    // ...
  }

  private onThreadComplete(threadId: string, callback: (result: any) => void): void {
    // 监听 Thread 完成事件
    // ...
  }
}
```

## 任务类型扩展

未来可以支持更多任务类型：

### 1. 讨论型任务

- 多个 Agent 协作讨论
- 使用 Orchestrator 或 Swarm 模式
- 最终产出讨论记录和结论

### 2. 长期任务

- 支持分阶段执行
- 定期汇报进度
- 支持中途调整和优化

### 3. 竞争型任务

- 多个 Agent 同时接取
- 择优选择最佳方案
- 激励机制设计

## Agent 能力模型

### 能力定义

在 Agent 配置中添加 `capabilities` 字段：

```json
{
  "id": "agent-001",
  "name": "数据分析专家",
  "instructions": "...",
  "metadata": {
    "capabilities": [
      {
        "type": "data-analysis",
        "level": 5,
        "description": "擅长数据清洗、统计分析和可视化"
      },
      {
        "type": "coding",
        "level": 3,
        "description": "能够编写简单的数据处理脚本"
      }
    ]
  }
}
```

### 能力评估

系统可以通过以下方式评估和更新 Agent 能力：

1. **任务完成质量**：根据任务完成情况自动调整能力等级
2. **用户反馈**：允许用户对任务结果进行评价
3. **自我评估**：Agent 可以通过反思机制自我评估能力

## 配置管理

### 系统配置

```json
{
  "tavern": {
    "enabled": true,
    "autoAccept": true,
    "maxConcurrentTasks": 3,
    "taskTimeout": 3600000,
    "agentSelection": {
      "strategy": "capability-based",
      "fallbackToGeneral": true
    }
  }
}
```

## 未来优化方向

1. **智能分类**：使用 LLM 对任务进行智能分类
2. **负载均衡**：考虑 Agent 负载情况进行任务分配
3. **优先级队列**：支持任务优先级，高价值任务优先处理
4. **学习机制**：Agent 从完成的任务中学习和成长
5. **协作模式**：支持多 Agent 协作完成复杂任务

## 安全考虑

1. **任务验证**：验证任务来源的合法性
2. **资源限制**：限制任务可使用的资源（时间、内存等）
3. **沙箱执行**：任务在隔离环境中执行
4. **审批机制**：敏感操作需要人工审批

## 总结

酒馆任务系统为 Coobee-AI 提供了一个灵活的任务分发和执行框架。通过事件驱动架构和智能 Agent 选择机制，系统能够自动处理外部任务，实现真正的自主化工作流。
