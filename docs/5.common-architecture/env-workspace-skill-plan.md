# 环境配置、工作目录与 Skill 目录设计

> 状态：**已实施（Phase 1 + Phase 2）** | 创建日期：2026-02-12 | 更新日期：2026-02-12

---

## 一、背景与目标

`Env`（`src/main/common/env.ts`）是主进程的全局环境配置中心。
本次扩展新增了以下能力：

| 能力               | 说明                                                           |
| ------------------ | -------------------------------------------------------------- |
| **Agent 工作空间** | 每个 Agent/Session 拥有独立的工作目录，按 id 隔离              |
| **Skill 三级目录** | 内置 / 用户 / Agent 自生成三级 Skill 来源，按优先级合并        |
| **记忆目录**       | 用户级与 Agent 级两层记忆存储                                  |
| **配置目录**       | 用户级配置集中存放                                             |
| **环境注入**       | 通过内置 Skill + `<runtime_paths>` 自动让 Agent 感知运行时环境 |

**设计原则**：所有路径从 `userHome` 固定推导，不需要额外的环境变量配置。

---

## 二、目录结构

```
{userHome}/                              # 开发: <项目>/.home | 生产: ~/.coobee-ai
├── config/                              # 用户配置
├── memory/                              # 记忆目录
│   ├── user/                            # 用户级记忆（跨 Agent 共享，如偏好、长期记忆）
│   └── agent/                           # Agent 级记忆（按 Agent 隔离，如经验、学习成果）
├── skills/                              # 用户 Skill（可读写，用户自行安装/编写）
│   ├── my-custom-skill/
│   │   └── SKILL.md
│   └── ...
└── workspaces/                          # Agent 工作空间总根
    ├── {session-id-1}/                  # 按 sessionId 隔离
    │   ├── sessions/                    # 会话持久化
    │   ├── contexts/                    # LLM 请求上下文快照
    │   │   ├── 2026-02-12T10-00-05-123.json
    │   │   └── ...                      # 每次 LLM 调用一个文件，时间戳命名
    │   ├── skills/                      # Agent 自生成的 Skill
    │   ├── output/                      # Agent 输出文件
    │   └── logs/                        # Agent 运行日志
    └── {session-id-2}/
        └── ...

{项目}/skills/                           # 内置 Skill（只读，随应用分发）
├── runtime-env/                         # 运行时环境描述 Skill
│   └── SKILL.md
├── icon-usage/                          # 开发模式：项目根 skills/
│   └── SKILL.md                         # 生产模式：resources/skills
└── ...
```

---

## 三、`Env.paths` 字段

| 字段               | 路径                                               | 说明                          |
| ------------------ | -------------------------------------------------- | ----------------------------- |
| `configDir`        | `{userHome}/config`                                | 用户配置目录                  |
| `memoryDir`        | `{userHome}/memory`                                | 记忆总根目录                  |
| `userMemoryDir`    | `{userHome}/memory/user`                           | 用户级记忆（跨 Agent 共享）   |
| `agentMemoryDir`   | `{userHome}/memory/agent`                          | Agent 级记忆（按 Agent 隔离） |
| `workspacesDir`    | `{userHome}/workspaces`                            | Agent 工作空间总根            |
| `builtinSkillsDir` | 开发: `{项目}/skills` / 生产: `{resources}/skills` | 内置 Skill（只读）            |
| `userSkillsDir`    | `{userHome}/skills`                                | 用户 Skill（可读写）          |

> 无额外环境变量。所有路径从 `userHome` 直接推导。

---

## 四、方法

### 4.1 `getAgentWorkspaceDir(id)`

```typescript
async getAgentWorkspaceDir(id: string): Promise<string>
```

- 传入 sessionId，返回 `{workspacesDir}/{id}`
- 自动创建子目录结构：`sessions/`、`contexts/`、`skills/`、`output/`、`logs/`
- 首次调用时建目录，后续调用直接返回

### 4.2 `getSkillSearchPaths(workspace?)`

```typescript
async getSkillSearchPaths(workspace?: string): Promise<string[]>
```

- 返回 Skill 搜索路径列表，按优先级从低到高：
  1. `builtinSkillsDir` — 内置（最低）
  2. `userSkillsDir` — 用户级
  3. `{workspace}/skills` — Agent 自生成（最高，仅当前 Agent 可见）
- 同时确保所有核心目录存在（userHome、configDir、memory/\*、workspacesDir、userSkillsDir）

---

## 五、Skill 三级来源

| 级别      | 目录                  | 特性                                   |
| --------- | --------------------- | -------------------------------------- |
| **内置**  | `{项目}/skills/`      | 只读，随应用分发                       |
| **用户**  | `{userHome}/skills/`  | 可读写，用户安装/编写                  |
| **Agent** | `{workspace}/skills/` | Agent 运行时生成，生命周期绑定工作空间 |

**合并策略**：同名 Skill 后者覆盖前者。Agent Skill 仅对当前 Agent 可见。

**Skill 目录规范**：每个 Skill 是一个子目录，必须包含 `SKILL.md`：

```
{skill-name}/
├── SKILL.md              # 必须 — 技能描述和指令
├── references/           # 可选 — 参考资料
└── scripts/              # 可选 — 辅助脚本
```

---

## 六、记忆目录

### 6.1 两层结构

| 层级         | 路径            | 说明                                          |
| ------------ | --------------- | --------------------------------------------- |
| **用户级**   | `memory/user/`  | 跨 Agent 共享的长期记忆，如用户偏好、全局经验 |
| **Agent 级** | `memory/agent/` | 按 Agent 隔离的记忆，如特定领域的学习成果     |

### 6.2 与 workspaces 的关系

- `memory/` 与 `workspaces/` 同级，都在 `{userHome}/` 下
- `memory/` 是持久化的知识积累，不随会话结束而清除
- `workspaces/` 是运行时工作空间，可按需清理

---

## 七、环境注入机制（已实施）

### 7.1 设计思路

Agent 需要了解自己的运行时环境才能正确操作文件、发现 Skill 和管理输出。
采用 **Skill + `<runtime_paths>`** 双注入方案：

| 注入方式                 | 内容                                 | 目的               |
| ------------------------ | ------------------------------------ | ------------------ |
| **runtime-env Skill**    | 目录结构说明、Skill 规范、安全边界   | Agent 理解环境全貌 |
| **`<runtime_paths>` 块** | 实际路径值（workspace、userHome 等） | Agent 获取具体路径 |

### 7.2 注入时机

在 `AgentExecutor.execute()` 和 `AgentExecutor.stream()` 中，**构建 Runtime 之前**自动注入：

```
AgentChatApi.chat(message, sessionId)
  → agentExecutor.submit({ sessionId, message, builder })
    → execute(request)
      → injectEnv(sessionId, builder)        ← 环境注入点
        1. Env.getAgentWorkspaceDir(sessionId) → 创建工作空间（含 contexts/）
        2. buildAgentEnv(workspace)            → 构建安全子集
        3. loadRuntimeEnvSkill()               → 加载内置 Skill
        4. builder.skills([envSkill])          → 注入 Skill
        5. builder.appendInstructions(paths)   → 注入 <runtime_paths>
        6. builder.cwd(workspace)              → 设置工作目录
        7. builder.contextDir(contexts)        → 设置快照目录 → 传入 Runtime
      → builder.sessionId(sessionId).build()  → 创建 Runtime
      → runtime.stream(message)
        → LLM 调用完成后 → saveContextSnapshot()  ← Runtime 层写入
```

### 7.3 涉及文件

| 文件                                               | 作用                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `skills/runtime-env/SKILL.md`                      | 内置 Skill，描述环境结构和规范                                                      |
| `src/main/ai/common/AgentEnv.ts`                   | `AgentEnv` 接口、`buildAgentEnv()`、`formatRuntimePaths()`、`loadRuntimeEnvSkill()` |
| `src/main/ai/common/ContextSnapshot.ts`            | `ContextSnapshot` 类型、`saveContextSnapshot()` 写入函数                            |
| `src/main/ai/AgentExecutor.ts`                     | `injectEnv()` 设置 `contextDir`，通过 Builder 传递给 Runtime                        |
| `src/main/ai/runtime/types.ts`                     | `AgentRuntimeOptions.contextDir` 字段                                               |
| `src/main/ai/runtime/AbstractAgentRuntime.ts`      | 模板方法：`stream()` = `doStream()` + 自动 `saveContextSnapshot()`                  |
| `src/main/ai/runtime/openai/OpenAIAgentRuntime.ts` | `extends AbstractAgentRuntime`，实现 `doStream()`                                   |
| `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts` | `extends AbstractAgentRuntime`，实现 `doStream()`                                   |

### 7.4 `AgentEnv` 接口

```typescript
export interface AgentEnv {
  workspace: string // 工作空间根目录
  userHome: string // 用户主目录
  temp: string // 系统临时目录
  platform: string // 操作系统
  isDev: boolean // 是否开发模式
  skillPaths: string[] // Skill 搜索路径
  builtinSkillsDir: string // 内置 Skill 目录
  userSkillsDir: string // 用户 Skill 目录
  memoryDir: string // 记忆目录
}
```

### 7.5 注入到 LLM 的 `<runtime_paths>` 示例

```xml
<runtime_paths>
<workspace>/Users/xxx/.coobee-ai/workspaces/session-123</workspace>
<userHome>/Users/xxx/.coobee-ai</userHome>
<temp>/var/folders/xxx</temp>
<builtinSkillsDir>/path/to/project/skills</builtinSkillsDir>
<userSkillsDir>/Users/xxx/.coobee-ai/skills</userSkillsDir>
<memoryDir>/Users/xxx/.coobee-ai/memory</memoryDir>
<platform>darwin</platform>
<isDev>true</isDev>
<skillPaths>
  <path>/path/to/project/skills</path>
  <path>/Users/xxx/.coobee-ai/skills</path>
  <path>/Users/xxx/.coobee-ai/workspaces/session-123/skills</path>
</skillPaths>
</runtime_paths>
```

---

## 八、Agent 工作空间

### 8.1 概念

每个 Agent 执行时通过 `getAgentWorkspaceDir(sessionId)` 获取隔离的工作空间：

- Agent 可自由读写文件（代码生成、数据处理等）
- 会话数据持久化在 `{workspace}/sessions/`
- LLM 请求上下文快照存放在 `{workspace}/contexts/`
- Agent 自生成的 Skill 存放在 `{workspace}/skills/`
- 输出文件存放在 `{workspace}/output/`
- 运行日志存放在 `{workspace}/logs/`

### 8.2 AgentExecutor 环境注入（已实施）

`AgentExecutor.injectEnv()` 在每次 `execute()` / `stream()` 前自动完成：

```typescript
// 简化后的注入流程
private async injectEnv(sessionId: string, builder: AgentBuilder): Promise<void> {
  const workspace = await Env.getAgentWorkspaceDir(sessionId)
  const agentEnv = await buildAgentEnv(workspace)
  const envSkill = await loadRuntimeEnvSkill(Env.paths.builtinSkillsDir)
  if (envSkill) builder.skills([envSkill])
  builder.appendInstructions(formatRuntimePaths(agentEnv))
  if (builder instanceof PiMonoBuilder) builder.cwd(workspace)
}
```

---

## 九、Agent 进程环境暴露策略

### 9.1 暴露清单

| 类别     | 字段                         | 暴露？ | 理由                     |
| -------- | ---------------------------- | :----: | ------------------------ |
| **路径** | `workspace`（工作目录）      | **是** | Agent 读写文件必需       |
| **路径** | `userHome`                   | **是** | 定位用户级 Skill 和配置  |
| **路径** | `temp`                       | **是** | 临时文件操作             |
| **路径** | `skillPaths`（三级搜索路径） | **是** | 发现 Skill               |
| **路径** | `memoryDir`                  | **是** | 读写记忆                 |
| **路径** | `userData`、`installDir`     | **否** | 应用内部数据             |
| **配置** | `isDev`、`platform`          | **是** | 行为分支、跨平台命令     |
| **配置** | `httpPort`、`wsPort`         | **否** | 服务端口不暴露           |
| **凭据** | API Key 等                   | **否** | 绝对不暴露，由主进程代理 |

### 9.2 安全边界

- 数据库文件、服务端口、API 密钥**不暴露**给 Agent
- Agent 需要这些资源时，通过工具调用向主进程请求
- `runtime-env` Skill 中明确标注了安全边界

---

## 十、后续实施步骤

### Phase 3：Skill 多级发现

| #   | 任务                                                 | 文件              |
| --- | ---------------------------------------------------- | ----------------- |
| 3.1 | `SkillManager` 基于 `getSkillSearchPaths()` 扫描目录 | `SkillManager.ts` |
| 3.2 | 同名覆盖合并逻辑                                     | `SkillManager.ts` |

### Phase 4：记忆系统对接

| #   | 任务                                                        | 文件                     |
| --- | ----------------------------------------------------------- | ------------------------ |
| 4.1 | LongTermMemoryStore 对接 `userMemoryDir` / `agentMemoryDir` | `LongTermMemoryStore.ts` |
| 4.2 | 记忆读写 API                                                | 待定                     |

### Phase 5：测试

| #   | 任务                                       |
| --- | ------------------------------------------ |
| 5.1 | 工作目录创建/解析测试                      |
| 5.2 | Skill 多级发现与合并测试                   |
| 5.3 | 记忆目录读写测试                           |
| 5.4 | AgentEnv 注入 + runtime-env Skill 加载测试 |

---

## 十一、向后兼容

| 场景                       | 处理方式                              |
| -------------------------- | ------------------------------------- |
| 现有 `cwd = process.cwd()` | `injectEnv` 自动设置 `cwd` 为工作空间 |
| 现有 builtin Skill 代码    | 逐步迁移到文件版 `SKILL.md`           |
| 现有 LongTermMemoryStore   | 逐步对接新 memory 目录                |

---

## 十二、变更影响

```
src/main/common/env.ts                           ← 已完成：paths 字段 + getAgentWorkspaceDir（含 contexts/）
src/main/ai/common/AgentEnv.ts                   ← 已完成：AgentEnv 接口 + buildAgentEnv + formatRuntimePaths
src/main/ai/common/ContextSnapshot.ts            ← 已完成：上下文快照类型 + saveContextSnapshot 写入函数
src/main/ai/AgentExecutor.ts                     ← 已完成：injectEnv 设置 contextDir，通过 Builder 传递给 Runtime
src/main/ai/runtime/types.ts                     ← 已完成：AgentRuntimeOptions.contextDir 字段
src/main/ai/runtime/AbstractAgentRuntime.ts      ← 已完成：模板方法 stream() = doStream() + 自动快照
src/main/ai/runtime/openai/OpenAIAgentRuntime.ts ← 已完成：extends AbstractAgentRuntime，实现 doStream()
src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts ← 已完成：extends AbstractAgentRuntime，实现 doStream()
skills/runtime-env/SKILL.md                      ← 已完成：内置运行时环境 Skill（含 contexts/ 说明）
src/main/ai/skills/SkillManager.ts  ← 待实施：多级 Skill 发现
src/main/ai/memory/                 ← 待实施：记忆系统对接新目录
```
