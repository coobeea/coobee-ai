# AI 模块架构说明

> 最后更新：2026-02-15

## 目录结构

```
src/main/ai/
├── AgentExecutor.ts         # 执行调度层（Builder + 并发控制 + HITL 编排）
├── AgentEnv.ts              # Agent 环境构建（AgentEnv 接口 + formatRuntimePaths）
├── runtime/                 # 运行时层
│   ├── AgentRuntime.ts      # 统一运行时接口
│   ├── types.ts             # 公共类型（StreamChunk, ExecutionResult, SkillDefinition...）
│   ├── pimono/              # PiMono Runtime（pi-coding-agent SDK）
│   └── openai/              # OpenAI Runtime（@openai/agents SDK）
├── tools/                   # 工具系统（SDK 无关）
│   ├── types.ts             # ToolDefinition, ToolCategory
│   ├── registry.ts          # ToolRegistry（工具注册表）
│   └── builtin/             # 10 个内置工具
│       ├── read.ts          # 文件读取
│       ├── write.ts         # 文件写入
│       ├── edit.ts          # 文件编辑
│       ├── exec.ts          # Shell 命令执行（含 ExecPolicy 安全策略）
│       ├── process.ts       # 后台进程管理
│       ├── memory.ts        # 持久化记忆管理
│       ├── session_status.ts   # 会话状态查询
│       ├── session_history.ts  # 对话历史时间线
│       ├── context_inspect.ts  # LLM 上下文快照查看
│       └── skill_list.ts      # 按需 Skill 发现
├── skills/                  # Skill 管理
│   └── SkillManager.ts      # 扫描、加载、注册、查询 Skill
├── sandbox/                 # 沙箱安全层
│   ├── path-guard.ts        # 路径守卫（含 symlink 穿越检查）
│   ├── exec-policy.ts       # 命令安全策略（白名单/黑名单/allowlist 学习）
│   ├── tool-policy.ts       # 工具策略（allow/deny 过滤）
│   ├── docker.ts            # Docker 容器隔离
│   ├── context.ts           # SandboxContext 构建
│   └── types.ts             # 沙箱类型定义
├── process/                 # 后台进程注册表
│   └── ProcessRegistry.ts   # 单例进程管理（MAX=20）
├── hitl/                    # Human-in-the-Loop 审批
│   └── HitlApprovalManager.ts  # Promise 等待 + 超时机制
├── streaming/               # 流式输出
│   ├── StreamEmitter.ts     # 流式消息生产者
│   └── types.ts             # 流式类型定义
├── memory/                  # ⚠️ 设计储备（未接入产品代码）
│   ├── SessionMemoryStore.ts
│   ├── ShortTermMemory.ts
│   ├── WorkingMemoryStore.ts
│   └── LongTermMemoryStore.ts
├── teams/                   # ⚠️ OpenAI SDK 专用（多 Agent Team）
├── orchestration/           # ⚠️ OpenAI SDK 专用（Orchestrator-Worker）
└── swarm/                   # ⚠️ OpenAI SDK 专用（Swarm 编排）
```

---

## 核心执行链路

```
Gateway (chat.ts)
  → agentExecutor.submit({ builder, message, sessionId })
    → AgentExecutor.execute()
      1. injectEnv() — 注入环境 + 执行协议 + Skill 发现提示
      2. Extension hooks — before_agent_start
      3. builder.build() → AgentRuntime
      4. runtime.stream() — HITL 循环编排
      5. Extension hooks — agent_end / session_end
      6. runtime.destroy()
```

---

## 工具系统

工具使用统一 `ToolDefinition` 接口，**SDK 无关**。Runtime 内部自动转换为各 SDK 原生格式。

工具通过 AsyncGenerator 模式执行：

- `yield ToolStreamUpdate` — 增量输出（进度、中间结果）
- `return ToolResult` — 最终结果

审批/HITL 由上层 Runtime 统一处理，工具本身只包含纯执行逻辑。

### 内置工具分类

| 类别     | 工具                                                   | 风险  |
| -------- | ------------------------------------------------------ | ----- |
| 文件操作 | `read`, `write`, `edit`                                | 低/中 |
| 执行     | `exec`, `process`                                      | 高/中 |
| 记忆     | `memory`                                               | 低    |
| 可观测性 | `session_status`, `session_history`, `context_inspect` | 低    |
| 发现     | `skill_list`                                           | 低    |

---

## Skill 系统

Skill 是文件驱动的场景化指导知识（`SKILL.md`），通过按需发现机制加载：

1. Agent 调用 `skill_list` 工具查看可用 Skill
2. Agent 决定使用某个 Skill
3. Agent 调用 `read` 工具读取 SKILL.md
4. Agent 按指令操作

Skill 来源按优先级：内置 → Extension 贡献 → 用户 → Agent 自生成。

---

## 安全层

### 路径守卫（path-guard）

- 所有文件操作路径限制在 workspaceRoot/sandboxRoot 内
- **符号链接穿越检查**：通过 `realpathSync` 解析真实路径
- 防止 `../../../etc/passwd` 类路径穿越攻击

### 命令策略（exec-policy）

- **安全白名单**：`ls`, `git`, `node` 等只读/低风险命令直接放行
- **危险黑名单**：`rm -rf`, `sudo`, `curl|sh` 等始终拒绝
- **动态 allowlist**：从 approve-always 决策中学习命令模式
- 未知命令触发 HITL 审批

### 工具策略（tool-policy）

- 基于 allow/deny 规则过滤工具调用

---

## 运行时实现

| Runtime            | SDK             | 状态 |
| ------------------ | --------------- | ---- |
| PiMonoAgentRuntime | pi-coding-agent | 主力 |
| OpenAIAgentRuntime | @openai/agents  | 支持 |

两个 Runtime 都实现 `AgentRuntime` 接口，支持：

- 流式执行（AsyncGenerator）
- HITL 审批
- 会话持久化（JSONL）
- 上下文压缩
- 上下文快照

---

## 添加新工具

```typescript
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'

export const myTool: ToolDefinition = {
  name: 'my_tool',
  description: '工具描述（给 LLM 看）',
  category: ToolCategory.FileSystem,
  needUserConfirm: false,
  parameters: z.object({
    input: z.string().describe('输入参数')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    yield { type: 'progress', content: 'Processing...' }
    return { success: true, llmContent: 'Done.' }
  }
}
```

然后在 `builtin/index.ts` 中导入并加入 `builtinTools` 数组。
