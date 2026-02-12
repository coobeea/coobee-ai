# 环境配置、工作目录与 Skill 目录设计

> 状态：**已实施（Phase 1）** | 创建日期：2026-02-12 | 更新日期：2026-02-12

---

## 一、背景与目标

`Env`（`src/main/common/env.ts`）是主进程的全局环境配置中心。
本次扩展新增了以下能力：

| 能力               | 说明                                                    |
| ------------------ | ------------------------------------------------------- |
| **Agent 工作空间** | 每个 Agent/Session 拥有独立的工作目录，按 id 隔离       |
| **Skill 三级目录** | 内置 / 用户 / Agent 自生成三级 Skill 来源，按优先级合并 |
| **记忆目录**       | 用户级与 Agent 级两层记忆存储                           |
| **配置目录**       | 用户级配置集中存放                                      |

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
    │   ├── skills/                      # Agent 自生成的 Skill
    │   ├── output/                      # Agent 输出文件
    │   └── logs/                        # Agent 运行日志
    └── {session-id-2}/
        └── ...

{项目}/skills/                           # 内置 Skill（只读，随应用分发）
├── icon-usage/                          # 开发模式：项目根 skills/
│   └── SKILL.md                         # 生产模式：resources/skills
└── ...
```

---

## 三、`Env.paths` 新增字段

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

## 四、新增方法

### 4.1 `getAgentWorkspaceDir(id)`

```typescript
async getAgentWorkspaceDir(id: string): Promise<string>
```

- 传入 sessionId，返回 `{workspacesDir}/{id}`
- 自动创建子目录结构：`sessions/`、`skills/`、`output/`
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

## 七、Agent 工作空间

### 7.1 概念

每个 Agent 执行时通过 `getAgentWorkspaceDir(sessionId)` 获取隔离的工作空间：

- Agent 可自由读写文件（代码生成、数据处理等）
- 会话数据持久化在 `{workspace}/sessions/`
- Agent 自生成的 Skill 存放在 `{workspace}/skills/`

### 7.2 AgentExecutor 改造

```typescript
// 当前
const cwd = this.options.cwd || process.cwd()

// 改为
const cwd = this.options.cwd || (await Env.getAgentWorkspaceDir(sessionId))
```

---

## 八、Agent 进程环境暴露策略

### 8.1 暴露清单

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

### 8.2 `AgentEnv` 接口

```typescript
export interface AgentEnv {
  workspace: string
  userHome: string
  temp: string
  platform: 'darwin' | 'win32' | 'linux'
  isDev: boolean
  skillPaths: string[]
  memoryDir: string
}
```

---

## 九、后续实施步骤

### Phase 2：Agent 工作目录接入

| #   | 任务                                                       | 文件               |
| --- | ---------------------------------------------------------- | ------------------ |
| 2.1 | `AgentExecutor` cwd 改用 `getAgentWorkspaceDir(sessionId)` | `AgentExecutor.ts` |
| 2.2 | `AgentEnv` 接口定义与注入                                  | 新建 `AgentEnv.ts` |
| 2.3 | Chat API 传递工作目录                                      | `agent.ts`         |

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

| #   | 任务                     |
| --- | ------------------------ |
| 5.1 | 工作目录创建/解析测试    |
| 5.2 | Skill 多级发现与合并测试 |
| 5.3 | 记忆目录读写测试         |

---

## 十、向后兼容

| 场景                       | 处理方式                          |
| -------------------------- | --------------------------------- |
| 现有 `cwd = process.cwd()` | `getAgentWorkspaceDir` 作为新默认 |
| 现有 builtin Skill 代码    | 逐步迁移到文件版 `SKILL.md`       |
| 现有 LongTermMemoryStore   | 逐步对接新 memory 目录            |

---

## 十一、变更影响

```
src/main/common/env.ts              ← 已完成：新增 paths 字段 + getAgentWorkspaceDir + getSkillSearchPaths
src/main/ai/AgentExecutor.ts        ← 待实施：工作目录解析改造
src/main/ai/common/AgentEnv.ts      ← 待实施：Agent 安全环境子集
src/main/ai/skills/SkillManager.ts  ← 待实施：多级 Skill 发现
src/main/ai/memory/                 ← 待实施：记忆系统对接新目录
```
