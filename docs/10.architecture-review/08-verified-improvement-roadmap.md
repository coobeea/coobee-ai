# coobee-ai 第四轮改进路线图（经验证）

> 生成时间：2026-02-15
> 基于：07-fourth-round-comprehensive-analysis.md
> 验证方式：对 07 中每个发现的可行性、影响范围、实施成本进行交叉验证
> 原则：安全优先、已有代码利用优先、最小改动原则

---

## 一、验证结论

### 1.1 对 07 分析的验证

| 发现编号                        | 验证结果       | 说明                                                          |
| ------------------------------- | -------------- | ------------------------------------------------------------- |
| N-1/N-2 (path 穿越)             | **确认**       | context_inspect 的 filename 参数直接拼接，需修复              |
| N-3 (RecoveryContext.runtime)   | **确认**       | AbstractAgentRuntime.stream() 中 RecoveryContext 未传 runtime |
| N-4 (缺 search/glob 工具)       | **确认**       | Chat 模式下无文件搜索能力                                     |
| N-5 (索引未利用)                | **确认**       | memory.ts 的 searchMemoryFiles 完全不调用 searchIndex         |
| N-6 (tool-approval 直接 import) | **确认但降级** | 当前 import 路径可用，迁移为中优先级                          |
| N-7 (exec 无 fallback 保护)     | **确认**       | Extension 加载失败时 exec 无安全兜底                          |
| N-8 (memory 路径重复)           | **确认**       | resolveMemoryPath 可复用 path-guard                           |
| N-9 (工具转换重复)              | **确认但降级** | 两个 Runtime 的 SDK 差异较大，完全统一成本高                  |
| N-10 (Docker 降级无警告)        | **确认**       | 添加日志即可                                                  |
| N-11~N-15                       | **确认**       | 低优先级，不影响功能正确性                                    |

### 1.2 优先级重排

经验证后的实施优先级（综合安全影响、实施成本、收益）：

```
紧急（立即）
  ├── S-1 路径穿越修复（context_inspect/session_*）
  └── S-2 ErrorRecoveryChain.runtime 注入修复

高优先级（本周）
  ├── H-1 记忆搜索接入索引层
  ├── H-2 添加 search/glob 内置工具
  └── H-3 exec 安全兜底（Extension 未加载时的保护）

中优先级（下周）
  ├── M-1 memory 路径校验统一到 path-guard
  ├── M-2 tool-approval 迁移到 ExtensionServices
  ├── M-3 Docker 降级警告
  └── M-4 工具转换公共逻辑提取

低优先级（后续）
  ├── L-1 OpenAI 双 emitter 统一
  ├── L-2 PiMono clearSession 补全
  ├── L-3 Pipeline normalizePathParam 使用
  ├── L-4 Gateway 会话管理 API
  └── L-5 会话格式统一/迁移
```

---

## 二、改进优先级总览

| 编号    | 改进项                          | 优先级 | 复杂度 | 影响          |
| ------- | ------------------------------- | ------ | ------ | ------------- |
| S-1     | 路径穿越安全修复                | 紧急   | 低     | 3 个工具      |
| S-2     | ErrorRecoveryChain.runtime 注入 | 紧急   | 低     | 1 个文件      |
| H-1     | 记忆搜索接入索引层              | 高     | 中     | memory.ts     |
| H-2     | 添加 search/glob 工具           | 高     | 中     | 新文件        |
| H-3     | exec 安全兜底                   | 高     | 低     | exec.ts       |
| M-1     | memory 路径统一到 path-guard    | 中     | 中     | memory.ts     |
| M-2     | tool-approval 迁移到 Services   | 中     | 中     | tool-approval |
| M-3     | Docker 降级警告                 | 中     | 低     | context.ts    |
| M-4     | 工具转换公共逻辑提取            | 中     | 高     | Runtime 层    |
| L-1~L-5 | 低优先级清理                    | 低     | 低~中  | 各模块        |

---

## 三、详细改进方案

### S-1 路径穿越安全修复（紧急）

**问题**：`context_inspect`、`session_status`、`session_history` 直接使用 `path.join()` 拼接路径，未经 path-guard 校验。

**方案**：

```typescript
// context_inspect.ts — 修复前
const filePath = path.join(workspace, 'contexts', filename);
const content = fs.readFileSync(filePath, 'utf-8');

// context_inspect.ts — 修复后
const contextsDir = path.join(workspace, 'contexts');
const resolved = resolveSandboxPath(filename, {
  ...context,
  workspaceRoot: contextsDir // 限制在 contexts/ 目录内
});
if (resolved.error) return pathGuardErrorToToolResult(resolved.error);
const content = fs.readFileSync(resolved.path, 'utf-8');
```

**改动范围**：

- `tools/builtin/context_inspect.ts` — 添加 path-guard 校验
- `tools/builtin/session_status.ts` — 同上（如有路径参数）
- `tools/builtin/session_history.ts` — 同上（如有路径参数）

**测试**：添加路径穿越测试（`../../etc/passwd` → 被拦截）

---

### S-2 ErrorRecoveryChain.runtime 注入（紧急）

**问题**：`AbstractAgentRuntime.stream()` 创建 `RecoveryContext` 时未传入 `runtime`，导致 `ContextCompressionStrategy` 和 `ThinkingLevelFallbackStrategy` 永远走 `throw` 分支。

**方案**：

```typescript
// AbstractAgentRuntime.ts — stream() 方法中
const recoveryContext: RecoveryContext = {
  attemptNumber: 0,
  maxAttempts: 3,
  originalError: error,
  runtime: {
    compressor: (this as any).sessionCompressor ?? undefined,
    thinkingLevel: (this as any).options?.thinkingLevel,
    setThinkingLevel: (level) => {
      if ((this as any).options) {
        (this as any).options.thinkingLevel = level;
      }
    }
  }
};
```

**改动范围**：

- `runtime/AbstractAgentRuntime.ts` — `stream()` 方法中注入 runtime

**测试**：验证 context_length 错误触发压缩策略而非直接 throw

---

### H-1 记忆搜索接入索引层

**问题**：`memory-index.ts` 的 `searchIndex` 已实现但 `memory.ts` 未使用。

**方案（渐进式）**：

```
搜索流程改进：
1. 先查索引（searchIndex） → 获取匹配文件列表 + 评分
2. 对高分文件做全文搜索（现有 searchMemoryFiles 逻辑）
3. 合并两阶段结果，去重排序

优势：
- 文件多时跳过无关文件（索引过滤）
- 保留现有全文搜索的精确度
- 渐进式改进，不破坏现有行为
```

**改动范围**：

- `tools/builtin/memory.ts` — search action 中引入 `getOrBuildIndex` + `searchIndex`

---

### H-2 添加 search/glob 工具

**问题**：无独立的文件搜索和发现工具，Chat 模式无法搜索文件。

**方案**：

创建两个新工具：

```typescript
// tools/builtin/search.ts — 文件内容搜索
{
  name: 'search',
  description: 'Search file contents using pattern matching (grep-like)',
  parameters: z.object({
    pattern: z.string().describe('Search pattern (regex supported)'),
    path: z.string().optional().describe('Directory to search in'),
    glob: z.string().optional().describe('File pattern filter (e.g. "*.ts")'),
    maxResults: z.number().optional().default(50)
  }),
  execute: async function* (params, signal, context) {
    // 使用 ripgrep 或 Node.js 递归搜索
    // 路径限制在 workspaceRoot 内（通过 path-guard）
  }
}

// tools/builtin/glob.ts — 文件名搜索
{
  name: 'glob',
  description: 'Find files by name pattern',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts")'),
    path: z.string().optional().describe('Base directory'),
    maxResults: z.number().optional().default(100)
  }),
  execute: async function* (params, signal, context) {
    // 使用 fast-glob 库
    // 路径限制在 workspaceRoot 内
  }
}
```

**改动范围**：

- 新建 `tools/builtin/search.ts`
- 新建 `tools/builtin/glob.ts`
- 更新 `tools/builtin/index.ts` 导出
- 更新 Chat 模式指令（告知 Agent 可以搜索文件）

---

### H-3 exec 安全兜底

**问题**：如果 Extension 系统未加载，exec 工具无命令级安全保护。

**方案**：

```typescript
// exec.ts — 在 execute 函数开头添加 fallback 安全检查
import { checkExecPolicy } from '../../sandbox/exec-policy';

// 在工具执行函数中：
const policyResult = checkExecPolicy(command);
if (policyResult === 'deny') {
  return { success: false, llmContent: 'Error: Command blocked by security policy' };
}
// Extension hook 会进一步细化处理（ask → HITL）
// 如果 Extension 未加载，至少 deny 列表仍然生效
```

**改动范围**：

- `tools/builtin/exec.ts` — 添加 exec-policy 前置检查

---

### M-1 memory 路径统一到 path-guard

**方案**：将 `resolveMemoryPath()` 替换为调用 `resolveSandboxPath()`，以 memoryDir 作为 workspaceRoot。

**改动范围**：

- `tools/builtin/memory.ts` — 修改 resolveMemoryPath 实现

---

### M-2 tool-approval 迁移到 Services

**方案**：将 `tool-approval/index.ts` 中对 `HitlApprovalManager` 的直接 import 替换为 `api.services.hitl.*` 调用。

**改动范围**：

- `extensions/tool-approval/index.ts`

---

### M-3 Docker 降级警告

**方案**：在 `resolveSandboxContext()` 的 Docker 降级路径中添加 `log.warn()`。

**改动范围**：

- `sandbox/context.ts` — 1 行日志

---

### M-4 工具转换公共逻辑提取

**方案**：

```typescript
// runtime/shared/ToolExecutionPipeline.ts
export async function executeToolWithHooks(
  def: ToolDefinition,
  params: Record<string, unknown>,
  sandboxContext: SandboxContext,
  signal?: AbortSignal
): Promise<{ result: ToolResult; text: string }> {
  // 1. before_tool_call Hook
  // 2. isToolAllowed 策略检查
  // 3. tool.execute()
  // 4. after_tool_call + tool_result_persist Hooks
  // 5. 返回统一结果
}
```

OpenAI 和 PiMono 各自的工具转换仅需调用此共享函数，各自处理 SDK 特有的格式适配。

**改动范围**：

- 新建 `runtime/shared/ToolExecutionPipeline.ts`
- 修改 `runtime/openai/OpenAIAgentRuntime.ts`
- 修改 `runtime/pimono/PiMonoToolConverter.ts`

---

## 四、实施时间线

```
┌────────────────────────────────────────────────────────────┐
│ 紧急（立即）                                                 │
│  ├── S-1 路径穿越修复                             [0.5d]   │
│  └── S-2 ErrorRecoveryChain.runtime 注入          [0.5d]   │
│                                                            │
│ 高优先级（本周）                                             │
│  ├── H-1 记忆搜索接入索引层                       [1d]     │
│  ├── H-2 search/glob 工具                         [2d]     │
│  └── H-3 exec 安全兜底                            [0.5d]   │
│                                                            │
│ 中优先级（下周）                                             │
│  ├── M-1 memory 路径统一                          [1d]     │
│  ├── M-2 tool-approval 迁移到 Services            [0.5d]   │
│  ├── M-3 Docker 降级警告                          [0.5h]   │
│  └── M-4 工具转换公共逻辑提取                     [2d]     │
│                                                            │
│ 低优先级（后续）                                             │
│  ├── L-1 OpenAI 双 emitter 统一                   [1d]     │
│  ├── L-2 PiMono clearSession 补全                 [0.5d]   │
│  ├── L-3 Pipeline normalizePathParam              [0.5d]   │
│  ├── L-4 Gateway 会话管理 API                     [2d]     │
│  └── L-5 会话格式统一                             [3d]     │
└────────────────────────────────────────────────────────────┘
```

---

## 五、风险评估

| 改进项           | 风险                                       | 缓解措施                       |
| ---------------- | ------------------------------------------ | ------------------------------ |
| S-1 路径穿越修复 | 可能影响正常文件读取                       | 添加回归测试                   |
| S-2 runtime 注入 | 类型适配复杂                               | 使用接口方法而非 this 直接访问 |
| H-1 索引搜索     | 索引过期可能导致结果不全                   | 保留全文扫描作为 fallback      |
| H-2 search/glob  | 大目录搜索可能超时                         | 添加 maxResults + timeout      |
| H-3 exec 安全    | checkExecPolicy 与 Extension Hook 双重执行 | Hook 内检查重复时跳过          |
| M-4 工具转换提取 | SDK 差异大，抽象可能泄漏                   | 保持各 Runtime 的格式适配独立  |

---

## 六、验证后的架构建议

### 6.1 短期聚焦（本轮）

1. **安全第一**：修复路径穿越（S-1）和 ErrorRecovery 注入（S-2）
2. **能力补全**：search/glob 工具 + 索引利用 = Agent 搜索能力质的飞跃
3. **安全兜底**：exec 前置安全检查，消除单点依赖

### 6.2 中期方向

1. **工具执行管线统一**：消除两个 Runtime 的工具转换重复代码
2. **记忆系统升级**：在索引层基础上引入 FTS（better-sqlite3）
3. **Extension 服务落地**：内置扩展迁移到 ExtensionServices

### 6.3 长期愿景

1. **多 Agent 协调**：在单 Agent 稳定后，启用子 Agent 机制
2. **向量记忆**：引入 Embedding + 混合检索
3. **安全形式化**：参考 OpenClaw TLA+ 方案，对关键安全路径建模

---

## 附录：已完成改进回顾（R1-R3 汇总）

> R1-R3 共完成 25 项改进，详见 04-improvement-roadmap.md 和 06-next-improvement-roadmap.md 附录

| 阶段          | 完成数 | 关键成果                                                         |
| ------------- | ------ | ---------------------------------------------------------------- |
| R1（02 文档） | 5      | exec 白名单、monitoring 清理、ProcessRegistry 迁移               |
| R2（04 文档） | 13     | HITL 独立、Memory 升级、self-reflection、Extension 安全          |
| R3（06 文档） | 11     | 工具策略分层、管线标准化、PiMono 拆分、记忆索引、Chat/Agent 模式 |
| **合计**      | **29** |                                                                  |
