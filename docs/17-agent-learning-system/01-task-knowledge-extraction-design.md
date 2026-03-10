# 任务完成后的知识提取机制 - 设计文档

> **设计原则**：先充分讨论，深入分析问题和边界情况，再实现方案。

---

## 1. 核心需求和目标

### 1.1 核心需求

当一个任务（Thread）执行完成后，**自动触发**知识提取过程，将任务执行过程中的经验、问题、解决方案提取出来，存储到智能体的 Agent Home 中，实现知识积累和智能体进化。

### 1.2 设计目标

1. **程序化保证执行**：不依赖 LLM 主动性，通过事件机制硬性保证每个任务完成后都会执行知识提取
2. **避免死循环**：知识提取本身不能再触发新的知识提取，必须一次性完成
3. **异步非阻塞**：不影响用户的正常任务流程，后台执行
4. **隔离性**：知识提取失败不影响原任务的完成状态
5. **可追溯**：记录每次知识提取的执行情况，便于调试和监控

### 1.3 非目标（边界）

- ❌ **不是训练模式**：这不是集中式的、循环迭代的训练，只是任务完成后的一次性知识提取
- ❌ **不是实时学习**：不在任务执行过程中进行，只在任务完成后
- ❌ **不是强制性反馈**：如果知识提取失败，不影响原任务的完成

---

## 2. 当前系统的事件机制分析

### 2.1 事件触发链路

```
AgentExecutor.execute() 完成
  ↓
updateSessionStatus(sessionId, 'completed')
  ↓
ThreadStore.update({ runStatus: 'completed' })
  ↓
检查 runStatus 是否变化
  ↓ (如果变化)
eventBus.emit('thread:status', {
  threadId: string,
  runStatus: 'completed',
  prevStatus: 'running'
})
```

### 2.2 关键时机点

**触发时机**：`AgentExecutor.execute()` 执行完成，进入以下代码：

```typescript
// src/main/ai/AgentExecutor.ts:646
if (!this.pendingApprovalSessions.has(sessionId)) {
  this.updateSessionStatus(sessionId, 'completed', workspaceDir);
}
```

**状态流转**：

```
pending → running → completed
                 ↘ failed
                 ↘ approval-pending (特殊情况，等待用户审批)
```

**事件数据**：

```typescript
interface ThreadStatusEvent {
  threadId: string;
  runStatus: 'completed' | 'failed' | 'running' | 'approval-pending';
  prevStatus: string;
}
```

### 2.3 监听方式（Extension）

Extension 可以通过 `api.eventBus.on()` 监听事件：

```typescript
// 伪代码示例
export const register = (api: ExtensionApi) => {
  api.eventBus.on('thread:status', (event) => {
    if (event.runStatus === 'completed' && event.prevStatus !== 'completed') {
      // 触发知识提取
      triggerKnowledgeExtraction(event.threadId);
    }
  });
};
```

---

## 3. 核心问题和挑战

### 3.1 死循环问题 ⚠️

**问题描述**：
如果知识提取本身也是一个 Thread，那么它完成后会触发 `thread:status` 事件，可能导致：

```
原任务完成 → 触发知识提取 (创建新 Thread)
  ↓
知识提取任务完成 → 触发 thread:status
  ↓
再次触发知识提取 → 无限循环 ❌
```

**解决方案思路**：

1. **方案 A：标记机制**
   - 知识提取任务在 metadata 中标记 `isKnowledgeExtraction: true`
   - 监听器检查标记，跳过知识提取任务

2. **方案 B：agentId 白名单**
   - 只对特定的 agentId 触发知识提取
   - 知识提取使用专门的 Agent（如 `knowledge-extractor`），该 Agent 的任务不触发提取

3. **方案 C：状态标记**
   - 在 Thread 数据中增加 `knowledgeExtracted: boolean` 字段
   - 如果已提取过，跳过

**推荐方案**：**A + B 组合**

- 使用专门的 `knowledge-extractor` Agent（避免所有任务都提取）
- 在知识提取任务的 metadata 中标记（双重保险）

---

### 3.2 提取时机问题

**问题**：什么情况下应该触发知识提取？

| 状态转换                       | 是否触发 | 原因                     |
| ------------------------------ | -------- | ------------------------ |
| `running → completed`          | ✅ 是    | 正常完成，需要提取       |
| `running → failed`             | ❓ 待定  | 失败也有价值（失败经验） |
| `approval-pending → completed` | ✅ 是    | 审批通过后继续执行完成   |
| `pending → completed`          | ❌ 否    | 异常情况，未执行就完成   |

**讨论点**：

- 失败的任务是否需要提取？（失败经验也是经验）
- 如何区分"真正完成"和"异常完成"？

---

### 3.3 并发问题

**问题**：多个任务同时完成时，如何处理？

**场景**：

- 用户同时运行 5 个任务
- 5 个任务同时完成，触发 5 次 `thread:status` 事件
- 可能导致：
  - 5 个知识提取任务同时启动
  - 资源竞争、性能问题

**解决方案思路**：

1. **方案 A：队列机制**
   - 使用任务队列，串行处理知识提取
   - 优点：稳定，不会并发冲突
   - 缺点：速度慢

2. **方案 B：限流机制**
   - 最多同时运行 N 个知识提取任务（如 N=2）
   - 超过限制则排队

3. **方案 C：延迟批处理**
   - 任务完成后不立即提取，而是加入待处理列表
   - 每隔 5 分钟批量处理一次

**推荐方案**：**B (限流，N=1 或 2)**

- 简单有效，避免并发竞争
- 提取速度可接受

---

### 3.4 提取内容的定义

**需要提取什么？**

1. **会话记录**
   - 位置：`workspaces/{sessionId}/.runtime/sessions/`
   - 内容：用户输入、LLM 输出、工具调用序列

2. **错误日志**
   - 位置：`workspaces/{sessionId}/.runtime/logs/`
   - 内容：执行过程中的错误、警告

3. **工具调用统计**
   - 哪些工具被调用
   - 调用是否成功
   - 调用耗时

4. **用户反馈信号**
   - 是否有追问（表示不满意）
   - 是否有确认（表示满意）
   - 情感倾向

**提取目标**：

- ✅ **问题识别**：遇到了什么问题？
- ✅ **解决方案**：如何解决的？
- ✅ **用户反馈**：用户是否满意？
- ✅ **可复用知识**：哪些经验可以复用？

---

### 3.5 知识存储的位置和格式

**存储位置选择**：

| 位置                      | 优点                   | 缺点         | 适用场景         |
| ------------------------- | ---------------------- | ------------ | ---------------- |
| `{agentHome}/experience/` | 跨会话持久化，易于查阅 | 文件可能很多 | 结构化的经验记录 |
| `shared-drive` (共享网盘) | 跨智能体共享           | 需要网络调用 | 通用知识         |
| `brain/tavern` (智库)     | 结构化，可检索         | 需要网络调用 | 问题-解决方案对  |

**推荐存储策略**：

1. 本地先存到 `{agentHome}/experience/{date}_task-{taskId}.md`
2. 异步写入 `brain/tavern`（结构化存储）
3. 通用知识写入 `shared-drive`（跨智能体共享）

**存储格式**：

```markdown
# Task: {taskId}

**Agent**: {agentId}
**Date**: {YYYY-MM-DD HH:mm:ss}
**Status**: completed | failed
**Duration**: {Xms}

## 任务描述

{user's initial request}

## 执行过程

- Tool: read → success (120ms)
- Tool: write → success (50ms)
- Tool: exec → failed (error: ...)

## 遇到的问题

1. {问题描述}
   - 错误信息：{error message}
   - 原因分析：{reasoning}

## 解决方案

1. {解决方案描述}
   - 步骤：{steps}
   - 关键点：{key insight}

## 用户反馈

- 满意度：{高/中/低}
- 追问次数：{N}
- 最终结果：{accepted/rejected}

## 可复用知识

- 工具组合：{tool1 + tool2 效果好}
- 最佳实践：{...}
```

---

## 4. 实现方案设计（初步）

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   AgentExecutor                         │
│  (任务执行完成，更新状态为 completed)                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ emit('thread:status')
┌─────────────────────────────────────────────────────────┐
│              EventBus (主进程)                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓ on('thread:status')
┌─────────────────────────────────────────────────────────┐
│      KnowledgeExtractionExtension (监听器)               │
│  - 检查是否应该提取 (过滤规则)                            │
│  - 检查并发限制 (最多 N 个)                               │
│  - 调用 KnowledgeExtractionService                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│      KnowledgeExtractionService                          │
│  - 创建知识提取任务 (使用 knowledge-extractor Agent)     │
│  - 标记任务 metadata (isKnowledgeExtraction: true)       │
│  - 读取任务数据                                          │
│  - 调用 Agent 分析并提取                                 │
│  - 写入 Agent Home                                       │
│  - (可选) 异步同步到 brain/shared-drive                  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 过滤规则（避免死循环）

```typescript
function shouldExtractKnowledge(event: ThreadStatusEvent, thread: Thread): boolean {
  // 1. 只处理 completed 状态
  if (event.runStatus !== 'completed') return false;

  // 2. 跳过知识提取任务本身
  if (thread.metadata?.isKnowledgeExtraction === true) return false;

  // 3. 跳过知识提取 Agent 的任务
  if (thread.agentId === 'knowledge-extractor') return false;

  // 4. 检查是否已提取过（幂等性）
  if (thread.metadata?.knowledgeExtracted === true) return false;

  // 5. 只处理特定类型的任务（可选）
  // 例如：只提取用户发起的任务，跳过系统任务
  if (thread.metadata?.isSystemTask === true) return false;

  return true;
}
```

### 4.3 并发控制

```typescript
class KnowledgeExtractionService {
  private runningTasks = new Set<string>();
  private maxConcurrent = 2; // 最多同时 2 个提取任务
  private queue: string[] = []; // 待处理队列

  async extract(threadId: string) {
    // 如果达到并发上限，加入队列
    if (this.runningTasks.size >= this.maxConcurrent) {
      this.queue.push(threadId);
      return;
    }

    // 执行提取
    this.runningTasks.add(threadId);
    try {
      await this.doExtract(threadId);
    } finally {
      this.runningTasks.delete(threadId);

      // 处理队列中的下一个任务
      if (this.queue.length > 0) {
        const nextThreadId = this.queue.shift()!;
        this.extract(nextThreadId); // 不 await，异步执行
      }
    }
  }

  private async doExtract(threadId: string) {
    // 实际提取逻辑...
  }
}
```

---

## 5. 待讨论的问题

### 5.1 失败任务是否提取？

- ✅ **赞成**：失败经验也是宝贵经验，可以避免重复犯错
- ❌ **反对**：失败任务可能没有价值，增加噪音

**建议**：初期只提取成功任务，后续增加"失败经验库"

---

### 5.2 是否需要用户确认？

- ✅ **赞成**：让用户确认提取的内容是否准确，提高质量
- ❌ **反对**：增加用户负担，违背"自动化"的初衷

**建议**：自动提取，但提供 UI 让用户查看和修正

---

### 5.3 提取的粒度？

- **粗粒度**：整个任务提取一次（简单）
- **细粒度**：每个工具调用都提取（详细，但数据量大）

**建议**：粗粒度（整个任务），避免数据爆炸

---

### 5.4 何时同步到 brain/shared-drive？

- **立即同步**：提取后立即写入（实时性好，但可能影响性能）
- **延迟同步**：加入队列，定期批量同步（性能好，但有延迟）

**建议**：延迟同步（每小时一次或定时任务触发）

---

### 5.5 如何处理大量历史任务？

**问题**：如果系统已经运行了一段时间，有大量历史任务未提取知识，是否需要补录？

**方案**：

- **方案 A**：启动时扫描所有未提取的任务，批量补录
- **方案 B**：只处理新任务，历史任务不管

**建议**：提供手动触发功能，让用户决定是否补录

---

## 6. 验证标准

### 6.1 功能性验证

- [ ] 任务完成后，知识提取自动触发
- [ ] 提取的内容准确反映任务执行情况
- [ ] 提取的知识正确存储到 Agent Home
- [ ] 知识提取任务不会触发新的知识提取（无死循环）
- [ ] 并发控制有效，不会超过限制

### 6.2 性能验证

- [ ] 知识提取不阻塞主任务
- [ ] 单次提取耗时 < 5 秒
- [ ] 多任务并发时，系统稳定

### 6.3 鲁棒性验证

- [ ] 知识提取失败不影响原任务状态
- [ ] 重启后，未完成的提取任务能恢复
- [ ] 异常情况（网络断开、磁盘满）能优雅处理

---

## 7. 下一步行动

1. **讨论和完善设计**
   - [ ] 确定失败任务是否提取
   - [ ] 确定并发控制策略（N=1 还是 N=2）
   - [ ] 确定同步到 brain 的时机
   - [ ] 设计知识提取 Agent 的 instructions

2. **创建 Agent 定义**
   - [ ] 创建 `knowledge-extractor` Agent
   - [ ] 定义其 instructions 和 tools
   - [ ] 关联 `self-reflection` 等 skills

3. **实现 Extension**
   - [ ] 创建 `task-knowledge-extraction` Extension
   - [ ] 实现事件监听器
   - [ ] 实现过滤逻辑
   - [ ] 实现并发控制

4. **测试和验证**
   - [ ] 单元测试
   - [ ] 集成测试
   - [ ] 边界情况测试（死循环、并发、异常）

---

## 8. 参考资料

- 当前事件系统：`src/main/ai/threads/ThreadStore.ts`
- Extension API：`src/main/common/extension/types.ts`
- 类似实现：`KnowledgeArchiveJob` (定时扫描历史任务)

---

**文档状态**：初稿待讨论
**创建时间**：2026-03-10
**最后更新**：2026-03-10
