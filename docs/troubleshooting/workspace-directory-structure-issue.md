# Workspace 目录结构问题诊断

## 🐛 问题描述

### 用户反馈

查看 workspace 目录时发现：

```
.home/workspaces/283469346464145408/
├── sessions/
│   └── 283469346464145408/  ❌ 目录名和父 workspace ID 相同，造成重复
│       └── 2026-02-21T05-25-58-815Z_xxx.jsonl
└── tasks/
    └── task-1771651629916/  ✅ 子 Agent 目录结构正确
        ├── agents/
        │   └── business-analyst/
        │       ├── sessions/  ✅
        │       ├── contexts/  ✅
        │       ├── events/  ✅
        │       └── output/  ✅
        ├── experiences/
        └── results/
```

**问题**：`sessions/283469346464145408/` 这个目录名和 workspace ID 相同，显得重复且不清晰。

## 🔍 根本原因分析

### 设计逻辑

```typescript
// 1. Env.getAgentWorkspaceDir(id) 创建 workspace
//    路径：workspaces/{id}/
const workspace =
  workspaces /
  283469346464145408 /
  // 2. AgentEnvInjector 设置 sessionDir
  builder.sessionDir(path.join(workspace, 'sessions'));
//    → sessionDir = workspaces/283469346464145408/sessions/

// 3. FileSession 自动创建子目录
this.filePath = join(sessionDir, sessionId, 'messages.jsonl');
//    → 最终路径 = workspaces/283469346464145408/sessions/283469346464145408/messages.jsonl
```

### 为什么会重复？

**关键矛盾**：

- `workspace/{id}` 中的 `id` 本身就是 `threadId`
- 主 Agent 的 `sessionId = threadId`（相同的值）
- FileSession 又在 `sessions/` 下创建 `{sessionId}/` 子目录
- 结果：`workspaces/{threadId}/sessions/{threadId}/` → 目录名重复

### 子 Agent 为什么正确？

子 Agent 的 sessionId 使用了前缀：

```typescript
// delegate-to-agent.ts 第 340 行
const subSessionId = `${parentSessionId}:delegate:${agentDef.id}`;
//    → 283469346464145408:delegate:business-analyst

// 最终路径
workspaces/283469346464145408/tasks/{taskId}/agents/{agentId}/sessions/
    └── 283469346464145408:delegate:business-analyst/
        └── messages.jsonl  ✅ 清晰！
```

因为 sessionId 包含了冒号分隔符，所以目录名和 workspace ID 不同，逻辑清晰。

## 💡 解决方案对比

### 方案 1：主 Agent session 使用固定名称 `main` ⭐ 推荐

```
workspaces/{threadId}/
└── sessions/
    ├── main/  ← 主 Agent（固定名称，清晰）
    │   └── messages.jsonl
    ├── {threadId}:delegate:business-analyst/  ← 子 Agent
    │   └── messages.jsonl
    └── {threadId}:swarm:coder/  ← Swarm Agent
        └── messages.jsonl
```

**优点**：

- ✅ 目录名清晰，没有重复
- ✅ 主 Agent 固定为 `main/`，一目了然
- ✅ 子 Agent 使用完整 sessionId，便于追溯

**缺点**：

- ❌ 需要修改 AgentEnvInjector 逻辑，判断主/子 Agent

### 方案 2：所有 session 文件直接平铺在 sessions/ 目录

```
workspaces/{threadId}/
└── sessions/
    ├── messages.jsonl  ← 主 Agent（无子目录）
    ├── 283469346464145408:delegate:business-analyst.jsonl  ← 子 Agent（文件名）
    └── 283469346464145408:swarm:coder.jsonl  ← Swarm Agent（文件名）
```

**优点**：

- ✅ 无目录嵌套，结构简单

**缺点**：

- ❌ 需要修改 FileSession 的实现（重大变更）
- ❌ 子 Agent 无法使用独立目录（contexts、events 等可能也需要扁平化）

### 方案 3：接受目录名重复（现状）

```
workspaces/{threadId}/
└── sessions/
    ├── {threadId}/  ← 主 Agent（目录名重复，但功能正常）
    │   └── messages.jsonl
    └── {threadId}:delegate:business-analyst/  ← 子 Agent
        └── messages.jsonl
```

**优点**：

- ✅ 无需修改代码
- ✅ 功能完全正常

**缺点**：

- ❌ 目录名重复，不够清晰
- ❌ 用户困惑

### 方案 4：主 Agent sessionId 添加后缀 ⭐ 推荐

```typescript
// 在 ThreadStore 或 Gateway 创建 thread 时
const sessionId = `${threadId}:main`; // 或 `${threadId}:primary`
```

```
workspaces/{threadId}/
└── sessions/
    ├── {threadId}:main/  ← 主 Agent（有后缀，清晰）
    │   └── messages.jsonl
    ├── {threadId}:delegate:business-analyst/  ← 子 Agent
    │   └── messages.jsonl
    └── {threadId}:swarm:coder/  ← Swarm Agent
        └── messages.jsonl
```

**优点**：

- ✅ 目录名清晰，有层次感
- ✅ 所有 Agent（主/子/Swarm）使用统一的命名模式：`{threadId}:{role}`
- ✅ 修改最小，只需在创建 thread 时设置 sessionId

**缺点**：

- ⚠️ 需要确保所有使用 sessionId 的地方都能处理 `:` 分隔符

## 🎯 推荐方案：方案 4

**理由**：

1. **命名一致性**：所有 Agent 都使用 `{threadId}:{role}` 格式
2. **修改最小**：只需在创建 thread 时设置 sessionId
3. **向后兼容**：现有的 sessionId 解析逻辑已经支持 `:` 分隔符（见 `AgentEnvInjector.ts` 第 349 行）

### 实现位置

**选项 A：在 ThreadStore.create() 中设置**

```typescript
// src/main/ai/threads/ThreadStore.ts
async create(params: CreateThreadParams): Promise<ThreadDefinition> {
  const id = generateSnowflakeId();
  const sessionId = `${id}:main`;  // 🆕 添加后缀

  const thread: ThreadDefinition = {
    id,
    sessionId,  // 🆕 使用带后缀的 sessionId
    // ...
  };
}
```

**选项 B：在 Gateway chat.send 中处理**

```typescript
// src/main/gateway/methods/chat.ts
if (!params.sessionId) {
  // 新会话：创建 thread，sessionId 带后缀
  const thread = await threadStore.create({
    title: params.message,
    agentId: params.agentId || 'default',
    mode: params.mode || 'agent',
    sessionId: `${threadId}:main` // 🆕
  });
}
```

## 📊 影响分析

### 需要检查的地方

1. ✅ **sessionId 解析**：`AgentEnvInjector.ts` 已支持 `:` 分隔符
2. ✅ **FileSession**：按 sessionId 创建子目录，支持任何格式
3. ⚠️ **事件系统**：需确认 EventBridge、StreamStore 是否假设 sessionId 无特殊字符
4. ⚠️ **文件系统**：Windows 下 `:` 是非法字符（需转义或替换）

### Windows 兼容性问题 ⚠️

Windows 文件系统不允许路径中包含 `:`，所以 `sessions/283469346464145408:main/` 会报错！

**解决方法**：

- 使用 `-` 或 `_` 替代 `:`
- 或使用 URL 安全的编码

**修正后的方案**：

```typescript
const sessionId = `${id}__main`; // 使用双下划线替代冒号（跨平台安全）
```

或者保留冒号，但在文件路径中替换：

```typescript
// FileSession 中
const safePath = sessionId.replace(/:/g, '__');
this.filePath = join(dir, safePath, 'messages.jsonl');
```

## 🚀 最终推荐方案

### 方案 4-改进版：主 Agent sessionId 添加后缀 + 文件路径转义

1. **在 ThreadStore 创建 thread 时，设置 sessionId = `{threadId}:main`**
2. **在 FileSession 创建文件路径时，将 `:` 替换为 `__`**

这样既保持了逻辑上的清晰（sessionId 格式统一），又解决了跨平台兼容性问题。

### 实现步骤

#### 步骤 1：修改 ThreadStore.create()

```typescript
// src/main/ai/threads/ThreadStore.ts
async create(params: CreateThreadParams): Promise<ThreadDefinition> {
  const id = generateSnowflakeId();

  // 🆕 主 Agent sessionId 添加后缀（保持和子 Agent 命名一致）
  const sessionId = params.sessionId || `${id}:main`;

  const thread: ThreadDefinition = {
    id,
    sessionId,
    // ...
  };
}
```

#### 步骤 2：修改 FileSession 路径处理

```typescript
// src/main/ai/runtime/openai/FileSession.ts
constructor(private readonly sessionId: string, sessionDir?: string) {
  const dir = sessionDir || FileSession.getDefaultSessionDir();

  // 🆕 将 `:` 替换为 `__`（Windows 兼容）
  const safeSessionId = sessionId.replace(/:/g, '__');

  this.filePath = join(dir, safeSessionId, 'messages.jsonl');
}
```

#### 步骤 3：同步修改 PiMono FileSession（如果存在）

```typescript
// src/main/ai/runtime/pimono/FileSession.ts（如果存在类似实现）
// 同样的修改
```

### 最终目录结构

```
workspaces/283469346464145408/
├── sessions/
│   ├── 283469346464145408__main/  ✅ 主 Agent（清晰）
│   │   └── messages.jsonl
│   ├── 283469346464145408__delegate__business-analyst/  ✅ 子 Agent
│   │   └── messages.jsonl
│   └── 283469346464145408__swarm__coder/  ✅ Swarm Agent
│       └── messages.jsonl
├── contexts/
│   ├── 283469346464145408__main/  ✅
│   └── 283469346464145408__delegate__business-analyst/  ✅
├── events/
│   └── events.jsonl  （主 Agent 事件流）
└── tasks/
    └── task-xxx/
        └── agents/
            └── business-analyst/  ✅ 完整独立的工作空间
                ├── sessions/
                │   └── 283469346464145408__delegate__business-analyst/
                ├── contexts/
                ├── events/
                └── output/
```

## ⚠️ 注意事项

### 1. Windows 兼容性

Windows 文件系统不允许路径中包含 `:`，必须转义。

### 2. 向后兼容

需要考虑已有的 workspace 如何迁移：

**方案 A：自动迁移**

- 启动时检测旧格式 `sessions/{threadId}/`
- 自动重命名为 `sessions/{threadId}__main/`

**方案 B：双版本兼容**

- 先查找新格式 `sessions/{threadId}__main/`
- 找不到再查找旧格式 `sessions/{threadId}/`

**方案 C：不迁移**

- 旧 thread 保持旧格式
- 新 thread 使用新格式
- 两者共存

## 📝 代码修改位置

### 核心文件

1. **src/main/ai/threads/ThreadStore.ts**
   - `create()` 方法：设置 `sessionId = ${id}:main`

2. **src/main/ai/runtime/openai/FileSession.ts**
   - `constructor()`: 替换 `:` 为 `__`

3. **src/main/ai/runtime/pimono/FileSession.ts**（如果存在）
   - 同样的修改

### 需要验证的地方

1. **ContextSnapshot.ts** - 确认 contextDir 路径处理
2. **AgentEventWriter.ts** - 确认事件文件路径
3. **Gateway HTTP API** - 确认前端请求 sessions 时的路径
4. **所有测试用例** - 更新 mock sessionId 格式

## 🧪 测试验证

### 单元测试

```typescript
describe('SessionId 格式', () => {
  it('主 Agent sessionId 应该包含 :main 后缀', () => {
    const threadId = '283469346464145408';
    const sessionId = `${threadId}:main`;
    expect(sessionId).toBe('283469346464145408:main');
  });

  it('FileSession 应该将 : 替换为 __', () => {
    const sessionId = '283469346464145408:main';
    const safePath = sessionId.replace(/:/g, '__');
    expect(safePath).toBe('283469346464145408__main');
  });
});
```

### 目录结构验证

```bash
# 创建新 thread 后
ls .home/workspaces/NEW_THREAD_ID/sessions/

# 应该看到：
# NEW_THREAD_ID__main/  ← 主 Agent
```

## 🎯 优先级建议

### 高优先级（P0）

- ❌ 无（功能正常，只是目录名不够清晰）

### 中优先级（P1）

- ✅ 修改 sessionId 格式（提升代码可读性和用户体验）
- ✅ 添加 Windows 兼容性处理（`:` → `__`）

### 低优先级（P2）

- 迁移旧 workspace 目录结构（可选）

## 📚 相关设计文档

- [多 Agent 架构设计](../multi-agent-architecture.md)
- [Workspace 约定](../architecture-review/26-comprehensive-architecture-review.md)
- [子 Agent 工作空间设计](../architecture-review/31-ai-module-architecture-overview.md)

## ✅ 结论

**问题根源**：主 Agent 的 sessionId = threadId，导致 `workspaces/{threadId}/sessions/{threadId}/` 目录名重复。

**推荐方案**：

1. 主 Agent sessionId 改为 `{threadId}:main`
2. FileSession 文件路径中 `:` 替换为 `__`（Windows 兼容）
3. 最终目录：`sessions/283469346464145408__main/`

**影响范围**：中等（需修改 ThreadStore、FileSession，并测试验证）

**是否立即修复**：建议列入 P1 优先级，择机修复。
