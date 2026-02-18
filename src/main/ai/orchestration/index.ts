/**
 * Orchestration 模块 — 统筹者模式（Orchestrator-Planner-Worker）
 *
 * 核心特性：
 *   - 程序化控制：Orchestrator 是代码逻辑，按计划调度 Agent 执行
 *   - SDK 无关：所有 Worker 和 Planner 通过 AgentRuntime (PiMonoBuilder) 创建
 *   - 任务分解：Planner Agent 将高层目标分解为可执行的 SubTask
 *   - 阶段执行：按 Stage 顺序执行，同 Stage 可并行
 *   - 依赖传递：下游 SubTask 可获取上游结果
 *   - 失败恢复：自动重试 + 可选重新规划
 *
 * 与 Swarm（蜂群模式）的区别：
 *   - Swarm：LLM 自主决定 Handoff，控制权在 LLM
 *   - Orchestrator：程序按 ExecutionPlan 调度，控制权在程序
 *
 * 使用方式：
 *   1. 直接使用 Orchestrator：
 *      const orchestrator = createOrchestrator({ model: 'xxx' })
 *      const result = await orchestrator.executeTask(task)
 *
 *   2. 作为 AgentRuntime 使用（通过 OrchestratorRuntime）：
 *      const runtime = new OrchestratorRuntime({ name: 'My Orchestrator' })
 *      const result = await runtime.run('Complete this complex task')
 */

export * from './types';
export * from './Planner';
export * from './WorkerCoordinator';
export * from './Orchestrator';
export * from './OrchestratorRuntime';
export * from './PlanVersionManager';
export * from './VerificationGate';
export * from './verification-rules';
