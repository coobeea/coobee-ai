# 阶段 1-3 实施执行计划

**创建时间**: 2026-02-24  
**执行范围**: Quick Wins + 核心功能 + 架构优化  
**状态**: ✅ 已确认执行（阶段 4 暂缓）  
**分支**: 新分支（独立开发，不影响主分支）

---

## 📊 执行决策

### ✅ 执行任务（阶段 1-3）

| 阶段     | 任务数 | 工作量       | 状态    |
| -------- | ------ | ------------ | ------- |
| 阶段 1   | 5 个   | 5-8 天       | ✅ 执行 |
| 阶段 2   | 1 个   | 3-5 天       | ✅ 执行 |
| 阶段 3   | 4 个   | 15-20 天     | ✅ 执行 |
| **总计** | **10** | **23-33 天** | -       |

### ❌ 暂缓任务（阶段 4）

| 阶段   | 任务       | 状态    | 原因                      |
| ------ | ---------- | ------- | ------------------------- |
| 阶段 4 | 全自主系统 | ⏸️ 暂缓 | 等待阶段 1-3 验证后再决策 |

**暂缓理由**:

- 🔴 复杂度极高（7-12 周，37K 行代码）
- 🔴 架构影响巨大（全新系统）
- ⚠️ 需求需要进一步验证
- ✅ 先完成阶段 1-3，验证效果后再评估是否启动

---

## 🎯 执行策略

### 核心原则

```
1. 渐进式实施
   → 每个任务独立完成并验证
   → 不一次性改动太多

2. 测试驱动
   → 每个任务都要有测试
   → 覆盖率 > 80%

3. 快速迭代
   → 2-3 天一个小版本
   → 及时发现和修复问题

4. 灰度发布
   → 在新分支上开发
   → 充分测试后再合并主分支
```

### 分支策略

```
当前分支: [新分支名称]
主分支: main

工作流:
  新分支 → 开发 → 测试 → Code Review → 合并到 main

优势:
  ✅ 主分支不受影响（稳定）
  ✅ 可以大胆实验
  ✅ 出问题可以随时回滚
```

---

## 📋 详细实施计划

### Week 1-2: 阶段 1 - Quick Wins（5 个任务）⚡

**目标**: 快速见效，立即提升系统质量

#### 任务 1.1: 多 Agent 质量闭环 🔥（P0，2-3 天）

**优先级**: 🔴 最高

**目标**: Swarm/Orchestrator 模式增加质量保证机制

**实施步骤**:

```bash
# Day 1: 核心类实现（4-6 小时）

# 1. 创建目录结构
mkdir -p src/main/ai/quality-loop

# 2. 实现 Aggregator（汇总器）
touch src/main/ai/quality-loop/Aggregator.ts
# → 功能：将多个子 Agent 的输出汇总为统一结果

# 3. 实现 Validator（验证器）
touch src/main/ai/quality-loop/Validator.ts
# → 功能：对照验收标准评估质量

# 4. 实现 Repairer（修复器）
touch src/main/ai/quality-loop/Repairer.ts
# → 功能：根据评估结果生成修复计划

# Day 2: 集成到 Runtime（4-6 小时）

# 5. 修改 SwarmRuntime
# → src/main/ai/swarm/SwarmRuntime.ts
# → 添加质量闭环逻辑

# 6. 修改 OrchestratorRuntime
# → src/main/ai/orchestration/OrchestratorRuntime.ts
# → 添加质量闭环逻辑

# Day 3: 测试与优化（4-6 小时）

# 7. 单元测试
mkdir -p src/main/ai/quality-loop/__tests__
touch src/main/ai/quality-loop/__tests__/quality-loop.test.ts

# 8. 集成测试（创建测试 Agent，验证质量闭环）

# 9. 提交
git add src/main/ai/quality-loop/
git commit -m "feat(quality): add multi-agent quality assurance loop"
```

**验收标准**:

- [ ] Aggregator 能正确汇总多个 Agent 输出
- [ ] Validator 能根据标准评估质量（打分）
- [ ] Repairer 能生成修复建议
- [ ] 集成到 Swarm/Orchestrator，自动触发
- [ ] 测试覆盖率 > 80%

**参考文档**: [`06-multi-agent-quality-loop.md`](./06-multi-agent-quality-loop.md)

---

#### 任务 1.2: Workbench 多模态预览 🖼️（P0，2-3 天）

**优先级**: 🔴 最高

**目标**: WorkbenchPanel 支持多种文件类型的原生预览

**实施步骤**:

```bash
# Day 1: 前端组件实现（6-8 小时）

# 1. 创建 preview 组件目录
mkdir -p src/renderer/src/components/agent/preview

# 2. 实现各类 Viewer 组件
touch src/renderer/src/components/agent/preview/PDFViewer.vue
touch src/renderer/src/components/agent/preview/ImageViewer.vue
touch src/renderer/src/components/agent/preview/VideoPlayer.vue
touch src/renderer/src/components/agent/preview/HTMLPreview.vue
touch src/renderer/src/components/agent/preview/MarkdownPreview.vue

# 3. 创建 PreviewRouter（根据文件类型选择 Viewer）
touch src/renderer/src/utils/previewRouter.ts

# Day 2: 集成到 WorkbenchPanel（4-6 小时）

# 4. 修改 WorkbenchPanel.vue
# → 动态加载 Viewer 组件
# → 保留 Monaco Editor 用于代码文件

# 5. 安装依赖
pnpm add pdfjs-dist marked highlight.js

# Day 3: 测试与优化（2-4 小时）

# 6. 测试各类文件预览
# 7. 性能优化（懒加载大文件）
# 8. 提交
git add src/renderer/src/components/agent/preview/
git commit -m "feat(workbench): add multi-modal file preview"
```

**验收标准**:

- [ ] PDF 文件能正确显示（使用 PDF.js）
- [ ] 图片文件能正确显示（支持 zoom）
- [ ] 视频文件能正确播放
- [ ] HTML 文件能渲染（iframe 隔离）
- [ ] Markdown 文件能渲染（带高亮）
- [ ] 代码文件仍用 Monaco Editor
- [ ] 切换文件类型流畅（无卡顿）

**参考文档**: [`07-workbench-multimodal-preview.md`](./07-workbench-multimodal-preview.md)

---

#### 任务 1.3: 模型组与自动选择 🎲（P1，3-5 天）

**优先级**: 🟡 高

**目标**: Agent 支持模型组，自动选择和负载均衡

**实施步骤**:

```bash
# Day 1: 配置层实现（4-6 小时）

# 1. 扩展 coobee.json5 配置
# → 添加 modelGroups 配置

# 2. 扩展 AgentDefinition 类型
# → model 字段支持 @group-name 和 auto

# 3. 更新 ConfigStore
# → 读取和验证 modelGroups 配置

# Day 2-3: 核心逻辑实现（8-12 小时）

# 4. 创建 ModelGroupResolver
mkdir -p src/main/ai/provider
touch src/main/ai/provider/ModelGroupResolver.ts
# → 实现负载均衡算法（round-robin/random/weighted/quota-aware）

# 5. 修改 ModelSelector
# → 添加 resolveModelGroup 逻辑

# 6. 修改 AgentExecutor
# → 集成 ModelGroupResolver

# Day 4: 前端 UI（4-6 小时）

# 7. 修改 Agent 创建/编辑表单
# → 添加"模型组"选项

# 8. 添加模型组管理界面（可选）

# Day 5: 测试与优化（2-4 小时）

# 9. 单元测试（各种负载均衡策略）
# 10. 集成测试（Agent 使用模型组）
# 11. 提交
git add src/main/ai/provider/ModelGroupResolver.ts
git commit -m "feat(model): add model groups and auto-selection"
```

**验收标准**:

- [ ] 配置文件支持 modelGroups 定义
- [ ] Agent 可以选择 @group-name 或 auto
- [ ] 支持 4 种负载均衡策略（顺序/随机/加权/配额感知）
- [ ] 模型故障时自动 fallback
- [ ] 前端 UI 支持模型组选择
- [ ] 测试覆盖率 > 80%

**参考文档**: [`11-model-group-design.md`](./11-model-group-design.md)

---

#### 任务 1.4: 定时任务调度器 ⏰（P1，1-2 天）

**优先级**: 🟡 高

**目标**: Cron Job 能自动执行（现在只有 UI 和存储）

**实施步骤**:

```bash
# Day 1: 后端调度器实现（4-6 小时）

# 1. 安装 node-cron
pnpm add node-cron
pnpm add -D @types/node-cron

# 2. 创建 CronScheduler
mkdir -p src/main/worker/cron
touch src/main/worker/cron/CronScheduler.ts
# → 使用 node-cron 调度任务

# 3. 创建 CronJobExecutor
touch src/main/worker/cron/CronJobExecutor.ts
# → 执行定时任务（调用 Agent）

# 4. 集成到 Worker 系统
# → src/main/worker/WorkerManager.ts
# → 启动时加载所有 Cron Job

# Day 2: 测试与优化（2-4 小时）

# 5. 单元测试（调度逻辑）
# 6. 集成测试（创建定时任务，验证执行）
# 7. 前端添加"执行历史"显示
# 8. 提交
git add src/main/worker/cron/
git commit -m "feat(cron): add scheduler for automated task execution"
```

**验收标准**:

- [ ] Cron Job 能按时执行
- [ ] 支持暂停/恢复
- [ ] 执行历史有记录
- [ ] 执行失败有日志
- [ ] 前端能查看执行状态
- [ ] 测试覆盖率 > 80%

**参考文档**: 本次会话（Cron Job 模块）

---

#### 任务 1.5: Brain Skill 使用监控 🧠（P1，1 天）

**优先级**: 🟡 高

**目标**: 监控 Brain Skill 的使用情况

**实施步骤**:

```bash
# Day 1: 监控实现（4-6 小时）

# 1. 修改 Brain Worker
# → src/main/worker/brain/BrainWorker.ts
# → 记录每次 search/publish 操作

# 2. 创建 BrainMetrics 存储
mkdir -p src/main/metrics
touch src/main/metrics/BrainMetrics.ts
# → 存储统计数据（搜索次数、发布次数、命中率）

# 3. 前端监控面板
touch src/renderer/src/views/BrainMonitorView.vue
# → 显示统计图表

# 4. 测试与提交
git add src/main/metrics/BrainMetrics.ts
git commit -m "feat(brain): add usage monitoring and metrics"
```

**验收标准**:

- [ ] 能统计 Brain Search 次数
- [ ] 能统计 Brain Publish 次数
- [ ] 能显示命中率（搜到 / 总搜索）
- [ ] 前端有可视化面板
- [ ] 数据持久化（不丢失）

**参考文档**: [`04-brain-skill-auto-integration.md`](./04-brain-skill-auto-integration.md)

---

### Week 3-4: 阶段 2 - 核心功能（1 个任务）📊

**目标**: 增强系统可观测性

#### 任务 2.1: 系统可观测性 UI 👀（P1，3-5 天）

**优先级**: 🟡 高

**目标**: 创建统一的可观测性仪表盘

**实施步骤**:

```bash
# Day 1-2: 后端指标收集（6-8 小时）

# 1. 创建 MetricsCollector
mkdir -p src/main/metrics
touch src/main/metrics/MetricsCollector.ts
# → 收集系统指标（Token、请求数、错误率、响应时间）

# 2. 修改 Runtime 层
# → 添加指标收集钩子

# 3. 创建 /api/metrics 接口
touch src/main/gateway/http/metrics.ts

# Day 3-4: 前端面板实现（8-12 小时）

# 4. 创建 ObservabilityView
mkdir -p src/renderer/src/views/observability
touch src/renderer/src/views/observability/ObservabilityView.vue

# 5. 创建子面板
touch src/renderer/src/views/observability/TokenUsagePanel.vue
touch src/renderer/src/views/observability/CompressionPanel.vue
touch src/renderer/src/views/observability/MemoryPanel.vue
touch src/renderer/src/views/observability/ErrorPanel.vue

# 6. 图表库集成
pnpm add chart.js vue-chartjs

# Day 5: 测试与优化（2-4 小时）

# 7. 测试指标准确性
# 8. 性能优化（虚拟滚动、懒加载）
# 9. 提交
git add src/main/metrics/
git add src/renderer/src/views/observability/
git commit -m "feat(observability): add system metrics dashboard"
```

**验收标准**:

- [ ] Token 使用统计准确
- [ ] 对话压缩事件可见
- [ ] Memory 工具使用情况可查
- [ ] 错误日志有聚合分析
- [ ] 图表实时更新（WebSocket）
- [ ] 历史数据可查询（7 天）

**参考文档**:

- [`01-system-observability.md`](./01-system-observability.md)
- [`03-compression-monitoring-design.md`](./03-compression-monitoring-design.md)

---

### Week 5-8: 阶段 3 - 架构优化（4 个任务）🏗️

**目标**: 偿还技术债务，提升代码质量

⚠️ **注意**: 此阶段涉及结构性重构，需要分阶段、小步快跑

#### 任务 3.1: 统一错误处理 🚨（P1，2-3 天）

**优先级**: 🟡 高

**目标**: 建立统一的错误处理体系

**实施步骤**:

```bash
# Day 1: 错误码体系（4-6 小时）

# 1. 定义错误码
mkdir -p src/shared/errors
touch src/shared/errors/ErrorCodes.ts
# → 定义错误码枚举（E001-E999）

# 2. 定义 AppError 类
touch src/shared/errors/AppError.ts
# → 统一错误对象格式

# Day 2: 统一错误处理器（4-6 小时）

# 3. 创建 ErrorHandler
mkdir -p src/main/common/errors
touch src/main/common/errors/ErrorHandler.ts
# → 统一错误处理逻辑

# 4. 创建前端错误处理
mkdir -p src/renderer/src/utils/errors
touch src/renderer/src/utils/errors/ErrorHandler.ts

# Day 3: 集成与迁移（4-6 小时）

# 5. 逐步替换旧的错误处理
# → 从核心模块开始（AgentExecutor, Runtime）

# 6. 测试与提交
git add src/shared/errors/
git commit -m "feat(error): add unified error handling system"
```

**验收标准**:

- [ ] 错误码体系完整
- [ ] 错误信息统一格式
- [ ] 前端能友好展示错误
- [ ] 错误日志有追踪 ID
- [ ] 核心模块已迁移

**参考文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 8

---

#### 任务 3.2: Gateway 通信协议统一 🌐（P2，3-5 天）

**优先级**: 🟢 中

**目标**: 统一 Gateway 的三种通信方式

**实施步骤**:

```bash
# Day 1-2: 设计统一协议（6-8 小时）

# 1. 定义统一接口
mkdir -p src/main/gateway/unified
touch src/main/gateway/unified/UnifiedGateway.ts
# → 统一 RPC + Event + REST

# 2. 实现适配层
touch src/main/gateway/unified/MethodAdapter.ts
touch src/main/gateway/unified/EventAdapter.ts
touch src/main/gateway/unified/HttpAdapter.ts

# Day 3-4: 渐进式迁移（8-12 小时）

# 3. 新旧协议并存（兼容期）
# 4. 逐步迁移现有调用（先内部，后外部）

# Day 5: 测试与提交（4-6 小时）

# 5. 全量回归测试
# 6. 提交
git add src/main/gateway/unified/
git commit -m "refactor(gateway): unify communication protocols"
```

**验收标准**:

- [ ] 三种协议统一接口
- [ ] 新旧协议并存（兼容）
- [ ] 核心模块已迁移
- [ ] 性能无退化
- [ ] 所有测试通过

**参考文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 2

---

#### 任务 3.3: 前端状态管理重构 🎨（P2，5-7 天）

**优先级**: 🟢 中

**目标**: 重构前端 Store，减少碎片化

**实施步骤**:

```bash
# Day 1-2: 设计新 Store 架构（6-8 小时）

# 1. 定义 CoreStore（核心状态）
mkdir -p src/renderer/src/stores/core
touch src/renderer/src/stores/core/CoreStore.ts
# → 管理 Agent/Thread/Config 等核心状态

# 2. 定义 ModuleStore（模块状态）
mkdir -p src/renderer/src/stores/modules
touch src/renderer/src/stores/modules/WorkspaceStore.ts
touch src/renderer/src/stores/modules/SkillStore.ts

# Day 3-5: 渐进式迁移（12-18 小时）

# 3. 新旧 Store 并存（兼容期）
# 4. 逐步迁移组件（先简单，后复杂）
# 5. 迁移顺序：
#    → WorkbenchPanel
#    → ProjectPanel
#    → ChatPanel
#    → ThreadView

# Day 6-7: 测试与清理（6-8 小时）

# 6. 全量测试
# 7. 删除旧 Store（确认无依赖后）
# 8. 提交
git add src/renderer/src/stores/core/
git commit -m "refactor(frontend): restructure state management"
```

**验收标准**:

- [ ] Store 数量减少（10+ → 5 个）
- [ ] 依赖关系清晰
- [ ] 性能无退化（渲染次数不增加）
- [ ] 所有组件已迁移
- [ ] 所有测试通过

**参考文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 3

---

#### 任务 3.4: Runtime 层职责拆分 🔧（P2，5-7 天）

**优先级**: 🟢 中（最复杂，最后实施）

**目标**: 将 OpenAIAgentRuntime 拆分为多个独立 Service

**实施步骤**:

```bash
# Day 1-2: 创建独立 Service（8-12 小时）

# 1. 创建 Service 目录
mkdir -p src/main/ai/runtime/services

# 2. 拆分 LLMService
touch src/main/ai/runtime/services/LLMService.ts
# → LLM 对接和调用

# 3. 拆分 SessionService
touch src/main/ai/runtime/services/SessionService.ts
# → 会话管理和持久化

# 4. 拆分 ToolAdapterService
touch src/main/ai/runtime/services/ToolAdapterService.ts
# → 工具适配和调用

# 5. 拆分 StreamService
touch src/main/ai/runtime/services/StreamService.ts
# → 流式输出处理

# 6. 拆分 CompressionService
touch src/main/ai/runtime/services/CompressionService.ts
# → 对话压缩

# Day 3-5: 渐进式拆分（12-18 小时）

# 7. 修改 OpenAIAgentRuntime
# → 逐步委托给 Service（每次拆分一个）
# → 先拆 CompressionService（最独立）
# → 再拆 StreamService
# → 再拆 ToolAdapterService
# → 最后拆 LLMService 和 SessionService

# Day 6-7: 测试与优化（6-8 小时）

# 8. 每次拆分后立即测试
# 9. 全量回归测试
# 10. 性能测试（确保无退化）
# 11. 提交
git add src/main/ai/runtime/services/
git commit -m "refactor(runtime): split responsibilities into services"
```

**验收标准**:

- [ ] Runtime 代码减少 60%+（3000 → 1200 行）
- [ ] 每个 Service 职责单一
- [ ] 所有测试通过
- [ ] 性能无退化
- [ ] 代码更易维护

**参考文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 1

---

## 📊 进度跟踪

### 任务看板

| 阶段       | 任务                 | 优先级 | 工作量       | 状态      |
| ---------- | -------------------- | ------ | ------------ | --------- |
| **阶段 1** | **Quick Wins**       |        | **5-8 天**   |           |
| 1.1        | 多 Agent 质量闭环    | P0     | 2-3 天       | ⏳ 待开始 |
| 1.2        | Workbench 多模态预览 | P0     | 2-3 天       | ⏳ 待开始 |
| 1.3        | 模型组与自动选择     | P1     | 3-5 天       | ⏳ 待开始 |
| 1.4        | 定时任务调度器       | P1     | 1-2 天       | ⏳ 待开始 |
| 1.5        | Brain Skill 监控     | P1     | 1 天         | ⏳ 待开始 |
| **阶段 2** | **核心功能**         |        | **3-5 天**   |           |
| 2.1        | 系统可观测性 UI      | P1     | 3-5 天       | ⏳ 待开始 |
| **阶段 3** | **架构优化**         |        | **15-20 天** |           |
| 3.1        | 统一错误处理         | P1     | 2-3 天       | ⏳ 待开始 |
| 3.2        | Gateway 通信协议统一 | P2     | 3-5 天       | ⏳ 待开始 |
| 3.3        | 前端状态管理重构     | P2     | 5-7 天       | ⏳ 待开始 |
| 3.4        | Runtime 层职责拆分   | P2     | 5-7 天       | ⏳ 待开始 |

---

## 🚀 立即行动

### 第一步：选择起点 ⭐

**推荐 3 个起点**（选其一）:

**起点 A: 质量优先（推荐）** 🔥

```bash
→ 从"1.1 多 Agent 质量闭环"开始
→ 理由：P0 最高优先级，立即提升系统质量
→ 预计：2-3 天完成
→ 影响：Swarm/Orchestrator 输出质量显著提升
```

**起点 B: 体验优先** 🖼️

```bash
→ 从"1.2 Workbench 多模态预览"开始
→ 理由：用户可见，体验提升明显
→ 预计：2-3 天完成
→ 影响：用户能直接预览 PDF/图片/视频
```

**起点 C: 稳定性优先** 🎲

```bash
→ 从"1.3 模型组与自动选择"开始
→ 理由：解决 API 配额问题，提升稳定性
→ 预计：3-5 天完成
→ 影响：模型故障时自动切换，不中断服务
```

**我的建议**: **起点 A（质量优先）** ✅

理由：

1. P0 最高优先级
2. 多 Agent 是核心能力，质量提升影响最大
3. 完成后可以立即验证效果
4. 为后续任务打好基础

---

### 第二步：确认环境 🔧

```bash
# 1. 确认分支
git branch --show-current
# → 应该在新分支上

# 2. 确认主分支干净
git status
# → 应该没有未提交的改动

# 3. 确认依赖完整
pnpm install

# 4. 确认测试通过
pnpm test

# 5. 确认类型检查通过
pnpm typecheck
```

---

### 第三步：开始实施 🎯

**如果选择起点 A（多 Agent 质量闭环）**:

```bash
# 创建工作目录
mkdir -p src/main/ai/quality-loop

# 开始实施（按任务 1.1 的步骤）
# ... 详见任务 1.1 的实施步骤
```

**如果选择起点 B（Workbench 多模态预览）**:

```bash
# 创建工作目录
mkdir -p src/renderer/src/components/agent/preview

# 安装依赖
pnpm add pdfjs-dist marked highlight.js

# 开始实施（按任务 1.2 的步骤）
# ... 详见任务 1.2 的实施步骤
```

**如果选择起点 C（模型组与自动选择）**:

```bash
# 创建工作目录
mkdir -p src/main/ai/provider

# 开始实施（按任务 1.3 的步骤）
# ... 详见任务 1.3 的实施步骤
```

---

## 📝 开发规范

### Git Commit 规范

```
格式: type(scope): description

type 可选值:
  - feat: 新功能
  - fix: Bug 修复
  - refactor: 重构
  - test: 测试
  - docs: 文档
  - chore: 构建/工具

示例:
  feat(quality): add Aggregator for multi-agent output
  refactor(runtime): extract LLMService from Runtime
  test(quality): add unit tests for Validator
```

### 测试规范

```
每个任务必须包含测试:
  - 单元测试（覆盖率 > 80%）
  - 集成测试（关键流程）
  - 手动测试（用户场景）

测试文件位置:
  - 后端：src/main/ai/xxx/__tests__/
  - 前端：src/renderer/src/components/xxx/__tests__/
```

### Code Review 检查点

```
每个任务完成后自检:
  [ ] 功能完整（符合验收标准）
  [ ] 测试充分（覆盖率 > 80%）
  [ ] 类型正确（无 TypeScript 错误）
  [ ] 代码规范（通过 ESLint）
  [ ] 性能良好（无明显卡顿）
  [ ] 文档完整（核心逻辑有注释）
```

---

## ⚠️ 风险管理

### 阶段 3 风险提示 🔴

**Runtime 拆分（任务 3.4）风险最高**:

- 影响核心执行流程
- 改动范围大（3000 行）
- 难以回滚

**缓解措施**:

1. **最后实施**（先做阶段 1-2 和任务 3.1-3.3）
2. **渐进式拆分**（每次拆分一个 Service，立即测试）
3. **充分测试**（每次拆分后跑全量测试）
4. **保留备份**（拆分前创建 backup 分支）
5. **随时回滚**（出问题立即回退）

---

## 📈 成功指标

### 阶段 1 成功标志

- [ ] 多 Agent 输出质量提升 50%+
- [ ] Workbench 支持 5+ 种文件类型预览
- [ ] 模型组功能上线，API 配额利用率提升
- [ ] 定时任务能自动执行
- [ ] Brain Skill 使用情况可视化

### 阶段 2 成功标志

- [ ] 系统指标可视化（Token/错误/压缩）
- [ ] 能快速定位问题
- [ ] 开发效率提升 30%+

### 阶段 3 成功标志

- [ ] 错误处理统一，前端展示友好
- [ ] Gateway 通信代码减少 40%+
- [ ] 前端 Store 数量减少 50%+
- [ ] Runtime 代码减少 60%+
- [ ] 代码可维护性显著提升

---

## 🎉 总结

### 为什么暂缓阶段 4？ ✅

1. **复杂度极高**：7-12 周，37K 行代码
2. **架构影响巨大**：全新系统
3. **需求需验证**：先完成阶段 1-3，看效果
4. **风险可控**：阶段 1-3 在现有架构上增强，风险低

### 阶段 1-3 的价值 💎

1. **立即见效**：Quick Wins 5-8 天就能看到效果
2. **风险可控**：增量式改进，不推翻架构
3. **质量提升**：多 Agent 质量闭环、可观测性、错误处理
4. **技术债偿还**：架构优化，为长期维护打基础

### 下一步 🚀

**立即行动**:

1. 选择起点（推荐：多 Agent 质量闭环）
2. 确认环境（分支/依赖/测试）
3. 开始实施（按步骤执行）

**评估阶段 4**:

- 完成阶段 1-3 后
- 收集用户反馈
- 评估是否启动阶段 4

---

**文档版本**: v1.0.0  
**创建时间**: 2026-02-24  
**执行决策**: ✅ 阶段 1-3 执行，阶段 4 暂缓  
**下一步**: 选择起点，立即开始！🚀
