# Agent 间共享状态约定

多个 Agent 之间通过文件系统传递数据，遵循以下约定。

## 目录结构

```
{workspace}/
├── tasks/                              # 任务目录（由主 Agent 管理）
│   └── {taskId}/                       # 每个委托任务一个目录
│       ├── plan.md                     # 任务计划（task_plan 工具写入，人类可读）
│       ├── status.json                 # 任务状态（task_plan 工具更新，机器可读）
│       ├── agents/                     # 子 Agent 工作目录
│       │   └── {agentId}/             # 每个子 Agent 一个子目录
│       │       ├── sessions/          # 子 Agent 会话数据
│       │       ├── contexts/          # 子 Agent 上下文快照
│       │       ├── events/            # 子 Agent 事件流
│       │       └── output/            # 子 Agent 工作输出
│       ├── results/                    # 子 Agent 的汇总结果
│       │   └── {agentId}.md           # 每个子 Agent 的最终输出
│       └── experiences/                # 共享经验（子 Agent 写入）
│           └── *.md                    # 工具执行经验、环境问题等
└── output/                             # 最终输出
```

### 关键变更说明

- 子 Agent **不再创建**独立的顶级 workspace，而是嵌套在父 workspace 的 `tasks/{taskId}/agents/{agentId}/` 下
- `delegate_to_agent` 工具会自动创建上述目录结构
- `task_plan` 工具会写入 `plan.md`（人类可读）和 `status.json`（机器可读），让任务全过程可追踪
- `results/{agentId}.md` 由 `delegate_to_agent` 工具在子 Agent 完成后自动写入
- `experiences/` 目录用于经验共享（见下文"经验共享"章节）

## 使用流程

### 推荐：带计划的多 Agent 协作

1. **创建计划**：

   ```
   task_plan(action="create", title="批量合同审查", goal="...", steps=[...])
   ```

   → 获得 `taskId`

2. **跟踪进度 & 委托执行**：

   ```
   task_plan(action="update_step", taskId="...", stepId=1, stepStatus="running")
   delegate_to_agent(agentId="contract-reviewer", task="审查合同A", taskId="...")
   task_plan(action="update_step", taskId="...", stepId=1, stepStatus="done")
   ```

3. **完成任务**：
   ```
   task_plan(action="complete", taskId="...", summary="3份合同已审查完毕")
   ```

### 串行委托

1. 主 Agent 将材料写入 `tasks/{taskId}/input.md`
2. 调用 `delegate_to_agent(agentId, task, taskId, context="请读取 tasks/{taskId}/input.md")`
3. 子 Agent 将结果写入 `results/{agentId}.md`（工具自动完成）
4. 主 Agent 读取结果，继续处理

### 链式委托（有依赖）

1. Agent A 输出写入 `tasks/{taskId}/results/agent-a.md`
2. 主 Agent 将 Agent A 的输出路径传给 Agent B：
   `delegate_to_agent(agentB, task, taskId, context="前置结果见 tasks/{taskId}/results/agent-a.md")`
3. Agent B 读取前置结果，执行自己的任务

### 并行委托（无依赖）

LLM 可以一次返回多个 `delegate_to_agent` 调用：

- Agent A 和 Agent B 各自独立执行
- 各自将结果写入 `tasks/{taskId}/results/`
- 主 Agent 读取所有结果进行综合

## 经验共享

### 机制

- 子 Agent 在执行任务中遇到问题时，可将经验写入 `tasks/{taskId}/experiences/` 目录
- 经验文件格式：`{agentId}-{简要描述}.md`
- `delegate_to_agent` 工具在委托下一个子 Agent 时，**自动收集** `experiences/` 下的已有经验文件，作为 context 传递
- 即使子 Agent 执行失败，失败信息也会写入 `results/{agentId}.md`

### 经验内容格式

```markdown
# {问题简述}

## 问题描述

发生了什么问题

## 原因分析

根本原因是什么

## 解决方案

如何解决（如果已解决）

## 建议

对后续 Agent 的建议
```

### 共享范围

- **当前**：同一个 task 内共享（`tasks/{taskId}/experiences/`）
- **未来**：可扩展到 session 级别或全局记忆

## 原则

- **文件是唯一的通信渠道**：Agent 之间不共享内存
- **主 Agent 负责协调**：子 Agent 不知道其他子 Agent 的存在
- **结果要持久化**：所有中间结果写文件，可审计可恢复
- **context 参数传递路径**：不传完整内容，传文件路径
- **经验自动流转**：`delegate_to_agent` 会自动将已有经验传递给后续子 Agent
- **计划可视化**：使用 `task_plan` 工具让用户看到任务全貌和进度
