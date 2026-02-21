# Workspace 和 Session 目录结构分析

## 📖 原始设计（来自 2.env-workspace-skill-plan.md）

### 1. Workspace 结构

```
{userHome}/workspaces/              # Agent 工作空间总根
├── {session-id-1}/                 # ⚠️ 关键：以 sessionId 命名
│   ├── sessions/                   # 会话持久化
│   ├── contexts/                   # LLM 请求上下文快照
│   ├── events/                     # 流式事件记录
│   ├── skills/                     # Agent 自生成的 Skill
│   ├── output/                     # Agent 输出文件
│   └── logs/                       # Agent 运行日志
└── {session-id-2}/
    └── ...
```

### 2. 核心设计原则

1. **Workspace 以 sessionId 命名**：`workspaces/{sessionId}/`
2. **Sessions 目录在 workspace 内部**：`{workspace}/sessions/`
3. **一个 sessionId = 一个独立的 workspace**

## 🤔 当前问题分析

### 问题 1：ThreadStore 和 SessionId 的关系混乱

**当前实现**（我刚修复的）：

```typescript
// ThreadStore.ts
const sessionId = `${id}:main`; // ❌ 我改成了这个
```

**结果**：

```
workspaces/
└── 283469346464145408/           # workspace ID = threadId
    └── sessions/
        └── 283469346464145408__main/   # ❌ FileSession 创建的子目录
            └── messages.jsonl
```

### 问题 2：Workspace 和 SessionId 的语义混淆

**疑问**：

- `threadId` 是什么？
- `sessionId` 是什么？
- `workspaceId` 是什么？
- 它们是同一个东西吗？

**从代码推导**：

```typescript
// ThreadStore.ts（旧代码）
const sessionId = id;  // sessionId = threadId

// Env.ts
async getAgentWorkspaceDir(id: string): Promise<string> {
  const workspace = path.join(this.paths.workspacesDir, id);
  // workspace 路径：workspaces/{id}/
}

// AgentEnvInjector.ts
const workspace = await Env.getAgentWorkspaceDir(sessionId);
// 传入 sessionId，得到 workspace
```

**结论**：

- **threadId = sessionId = workspaceId**（它们是同一个东西！）
- 主 Agent 的 workspace 就是 `workspaces/{threadId}/`

### 问题 3：FileSession 的多余目录层级

**FileSession 当前实现**：

```typescript
// FileSession.ts
constructor(sessionId: string, sessionDir?: string) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();
  const safeSessionId = sessionId.replace(/:/g, '__');
  this.filePath = join(dir, safeSessionId, 'messages.jsonl');
  //                         ^^^^^^^^^^^^^^^^
  //                         ❌ 这里创建了一个以 sessionId 命名的子目录
}
```

**AgentEnvInjector 调用**：

```typescript
builder.sessionDir(path.join(workspace, 'sessions'));
//                                       ^^^^^^^^ 传入 workspace/sessions/
```

**最终路径**：

```
workspaces/{threadId}/sessions/{threadId}__main/messages.jsonl
          ^^^^^^^^^^          ^^^^^^^^^^^^^^^^
          workspace ID        FileSession 创建的子目录（多余！）
```

## 💡 真正的设计意图

### 场景 1：主 Agent

```
workspaces/
└── {threadId}/                      # workspace = workspaces/{threadId}/
    ├── sessions/
    │   └── messages.jsonl           # ✅ 直接存在 sessions/ 下，无子目录
    ├── contexts/
    │   ├── 2026-02-21T10-00-05.json
    │   └── ...
    └── events/
        └── events.jsonl
```

### 场景 2：子 Agent（delegate）

```
workspaces/
└── {threadId}/                               # 主 Agent workspace
    └── tasks/
        └── {taskId}/
            └── agents/
                └── {agentId}/                # 子 Agent workspace
                    ├── sessions/
                    │   └── messages.jsonl    # ✅ 直接存在 sessions/ 下
                    ├── contexts/
                    └── events/
```

**关键点**：

- 主 Agent 和子 Agent 都是**独立的 workspace**
- session 文件直接存在各自 workspace 的 `sessions/` 下
- **不需要**在 sessions/ 下再创建以 sessionId 命名的子目录

## 🎯 正确的解决方案

### 方案 A：FileSession 不创建 sessionId 子目录 ⭐ 推荐

**修改 FileSession**：

```typescript
// FileSession.ts
constructor(sessionId: string, sessionDir?: string) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();
  // 🆕 不再创建 sessionId 子目录，直接使用 sessionDir
  this.filePath = join(dir, 'messages.jsonl');
  //                         ^^^^^^^^^^^^^^^^ 直接在 sessions/ 下
}
```

**结果**：

```
workspaces/{threadId}/sessions/messages.jsonl  ✅
```

**问题**：

- ❌ **多 session 复用同一个 workspace 时会冲突**
- 例如：重新打开同一个 thread，session 被覆盖

### 方案 B：使用时间戳命名 session 文件

```typescript
// FileSession.ts
this.filePath = join(dir, `${timestamp}_${uuid}.jsonl`);
```

**结果**：

```
workspaces/{threadId}/sessions/
├── 2026-02-21T10-00-05-123_abc123.jsonl
└── 2026-02-21T10-05-10-456_def456.jsonl
```

**优点**：

- ✅ 支持多次会话记录
- ✅ 可追溯历史

**缺点**：

- ❌ 需要额外的 session 管理逻辑

### 方案 C：保持 FileSession 子目录，但使用简化的命名 ⭐ 推荐

**问题核心**：

- FileSession 创建子目录是**合理的**（支持多 session 隔离）
- 但命名应该更简洁

**修改**：

```typescript
// FileSession.ts
constructor(sessionId: string, sessionDir?: string) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();

  // 🆕 简化子目录命名
  // - 如果 sessionId 很长（如 Snowflake ID），使用 "main"
  // - 如果是子 Agent（带冒号），提取角色名
  const dirName = this.getSessionDirName(sessionId);

  this.filePath = join(dir, dirName, 'messages.jsonl');
}

private getSessionDirName(sessionId: string): string {
  // 如果是纯数字（主 Agent 的 Snowflake ID）
  if (/^\d+$/.test(sessionId)) {
    return 'main';
  }

  // 如果是 {threadId}:role:name 格式（子 Agent）
  if (sessionId.includes(':')) {
    const parts = sessionId.split(':');
    return parts.slice(1).join('_');  // delegate_agent-id
  }

  // 其他情况，Windows 安全处理
  return sessionId.replace(/[:<>"|?*]/g, '_');
}
```

**结果**：

```
workspaces/{threadId}/
├── sessions/
│   └── main/                                    # ✅ 主 Agent
│       └── messages.jsonl
└── tasks/
    └── {taskId}/
        └── agents/
            └── {agentId}/
                └── sessions/
                    └── delegate_{agentId}/      # ✅ 子 Agent
                        └── messages.jsonl
```

## 🔍 根本问题：语义混乱

### 问题根源

1. **ThreadId、SessionId、WorkspaceId 三个概念混用**
2. **FileSession 假设 sessionId 是唯一标识符**（需要用它创建子目录）
3. **但 workspace 已经以 sessionId 命名了**（导致重复）

### 概念澄清

| 概念            | 定义                                       | 作用域     |
| --------------- | ------------------------------------------ | ---------- |
| **ThreadId**    | 前端会话 ID（用户看到的聊天窗口）          | 全局唯一   |
| **SessionId**   | Agent 运行时 session ID（LLM SDK session） | Agent 内部 |
| **WorkspaceId** | Agent 工作空间 ID                          | 文件系统   |

**关键设计决策**：

- 主 Agent：`threadId = sessionId = workspaceId`（它们是同一个东西）
- 子 Agent：`sessionId = ${threadId}:role:name`，`workspaceId` 是子目录路径

## ✅ 推荐方案总结

### 1. 保持 ThreadStore 原样

```typescript
// ThreadStore.ts
const sessionId = id; // 不添加 :main 后缀
```

### 2. 修改 FileSession 简化子目录命名

```typescript
// FileSession.ts - 使用固定名称或提取角色名
const dirName = sessionId.includes(':')
  ? sessionId.split(':').slice(1).join('_') // delegate_agent-id
  : 'main'; // 主 Agent 固定为 main
```

### 3. 最终目录结构

```
workspaces/{threadId}/
├── sessions/main/                    # ✅ 简洁清晰
│   └── messages.jsonl
└── tasks/{taskId}/agents/{agentId}/
    └── sessions/delegate_{agentId}/  # ✅ 角色明确
        └── messages.jsonl
```

**优点**：

- ✅ 目录名简洁（main、delegate_xxx）
- ✅ workspace 和 session 关系清晰
- ✅ 支持 session 隔离
- ✅ 无 Windows 兼容问题
