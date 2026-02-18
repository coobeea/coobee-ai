# 多 Agent 架构设计

> 本文档定义 Coobee AI 三种多 Agent 协作模式的定位、适用场景和技术实现。
> 后续多 Agent 相关的架构决策应以此文档为参考基线。

## 总览

| 维度           | 工具委托                      | 统筹者                               | 蜂群                          |
| -------------- | ----------------------------- | ------------------------------------ | ----------------------------- |
| **模块**       | `delegate_to_agent` 工具      | `orchestration/`                     | `swarm/`                      |
| **控制权**     | 主 Agent（LLM）               | 程序代码                             | Agent 之间动态流转            |
| **决策者**     | 单个 LLM 自行决定             | 先 Planner（LLM），后程序执行        | 每个 Agent 自主判断           |
| **控制流**     | 不确定（LLM 选择是否委托）    | 确定（按 ExecutionPlan 执行）        | 动态（Handoff 链）            |
| **预先规划**   | 无                            | 有（Planner 分解 → Stage → SubTask） | 无                            |
| **Agent 关系** | 主从（上下级）                | 调度者-执行者                        | 对等（同事协作）              |
| **信息共享**   | 经验文件（文件级）            | 依赖结果传递（SubTask 间）           | 实时共享黑板（SwarmContext）  |
| **适用复杂度** | 低—中                         | 高（结构化任务）                     | 高（探索性任务）              |
| **可预测性**   | 中                            | 高                                   | 低                            |
| **技术基础**   | AgentRuntime（PiMonoBuilder） | AgentRuntime（PiMonoBuilder）        | AgentRuntime（PiMonoBuilder） |
| **产品接入**   | ✅ 已接入                     | 🔧 已重写，待接入                    | 🔧 已重写，待接入             |

## 模式一：工具委托（Delegate）

### 定位

**单 Agent 主导，按需借力。** 适合主 Agent 在执行复杂任务过程中，偶尔需要专业能力协助的场景。

### 架构

```
用户 → 主 Agent（始终持有控制权）
             │
             ├──→ delegate_to_agent("代码专家", "实现登录页面")
             │        └── 子 Agent 执行 → 返回结果
             │
             ├──→ delegate_to_agent("测试专家", "写测试用例")
             │        └── 子 Agent 执行 → 返回结果
             │
             └── 主 Agent 整合结果 → 回复用户
```

### 核心特征

- 主 Agent **自行决定** 何时委托、委托给谁
- 子 Agent 是"高级工具" — 同步调用，执行完返回
- 只支持一层委托（子 Agent 不能再委托）
- 子 Agent 的工作空间嵌套在父 workspace 下
- 经验共享通过文件系统（`experiences/` 目录）

### 适用场景

- 主 Agent 能力足够，偶尔需要专家帮忙
- 任务结构不复杂，不需要预先规划
- "我来主导，你来帮忙" 的模式

### 关键文件

- `src/main/ai/tools/builtin/delegate-to-agent.ts`

---

## 模式二：统筹者（Orchestrator）

### 定位

**程序化编排，计划先行。** 适合可预先分解的复杂任务，由程序按计划调度多个 Agent 协作完成。

### 架构

```
用户 → OrchestratorRuntime（implements AgentRuntime）
             │
             ├── 1. Planner Agent（LLM）分解任务
             │        └── 输出 ExecutionPlan { stages[], subTasks[] }
             │
             ├── 2. Orchestrator（程序代码）按计划执行
             │        │
             │        ├── Stage 1（顺序）
             │        │     └── Worker A（AgentRuntime）
             │        │
             │        ├── Stage 2（并行）
             │        │     ├── Worker B（AgentRuntime）
             │        │     └── Worker C（AgentRuntime）
             │        │
             │        └── Stage 3（顺序，依赖 Stage 2 结果）
             │              └── Worker D（AgentRuntime）
             │
             └── 3. 聚合所有子任务结果 → 返回
```

### 核心特征

- **控制权在程序**（Orchestrator 是代码，不是 LLM）
- 先规划后执行 — Planner Agent 分解任务，之后程序控制执行
- 支持 Stage 分阶段、并行执行、依赖传递
- 失败自动重试，可选重新规划（replan）
- Worker 可以是 AgentStore 中的已有 Agent 定义

### 与工具委托的区别

- 工具委托：LLM 自己决定"我要不要委托" → 不确定
- 统筹者：程序先让 LLM 做计划，然后程序按计划执行 → 确定

### 适用场景

- 复杂的、可预先分解的任务（"写一个完整项目"、"做一次全面代码审计"）
- 需要多步骤、有依赖关系的任务
- 要求可预测性和可控性

### 关键文件

- `src/main/ai/orchestration/Orchestrator.ts` — 程序化控制引擎
- `src/main/ai/orchestration/Planner.ts` — LLM 任务分解
- `src/main/ai/orchestration/WorkerCoordinator.ts` — Worker 管理
- `src/main/ai/orchestration/OrchestratorRuntime.ts` — AgentRuntime 接口实现

---

## 模式三：蜂群（Swarm）

### 定位

**动态自组织，Handoff 驱动。** 适合探索性的、无法预先分解的任务，由多个 Agent 通过 Handoff 自主协作。

### 架构

```
用户 → SwarmRuntime（implements AgentRuntime）
             │
             └── SwarmCoordinator
                    │
                    ├── Triage Agent（分诊入口）
                    │     分析请求 → 决定交给谁
                    │
                    ├──→ Handoff → 代码专家
                    │                  │
                    │                  ├──→ Handoff → 审查专家
                    │                  │                  │
                    │                  │                  └── 审查完毕，返回最终结果
                    │                  │
                    │                  └──→ Handoff → 研究专家
                    │                                    └── 补充信息后交回代码专家
                    │
                    └── 共享黑板（SwarmContext）
                           所有 Agent 可读写
```

### 核心特征

- **控制权在 Agent 之间流转** — 不是工具调用，是真正的控制权转移（Handoff）
- **Triage Agent** 作为分诊入口，分析请求并路由到合适的专家
- **没有预先计划** — Agent 根据当前情况动态决定交接给谁
- **共享黑板** — 所有 Agent 通过 SwarmContext 共享状态和产物
- **消息总线** — Agent 之间可以发送消息（请求帮助、通知进度）
- **Agent 池** — 按角色动态创建、复用、退休 Agent 实例
- **循环检测** — 防止 Agent 之间无限交接

### 与统筹者的区别

- 统筹者：先有计划，然后按计划执行 → 结构化、可预测
- 蜂群：没有计划，Agent 自主决定下一步 → 灵活、探索性

### 与工具委托的区别

- 工具委托：主 Agent 调用子 Agent（上下级，主从关系）
- 蜂群：Agent 之间 Handoff（对等，同事关系）

### 适用场景

- 探索性任务（"调查这个 bug 的根因"、"分析这个需求然后实现"）
- 需要多个专家协作，但无法预先确定协作顺序
- 任务执行过程中可能产生新发现，需要动态调整路由

### 关键文件

- `src/main/ai/swarm/SwarmCoordinator.ts` — 核心协调器
- `src/main/ai/swarm/SwarmRuntime.ts` — AgentRuntime 接口实现
- `src/main/ai/swarm/AgentPool.ts` — 动态 Agent 池
- `src/main/ai/swarm/HandoffRouter.ts` — Handoff 路由
- `src/main/ai/swarm/SwarmContext.ts` — 共享黑板
- `src/main/ai/swarm/MessageBus.ts` — 消息总线
- `src/main/ai/swarm/SwarmMonitor.ts` — 执行监控

---

## 技术约束

### 统一基座

三种模式都基于同一套基础设施：

- **AgentRuntime 接口** — 统一的运行时抽象
- **AgentExecutor** — 统一的执行调度层
- **PiMonoBuilder** — 统一的 Builder 模式创建运行时
- **StreamChunk** — 统一的流式事件协议
- **ToolDefinition** — 统一的工具定义

### SDK 无关

所有模式都通过 AgentRuntime 抽象层工作，**不直接依赖任何特定 LLM SDK**。
Worker/Agent 通过 `AgentExecutor.piMono()` 创建，由 Provider 系统自动适配模型。

### 演进方向

1. **工具委托** — 当前稳定，持续优化（多层委托、更好的上下文传递）
2. **统筹者** — 已重写完成，待接入产品入口
3. **蜂群** — 已重写完成，待接入产品入口
4. **未来** — 三种模式可自动选择（根据任务复杂度、是否可分解等特征）
