# 工作空间 (Workspace)

## 概述

系统为你分配了一个独立工作空间（`<session>` 中的 `workspace`）。

**位置**: `{userHome}/workspaces/{session-id}/`  
**Session ID**: 在 `<session>` 块中提供

---

## 目录结构

```
{workspace}/
├── sessions/                 # 会话持久化数据（系统自动管理）
├── contexts/                 # LLM 请求上下文快照（系统自动写入）
├── events/                   # 流式事件记录（系统自动写入）
├── skills/                   # 你自己生成的 Skill
├── extensions/               # 你自己创建的 Extension
├── output/                   # 你的输出文件（报告、代码、文档等）
├── logs/                     # 运行日志
└── tasks/                    # [多 Agent] 委托任务目录
    └── {taskId}/             # 每个委托任务一个目录
        ├── plan.md           # 任务计划
        ├── status.json       # 任务状态
        ├── agents/           # 子 Agent 工作目录
        ├── results/          # 子 Agent 的汇总结果
        └── experiences/      # 共享执行经验
```

---

## 目录用途

### 系统管理目录（不要修改）

| 目录        | 用途       | 说明                               |
| ----------- | ---------- | ---------------------------------- |
| `sessions/` | 会话持久化 | 系统自动管理                       |
| `contexts/` | 上下文快照 | 系统自动记录 LLM 调用              |
| `events/`   | 事件记录   | 系统自动记录流式事件（JSONL 格式） |

### 你可以操作的目录

| 目录          | 用途         | 说明                               |
| ------------- | ------------ | ---------------------------------- |
| `skills/`     | 自生成 Skill | 创建新 Skill 供后续使用            |
| `extensions/` | 自创建扩展   | 创建新 Extension（会被热加载）     |
| `output/`     | 输出文件     | 生成的代码、报告、文档等           |
| `logs/`       | 运行日志     | 你的执行日志                       |
| `tasks/`      | 委托任务     | 使用 task_plan + delegate_to_agent |

---

## 文件存放规则

### 输出文件

```typescript
// 生成的代码、报告、文档
write('{workspace}/output/report.md', content);
write('{workspace}/output/script.py', content);
```

### 创建 Skill

```typescript
// 新的 Skill
write('{workspace}/skills/my-skill/SKILL.md', content);
```

### 创建 Extension

```typescript
// 新的 Extension
write('{workspace}/extensions/my-ext/extension.json', manifest);
write('{workspace}/extensions/my-ext/index.ts', code);
```

### 临时文件

```typescript
// 临时文件使用系统 temp 目录
write('{paths.temp}/temp-file.txt', content);
```

---

## 多 Agent 委托

当你需要委托子任务给其他 Agent 时，使用 `tasks/` 目录：

```
{workspace}/tasks/{taskId}/
├── plan.md              # task_plan 工具写入的任务计划
├── status.json          # 任务状态（pending/running/completed）
├── agents/              # 子 Agent 工作目录
│   └── {agentId}/       # 每个子 Agent 有完整工作空间
├── results/             # 子 Agent 的汇总结果
└── experiences/         # 共享执行经验
```

---

## 注意事项

1. **不要修改系统目录** - `sessions/`, `contexts/`, `events/` 由系统管理
2. **使用 output/** - 所有输出文件放在 `output/` 目录
3. **路径变量** - 使用 `<paths>` 和 `<session>` 中的路径变量
4. **临时文件** - 使用 `<paths>.temp` 而不是硬编码路径
