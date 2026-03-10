# AI 模块架构规范

## 1. 模块职责边界定义

### 1.1 单一职责原则

每个模块应该只有一个明确的职责，避免职责混淆。

**示例**：

- ✅ `AgentFactory` - 只负责 Agent 实例的创建和管理
- ❌ `AgentFactory` 既管理实例又处理配置持久化

### 1.2 模块边界

| 模块             | 职责                                               | 不应该做                   |
| ---------------- | -------------------------------------------------- | -------------------------- |
| `agents/`        | Agent 实例创建、工厂管理、预设配置                 | 不处理配置存储、不执行任务 |
| `memory/`        | 四类记忆管理（Session/ShortTerm/Working/LongTerm） | 不处理流式输出、不执行任务 |
| `orchestration/` | 任务编排、计划管理、Worker 协调                    | 不创建 Agent、不处理记忆   |
| `runtime/`       | 统一执行接口、生命周期管理                         | 不处理底层 Agent 逻辑      |
| `streaming/`     | 流式事件生产和消费                                 | 不执行任务、不管理记忆     |
| `storage/`       | 数据持久化（文件+数据库）                          | 不处理业务逻辑             |
| `skills/`        | 技能注册和管理                                     | 不创建 Agent               |
| `tools/`         | 工具注册和管理                                     | 不创建 Agent               |
| `monitoring/`    | 性能监控、指标收集                                 | 不执行业务逻辑             |
| `teams/`         | Team 配置管理                                      | 不执行任务                 |

### 1.3 依赖方向

遵循分层架构，依赖方向应该是**单向的**：

```
Runtime Layer (运行时层)
    ↓
Core Layer (核心层)
    ↓
Infrastructure Layer (基础设施层)
```

**规则**：

- 上层可以依赖下层
- 下层不能依赖上层
- 同层之间通过接口解耦

---

## 2. 类型命名规范

### 2.1 接口命名

```typescript
// ✅ 使用 I 前缀或描述性后缀
interface IExecutable {}
interface ExecutionConfig {}
interface ExecutionResult {}

// ❌ 避免
interface Executable {} // 与类名混淆
interface Config {} // 过于泛化
```

### 2.2 类型别名

```typescript
// ✅ 使用 Type 后缀或描述性名称
type AgentPresetType = 'chat' | 'code' | 'research';
type SessionStatus = 'active' | 'paused' | 'completed' | 'error';

// ❌ 避免
type AgentType = string; // 过于泛化
```

### 2.3 枚举命名

```typescript
// ✅ 使用单数名词，成员全大写
enum LongTermMemoryType {
  SEMANTIC = 'semantic',
  EPISODIC = 'episodic',
  PROCEDURAL = 'procedural'
}

// ❌ 避免
enum LongTermMemoryTypes {} // 复数
enum LongTermMemoryType {
  Semantic = 'semantic' // 首字母大写
}
```

### 2.4 类命名

```typescript
// ✅ 使用 PascalCase，描述性名称
class AgentFactory {}
class SessionMemoryStore {}
class StreamEmitter {}

// ❌ 避免
class agentFactory {} // 小写开头
class Factory {} // 过于泛化
```

### 2.5 字段一致性

同一概念在不同类型中应使用统一的字段名：

```typescript
// ✅ 统一
interface SubTask {
  id: string;
  name: string;
  assignedWorker: string;
}

interface WorkerInfo {
  id: string;
  name: string;
}

// ❌ 不一致
interface SubTask {
  id: string;
  objective: string; // 与 name 概念重复
  workerId?: string; // 与 assignedWorker 重复
  assignedWorker?: string;
}
```

---

## 3. 错误处理规范

### 3.1 自定义错误类

所有模块应使用自定义错误类，继承自基础错误类：

```typescript
// src/main/ai/common/errors.ts

export class AIError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AIError';
  }
}

export class PlanningError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'PLANNING_ERROR', details);
  }
}

export class ExecutionError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'EXECUTION_ERROR', details);
  }
}
```

### 3.2 错误处理模式

```typescript
// ✅ 捕获具体错误类型，提供上下文
try {
  const plan = await this.planner.plan(task);
} catch (error) {
  if (error instanceof PlanningError) {
    console.error('[Orchestrator] Planning failed:', error.code, error.details);
    // 特定处理
  }
  throw new ExecutionError('Task execution failed', {
    originalError: error,
    taskId: task.id
  });
}

// ❌ 避免静默失败
try {
  const plan = await this.planner.plan(task);
} catch (error) {
  return { success: false }; // 丢失错误信息
}
```

### 3.3 错误日志

```typescript
// ✅ 结构化日志，包含上下文
console.error('[ModuleName] Operation failed:', {
  operation: 'createAgent',
  sessionId: 'xxx',
  error: error.message,
  code: error.code
});

// ❌ 简单字符串
console.error('Error:', error);
```

---

## 4. 资源管理规范

### 4.1 生命周期管理

所有管理资源的类必须实现 `initialize()` 和 `cleanup()`/`destroy()` 方法：

```typescript
export class ResourceManager {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // 初始化资源
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    // 释放资源
    this.initialized = false;
  }
}
```

### 4.2 缓存管理

缓存必须有过期和淘汰机制：

```typescript
// ✅ LRU 缓存
class CacheManager {
  private cache = new Map<string, { value: any; lastAccess: number }>();
  private readonly maxSize = 100;
  private readonly timeout = 30 * 60 * 1000;

  get(key: string): any | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    // 检查过期
    if (Date.now() - cached.lastAccess > this.timeout) {
      this.cache.delete(key);
      return undefined;
    }

    // 更新访问时间
    cached.lastAccess = Date.now();
    return cached.value;
  }

  set(key: string, value: any): void {
    this.evictIfNeeded();
    this.cache.set(key, { value, lastAccess: Date.now() });
  }

  private evictIfNeeded(): void {
    if (this.cache.size >= this.maxSize) {
      // LRU 淘汰最久未使用
    }
  }
}
```

### 4.3 文件句柄

文件操作应使用 try-finally 确保关闭：

```typescript
// ✅ 使用 fs/promises，自动管理
import { readFile, writeFile } from 'fs/promises';

async function saveData(path: string, data: string): Promise<void> {
  await writeFile(path, data, 'utf-8');
}

// ❌ 避免手动管理句柄（除非必要）
```

### 4.4 定时器清理

```typescript
class Timer {
  private intervalId: NodeJS.Timeout | null = null;

  start(): void {
    this.intervalId = setInterval(() => {
      // 定时任务
    }, 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

---

## 5. 接口设计原则

### 5.1 参数对象模式

超过 3 个参数时，使用参数对象：

```typescript
// ✅ 参数对象
interface CreateAgentOptions {
  sessionId: string;
  configId?: string;
  preset?: AgentPresetType;
  tools?: string[];
}

async function createAgent(options: CreateAgentOptions): Promise<Agent>;

// ❌ 过多参数
async function createAgent(sessionId: string, configId?: string, preset?: string, tools?: string[]): Promise<Agent>;
```

### 5.2 返回值一致性

```typescript
// ✅ 统一返回结构
interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

// ❌ 不一致
function methodA(): string; // 直接返回字符串
function methodB(): { result: string }; // 返回对象
```

### 5.3 可选参数放最后

```typescript
// ✅
function execute(input: string, config?: ExecutionConfig): Promise<Result>;

// ❌
function execute(config?: ExecutionConfig, input: string): Promise<Result>;
```

### 5.4 异步优先

所有 I/O 操作使用 `async/await`：

```typescript
// ✅ 异步
async function loadConfig(): Promise<Config> {
  const data = await readFile(path, 'utf-8');
  return JSON.parse(data);
}

// ❌ 同步（除非有充分理由）
function loadConfigSync(): Config {
  const data = readFileSync(path, 'utf-8');
  return JSON.parse(data);
}
```

---

## 6. 文档同步要求

### 6.1 模块文档

每个模块必须有 `README.md` 或在主 `README.md` 中有对应章节。

**必需内容**：

1. 模块职责
2. 核心组件
3. 使用示例
4. API 参考（如果暴露公共接口）

### 6.2 接口文档

公共接口必须有 JSDoc 注释：

````typescript
/**
 * 创建 Agent 实例
 *
 * @param options - 创建选项
 * @param options.sessionId - 会话 ID
 * @param options.configId - 配置 ID（可选）
 * @param options.preset - 预设类型（可选）
 * @returns Agent 实例
 *
 * @example
 * ```typescript
 * const agent = await agentFactory.createAgent({
 *   sessionId: 'session-123',
 *   preset: 'chat'
 * })
 * ```
 */
async createAgent(options: CreateAgentOptions): Promise<Agent>
````

### 6.3 架构图同步

代码结构变更时，必须同步更新架构图：

- 主架构图：`src/main/ai/README.md`
- 模块级架构图：各模块的文档

### 6.4 变更日志

重要变更必须记录在 `CHANGELOG.md`：

```markdown
## [1.2.0] - 2026-02-05

### Added

- 集成 VerificationGate 到 Orchestrator
- 实现真正的流式输出

### Fixed

- 修复 ShortTermMemory 未实现的问题
- 统一类型定义，清理冗余字段

### Changed

- TeamRuntime 集成 Orchestrator（破坏性变更）
```

---

## 7. 代码组织规范

### 7.1 文件结构

```
module/
├── index.ts           # 模块导出入口
├── types.ts           # 类型定义
├── ClassName.ts       # 类实现（一个类一个文件）
└── helpers/           # 辅助函数
    └── utils.ts
```

### 7.2 导入顺序

```typescript
// 1. Node.js 内置模块
import { readFile } from 'fs/promises';
import { join } from 'path';

// 2. 外部依赖
import { Agent } from '@openai/agents';
import OpenAI from 'openai';

// 3. 内部模块（按层级）
import { eventBus } from '@main/common/eventbus';
import { agentFactory } from '../agents';
import type { ExecutionConfig } from './types';

// 4. 同级模块
import { StreamEmitter } from './StreamEmitter';
```

### 7.3 导出规范

```typescript
// index.ts - 统一导出

// 导出类型
export type { Task, SubTask, ExecutionPlan } from './types';

// 导出类
export { Orchestrator } from './Orchestrator';
export { Planner } from './Planner';

// 导出工厂函数
export { createOrchestrator } from './Orchestrator';
```

---

## 8. 测试规范

### 8.1 测试覆盖要求

- 核心模块：> 80%
- 工具类：> 90%
- 类型定义：100%（通过 TypeScript）

### 8.2 测试文件组织

```
src/
└── main/
    └── ai/
        ├── agents/
        │   ├── AgentFactory.ts
        │   └── __tests__/
        │       └── AgentFactory.test.ts
```

### 8.3 测试命名

```typescript
// ✅ 描述性测试名称
describe('AgentFactory', () => {
  describe('createAgent', () => {
    it('should create agent with preset', async () => {
      // ...
    });

    it('should throw error when config not found', async () => {
      // ...
    });
  });
});

// ❌ 不清晰
describe('AgentFactory', () => {
  it('test1', () => {});
});
```

---

## 9. 性能规范

### 9.1 避免 N+1 查询

```typescript
// ✅ 批量查询
const agents = await Promise.all(memberIds.map((id) => agentFactory.getAgent(id)));

// ❌ 循环查询
for (const id of memberIds) {
  const agent = await agentFactory.getAgent(id);
}
```

### 9.2 使用批量操作

```typescript
// ✅ 批量写入
await db.transaction(async () => {
  for (const msg of messages) {
    await db.insert(msg);
  }
});

// ❌ 逐条写入
for (const msg of messages) {
  await db.insert(msg);
}
```

### 9.3 缓存策略

- 频繁访问的数据必须缓存
- 缓存必须有过期机制
- 缓存必须有大小限制

---

## 10. 安全规范

### 10.1 输入验证

```typescript
// ✅ 验证输入
function createAgent(sessionId: string): Agent {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId');
  }
  // ...
}
```

### 10.2 SQL 注入防护

```typescript
// ✅ 使用参数化查询
await db.query('SELECT * FROM agents WHERE id = ?', [agentId]);

// ❌ 字符串拼接
await db.query(`SELECT * FROM agents WHERE id = '${agentId}'`);
```

### 10.3 敏感信息

```typescript
// ✅ 不记录敏感信息
console.log('Agent created:', { agentId, sessionId });

// ❌ 记录敏感信息
console.log('Agent created:', { apiKey: 'sk-...' });
```

---

## 11. 版本兼容性

### 11.1 破坏性变更

破坏性变更必须：

1. 在 `CHANGELOG.md` 中标注
2. 提供迁移指南
3. 保留兼容层（至少一个版本）

### 11.2 废弃警告

```typescript
/**
 * @deprecated Use createAgent() instead. Will be removed in v2.0.0
 */
export function createAgentOld(): Agent {
  console.warn('createAgentOld() is deprecated, use createAgent() instead');
  return createAgent();
}
```

---

## 12. 代码审查 Checklist

提交代码前，确保：

- [ ] 遵循单一职责原则
- [ ] 依赖方向正确
- [ ] 类型定义统一
- [ ] 错误处理完善
- [ ] 资源正确清理
- [ ] 接口设计合理
- [ ] 文档已同步
- [ ] 测试覆盖充分
- [ ] 性能优化合理
- [ ] 安全考虑充分
- [ ] 类型检查通过
- [ ] ESLint 检查通过

---

## 13. 参考资源

- [TypeScript 最佳实践](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Node.js 最佳实践](https://github.com/goldbergyoni/nodebestpractices)
- [SOLID 原则](https://en.wikipedia.org/wiki/SOLID)
- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
