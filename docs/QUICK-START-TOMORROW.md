# 明天快速实施指南

## 一、推荐工作流（混合模式）

### 上午：功能开发（3-4 小时）

**选项 A：多 Agent 质量闭环**

```
1. 实现 Aggregator 类 (1小时)
   → src/main/ai/quality-loop/Aggregator.ts

2. 实现 Validator 类 (1小时)
   → src/main/ai/quality-loop/Validator.ts

3. 集成到 SwarmCoordinator (1-2小时)
   → src/main/ai/swarm/SwarmCoordinator.ts
   → 添加 afterAllAgents hook

4. 前端 UI 反馈 (可选)
   → src/renderer/src/components/agent/QualityFeedback.vue
```

**选项 B：Workbench 多模态预览**

```
1. 实现 PreviewRouter (0.5小时)
   → src/renderer/src/utils/previewRouter.ts

2. 实现 BrowserFrame 组件 (1小时)
   → src/renderer/src/components/agent/preview/BrowserFrame.vue

3. 重构 WorkbenchPanel (1.5小时)
   → src/renderer/src/components/agent/WorkbenchPanel.vue
   → 添加动态组件切换

4. 实现 notify_service 工具 (1小时)
   → src/main/ai/tools/builtin/notify-service.ts
   → 更新 AgentEnvInjector 提示
```

---

### 下午：结构优化（2-3 小时）

#### 任务 1: 统一错误处理 (1-1.5小时)

**步骤**：

```bash
# 1. 创建错误类型
touch src/shared/errors/index.ts
touch src/shared/errors/codes.ts

# 2. 实现 AppError 基类
```

```typescript
// src/shared/errors/codes.ts
export enum ErrorCode {
  // 系统错误 (1000-1999)
  SYSTEM_INTERNAL = 1000,
  SYSTEM_TIMEOUT = 1001,
  SYSTEM_QUOTA_EXCEEDED = 1002,

  // Agent 错误 (3000-3999)
  AGENT_NOT_FOUND = 3000,
  AGENT_EXECUTION_FAILED = 3001,

  // 工具错误 (4000-4999)
  TOOL_NOT_FOUND = 4000,
  TOOL_EXECUTION_FAILED = 4001,
  TOOL_PERMISSION_DENIED = 4002,

  // 文件错误 (5000-5999)
  FILE_NOT_FOUND = 5000,
  FILE_PERMISSION_DENIED = 5001
}

// src/shared/errors/index.ts
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
  }

  getUserMessage(): string {
    const messages: Record<number, string> = {
      [ErrorCode.AGENT_NOT_FOUND]: '未找到指定的 Agent，请检查配置',
      [ErrorCode.SYSTEM_QUOTA_EXCEEDED]: 'API 配额已用完，请稍后再试',
      [ErrorCode.TOOL_PERMISSION_DENIED]: '工具执行被拒绝，请检查权限设置'
      // ...
    };
    return messages[this.code] || this.message;
  }

  toJSON() {
    return {
      error: this.message,
      code: ErrorCode[this.code],
      codeValue: this.code,
      details: this.details,
      recoverable: this.recoverable
    };
  }
}

// 特定错误类
export class AgentNotFoundError extends AppError {
  constructor(agentId: string) {
    super(ErrorCode.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, { agentId }, false);
  }
}

export class QuotaExceededError extends AppError {
  constructor(remaining: number, required: number) {
    super(
      ErrorCode.SYSTEM_QUOTA_EXCEEDED,
      `Quota exceeded: need ${required}, only ${remaining} left`,
      { remaining, required },
      true
    );
  }
}
```

```bash
# 3. Gateway 错误中间件
touch src/main/gateway/middleware/errorHandler.ts
```

```typescript
// src/main/gateway/middleware/errorHandler.ts
import type { Context, Next } from 'koa';
import { AppError } from '@shared/errors';

export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      ctx.status = getHttpStatus(err.code);
      ctx.body = err.toJSON();
    } else {
      console.error('[ErrorHandler] Unhandled error:', err);
      ctx.status = 500;
      ctx.body = {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        codeValue: 1000
      };
    }
  }
}

function getHttpStatus(errorCode: number): number {
  if (errorCode >= 3000 && errorCode < 4000) return 404; // Agent 错误
  if (errorCode >= 4000 && errorCode < 5000) return 403; // 权限错误
  if (errorCode >= 5000 && errorCode < 6000) return 404; // 文件错误
  return 500;
}
```

```typescript
// src/main/gateway/Gateway.ts（修改）
import { errorHandler } from './middleware/errorHandler';

private setupHttpServer(): void {
  const app = new Koa();

  // 全局错误处理（最外层）
  app.use(errorHandler);  // ← 新增

  // ... 其他中间件
}
```

```bash
# 4. 前端错误处理
touch src/renderer/src/utils/errorHandler.ts
```

```typescript
// src/renderer/src/utils/errorHandler.ts
interface ApiErrorResponse {
  error: string;
  code: string;
  codeValue: number;
  details?: unknown;
  recoverable?: boolean;
}

export async function handleApiError(response: Response): Promise<never> {
  const errorData: ApiErrorResponse = await response.json();

  // 显示用户友好的错误提示
  const message = getUserMessage(errorData.codeValue) || errorData.error;

  // Toast 提示（假设有 useToast composable）
  // showToast(message, 'error');

  // 可恢复错误 → 提供重试按钮
  if (errorData.recoverable) {
    // showRetryButton();
  }

  throw new Error(message);
}

function getUserMessage(code: number): string | null {
  const messages: Record<number, string> = {
    3000: '未找到指定的 Agent，请检查配置',
    1002: 'API 配额已用完，请稍后再试',
    4002: '工具执行被拒绝，请检查权限设置'
    // ...
  };
  return messages[code] || null;
}
```

**测试验证**：

```bash
# 1. 启动应用
pnpm dev

# 2. 测试错误响应
curl http://localhost:39180/gateway/agents/not-exist
# 预期: {"error":"Agent \"not-exist\" not found","code":"AGENT_NOT_FOUND","codeValue":3000}

# 3. 前端测试
# 在浏览器中打开一个不存在的 Agent
# 预期: Toast 提示 "未找到指定的 Agent，请检查配置"
```

---

#### 任务 2: 事件系统类型安全 (0.5-1小时)

**步骤**：

```bash
# 1. 定义 EventMap
touch src/shared/events/types.ts
```

```typescript
// src/shared/events/types.ts
export interface EventMap {
  // Agent 生命周期
  'agent:execution:start': { agentId: string; sessionId: string };
  'agent:execution:done': { agentId: string; sessionId: string; duration: number };
  'agent:execution:error': { agentId: string; sessionId: string; error: string };

  // 工具调用
  'tool:call:start': { toolName: string; callId: string };
  'tool:call:done': { toolName: string; callId: string; duration: number };

  // 多 Agent 协作
  'swarm:handoff': { from: string; to: string; depth: number };
  'orchestrator:subtask:done': { taskId: string; agentId: string; result: string };

  // 质量保证
  'quality:aggregate:done': { sessionId: string; summary: string };
  'quality:validate:done': { sessionId: string; passed: boolean; score: number };

  // 资源管理
  'quota:updated': { remaining: number; total: number; resetAt: string };
  'quota:warning': { remaining: number; threshold: number };

  // 系统服务
  'service:started': { url: string; title: string; sessionId: string };
  'worker:status:changed': { name: string; status: string };

  // 存储
  'memory:write': { scope: string; file: string; size: number };
  'compression:done': {
    sessionId: string;
    originalTokens: number;
    summaryTokens: number;
    compressionRatio: number;
    duration: number;
  };

  // 终端
  'terminal:output': { sessionId: string; output: string };
}

// 类型安全的 EventEmitter（简化版）
export class TypedEventEmitter {
  private handlers = new Map<string, Set<Function>>();

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach((handler) => handler(data));
    }
  }

  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler);
    }
  }
}
```

```typescript
// src/main/gateway/Gateway.ts（修改 broadcastToSubscribers）
import type { EventMap } from '@shared/events/types';

class GatewayServer {
  // 添加类型安全的 emit 方法
  emitEvent<K extends keyof EventMap>(event: K, data: EventMap[K], sessionId?: string): void {
    this.broadcastToSubscribers(
      {
        type: 'event',
        event,
        data
      },
      sessionId
    );
  }
}

// 使用示例（替换现有的 broadcastToSubscribers 调用）
gateway.emitEvent('compression:done', {
  sessionId: 'xxx',
  originalTokens: 45000,
  summaryTokens: 5850,
  compressionRatio: 0.13,
  duration: 3200
});
// ✅ TypeScript 会检查 data 类型
```

```typescript
// src/renderer/src/composables/useGateway.ts（修改）
import type { EventMap } from '@shared/events/types';

export function useGateway() {
  // 类型安全的 on 方法
  function on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    // 实现
  }

  return { on, emit, call };
}

// 使用示例
const gateway = useGateway();
gateway.on('compression:done', (data) => {
  console.log(data.originalTokens); // ✅ data 类型已知
  console.log(data.xyz); // ❌ TypeScript 报错：属性不存在
});
```

**测试验证**：

```bash
# 1. 编译检查
pnpm typecheck
# 预期: 没有类型错误

# 2. 运行时测试
# 在后端触发一个事件
gateway.emitEvent('compression:done', {
  sessionId: 'test',
  originalTokens: 45000,
  summaryTokens: 5850,
  compressionRatio: 0.13,
  duration: 3200
});

# 在前端监听
gateway.on('compression:done', (data) => {
  console.log('Compression done:', data);
});

# 预期: 前端控制台输出 "Compression done: { ... }"
```

---

#### 任务 3: 日志查询接口（可选，如果时间充裕）

**步骤**：

```bash
# 1. 实现 LogService
touch src/main/common/observability/LogService.ts

# 2. 实现 HTTP 路由
touch src/main/gateway/http/logs.ts

# 3. 更新 Gateway
# 在 Gateway.ts 中注册 logs 路由

# 4. 更新前端 LogViewer
# 使用新的 API 替代直接读取文件
```

---

## 二、提交规范

### Commit Message 格式

```bash
# 功能开发
feat(quality-loop): implement Aggregator and Validator

# 结构优化
refactor(errors): add unified error handling with AppError
refactor(events): add type-safe event system with EventMap

# 测试
test(quality-loop): add tests for aggregation and validation

# 文档
docs(architecture): add comprehensive architecture analysis
```

---

## 三、完成标准

### 上午：功能开发

**选项 A：质量闭环**

- [ ] Aggregator 类实现并测试通过
- [ ] Validator 类实现并测试通过
- [ ] 集成到 SwarmCoordinator
- [ ] 手动测试：运行一个 Swarm，看到 aggregation + validation 输出

**选项 B：多模态预览**

- [ ] PreviewRouter 实现
- [ ] BrowserFrame 组件实现
- [ ] WorkbenchPanel 重构完成
- [ ] 手动测试：打开 HTML 文件，看到预览；Agent 启动服务，看到 iframe

---

### 下午：结构优化

**任务 1：错误处理**

- [ ] AppError 类定义
- [ ] Gateway 错误中间件实现
- [ ] 前端错误处理实现
- [ ] 测试：curl 请求返回正确的错误格式
- [ ] 测试：前端显示用户友好的错误提示

**任务 2：事件类型**

- [ ] EventMap 定义
- [ ] Gateway emitEvent 方法实现
- [ ] 前端 useGateway 类型化
- [ ] 测试：TypeScript 编译通过
- [ ] 测试：事件发送/接收正常

---

## 四、风险控制

### 如果遇到困难

**上午功能开发卡住**：

- 先完成 MVP（最小可行产品）
- 暂时跳过 UI 部分（先让逻辑跑通）
- 添加详细的 console.log（方便调试）

**下午结构优化卡住**：

- 先完成错误处理（优先级最高）
- 事件类型可以延后（不影响功能）
- 日志查询可以下次再做

### 时间不够

**只完成上午**：

- OK，结构优化可以明天继续
- 至少 review 一下 ARCHITECTURE-ANALYSIS.md

**只完成下午**：

- OK，功能开发可以后天继续
- 但建议先做功能（用户价值更直接）

---

## 五、我的支持

### 随时可以

- 🔍 **查询代码**：如果遇到不清楚的地方，告诉我，我立即查找
- 🐛 **调试错误**：如果遇到 Bug，把错误信息发给我
- 💡 **提供建议**：如果不确定如何实现，描述需求，我给方案
- ✅ **Review 代码**：完成后，我可以 review 并提出改进建议

### 我会做

- ✅ 实现你选择的任务
- ✅ 编写测试验证逻辑
- ✅ 更新相关文档
- ✅ 提交规范的 commit

---

## 六、决策时间

**现在，请告诉我明天上午做什么：**

**A. 多 Agent 质量闭环**  
**B. Workbench 多模态预览**  
**C. 其他功能（你说）**

**下午默认做**：

- 统一错误处理
- 事件系统类型安全

**如果你想调整下午任务，也可以告诉我。**

---

我已准备就绪，等待你的指令！🚀
