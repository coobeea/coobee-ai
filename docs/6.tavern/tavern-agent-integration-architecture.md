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
┌──────────────────────────────────────────────────────────────────┐
│                      Coobee-AI 主系统 (端口 8765)                  │
│                                                                    │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐    │
│  │   Agent     │◄────►│ AgentExecutor│◄────►│  ToolRegistry│    │
│  │  (执行层)    │      │              │      │              │    │
│  └─────────────┘      └──────────────┘      └──────┬───────┘    │
│         ▲                                            │            │
│         │                                            │            │
│         │                                            ▼            │
│         │                                   ┌──────────────┐     │
│         │                                   │ external_*   │     │
│         │                                   │ (外部工具)    │     │
│         │                                   └──────┬───────┘     │
│         │                                            │            │
│  ┌──────┴────────┐                                  │            │
│  │  EventBus     │◄────────────┐                    │            │
│  │  (事件总线)    │             │                    │            │
│  └───────────────┘             │                    │            │
│                                 │                    │            │
│                         ┌───────┴────────┐          │            │
│                         │ Gateway Client │          │            │
│                         │  (WS客户端)     │          │            │
│                         └───────┬────────┘          │            │
│                                 │                    │            │
│                         ┌───────┴────────┐          │            │
│                         │    Gateway     │◄─────────┘            │
│                         │  (RPC服务器)    │                       │
│                         └───────┬────────┘                       │
│                                 │                                 │
└─────────────────────────────────┼─────────────────────────────────┘
                                  │
                                  │ HTTP/WebSocket (前端)
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
         WebSocket 连接                    HTTP API 调用
              (事件推送)                    (工具调用)
                    │                           │
        ┌───────────▼───────────────────────────▼────────────┐
        │          酒馆任务系统 (独立服务 localhost:9900)       │
        │                                                     │
        │  ┌─────────────┐      ┌──────────────┐            │
        │  │  WS Server  │      │  HTTP Server │            │
        │  │  (事件推送)  │      │  (API 接口)   │            │
        │  └─────────────┘      └──────────────┘            │
        │                                                     │
        │  • Task Storage (JSONL)                            │
        │  • Event Broadcasting (任务发布/状态变更)           │
        │  • File Management                                 │
        └─────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 Gateway Client（通用外部服务客户端）

**职责**：通用的 WebSocket 客户端，连接任意外部服务并接收事件推送

**实现路径**：`src/main/gateway/client/GatewayClient.ts`

**核心功能**：

1. **WebSocket 连接管理**：连接、重连、心跳保活
2. **事件接收与转发**：接收外部服务推送的事件，转发到 EventBus
3. **通用化设计**：支持连接多个外部服务（通过配置）

**配置示例**：

```json5
{
  externalServices: [
    {
      id: 'tavern',
      name: '酒馆任务系统',
      wsUrl: 'ws://localhost:9900/events', // WebSocket 事件推送地址
      apiUrl: 'http://localhost:9900/api', // HTTP API 地址（工具调用）
      enabled: true,
      reconnect: true,
      heartbeat: 30000
    }
  ]
}
```

#### 2.2.2 External Tools（外部服务工具集）

**职责**：将外部服务的 API 封装为 Agent 可调用的通用工具

**实现路径**：`src/main/ai/tools/external/`

**核心设计**：

- **动态注册**：根据配置动态生成工具定义
- **HTTP 调用**：通过 HTTP API 与外部服务通信
- **通用化**：不同的外部服务使用相同的工具模式

**工具命名规范**：`external_{serviceId}_{action}`

**酒馆系统工具示例**：

- `external_tavern_list_tasks`
- `external_tavern_get_task`
- `external_tavern_accept_task`
- `external_tavern_update_status`
- `external_tavern_submit_result`

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

### 3.1 任务发布流程（WebSocket 推送模式）

```
┌───────┐     ┌────────┐     ┌──────────┐     ┌────────┐     ┌────────┐
│ 用户  │     │ 酒馆   │     │ Gateway  │     │EventBus│     │ Agent  │
│       │     │ 系统   │     │ Client   │     │        │     │执行层  │
└───┬───┘     └───┬────┘     └────┬─────┘     └───┬────┘     └───┬────┘
    │             │                │               │              │
    │ 0. 启动时建立 WS 连接         │               │              │
    │             │◄───────────────┤               │              │
    │             │   (ws://localhost:9900/events) │              │
    │             │                │               │              │
    │ 1. 发布任务 │                │               │              │
    ├────────────►│                │               │              │
    │             │                │               │              │
    │             │ 2. 存储任务    │               │              │
    │             ├───────┐        │               │              │
    │             │       │        │               │              │
    │             │◄──────┘        │               │              │
    │             │                │               │              │
    │             │ 3. WS 推送事件 │               │              │
    │             ├───────────────►│               │              │
    │             │  task.created  │               │              │
    │             │                │               │              │
    │             │                │ 4. 转发事件  │              │
    │             │                ├──────────────►│              │
    │             │                │               │              │
    │             │                │               │ 5. 任务通知  │
    │             │                │               ├─────────────►│
    │             │                │               │              │
    │             │                │               │ 6. 分析决策  │
    │             │                │               │◄─────────────┤
    │             │                │               │              │
```

### 3.2 任务接取与执行流程（HTTP API 工具调用）

```
┌────────┐       ┌─────────┐       ┌────────┐       ┌─────────┐
│ Agent  │       │External │       │ Thread │       │ 酒馆    │
│执行层  │       │ Tools   │       │ Store  │       │ 系统    │
└───┬────┘       └────┬────┘       └───┬────┘       └────┬────┘
    │                 │                 │                 │
    │ 1. 决策接取     │                 │                 │
    ├────────────────►│                 │                 │
    │                 │                 │                 │
    │                 │ 2. HTTP POST    │                 │
    │                 │  /api/tasks/:id/accept            │
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
    │                 │ 7. HTTP PATCH   │                 │
    │                 │  /api/tasks/:id/status            │
    │                 ├────────────────────────────────────►
    │                 │                 │                 │
```

---

## 4. 详细设计

### 4.1 Gateway Client（通用 WebSocket 客户端）实现

#### 4.1.1 目录结构

```
src/main/gateway/client/
├── GatewayClient.ts       # Gateway Client 核心类
├── Connection.ts          # WebSocket 连接管理
├── EventRouter.ts         # 事件路由器
├── types.ts               # 类型定义
└── __tests__/
    └── GatewayClient.test.ts
```

#### 4.1.2 types.ts（类型定义）

```typescript
/** 外部服务配置 */
export interface ExternalServiceConfig {
  /** 服务 ID（唯一标识） */
  id: string;
  /** 服务名称 */
  name: string;
  /** WebSocket 事件推送地址 */
  wsUrl: string;
  /** HTTP API 地址 */
  apiUrl: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否自动重连 */
  reconnect?: boolean;
  /** 心跳间隔（ms） */
  heartbeat?: number;
  /** 认证 Token（可选） */
  authToken?: string;
}

/** WebSocket 事件 */
export interface ExternalEvent {
  /** 事件类型 */
  type: string;
  /** 事件数据 */
  data: unknown;
  /** 时间戳 */
  timestamp: number;
  /** 来源服务 ID */
  serviceId: string;
}

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
```

#### 4.1.3 GatewayClient.ts（核心实现）

```typescript
import WebSocket from 'ws';
import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { ExternalServiceConfig, ExternalEvent, ConnectionStatus } from './types';

const log = createLogger('gateway-client');

/**
 * Gateway Client - 通用的外部服务 WebSocket 客户端
 *
 * 职责：
 * 1. 管理与外部服务的 WebSocket 连接
 * 2. 接收外部服务推送的事件
 * 3. 将事件转发到系统 EventBus
 * 4. 支持自动重连和心跳保活
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private config: ExternalServiceConfig) {}

  /**
   * 连接到外部服务
   */
  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      log.warn(`[${this.config.id}] Already connected or connecting`);
      return;
    }

    this.status = 'connecting';
    log.info(`[${this.config.id}] Connecting to ${this.config.wsUrl}...`);

    try {
      this.ws = new WebSocket(this.config.wsUrl, {
        headers: this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}
      });

      this.setupEventHandlers();

      // 等待连接成功
      await new Promise<void>((resolve, reject) => {
        this.ws!.once('open', () => resolve());
        this.ws!.once('error', (err) => reject(err));
      });

      this.status = 'connected';
      log.info(`[${this.config.id}] Connected successfully`);

      // 启动心跳
      if (this.config.heartbeat) {
        this.startHeartbeat();
      }
    } catch (err) {
      this.status = 'error';
      log.error(`[${this.config.id}] Connection failed:`, err);

      // 自动重连
      if (this.config.reconnect) {
        this.scheduleReconnect();
      }

      throw err;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.stopReconnect();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.status = 'disconnected';
    log.info(`[${this.config.id}] Disconnected`);
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    // 接收消息
    this.ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as ExternalEvent;

        // 添加服务 ID
        event.serviceId = this.config.id;

        // 转发到 EventBus
        this.forwardEvent(event);
      } catch (err) {
        log.error(`[${this.config.id}] Failed to parse message:`, err);
      }
    });

    // 连接关闭
    this.ws.on('close', () => {
      log.warn(`[${this.config.id}] Connection closed`);
      this.status = 'disconnected';
      this.stopHeartbeat();

      // 自动重连
      if (this.config.reconnect) {
        this.scheduleReconnect();
      }
    });

    // 错误处理
    this.ws.on('error', (err) => {
      log.error(`[${this.config.id}] WebSocket error:`, err);
      this.status = 'error';
    });

    // Pong（心跳响应）
    this.ws.on('pong', () => {
      log.debug(`[${this.config.id}] Received pong`);
    });
  }

  /**
   * 转发事件到 EventBus
   */
  private forwardEvent(event: ExternalEvent): void {
    // 统一事件格式：`external.{serviceId}.{eventType}`
    const eventName = `external.${event.serviceId}.${event.type}`;

    log.info(`[${this.config.id}] Forwarding event: ${eventName}`);

    // 发布到 EventBus
    eventBus.emit(eventName, event.data);
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    if (!this.config.heartbeat || this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.status === 'connected') {
        this.ws.ping();
        log.debug(`[${this.config.id}] Sent ping`);
      }
    }, this.config.heartbeat);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = 5000; // 5 秒后重连
    log.info(`[${this.config.id}] Scheduling reconnect in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        log.error(`[${this.config.id}] Reconnect failed:`, err);
      });
    }, delay);
  }

  /**
   * 停止重连
   */
  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }
}
```

#### 4.1.4 GatewayClientManager.ts（客户端管理器）

```typescript
import { createLogger } from '@main/common/logger';
import { GatewayClient } from './GatewayClient';
import type { ExternalServiceConfig } from './types';

const log = createLogger('gateway-client-manager');

/**
 * Gateway Client Manager - 管理多个外部服务的连接
 */
export class GatewayClientManager {
  private static instance: GatewayClientManager | null = null;
  private clients: Map<string, GatewayClient> = new Map();

  static getInstance(): GatewayClientManager {
    if (!this.instance) {
      this.instance = new GatewayClientManager();
    }
    return this.instance;
  }

  /**
   * 初始化外部服务连接
   */
  async initialize(configs: ExternalServiceConfig[]): Promise<void> {
    log.info(`Initializing ${configs.length} external service(s)...`);

    for (const config of configs) {
      if (!config.enabled) {
        log.info(`[${config.id}] Skipped (disabled)`);
        continue;
      }

      try {
        const client = new GatewayClient(config);
        await client.connect();
        this.clients.set(config.id, client);
        log.info(`[${config.id}] Initialized successfully`);
      } catch (err) {
        log.error(`[${config.id}] Failed to initialize:`, err);
      }
    }
  }

  /**
   * 停止所有连接
   */
  shutdown(): void {
    log.info('Shutting down all external service connections...');

    for (const [id, client] of this.clients.entries()) {
      try {
        client.disconnect();
        log.info(`[${id}] Disconnected`);
      } catch (err) {
        log.error(`[${id}] Error during disconnect:`, err);
      }
    }

    this.clients.clear();
  }

  /**
   * 获取指定客户端
   */
  getClient(serviceId: string): GatewayClient | undefined {
    return this.clients.get(serviceId);
  }

  /**
   * 获取所有客户端状态
   */
  getStatus(): Record<string, string> {
    const status: Record<string, string> = {};
    for (const [id, client] of this.clients.entries()) {
      status[id] = client.getStatus();
    }
    return status;
  }
}
```

### 4.2 External Tools（外部服务工具）实现

#### 4.2.1 工具生成器

```typescript
import type { ToolDefinition } from '@main/ai/tools/types';
import { z } from 'zod';
import type { ExternalServiceConfig } from '../gateway/client/types';

/**
 * External Tools Generator - 根据外部服务配置动态生成工具
 */
export class ExternalToolsGenerator {
  /**
   * 为酒馆系统生成工具集
   */
  static generateTavernTools(config: ExternalServiceConfig): ToolDefinition[] {
    const baseUrl = config.apiUrl;

    return [
      // 1. 查询任务列表
      {
        name: `external_${config.id}_list_tasks`,
        description: `List tasks from ${config.name}. Filter by status.`,
        parameters: z.object({
          status: z.enum(['pending', 'accepted', 'in-progress', 'completed', 'cancelled']).optional()
        }),
        execute: async (params) => {
          const url = new URL(`${baseUrl}/tasks`);
          if (params.status) url.searchParams.set('status', params.status);

          const response = await fetch(url.toString());
          const data = await response.json();
          return data;
        }
      },

      // 2. 接受任务
      {
        name: `external_${config.id}_accept_task`,
        description: `Accept a task from ${config.name}.`,
        parameters: z.object({
          taskId: z.string(),
          agentId: z.string()
        }),
        execute: async (params) => {
          const response = await fetch(`${baseUrl}/tasks/${params.taskId}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: params.agentId })
          });
          return await response.json();
        }
      },

      // 3. 提交结果
      {
        name: `external_${config.id}_submit_result`,
        description: `Submit task result to ${config.name}.`,
        parameters: z.object({
          taskId: z.string(),
          textResult: z.string(),
          fileResults: z.array(z.string()).optional()
        }),
        execute: async (params) => {
          const response = await fetch(`${baseUrl}/tasks/${params.taskId}/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
          });
          return await response.json();
        }
      }

      // 可扩展：根据外部服务的 API 定义动态生成更多工具
    ];
  }
}
```

### 4.3 TaskAcceptanceService（自动接取服务）

**实现路径**：`src/main/ai/services/TaskAcceptanceService.ts`

**核心流程**：订阅 EventBus 上的 `external.tavern.task.created` 事件，分析任务并自动接取执行。

```typescript
// 核心实现（精简版，完整代码见项目源文件）

export class TaskAcceptanceService {
  async start(): Promise<void> {
    // 订阅外部事件（统一格式：external.{serviceId}.{eventType}）
    eventBus.on('external.tavern.task.created', this.handleNewTask.bind(this));
  }

  private async handleNewTask(task: Task): Promise<void> {
    // 1. 分析任务类型和复杂度
    const analysis = this.analyzeTask(task);

    // 2. 决策是否接取（检查并发数、金额等）
    if (!this.shouldAcceptTask(task, analysis)) {
      return;
    }

    // 3. 根据能力模型选择 Agent
    const agentId = await this.selectAgent(task, analysis);

    // 4. 调用外部工具接受任务
    await this.callTool('external_tavern_accept_task', {
      taskId: task.id,
      agentId
    });

    // 5. 创建 Thread 并启动执行
    await this.createExecutionThread(task, agentId, analysis);
  }

  private async selectAgent(task: Task, analysis: TaskAnalysis): Promise<string | null> {
    // 根据 Agent 的 metadata.capabilities 匹配
    // 选择能力等级最高的 Agent
    // 降级：使用通用 Agent
  }
}
```

---

## 5. 配置与部署

### 5.1 外部服务配置

在 `~/.coobee-ai/config/coobee.json5` 中添加：

```json5
{
  // 外部服务配置
  externalServices: [
    {
      id: 'tavern',
      name: '酒馆任务系统',
      wsUrl: 'ws://localhost:9900/events', // WebSocket 事件推送地址
      apiUrl: 'http://localhost:9900/api', // HTTP API 地址
      enabled: true,
      reconnect: true, // 自动重连
      heartbeat: 30000, // 心跳间隔（30 秒）
      authToken: 'optional-auth-token' // 可选：认证令牌
    }
    // 可添加更多外部服务
  ],

  // 任务自动接取配置
  taskAcceptance: {
    enabled: true,
    maxConcurrent: 3, // 最大并发任务数
    minAmount: 100, // 最低金额要求
    defaultAgent: 'app-copilot' // 降级 Agent
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

1. **主系统启动**：Coobee-AI 主进程启动（端口 8765）
2. **加载配置**：读取 `externalServices` 配置
3. **创建 Gateway Client**：为每个外部服务创建 WebSocket 客户端
4. **建立连接**：连接到外部服务（如 `ws://localhost:9900/events`）
5. **生成工具**：根据服务配置动态生成 `external_*` 工具
6. **注册工具**：将外部工具注册到 ToolRegistry
7. **启动接取服务**：TaskAcceptanceService 订阅 `external.tavern.*` 事件
8. **就绪状态**：系统进入监听模式，等待外部事件推送

**酒馆系统端**：

1. 酒馆系统独立启动（端口 9900）
2. 提供 WebSocket Server（`/events`）
3. 提供 HTTP API（`/api/*`）
4. 当任务发布时，通过 WebSocket 推送事件给所有连接的客户端

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

### Phase 1：Gateway Client 基础框架（1 周）

- [ ] 实现 `GatewayClient` 核心类（WebSocket 连接管理）
- [ ] 实现 `GatewayClientManager`（多服务管理）
- [ ] 实现事件转发到 EventBus
- [ ] 测试 WebSocket 连接和事件接收

### Phase 2：External Tools 动态生成（1 周）

- [ ] 实现 `ExternalToolsGenerator`（工具生成器）
- [ ] 为酒馆系统生成工具集
- [ ] 注册到 ToolRegistry
- [ ] 测试工具调用（HTTP API）

### Phase 3：自动接取服务（1 周）

- [ ] 实现 `TaskAcceptanceService`
- [ ] 订阅 `external.tavern.*` 事件
- [ ] 实现任务分析和 Agent 匹配
- [ ] 测试自动接取流程

### Phase 4：酒馆系统 WebSocket Server（1 周）

- [ ] 酒馆系统添加 WebSocket Server
- [ ] 实现事件广播机制（任务发布/状态变更）
- [ ] 端到端测试
- [ ] 文档编写

### Phase 5：通用化与扩展（持续）

- [ ] 支持其他外部服务接入
- [ ] LLM 任务分析
- [ ] 能力模型优化
- [ ] 监控告警

---

## 9. 总结

本设计方案通过 **Gateway Client（通用外部服务客户端）** 将酒馆任务系统与 Coobee-AI 主系统解耦，实现了：

### 核心优势

1. **通用性**：Gateway Client 是通用的 WebSocket 客户端，不仅限于酒馆系统
2. **解耦性**：酒馆作为独立服务（localhost:9900），通过 WebSocket 实时推送事件
3. **实时性**：WebSocket 推送模式，无需轮询，实时响应
4. **可扩展性**：基于配置动态生成工具，支持接入多个外部服务
5. **自主性**：Agent 自动监听、分析、决策、执行

### 架构特点

```
酒馆系统 (localhost:9900)
    ├── WebSocket Server (/events)     → 事件推送
    └── HTTP API (/api/*)               → 工具调用
            │
            ▼
Coobee-AI Gateway Client
    ├── 接收事件 → 转发到 EventBus
    └── 生成工具 → 注册到 ToolRegistry
            │
            ▼
Agent 执行层
    ├── 监听 external.tavern.* 事件
    ├── 分析任务并选择 Agent
    ├── 调用 external_tavern_* 工具
    └── 创建 Thread 并执行
```

### 通用化设计

这套架构不仅适用于酒馆系统，还可以接入：

- 第三方任务平台
- 监控告警系统
- 外部数据源
- 其他 Agent 系统

通过统一的 **外部服务配置 + WebSocket 事件 + HTTP 工具** 模式，构建真正的**开放 Agent 生态**。
