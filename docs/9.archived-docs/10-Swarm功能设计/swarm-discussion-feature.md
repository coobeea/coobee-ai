# Swarm 讨论功能设计

## 🎯 设计理念

> **提供能力和环境，而不是硬编码行为流程。**
> 让 LLM 自主决定：是否需要讨论、和谁讨论、讨论什么、何时结束。

## 📋 功能需求

### 用户场景

1. **代码评审协商**

   ```
   Coder: 我写了这段代码，想和 Reviewer 讨论一下架构设计
   → discuss_with(role: 'reviewer', topic: '架构设计评审')
   → Reviewer: 建议使用工厂模式...
   → Coder: 好的，那依赖注入部分呢？
   → Reviewer: 可以用...
   → Coder: 明白了（结束讨论）
   ```

2. **跨领域协作**

   ```
   Researcher: 找到了3种技术方案，需要 Analyst 帮忙分析优劣
   → discuss_with(role: 'analyst', topic: '技术方案对比分析')
   → Analyst: 从性能角度看...
   → Researcher: 那成本呢？
   → Analyst: ...
   ```

3. **多方会议**
   ```
   Triage: 这个任务比较复杂，需要 Coder + Researcher + Reviewer 一起讨论
   → start_group_discussion(participants: ['coder', 'researcher', 'reviewer'])
   → （多角色轮流发言）
   ```

---

## 🏗️ 架构设计

### 方案 A：`discuss_with` 工具（推荐 ⭐）

**特点**：

- 不改变现有 SwarmCoordinator 流程
- 基于现有 MessageBus 扩展
- LLM 完全自主控制讨论流程

#### 工具定义

```typescript
{
  name: 'discuss_with',
  description: `
    和另一个专家角色进行实时讨论（同步等待回复）。

    使用场景：
    - 需要另一个专家的意见和建议
    - 需要协商方案或评审产物
    - 需要多角度分析问题

    注意：
    - 这是同步操作，会等待对方回复后才继续你的任务
    - 可以进行多轮对话，直到你认为讨论结束
    - 讨论内容会记录在 MessageBus 中，其他角色也能看到
  `,
  parameters: {
    role: string;           // 讨论对象角色 ID
    topic: string;          // 讨论主题
    message: string;        // 你的问题或观点
    maxRounds?: number;     // 最大讨论轮数（默认 5）
  }
}
```

#### 执行流程

```typescript
// 1. Coder 调用 discuss_with
discuss_with({
  role: 'reviewer',
  topic: '代码架构评审',
  message: '我用了单例模式，你觉得合理吗？'
});

// 2. SwarmCoordinator 检测到 discuss_with 调用
//    暂停 Coder，启动 Reviewer（临时上下文）

// 3. Reviewer 接收到消息和上下文
//    Reviewer 的 prompt:
//    "Coder 正在和你讨论【代码架构评审】
//     Coder 说：我用了单例模式，你觉得合理吗？
//
//     请回复你的观点。如果需要继续讨论，可以提出问题；
//     如果讨论结束，说明'讨论结束'。"

// 4. Reviewer 回复
Reviewer: '单例模式在你的场景下可能有并发问题，建议...';

// 5. SwarmCoordinator 将回复返回给 Coder
//    Coder 继续执行，可以：
//    - 再次调用 discuss_with 继续讨论
//    - 调用其他工具
//    - 完成任务
```

#### 实现伪代码

```typescript
// tools.ts
export function createDiscussWithTool(
  messageBus: MessageBus,
  coordinator: SwarmCoordinator,
  currentRoleId: string,
  availableRoles: AgentRole[]
): ToolDefinition {
  return {
    name: 'discuss_with',
    description: '...',
    parameters: z.object({
      role: z.string(),
      topic: z.string(),
      message: z.string(),
      maxRounds: z.number().optional()
    }),
    execute: async function* ({ role, topic, message, maxRounds }) {
      yield progress(`Starting discussion with ${role}...`);

      // 1. 发送讨论请求到 MessageBus
      messageBus.send(currentRoleId, role, message, {
        topic,
        type: 'discussion_request'
      });

      // 2. 调用 coordinator 启动目标角色（临时会话）
      const discussionResult = await coordinator.executeDiscussion({
        initiator: currentRoleId,
        participant: role,
        topic,
        initialMessage: message,
        maxRounds: maxRounds || 5
      });

      // 3. 返回讨论结果
      return {
        success: true,
        llmContent: JSON.stringify({
          topic,
          participant: role,
          rounds: discussionResult.rounds,
          finalReply: discussionResult.finalReply,
          transcript: discussionResult.messages
        })
      };
    }
  };
}
```

```typescript
// SwarmCoordinator.ts
async executeDiscussion(options: {
  initiator: string;
  participant: string;
  topic: string;
  initialMessage: string;
  maxRounds: number;
}): Promise<DiscussionResult> {
  const { initiator, participant, topic, initialMessage, maxRounds } = options;

  // 1. 获取或创建参与者 Runtime
  const participantRuntime = await this.agentPool.getOrCreate(participant);

  // 2. 构建讨论上下文
  let currentMessage = initialMessage;
  const messages: DiscussionMessage[] = [];

  // 3. 多轮对话
  for (let round = 0; round < maxRounds; round++) {
    // 构建 prompt
    const discussionPrompt = `
      ${initiator} 正在和你讨论【${topic}】

      ${initiator} 说：${currentMessage}

      请回复你的观点和建议。
      - 如果需要继续讨论，可以提出问题或补充观点
      - 如果讨论结束，请明确说明"讨论结束"
    `;

    // 执行参与者回复
    const result = await participantRuntime.run(discussionPrompt);
    const reply = result.output;

    messages.push({
      from: participant,
      content: reply,
      round: round + 1
    });

    // 检查是否结束
    if (this.isDiscussionEnd(reply)) {
      return {
        rounds: round + 1,
        finalReply: reply,
        messages
      };
    }

    // 如果未结束，需要 initiator 继续发言
    // （可选：调用 initiator 的 Runtime 生成下一轮问题）
    // 这里简化为只支持单向讨论（initiator 提问 → participant 回复）
  }

  return {
    rounds: maxRounds,
    finalReply: messages[messages.length - 1].content,
    messages
  };
}
```

---

### 方案 B：`start_group_discussion` 工具

支持多角色同时讨论（类似 AutoGen 的 GroupChat）。

```typescript
{
  name: 'start_group_discussion',
  description: '发起多角色群组讨论',
  parameters: {
    participants: string[];  // ['coder', 'reviewer', 'analyst']
    topic: string;
    moderator?: string;      // 主持人（默认为发起者）
    maxTurns?: number;
  }
}
```

**实现要点**：

- 轮流发言机制
- 可选：让 LLM 决定下一个发言者
- 讨论终止条件：超时 / 达成共识 / 主持人宣布结束

---

## 🎨 设计哲学

### ✅ **我们做的**：提供能力

```typescript
// 提供工具
discuss_with(...)       // 1对1 讨论
start_group_discussion(...) // 多方讨论
send_message(...)       // 异步消息
read_shared_context(...) // 读取共享状态
```

### ❌ **我们不做的**：硬编码流程

```typescript
// ❌ 不要这样硬编码
if (task.type === 'code_review') {
  // 强制 coder 和 reviewer 讨论
  discuss_with('reviewer', ...);
}

// ✅ 应该这样
// 在 Coder 的 instructions 中说明能力，让 LLM 自己决定
instructions: `
  你是代码开发专家。

  可用工具：
  - discuss_with: 和其他专家实时讨论
  - transfer_to_reviewer: 完全交接给审查专家

  你可以自主决定：
  - 完成代码后，是否需要和 reviewer 讨论
  - 遇到难题时，是否需要向 researcher 请教
`
```

---

## 🔄 与现有 `transfer_to` 的区别

| 特性       | `transfer_to_xxx`  | `discuss_with`       |
| ---------- | ------------------ | -------------------- |
| **控制权** | 完全转移，自己退出 | 临时借用，保留控制权 |
| **返回**   | 无返回             | 等待回复后继续       |
| **上下文** | 对方接管全部任务   | 只传递讨论话题       |
| **场景**   | 任务委托           | 咨询、协商、评审     |

**示例**：

```typescript
// 场景 1：我无法完成这个任务，交给专家
transfer_to_coder({ reason: '需要写代码' });
// → Coder 接管整个任务，我退出

// 场景 2：我需要专家的意见，但任务还是我负责
discuss_with({
  role: 'coder',
  topic: '性能优化建议',
  message: '这个算法可以优化吗？'
});
// → Coder 给出建议
// → 我根据建议继续我的任务
```

---

## 📝 实现步骤

### 第一步：增加 `discuss_with` 工具 ✅

1. 在 `tools.ts` 中添加 `createDiscussWithTool()`
2. 在 `SwarmCoordinator` 中添加 `executeDiscussion()` 方法
3. 更新 `createSwarmTools()` 包含讨论工具

### 第二步：更新角色 Instructions

```typescript
// 示例：Coder 的 instructions
instructions: `
你是代码开发专家。

可用协作工具：
- discuss_with: 和其他专家实时讨论（同步等待回复）
- send_message: 发送异步消息
- transfer_to_xxx: 将整个任务交接给专家

建议使用场景：
- 代码架构决策 → discuss_with('reviewer')
- 技术选型不确定 → discuss_with('researcher')
- 性能优化建议 → discuss_with('analyst')
- 任务超出能力 → transfer_to_xxx
`;
```

### 第三步：日志和监控

```typescript
// 讨论事件
this.emit({
  type: 'discussion:start',
  data: { initiator, participant, topic }
});

this.emit({
  type: 'discussion:round',
  data: { round, from, message }
});

this.emit({
  type: 'discussion:end',
  data: { rounds, finalReply }
});
```

---

## 🧪 测试场景

### 测试 1：简单讨论

```typescript
it('Coder 和 Reviewer 讨论代码架构', async () => {
  // 1. Coder 写代码
  // 2. Coder 调用 discuss_with('reviewer', '架构评审', '...')
  // 3. Reviewer 给出建议
  // 4. Coder 根据建议修改
  // 5. 完成任务

  expect(result.output).toContain('已根据 reviewer 建议修改');
});
```

### 测试 2：多轮讨论

```typescript
it('支持多轮对话', async () => {
  // Coder: 单例模式可以吗？
  // Reviewer: 有并发问题
  // Coder: 那用工厂模式？
  // Reviewer: 更合适，建议...

  expect(discussionResult.rounds).toBeGreaterThan(1);
});
```

---

## 🎯 预期效果

### LLM 自主决策示例

**任务**：重构一个复杂模块

```
Triage: 这个任务需要代码重构，交给 Coder
→ transfer_to_coder

Coder: 我先分析代码结构...（读取代码）
Coder: 发现架构比较复杂，我想听听 Reviewer 的意见
→ discuss_with('reviewer', '重构方案评审', '...')

Reviewer: 建议先抽象出接口层...

Coder: 好的，但是依赖注入部分有些疑问
→ discuss_with('reviewer', '依赖注入设计', '...')

Reviewer: 可以用...

Coder: 明白了！开始重构...（写代码）
Coder: 完成了，提交审查
→ transfer_to_reviewer（完整交接）

Reviewer: 代码质量很好，通过！
```

**关键**：

- ✅ Coder 自己决定何时讨论
- ✅ Coder 自己决定和谁讨论
- ✅ Coder 自己决定讨论几轮
- ✅ 没有硬编码"必须讨论"

---

## 🚀 未来扩展

### 扩展 1：异步讨论

```typescript
{
  name: 'request_opinion',
  description: '向专家请教（异步，不等待回复）',
  // 发起者继续任务，对方有空时回复
}
```

### 扩展 2：投票机制

```typescript
{
  name: 'poll_experts',
  description: '向多个专家征求意见（并行）',
  parameters: {
    experts: ['coder', 'reviewer', 'analyst'],
    question: '是否采用微服务架构？'
  }
}
```

### 扩展 3：争论解决

```typescript
// 如果两个专家意见不一致，可以引入第三方仲裁
discuss_with('architect', '仲裁技术方案争议', ...)
```

---

## 📚 参考

- OpenAI Swarm: 简单的 handoff 机制
- AutoGen: GroupChat + Speaker Selection
- LangGraph: Multi-agent collaboration
- CrewAI: Role-based task delegation
