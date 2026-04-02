# 智能模式切换功能

## 功能概述

当用户在**自由模式**（Agent）下提出复杂任务时，系统会自动识别并升级到**编排模式**（Orchestrator），提供完整的 POC 生命周期管理，无需用户手动切换模式。

## 用户价值

- ✅ **智能识别**：LLM 自主判断任务复杂度，无需关键词硬编码
- ✅ **无缝体验**：自动切换，保留上下文，不打断用户思路
- ✅ **专业处理**：复杂任务获得完整流程支持（需求分析、方案设计、验收报告）
- ✅ **简单直达**：简单对话保持轻量，不启动重型流程

## 工作流程

### 场景1：简单对话（不切换）

```
用户（自由模式）："你好，今天天气怎么样？"
  ↓ Agent 直接回复
  ✅ 保持在自由模式
```

### 场景2：复杂任务（自动切换）

```
用户（自由模式）："帮我开发一个音乐播放器网站，要有前后端和数据库"
  ↓ Agent 开始处理
  ↓ LLM 判断："这是多领域、多步骤的复杂任务"
  ↓ Agent 调用 switch_to_orchestration 工具
  ↓ 工具返回：
     {
       reason: "需要前端+后端+数据库多领域协作，预计需要 2+ 小时",
       estimatedComplexity: "high"
     }
  ↓ 后端发出 'mode.switch-requested' 事件
  ↓ 前端显示：
     "🔄 正在切换到编排模式...
      原因：需要前端+后端+数据库多领域协作
      编排模式将提供：
        - 📋 详细的需求分析
        - 💡 多方案设计与选择
        - 🔄 方案反思与优化
        - ✅ 完整的实施计划与验收"
  ↓ 等待当前 Agent 流完成
  ↓ 自动重新发送原始消息，使用 orchestrator 模式
  ↓ Orchestrator 启动：
     Phase 0: 需求分析 → 01-需求分析.md
     Phase 1: 决策（确认需要编排）
     Phase 2: POC 生命周期初始化
     Phase 3: 规划（Planner 分解任务） → 02-方案设计.md, 03-反思优化.md, 04-TODO.md
     Phase 4: 执行（多 Worker 协作）
     Phase 5: 聚合（AggregatorAgent 汇总）
  ✅ 生成 8 个文档：需求、方案、反思、TODO、进度、Bug、验收、综合报告
```

## 技术实现

### 1. 后端：`switch_to_orchestration` 工具

**位置**：`src/main/ai/tools/builtin/switch-to-orchestration.ts`

**触发条件（由 LLM 判断）**：

- 开发完整应用/系统/网站
- 多技术领域协作（前端+后端+数据库）
- 需要详细的需求分析、方案设计、实施计划
- 预计执行时间 30 分钟以上

**工具参数**：

```typescript
{
  reason: string; // 为何需要切换（1-2 句话）
  estimatedComplexity: 'medium' | 'high'; // 任务复杂度
}
```

**执行流程**：

1. 发送 `agent:mode-switch-requested` 事件到 eventBus
2. 返回用户友好的切换提示消息
3. Agent 终止当前执行（不继续输出）

### 2. 后端：ModeSwitchBridge 事件桥接

**位置**：`src/main/gateway/events/ModeSwitchBridge.ts`

**职责**：

- 监听 `eventBus` 的 `agent:mode-switch-requested` 事件
- 广播 `mode.switch-requested` 到前端 WebSocket

**自动注册**：Gateway 启动时自动扫描 `events/` 目录，无需手动注册

### 3. 前端：自动重新提交逻辑

**位置**：`src/renderer/src/stores/chat.ts`

**核心逻辑**：

```typescript
// 保存最后一条用户消息
const lastUserMessage = ref<{ text; files } | null>(null);

// 监听切换事件
gateway.on('mode.switch-requested', async (data) => {
  // 1. 显示切换提示
  addUserMessage('🔄 正在切换到编排模式...');

  // 2. 等待当前流完成
  if (isStreaming.value) {
    await waitForStreamDone();
  }

  // 3. 重新发送，强制使用 orchestrator 模式
  await sendMessageInternal(
    lastUserMessage.value.text,
    lastUserMessage.value.files,
    undefined,
    'orchestrator' // forcedMode
  );
});
```

### 4. Agent 指令更新

**位置**：`src/main/gateway/methods/chat.ts` - `AGENT_INSTRUCTIONS`

新增指导：

```
⚠️ 重要：智能模式切换
如果用户的需求符合以下特征，你应该立即调用 switch_to_orchestration 工具切换到编排模式：
- 开发完整的应用/系统/网站（如"开发音乐播放器"、"创建博客系统"）
- 需要多个技术领域协作（前端+后端+数据库）
- 需要详细的需求分析、方案设计、实施计划
- 预计需要 30 分钟以上才能完成

编排模式的优势：
- 自动生成需求分析、方案设计、反思优化文档
- 多智能体协作，专业分工
- 完整的任务跟踪和验收流程
- 生成详细的验收报告和综合报告
```

## 测试计划

### 手动测试步骤

#### 测试 1：简单对话（不切换）

1. 启动应用：`pnpm dev`
2. 创建新对话（自由模式）
3. 发送："你好"
4. **预期**：Agent 正常回复，**不**触发模式切换

#### 测试 2：简单查询（不切换）

1. 发送："什么是 TypeScript？"
2. **预期**：Agent 回答问题，**不**触发模式切换

#### 测试 3：复杂任务（自动切换到编排模式）

1. 创建新对话（自由模式）
2. 发送：
   ```
   帮我开发一个音乐播放器网站，需要：
   - 前端使用 Vue 3
   - 后端使用 Node.js + Express
   - 数据库使用 MongoDB
   - 支持播放、暂停、上一首、下一首功能
   ```
3. **预期行为**：
   - ✅ Agent 开始处理
   - ✅ Agent 调用 `switch_to_orchestration` 工具
   - ✅ 显示消息："🔄 检测到复杂任务，正在切换到编排模式处理..."
   - ✅ 原因说明："需要前端+后端+数据库多领域协作..."
   - ✅ 列出编排模式的优势（需求分析、方案设计、反思、验收）
   - ✅ Agent 流结束
   - ✅ 显示："🔄 正在切换到编排模式"
   - ✅ 自动重新发送消息（orchestrator 模式）
   - ✅ Orchestrator 启动，显示 Phase 0, 1, 2, 3, 4, 5
   - ✅ 生成 8 个文档在 `.home/sessions/{sessionId}/lifecycle/` 目录

4. **验证文档**：
   ```bash
   ls .home/sessions/{sessionId}/lifecycle/
   # 应该看到：
   # 01-需求分析.md
   # 02-方案设计.md
   # 03-反思优化.md
   # 04-TODO.md
   # 05-PROGRESS.md
   # 06-BUGS.md
   # 07-验收报告.md
   # 08-综合报告.md
   ```

#### 测试 4：边界情况

**4.1 中等复杂任务**

- 发送："写一个 Python 脚本读取 CSV 并统计行数"
- **预期**：可能不切换（简单），或切换到编排模式（取决于 LLM 判断）

**4.2 显式要求多步骤**

- 发送："创建一个完整的用户管理系统，包括注册、登录、权限管理、日志记录"
- **预期**：应该触发切换（明确多步骤、多功能）

### 验收标准

- [ ] 简单对话不触发切换
- [ ] 复杂任务自动切换
- [ ] 切换提示信息清晰友好
- [ ] 原始消息上下文保留
- [ ] Orchestrator 正确启动
- [ ] 生成完整的 8 个文档
- [ ] 无报错，流程顺畅

## 关键设计决策

### 1. 为什么不在 Gateway 层过滤？

**理由**：用户在 UI 明确选择"编排模式"时，应该无条件执行，由 Orchestrator 内部的 LLM（RequirementAnalyzer）判断是否真的需要完整编排。

**代码体现**：`chat.ts` 中删除了 `isSimpleMessage()` 和 `hasComplexIndicators()` 关键词过滤函数。

### 2. 为什么不用关键词匹配？

**用户明确要求**：

> "你这次改进，你又回到了公司这种模式，非常的不好，你帮我把所有的这种干部删掉。我们不需要这种关键词的这种方式"

**设计理念**：这是 AI 项目，应该依赖 LLM 智能判断，而不是硬编码规则。

**实现**：创建 `.cursor/rules/no-keyword-matching.md` 作为永久性规则，禁止关键词匹配。

### 3. 为什么等待当前流完成？

**原因**：避免中断 Agent 输出，用户可以看到完整的切换说明，体验更流畅。

**实现**：前端监听 `isStreaming`，等其变为 `false` 后再重新发送。

### 4. forcedMode 的作用是什么？

**作用**：绕过 Thread 的默认 `agentType`，强制使用指定模式。

**场景**：

- 用户创建对话时选择"自由模式" → Thread.agentType = 'agent'
- Agent 调用 switch_to_orchestration → 需要强制改为 orchestrator
- 使用 `forcedMode='orchestrator'` 覆盖默认值

## 文件清单

### 新增文件

1. `src/main/ai/tools/builtin/switch-to-orchestration.ts` - 模式切换工具
2. `src/main/gateway/events/ModeSwitchBridge.ts` - 事件桥接
3. `docs/features/intelligent-mode-switching.md` - 本文档

### 修改文件

1. `src/main/ai/tools/builtin/index.ts` - 注册新工具
2. `src/main/gateway/methods/chat.ts` - 更新 Agent 指令
3. `src/renderer/src/stores/chat.ts` - 前端监听和自动重新提交

## Commits

1. `9dcc181` - feat(agent): add intelligent mode switching from agent to orchestrator
2. `6f70c51` - feat(frontend): implement auto mode-switching on complexity detection

## 相关文档

- [Orchestrator Mode](./../architecture/orchestrator-mode.md)
- [POC Lifecycle](./../../.cursor/skills/poc-lifecycle/SKILL.md)
- [No Keyword Matching Rule](./../../.cursor/rules/no-keyword-matching.md)
- [RequirementAnalyzer](./../../src/main/ai/orchestration/RequirementAnalyzer.ts)

## 未来优化

1. **切换提示可配置化**：允许用户自定义切换提示文案
2. **模式切换历史**：记录哪些任务触发了切换，供分析优化
3. **手动切换确认**：可选项，切换前询问用户确认（高级用户可能想控制）
4. **复杂度评分可视化**：显示任务复杂度评分，让用户了解切换原因
5. **反向降级**：Orchestrator 检测到任务实际简单，降级回 Agent（目前已部分实现，抛出 `SIMPLE_TASK_DETECTED` 错误）
