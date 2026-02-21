# Swarm 空输出问题诊断

## 问题描述

**Thread ID**: `283289408377266176`  
**任务**: "请帮我解释一下什么是 REST API，用2-3句话简单说明即可。"  
**状态**: `runStatus: completed`, `messageCount: 0`

### 症状

1. Thread 显示已完成，但 messageCount 为 0
2. `events.jsonl` 中有 `text:delta` 事件，但只有系统元信息
3. `text:done` 事件的 `text` 字段为空字符串
4. **缺少 `agent:done` 事件**

## ✅ 根本原因（已确认）

通过三个维度的系统诊断，确认根本原因：

### 🔍 维度 1：日志异常

```
[swarm:coordinator.log]
[2026-02-18 20:00:14] [error] Coordination failed Error: API Key 未配置：
请在 coobee.json5 中配置 models.providers 或通过 DASHSCOPE_API_KEY 等环境变量设置
    at PiMonoBuilder.build
    at SwarmCoordinator.createTriageRuntime
    at async SwarmCoordinator.coordinate
```

### 📊 维度 2：代码执行流程

1. SwarmRuntime → SwarmCoordinator.coordinate()
2. SwarmCoordinator.createTriageRuntime() → PiMonoBuilder.build()
3. **PiMonoBuilder.resolveApiKey() 返回 undefined**
4. **抛出异常："API Key 未配置"**
5. SwarmCoordinator catch 块捕获，返回 `{ state: {status: 'failed'}, output: "处理失败: ..." }`
6. **SwarmRuntime 未检查 result.state.status**，继续执行
7. 最终输出空字符串

### 🎯 维度 3：环境配置

- `coobee.json5`: `apiKey: '${DASHSCOPE_API_KEY}'` （占位符）
- 环境变量 `DASHSCOPE_API_KEY`: **未设置** ❌
- ConfigEnv.resolveEnvVars() 保留原字符串
- PiMonoBuilder.resolveApiKey() 兜底检查 3 个环境变量，全部未设置

**核心问题**：API Key 未配置 → Runtime 创建失败 → 错误未正确传递给前端

### Events 记录分析

```json
{"ts":"2026-02-20T17:30:58.223Z","seq":1,"type":"run:start","content":""}
{"ts":"2026-02-20T17:30:58.224Z","seq":2,"type":"turn:start","content":"","data":{"turnIndex":1}}
{"ts":"2026-02-20T17:30:58.224Z","seq":3,"type":"llm:start","content":""}
{"ts":"2026-02-20T17:30:58.224Z","seq":4,"type":"text:start","content":""}
{"ts":"2026-02-20T17:30:58.226Z","seq":5,"type":"text:delta","content":"[Swarm] 正在分析任务需求...\n"}
{"ts":"2026-02-20T17:30:58.226Z","seq":6,"type":"text:delta","content":"[triage] 开始处理...\n"}
{"ts":"2026-02-20T17:30:58.488Z","seq":7,"type":"text:delta","content":"\n"}
{"ts":"2026-02-20T17:30:58.488Z","seq":8,"type":"text:done","content":"","data":{"text":""}} ❌
{"ts":"2026-02-20T17:30:58.488Z","seq":9,"type":"llm:done","content":""}
{"ts":"2026-02-20T17:30:58.488Z","seq":10,"type":"turn:done","content":"","data":{"turnIndex":1}}
{"ts":"2026-02-20T17:30:58.488Z","seq":11,"type":"run:done","content":""}
```

**关键发现**：

- ❌ 没有 `agent:start` 事件（应该在 seq=6 之后）
- ❌ 没有 `agent:done` 事件（`SwarmCoordinator.ts:174` 应该触发）
- ❌ 没有 `complete` 事件
- ✅ 有 `text:delta` 但只有 SwarmRuntime 生成的元信息

## 代码路径追踪

### 1. SwarmRuntime.doStream() → SwarmCoordinator.coordinate()

**src/main/ai/swarm/SwarmRuntime.ts:175-178**

```typescript
const taskPromise = this.coordinator.coordinate(task).then((r) => {
  outcome.result = r;
});
```

### 2. SwarmCoordinator.coordinate() → currentRuntime.run()

**src/main/ai/swarm/SwarmCoordinator.ts:171-174**

```typescript
const result = await currentRuntime.run(currentInput);
const output = result.output || '';

this.emit({ type: 'agent:done', data: { roleId: currentRoleId, output: output.substring(0, 200) } });
```

**问题**：`agent:done` 事件没有被触发，说明代码可能在第 171-174 行之间异常退出！

### 3. 可能的原因

#### 原因 A：currentRuntime.run() 抛出异常

- 但 `events.jsonl` 中没有 `run:error` 或 `error` 事件
- 异常可能被更上层捕获并吞掉了

#### 原因 B：currentRuntime.run() 返回空 output

- `result.output` 为空字符串
- `agent:done` 应该还是会触发（因为 `output.substring(0, 200)` 即使是空字符串也能执行）

#### 原因 C：eventQueue 处理时序问题

- SwarmCoordinator 触发的事件没有被 SwarmRuntime 的 eventQueue 捕获
- 或者事件在 `text:done` 之前没有来得及被处理

#### 原因 D：triage Runtime 创建失败

- `createTriageRuntime()` 可能创建失败，但没有抛出错误
- Runtime 执行了但 LLM API 调用失败（401/403/超时等）

## 诊断步骤

### 第一步：验证 triage Runtime 创建

在 `SwarmCoordinator.createTriageRuntime()` 后添加日志：

```typescript
const triageRuntime = await this.createTriageRuntime(roles);
log.info(`[SwarmCoordinator] Triage runtime created, roles: ${roles.length}`);
```

### 第二步：验证 currentRuntime.run() 执行

在 `SwarmCoordinator.coordinate()` 的循环中添加详细日志：

```typescript
log.info(`[SwarmCoordinator] Calling runtime.run(), roleId=${currentRoleId}, inputLength=${currentInput.length}`);
const result = await currentRuntime.run(currentInput);
log.info(
  `[SwarmCoordinator] Runtime.run() returned, output length: ${(result.output || '').length}, duration: ${result.duration}ms`
);
```

### 第三步：检查 PiMono Runtime 日志

查看是否有 API 调用失败、超时或权限错误：

- API Key 配置
- 网络连接
- 模型可用性
- 请求超时

### 第四步：验证事件传递

在 SwarmRuntime 的 setOnEvent 回调中添加计数器：

```typescript
let eventCount = 0;
this.coordinator.setOnEvent((event) => {
  eventCount++;
  log.info(`[SwarmRuntime] Event ${eventCount}: ${event.type}`);
  eventQueue.push(event);
  resolveWait?.();
});
```

## ✅ 已实施修复

### 修复 1：SwarmRuntime 增强错误处理

在 SwarmRuntime.doStream() 中添加检查，确保 SwarmCoordinator 返回的 failed 状态能正确传递：

```typescript
// SwarmRuntime.ts
const result = outcome.result!;

// 如果 SwarmCoordinator 返回 failed 状态，抛出错误
if (result.state.status === 'failed') {
  const errorMsg = result.state.error || result.output || 'Unknown error';
  log.error(`[SwarmRuntime] Swarm execution failed: ${errorMsg}`);
  yield {
    type: 'run:error',
    content: errorMsg,
    data: { message: errorMsg }
  };
  throw new Error(errorMsg);
}
```

### 修复 2：SwarmCoordinator 增强日志

添加详细日志追踪 Runtime 执行过程：

```typescript
log.info(`[SwarmCoordinator] Loop depth=${depth}, roleId=${currentRoleId}`);
log.info(`[SwarmCoordinator] Calling runtime.run() for ${currentRoleId}...`);
const result = await currentRuntime.run(currentInput);
log.info(`[SwarmCoordinator] Runtime.run() completed: outputLength=${output.length}, duration=${runDuration}ms`);
if (output.length === 0) {
  log.warn(`[SwarmCoordinator] ⚠️  ${currentRoleId} returned EMPTY output!`);
}
```

### 修复 3：配置环境

用户需要配置 API Key，两种方式：

**方式 A：环境变量（推荐）**

```bash
export DASHSCOPE_API_KEY="sk-xxxxxxxxxxxxxxxx"
# 或
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxx"
# 或
export VITE_LLM_API_KEY="xxxxxxxxxxxxxxxx"
```

**方式 B：直接修改配置**
修改 `.home/config/coobee.json5`：

```json5
{
  models: {
    providers: {
      dashscope: {
        apiKey: 'sk-your-actual-key-here' // 替换占位符
        // ...
      }
    }
  }
}
```

### 参考：集成测试的处理方式

集成测试使用 `describe.skipIf()` 优雅地处理 API Key 缺失：

```typescript
// PiMonoAgentRuntime.integration.test.ts
const apiConfig = process.env.VITE_LLM_API_KEY
  ? {
      apiKey: process.env.VITE_LLM_API_KEY,
      baseURL: process.env.VITE_LLM_BASE_URL || 'https://api.minimaxi.com/v1',
      model: process.env.VITE_LLM_MODEL || 'MiniMax-M2.1'
    }
  : null;

const RUN = !!apiConfig;

describe.skipIf(!RUN)('PiMonoAgentRuntime 集成测试', () => {
  // 只有配置了 API Key 才运行
});
```

## 未来改进建议

### 修复 4（未实施）：前端友好的错误提示

在 `SwarmCoordinator.coordinate()` 中添加 try-catch：

```typescript
for (let depth = 0; depth <= this.config.maxHandoffDepth; depth++) {
  this.emit({
    type: 'agent:start',
    data: { roleId: currentRoleId, input: currentInput.substring(0, 200) }
  });

  try {
    const result = await currentRuntime.run(currentInput);
    const output = result.output || '';

    log.info(`[SwarmCoordinator] ${currentRoleId} output: ${output.substring(0, 100)}... (${output.length} chars)`);

    this.emit({ type: 'agent:done', data: { roleId: currentRoleId, output: output.substring(0, 200) } });

    // ...rest of logic
  } catch (error) {
    log.error(`[SwarmCoordinator] Runtime.run() failed for ${currentRoleId}:`, error);
    this.emit({ type: 'error', data: { error: String(error), roleId: currentRoleId } });
    throw error;
  }
}
```

### 修复 2：确保事件被正确触发

验证 `this.emit()` 确实调用了 `this.onEvent`：

```typescript
private emit(event: SwarmEvent): void {
  log.info(`[SwarmCoordinator] Emitting event: ${event.type}`);
  this.onEvent?.(event);
}
```

### 修复 3：为简单问答添加直接回复模式

如果任务不需要专家能力，triage 应该直接回复而不是 handoff：

```typescript
// 在 triage instructions 中明确说明
const instructions = `${TRIAGE_INSTRUCTIONS}

**重要**：如果是简单的问答任务（如解释概念、回答常识问题），你应该**直接回答**，不要交接给其他专家。`;
```

## 测试验证

创建最小复现测试：

```typescript
it('Simple Q&A should get direct answer from triage', async () => {
  const coordinator = new SwarmCoordinator(TEST_CONFIG);
  coordinator.roleRegistry.registerAll(builtinRoles);

  const events: SwarmEvent[] = [];
  coordinator.setOnEvent((e) => events.push(e));

  const task = {
    id: 'test-simple-qa',
    input: '请解释什么是 REST API',
    createdAt: Date.now()
  };

  const result = await coordinator.coordinate(task);

  // 验证结果
  expect(result.output).not.toBe('');
  expect(result.output.length).toBeGreaterThan(10);

  // 验证事件
  expect(events.some((e) => e.type === 'agent:start')).toBe(true);
  expect(events.some((e) => e.type === 'agent:done')).toBe(true);
  expect(events.some((e) => e.type === 'complete')).toBe(true);
});
```

## 相关文件

- `src/main/ai/swarm/SwarmRuntime.ts` - 流式输出和事件处理
- `src/main/ai/swarm/SwarmCoordinator.ts` - 核心协调逻辑和事件触发
- `src/main/ai/swarm/roles/index.ts` - 角色注册表
- `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts` - 底层 LLM Runtime
- `.home/workspaces/283289408377266176/events/events.jsonl` - 实际执行的事件记录

## 后续行动

1. ✅ 诊断完成 - 确认问题在 `currentRuntime.run()` 返回空输出
2. ⏳ 添加详细日志验证根因
3. ⏳ 修复错误处理和事件触发逻辑
4. ⏳ 为简单问答优化 triage 指令
5. ⏳ 编写回归测试防止复现
