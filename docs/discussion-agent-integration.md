# 讨论室 Agent 对接方案设计

## 现状分析

### 已有的 Agent 执行架构

```typescript
// 1. 从 AgentStore 加载 Agent 定义
const store = await AgentStore.getInstance();
const agentDef = await store.get(agentId);

// 2. 创建 Builder（配置工具、技能、模型等）
const builder = agentExecutor
  .piMono()
  .agentId(agentDef.id)
  .name(agentDef.name)
  .instructions(agentDef.instructions)
  .tools(toolList)
  .skills(skillList)
  .model(agentDef.model);

// 3. 执行并流式获取回复
const gen = agentExecutor.stream({
  sessionId: 'session-xxx',
  message: userMessage,
  builder
});

// 4. 消费流式输出
for await (const chunk of gen) {
  if (chunk.type === 'text:delta') {
    output += chunk.content;
  }
}
```

---

## 🔥 推荐方案：讨论上下文增强 + 独立 Session

### 核心思路

- **每个 Agent 有独立的 sessionId**：`discussion-{discussionId}-{agentId}`
- **通过 instructions 注入讨论上下文**：角色定位 + 主题 + 历史消息
- **利用现有 AgentExecutor**：无需修改核心执行逻辑

### 实现示例

```typescript
class DiscussionAgentExecutor {
  /**
   * 让某个 Agent 在讨论中发言
   */
  async executeAgentTurn(agentId: string, discussion: DiscussionSession): Promise<string> {
    // 1. 加载 Agent 定义
    const store = await AgentStore.getInstance();
    const agentDef = await store.get(agentId);

    // 2. 构建讨论上下文
    const participant = discussion.participants.find((p) => p.agentId === agentId);
    const contextPrompt = this.buildDiscussionContext(discussion, participant);

    // 3. 创建 Builder（增强 instructions）
    const builder = agentExecutor
      .piMono()
      .agentId(agentDef.id)
      .name(agentDef.name)
      .mode('chat')
      .sessionMode('memory')
      .instructions(`${agentDef.instructions}\n\n${contextPrompt}`)
      .tools(/* 只保留安全工具，移除 exec 等 */)
      .model(agentDef.model);

    // 4. 执行（独立 session，保留历史）
    const sessionId = `discussion-${discussion.id}-${agentId}`;
    const gen = agentExecutor.stream({
      sessionId,
      message: this.buildTurnMessage(discussion),
      builder
    });

    // 5. 收集完整回复
    let response = '';
    for await (const chunk of gen) {
      if (chunk.type === 'text:delta') {
        response += chunk.content;
      }
    }

    return response.trim();
  }

  /**
   * 构建讨论上下文提示词
   */
  private buildDiscussionContext(discussion: DiscussionSession, participant: DiscussionParticipant): string {
    const recentMessages = discussion.messages.slice(-5);
    const historyText = recentMessages
      .map((m) => {
        const p = discussion.participants.find((x) => x.agentId === m.agentId);
        return `【${p?.name || m.agentId}】: ${m.content}`;
      })
      .join('\n');

    return `
## 🎭 你的角色定位
你是 **${participant.name}**，角色是 **${participant.role}**。

## 📋 讨论主题
${discussion.topic}

## 💬 最近对话
${historyText || '（讨论刚开始）'}

## ⚠️ 发言要求
- 保持角色立场，提出该角色视角的观点
- 直接表达观点，无需重复主题或寒暄
- 如果同意他人观点，说明理由；如果反对，提出替代方案
- 发言简洁明了，控制在 100-200 字
`;
  }

  /**
   * 构建当前轮次的消息
   */
  private buildTurnMessage(discussion: DiscussionSession): string {
    const lastMessage = discussion.messages[discussion.messages.length - 1];

    if (!lastMessage) {
      return `现在开始讨论："${discussion.topic}"，请先分享你的观点。`;
    }

    // 针对上一条消息做出回应
    const lastSpeaker = discussion.participants.find((p) => p.agentId === lastMessage.agentId);

    return `${lastSpeaker?.name} 刚才说："${lastMessage.content.slice(0, 100)}..."，现在轮到你发言了。`;
  }
}
```

---

## ✅ 方案优势

### 1. **复用现有架构**

- 无需修改 `AgentExecutor` 核心逻辑
- 完全利用 session 管理、工具调用、技能加载等能力

### 2. **独立 Session 保证连贯性**

- 每个 Agent 有自己的 session：`discussion-{discussionId}-{agentId}`
- 历史消息自动保留，Agent 能"记住"自己之前说过什么

### 3. **上下文注入灵活**

- 通过 `instructions` 动态注入：角色、主题、历史对话
- 每轮发言前实时更新上下文

### 4. **安全可控**

- 可以限制工具权限（只读工具，禁用 exec）
- 可以设置超时和输出长度限制

---

## 🚀 实现步骤

### Step 1: 创建 `DiscussionAgentExecutor`

位置：`src/main/ai/discussion/DiscussionAgentExecutor.ts`

### Step 2: 修改 `DiscussionRoom.start()`

```typescript
async start(): Promise<void> {
  const executor = new DiscussionAgentExecutor();

  // 获取第一个发言者
  const firstSpeaker = this.getNextSpeaker();
  if (!firstSpeaker) return;

  // 让 Agent 发言
  const response = await executor.executeAgentTurn(
    firstSpeaker.agentId,
    this.session
  );

  // 保存到讨论室
  await this.addMessage(firstSpeaker.agentId, response, 'statement');
}
```

### Step 3: 实现轮转机制

```typescript
async nextTurn(): Promise<void> {
  const nextSpeaker = this.getNextSpeaker();
  if (!nextSpeaker) return;

  const executor = new DiscussionAgentExecutor();
  const response = await executor.executeAgentTurn(
    nextSpeaker.agentId,
    this.session
  );

  await this.addMessage(nextSpeaker.agentId, response, 'statement');

  // 检测共识
  const consensus = await this.checkConsensus();
  if (consensus.achieved) {
    await this.end();
  }
}
```

---

## 🔄 其他可选方案（不推荐）

### ❌ 方案 B：共享 Session

所有 Agent 共用一个 `sessionId`，通过 `systemMessage` 切换角色

**缺点**：

- 会话历史会混乱（所有 Agent 的发言混在一起）
- 无法保证每个 Agent 的独立记忆

### ❌ 方案 C：直接调用 LLM API

绕过 AgentExecutor，直接调用模型

**缺点**：

- 丢失 Agent 的工具、技能、配置
- 重复造轮子，维护成本高

---

## 🎯 总结

**推荐实现方案**：

1. 每个 Agent 独立 session
2. 通过 instructions 注入讨论上下文
3. 利用 AgentExecutor 执行
4. 收集完整回复后保存到讨论室

**下一步行动**：

1. 创建 `DiscussionAgentExecutor`
2. 实现 `executeAgentTurn()` 方法
3. 集成到 `DiscussionRoom` 的 start 和 nextTurn 流程
4. 测试多轮对话效果
