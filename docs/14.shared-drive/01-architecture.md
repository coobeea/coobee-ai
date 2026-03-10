# 共享网盘与事件驱动任务环 — 架构设计

## 概述

共享网盘（SharedDrive）是一个本地文件系统上的多智能体共享存储区，配合 Agent 生命周期事件和任务路由器（TaskRouter），形成事件驱动的智能体任务处理环。

## 架构图

```
                    ┌─────────────────────────────┐
                    │       Agent A (完成任务)      │
                    └──────┬──────────┬────────────┘
                           │          │
              1. POST 写入网盘   2. agent:done 事件
                           │          │
                           ▼          ▼
              ┌────────────────┐  ┌──────────┐
              │  SharedDrive   │  │ EventBus │
              │  HTTP API      │  │          │
              └────────────────┘  └────┬─────┘
                           ▲          │
                           │     3. 广播事件
              5. GET 拉取数据     │
                           │          ▼
                           │  ┌──────────────┐
                           └──│ TaskRouter   │
                              │ Extension    │
                              └──────┬───────┘
                                     │
                              6. 启动新任务
                                     │
                                     ▼
                    ┌─────────────────────────────┐
                    │       Agent B (自主执行)      │
                    └─────────────────────────────┘
```

## 核心组件

### 1. SharedDriveStore

- **位置**: `src/main/ai/shared-drive/SharedDriveStore.ts`
- **职责**: 文件系统读写 + JSONL 索引管理
- **模式**: 参考 TavernStore（单例 + 延迟初始化）
- **存储**: `.home/shared-drive/`

### 2. Gateway HTTP 路由

- **位置**: `src/main/gateway/http/shared-drive.ts`
- **前缀**: `/gateway/shared-drive/`
- **端点**: entries CRUD + 文件上传下载 + 搜索 + 统计

### 3. Skill

- **位置**: `skills/shared-drive/SKILL.md`
- **作用**: 描述 HTTP API 端点和目录规范，Agent 通过 curl 调用
- **模式**: 酒馆模式（Skill + HTTP API，无专用内置工具）

### 4. Agent 生命周期事件

- **位置**: `src/main/ai/AgentExecutor.ts`（`emitAgentLifecycleEvent` 方法）
- **事件**: `agent:start` / `agent:done`
- **桥接**: `src/main/gateway/events/AgentLifecycleBridge.ts` → Gateway WebSocket

### 5. TaskRouter Extension

- **位置**: `extensions/task-router/`
- **配置**: `.home/config/task-routes.json`
- **机制**: 监听 `agent:done` → 匹配路由规则 → 触发后续任务

## 数据流

1. Agent A 完成任务后，通过 HTTP API 将产出写入 SharedDrive
2. AgentExecutor 自动发射 `agent:done` 事件到 EventBus
3. TaskRouter Extension 监听到事件，匹配路由规则
4. 匹配成功时，从 SharedDrive 拉取相关数据
5. 通过 `agentExecutor.submitViaPipeline()` 启动目标 Agent B
6. Agent B 执行任务，同样可以写入 SharedDrive 并触发后续事件
7. 形成闭环

## 目录结构

```
.home/shared-drive/
├── index.jsonl              全局索引
├── {agentId}/               按智能体分区
│   └── {YYYY-MM-DD}/       按日期
│       └── {topic}/         具体事项
│           ├── README.md    说明（必须）
│           ├── content.md   主内容
│           └── ...          附件
└── _shared/                 公共区域
    ├── knowledge/           经验知识
    └── templates/           模板
```

## 路由规则配置

`.home/config/task-routes.json` 示例：

```json
{
  "routes": [
    {
      "id": "research-to-analysis",
      "name": "研究完成后自动分析",
      "enabled": true,
      "trigger": {
        "agentId": "researcher",
        "summaryMatch": "market"
      },
      "action": {
        "agentId": "analyst",
        "task": "分析 {agentName} 的研究数据：{summary}，数据在共享网盘中。",
        "delayMs": 3000
      }
    }
  ]
}
```

## 安全设计

- TaskRouter 通过 `task-router:` 前缀的 sessionId 防止无限循环
- 路由规则支持精确/通配符匹配和关键词过滤
- 延迟执行（`delayMs`）防止事件风暴

## 修复项

- `ReadyExtensionHook` 中补充了 Registry → ChannelManager 同步逻辑，确保 Extension 注册的 Channel 在生产环境正确启动
