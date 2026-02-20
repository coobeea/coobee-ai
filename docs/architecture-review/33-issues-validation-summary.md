# 第三十三轮 — 问题盘点与验证状态

> 编号：33 | 日期：2026-02-20 | 类型：问题验证与状态跟踪
> 方法：基于现有架构评审文档（01-32）+ 当前代码走查（截至 commit 082f23f）
> 目标：汇总历史问题并标注当前状态，明确待办优先级

---

## 状态定义

- **已修复**：代码中已找到对应改动并通过类型检查；未做功能回归。
- **部分修复**：有改动但尚未形成端到端闭环，需补齐/验证。
- **未修复**：未发现代码变更或风险依旧存在。
- **未验证**：本轮未检查，需后续确认。

---

## P0 级问题现况

| ID     | 描述                                 | 状态     | 证据/位置                                              | 后续动作                                    |
| ------ | ------------------------------------ | -------- | ------------------------------------------------------ | ------------------------------------------- |
| F-P0-1 | GatewayClient WebSocket 监听器泄漏   | 未修复   | `useStreamWs.ts` 未见清理调用                          | 在 App 级增加 cleanup 并验证会话切换场景    |
| F-P0-2 | Copilot onConnect 监听器泄漏         | 未修复   | `copilot.ts` 未持久化取消函数                          | 参照建议添加 cleanup                        |
| F-P0-3 | streamCleanup/cleanupThreadWs 未调用 | 未修复   | `App.vue` 无调用                                       | 在根组件 onUnmounted 调用                   |
| B-P0-1 | MessagePipeline runId 竞态           | 部分修复 | `MessagePipeline.ts` 增加溢出重置，但无原子保证        | 补充锁/单线程保证说明与测试                 |
| B-P0-2 | pendingApprovalSessions 无 TTL       | 已修复   | `AgentExecutor.ts` Map+TTL 清理（e02d9cd）             | 补回归测试覆盖                              |
| M-P0-1 | 前端无 Orchestrator/Swarm 入口       | 部分修复 | AgentView 新增模式选择；需确认 chat.send 传递/后端消费 | 验证 mode 贯通并补 UI 流程测试              |
| M-P0-2 | 子 Agent 审批无法处理                | 未修复   | 前端仍仅订阅主 thread                                  | 选择方案并实现（订阅子 session 或后端转发） |
| T-P0-1 | tool-approval Extension 无测试       | 未修复   | 未新增测试目录                                         | 按场景补集成测试                            |

---

## P1 级问题现况（摘重要项）

| ID     | 描述                                    | 状态     | 证据/位置                                                  | 后续动作                  |
| ------ | --------------------------------------- | -------- | ---------------------------------------------------------- | ------------------------- |
| F-P1-1 | Thread 无 workspacePath 卡住            | 未验证   | -                                                          | 补逻辑/弹窗校验           |
| F-P1-2 | Store 状态直接修改                      | 未修复   | `ThreadView.vue` 仍可能直接改 store                        | 封装 action               |
| B-P1-2 | ToolExecutionPipeline Hook 错误处理不足 | 部分修复 | 082f23f 强化 error 日志与 sandbox 失败阻断                 | 补重试/可恢复策略         |
| B-P1-3 | sessionApprovalCounters 永不清理        | 已修复   | `AgentExecutor.ts` session_end 调用 `resetApprovalCounter` | 可加单测验证              |
| B-P1-4 | consumeAndForward abort 检查不及时      | 未修复   | `AgentExecutor.ts` 未改                                    | 引入 Promise.race + abort |
| M-P1-1 | sessionId 命名不统一                    | 未修复   | 文档缺规范                                                 | 编写规范并应用            |
| M-P1-2 | PlanVersionManager 未集成               | 未修复   | Orchestrator 未调用                                        | 评估接入                  |
| T-P1-2 | CI/CD 测试缺失                          | 未修复   | 无 CI 工作流                                               | 补 GitHub Actions         |
| T-P1-3 | pre-commit 不跑测试                     | 未修复   | `scripts/pre-commit.mjs`                                   | 增加关键测试              |
| P-P1-2 | 并发控制机制不完善                      | 部分修复 | runId 溢出防护；无全局限流                                 | 设计统一限流              |
| S-P1-1 | ExecPolicy 学习风险                     | 未修复   | exec-policy 无审计                                         | 增加审计与人工确认        |
| O-P1-1 | 日志系统不完整                          | 未修复   | logger 无结构化                                            | 引入结构化日志            |

---

## P2 级问题现况（概览）

多数 P2 项尚未处理，包含：

- 前端 watch 性能、错误 UI 覆盖不足、状态管理一致性
- Backend drainQueue abort 检查、log.error 传字符串
- Multi-Agent Swarm 并发上限、命名文档缺失
- 构建性能/缓存、审批超时处理、监控指标缺失

---

## 优先级行动清单（按紧急度）

1. 补齐前端资源泄漏 P0（F-P0-1~3）并做快速回归。
2. 验证并贯通 Orchestrator/Swarm 端到端流（前端选择 → chat.send → 后端 runtime）。
3. 解决子 Agent 审批阻塞（选择订阅或转发方案）。
4. 补 tool-approval 关键测试；为新增 TTL/计数器清理补单测。
5. MessagePipeline 竞态加锁或测试验证单线程安全；consume abort 改进。
6. 建立最小 CI（lint+typecheck+核心测试）。

---

## 备注

- 本轮仅做静态验证，未跑端到端功能测试；若需验证 UI/集成，请补充对应用例。
- 参考基线 commit：`e02d9cd`, `082f23f`（已包含于当前 main）。
