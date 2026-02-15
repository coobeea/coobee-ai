# coobee-ai AI 模块 — 改进路线图

> 生成时间：2026-02-15  
> 基于：03-comprehensive-architecture-analysis.md 的分析结论  
> 原则：每个改进项有明确的问题描述、方案设计、影响范围和优先级

---

## 改进优先级总览

```
┌─────────────────────────────────────────────────┐
│ Phase 1: 架构纠偏（基础设施）                      │
│   P1-1  HITL 独立于 SDK（通用工具审批引擎）         │
│   P1-2  path-guard 符号链接修复                    │
│   P1-3  Extension Skill 发现 bug 修复              │
├─────────────────────────────────────────────────┤
│ Phase 2: Memory 系统升级                          │
│   P2-1  memory 工具接入 LongTermMemoryStore        │
│   P2-2  自动记忆提取（agent_end Hook）              │
│   P2-3  会话启动记忆注入（before_agent_start Hook） │
├─────────────────────────────────────────────────┤
│ Phase 3: 自我进化闭环                             │
│   P3-1  评估结果自动存入记忆                       │
│   P3-2  错误模式自动生成 Skill                     │
│   P3-3  执行协议动态调整                           │
├─────────────────────────────────────────────────┤
│ Phase 4: 安全与韧性                               │
│   P4-1  Extension 沙箱隔离                        │
│   P4-2  渐进式错误恢复                            │
│   P4-3  工具操作版本追踪                           │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: 架构纠偏

### P1-1 HITL 独立于 SDK — 通用工具审批引擎

#### 问题

1. HITL 依赖 OpenAI SDK 的 `needsApproval` 机制，PiMono 用户无法使用
2. `exec-policy.ts` 名称绑定 exec 工具，但审批策略应该是通用的
3. `approve-always` 的作用范围（session/agent/global）未设计
4. 策略逻辑分散在 AgentExecutor、两个 Runtime 中

#### 方案

##### 目标架构

```
hitl/
├── HitlApprovalManager.ts    ← 已有，审批状态管理
├── ToolApprovalPolicy.ts      ← 新增，通用工具审批策略引擎
├── ApprovalScopeStore.ts      ← 新增，多维度审批记忆
├── policies/
│   ├── exec-rules.ts          ← exec 工具规则（黑名单/白名单）
│   └── fs-rules.ts            ← write/edit 工具规则（路径匹配等）
└── types.ts                   ← HITL 类型定义
```

##### 核心类型

```typescript
// 审批维度
type ApprovalScope = 'once' | 'session' | 'agent' | 'global'

// 策略规则（通用）
interface ToolApprovalRule {
  /** 匹配工具名 */
  toolName: string | string[]
  /** 参数条件匹配 */
  match?: (args: Record<string, unknown>) => boolean
  /** 决策 */
  decision: 'allow' | 'deny' | 'ask'
  /** 优先级（越高越先匹配） */
  priority: number
  /** 规则来源 */
  source: 'builtin' | 'learned' | 'user'
  /** 描述（拒绝时展示） */
  reason: string
}

// 审批上下文
interface ApprovalContext {
  sessionId: string
  agentId?: string
  toolName: string
  arguments: Record<string, unknown>
}

// 策略引擎
class ToolApprovalPolicy {
  evaluate(context: ApprovalContext): { action: 'allow' | 'deny' | 'ask'; reason: string }
  learn(context: ApprovalContext, scope: ApprovalScope): void
  addRule(rule: ToolApprovalRule): void
  removeRule(ruleId: string): void
}
```

##### SDK 独立的 HITL 实现

**核心变更**：在 Runtime 的 `convertTools()` 的 execute 回调中统一拦截，而非依赖 SDK 的 `needsApproval`。

```
两个 Runtime 统一流程：

LLM 调用工具 → execute 回调触发
  → ToolApprovalPolicy.evaluate(context)
  → allow → 直接执行
  → deny  → 返回错误给 LLM（不执行）
  → ask   → 发送 hitl:required 事件
          → HitlApprovalManager.waitForDecision(sessionId, toolName, args)
          → 用户审批
          → approve → 执行 + learn(scope)
          → reject  → 返回错误给 LLM
```

**变更范围**：

- 删除 `sandbox/exec-policy.ts`
- 新增 `hitl/ToolApprovalPolicy.ts`、`hitl/ApprovalScopeStore.ts`、`hitl/policies/`
- 修改 `OpenAIAgentRuntime.convertTools()` — 移除 `needsApproval`，改用 Policy 拦截
- 修改 `PiMonoAgentRuntime.convertTools()` — 同上（两个 Runtime 逻辑一致）
- 修改 `AgentExecutor.ts` — 移除 `computePolicyDecisions()`，HITL 循环简化
- 修改 `HitlApprovalManager.ts` — 支持单工具等待模式（当前是批量）

**关键考量**：

- OpenAI SDK 对工具执行时间可能有限制；需测试长等待场景
- 如果 SDK 超时，需要优雅处理（返回错误而非崩溃）
- `HitlApprovalManager` 需要从"批量等待"改为"按工具等待"或"混合模式"

**工作量**：3-4 天

---

### P1-2 path-guard 符号链接修复

#### 问题

`sandbox/path-guard.ts` 仅用 `path.resolve()` + `path.relative()` 做字符串比较，未用 `fs.realpathSync` 检查符号链接穿越。而 `memory.ts` 的 `resolveMemoryPath()` 已独立实现了完整的检查。

#### 方案

```typescript
// path-guard.ts — 新增 realpathSync 检查

export function resolveSandboxPath(filePath: string, context: SandboxContext): string {
  const resolved = path.resolve(context.workspaceRoot, filePath)

  // 1. 字符串级检查（现有逻辑）
  if (!isWithinRoot(resolved, context.workspaceRoot)) {
    throw new PathGuardError(`Path escapes workspace: ${filePath}`)
  }

  // 2. 符号链接穿越检查（新增）
  let realTarget: string
  if (fs.existsSync(resolved)) {
    realTarget = fs.realpathSync(resolved)
  } else {
    // 文件不存在（write 场景），检查最近存在的祖先目录
    let current = path.dirname(resolved)
    while (!fs.existsSync(current) && current !== path.dirname(current)) {
      current = path.dirname(current)
    }
    realTarget = fs.existsSync(current) ? fs.realpathSync(current) : current
  }

  const realRoot = fs.existsSync(context.workspaceRoot)
    ? fs.realpathSync(context.workspaceRoot)
    : context.workspaceRoot

  if (!isWithinRoot(realTarget, realRoot)) {
    throw new PathGuardError(`Symlink escapes workspace: ${filePath} → ${realTarget}`)
  }

  return resolved
}
```

**变更范围**：仅 `sandbox/path-guard.ts`，影响 read/write/edit 工具
**工作量**：0.5 天

---

### P1-3 Extension Skill 发现 Bug 修复

#### 问题

`buildAgentEnv()` 把 Extension 的 Skill 目录合并到 `agentEnv.skillPaths`（用于 `<runtime_environment>` 注入），但 `injectEnv()` 的 `scanSkills()` 只传了三个固定路径，不包含 Extension 贡献的 Skill 目录。

```typescript
// AgentEnvInjector.ts — 当前代码
skillManager.scanSkills([
  Env.paths.builtinSkillsDir, // ✅
  Env.paths.userSkillsDir, // ✅
  path.join(workspace, 'skills') // ✅
  // ❌ Extension 贡献的 Skill 目录未包含
])
```

#### 方案

```typescript
// 修复：将 agentEnv.skillPaths 作为 scanSkills 的输入
const agentEnv = await buildAgentEnv(sessionId, workspace)
skillManager.scanSkills(agentEnv.skillPaths) // 已包含 Extension Skill 目录
```

**同时修复 Skill 优先级**：当前 `scanSkills` 先到先得，应改为后到覆盖（高优先级覆盖低优先级）。

**变更范围**：`AgentEnvInjector.ts`（1 行），`SkillManager.ts`（去重策略）
**工作量**：0.5 天

---

## Phase 2: Memory 系统升级

### P2-1 memory 工具接入 LongTermMemoryStore

#### 问题

memory 工具使用文件系统存储 + `string.includes()` 搜索，能力极弱。而 `memory/LongTermMemoryStore.ts` 提供了 SQLite + 类型 + importance + embedding 的完整设计但未被使用。

#### 方案

**分步实施**：

##### Step 1: 双后端适配

```typescript
// memory 工具保持当前接口不变
// 内部根据配置选择后端

class MemoryBackend {
  // 文件后端（当前实现，作为 fallback）
  static file(): MemoryBackend

  // SQLite 后端（新增）
  static sqlite(store: LongTermMemoryStore): MemoryBackend
}
```

##### Step 2: 增强搜索

| 搜索方式       | 优先级 | 说明                              |
| -------------- | ------ | --------------------------------- |
| 关键字（LIKE） | P0     | SQLite LIKE 查询（替代 includes） |
| BM25           | P1     | SQLite FTS5 全文搜索              |
| 向量搜索       | P2     | sqlite-vec 或外部 embedding 服务  |

##### Step 3: 记忆类型化

```typescript
// memory 工具新增 type 参数
parameters: z.object({
  action: z.enum(['list', 'get', 'write', 'search']),
  scope: z.enum(['user', 'agent']).optional(),
  type: z.enum(['semantic', 'episodic', 'procedural', 'preference', 'lesson']).optional(),
  importance: z.number().min(0).max(1).optional()
  // ... 其他参数
})
```

**变更范围**：`tools/builtin/memory.ts`（适配层）、`memory/LongTermMemoryStore.ts`（完善查询）
**工作量**：2-3 天

---

### P2-2 自动记忆提取（agent_end Hook）

#### 问题

LLM 需要主动调用 `memory(write)` 才能存储记忆。大多数情况下 LLM 不会主动这样做。

#### 方案

创建内置 Extension `memory-auto`，在 `agent_end` Hook 中自动提取有价值的信息：

```typescript
// extensions/builtin/memory-auto/index.ts

api.on('agent_end', async (event) => {
  const { sessionId, output, success, durationMs } = event

  // 1. 提取关键信息（简单规则 + 启发式）
  const memories = extractMemories(output, {
    // 错误教训
    extractLessons: !success,
    // 用户偏好（从对话中推断）
    extractPreferences: true,
    // 项目知识
    extractKnowledge: true
  })

  // 2. 写入记忆
  for (const mem of memories) {
    await memoryStore.store(mem)
  }
})
```

**初始版本**：使用规则匹配提取关键信息（不依赖额外 LLM 调用）
**进阶版本**：使用 LLM 自身做记忆提取（需要额外 API 调用成本评估）

**变更范围**：新增内置 Extension
**工作量**：2 天

---

### P2-3 会话启动记忆注入

#### 问题

每次会话开始时 LLM 不会自动获得过往记忆，需要手动调用 `memory(search)`。

#### 方案

在 `before_agent_start` Hook 中注入相关记忆：

```typescript
// extensions/builtin/memory-auto/index.ts

api.on('before_agent_start', async (event) => {
  const { sessionId, prompt } = event

  // 1. 基于用户消息搜索相关记忆
  const relevantMemories = await memoryStore.search({
    query: prompt,
    limit: 5,
    minImportance: 0.3
  })

  if (relevantMemories.length === 0) return {}

  // 2. 格式化为上下文前缀
  const memoryBlock = formatMemoryBlock(relevantMemories)

  return {
    prependContext: memoryBlock
  }
})
```

**输出格式**：

```xml
<relevant_memories>
You have recalled the following from past sessions:
- [preference] User prefers TypeScript with strict mode
- [lesson] exec timeout needs to be > 30s for npm install
- [knowledge] Project uses Tailwind CSS 4 with CSS-based config
</relevant_memories>
```

**变更范围**：同 P2-2 的内置 Extension
**工作量**：1 天（与 P2-2 一起）

---

## Phase 3: 自我进化闭环

### P3-1 评估结果自动存入记忆

#### 问题

self-reflection Skill 指导 LLM 做自我评估，但评估结果存在上下文窗口中，会话结束后丢失。

#### 方案

在 `execution_protocol` 的第 5 步（Report）中提示 LLM 将评估结果写入记忆：

```
5. **Report**
   - Summarize what was accomplished vs. original goals
   - Note any unresolved issues or caveats
   - **If evaluation revealed insights or lessons, save them to memory:**
     · Use `memory(write, 'lessons-learned.md', ...)` for errors and workarounds
     · Use `memory(write, 'preferences.md', ...)` for user preferences discovered
```

这是提示词级别的改动，无需代码变更。配合 P2-2 的自动记忆提取形成双保险。

**变更范围**：`AgentEnvInjector.ts` 中的 `buildExecutionProtocol()`
**工作量**：0.5 天

---

### P3-2 错误模式自动生成 Skill

#### 问题

LLM 反复遇到相同错误时不会积累经验。

#### 方案

在 self-reflection Skill 中增加"Skill 生成"指导：

```markdown
## 第六部分：经验沉淀

### 何时生成 Skill

如果你在执行中发现了以下模式，考虑创建一个 Skill：

1. **反复出现的错误**：同类问题出错 > 2 次
2. **复杂的多步流程**：成功完成了一个 > 5 步的任务
3. **领域特定知识**：发现了项目/框架的特殊约定

### 生成方法

使用 `write` 工具创建 Skill：
```

write({workspace}/skills/{skill-name}/SKILL.md, content)

```

下次执行时 `skill_list` 会自动发现新 Skill。
```

**变更范围**：`skills/self-reflection/SKILL.md`
**工作量**：0.5 天

---

### P3-3 执行协议动态调整

#### 问题

`buildExecutionProtocol()` 返回固定文本，不会根据任务类型或历史表现调整。

#### 方案（中期）

将执行协议从硬编码改为可配置 + 可覆盖：

```typescript
// 1. 执行协议作为内置 Skill（而非硬编码函数）
skills / execution - protocol / SKILL.md

// 2. 用户可通过同名 Skill 覆盖（利用 Skill 优先级机制）
{
  userSkillsDir
}
;/execution-protocol/IKLLS.md // 覆盖内置

// 3. Agent 可自行创建针对特定场景的变体
{
  workspace
}
;/skills/ceeinotux - protocol - code - review / SKILL.md
```

**好处**：

- 用户可以定制执行协议
- Agent 可以根据经验创建更好的协议
- 不同场景可以有不同的协议

**变更范围**：`AgentEnvInjector.ts`、新增 Skill
**工作量**：1 天

---

## Phase 4: 安全与韧性

### P4-1 Extension 沙箱隔离

#### 问题

Extension 代码在主进程中用 `jiti` 直接执行，无任何隔离。恶意 Extension 可执行任意 Node.js 代码。

#### 方案（分步）

| 阶段 | 方案                                              | 工作量 |
| ---- | ------------------------------------------------- | ------ |
| P0   | Extension 来源校验（manifest 哈希 or 签名）       | 1 天   |
| P1   | Extension 在 Worker 线程中运行 + MessagePort 通信 | 3-5 天 |
| P2   | 限制 `require`/`import` 访问范围                  | 2-3 天 |
| P3   | 完整的 `isolated-vm` 沙箱                         | 5+ 天  |

**初始方案（P0）**：

```typescript
// ExtensionLoader.ts — 加载前验证
async function verifyExtension(dir: string): Promise<boolean> {
  const manifest = readManifest(dir)

  // 1. 来源检查：内置 > 用户 > 工作空间
  if (isBuiltinDir(dir)) return true // 内置免检

  // 2. 已知 ID 检查
  if (isTrustedExtension(manifest.id)) return true

  // 3. 用户确认（首次加载时）
  return await promptUserTrust(manifest)
}
```

---

### P4-2 渐进式错误恢复

#### 问题

当前错误处理：超时终止或直接抛异常。缺乏降级和恢复机制。

#### 方案

参考 OpenClaw 的渐进式恢复：

```typescript
// ErrorRecoveryChain

class ErrorRecoveryChain {
  private strategies: RecoveryStrategy[] = [
    // 1. 上下文压缩（context too long 错误）
    new ContextCompressionRecovery(),

    // 2. 工具结果截断（单个工具结果太大）
    new ToolResultTruncationRecovery(),

    // 3. 模型降级（当前模型失败时切换到更稳定的模型）
    new ModelFallbackRecovery(),

    // 4. 思考级别降级（减少 reasoning tokens）
    new ThinkingLevelRecovery(),

    // 5. 重试（临时网络错误）
    new SimpleRetryRecovery({ maxRetries: 2, backoffMs: 1000 })
  ]

  async recover(error: Error, context: ExecutionContext): Promise<RecoveryAction> {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(error)) {
        return await strategy.recover(error, context)
      }
    }
    return { action: 'throw' } // 所有策略都无法处理
  }
}
```

**变更范围**：新增 `runtime/ErrorRecoveryChain.ts`，修改 `AbstractAgentRuntime.ts`
**工作量**：2-3 天

---

### P4-3 工具操作版本追踪

#### 问题

write/edit 工具修改文件后无法回退。如果 LLM 犯错，只能手动恢复。

#### 方案（轻量级）

```typescript
// 在 write/edit 工具执行前，自动备份到 .versions/ 目录

async function backupBeforeWrite(filePath: string, workspaceRoot: string): Promise<void> {
  if (!fs.existsSync(filePath)) return // 新文件无需备份

  const versionsDir = path.join(workspaceRoot, '.versions')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const relativePath = path.relative(workspaceRoot, filePath)
  const backupPath = path.join(versionsDir, `${relativePath}.${timestamp}`)

  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.copyFileSync(filePath, backupPath)
}
```

**变更范围**：`tools/builtin/write.ts`、`tools/builtin/edit.ts`
**工作量**：1 天

---

## 实施时间线

| 阶段    | 周期     | 关键交付物                                          |
| ------- | -------- | --------------------------------------------------- |
| Phase 1 | Week 1-2 | HITL 独立引擎、path-guard 修复、Skill 发现 bug 修复 |
| Phase 2 | Week 3-4 | Memory SQLite 后端、自动记忆提取/注入               |
| Phase 3 | Week 5   | 评估→记忆闭环、错误模式→Skill 生成                  |
| Phase 4 | Week 6-8 | Extension 沙箱、错误恢复链、版本追踪                |

---

## 附录：已完成的改进（来自 02-issues-and-improvement-plan.md）

| 编号 | 任务                            | 状态                                                    |
| ---- | ------------------------------- | ------------------------------------------------------- |
| C-1  | exec 命令白名单 + 黑名单        | ✅ 已完成（exec-policy.ts）                             |
| M-4  | memory 路径校验统一（符号链接） | ✅ 已完成（resolveMemoryPath）                          |
| H-1  | AgentExecutor 拆分              | ✅ 部分完成（EnvInjector、EventWriter、Builder 已提取） |
| M-1  | monitoring/guardrails 死代码    | ✅ 已删除                                               |
| M-6  | ProcessRegistry re-export       | ✅ 已移至 process/                                      |

---

## 附录：Architecture Decision Records

### ADR-001: HITL 实现位置

**决定**：HITL 从 OpenAI SDK `needsApproval` 迁移到工具执行包装器中  
**原因**：SDK 独立性、两个 Runtime 一致性  
**影响**：OpenAI Runtime 不再使用 SDK 的中断/恢复机制  
**风险**：SDK 工具执行超时处理需要验证

### ADR-002: Memory 后端演进

**决定**：memory 工具保持当前接口，内部切换到 LongTermMemoryStore  
**原因**：向后兼容 + 能力增强  
**影响**：需要数据迁移（文件→SQLite）  
**风险**：SQLite 在 Electron 中的 native module 兼容性

### ADR-003: 自我进化策略

**决定**：通过 Skill 和记忆实现自我进化，不通过自动修改代码  
**原因**：安全边界 + 可审计性  
**影响**：LLM 只能创建 Skill 和记忆，不能修改核心逻辑  
**风险**：Skill 和记忆积累后的管理和清理
