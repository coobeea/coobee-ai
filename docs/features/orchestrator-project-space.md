# 编排模式统一项目空间管理

## 问题背景

在编排模式（Orchestrator）下，多个 Worker 子任务协作完成一个项目（如音乐播放器）。

### 之前的问题

每个 Worker 各自创建独立的项目副本：

```
.home/workspaces/{threadId}/agents/
├── worker-subtask-1/        # Worker 1 的空间
├── worker-subtask-2/        # Worker 2 的空间
│   ├── music-player-project/  ← 完整前后端项目
│   │   ├── frontend/  (239M)
│   │   └── backend/   (474M)
├── worker-subtask-3/        # Worker 3 的空间
├── worker-subtask-4/        # Worker 4 的空间
│   ├── frontend/  (239M)      ← 重复的前端项目！
│   └── backend/   (474M)      ← 重复的后端项目！
└── worker-subtask-5/        # Worker 5 的空间
    ├── frontend/  (264M)      ← 又一个重复项目！
    └── backend/   (474M)
```

**问题**：

- 资源浪费：接近 1GB 的重复代码和依赖
- 无法协作：Workers 各自维护一套代码，无法协同开发
- 合并困难：最后需要手动合并多个版本

## 解决方案

### 统一项目空间架构

```
.home/workspaces/{threadId}/
├── project/                    ← 🆕 所有 Worker 共享的项目空间
│   ├── frontend/               ← 前端代码（唯一副本）
│   │   ├── src/
│   │   ├── package.json
│   │   └── node_modules/
│   ├── backend/                ← 后端代码（唯一副本）
│   │   ├── src/
│   │   ├── package.json
│   │   └── node_modules/
│   └── README.md
│
├── agents/                     ← Workers 各自的工作空间
│   ├── worker-subtask-1/       ← Worker 1（方案设计）
│   │   ├── .runtime/           ← 日志、上下文、会话
│   │   ├── GOAL.md
│   │   └── music-player-scheme-design.md
│   ├── worker-subtask-2/       ← Worker 2（初始化）
│   │   ├── .runtime/
│   │   └── GOAL.md
│   ├── worker-subtask-3/       ← Worker 3（后端开发）
│   │   ├── .runtime/
│   │   └── GOAL.md
│   ├── worker-subtask-4/       ← Worker 4（前端开发）
│   │   ├── .runtime/
│   │   └── GOAL.md
│   └── worker-subtask-5/       ← Worker 5（测试优化）
│       ├── .runtime/
│       ├── GOAL.md
│       └── DEPLOYMENT.md
│
└── lifecycle/                  ← 生命周期文档
    ├── 01-需求分析.md
    ├── 04-TODO.md
    └── 05-PROGRESS.md
```

## 实现原理

### 1. Orchestrator 初始化项目空间

```typescript
// src/main/ai/orchestration/Orchestrator.ts

private async ensureProjectDir(): Promise<string> {
  // 1. 检查 Thread 是否已指定 projectDir
  const thread = await threadStore.get(this.resolvedConfig.parentSessionId);
  if (thread?.projectDir) {
    return thread.projectDir; // 使用已有项目空间
  }

  // 2. 创建默认项目空间
  const defaultProjectDir = path.join(threadWorkspace, 'project');
  await fs.ensureDir(defaultProjectDir);

  // 3. 更新 Thread 记录
  await threadStore.update(this.resolvedConfig.parentSessionId, {
    projectDir: defaultProjectDir
  });

  return defaultProjectDir;
}
```

### 2. 传递给 WorkerCoordinator

```typescript
// 在 executeTask() 中
const projectDir = await this.ensureProjectDir();
this.workerCoordinator.setProjectDir(projectDir);
```

### 3. Workers 使用项目空间

```typescript
// src/main/ai/orchestration/WorkerCoordinator.ts

private async createWorkerRuntime(workerType: string, subTask: SubTask): Promise<AgentRuntime> {
  const builder = agentExecutor.piMono()
    .name('Worker')
    .mode('agent')
    .sessionId(sessionId);

  // 设置 Worker 自己的工作空间（日志、上下文）
  if (subAgentWorkspace) {
    builder
      .sessionDir(path.join(subAgentWorkspace, '.runtime', 'sessions'))
      .workspaceRoot(subAgentWorkspace)
      .contextDir(path.join(subAgentWorkspace, '.runtime', 'contexts'));
  }

  // 🆕 设置共享的项目空间（代码开发）
  if (this.config?.projectDir) {
    builder.projectDir(this.config.projectDir);
  }

  return await builder.build();
}
```

### 4. Agent 运行时环境

每个 Worker 的运行时环境中会注入 `projectDir`：

```typescript
// AgentEnv
{
  sessionId: "297980619897774080:worker:subtask-3",
  workspace: ".home/workspaces/.../agents/worker-subtask-3",  // 自己的工作空间
  projectDir: ".home/workspaces/.../project",                  // 共享项目空间
  // ...
}
```

Worker 收到的指令会明确说明：

```
⭐ 工程目录 / Project Directory: `/path/to/project/`
这是用户为当前会话指定的工程目录（根目录）。
所有中间产物、解析数据、输出文件都应保存到此目录。
当用户提到"根目录""项目目录""工程目录"时，指的就是这个路径。
```

## 使用场景

### 场景1：用户未指定项目路径

```typescript
// 用户发送：创建音乐播放器
// Orchestrator 自动创建：{threadWorkspace}/project/
// 所有 Workers 在 project/ 中协作开发
```

### 场景2：用户指定项目路径

```typescript
// Thread 创建时指定
await threadStore.create({
  title: '音乐播放器项目',
  agentId: 'general',
  agentType: 'orchestrator',
  projectDir: '/Users/lifeng/Projects/my-music-player' // 指定路径
});

// Orchestrator 使用指定路径
// Workers 直接在用户项目中开发
```

## 资源节省对比

### 之前（多副本）

| Worker    | Frontend | Backend  | Total    |
| --------- | -------- | -------- | -------- |
| subtask-2 | -        | -        | -        |
| subtask-4 | 239M     | -        | 239M     |
| subtask-5 | 264M     | 474M     | 738M     |
| **合计**  | **503M** | **474M** | **977M** |

### 之后（单副本）

| 项目空间 | Frontend | Backend | Total |
| -------- | -------- | ------- | ----- |
| project/ | 264M     | 474M    | 738M  |

**节省**: 977M - 738M = **239M**

## 兼容性

### 现有功能不受影响

- **Worker 工作空间**仍然独立（日志、上下文、GOAL.md）
- **生命周期文档**位置不变（`lifecycle/` 目录）
- **Agent Home** 和其他功能保持不变

### 向后兼容

- 如果 Thread 已有 `projectDir`，优先使用
- 如果 Thread 未指定，自动创建默认项目空间
- 老的 Workers 仍可正常运行（无 projectDir 时行为不变）

## 配置接口

### OrchestratorConfig

无需修改，自动管理项目空间。

### WorkerCoordinatorConfig

```typescript
interface WorkerCoordinatorConfig {
  // ... 其他配置
  projectDir?: string; // 🆕 项目空间路径
}
```

### Thread 定义

```typescript
interface ThreadDefinition {
  // ... 其他字段
  projectDir?: string; // 用户指定的项目路径（可选）
}
```

## 测试验证

### 1. 创建新编排任务

```bash
# 用户：创建一个音乐播放器项目（Node.js + Vue）
# 预期：所有 Workers 在 {threadWorkspace}/project/ 中协作开发
```

### 2. 检查目录结构

```bash
ls -lah .home/workspaces/{threadId}/
# 应该看到：
# - project/           ← 统一项目空间
# - agents/worker-*    ← 各 Worker 工作空间（只有日志、GOAL.md）
# - lifecycle/         ← 生命周期文档
```

### 3. 检查资源占用

```bash
du -sh .home/workspaces/{threadId}/*
# project/: 738M（唯一副本）
# agents/: ~50M（所有 Workers 的日志和上下文）
```

## 未来优化

1. **项目模板支持**：预置常见项目结构模板
2. **增量开发**：支持在已有项目基础上继续开发
3. **多项目管理**：一个 Thread 管理多个子项目
4. **Git 集成**：自动初始化 Git 仓库，记录每个 Worker 的提交

## 相关文件

- `src/main/ai/orchestration/Orchestrator.ts`
- `src/main/ai/orchestration/WorkerCoordinator.ts`
- `src/main/ai/threads/types.ts`
- `src/main/ai/AgentEnv.ts`

## 参考

- [编排模式架构](./orchestration-architecture.md)
- [Thread 管理](../architecture/thread-management.md)
- [Agent 环境注入](../architecture/agent-env-injection.md)
