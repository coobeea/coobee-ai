# task_plan vs todo_write 对比分析

> **目的**: 分析这两个工具是否重复，是否可以合并或转换为 Skill

---

## 📊 功能对比

| 维度         | task_plan                                  | todo_write                              |
| ------------ | ------------------------------------------ | --------------------------------------- |
| **用途**     | 多 Agent 委托的结构化任务计划              | 单 Agent 自我管理的 TODO 列表           |
| **存储**     | 持久化到磁盘 `tasks/{taskId}/`             | 内存 + 可选持久化到 `.todos/`           |
| **生命周期** | 跨会话，长期保存                           | 会话级，会话结束自动清理                |
| **文件结构** | plan.md + status.json + agents/ + results/ | 单个 JSON 文件                          |
| **操作**     | create, update_step, get, list, complete   | 仅 write（创建/更新）                   |
| **状态**     | pending/running/done/failed                | pending/in_progress/completed/cancelled |
| **关联工具** | delegate_to_agent（传递 taskId）           | 无                                      |
| **适用场景** | 复杂任务，涉及多个子 Agent 协作            | 简单任务，Agent 自己规划执行步骤        |

---

## 🎯 使用场景对比

### task_plan 适合：

**示例 1：多 Agent 协作项目**

```
用户: "帮我开发一个完整的博客系统"

Agent 使用 task_plan:
1. task_plan(create) - 创建总体计划
   - Step 1: 设计数据库 → 委托给 database-designer
   - Step 2: 开发后端 API → 委托给 backend-developer
   - Step 3: 开发前端 UI → 委托给 frontend-developer
   - Step 4: 编写测试 → 委托给 test-engineer

2. delegate_to_agent(agentId="database-designer", taskId="blog-system")
3. task_plan(update_step, stepId=1, status="done")
4. delegate_to_agent(agentId="backend-developer", taskId="blog-system")
...
```

**特点**：

- ✅ 跨会话，任务可能需要数小时/数天
- ✅ 多个子 Agent 参与
- ✅ 需要共享上下文（experiences/, results/）
- ✅ 用户可以查看 `tasks/blog-system/plan.md` 了解进度

---

### todo_write 适合：

**示例 2：单 Agent 自我管理**

```
用户: "帮我重构 auth 模块"

Agent 使用 todo_write:
1. todo_write([
     { id: "analyze", content: "分析现有代码", status: "in_progress" },
     { id: "refactor", content: "重构代码", status: "pending" },
     { id: "test", content: "运行测试", status: "pending" }
   ])

2. 完成分析后:
   todo_write([
     { id: "analyze", status: "completed" },
     { id: "refactor", status: "in_progress" }
   ], merge=true)

3. 完成重构后:
   todo_write([
     { id: "refactor", status: "completed" },
     { id: "test", status: "in_progress" }
   ], merge=true)
```

**特点**：

- ✅ 单会话内完成
- ✅ 单个 Agent 自己执行
- ✅ 轻量快速，内存级
- ✅ 向用户展示进度

---

## 🤔 是否重复？

### 重叠部分

- 都用于任务规划和进度追踪
- 都有状态管理（pending/in_progress/done）
- 都可以更新状态

### 核心差异

| 维度         | task_plan            | todo_write       |
| ------------ | -------------------- | ---------------- |
| **作用域**   | 跨会话、跨 Agent     | 单会话、单 Agent |
| **复杂度**   | 结构化计划（目录树） | 简单列表         |
| **协作**     | 多 Agent 协作        | Agent 自我管理   |
| **持久化**   | 必须持久化           | 可选持久化       |
| **关联工具** | delegate_to_agent    | 无               |

### 结论

**不完全重复，但有重叠** ⚠️

- **场景分离明确**：一个管多 Agent 协作，一个管单 Agent 自用
- **但实现上有冗余**：状态管理逻辑类似

---

## 💡 优化建议

### 方案 1：保留两个工具 ⚠️

**优点**：

- 各自职责明确
- 使用简单

**缺点**：

- 工具数量多（17 个）
- 概念重叠，Agent 可能困惑何时用哪个

---

### 方案 2：删除 task_plan，用 todo_write + Skill 替代 ✅ 推荐

**思路**：

1. **保留 todo_write**（单 Agent 自我管理）
2. **删除 task_plan**（多 Agent 协作场景用 Skill 指导）
3. **创建 `multi-agent-collaboration` Skill**：
   - 描述如何用 todo_write + delegate_to_agent + write/read 工具组合
   - 完成多 Agent 协作任务的规划和追踪

**实现方式**：

```typescript
// 原来的 task_plan(create)
task_plan({
  action: "create",
  taskId: "blog-system",
  title: "博客系统开发",
  steps: [...]
})

// 转换为工具组合：
// 1. 创建任务目录和计划文档
exec({ command: 'mkdir -p tasks/blog-system/{agents,results,experiences}' });
write({
  path: 'tasks/blog-system/plan.md',
  content: '# 博客系统开发\n\n## 目标\n...\n\n## 步骤\n...'
});
write({
  path: 'tasks/blog-system/status.json',
  content: JSON.stringify({ taskId: "blog-system", steps: [...] })
});

// 2. 使用 todo_write 追踪进度
todo_write([
  { id: "step-1-database", content: "设计数据库", status: "pending" },
  { id: "step-2-backend", content: "开发后端", status: "pending" }
]);

// 3. 委托子任务
delegate_to_agent({
  agentId: "database-designer",
  task: "设计博客系统数据库",
  context: { taskId: "blog-system", stepId: 1 }
});

// 4. 更新状态
todo_write([
  { id: "step-1-database", status: "completed" }
], merge=true);

// 5. 写入结果
write({
  path: 'tasks/blog-system/results/step-1-database.md',
  content: '...'
});
```

**优势**：

- ✅ 工具数量：17 → 16（再减 1 个）
- ✅ 职责更清晰：todo_write 专注于进度追踪
- ✅ 灵活性更高：Agent 可自定义目录结构
- ✅ 上下文占用减少

**劣势**：

- ⚠️ 需要 Agent 调用多次工具（但有 Skill 指导）
- ⚠️ 状态管理需要 Agent 手动维护 JSON

---

### 方案 3：合并为统一的 plan 工具 ❌ 不推荐

**思路**：合并两个工具为一个 `plan` 工具，支持 session 级和 task 级

**缺点**：

- ❌ 工具接口复杂化（参数更多）
- ❌ 违反单一职责原则
- ❌ 反而增加上下文占用

---

## 🎯 推荐方案

**删除 task_plan，创建 `multi-agent-collaboration` Skill**

**理由**：

1. **使用频率低**：多 Agent 协作任务相对少见
2. **可用工具组合替代**：
   - 目录管理：`exec` (mkdir)
   - 文件管理：`write` (plan.md, status.json)
   - 进度追踪：`todo_write`
   - Agent 委托：`delegate_to_agent`
3. **符合优化原则**：复杂流程用 Skill，工具保持原子性
4. **上下文优化**：再节省 ~500 token

---

## 📈 优化效果预测

| 指标       | 当前（方案 2） | 删除 task_plan 后 | 改善  |
| ---------- | -------------- | ----------------- | ----- |
| 工具数量   | 17             | **16**            | -5.9% |
| 上下文占用 | ~2400 token    | **~1900 token**   | -500  |
| Agent 管理 | 1 个工具       | 1 个工具          | -     |
| 任务管理   | 2 个工具       | **1 个工具**      | -50%  |

---

## ✅ 实施建议

1. **立即实施**：删除 task_plan，创建 multi-agent-collaboration Skill
2. **观察效果**：监控 Agent 是否能用 Skill + 工具组合完成多 Agent 协作
3. **如有问题**：可以恢复 task_plan 或调整 Skill

**风险**：低（task_plan 使用频率不高，即使需要也可以快速恢复）

---

**你觉得这个分析如何？要删除 task_plan 吗？** 🤔
