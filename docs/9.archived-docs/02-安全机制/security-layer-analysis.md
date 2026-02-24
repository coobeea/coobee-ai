# 安全层架构分析

> **讨论时间**: 2026-02-23  
> **目标**: 确定最佳的统一安全层位置

---

## 问题

用户提出：是否可以在 **Gateway 层** 或 **LLM 调用层** 增加统一的安全层？

---

## 架构分析

### 当前架构流程

```
Gateway (入口)
  ↓ 用户消息
AgentExecutor (调度)
  ↓ 创建 Runtime
Runtime (LLM 调用)
  ↓ 工具调用列表
ToolExecutionPipeline (工具管线) ⭐
  ├─ Phase 1.5: before_tool_call Hook (Extension 审批)
  ├─ Phase 2: Sandbox Policy (白名单/黑名单)
  └─ Phase 3: 工具执行
      └─ read/write/exec 内部检查（新增）
```

---

## 方案对比

### 方案 1: Gateway 层（入口层）

**位置**: `src/main/gateway/methods/chat.ts`, `src/main/gateway/http/*.ts`

**检查时机**: 收到用户消息时

**优点**:

- ✅ 统一入口，所有请求都经过
- ✅ 可以拦截恶意用户输入（如注入攻击）

**缺点**:

- ❌ **无法看到 LLM 生成的工具调用**（这时工具还没生成）
- ❌ 只能检查用户消息，无法检查工具参数
- ❌ 太早了，很多安全威胁还没出现

**适用场景**:

- 输入验证（SQL 注入、XSS 等）
- Rate limiting
- 用户权限检查

**不适用**: 工具调用安全检查

---

### 方案 2: Runtime 层（LLM 调用后）

**位置**: `src/main/ai/runtime/pimono/PiMonoBuilder.ts`, `src/main/ai/runtime/openai/OpenAIBuilder.ts`

**检查时机**: LLM 返回工具调用后，ToolExecutionPipeline 之前

**优点**:

- ✅ 可以看到 LLM 生成的所有工具调用
- ✅ 在工具执行前统一拦截

**缺点**:

- ❌ 需要在两个 Builder 中重复实现
- ❌ **ToolExecutionPipeline 已经有了更好的位置**

**适用场景**:

- 如果没有 Pipeline，这是最佳位置

---

### 方案 3: ToolExecutionPipeline（工具执行管线）⭐ 推荐

**位置**: `src/main/ai/runtime/shared/ToolExecutionPipeline.ts`

**检查时机**: 工具执行前（Phase 1.5 或新增 Phase 1.75）

**优点**:

- ✅ **统一的工具调用入口**（PiMono 和 OpenAI 共用）
- ✅ 可以看到完整的工具名称和参数
- ✅ 已有 Hook 机制（before_tool_call）
- ✅ 已有 Sandbox Policy 检查
- ✅ 可以拦截、修改或审批工具调用
- ✅ 不需要在每个工具内部实现

**缺点**:

- ⚠️ 与工具内部检查可能重复（但可以作为双重保险）

**实现方案**:

#### 选项 A: 增强 Phase 2 (Sandbox Policy)

在现有的 Sandbox Policy 检查中增加参数级别的安全检查：

```typescript
// Phase 2: Enhanced Sandbox Policy + Security Check
const securityCheck = checkToolSecurity(def.name, typedParams, opts.sandboxContext);
if (!securityCheck.safe) {
  return {
    resultText: `Error: ${securityCheck.reason}`,
    blocked: true,
    blockReason: securityCheck.reason
  };
}
```

#### 选项 B: 新增 Phase 1.75 (Security Guard)

在 before_tool_call 和 Sandbox Policy 之间插入专门的安全层：

```typescript
// Phase 1.5: before_tool_call Hook (Extension 审批)
// ...

// Phase 1.75: Security Guard (统一安全检查) ⭐ NEW
const securityGuard = SecurityGuard.check({
  toolName: def.name,
  params: typedParams,
  context: opts.sandboxContext
});
if (securityGuard.blocked) {
  return {
    resultText: `Error: Security violation — ${securityGuard.reason}`,
    blocked: true,
    blockReason: securityGuard.reason
  };
}

// Phase 2: Sandbox Policy
// ...
```

---

### 方案 4: 工具层（当前实现）

**位置**: `src/main/ai/tools/builtin/read.ts`, `write.ts`, `exec.ts`

**检查时机**: 工具内部执行时

**优点**:

- ✅ 针对性强，可以根据工具特点做深度检查
- ✅ 作为最后一道防线

**缺点**:

- ❌ 分散，需要每个工具都实现
- ❌ 容易遗漏（新工具可能忘记加检查）

**适用场景**:

- 作为 **补充防线**，不是主要防线

---

## 推荐方案：分层防御

### 第一层：ToolExecutionPipeline（主防线）⭐

**新增 SecurityGuard 模块**

```typescript
// src/main/ai/runtime/shared/SecurityGuard.ts

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export class SecurityGuard {
  /**
   * 统一安全检查
   */
  static check(options: {
    toolName: string;
    params: Record<string, unknown>;
    context: ToolExecutionContext;
  }): SecurityCheckResult {
    // 1. 检查敏感路径（read/write/exec）
    if (['read', 'write', 'exec'].includes(options.toolName)) {
      const pathCheck = this.checkSensitivePath(options);
      if (!pathCheck.safe) return pathCheck;
    }

    // 2. 检查危险命令（exec）
    if (options.toolName === 'exec') {
      const cmdCheck = this.checkDangerousCommand(options);
      if (!cmdCheck.safe) return cmdCheck;
    }

    // 3. 检查大批量操作（防止 DoS）
    const bulkCheck = this.checkBulkOperation(options);
    if (!bulkCheck.safe) return bulkCheck;

    // 4. 检查敏感信息泄露（read 工具返回内容）
    // 这个在工具执行后检查，放在 after_tool_call

    return { safe: true };
  }

  private static checkSensitivePath(options: any): SecurityCheckResult {
    // 复用 sensitive-paths.ts 的逻辑
    const { canRead, canWrite } = require('../../tools/security/sensitive-paths');

    if (options.toolName === 'read' && options.params.path) {
      const error = canRead(options.params.path);
      if (error) {
        return { safe: false, reason: error, severity: 'high' };
      }
    }

    if (options.toolName === 'write' && options.params.path) {
      const error = canWrite(options.params.path);
      if (error) {
        return { safe: false, reason: error, severity: 'high' };
      }
    }

    return { safe: true };
  }

  private static checkDangerousCommand(options: any): SecurityCheckResult {
    // 复用 command-scanner.ts 的逻辑
    const { scanCommand } = require('../../tools/security/command-scanner');

    if (options.params.command) {
      const workingDir = options.context.workspaceRoot;
      const error = scanCommand(options.params.command, workingDir);
      if (error) {
        return { safe: false, reason: error, severity: 'critical' };
      }
    }

    return { safe: true };
  }

  private static checkBulkOperation(options: any): SecurityCheckResult {
    // 防止大批量文件操作导致 DoS
    if (options.toolName === 'glob') {
      // 限制 glob 返回文件数量
      const limit = options.params.limit || 1000;
      if (limit > 10000) {
        return {
          safe: false,
          reason: 'Bulk operation limit exceeded (max 10000 files)',
          severity: 'medium'
        };
      }
    }

    return { safe: true };
  }
}
```

**在 ToolExecutionPipeline 中集成**

```typescript
// src/main/ai/runtime/shared/ToolExecutionPipeline.ts

// Phase 1.75: Security Guard (统一安全检查)
try {
  const { SecurityGuard } = await import('./SecurityGuard');
  const securityCheck = SecurityGuard.check({
    toolName: def.name,
    params: typedParams,
    context: opts.sandboxContext
  });

  if (!securityCheck.safe) {
    log.warn(`[SecurityGuard] Blocked ${def.name}: ${securityCheck.reason}`, {
      severity: securityCheck.severity,
      sessionId,
      params: typedParams
    });

    return {
      resultText: `Error: Security violation — ${securityCheck.reason}`,
      blocked: true,
      suspended: false,
      blockReason: securityCheck.reason
    };
  }
} catch (error) {
  // 安全检查失败应阻止执行（安全优先）
  const errMsg = error instanceof Error ? error.message : String(error);
  log.error(`[SecurityGuard] Security check failed for ${def.name}: ${errMsg}`);
  return {
    resultText: `Error: Security check failed — ${errMsg}`,
    blocked: true,
    suspended: false,
    blockReason: `Security check error: ${errMsg}`
  };
}
```

### 第二层：工具内部检查（补充防线）

**保留当前的工具内部检查**，作为深度防御：

- `read.ts` —— 敏感路径检查
- `write.ts` —— 敏感路径 + 脚本内容扫描
- `exec.ts` —— 命令扫描

这样即使 SecurityGuard 被绕过（如新工具忘记注册），工具内部仍有检查。

---

## 优势

### 1. 统一管理

- 所有安全规则在 `SecurityGuard` 一处定义
- 新增工具自动受保护
- 修改规则只需改一处

### 2. 多层防御

- **L1**: ToolExecutionPipeline（主防线）
- **L2**: 工具内部检查（补充防线）
- **L3**: 文件系统权限（最后防线）

### 3. 可观测

- 统一的日志记录（`[SecurityGuard]`）
- severity 标记（low/medium/high/critical）
- 便于审计和监控

### 4. 可扩展

- 可以轻松添加新的检查规则
- 支持自定义检查器（Plugin）
- 可以与 Extension 系统集成

---

## 实施计划

### Phase 1: 创建 SecurityGuard 模块

1. 创建 `src/main/ai/runtime/shared/SecurityGuard.ts`
2. 从现有的 `sensitive-paths.ts` 和 `command-scanner.ts` 提取逻辑
3. 添加新的检查规则（批量操作、敏感信息泄露等）

### Phase 2: 集成到 ToolExecutionPipeline

1. 在 Phase 1.75 插入 SecurityGuard 检查
2. 添加日志记录和监控
3. 编写测试用例

### Phase 3: 优化现有工具检查

1. 工具内部检查简化（只保留特定逻辑）
2. 移除重复代码
3. 统一错误消息格式

---

## 总结

**推荐方案**: 在 **ToolExecutionPipeline 新增 Phase 1.75（SecurityGuard）** 作为统一安全层

**原因**:

1. ✅ 可以看到 LLM 生成的完整工具调用
2. ✅ 统一入口，所有工具都受保护
3. ✅ 不需要修改 Gateway 层
4. ✅ 不需要在两个 Builder 中重复实现
5. ✅ 与现有的 Hook 和 Policy 机制完美配合
6. ✅ 作为主防线，工具内部检查作为补充

**不推荐**: Gateway 层

- ❌ 太早了，无法看到工具调用
- ❌ 只能检查用户输入，不能检查 LLM 生成的工具参数
