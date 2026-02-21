# 酒馆任务系统 - Agent 自动对接架构设计

## 1. 概述

### 1.1 设计目标

将**酒馆任务系统**视为一个**独立的外部系统**，通过 **Gateway Extension 机制**实现与 Coobee-AI 主系统的松耦合对接，让 Agent 能够：

1. **自动发现**：监听酒馆发布的新任务
2. **智能决策**：分析任务需求，判断是否接取
3. **自主执行**：创建工作线程，完成任务并提交结果
4. **状态同步**：实时同步任务执行状态

### 1.2 架构原则

- **松耦合**：酒馆系统与主系统独立部署，仅通过 Gateway 接口通信
- **可扩展**：通过 Extension 机制实现，支持热插拔
- **异步驱动**：基于事件总线（EventBus）的异步通信模式
- **工具化**：将酒馆 API 封装为 Agent 工具，支持主动调用

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       Coobee-AI 主系统                           │
│                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │   Agent     │◄────►│ AgentExecutor│◄────►│  ToolRegistry│   │
│  │  (执行层)    │      │              │      │              │   │
│  └─────────────┘      └──────────────┘      └──────┬───────┘   │
│         ▲                                            │           │
│         │                                            │           │
│         │                                            ▼           │
│         │                                   ┌──────────────┐    │
│         │                                   │ tavern_*     │    │
│         │                                   │ (酒馆工具)    │    │
│         │                                   └──────┬───────┘    │
│         │                                            │           │
│  ┌──────┴────────┐                                  │           │
│  │  EventBus     │                                  │           │
│  │  (事件总线)    │                                  │           │
│  └──────┬────────┘                                  │           │
│         │                                            │           │
│         │          ┌──────────────┐                 │           │
│         └─────────►│   Gateway    │◄────────────────┘           │
│                    │              │                              │
│                    └──────┬───────┘                              │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │ HTTP/WebSocket
                            │
                 ┌──────────▼─────────────┐
                 │  Tavern Extension      │
                 │  (酒馆扩展插件)         │
                 │                        │
                 │  • TaskBridge (事件)   │
                 │  • TavernTools (工具)  │
                 │  • Gateway Methods     │
                 └──────────┬─────────────┘
                            │ HTTP API
                            │
              ┌─────────────▼───────────────┐
              │   酒馆任务系统 (外部)         │
              │                             │
              │  • HTTP API Server          │
              │  • Task Storage (JSONL)     │
              │  • File Management          │
              └─────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 Tavern Extension（酒馆扩展）

**职责**：作为独立扩展插件，桥接酒馆系统与 Coobee-AI 主系统

**实现路径**：`extensions/tavern-integration/`

**核心功能**：

1. **事件桥接（TaskBridge）**：监听酒馆事件，转发到主系统
2. **工具注册（TavernTools）**：封装酒馆 API 为 Agent 工具
3. **Gateway 方法（TavernGateway）**：提供前端调用的 RPC 方法

#### 2.2.2 Agent 自动接取服务（TaskAcceptanceService）

**职责**：监听任务事件，智能决策是否接取并执行

**实现路径**：`src/main/ai/services/TaskAcceptanceService.ts`

**核心功能**：

1. 订阅 `tavern.task.created` 事件
2. 分析任务需求（类型、复杂度、技能要求）
3. 匹配合适的 Agent
4. 自动接取并创建执行 Thread

#### 2.2.3 酒馆工具集（Tavern Tools）

**职责**：将酒馆 API 封装为 Agent 可调用的工具

**实现工具**：

- `tavern_list_tasks`：查询任务列表
- `tavern_get_task`：获取任务详情
- `tavern_accept_task`：接受任务
- `tavern_update_status`：更新任务状态
- `tavern_submit_result`：提交任务结果

---

## 3. 数据流与交互时序

### 3.1 任务发布流程

```
┌───────┐       ┌────────┐       ┌─────────┐       ┌────────┐       ┌────────┐
│ 用户  │       │ 酒馆   │       │ Tavern  │       │Gateway │       │ Agent  │
│       │       │ 系统   │       │Extension│       │EventBus│       │执行层  │
└───┬───┘       └───┬────┘       └────┬────┘       └───┬────┘       └───┬────┘
    │               │                  │                │                │
    │ 1. 发布任务   │                  │                │                │
    ├──────────────►│                  │                │                │
    │               │                  │                │                │
    │               │ 2. 存储任务      │                │                │
    │               ├─────────┐        │                │                │
    │               │         │        │                │                │
    │               │◄────────┘        │                │                │
    │               │                  │                │                │
    │               │ 3. Webhook通知   │                │                │
    │               ├─────────────────►│                │                │
    │               │                  │                │                │
    │               │                  │ 4. emit event  │                │
    │               │                  ├───────────────►│                │
    │               │                  │                │                │
    │               │                  │                │ 5. 任务通知    │
    │               │                  │                ├───────────────►│
    │               │                  │                │                │
    │               │                  │                │ 6. 分析决策    │
    │               │                  │                │◄───────────────┤
    │               │                  │                │                │
```

### 3.2 任务接取与执行流程

```
┌────────┐       ┌─────────┐       ┌────────┐       ┌─────────┐
│ Agent  │       │ Tavern  │       │ Thread │       │ 酒馆    │
│执行层  │       │ Tools   │       │ Store  │       │ 系统    │
└───┬────┘       └────┬────┘       └───┬────┘       └────┬────┘
    │                 │                 │                 │
    │ 1. 决策接取     │                 │                 │
    ├────────────────►│                 │                 │
    │                 │                 │                 │
    │                 │ 2. accept_task  │                 │
    │                 ├────────────────────────────────────►
    │                 │                 │                 │
    │                 │◄───── 200 OK ───────────────────┤
    │                 │                 │                 │
    │◄────────────────┤                 │                 │
    │                 │                 │                 │
    │ 3. 创建Thread   │                 │                 │
    ├────────────────────────────────►  │                 │
    │                 │                 │                 │
    │                 │                 │ 4. 返回Thread   │
    │◄────────────────────────────────┤                 │
    │                 │                 │                 │
    │ 5. 开始执行     │                 │                 │
    ├─────────┐       │                 │                 │
    │         │       │                 │                 │
    │◄────────┘       │                 │                 │
    │                 │                 │                 │
    │ 6. 更新状态     │                 │                 │
    ├────────────────►│                 │                 │
    │                 │                 │                 │
    │                 │ 7. update_status│                 │
    │                 ├────────────────────────────────────►
    │                 │                 │                 │
```

---

## 4. 详细设计

### 4.1 Tavern Extension 实现

#### 4.1.1 目录结构

```
extensions/tavern-integration/
├── extension.json          # 扩展元数据
├── index.ts               # 入口文件
├── src/
│   ├── TaskBridge.ts      # 事件桥接
│   ├── TavernTools.ts     # 工具定义
│   ├── TavernClient.ts    # 酒馆 API 客户端
│   └── types.ts           # 类型定义
└── package.json
```

#### 4.1.2 extension.json

```json
{
  "id": "tavern-integration",
  "name": "Tavern Integration",
  "version": "1.0.0",
  "description": "Integrate external Tavern task system with Coobee-AI agents",
  "main": "index.ts",
  "contributes": {
    "tools": [
      "tavern_list_tasks",
      "tavern_get_task",
      "tavern_accept_task",
      "tavern_update_status",
      "tavern_submit_result"
    ],
    "gatewayMethods": [
      "tavern.getTasks",
      "tavern.getTask",
      "tavern.createTask",
      "tavern.updateTask",
      "tavern.deleteTask"
    ],
    "settings": {
      "tavern.baseUrl": {
        "type": "string",
        "default": "http://localhost:8765",
        "description": "Tavern system base URL"
      },
      "tavern.autoAccept": {
        "type": "boolean",
        "default": true,
        "description": "Enable automatic task acceptance"
      },
      "tavern.maxConcurrent": {
        "type": "number",
        "default": 3,
        "description": "Maximum concurrent tasks"
      }
    }
  }
}
```

#### 4.1.3 index.ts（扩展入口）

```typescript
import type { ExtensionApi } from '@main/common/extension/types';
import { TaskBridge } from './src/TaskBridge';
import { TavernTools } from './src/TavernTools';

export function activate(api: ExtensionApi): void {
  const logger = api.logger;

  logger.info('Activating Tavern Integration Extension...');

  // 1. 注册酒馆工具
  const tools = new TavernTools(api);
  tools.registerAll();

  // 2. 启动事件桥接
  const bridge = new TaskBridge(api);
  bridge.start();

  // 3. 注册 Gateway 方法（前端调用）
  registerGatewayMethods(api);

  logger.info('Tavern Integration Extension activated');
}

export function deactivate(): void {
  // 清理资源
}

function registerGatewayMethods(api: ExtensionApi): void {
  // 让前端能直接通过 Gateway RPC 调用酒馆 API
  api.registerGatewayMethod('tavern.getTasks', async (params) => {
    // 转发到酒馆系统
    const response = await fetch(`${getTavernBaseUrl()}/gateway/tavern/tasks`);
    return await response.json();
  });

  api.registerGatewayMethod('tavern.createTask', async (params) => {
    const response = await fetch(`${getTavernBaseUrl()}/gateway/tavern/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await response.json();
  });

  // ... 其他方法
}

function getTavernBaseUrl(): string {
  // 从配置读取酒馆系统地址
  return process.env.TAVERN_BASE_URL || 'http://localhost:8765';
}
```

#### 4.1.4 TavernTools.ts（工具定义）

```typescript
import type { ExtensionApi } from '@main/common/extension/types';
import type { ToolDefinition } from '@main/ai/tools/types';
import { z } from 'zod';
import { TavernClient } from './TavernClient';

export class TavernTools {
  private client: TavernClient;

  constructor(private api: ExtensionApi) {
    this.client = new TavernClient(getTavernBaseUrl());
  }

  registerAll(): void {
    this.api.registerTool(this.listTasksTool());
    this.api.registerTool(this.getTaskTool());
    this.api.registerTool(this.acceptTaskTool());
    this.api.registerTool(this.updateStatusTool());
    this.api.registerTool(this.submitResultTool());
  }

  private listTasksTool(): ToolDefinition {
    return {
      name: 'tavern_list_tasks',
      description:
        'List available tasks from Tavern system. Filter by status (pending/accepted/in-progress/completed/cancelled).',
      parameters: z.object({
        status: z
          .enum(['pending', 'accepted', 'in-progress', 'completed', 'cancelled'])
          .optional()
          .describe('Filter tasks by status'),
        limit: z.number().optional().describe('Maximum number of tasks to return (default: 20)')
      }),
      execute: async (params) => {
        const tasks = await this.client.listTasks(params);
        return {
          success: true,
          tasks,
          count: tasks.length
        };
      }
    };
  }

  private acceptTaskTool(): ToolDefinition {
    return {
      name: 'tavern_accept_task',
      description:
        'Accept a task from Tavern. This will mark the task as "accepted" and assign it to the current agent.',
      parameters: z.object({
        taskId: z.string().describe('Task ID to accept'),
        agentId: z.string().describe('Agent ID that accepts this task')
      }),
      execute: async (params) => {
        const result = await this.client.acceptTask(params.taskId, params.agentId);
        return {
          success: true,
          taskId: params.taskId,
          status: 'accepted',
          message: `Task ${params.taskId} has been accepted by agent ${params.agentId}`
        };
      }
    };
  }

  private submitResultTool(): ToolDefinition {
    return {
      name: 'tavern_submit_result',
      description: 'Submit task result to Tavern system. Include text summary and optional file paths.',
      parameters: z.object({
        taskId: z.string().describe('Task ID'),
        textResult: z.string().describe('Text summary of the result'),
        fileResults: z.array(z.string()).optional().describe('Paths to result files')
      }),
      execute: async (params) => {
        await this.client.submitResult(params.taskId, {
          textResult: params.textResult,
          fileResults: params.fileResults || []
        });
        return {
          success: true,
          taskId: params.taskId,
          message: 'Task result submitted successfully'
        };
      }
    };
  }

  // ... 其他工具定义
}
```

#### 4.1.5 TaskBridge.ts（事件桥接）

```typescript
import type { ExtensionApi } from '@main/common/extension/types';
import { TavernClient } from './TavernClient';

/**
 * TaskBridge 负责监听酒馆系统的任务事件，并转发到主系统 EventBus
 */
export class TaskBridge {
  private client: TavernClient;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(private api: ExtensionApi) {
    this.client = new TavernClient(getTavernBaseUrl());
  }

  start(): void {
    this.api.logger.info('[TaskBridge] Starting event polling...');

    // 方案 A：轮询模式（简单可靠）
    this.startPolling();

    // 方案 B（可选）：Webhook 模式（实时性更好）
    // this.startWebhook();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * 轮询酒馆系统，检查新任务
   */
  private startPolling(): void {
    const pollIntervalMs = 5000; // 每 5 秒轮询一次

    this.pollInterval = setInterval(async () => {
      try {
        // 获取 pending 状态的任务
        const tasks = await this.client.listTasks({ status: 'pending' });

        for (const task of tasks) {
          // 检查是否是新任务（通过本地缓存判断）
          if (this.isNewTask(task.id)) {
            // 发布事件到主系统
            this.api.eventBus.emit('tavern.task.created', task);
            this.markTaskAsSeen(task.id);
          }
        }
      } catch (err) {
        this.api.logger.error('[TaskBridge] Polling error:', err);
      }
    }, pollIntervalMs);
  }

  /**
   * Webhook 接收模式（可选，需要酒馆系统支持）
   */
  private startWebhook(): void {
    // 注册 Gateway 方法接收 Webhook
    this.api.registerGatewayMethod('tavern.webhook.taskCreated', async (params) => {
      const task = params.task;
      this.api.eventBus.emit('tavern.task.created', task);
      return { success: true };
    });
  }

  private isNewTask(taskId: string): boolean {
    // 简单实现：使用内存缓存（可改为持久化存储）
    // TODO: 实现缓存逻辑
    return true;
  }

  private markTaskAsSeen(taskId: string): void {
    // TODO: 记录已见过的任务
  }
}
```

### 4.2 TaskAcceptanceService（自动接取服务）

**实现路径**：`src/main/ai/services/TaskAcceptanceService.ts`

```typescript
import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { AgentStore } from '@main/ai/agents/AgentStore';
import { ThreadStore } from '@main/ai/threads/ThreadStore';
import { agentExecutor } from '@main/ai/AgentExecutor';
import type { Task } from '@main/gateway/http/tavern';

const log = createLogger('task-acceptance');

export interface TaskAnalysis {
  type: 'data-analysis' | 'coding' | 'writing' | 'research' | 'general';
  complexity: 'low' | 'medium' | 'high';
  estimatedTime: number; // 分钟
  requiredSkills: string[];
}

export class TaskAcceptanceService {
  private static instance: TaskAcceptanceService | null = null;
  private enabled = false;

  static getInstance(): TaskAcceptanceService {
    if (!this.instance) {
      this.instance = new TaskAcceptanceService();
    }
    return this.instance;
  }

  /**
   * 启动自动接取服务
   */
  async start(): Promise<void> {
    if (this.enabled) {
      log.warn('[TaskAcceptance] Service already started');
      return;
    }

    this.enabled = true;
    log.info('[TaskAcceptance] Starting automatic task acceptance service...');

    // 订阅任务创建事件
    eventBus.on('tavern.task.created', this.handleNewTask.bind(this));

    log.info('[TaskAcceptance] Service started, listening for new tasks');
  }

  /**
   * 停止自动接取服务
   */
  stop(): void {
    this.enabled = false;
    eventBus.off('tavern.task.created', this.handleNewTask.bind(this));
    log.info('[TaskAcceptance] Service stopped');
  }

  /**
   * 处理新任务事件
   */
  private async handleNewTask(task: Task): Promise<void> {
    if (!this.enabled) return;

    log.info(`[TaskAcceptance] New task received: ${task.id} - ${task.title}`);

    try {
      // 1. 分析任务
      const analysis = await this.analyzeTask(task);
      log.info(`[TaskAcceptance] Task analysis:`, analysis);

      // 2. 决策是否接取
      const shouldAccept = await this.shouldAcceptTask(task, analysis);
      if (!shouldAccept) {
        log.info(`[TaskAcceptance] Task ${task.id} rejected by decision logic`);
        return;
      }

      // 3. 选择合适的 Agent
      const agentId = await this.selectAgent(task, analysis);
      if (!agentId) {
        log.warn(`[TaskAcceptance] No suitable agent found for task ${task.id}`);
        return;
      }

      // 4. 接受任务
      await this.acceptTask(task.id, agentId);

      // 5. 创建执行线程
      await this.createExecutionThread(task, agentId, analysis);

      log.info(`[TaskAcceptance] Task ${task.id} accepted and execution started`);
    } catch (err) {
      log.error(`[TaskAcceptance] Failed to handle task ${task.id}:`, err);
    }
  }

  /**
   * 分析任务需求
   */
  private async analyzeTask(task: Task): Promise<TaskAnalysis> {
    // 方案 A：规则匹配（简单快速）
    const type = this.inferTaskType(task.description);
    const complexity = this.inferComplexity(task.description, task.amount);

    return {
      type,
      complexity,
      estimatedTime: this.estimateTime(complexity),
      requiredSkills: this.extractSkills(task.description, type)
    };

    // 方案 B：LLM 分析（更准确，但需要额外调用）
    // return await this.analyzeTaskWithLLM(task);
  }

  /**
   * 推断任务类型
   */
  private inferTaskType(description: string): TaskAnalysis['type'] {
    const keywords = {
      'data-analysis': ['分析', '数据', '统计', '报表', 'csv', 'excel'],
      coding: ['代码', '开发', '实现', '编程', 'bug', '功能'],
      writing: ['文档', '写作', '报告', '总结', '撰写'],
      research: ['调研', '研究', '收集', '整理']
    };

    const lowerDesc = description.toLowerCase();

    for (const [type, words] of Object.entries(keywords)) {
      if (words.some((w) => lowerDesc.includes(w))) {
        return type as TaskAnalysis['type'];
      }
    }

    return 'general';
  }

  /**
   * 推断任务复杂度
   */
  private inferComplexity(description: string, amount: number): TaskAnalysis['complexity'] {
    // 基于金额和描述长度判断
    if (amount > 1000 || description.length > 500) {
      return 'high';
    }
    if (amount > 500 || description.length > 200) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * 决策是否接取任务
   */
  private async shouldAcceptTask(task: Task, analysis: TaskAnalysis): Promise<boolean> {
    // 检查当前正在执行的任务数量
    const threadStore = await ThreadStore.getInstance();
    const activeThreads = await threadStore.list({ status: 'active' });
    const tavernThreads = activeThreads.filter((t) => t.metadata?.type === 'tavern-task');

    const maxConcurrent = 3; // 从配置读取
    if (tavernThreads.length >= maxConcurrent) {
      log.info(`[TaskAcceptance] Max concurrent tasks reached (${maxConcurrent})`);
      return false;
    }

    // 检查任务金额是否满足最低要求
    const minAmount = 100; // 从配置读取
    if (task.amount < minAmount) {
      log.info(`[TaskAcceptance] Task amount ${task.amount} below minimum ${minAmount}`);
      return false;
    }

    // 可扩展：添加更多决策逻辑
    // - 检查 Agent 资源占用
    // - 检查任务优先级
    // - 检查历史完成率

    return true;
  }

  /**
   * 选择合适的 Agent
   */
  private async selectAgent(task: Task, analysis: TaskAnalysis): Promise<string | null> {
    const agentStore = await AgentStore.getInstance();
    const allAgents = await agentStore.list();

    // 筛选条件：具备相应能力的 Agent
    const candidates = allAgents.filter((agent) => {
      const capabilities = agent.metadata?.capabilities as Array<{ type: string; level: number }> | undefined;
      if (!capabilities) return false;

      // 检查是否有匹配的能力
      return capabilities.some((cap) => cap.type === analysis.type && cap.level >= 3);
    });

    if (candidates.length === 0) {
      // 降级：使用通用 Agent
      const generalAgent = allAgents.find((a) => a.id === 'app-copilot');
      return generalAgent?.id || null;
    }

    // 选择能力等级最高的 Agent
    const best = candidates.reduce((prev, curr) => {
      const prevCap = (prev.metadata?.capabilities as any[])?.find((c) => c.type === analysis.type);
      const currCap = (curr.metadata?.capabilities as any[])?.find((c) => c.type === analysis.type);
      return (currCap?.level || 0) > (prevCap?.level || 0) ? curr : prev;
    });

    return best.id;
  }

  /**
   * 接受任务（调用酒馆工具）
   */
  private async acceptTask(taskId: string, agentId: string): Promise<void> {
    // 通过工具调用酒馆 API
    const baseUrl = process.env.TAVERN_BASE_URL || 'http://localhost:8765';
    await fetch(`${baseUrl}/gateway/tavern/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'accepted',
        assignee: agentId
      })
    });
  }

  /**
   * 创建执行线程
   */
  private async createExecutionThread(task: Task, agentId: string, analysis: TaskAnalysis): Promise<void> {
    const threadStore = await ThreadStore.getInstance();

    // 1. 创建 Thread
    const thread = await threadStore.create({
      title: `[酒馆] ${task.title}`,
      agentId,
      metadata: {
        type: 'tavern-task',
        taskId: task.id,
        taskType: analysis.type,
        complexity: analysis.complexity
      }
    });

    // 2. 构建初始提示词
    const initialPrompt = this.buildTaskPrompt(task, analysis);

    // 3. 提交给 AgentExecutor
    const agentStore = await AgentStore.getInstance();
    const agentDef = await agentStore.get(agentId);

    if (!agentDef) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // 创建 Builder 并提交任务
    // TODO: 实现 Builder 创建逻辑
    // const builder = createBuilderFromDefinition(agentDef, 'agent');
    // agentExecutor.submit({ sessionId: thread.id, message: initialPrompt, builder });

    log.info(`[TaskAcceptance] Created thread ${thread.id} for task ${task.id}`);
  }

  /**
   * 构建任务提示词
   */
  private buildTaskPrompt(task: Task, analysis: TaskAnalysis): string {
    let prompt = `# 酒馆任务\n\n`;
    prompt += `**任务 ID**: ${task.id}\n`;
    prompt += `**任务标题**: ${task.title}\n`;
    prompt += `**赏金**: ${task.amount} 金币\n`;
    prompt += `**任务类型**: ${analysis.type}\n`;
    prompt += `**复杂度**: ${analysis.complexity}\n\n`;
    prompt += `## 任务描述\n\n${task.description}\n\n`;

    if (task.files && task.files.length > 0) {
      prompt += `## 相关资料\n\n`;
      task.files.forEach((filePath) => {
        prompt += `- \`${filePath}\`\n`;
      });
      prompt += `\n`;
    }

    prompt += `## 要求\n\n`;
    prompt += `1. 仔细分析任务需求\n`;
    prompt += `2. 制定详细的执行计划\n`;
    prompt += `3. 使用必要的工具完成任务\n`;
    prompt += `4. 完成后使用 \`tavern_submit_result\` 工具提交结果\n`;
    prompt += `5. 结果应包含：\n`;
    prompt += `   - 完整的文字总结\n`;
    prompt += `   - 相关的输出文件（如果有）\n\n`;
    prompt += `请开始执行任务。`;

    return prompt;
  }

  private estimateTime(complexity: TaskAnalysis['complexity']): number {
    switch (complexity) {
      case 'low':
        return 15;
      case 'medium':
        return 30;
      case 'high':
        return 60;
    }
  }

  private extractSkills(description: string, type: TaskAnalysis['type']): string[] {
    // 根据任务类型返回需要的技能
    const skillMap: Record<string, string[]> = {
      'data-analysis': ['read', 'write', 'search'],
      coding: ['read', 'write', 'edit', 'exec'],
      writing: ['read', 'write'],
      research: ['search', 'read', 'write'],
      general: ['read', 'write']
    };
    return skillMap[type] || ['read', 'write'];
  }
}
```

---

## 5. 配置与部署

### 5.1 Extension 配置

在 `~/.coobee-ai/config/coobee.json5` 中添加：

```json5
{
  extensions: {
    'tavern-integration': {
      enabled: true,
      baseUrl: 'http://localhost:8765',
      autoAccept: true,
      maxConcurrent: 3,
      minAmount: 100,
      pollInterval: 5000
    }
  }
}
```

### 5.2 Agent 能力配置

在 Agent 定义中添加 `capabilities` 字段：

```json
{
  "id": "data-analyst",
  "name": "数据分析专家",
  "instructions": "...",
  "tools": ["read", "write", "search", "tavern_submit_result"],
  "metadata": {
    "capabilities": [
      {
        "type": "data-analysis",
        "level": 5,
        "description": "擅长数据清洗、统计分析和可视化"
      },
      {
        "type": "research",
        "level": 4,
        "description": "能够进行资料收集和信息整理"
      }
    ]
  }
}
```

### 5.3 启动流程

1. **主系统启动**：加载 Extension 系统
2. **Extension 加载**：自动加载 `tavern-integration` 扩展
3. **工具注册**：酒馆工具注册到 ToolRegistry
4. **事件监听**：TaskBridge 开始轮询或监听 Webhook
5. **服务启动**：TaskAcceptanceService 订阅事件
6. **就绪状态**：系统进入监听模式，等待新任务

---

## 6. 未来扩展方向

### 6.1 智能决策优化

- **LLM 任务分析**：使用 LLM 对任务进行深度理解和分类
- **能力匹配算法**：基于历史数据优化 Agent 选择策略
- **动态定价**：根据 Agent 负载和任务复杂度动态调整接取策略

### 6.2 多 Agent 协作

- **任务分解**：将复杂任务分解为子任务，多 Agent 协作完成
- **Swarm 模式**：使用 Swarm 模式进行群体决策
- **Orchestrator**：通过 Orchestrator 协调多个专家 Agent

### 6.3 质量保证

- **结果审核**：任务完成后自动质量检查
- **用户反馈**：收集用户评价，优化 Agent 能力模型
- **A/B 测试**：对比不同 Agent 的完成质量

### 6.4 性能优化

- **缓存机制**：缓存任务列表，减少 API 调用
- **批量处理**：批量接取和提交任务
- **并发控制**：智能调度，避免资源争抢

---

## 7. 安全与监控

### 7.1 安全措施

1. **认证机制**：Extension 与酒馆系统之间使用 API Key 认证
2. **权限控制**：限制 Agent 可操作的任务类型
3. **沙箱执行**：任务在隔离环境中执行
4. **审计日志**：记录所有任务接取和执行操作

### 7.2 监控指标

- 任务接取率
- 任务完成率
- 平均执行时间
- Agent 忙碌率
- 错误率

### 7.3 告警策略

- 任务执行超时
- 连续失败超过阈值
- API 调用失败
- 资源占用过高

---

## 8. 实施计划

### Phase 1：Extension 基础框架（1 周）

- [ ] 创建 `tavern-integration` Extension 骨架
- [ ] 实现 TavernClient（API 客户端）
- [ ] 实现 TavernTools（基础工具：list, get, accept）
- [ ] 测试工具调用

### Phase 2：事件桥接（1 周）

- [ ] 实现 TaskBridge（轮询模式）
- [ ] 集成 EventBus
- [ ] 测试事件流转

### Phase 3：自动接取服务（1 周）

- [ ] 实现 TaskAcceptanceService
- [ ] 实现任务分析逻辑
- [ ] 实现 Agent 选择策略
- [ ] 测试自动接取流程

### Phase 4：完整闭环（1 周）

- [ ] 实现任务执行监控
- [ ] 实现结果提交
- [ ] 端到端测试
- [ ] 文档编写

### Phase 5：优化与扩展（持续）

- [ ] LLM 任务分析
- [ ] 能力模型优化
- [ ] 性能优化
- [ ] 监控告警

---

## 9. 总结

本设计方案通过 **Extension 机制**将酒馆任务系统与 Coobee-AI 主系统解耦，实现了：

1. **灵活性**：酒馆系统独立部署，可随时热插拔
2. **可扩展性**：基于工具和事件的设计，易于扩展新功能
3. **自主性**：Agent 能够自动发现、决策、执行和反馈
4. **安全性**：通过沙箱、审批和审计保证系统安全

这套架构为构建真正的**自主 Agent 生态**奠定了基础。
