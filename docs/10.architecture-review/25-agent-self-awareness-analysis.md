# Agent 自我认知与自我进化能力分析

> 编号：25 | 日期：2026-02-16 | 类型：全维度分析

## 1. 分析目标

coobee-ai 的 Agent 不仅是帮用户完成任务的工具，更应该是一个**具有自我认知和自我进化能力的智能系统**。
本文全面盘点 Agent 当前的 Skill、Tool、Extension 体系，评估"Agent 对自身的了解程度"，
识别盲区，规划改进方向。

核心原则：**透明（Open）、通透（Transparent）、全方位智能**。

---

## 2. 现有体系盘点

### 2.1 Skills（7 个）

| Skill                | 领域                         | 自我认知贡献                |
| -------------------- | ---------------------------- | --------------------------- |
| `execution-protocol` | 执行流程（五步工作法）       | **高** — 定义行为框架       |
| `self-reflection`    | 自我评估与修复方法论         | **高** — 可操作的自评方法   |
| `system-config`      | 配置管理与自我进化指南       | **中** — 知道怎么改配置     |
| `runtime-env`        | 环境认知（目录、路径、资源） | **中** — 知道"我在哪"       |
| `skill-creator`      | 创建新 Skill                 | **低** — 方法论，非自我认知 |
| `extension-creator`  | 创建新 Extension             | **低** — 方法论，非自我认知 |
| `icon-usage`         | 前端图标使用                 | **无** — 纯业务知识         |

### 2.2 Tools（13 个）

| 分类     | 工具                                             | 完整度                        |
| -------- | ------------------------------------------------ | ----------------------------- |
| 文件操作 | read, write, edit, search, glob                  | ★★★★☆ 缺 delete/move/list_dir |
| 执行     | exec, process                                    | ★★★★★                         |
| 记忆     | memory (list/get/write/search)                   | ★★★★★                         |
| 可观测   | session_status, session_history, context_inspect | ★★★★☆ 缺 token 统计           |
| 发现     | skill_list                                       | ★★★☆☆ 仅列出，无增删改        |
| 配置     | config_patch                                     | ★★★☆☆ 能改不能查              |

### 2.3 Extensions（2 个）

| Extension       | 功能                               |
| --------------- | ---------------------------------- |
| `tool-approval` | HITL 工具审批，ExecPolicy 安全策略 |
| `memory-thread` | 自动注入记忆，自动捕获记忆信号     |

### 2.4 Agent 启动时被注入的信息

| 信息块                   | 内容                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `<execution_protocol>`   | 五步工作法（可被 Skill 覆盖）                                |
| `<runtime_environment>`  | 平台、路径、Skill/Extension 目录、已加载 Extension、可用工具 |
| `<skill_discovery>`      | Skill 发现提示                                               |
| Extension prependContext | 由 Extension Hook 动态注入（如 memory-thread 的记忆）        |

---

## 3. 自我认知盲区

### 3.1 安全上下文缺失（严重）

Agent 不知道自己处于哪种沙箱模式（off/path-only/docker），也不知道审批策略（auto/always/never）。
这导致 Agent 无法解释"为什么我不能写这个文件"或"为什么这个命令需要审批"。

**现状**：`runtime_environment` 中没有 `<security>` 块。

### 3.2 模型信息缺失（中等）

Agent 不知道自己用的是什么模型、什么 Provider、推理深度是多少。
无法做成本感知或解释推理行为。

**现状**：模型信息在 chat.ts 中注入 Builder，但未暴露到 `runtime_environment`。

### 3.3 配置只能改不能查（中等）

有 `config_patch` 工具可以修改配置，但没有 `config_get` 工具查看当前配置。
Agent 需要用 `read` 工具读取 coobee.json5 原始文件，不方便且无法看到合并 defaults 后的生效值。

### 3.4 Extension 不可管理（低）

没有工具查看已加载 Extension 的详细信息（能力、Hook、注册的工具等）。
`runtime_environment` 中仅列出 Extension ID。

### 3.5 Skill 发现提示不够智能（低）

`skill_discovery` 只说"你有 N 个 Skill"，没有针对特定场景提示应该加载哪个 Skill。
例如当用户要求修改配置时，应该提示"加载 system-config Skill"。

---

## 4. 改进计划

### P0 — 注入安全与模型上下文

**问题**：Agent 对自身安全设置和模型配置一无所知。
**方案**：在 `formatRuntimePaths()` 中增加 `<security>` 和 `<model>` 块。

```xml
<security>
  <sandboxMode>path-only</sandboxMode>
  <execApproval>auto</execApproval>
</security>
<model>
  <primary>dashscope/qwen3.5-plus</primary>
  <thinkingLevel>medium</thinkingLevel>
</model>
```

**改动**：`AgentEnv.ts` — `AgentEnv` 接口增加字段 + `formatRuntimePaths()` 增加输出。

### P1 — 新增 config_get 工具

**问题**：Agent 需要用 read 工具读原始文件才能查看配置，无法看到合并后的生效值。
**方案**：新增 `config_get` 工具，通过 `ConfigStore.getAll()` 或 `ConfigStore.get(key)` 返回。

**参数**：

- `key`（可选）：指定配置节（如 `security`、`agents`），不传则返回全部。

**分类**：Configuration | 风险：低（只读）

### P2 — 增强 Skill 发现提示

**问题**：`skill_discovery` 太泛化，不够智能。
**方案**：在 `skill_discovery` 中增加场景提示：

```
Special Skills:
- For configuration changes: load "system-config" Skill
- For creating new Skills: load "skill-creator" Skill
- For creating Extensions: load "extension-creator" Skill
- For self-evaluation: load "self-reflection" Skill
```

**改动**：`AgentEnvInjector.ts` — 修改 `skillDiscoveryHint` 生成逻辑。

---

## 5. 自我认知完整度评估

| 维度                             | 当前        | 改进后                                 |
| -------------------------------- | ----------- | -------------------------------------- |
| 路径与目录认知                   | 9/10        | 9/10（已经很好）                       |
| 能力认知（工具/Skill/Extension） | 8/10        | 8/10                                   |
| 安全与权限认知                   | 4/10        | **8/10**（注入安全上下文）             |
| 模型与推理认知                   | 3/10        | **7/10**（注入模型信息）               |
| 配置认知                         | 5/10        | **8/10**（config_get + system-config） |
| 执行流程认知                     | 9/10        | 9/10                                   |
| 历史与可观测性                   | 8/10        | 8/10                                   |
| **综合**                         | **~6.5/10** | **~8.1/10**                            |

---

## 6. 长期愿景

```
Agent 自我进化闭环：

  认知（Skills + runtime_environment）
    ↓
  感知（session_status + context_inspect + config_get）
    ↓
  决策（LLM 推理 + self-reflection）
    ↓
  行动（config_patch + skill_creator + extension_creator）
    ↓
  记忆（memory + memory-thread Extension）
    ↓
  认知（更新 Skills / 创建新 Skill / 修改配置）
```

这是一个完整的**认知-感知-决策-行动-记忆-认知**循环。
当前已经具备了循环的所有节点，本次改进重点是**补强认知层的盲区**。
