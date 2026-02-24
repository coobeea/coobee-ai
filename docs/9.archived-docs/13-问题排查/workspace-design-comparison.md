# Workspace 目录结构设计对比与正确方案

## 📚 设计文档对比

### 版本 1：Session Storage Refinement（06-session-storage-refinement.md）

**设计日期**：2026-02-04

```
userData/
└── ai/
    └── sessions/              # ✅ sessions 是顶层目录
        ├── {sessionId}/       # ✅ 每个 session 一个目录
        │   ├── session.jsonl       # 对话历史
        │   ├── tasks/              # 任务目录
        │   │   └── {taskId}/
        │   │       ├── metadata.json
        │   │       ├── execution.jsonl
        │   │       └── summary.md
        │   ├── artifacts/          # 产物目录
        │   │   ├── code/
        │   │   ├── documents/
        │   │   └── images/
        │   └── logs/               # 日志
        │       ├── thinking.jsonl
        │       └── actions.jsonl
        └── {sessionId2}/
            └── ...
```

**关键特征**：

- ✅ `sessions/` 是顶层目录
- ✅ 每个 `{sessionId}/` 直接包含 `session.jsonl`
- ✅ **没有**二级 `sessions/` 目录

### 版本 2：Env Workspace Skill Plan（2.env-workspace-skill-plan.md）

**设计日期**：2026-02-12

```
{userHome}/
└── workspaces/                      # ✅ workspaces 是顶层目录
    ├── {session-id-1}/              # ✅ 每个 session 一个 workspace
    │   ├── sessions/                # ⚠️ sessions 子目录（会话持久化）
    │   ├── contexts/                # LLM 请求上下文快照
    │   ├── events/                  # 流式事件记录
    │   ├── skills/                  # Agent 自生成的 Skill
    │   ├── output/                  # Agent 输出文件
    │   └── logs/                    # Agent 运行日志
    └── {session-id-2}/
        └── ...
```

**关键特征**：

- ✅ `workspaces/` 是顶层目录
- ✅ 每个 workspace 以 `sessionId` 命名
- ⚠️ workspace 内部有 `sessions/` 子目录

**问题**：

- ❌ FileSession 在 `sessions/` 子目录下又创建了 `{sessionId}/` 目录
- ❌ 最终路径：`workspaces/{sessionId}/sessions/{sessionId}/messages.jsonl`（重复！）

## 🎯 正确的设计方案

### 方案分析

两个版本的设计意图**不同**：

| 维度         | 版本 1（Session Storage） | 版本 2（Workspace）       |
| ------------ | ------------------------- | ------------------------- |
| **顶层概念** | Session                   | Workspace                 |
| **目录名**   | `sessions/`               | `workspaces/`             |
| **文件存储** | `session.jsonl`           | `sessions/` 子目录        |
| **子任务**   | `tasks/`                  | `tasks/`（委托用）        |
| **上下文**   | ❌ 无                     | `contexts/`（LLM 快照）   |
| **事件流**   | ❌ 无                     | `events/`（完整时间线）   |
| **技能**     | ❌ 无                     | `skills/`（Agent 自生成） |

### 版本 2 的设计意图（正确理解）

```
workspaces/{sessionId}/              # Workspace = Agent 的工作目录
├── sessions/                        # 🔥 SDK Session 存储（OpenAI Agents SDK）
│   └── messages.jsonl               # ✅ 直接存储，无子目录
│
├── contexts/                        # LLM 调用上下文快照
│   ├── 2026-02-21T10-00-05.json
│   └── ...
│
├── events/                          # Agent 执行事件流
│   └── events.jsonl
│
├── skills/                          # Agent 自生成的技能
├── output/                          # Agent 输出文件
└── tasks/                           # 多 Agent 委托任务
    └── {taskId}/
        └── agents/
            └── {agentId}/           # 子 Agent workspace（递归结构）
                ├── sessions/
                │   └── messages.jsonl
                ├── contexts/
                └── events/
```

**关键理解**：

1. **Workspace** = Agent 的完整工作环境（不仅是 session）
2. **sessions/** = OpenAI Agents SDK 的 Session 存储（消息历史）
3. **contexts/** = LLM 请求的完整上下文快照（用于调试/回溯）
4. **events/** = 流式事件的完整时间线（用于前端实时展示）
5. **tasks/** = 多 Agent 协作时的子任务目录

## 🐛 当前实现的问题

### 问题根源：FileSession 的错误假设

**FileSession 当前实现**：

```typescript
// FileSession.ts
constructor(sessionId: string, sessionDir?: string) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();
  const safeSessionId = sessionId.replace(/:/g, '__');

  // ❌ 错误：在 sessionDir 下创建 sessionId 子目录
  this.filePath = join(dir, safeSessionId, 'messages.jsonl');
  //                         ^^^^^^^^^^^^^ 多余的层级
}
```

**AgentEnvInjector 调用**：

```typescript
// AgentEnvInjector.ts
builder.sessionDir(path.join(workspace, 'sessions'));
//                                       ^^^^^^^^ 传入 workspace/sessions/
```

**最终结果**：

```
workspaces/{sessionId}/sessions/{sessionId}__main/messages.jsonl
          ^^^^^^^^^^          ^^^^^^^^^^^^^^^^
          workspace ID        FileSession 创建的子目录（❌ 多余）
```

### 为什么 FileSession 要创建子目录？

**分析 FileSession 的设计意图**：

FileSession 假设的使用场景：

```
某个共享的 sessions 目录
└── sessions/
    ├── session-001/          # 用户 A 的 session
    │   └── messages.jsonl
    ├── session-002/          # 用户 B 的 session
    │   └── messages.jsonl
    └── session-003/          # 用户 C 的 session
        └── messages.jsonl
```

**但在我们的架构中**：

- 每个 workspace **已经**以 sessionId 隔离了
- `workspace/{sessionId}/sessions/` **就是**这个 session 专属的目录
- **不需要**再创建 sessionId 子目录

## ✅ 正确的解决方案

### 方案：修改 FileSession 的实现逻辑

**核心思路**：

1. 如果 `sessionDir` 已经是一个 session 专属目录（如 `workspace/{sessionId}/sessions/`），则**不再创建子目录**
2. 直接在 `sessionDir` 下存储 `messages.jsonl`

**实现方式 A：移除 sessionId 子目录创建（推荐）**

```typescript
// FileSession.ts
constructor(
  private readonly sessionId: string,
  sessionDir?: string
) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();

  // 🆕 判断是否需要创建子目录
  // 如果 sessionDir 已经是专属目录（由外部保证隔离），则不创建子目录
  if (sessionDir) {
    // 外部明确传入 sessionDir，说明已经做好了隔离
    this.filePath = join(dir, 'messages.jsonl');
  } else {
    // 使用默认目录，需要按 sessionId 隔离
    const safeSessionId = sessionId.replace(/[:<>"|?*]/g, '_');
    this.filePath = join(dir, safeSessionId, 'messages.jsonl');
  }
}
```

**实现方式 B：使用配置参数控制（更灵活）**

```typescript
// FileSession.ts
constructor(
  private readonly sessionId: string,
  options?: {
    sessionDir?: string;
    createSubdir?: boolean;  // 🆕 是否创建 sessionId 子目录
  }
) {
  const dir = options?.sessionDir || FileSession.getDefaultSessionDir();
  const createSubdir = options?.createSubdir ?? true;  // 默认创建

  if (createSubdir) {
    const safeSessionId = sessionId.replace(/[:<>"|?*]/g, '_');
    this.filePath = join(dir, safeSessionId, 'messages.jsonl');
  } else {
    this.filePath = join(dir, 'messages.jsonl');
  }
}
```

**AgentEnvInjector 调用**：

```typescript
// 方式 A：传入 sessionDir，自动不创建子目录
builder.sessionDir(path.join(workspace, 'sessions'));

// 方式 B：显式指定不创建子目录
builder.sessionDir(path.join(workspace, 'sessions'), { createSubdir: false });
```

### 最终目录结构

```
workspaces/
└── 283469346464145408/                    # 主 Agent workspace
    ├── sessions/
    │   └── messages.jsonl                 # ✅ 直接存储
    ├── contexts/
    │   ├── 2026-02-21T10-00-05.json
    │   └── ...
    ├── events/
    │   └── events.jsonl
    └── tasks/
        └── task-1771651629916/
            └── agents/
                └── business-analyst/      # 子 Agent workspace
                    ├── sessions/
                    │   └── messages.jsonl # ✅ 直接存储
                    ├── contexts/
                    └── events/
```

## 📊 对比总结

| 方案                           | 路径                                                 | 问题        |
| ------------------------------ | ---------------------------------------------------- | ----------- |
| **当前实现（错误）**           | `workspaces/{id}/sessions/{id}__main/messages.jsonl` | ❌ 目录重复 |
| **我之前的修复（不完全正确）** | `workspaces/{id}/sessions/{id}__main/messages.jsonl` | ❌ 依然重复 |
| **正确方案 A（推荐）**         | `workspaces/{id}/sessions/messages.jsonl`            | ✅ 简洁清晰 |
| **正确方案 B（兼容性好）**     | `workspaces/{id}/sessions/messages.jsonl`            | ✅ 可配置   |

## 🎯 结论

### 核心问题

**Workspace 和 Session 的关系混淆**：

1. **Workspace** = Agent 的完整工作环境（包含多个目录）
2. **Session** = LLM SDK 的消息历史存储（`sessions/` 是 workspace 的一部分）
3. **一个 Workspace = 一个 SessionId**（一对一关系）
4. `workspace/{sessionId}/sessions/` **已经是这个 session 专属目录**
5. **不需要**在 `sessions/` 下再创建 `{sessionId}/` 子目录

### 推荐方案

**修改 FileSession**：

- 当传入 `sessionDir` 时，不创建 sessionId 子目录
- 直接在 `sessionDir` 下存储 `messages.jsonl`
- 最终路径：`workspaces/{sessionId}/sessions/messages.jsonl` ✅

### 需要修改的文件

1. `src/main/ai/runtime/openai/FileSession.ts`
2. `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts`（如果使用了类似逻辑）
3. `src/main/ai/storage/SessionFileManager.ts`（如果存在）

### 不需要修改

- ❌ **不修改** ThreadStore.ts 的 sessionId（保持 `sessionId = threadId`）
- ❌ **不修改** workspace 目录结构（保持以 sessionId 命名）
