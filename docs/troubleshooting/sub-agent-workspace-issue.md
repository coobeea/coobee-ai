# 子 Agent Workspace 目录问题诊断

## 🐛 问题发现

### 实际目录结构（错误）

```
.home/workspaces/
├── 283469346464145408/                                    # 主 Agent workspace ✅
│   ├── sessions/283469346464145408/
│   ├── contexts/
│   ├── events/
│   └── tasks/
│       └── task-1771651629916/
│           └── agents/
│               └── business-analyst/
│                   ├── sessions/                          # ❌ 空目录！
│                   ├── contexts/
│                   └── events/
│
└── 283469346464145408:delegate:business-analyst/         # ❌ 子 Agent 在顶层！
    ├── sessions/
    │   └── 283469346464145408:delegate:business-analyst/
    │       └── messages.jsonl                            # ❌ session 文件在这里
    ├── contexts/
    └── events/
```

### 设计目标（正确）

根据 `multi-agent-architecture.md` 和 `delegate-to-agent.ts` 的注释：

```
.home/workspaces/
└── 283469346464145408/                                    # 主 Agent workspace
    ├── sessions/
    │   └── 283469346464145408/
    │       └── messages.jsonl
    ├── contexts/
    ├── events/
    └── tasks/
        └── task-1771651629916/
            └── agents/
                └── business-analyst/                      # ✅ 子 Agent workspace
                    ├── sessions/
                    │   └── messages.jsonl                 # ✅ 应该在这里
                    ├── contexts/
                    └── events/
```

**关键设计原则**：

> 子 Agent 的工作空间嵌套在父 workspace 下
> {parentWorkspace}/tasks/{taskId}/agents/{agentId}/
> 这样用户在父 workspace 下即可查看所有子 Agent 的数据。

## 🔍 问题根因分析

### 执行流程

```typescript
// 1. delegate-to-agent.ts 第 142 行
const subAgentWorkspace = path.join(taskDir, 'agents', agentId);
//    → 283469346464145408/tasks/task-xxx/agents/business-analyst/

// 2. delegate-to-agent.ts 第 308-310 行
builder
  .sessionDir(path.join(subAgentWorkspace, 'sessions')) // ✅ 设置正确
  .workspaceRoot(subAgentWorkspace) // ✅ 设置正确
  .contextDir(path.join(subAgentWorkspace, 'contexts')); // ✅ 设置正确

// 3. AgentExecutor.submitAndWait() → execute()
//    → AgentExecutor.stream() 第 435 行
const workspace = await injectEnv(sessionId, builder); // ❌ 覆盖了！

// 4. injectEnv() 第 41 行
const workspace = await Env.getAgentWorkspaceDir(sessionId);
//    sessionId = "283469346464145408:delegate:business-analyst"
//    → workspaces/283469346464145408:delegate:business-analyst/  ❌ 新建了顶层目录！

// 5. injectEnv() 第 98 行
builder.sessionDir(path.join(workspace, 'sessions')); // ❌ 覆盖了之前的设置！
//    → 283469346464145408:delegate:business-analyst/sessions/
```

### 根本原因

1. **delegate-to-agent** 正确地设置了子 Agent 的嵌套 workspace
2. **但 AgentExecutor.stream()** 强制调用 `injectEnv()`
3. **injectEnv()** 调用 `Env.getAgentWorkspaceDir(sessionId)` 创建新的顶层 workspace
4. **injectEnv()** 覆盖了 builder 的 `sessionDir`、`workspaceRoot`、`contextDir` 设置

**关键冲突**：

- delegate-to-agent 想让子 Agent 在 `{parent}/tasks/.../agents/{id}/` 工作
- injectEnv 强制让所有 Agent 在 `workspaces/{sessionId}/` 顶层工作
- 两者冲突，injectEnv 覆盖了 delegate-to-agent 的设置

## 💡 解决方案

### 方案 A：injectEnv 跳过已设置的 Builder ⭐ 推荐

**核心思路**：

- 如果 builder 已经设置了 `workspaceRoot`、`sessionDir`、`contextDir`，则 injectEnv 跳过覆盖
- 仅在这些值为空时，才调用 `Env.getAgentWorkspaceDir()` 创建顶层 workspace

**实现**：

```typescript
// AgentEnvInjector.ts
export async function injectEnv(sessionId: string, builder: AgentBuilder): Promise<string | undefined> {
  try {
    const { Env } = await import('@main/common/env');
    const mode = builder.getMode();

    // 🆕 检查是否已手动设置 workspace（如子 Agent）
    const existingWorkspace = builder.getWorkspaceRoot?.();
    const workspace = existingWorkspace || (await Env.getAgentWorkspaceDir(sessionId));

    // 2. 构建 AgentEnv
    const agentEnv = await buildAgentEnv(sessionId, workspace);

    // ... Agent 模式的 Skill 和协议注入 ...

    // 6-8. 仅在未手动设置时才设置目录
    if (!existingWorkspace) {
      builder.sessionDir(path.join(workspace, 'sessions'));
      builder.workspaceRoot(workspace);
      builder.contextDir(path.join(workspace, 'contexts'));
    }

    return workspace;
  } catch (error) {
    // ...
  }
}
```

**优点**：

- ✅ 尊重手动设置（delegate-to-agent 的设置生效）
- ✅ 不破坏现有逻辑（主 Agent 依然自动创建顶层 workspace）
- ✅ 子 Agent workspace 正确嵌套在 tasks/ 下

### 方案 B：Env.getAgentWorkspaceDir 识别子 Agent

**核心思路**：

- Env.getAgentWorkspaceDir 检测 sessionId 格式
- 如果是子 Agent（包含 `:delegate:` 等），不创建顶层 workspace
- 返回 undefined，让调用方处理

**实现**：

```typescript
// env.ts
async getAgentWorkspaceDir(id: string): Promise<string> {
  // 🆕 检测子 Agent（sessionId 包含冒号）
  if (id.includes(':delegate:') || id.includes(':worker:') || id.includes(':swarm:')) {
    throw new Error('Sub-agent workspace should be created by parent, not at top level');
  }

  const workspace = path.join(this.paths.workspacesDir, id);
  // ... 创建子目录 ...
  return workspace;
}
```

**优点**：

- ✅ 从源头防止子 Agent 创建顶层 workspace

**缺点**：

- ❌ 需要修改 Env.ts 的核心逻辑

### 方案 C：injectEnv 接受 skipWorkspaceCreation 参数

**核心思路**：

- delegate-to-agent 调用 AgentExecutor 时，传入标志跳过 workspace 创建

**实现**：

```typescript
// AgentExecutor.ts
const workspace = await injectEnv(sessionId, builder, {
  skipWorkspaceCreation: true // 🆕 子 Agent 不创建顶层 workspace
});
```

**缺点**：

- ❌ 需要修改 ExecuteRequest 接口
- ❌ delegate-to-agent 无法直接控制 AgentExecutor 的行为

## 🎯 推荐方案：方案 A

**理由**：

1. ✅ **最小修改** - 仅需修改 AgentEnvInjector.ts
2. ✅ **向后兼容** - 主 Agent 行为不变
3. ✅ **尊重手动设置** - delegate-to-agent 的配置生效
4. ✅ **清晰的语义** - 手动设置优先于自动创建

### 需要修改的文件

1. **src/main/ai/AgentEnvInjector.ts**
   - 检查 builder 是否已设置 workspaceRoot
   - 仅在未设置时调用 Env.getAgentWorkspaceDir()
   - 仅在未设置时覆盖 sessionDir/contextDir

2. **src/main/ai/runtime/pimono/PiMonoBuilder.ts**（可能需要）
   - 添加 `getWorkspaceRoot()` 方法（如果不存在）

3. **src/main/ai/runtime/openai/OpenAIBuilder.ts**（可能需要）
   - 添加 `getWorkspaceRoot()` 方法（如果不存在）

### 最终目录结构

```
.home/workspaces/
└── 283469346464145408/                                    # 主 Agent workspace
    ├── sessions/283469346464145408/                       # 主 Agent session
    │   └── messages.jsonl
    ├── contexts/
    ├── events/
    └── tasks/
        └── task-1771651629916/
            └── agents/
                └── business-analyst/                      # ✅ 子 Agent workspace
                    ├── sessions/
                    │   └── 283469346464145408:delegate:business-analyst/
                    │       └── messages.jsonl             # ✅ 子 Agent session
                    ├── contexts/
                    └── events/
```

### 清理旧的错误目录

修复后，需要清理那些错误创建在顶层的子 Agent workspace：

```bash
rm -rf .home/workspaces/*:delegate:*
rm -rf .home/workspaces/*:worker:*
rm -rf .home/workspaces/*:swarm:*
```
