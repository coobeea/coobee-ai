# Swarm 持久化功能使用指南

## 概述

Swarm 现在支持完整的文件持久化，所有数据（上下文、消息、讨论历史、知识库）都会自动同步写入文件，程序重启后自动恢复。

## 核心特性

### 1. 自动持久化

所有 Swarm 运行时默认启用持久化（可通过 `enablePersistence: false` 禁用）：

- **SwarmContext** → `workspace/{sessionId}/swarm/context.jsonl`
- **MessageBus** → `workspace/{sessionId}/swarm/messages.jsonl`
- **KnowledgeBase** → `workspace/{sessionId}/swarm/knowledge-base.jsonl`
- **Artifacts** → `workspace/{sessionId}/swarm/artifacts/`

### 2. 共享知识库

所有 Agent 启动时自动加载最近 10 条协作历史，确保上下文一致：

```typescript
// Agent instructions 中会自动包含：
## Swarm 协作上下文

以下是其他 Agent 的最近活动和决策：

- [讨论] coder+reviewer 讨论了 架构设计：使用依赖注入 → 决策：工厂模式
- [决策] coder 决定：采用 TypeScript strict 模式（提高质量）
- [产物] coder 创建了 Button.vue（code）
- [里程碑] coder 完成：代码重构完成
- [问题] analyst 发现[HIGH]：性能瓶颈
```

### 3. 崩溃恢复

程序重启后自动从文件恢复所有状态，无需额外代码。

## 使用示例

### 基础用法（默认持久化）

```typescript
import { SwarmRuntime } from '@main/ai/swarm';

// 创建 Swarm（默认启用持久化）
const swarm = new SwarmRuntime('my-swarm', 'session-001');

await swarm.initialize();

// 运行任务（所有数据自动持久化）
const result = await swarm.run('设计一个用户管理系统');

console.log(result.output);
```

### 自定义 Workspace 目录

```typescript
import { SwarmRuntime } from '@main/ai/swarm';

const swarm = new SwarmRuntime('my-swarm', 'session-001', {
  workspaceDir: '/path/to/custom/workspace',
  enablePersistence: true
});
```

### 禁用持久化（仅内存模式）

```typescript
const swarm = new SwarmRuntime('my-swarm', 'session-001', {
  enablePersistence: false
});
```

### 手动使用持久化组件

```typescript
import { FileSwarmContext, FileMessageBus, KnowledgeBase } from '@main/ai/swarm';

const workspaceDir = '/path/to/workspace';

// 创建持久化实例
const context = new FileSwarmContext(workspaceDir);
const messageBus = new FileMessageBus(workspaceDir);
const knowledgeBase = new KnowledgeBase(workspaceDir);

// 使用（所有操作自动同步写入文件）
context.set('key', 'value', 'coder');
context.addArtifact('code.ts', 'const x = 1', 'coder', 'code');

messageBus.send('coder', 'reviewer', '请审查代码');

knowledgeBase.append({
  type: 'decision',
  decision: '采用微服务架构',
  madeBy: 'coder',
  reason: '提高可扩展性',
  ts: Date.now()
});

// 程序重启后
const context2 = new FileSwarmContext(workspaceDir);
console.log(context2.get('key')); // 'value'
console.log(context2.getArtifact('code.ts')); // { content: 'const x = 1', ... }
```

## 文件结构

```
workspace/
└── {sessionId}/
    ├── swarm/
    │   ├── context.jsonl          # 状态变更日志
    │   ├── messages.jsonl         # 消息历史
    │   ├── knowledge-base.jsonl   # 共享知识库
    │   ├── progress.jsonl         # 进度日志
    │   └── artifacts/             # 产物文件夹
    │       ├── Button.vue         # 产物内容
    │       ├── Button.vue.meta.json  # 产物元数据
    │       └── ...
    └── sessions/
        └── messages.jsonl         # Agent 会话历史
```

## KnowledgeBase 知识类型

### 1. 讨论摘要

```typescript
knowledgeBase.append({
  type: 'discussion_summary',
  discussionId: 'disc-001',
  participants: ['coder', 'reviewer'],
  topic: '架构设计',
  summary: '决定使用依赖注入',
  decision: '工厂模式',
  ts: Date.now()
});
```

### 2. 决策

```typescript
knowledgeBase.append({
  type: 'decision',
  decision: '采用 TypeScript strict 模式',
  madeBy: 'coder',
  reason: '提高代码质量',
  ts: Date.now()
});
```

### 3. 产物创建

```typescript
// 自动记录（通过 SwarmCoordinator 监听 Context 变更）
context.addArtifact('Button.vue', '<template>...</template>', 'coder', 'code');

// 或手动记录
knowledgeBase.append({
  type: 'artifact_created',
  name: 'Button.vue',
  createdBy: 'coder',
  artifactType: 'code',
  ts: Date.now()
});
```

### 4. 里程碑

```typescript
knowledgeBase.append({
  type: 'milestone',
  milestone: '代码重构完成',
  achievedBy: 'coder',
  details: '所有模块已重构为 TypeScript',
  ts: Date.now()
});
```

### 5. 问题发现

```typescript
knowledgeBase.append({
  type: 'issue_found',
  issue: '性能瓶颈：大量数据库查询',
  foundBy: 'analyst',
  severity: 'high',
  context: '在用户列表页面',
  ts: Date.now()
});
```

## 查询 API

### KnowledgeBase

```typescript
// 获取所有条目
const all = knowledgeBase.getAll();

// 获取最近 N 条
const recent = knowledgeBase.getRecent(20);

// 按类型筛选
const decisions = knowledgeBase.getByType('decision');

// 搜索
const results = knowledgeBase.search('架构');

// 构建摘要（供 Agent 使用）
const summary = knowledgeBase.buildSummary(10);

// 统计信息
const stats = knowledgeBase.getStats();
console.log(stats);
// {
//   total: 42,
//   byType: { decision: 10, milestone: 5, artifact_created: 15, ... },
//   recentActivity: '- [决策] coder 决定：...'
// }
```

### FileSwarmContext

```typescript
// 读取状态
const value = context.get('key');

// 获取所有状态
const allState = context.export().state;

// 获取产物
const artifact = context.getArtifact('Button.vue');

// 获取所有产物
const artifacts = context.getAllArtifacts();

// 获取进度
const progress = context.getProgressNotes();
```

### FileMessageBus

```typescript
// 获取发给某角色的消息
const messages = messageBus.getMessagesForRole('reviewer');

// 获取未读消息
const unread = messageBus.getUnreadMessages('reviewer');

// 标记已读
messageBus.markAsRead(messageId);
```

## 性能说明

- **同步写入**：所有文件操作都是同步的（`fs.writeFileSync`, `fs.appendFileSync`）
- **JSONL 格式**：使用 JSON Lines 格式，支持增量追加，便于大文件处理
- **适用场景**：适合中小型任务（< 10000 条消息/知识），大规模任务建议使用数据库

## 注意事项

1. **Workspace 路径**：确保 `workspaceDir` 有写权限
2. **并发安全**：当前实现是单进程同步写入，不支持多进程并发写
3. **文件清理**：旧的 workspace 需要手动清理，或实现自动归档策略
4. **备份**：重要数据建议定期备份 `swarm/` 目录

## 调试

### 查看文件内容

```bash
# 查看上下文日志
cat workspace/session-001/swarm/context.jsonl | jq

# 查看消息历史
cat workspace/session-001/swarm/messages.jsonl | jq

# 查看知识库
cat workspace/session-001/swarm/knowledge-base.jsonl | jq

# 查看产物列表
ls -lh workspace/session-001/swarm/artifacts/
```

### 日志

```typescript
import { createLogger } from '@main/common/logger';

const log = createLogger('swarm:coordinator');

// SwarmCoordinator 会自动记录所有重要事件到日志
// 包括知识库记录、上下文变更、消息发送等
```

## 最佳实践

1. **明确 Session ID**：使用有意义的 sessionId（如 `user-123-task-456`），便于追踪
2. **定期清理**：实现 workspace 清理策略，避免磁盘占满
3. **监控文件大小**：大型任务可能产生大量文件，注意监控
4. **结构化知识**：使用标准知识类型（decision, milestone 等），便于后续分析
5. **备份策略**：重要 workspace 定期备份到对象存储

## 迁移指南

### 从内存版本迁移

旧代码无需修改，持久化功能是向后兼容的：

```typescript
// 旧代码（仍然可用）
const swarm = new SwarmRuntime('my-swarm');

// 新代码（自动持久化）
const swarm = new SwarmRuntime('my-swarm', 'session-001'); // sessionId 推荐明确指定
```

### 自定义持久化

如果需要自定义持久化逻辑（如写入数据库），可以继承相关类：

```typescript
import { SwarmContext } from '@main/ai/swarm';

class DatabaseSwarmContext extends SwarmContext {
  override set(key: string, value: unknown, roleId: string): void {
    super.set(key, value, roleId);
    // 自定义：写入数据库
    this.db.insert({ key, value, roleId });
  }
}

// 注入自定义实例
const swarm = new SwarmRuntime('my-swarm', 'session-001', {
  config: {
    context: new DatabaseSwarmContext()
    // ...
  }
});
```

## 相关文档

- [Swarm 设计文档](../design/swarm-persistence.md)
- [共享上下文设计](../design/swarm-shared-context.md)
- [Discussion 功能设计](../design/swarm-discussion-feature.md)
