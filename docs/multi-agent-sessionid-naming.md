# Multi-Agent SessionId 命名规范

## 概述

在多 Agent 系统中，`sessionId` 用于唯一标识一次对话会话和其相关的子任务。为了支持层级化的任务分解和并发执行，我们采用了基于**冒号分隔**的命名约定。

## 命名规范

### 格式

```
<mainThreadId>[:<taskId>][:<subtaskId>]...
```

- **mainThreadId**: 主会话的 Thread ID（Snowflake ID，如 `1927409883824177152`）
- **taskId**: 子任务标识符（可选，由 Orchestrator/Swarm 生成）
- **subtaskId**: 更深层次的子任务标识符（可选，支持多层嵌套）

### 示例

| SessionId                                   | 说明                                           | 使用场景        |
| ------------------------------------------- | ---------------------------------------------- | --------------- |
| `1927409883824177152`                       | 主会话（单 Agent 模式）                        | Agent, Delegate |
| `1927409883824177152:triage`                | Swarm 模式的 Triage 阶段                       | Swarm           |
| `1927409883824177152:decompose`             | Swarm 模式的 Decompose 阶段                    | Swarm           |
| `1927409883824177152:task-1`                | Orchestrator 模式的第 1 个子任务               | Orchestrator    |
| `1927409883824177152:task-2`                | Orchestrator 模式的第 2 个子任务               | Orchestrator    |
| `1927409883824177152:task-1:subtask-a`      | 嵌套子任务（任务 1 下的子任务 a）              | Orchestrator    |
| `1927409883824177152:swarm-role-backend`    | Swarm 模式中角色为 `backend` 的 Agent 执行会话 | Swarm           |
| `1927409883824177152:delegate-analyze-code` | Delegate 模式的代码分析子任务                  | Delegate        |

## 各模式的 SessionId 规范

### 1. Agent（单 Agent）

直接使用 `threadId` 作为 `sessionId`，无冒号分隔符。

```typescript
const sessionId = threadId; // "1927409883824177152"
```

### 2. Delegate（子任务委派）

格式：`<threadId>:delegate-<taskName>`

```typescript
const sessionId = `${threadId}:delegate-${taskName}`;
// 示例: "1927409883824177152:delegate-analyze-code"
```

### 3. Orchestrator（编排模式）

#### 阶段 sessionId

- **规划阶段**: `<threadId>:plan`
- **执行阶段**: `<threadId>:task-<stageIndex>`
- **聚合阶段**: `<threadId>:aggregate`

```typescript
// 规划
const planSessionId = `${threadId}:plan`;

// 执行各 Stage
const taskSessionId = `${threadId}:task-${stageIndex}`;
// 示例: "1927409883824177152:task-0"

// 聚合
const aggSessionId = `${threadId}:aggregate`;
```

#### 嵌套子任务

如果某个 Stage 内部再次启动 Orchestrator 或 Delegate，可继续追加：

```typescript
const nestedSessionId = `${taskSessionId}:subtask-${subtaskId}`;
// 示例: "1927409883824177152:task-0:subtask-a"
```

### 4. Swarm（蜂群模式）

#### 阶段 sessionId

- **Triage 阶段**: `<threadId>:triage`
- **Decompose 阶段**: `<threadId>:decompose`
- **角色执行**: `<threadId>:swarm-role-<roleName>`

```typescript
// Triage
const triageSessionId = `${threadId}:triage`;

// Decompose
const decomposeSessionId = `${threadId}:decompose`;

// 角色执行（handoff 给特定角色）
const roleSessionId = `${threadId}:swarm-role-${roleName}`;
// 示例: "1927409883824177152:swarm-role-backend"
```

#### 角色切换（Handoff）

当 Agent 执行 `handoff` 工具切换到新角色时，新角色的 `sessionId` 继续使用 `swarm-role-<newRole>` 格式：

```typescript
const newRoleSessionId = `${threadId}:swarm-role-${newRoleName}`;
```

**注意**: Swarm 的每个角色执行是**串行**的（通过 `runStatus` 控制），不会出现同一时刻多个角色并发执行的情况。

## Event Forwarding 规则

### 主会话 → 子会话

子会话的所有事件会**自动转发**到主会话，以便前端 UI 能够统一展示：

```typescript
// 在 AgentEventWriter.dispatchForSession 中
if (sessionId.includes(':')) {
  const mainThreadId = sessionId.split(':')[0];
  const mainWriter = sessionWriters.get(mainThreadId);
  if (mainWriter) {
    const modifiedChunk: StreamChunk = {
      ...chunk,
      data: {
        ...(chunk.data ?? {}),
        subSessionId: sessionId // 标记来源子会话
      }
    };
    mainWriter.dispatch(modifiedChunk);
  }
}
```

### 前端处理

前端 UI 可通过 `subSessionId` 字段识别事件来源：

```typescript
if (message.subSessionId) {
  // 来自子会话的事件
  console.log(`Event from sub-session: ${message.subSessionId}`);
}
```

## HITL 审批处理

### 子 Agent HITL 审批

当子 Agent 发出 HITL 审批请求时（如 `hitl:required` 事件），该事件会：

1. 先发送到子会话的 `sessionId`（如 `1927409883824177152:task-1`）
2. 自动转发到主会话（`1927409883824177152`），并附加 `subSessionId` 标记
3. 前端 UI 接收到主会话的转发事件，展示审批弹窗
4. 用户提交决策时，需使用**子会话的 sessionId** 和对应的 `index`

```typescript
// 前端提交决策
gateway.request('hitl.decide', {
  sessionId: message.subSessionId, // 使用子会话 ID
  index: message.index,
  decision: 'approve-once'
});
```

### ThreadWaker 恢复机制

Thread 恢复时，`ThreadWaker` 会：

1. 从 Checkpoint 中读取 `runStatus` 和 `pendingOperation`
2. 如果状态是 `approval-pending`，恢复子会话的审批等待
3. 使用原始的 `sessionId`（包含冒号分隔符）调用 `submitViaPipeline`

```typescript
// ThreadWaker 恢复示例
const { sessionId, index, toolName } = pendingOp;
// sessionId 可能是 "1927409883824177152:task-1"
await runtime.submitViaPipeline(sessionId, '', { resume: true });
```

## 实现位置

### 核心代码

- **SessionId 生成**: 各 AgentExecutor、Orchestrator、SwarmCoordinator
- **Event 转发**: `src/main/ai/AgentEventWriter.ts` (`dispatchForSession`)
- **HITL 审批**: `extensions/tool-approval/index.ts`, `src/main/ai/hitl/HitlApprovalManager.ts`
- **Checkpoint**: `src/main/ai/threads/CheckpointManager.ts`
- **ThreadWaker**: `src/main/ai/threads/ThreadWaker.ts`

### 测试

- **Event 转发测试**: `src/main/ai/__tests__/AgentEventWriter.sub-session.test.ts`
- **Swarm 测试**: `src/main/ai/swarm/__tests__/SwarmCoordinator.test.ts`
- **Orchestrator 测试**: `src/main/ai/orchestration/__tests__/Orchestrator.test.ts`

## 最佳实践

### 1. 命名清晰

使用有意义的任务标识符，如 `task-1`, `delegate-analyze`，而非随机 UUID。

### 2. 避免过深嵌套

建议最多 2-3 层嵌套（`threadId:task:subtask`），避免过于复杂的层级结构。

### 3. 一致性检查

在创建子会话时，确保 `sessionId` 始终包含主 `threadId` 作为前缀。

### 4. 日志跟踪

在日志中始终输出完整的 `sessionId`，便于多 Agent 并发时的问题排查：

```typescript
log.info(`[Orchestrator] Starting task ${taskSessionId}`, { threadId, stageIndex });
```

## 常见问题

### Q1: 为什么使用冒号而不是斜杠？

冒号是 URL 安全字符，不会与路径混淆，且易于分割和解析。

### Q2: 子会话的 sessionId 是否需要全局唯一？

是的。通过包含 `threadId` 前缀和唯一的任务标识符，确保了全局唯一性。

### Q3: 如何判断一个 sessionId 是否是子会话？

检查是否包含冒号：

```typescript
const isSubSession = sessionId.includes(':');
const mainThreadId = sessionId.split(':')[0];
```

### Q4: Swarm 的角色切换会改变 sessionId 吗？

是的，每次 handoff 到新角色时，会生成新的 `sessionId`（格式：`<threadId>:swarm-role-<newRole>`）。

## 参考文档

- [Multi-Agent Architecture](./docs/architecture-review/29-comprehensive-multi-dimension-analysis.md)
- [Checkpoint System](./docs/architecture-review/07-checkpoint-design.md)
- [HITL Approval Flow](./docs/architecture-review/05-hitl-approval-flow.md)
