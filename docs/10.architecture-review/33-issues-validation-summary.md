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

| ID     | 描述                                 | 状态   | 证据/位置                                                                         | 后续动作                          |
| ------ | ------------------------------------ | ------ | --------------------------------------------------------------------------------- | --------------------------------- |
| F-P0-1 | GatewayClient WebSocket 监听器泄漏   | 已修复 | `useStreamWs.streamCleanup` + `App.vue onUnmounted` 调用                          | 会话切换/窗口关闭场景回归         |
| F-P0-2 | Copilot onConnect 监听器泄漏         | 已修复 | `copilot.ts` 保存/清理 unregisterConnect，`App.vue` 调用 `copilotStore.cleanup()` | 补充监听泄漏单测（可选）          |
| F-P0-3 | streamCleanup/cleanupThreadWs 未调用 | 已修复 | `App.vue onUnmounted` 调用 `streamCleanup` 与 `cleanupThreadWs`                   | 做关闭/重启场景回归               |
| B-P0-1 | MessagePipeline runId 竞态           | 已修复 | `MessagePipeline.ts` runId 互斥分配 + wrap；新增单测验证                          | 关注高并发回归                    |
| B-P0-2 | pendingApprovalSessions 无 TTL       | 已修复 | `AgentExecutor.ts` Map+TTL 清理（e02d9cd）                                        | 补回归测试覆盖                    |
| M-P0-1 | 前端无 Orchestrator/Swarm 入口       | 已修复 | AgentView 模式选择 + `threadsStore` / `chatStore` 传递 `mode`                     | 补前端端到端用例                  |
| M-P0-2 | 子 Agent 审批无法处理                | 已修复 | AgentEventWriter 转发 + 前端 pendingApproval 携带 subSessionId 并提交到子会话     | 回归：子 Agent 审批通过/拒绝/超时 |
| T-P0-1 | tool-approval Extension 无测试       | 未修复 | Extension 当前不存在，测试亦缺失                                                  | 需补回扩展或调整策略，并补测试    |

---

## P1 级问题现况（摘重要项）

| ID     | 描述                                    | 状态     | 证据/位置                                                  | 后续动作           |
| ------ | --------------------------------------- | -------- | ---------------------------------------------------------- | ------------------ |
| F-P1-1 | Thread 无 workspacePath 卡住            | 未验证   | -                                                          | 补逻辑/弹窗校验    |
| F-P1-2 | Store 状态直接修改                      | 未修复   | `ThreadView.vue` 仍可能直接改 store                        | 封装 action        |
| B-P1-2 | ToolExecutionPipeline Hook 错误处理不足 | 部分修复 | 082f23f 强化 error 日志与 sandbox 失败阻断                 | 补重试/可恢复策略  |
| B-P1-3 | sessionApprovalCounters 永不清理        | 已修复   | `AgentExecutor.ts` session_end 调用 `resetApprovalCounter` | 可加单测验证       |
| B-P1-4 | consumeAndForward abort 检查不及时      | 已修复   | `AgentExecutor.ts` Promise.race 检查 abort，提前返回       | 高并发回归         |
| M-P1-1 | sessionId 命名不统一                    | 未修复   | 文档缺规范                                                 | 编写规范并应用     |
| M-P1-2 | PlanVersionManager 未集成               | 未修复   | Orchestrator 未调用                                        | 评估接入           |
| T-P1-2 | CI/CD 测试缺失                          | 未修复   | 无 CI 工作流                                               | 补 GitHub Actions  |
| T-P1-3 | pre-commit 不跑测试                     | 未修复   | `scripts/pre-commit.mjs`                                   | 增加关键测试       |
| P-P1-2 | 并发控制机制不完善                      | 部分修复 | runId 溢出防护；无全局限流                                 | 设计统一限流       |
| S-P1-1 | ExecPolicy 学习风险                     | 未修复   | exec-policy 无审计                                         | 增加审计与人工确认 |
| O-P1-1 | 日志系统不完整                          | 未修复   | logger 无结构化                                            | 引入结构化日志     |

---

## P2 级问题现况（概览）

多数 P2 项尚未处理，包含：

- 前端 watch 性能、错误 UI 覆盖不足、状态管理一致性
- Backend drainQueue abort 检查、log.error 传字符串
- Multi-Agent Swarm 并发上限、命名文档缺失
- 构建性能/缓存、审批超时处理、监控指标缺失

---

## 优先级行动清单（按紧急度）

1. Orchestrator/Swarm 端到端流：入口+Gateway 单测已补，若需要可再做全链路 e2e。
2. CI 工作流：新增 .github/workflows/ci.yml，待推送触发首跑。
3. tool-approval Extension/测试缺失，需决定恢复或移除相关策略。
4. 中低优先项（构建性能、结构化日志等）后续迭代。

---

## 备注

- 本轮仅做静态验证，未跑端到端功能测试；若需验证 UI/集成，请补充对应用例。
- 参考基线 commit：`e02d9cd`, `082f23f`（已包含于当前 main）。
