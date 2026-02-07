# Coobee AI 智能体架构文档

> AI Agent 系统完整设计文档合集
>
> 创建时间：2026-02-04
> 更新时间：2026-02-04

---

## 📚 文档导航

### 阅读顺序（按序号）

| 序号 | 文档                                                                | 描述                                     | 优先级 | 状态      |
| ---- | ------------------------------------------------------------------- | ---------------------------------------- | ------ | --------- |
| 01   | [架构方案对比分析](./01-architecture-analysis.md)                   | 技术选型决策（OpenAI vs 多模型）         | ⭐⭐⭐ | ✅ 已完成 |
| 02   | [智能体架构设计](./02-agent-architecture.md)                        | 核心架构设计（最重要）                   | ⭐⭐⭐ | ✅ 已完成 |
| 03   | [多智能体设计借鉴](./03-multi-agent-learnings.md)                   | Tachikoma 项目精华提炼                   | ⭐⭐   | ✅ 已完成 |
| 04   | [Monorepo 架构](./04-monorepo-architecture.md)                      | 分包管理工程化方案（2 包方案）           | ⭐⭐⭐ | ✅ 已完成 |
| 05   | [纯 Monorepo 架构模式](./05-pure-monorepo-electron-architecture.md) | 纯粹使用 pnpm workspace 的 Electron 架构 | ⭐⭐   | ✅ 已完成 |

---

## 🎯 快速开始

### 第一次阅读（必读）

**如果你是第一次了解本项目的 AI 架构设计，建议按以下顺序阅读**：

#### 1️⃣ 先看技术选型（15 分钟）

📄 [01-architecture-analysis.md](./01-architecture-analysis.md)

**你会了解**：

- 为什么选择统一使用 OpenAI 模式
- 如何与现有 `common/` 架构整合
- AI 模块放在哪里（`src/main/ai/`）
- 核心依赖是什么

**关键决策**：

- ✅ 主推 OpenAI（简化实现，快速迭代）
- ✅ 复用现有 database、IPC、EventBus
- ✅ AI 模块与 common 并列

---

#### 2️⃣ 再看核心架构（1-2 小时）⭐ 最重要

📄 [02-agent-architecture.md](./02-agent-architecture.md)

**你会了解**：

- 完整的模块设计（Runtime / Services / Storage）
- Agent 系统（Triage / Chat / Research / Validator）
- Skills 技能系统
- 多智能体构建系统（Team / Pipeline / Parallel）
- 工具系统与权限控制
- 会话管理
- **长时任务与质量保障系统** ⭐⭐⭐
- 消息推送方案（IPC + DB）
- 实施路线图（18 周）

**核心章节**：

- 第 13 章：长时任务与质量保障系统（断点续传 + 验证机制）
- 第 10 章：工具审批最佳实践（非阻塞权限系统）
- 第 12 章：消息推送方案设计（IPC + DB 双保障）

---

#### 3️⃣ 然后看借鉴设计（30 分钟）

📄 [03-multi-agent-learnings.md](./03-multi-agent-learnings.md)

**你会了解**：

- Tachikoma 项目的成功经验
- 项目类型模板（Greenfield / BugFix / Feature / Refactoring）
- WBS 任务分解 + MECE 原则
- Worker 角色专业化
- 上下文预算管理
- 进度健康度评估
- 风险缓解矩阵

**TOP 5 立即可用的设计**：

1. ⭐⭐⭐ 项目类型模板（Archetypes）
2. ⭐⭐⭐ 上下文预算管理
3. ⭐⭐⭐ 任务分解（WBS + MECE）
4. ⭐⭐ 进度健康度评估
5. ⭐⭐ Worker 角色系统

---

#### 4️⃣ 最后看工程化方案（30 分钟）

📄 [04-monorepo-architecture.md](./04-monorepo-architecture.md)

**你会了解**：

- 为什么需要 monorepo
- 如何拆分包（ai-core / ai-storage / ai-runtime / common / shared-types）
- pnpm workspace 配置
- 迁移路线图（10 天完成）

**关键包划分**：

```
packages/
├── shared-types/      # 共享类型（0 依赖）
├── common/            # 通用工具
├── ai-core/           # AI 核心逻辑（框架无关）⭐
├── ai-storage/        # AI 数据访问
└── ai-runtime/        # Electron 适配层
```

---

## 🗓️ 实施阶段划分

### 阶段 0：准备工作（可选，建议做）

**时间**: 1-2 周  
**文档**: [04-monorepo-architecture.md](./04-monorepo-architecture.md)

**任务**：

- [ ] 创建 monorepo 结构
- [ ] 迁移类型定义到 `@coobee/shared-types`
- [ ] 迁移通用工具到 `@coobee/common`

**产出**：

- ✅ 清晰的包结构
- ✅ 可复用的基础设施

**为什么建议先做**：

- 后续 AI 代码可以直接写在正确的包里
- 避免后期重构成本

---

### 阶段 1：基础框架（核心）

**时间**: Week 1-2  
**文档**: [02-agent-architecture.md](./02-agent-architecture.md) - Phase 1

**任务**：

- [ ] 创建 `src/main/ai/` 目录结构
- [ ] 实现 `AgentRuntimeManager`
- [ ] 实现 `SessionManager`
- [ ] 实现基础 `ChatAgent`
- [ ] 数据库表创建（sessions / messages）
- [ ] 消息存储与推送（IPC + DB）

**产出**：

- ✅ 可以创建 AI 会话
- ✅ 可以发送消息并接收回复
- ✅ 消息持久化

---

### 阶段 2：Skills 与多智能体（增强）

**时间**: Week 3-7  
**文档**: [02-agent-architecture.md](./02-agent-architecture.md) - Phase 2-3

**任务**：

- [ ] 实现 Skills 系统
- [ ] 实现 Triage Agent（分发）
- [ ] 实现 Research Agent
- [ ] 实现多智能体协作模式（Team / Pipeline）

**产出**：

- ✅ Agent 可以调用 Skills
- ✅ Triage 可以智能分发
- ✅ 多个 Agent 协作

---

### 阶段 3：长时任务系统（创新）⭐⭐⭐

**时间**: Week 8-10  
**文档**: [02-agent-architecture.md](./02-agent-architecture.md) - 第 13 章

**任务**：

- [ ] 实现 `TaskExecutor`（任务执行器）
- [ ] 实现 `CheckpointManager`（检查点管理）
- [ ] 实现 `TaskValidator`（验证器）
- [ ] 实现 Validator Agent（AI 验证）
- [ ] 系统重启后自动恢复

**产出**：

- ✅ 支持长时间运行的任务
- ✅ 断点续传
- ✅ 质量验证与自动重试

**为什么重要**：

- 这是你提出的核心需求！
- 解决"微镜头任务中断后继续"的问题
- 解决"任务完成但质量不佳"的问题

---

### 阶段 4：优化增强（借鉴）

**时间**: Week 11-15  
**文档**: [03-multi-agent-learnings.md](./03-multi-agent-learnings.md)

**任务**：

- [ ] 实现项目类型模板（Archetypes）
- [ ] 实现 WBS 任务分解
- [ ] 实现上下文预算管理
- [ ] 实现进度健康度评估
- [ ] 实现 Worker 角色系统

**产出**：

- ✅ 自动识别任务类型并应用最佳实践
- ✅ 结构化任务分解
- ✅ 上下文不会"腐烂"
- ✅ 主动发现问题并调整

---

### 阶段 5：工具系统（完善）

**时间**: Week 8-9  
**文档**: [02-agent-architecture.md](./02-agent-architecture.md) - Phase 4

**任务**：

- [ ] 实现文件工具（读/写/搜索）
- [ ] 实现联网工具（搜索/爬虫）
- [ ] 实现代码工具（执行/分析）
- [ ] 工具权限系统

**产出**：

- ✅ 完整的工具生态
- ✅ 智能权限控制

---

## 📊 核心特性对照表

| 特性            | 文档位置         | 优先级 | 复杂度 | 预计时间      |
| --------------- | ---------------- | ------ | ------ | ------------- |
| **基础会话**    | 02 - Phase 1     | P0     | 中     | Week 1-2      |
| **消息推送**    | 02 - 第 12 章    | P0     | 中     | Week 1-2      |
| **长时任务**    | 02 - 第 13 章    | P0     | 高     | Week 8-10     |
| **任务验证**    | 02 - 第 13 章    | P0     | 高     | Week 8-10     |
| **Skills 系统** | 02 - 第 5 章     | P1     | 中     | Week 3-4      |
| **多智能体**    | 02 - 第 6 章     | P1     | 高     | Week 5-7      |
| **工具权限**    | 02 - 第 10 章    | P1     | 中     | Week 14-15    |
| **项目模板**    | 03 - Section 3.2 | P1     | 低     | Week 11       |
| **任务分解**    | 03 - Section 3.1 | P1     | 中     | Week 11-12    |
| **上下文预算**  | 03 - Section 3.4 | P1     | 中     | Week 12-13    |
| **进度评估**    | 03 - Section 3.5 | P2     | 中     | Week 13-14    |
| **Monorepo**    | 04 - 全文        | P2     | 中     | Week 0 (可选) |

---

## 🎯 你最关心的核心问题

### 问题 1: 长时任务中断后如何恢复？

**答案**: 📄 [02-agent-architecture.md](./02-agent-architecture.md) - 第 13.2 章

**解决方案**：

1. **任务状态机** - 9 种状态（pending / running / interrupted / ...）
2. **检查点机制** - 每完成一步自动保存快照
3. **断点续传** - 系统重启后从 `currentStepIndex` 继续
4. **系统启动时自动恢复** - `AppManager.recoverInterruptedTasks()`

**示例代码**：

```typescript
// 系统启动时
const interruptedTasks = await taskStore.findByStatus([TaskStatus.INTERRUPTED, TaskStatus.PAUSED])

for (const task of interruptedTasks) {
  await taskExecutor.resumeTask(task.id) // 从断点继续
}
```

---

### 问题 2: 如何验证任务真正完成？

**答案**: 📄 [02-agent-architecture.md](./02-agent-architecture.md) - 第 13.3 章

**解决方案**：

1. **多层验证策略**
   - Auto: 基于规则（长度、关键词、格式）
   - Agent: Validator Agent AI 验证（评分 0-100）
   - Human: 人工审核
   - Hybrid: AI 先验证，低分触发人工

2. **智能重试**
   - 验证失败最多重试 3 次
   - 根据反馈自动调整执行策略

3. **验证结果记录**
   - 完整的验证历史
   - 问题追溯
   - 改进建议

**示例代码**：

```typescript
const validationResult = await validator.validateTask(task)

if (!validationResult.passed) {
  // 根据反馈调整任务计划
  await adjustTaskPlan(task, validationResult)
  // 重新执行
  await executeTask(taskId)
}
```

---

### 问题 3: 如何保证不偏离目标？

**答案**: 📄 [03-multi-agent-learnings.md](./03-multi-agent-learnings.md) - Section 2.2

**解决方案**（来自 Tachikoma）：

1. **目标传播** - `parentObjective` 贯穿整个任务链
2. **偏离检测** - 定期检查执行是否偏离计划
3. **健康度评估** - 多维度评分（时间、错误、效率、循环）
4. **自动重规划** - 健康度低于 40 触发重规划

---

## 💡 使用建议

### 场景 1: 我想快速了解整体架构

**建议**:

1. 先看 [01-architecture-analysis.md](./01-architecture-analysis.md) - 技术选型
2. 再看 [02-agent-architecture.md](./02-agent-architecture.md) - 第 1-4 章（架构概览）

**时间**: 30 分钟

---

### 场景 2: 我要开始实施，应该从哪里开始？

**建议**:

1. 如果要做 monorepo（推荐）→ [04-monorepo-architecture.md](./04-monorepo-architecture.md)
2. 如果直接写代码 → [02-agent-architecture.md](./02-agent-architecture.md) - Phase 1

**时间**:

- Monorepo 搭建: 1-2 天
- Phase 1 实现: 1-2 周

---

### 场景 3: 我想了解长时任务和验证系统

**建议**:
直接看 [02-agent-architecture.md](./02-agent-architecture.md) - 第 13 章

**关键内容**:

- 13.2: 长时任务管理系统设计
- 13.3: 任务验证与质量保障系统
- 13.5: 使用示例

**时间**: 45 分钟

---

### 场景 4: 我想借鉴 Tachikoma 的最佳实践

**建议**:
看 [03-multi-agent-learnings.md](./03-multi-agent-learnings.md)

**立即可用的 TOP 5**:

1. 项目类型模板（Section 3.2）
2. 上下文预算管理（Section 3.4）
3. 任务分解 WBS（Section 3.1）
4. 进度健康度评估（Section 3.5）
5. Worker 角色系统（Section 3.3）

**时间**: 1 小时

---

## 📈 文档状态

| 文档                                   | 字数 | 行数 | 状态      | 最后更新   |
| -------------------------------------- | ---- | ---- | --------- | ---------- |
| 01-architecture-analysis               | ~15k | 912  | ✅ 已完成 | 2026-02-04 |
| 02-agent-architecture                  | ~80k | 4055 | ✅ 已完成 | 2026-02-04 |
| 03-multi-agent-learnings               | ~20k | 1028 | ✅ 已完成 | 2026-02-04 |
| 04-monorepo-architecture               | ~18k | 1064 | ✅ 已完成 | 2026-02-04 |
| 05-pure-monorepo-electron-architecture | ~12k | 650  | ✅ 已完成 | 2026-02-04 |

**总计**: ~145k 字，~7709 行

---

## 🔗 相关资源

### 外部参考

- [OpenAI Agents Framework](https://github.com/openai/openai-agents-js)
- [Tachikoma 项目](../../../tachikoma/)
- [Agentic Design Patterns](../../../tachikoma/docs/agentic-design-patterns/)

### 项目相关

- [AGENTS.md](../../AGENTS.md) - 项目规范
- [README.md](../../README.md) - 项目说明

---

## 📝 变更历史

| 版本 | 日期       | 变更                  | 作者 |
| ---- | ---------- | --------------------- | ---- |
| v1.0 | 2026-02-04 | 初始版本，整合4个文档 | -    |

---

## ❓ 常见问题

### Q: 这么多文档，我该从哪里开始？

**A**: 按序号阅读！01 → 02 → 03 → 04

### Q: 我只想实现长时任务，看哪个？

**A**: 直接看 [02-agent-architecture.md](./02-agent-architecture.md) - 第 13 章

### Q: Monorepo 是必须的吗？

**A**: 不是必须，但**强烈推荐**。可以先实现功能，再做 monorepo。

### Q: 实现完整功能需要多久？

**A**:

- 基础功能（会话 + 消息）: 2 周
- 长时任务 + 验证: 4-6 周
- 完整系统: 18-20 周

### Q: 可以跳过某些阶段吗？

**A**: 可以。优先级标记为 P0 的必须做，P1 建议做，P2 可选。

---

**准备好开始了吗？** 🚀

从 [01-architecture-analysis.md](./01-architecture-analysis.md) 开始阅读，然后逐步深入！
