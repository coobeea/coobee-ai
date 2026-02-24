# Swarm 数据持久化设计

## 🎯 核心原则

> **所有数据都应该通过文件方式落地，不应该保存在内存中。**
>
> - 讨论结果 → 文件
> - 交互过程 → 文件
> - 协作状态 → 文件
> - Agent 产物 → 文件

---

## 📊 现状分析

### ✅ 已有持久化

| 数据类型       | 存储位置                              | 实现方式      |
| -------------- | ------------------------------------- | ------------- |
| Agent 对话历史 | `sessions/{sessionId}/messages.jsonl` | `FileSession` |
| 流式事件       | `events/events.jsonl`                 | 事件写入器    |
| 任务检查点     | `checkpoint.json`                     | JSON 文件     |
| 输出文件       | `output/`                             | 文件系统      |

### ❌ 缺失持久化

| 数据类型        | 当前状态   | 影响                    |
| --------------- | ---------- | ----------------------- |
| SwarmContext    | 内存       | 程序重启后丢失共享状态  |
| MessageBus      | 内存       | 无法回溯 Agent 消息历史 |
| Discussion 数据 | （未实现） | 讨论过程无法审计        |

---

## 🏗️ 持久化方案

### 方案 1：SwarmContext 持久化

#### 目标文件结构

```
workspace/{sessionId}/
└── swarm/
    ├── context.jsonl          # 共享上下文变更历史
    ├── artifacts/             # 产物文件夹
    │   ├── code_v1.ts
    │   ├── analysis.md
    │   └── design_doc.pdf
    └── progress.jsonl         # 进度记录
```

#### 实现方式

##### A. `context.jsonl` - 变更历史追踪

每次状态变更追加一行 JSON：

```jsonl
{"type":"state_set","key":"analysis_result","value":"...","roleId":"analyst","ts":1708502400000}
{"type":"state_set","key":"code_status","value":"in_progress","roleId":"coder","ts":1708502410000}
{"type":"state_delete","key":"temp_var","roleId":"system","ts":1708502420000}
```

**优点**：

- 完整审计追踪
- 支持时间旅行（回放历史状态）
- 崩溃恢复（重放日志）

##### B. `artifacts/` - 产物文件化

每个 artifact 存储为独立文件：

```typescript
// 原：内存中的 artifact 对象
{
  name: 'Button.vue',
  content: '<template>...</template>',
  createdBy: 'coder',
  type: 'code'
}

// 改：文件系统
artifacts/
├── Button.vue                  # 实际内容
└── Button.vue.meta.json        # 元数据
    {
      "name": "Button.vue",
      "createdBy": "coder",
      "createdAt": 1708502400000,
      "type": "code"
    }
```

##### C. `progress.jsonl` - 进度日志

```jsonl
{"note":"开始代码分析","roleId":"coder","ts":1708502400000}
{"note":"发现3处性能问题","roleId":"analyst","ts":1708502410000}
{"note":"代码重构完成","roleId":"coder","ts":1708502420000}
```

#### 代码实现

```typescript
// FileSwarmContext.ts
export class FileSwarmContext extends SwarmContext {
  private readonly workspaceDir: string;
  private readonly contextLogPath: string;
  private readonly artifactsDir: string;
  private readonly progressLogPath: string;

  constructor(sessionId: string, workspaceDir: string) {
    super();
    this.workspaceDir = join(workspaceDir, 'swarm');
    this.contextLogPath = join(this.workspaceDir, 'context.jsonl');
    this.artifactsDir = join(this.workspaceDir, 'artifacts');
    this.progressLogPath = join(this.workspaceDir, 'progress.jsonl');

    this.init();
  }

  private async init() {
    // 创建目录
    await mkdir(this.workspaceDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });

    // 恢复状态（重放 context.jsonl）
    await this.replay();
  }

  // ========== 状态持久化 ==========

  override set(key: string, value: unknown, roleId: string = 'system'): void {
    super.set(key, value, roleId);

    // 追加到 context.jsonl
    this.appendContextLog({
      type: 'state_set',
      key,
      value,
      roleId,
      ts: Date.now()
    });
  }

  override delete(key: string, roleId: string = 'system'): boolean {
    const deleted = super.delete(key, roleId);
    if (deleted) {
      this.appendContextLog({
        type: 'state_delete',
        key,
        roleId,
        ts: Date.now()
      });
    }
    return deleted;
  }

  // ========== Artifact 持久化 ==========

  override addArtifact(name: string, content: string, createdBy: string, type?: string): void {
    super.addArtifact(name, content, createdBy, type);

    // 写文件 + 元数据
    const filePath = join(this.artifactsDir, name);
    const metaPath = `${filePath}.meta.json`;

    writeFile(filePath, content, 'utf-8');
    writeFile(
      metaPath,
      JSON.stringify(
        {
          name,
          createdBy,
          createdAt: Date.now(),
          type
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  // ========== 进度持久化 ==========

  override addProgressNote(note: string, roleId: string = 'system'): void {
    super.addProgressNote(note, roleId);

    this.appendProgressLog({
      note,
      roleId,
      ts: Date.now()
    });
  }

  // ========== 辅助方法 ==========

  private appendContextLog(entry: any) {
    const line = JSON.stringify(entry) + '\n';
    appendFile(this.contextLogPath, line, 'utf-8');
  }

  private appendProgressLog(entry: any) {
    const line = JSON.stringify(entry) + '\n';
    appendFile(this.progressLogPath, line, 'utf-8');
  }

  /**
   * 恢复状态（从日志重放）
   */
  private async replay() {
    if (!existsSync(this.contextLogPath)) return;

    const content = await readFile(this.contextLogPath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l);

    for (const line of lines) {
      const entry = JSON.parse(line);

      switch (entry.type) {
        case 'state_set':
          super.set(entry.key, entry.value, entry.roleId);
          break;
        case 'state_delete':
          super.delete(entry.key, entry.roleId);
          break;
      }
    }

    // 恢复 artifacts（从文件系统读取）
    const artifactFiles = await readdir(this.artifactsDir);
    for (const file of artifactFiles) {
      if (file.endsWith('.meta.json')) continue;

      const content = await readFile(join(this.artifactsDir, file), 'utf-8');
      const metaPath = join(this.artifactsDir, `${file}.meta.json`);

      if (existsSync(metaPath)) {
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        super.addArtifact(meta.name, content, meta.createdBy, meta.type);
      }
    }
  }
}
```

---

### 方案 2：MessageBus 持久化

#### 目标文件结构

```
workspace/{sessionId}/
└── swarm/
    └── messages.jsonl         # Agent 间消息历史
```

#### 消息格式

```jsonl
{"id":"msg-001","from":"coder","to":"reviewer","content":"请审查这段代码","topic":"code_review","priority":"normal","ts":1708502400000}
{"id":"msg-002","from":"reviewer","to":"coder","content":"发现3处问题","topic":"code_review","priority":"high","ts":1708502410000}
{"id":"msg-003","from":"coder","to":"*","content":"重构完成","priority":"normal","ts":1708502420000}
```

#### 代码实现

```typescript
// FileMessageBus.ts
export class FileMessageBus extends MessageBus {
  private readonly messagesPath: string;

  constructor(sessionId: string, workspaceDir: string) {
    super();
    const swarmDir = join(workspaceDir, 'swarm');
    this.messagesPath = join(swarmDir, 'messages.jsonl');

    this.init();
  }

  private async init() {
    await mkdir(dirname(this.messagesPath), { recursive: true });

    // 恢复消息历史
    await this.replay();
  }

  override send(fromRoleId: string, toRoleId: string, content: string, options?: MessageOptions): SwarmMessage {
    const message = super.send(fromRoleId, toRoleId, content, options);

    // 持久化
    this.appendMessage(message);

    return message;
  }

  private appendMessage(message: SwarmMessage) {
    const line = JSON.stringify(message) + '\n';
    appendFile(this.messagesPath, line, 'utf-8');
  }

  /**
   * 恢复消息历史
   */
  private async replay() {
    if (!existsSync(this.messagesPath)) return;

    const content = await readFile(this.messagesPath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l);

    for (const line of lines) {
      const message = JSON.parse(line);
      // 直接添加到内存（不触发持久化）
      this.messages.push(message);
    }
  }
}
```

---

### 方案 3：Discussion 持久化（新增）

#### 目标文件结构

```
workspace/{sessionId}/
└── swarm/
    └── discussions/
        ├── disc-001-coder-reviewer.jsonl
        └── disc-002-analyst-researcher.jsonl
```

#### 讨论记录格式

```jsonl
{"type":"start","initiator":"coder","participant":"reviewer","topic":"架构评审","ts":1708502400000}
{"type":"round","round":1,"from":"coder","message":"单例模式可以吗？","ts":1708502401000}
{"type":"round","round":1,"from":"reviewer","message":"有并发问题","ts":1708502405000}
{"type":"round","round":2,"from":"coder","message":"那用工厂模式？","ts":1708502410000}
{"type":"round","round":2,"from":"reviewer","message":"更合适，建议...","ts":1708502415000}
{"type":"end","rounds":2,"result":"已达成共识","ts":1708502420000}
```

---

## 🔄 整体架构

### 目录结构（完整版）

```
workspace/{sessionId}/
├── sessions/                   # Agent 对话历史
│   └── {sessionId}/
│       └── messages.jsonl
├── events/                     # 流式事件
│   └── events.jsonl
├── checkpoint.json             # 任务检查点
├── output/                     # 输出文件
├── logs/                       # 日志
└── swarm/                      # 🆕 Swarm 协作数据
    ├── context.jsonl           # 共享上下文变更历史
    ├── artifacts/              # 产物文件夹
    │   ├── Button.vue
    │   ├── Button.vue.meta.json
    │   └── ...
    ├── progress.jsonl          # 进度记录
    ├── messages.jsonl          # Agent 间消息
    └── discussions/            # 讨论记录
        ├── disc-001-coder-reviewer.jsonl
        └── ...
```

---

## 🎯 实现步骤

### 第一步：实现 FileSwarmContext ✅

1. 创建 `FileSwarmContext.ts`（继承 `SwarmContext`）
2. 覆盖 `set`, `delete`, `addArtifact`, `addProgressNote` 方法
3. 添加 `replay()` 恢复逻辑
4. 在 `SwarmCoordinator` 中使用 `FileSwarmContext`

### 第二步：实现 FileMessageBus ✅

1. 创建 `FileMessageBus.ts`（继承 `MessageBus`）
2. 覆盖 `send()` 方法
3. 添加 `replay()` 恢复逻辑
4. 在 `SwarmCoordinator` 中使用 `FileMessageBus`

### 第三步：讨论数据持久化 ✅

1. 在 `discuss_with` 工具中记录讨论过程
2. 每轮对话追加到 `discussions/{id}.jsonl`
3. 提供讨论历史查询 API

### 第四步：测试验证 ✅

1. 创建任务 → 重启程序 → 验证数据恢复
2. 多次讨论 → 检查 `discussions/` 完整性
3. 压力测试（大量消息、产物）

---

## 📊 对比：内存 vs 文件

| 项目         | 内存存储     | 文件存储        |
| ------------ | ------------ | --------------- |
| **程序重启** | ❌ 数据丢失  | ✅ 自动恢复     |
| **审计追踪** | ❌ 无法回溯  | ✅ 完整历史     |
| **崩溃恢复** | ❌ 无法恢复  | ✅ 重放日志     |
| **性能**     | 快（纯内存） | 稍慢（磁盘 IO） |
| **空间占用** | 内存         | 磁盘            |
| **并发安全** | 需要锁       | 文件锁          |

**结论**：对于 Swarm 协作场景，**文件存储是必须的**。

---

## 🚀 性能优化

### 优化 1：批量写入

```typescript
// 不要每次变更都立即写文件
private batchBuffer: any[] = [];
private flushTimer: NodeJS.Timeout;

private appendContextLog(entry: any) {
  this.batchBuffer.push(entry);

  // 100ms 后批量写入
  clearTimeout(this.flushTimer);
  this.flushTimer = setTimeout(() => this.flush(), 100);
}

private async flush() {
  const lines = this.batchBuffer.map(e => JSON.stringify(e)).join('\n') + '\n';
  await appendFile(this.contextLogPath, lines, 'utf-8');
  this.batchBuffer = [];
}
```

### 优化 2：异步写入

```typescript
// 使用 Promise queue 避免阻塞
private writeQueue = Promise.resolve();

private appendContextLog(entry: any) {
  this.writeQueue = this.writeQueue.then(async () => {
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.contextLogPath, line, 'utf-8');
  });
}
```

### 优化 3：定期压缩

```typescript
// 每 1000 条记录压缩一次
if (this.contextLogLines > 1000) {
  await this.compactContextLog();
}

private async compactContextLog() {
  // 读取当前状态
  const currentState = this.getState();

  // 写入快照
  const snapshot = {
    type: 'snapshot',
    state: currentState,
    ts: Date.now()
  };

  // 覆盖文件
  await writeFile(this.contextLogPath, JSON.stringify(snapshot) + '\n', 'utf-8');
}
```

---

## 🧪 测试用例

### 测试 1：基本持久化

```typescript
it('SwarmContext 数据应该持久化到文件', async () => {
  const ctx = new FileSwarmContext('test-session', workspaceDir);

  ctx.set('key1', 'value1', 'coder');
  ctx.addArtifact('code.ts', 'const x = 1', 'coder', 'code');

  // 检查文件存在
  expect(existsSync(join(workspaceDir, 'swarm/context.jsonl'))).toBe(true);
  expect(existsSync(join(workspaceDir, 'swarm/artifacts/code.ts'))).toBe(true);
});
```

### 测试 2：崩溃恢复

```typescript
it('程序重启后应该恢复 SwarmContext 状态', async () => {
  // 第一次运行
  const ctx1 = new FileSwarmContext('test-session', workspaceDir);
  ctx1.set('counter', 42, 'system');
  ctx1.addArtifact('doc.md', '# Hello', 'writer');

  // 模拟程序重启
  const ctx2 = new FileSwarmContext('test-session', workspaceDir);
  await ctx2.init(); // 触发 replay

  // 验证恢复
  expect(ctx2.get('counter')).toBe(42);
  expect(ctx2.getArtifact('doc.md')?.content).toBe('# Hello');
});
```

### 测试 3：讨论历史

```typescript
it('讨论过程应该完整记录', async () => {
  const discussionId = await startDiscussion({
    initiator: 'coder',
    participant: 'reviewer',
    topic: 'code_review'
  });

  // 检查讨论文件
  const discPath = join(workspaceDir, `swarm/discussions/${discussionId}.jsonl`);
  expect(existsSync(discPath)).toBe(true);

  const lines = readFileSync(discPath, 'utf-8').trim().split('\n');
  expect(lines.length).toBeGreaterThan(2); // start + rounds + end
});
```

---

## 📝 API 变更

### SwarmCoordinator 初始化

```typescript
// 原：使用内存存储
const coordinator = new SwarmCoordinator({
  context: new SwarmContext(),
  messageBus: new MessageBus()
});

// 改：使用文件存储
const coordinator = new SwarmCoordinator({
  context: new FileSwarmContext(sessionId, workspaceDir),
  messageBus: new FileMessageBus(sessionId, workspaceDir)
});
```

### 配置选项（可选）

```typescript
interface SwarmPersistenceConfig {
  enabled: boolean; // 是否启用持久化
  batchInterval: number; // 批量写入间隔（ms）
  compactThreshold: number; // 压缩阈值（条数）
  artifactsMaxSize: number; // 单个产物最大大小
}
```

---

## 🎯 总结

### ✅ 设计优势

1. **完整审计**：所有协作数据可追溯
2. **崩溃恢复**：程序重启自动恢复状态
3. **向后兼容**：通过继承实现，不破坏现有 API
4. **性能优化**：批量写入、异步 IO
5. **可扩展**：未来可接入数据库、S3 等

### 🚀 下一步

1. 实现 `FileSwarmContext` 和 `FileMessageBus`
2. 更新 `SwarmCoordinator` 使用文件存储
3. 添加测试用例
4. 性能基准测试
5. 文档更新
