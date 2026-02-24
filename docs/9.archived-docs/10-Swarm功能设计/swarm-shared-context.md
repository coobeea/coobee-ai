# Swarm 共享上下文设计

## 🎯 核心问题

**用户提问**：蜂群里的各个智能体，是不是都应该知道他们讨论的内容？还有一些通用信息？不然会导致上下文丢失。

**现状问题**：

```
Coder + Reviewer 讨论架构设计
    ↓
讨论结果存在哪里？
    ↓
Analyst 能看到吗？❌
    ↓
Analyst 的上下文是不完整的 → 做出错误决策
```

---

## 📊 现有机制分析

### 1. Session 机制（独立）

```typescript
// 每个 Agent 有独立的 Session
workspace/sessions/
├── {sessionId}:triage/messages.jsonl      // Triage 的对话
├── {sessionId}:coder/messages.jsonl       // Coder 的对话
└── {sessionId}:reviewer/messages.jsonl    // Reviewer 的对话
```

**问题**：Session 是隔离的，Agent 之间**看不到**彼此的对话历史。

### 2. SwarmContext（共享状态）

```typescript
// 所有 Agent 可以读写
context.set('analysis_result', '...', 'analyst');
context.get('analysis_result'); // 其他 Agent 可以读取
```

**优点**：键值对共享
**缺点**：

- 只适合存储结构化数据
- 不适合存储对话历史
- 需要 Agent **主动**写入

### 3. MessageBus（消息系统）

```typescript
// Agent 间发送消息
messageBus.send('coder', 'reviewer', '请审查代码');
messageBus.getUnreadMessages('reviewer'); // Reviewer 读取
```

**优点**：点对点通信
**缺点**：

- 需要 Agent **主动**查询
- 其他 Agent 看不到消息（除非是广播）

---

## 🏗️ 解决方案：分层共享机制

### 核心理念

> **所有重要信息都应该自动写入共享知识库，每个 Agent 启动时自动获取。**

### 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   Swarm 共享知识库                        │
│                                                           │
│  1. SwarmContext (结构化状态)                            │
│     - key-value 存储                                     │
│     - artifacts (产物)                                   │
│     - progress (进度)                                    │
│                                                           │
│  2. Discussion History (讨论历史) 🆕                     │
│     - 自动记录所有讨论                                    │
│     - 所有 Agent 可见                                    │
│                                                           │
│  3. Agent Activity Log (活动日志) 🆕                     │
│     - Agent 执行记录                                     │
│     - 决策依据                                           │
└─────────────────────────────────────────────────────────┘
         ↑                 ↑                 ↑
         │                 │                 │
    ┌────┴───┐        ┌────┴───┐       ┌────┴───┐
    │ Coder  │        │Reviewer│       │Analyst │
    │ Agent  │        │ Agent  │       │ Agent  │
    └────────┘        └────────┘       └────────┘
       独立 Session     独立 Session      独立 Session
```

---

## 📁 文件结构设计

### 完整 Workspace 结构

```
workspace/{sessionId}/
├── sessions/                       # Agent 私有对话历史
│   ├── {sessionId}:triage/
│   │   └── messages.jsonl
│   ├── {sessionId}:coder/
│   │   └── messages.jsonl
│   └── {sessionId}:reviewer/
│       └── messages.jsonl
│
└── swarm/                          # Swarm 共享知识库 🆕
    ├── knowledge-base.jsonl        # 🆕 共享知识库（所有 Agent 可见）
    ├── discussions/                # 讨论历史
    │   └── disc-001.jsonl
    ├── activities.jsonl            # 🆕 Agent 活动日志
    ├── context.jsonl               # SwarmContext 变更历史
    ├── artifacts/                  # 产物
    └── messages.jsonl              # Agent 间消息
```

### 核心文件：`knowledge-base.jsonl`

**作用**：存储所有 Agent 应该知道的信息。

**格式**：

```jsonl
{"type":"discussion_summary","discussionId":"disc-001","participants":["coder","reviewer"],"topic":"架构设计","summary":"决定使用工厂模式+依赖注入","ts":1708502400000}
{"type":"decision","decision":"采用 TypeScript strict 模式","madeBy":"coder","reason":"提高代码质量","ts":1708502410000}
{"type":"artifact_created","name":"Button.vue","createdBy":"coder","type":"code","ts":1708502420000}
{"type":"milestone","milestone":"代码重构完成","achievedBy":"coder","ts":1708502430000}
{"type":"issue_found","issue":"性能瓶颈在数据库查询","foundBy":"analyst","severity":"high","ts":1708502440000}
```

**特点**：

- 自动写入（Agent 不需要主动操作）
- 所有 Agent 启动时自动加载
- 包含关键决策、讨论结果、重要产物

---

## 🔄 信息流转机制

### 场景 1：讨论结果自动同步

```typescript
// Coder 调用 discuss_with
const result = await discuss_with({
  role: 'reviewer',
  topic: '架构设计',
  message: '单例模式可以吗？'
});

// 讨论结束后，SwarmCoordinator 自动写入知识库
await knowledgeBase.append({
  type: 'discussion_summary',
  discussionId: result.discussionId,
  participants: ['coder', 'reviewer'],
  topic: '架构设计',
  summary: extractSummary(result.transcript), // 自动提取摘要
  decision: '使用依赖注入代替单例',
  ts: Date.now()
});

// 其他 Agent（如 Analyst）启动时自动获取
// Analyst 的 instructions 会包含：
// "最近讨论：Coder 和 Reviewer 决定使用依赖注入..."
```

### 场景 2：重要决策自动记录

```typescript
// Coder 使用 write_shared_context
context.set('architecture_decision', 'microservices', 'coder');

// SwarmCoordinator 检测到重要键（如 *_decision），自动写入知识库
await knowledgeBase.append({
  type: 'decision',
  decision: 'microservices',
  madeBy: 'coder',
  context: context.get('architecture_decision'),
  ts: Date.now()
});
```

### 场景 3：Agent 启动时注入上下文

```typescript
// 创建 Agent 时
async createRoleRuntime(role, sessionId) {
  // 读取共享知识库
  const recentKnowledge = await knowledgeBase.getRecent(20);

  // 构建上下文摘要
  const contextSummary = buildContextSummary(recentKnowledge);

  // 注入到 instructions
  const instructions = `
${role.instructions}

## Swarm 协作上下文

你是 Swarm 中的 ${role.name}。以下是其他 Agent 的最近活动和决策：

${contextSummary}

请基于以上信息进行工作。如有疑问，可以：
- 使用 read_shared_context 读取详细状态
- 使用 get_messages 查看相关消息
- 使用 discuss_with 和相关 Agent 讨论
`;

  return agentExecutor
    .piMono()
    .instructions(instructions)
    .sessionId(sessionId)
    .build();
}
```

---

## 📝 实现细节

### 1. KnowledgeBase 类

```typescript
// src/main/ai/swarm/KnowledgeBase.ts
export class KnowledgeBase {
  private readonly filePath: string;
  private entries: KnowledgeEntry[] = [];

  constructor(workspaceDir: string) {
    this.filePath = join(workspaceDir, 'swarm/knowledge-base.jsonl');
    this.init();
  }

  /**
   * 追加知识条目（同步写入文件）
   */
  append(entry: KnowledgeEntry): void {
    this.entries.push(entry);

    // 同步写入文件（用户要求同步，不用异步）
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.filePath, line, 'utf-8');
  }

  /**
   * 获取最近 N 条知识
   */
  getRecent(count: number = 20): KnowledgeEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * 按类型筛选
   */
  getByType(type: string): KnowledgeEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * 搜索（按关键词）
   */
  search(keyword: string): KnowledgeEntry[] {
    return this.entries.filter((e) => JSON.stringify(e).toLowerCase().includes(keyword.toLowerCase()));
  }

  /**
   * 构建上下文摘要（给 Agent instructions）
   */
  buildSummary(count: number = 10): string {
    const recent = this.getRecent(count);
    const lines: string[] = [];

    for (const entry of recent) {
      switch (entry.type) {
        case 'discussion_summary':
          lines.push(`- [讨论] ${entry.participants.join('+')} 讨论了 ${entry.topic}：${entry.summary}`);
          break;
        case 'decision':
          lines.push(`- [决策] ${entry.madeBy} 决定：${entry.decision}`);
          break;
        case 'artifact_created':
          lines.push(`- [产物] ${entry.createdBy} 创建了 ${entry.name}`);
          break;
        case 'milestone':
          lines.push(`- [里程碑] ${entry.achievedBy} 完成：${entry.milestone}`);
          break;
        case 'issue_found':
          lines.push(`- [问题] ${entry.foundBy} 发现：${entry.issue}`);
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * 从文件恢复
   */
  private init(): void {
    if (!existsSync(this.filePath)) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, '', 'utf-8');
      return;
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l);

    this.entries = lines.map((line) => JSON.parse(line));
  }
}

/**
 * 知识条目类型
 */
export interface KnowledgeEntry {
  type: 'discussion_summary' | 'decision' | 'artifact_created' | 'milestone' | 'issue_found' | 'custom';
  ts: number;
  [key: string]: any;
}
```

### 2. SwarmCoordinator 集成

```typescript
// SwarmCoordinator.ts
class SwarmCoordinator {
  private knowledgeBase: KnowledgeBase;

  constructor(config: SwarmConfig) {
    // ...
    this.knowledgeBase = new KnowledgeBase(workspaceDir);
  }

  /**
   * 讨论结束后自动记录
   */
  private async recordDiscussionSummary(discussion: DiscussionResult) {
    // 自动提取摘要（可选：使用 LLM 生成摘要）
    const summary = this.extractDiscussionSummary(discussion);

    this.knowledgeBase.append({
      type: 'discussion_summary',
      discussionId: discussion.id,
      participants: discussion.participants,
      topic: discussion.topic,
      summary,
      decision: discussion.decision,
      ts: Date.now()
    });
  }

  /**
   * 创建 Agent 时注入共享上下文
   */
  private async createRoleRuntime(role: AgentRole, sessionId: string) {
    // 读取最近知识
    const contextSummary = this.knowledgeBase.buildSummary(10);

    // 注入到 instructions
    const instructions = `
${role.instructions}

## Swarm 协作上下文

${contextSummary}

## 协作工具
...
`;

    return agentExecutor.piMono().instructions(instructions).sessionId(sessionId).build();
  }
}
```

---

## 🎯 效果演示

### 场景：Analyst 能看到之前的讨论

```
[时间线]

1. Coder + Reviewer 讨论架构
   → 决定使用依赖注入
   → 自动写入 knowledge-base.jsonl ✅

2. Analyst 启动
   → 读取 knowledge-base.jsonl
   → instructions 包含："Coder 和 Reviewer 决定使用依赖注入"
   → Analyst 的决策基于完整上下文 ✅

3. Writer 启动
   → 看到之前的讨论和决策
   → 写文档时不会遗漏关键信息 ✅
```

### 实际对话示例

```
Analyst 启动时的 instructions:

你是数据分析专家。

## Swarm 协作上下文

以下是其他 Agent 的最近活动：

- [讨论] coder+reviewer 讨论了架构设计：决定使用依赖注入代替单例模式
- [决策] coder 决定：采用 TypeScript strict 模式
- [产物] coder 创建了 Button.vue（代码）
- [里程碑] coder 完成：代码重构

请基于以上信息分析性能瓶颈。
```

**Analyst 现在有完整上下文！** ✅

---

## 📊 对比：有无共享知识库

| 场景              | 无共享知识库    | 有共享知识库        |
| ----------------- | --------------- | ------------------- |
| **Coder 讨论后**  | Reviewer 知道   | ✅ 所有 Agent 知道  |
| **Analyst 启动**  | ❌ 上下文不完整 | ✅ 自动获取讨论结果 |
| **Writer 写文档** | ❌ 可能遗漏信息 | ✅ 基于完整上下文   |
| **程序重启**      | ❌ 讨论丢失     | ✅ 从文件恢复       |

---

## 🚀 实现步骤

### 第一步：实现 KnowledgeBase 类 ✅

- 文件读写
- 条目追加
- 摘要生成

### 第二步：集成到 SwarmCoordinator ✅

- 讨论结束后自动记录
- Agent 启动时注入上下文
- 重要决策自动记录

### 第三步：优化上下文注入 ✅

- 智能摘要（可选：LLM 生成）
- 相关性筛选
- 上下文压缩

### 第四步：测试验证 ✅

- 多 Agent 协作测试
- 上下文传播验证
- 重启恢复测试

---

## 🎯 总结

### ✅ 解决的问题

1. **上下文丢失** → 知识库自动共享
2. **讨论不可见** → 讨论结果自动同步
3. **重启丢失** → 文件持久化
4. **手动同步** → 自动写入+注入

### 🚀 核心优势

- **自动化**：Agent 不需要主动操作
- **完整性**：所有 Agent 看到相同上下文
- **持久化**：文件存储，重启恢复
- **可追溯**：完整审计历史

### 📝 用户体验

```
用户：重构这个模块

Coder: 我先和 Reviewer 讨论一下架构...
       （讨论结束，结果自动写入知识库）

Analyst: 我看到 Coder 和 Reviewer 决定用依赖注入
        基于这个设计，我分析一下性能影响...
        ✅ Analyst 有完整上下文！

Writer: 我看到架构决策和性能分析
       开始写文档...
       ✅ Writer 基于完整信息！
```

**所有 Agent 的决策都基于完整、一致的上下文！** 🎉
