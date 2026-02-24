# Workspace 目录结构问题修复总结

## ✅ 问题修复

已成功解决用户反馈的 workspace 目录结构问题。

### 原问题

```
.home/workspaces/283469346464145408/
├── sessions/
│   └── 283469346464145408/  ❌ 目录名和 workspace ID 重复
```

### 解决方案

**核心思路**：主 Agent 的 sessionId 改为 `{threadId}:main` 格式，文件路径中的 `:` 替换为 `__`（Windows 兼容）。

### 修改的文件

#### 1. ThreadStore.ts

```typescript
// 🆕 主 Agent sessionId 添加 :main 后缀
const sessionId = params.sessionId || `${id}:main`;
```

#### 2. FileSession.ts (OpenAI)

```typescript
// 🆕 将 : 替换为 __ 以兼容 Windows 文件系统
const safeSessionId = sessionId.replace(/:/g, '__');
this.filePath = join(dir, safeSessionId, 'messages.jsonl');
```

#### 3. PiMonoAgentRuntime.ts

```typescript
// 🆕 将 : 替换为 __ 以兼容 Windows 文件系统
const safeSessionId = this.sessionId.replace(/:/g, '__');
const sessionDir = this.options.sessionDir
  ? path.join(this.options.sessionDir, safeSessionId)
  : path.join(cwd, '.coobee-ai', 'sessions', safeSessionId);
```

#### 4. SessionFileManager.ts

```typescript
// 🆕 将 : 替换为 __ 以兼容 Windows 文件系统
const safeSessionId = sessionId.replace(/:/g, '__');
this.basePath = join(app.getPath('userData'), 'sessions', safeSessionId);
```

### 最终目录结构

```
.home/workspaces/283469346464145408/
├── sessions/
│   ├── 283469346464145408__main/  ✅ 主 Agent（清晰）
│   │   └── messages.jsonl
│   ├── 283469346464145408__delegate__business-analyst/  ✅ 子 Agent
│   │   └── messages.jsonl
│   └── 283469346464145408__swarm__coder/  ✅ Swarm Agent
│       └── messages.jsonl
├── contexts/
│   ├── 2026-02-21T05-25-58-815Z_xxx.json
│   └── ...
├── events/
│   └── events.jsonl
└── tasks/
    └── task-1771651629916/  ✅ 子 Agent 工作空间
        ├── agents/
        │   └── business-analyst/
        │       ├── sessions/
        │       ├── contexts/
        │       ├── events/
        │       └── output/
        ├── experiences/
        └── results/
```

## 优势

1. **目录名清晰**：所有 Agent 使用统一的 `{threadId}__{role}` 格式
2. **跨平台兼容**：`:` 替换为 `__`，Windows 文件系统安全
3. **向后兼容**：旧格式 sessionId（无后缀）仍能正常工作
4. **易于追溯**：从 sessionId 可直接看出 Agent 类型和 threadId

## 测试验证

- ✅ 新建 thread 的 sessionId 格式为 `{id}:main`
- ✅ 文件路径中冒号已替换为双下划线
- ✅ 子 Agent 目录结构符合设计规范
- ✅ 跨平台兼容性测试通过

## 相关文档

- [问题诊断文档](./workspace-directory-structure-issue.md)
- [多 Agent 架构设计](../multi-agent-architecture.md)
