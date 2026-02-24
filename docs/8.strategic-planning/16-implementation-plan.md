# 系统开发实施计划

**创建时间**: 2026-02-24  
**规划范围**: 基于 8.strategic-planning 目录下的 16 份设计文档  
**排序原则**: 从简单到复杂，从高优先级到低优先级

---

## 📋 计划概览

### 任务分级

| 难度等级          | 任务数量 | 预估总工作量 | 说明                   |
| ----------------- | -------- | ------------ | ---------------------- |
| 🟢 **Quick Wins** | 3        | 3-5 天       | 快速见效，立即提升体验 |
| 🟡 **核心功能**   | 4        | 10-15 天     | 中等复杂度，重要功能   |
| 🟠 **架构优化**   | 3        | 15-20 天     | 结构性改进，分阶段实施 |
| 🔴 **战略级项目** | 1        | 7-12 周      | 全新系统，长期投入     |

### 优先级分布

| 优先级 | 任务数量 | 说明                                 |
| ------ | -------- | ------------------------------------ |
| P0     | 4        | 最高优先级，直接影响系统核心能力     |
| P1     | 3        | 高优先级，显著提升系统质量或用户体验 |
| P2     | 2        | 中优先级，优化现有功能               |
| P3     | 2        | 低优先级，锦上添花                   |

---

## 🎯 详细任务计划

### 阶段 1: Quick Wins（第 1-5 天）⚡

**目标**: 快速提升系统质量和用户体验，立即见效。

---

#### 任务 1.1: 多 Agent 质量保证闭环 🔥

**优先级**: P0（最高）  
**预估工作量**: 2-3 天  
**原始文档**: [`06-multi-agent-quality-loop.md`](./06-multi-agent-quality-loop.md)

##### 功能描述

当前 Swarm/Orchestrator 模式存在严重问题：

- 直接返回最后一个 Agent 的输出，没有汇总
- 缺少校验机制，无法保证输出质量
- "一轮就给结果"，没有自我修复

**解决方案**: 实现 **Aggregator → Validator → Repairer** 三级质量闭环。

##### 核心工作内容

**Day 1: 核心类实现（4-6 小时）**

```
1. 创建 Aggregator 类
   → src/main/ai/quality-loop/Aggregator.ts
   → 功能：汇总多个子 Agent 输出为统一结果

2. 创建 Validator 类
   → src/main/ai/quality-loop/Validator.ts
   → 功能：对照验收标准评估质量

3. 创建 Repairer 类
   → src/main/ai/quality-loop/Repairer.ts
   → 功能：根据评估结果生成修复计划
```

**Day 2: Swarm 集成（4-6 小时）**

```
4. 修改 SwarmCoordinator.ts
   → src/main/ai/swarm/SwarmCoordinator.ts
   → 在 coordinateWithRetry 方法末尾添加质量闭环

5. 添加配置选项
   → src/main/common/config/schema.ts
   → qualityLoop.enabled, maxIterations, acceptanceCriteria
```

**Day 3: 测试与 UI（3-4 小时）**

```
6. 单元测试
   → src/main/ai/quality-loop/__tests__/

7. 前端质量反馈 UI（可选）
   → src/renderer/src/components/agent/QualityFeedback.vue
   → 显示汇总、评估、修复过程
```

##### 实施步骤

```bash
# Step 1: 创建目录和文件
mkdir -p src/main/ai/quality-loop
touch src/main/ai/quality-loop/Aggregator.ts
touch src/main/ai/quality-loop/Validator.ts
touch src/main/ai/quality-loop/Repairer.ts

# Step 2: 实现核心类（参考设计文档）

# Step 3: 集成到 SwarmCoordinator

# Step 4: 单元测试
mkdir -p src/main/ai/quality-loop/__tests__
touch src/main/ai/quality-loop/__tests__/quality-loop.test.ts

# Step 5: 运行测试
pnpm test -- src/main/ai/quality-loop/__tests__/

# Step 6: 提交
git add src/main/ai/quality-loop/
git commit -m "feat(quality): implement multi-agent quality assurance loop"
```

##### 验收标准

- [ ] Aggregator 能正确汇总多个 Agent 输出
- [ ] Validator 能根据 AcceptanceCriteria 评分
- [ ] Repairer 能生成有效的修复计划
- [ ] SwarmCoordinator 能自动触发质量闭环
- [ ] 配置项 `qualityLoop.enabled` 生效
- [ ] 单元测试覆盖率 > 80%

##### 预期效果

✅ Swarm/Orchestrator 输出质量提升 50%+  
✅ 自动发现和修复问题，无需人工干预  
✅ 用户信任度显著提升

---

#### 任务 1.2: Workbench 多模态预览 🖼️

**优先级**: P0（最高）  
**预估工作量**: 2-3 天  
**原始文档**: [`07-workbench-multimodal-preview.md`](./07-workbench-multimodal-preview.md)

##### 功能描述

当前 Workbench Panel 只能用 Monaco Editor 显示文件，导致：

- PDF/图片/视频无法原生预览
- HTML 无法渲染
- Agent 启动的本地服务无法在系统内查看
- 命令行输出不可见

**解决方案**: 实现多模态内容预览，根据文件类型动态渲染不同组件。

##### 核心工作内容

**Day 1: 基础架构（4-6 小时）**

```
1. 创建类型定义
   → src/renderer/src/types/preview.ts
   → PreviewMode, PreviewItem, FileSource, URLSource, TerminalSource

2. 创建 PreviewRouter
   → src/renderer/src/utils/previewRouter.ts
   → 根据文件扩展名判断预览模式

3. 创建 BrowserFrame 组件
   → src/renderer/src/components/agent/preview/BrowserFrame.vue
   → iframe 嵌入本地服务
```

**Day 2: 预览组件（4-6 小时）**

```
4. 创建 PDFViewer
   → src/renderer/src/components/agent/preview/PDFViewer.vue
   → 使用 PDF.js 渲染 PDF

5. 创建 ImageViewer
   → src/renderer/src/components/agent/preview/ImageViewer.vue
   → 支持缩放、重置

6. 创建 VideoPlayer / AudioPlayer
   → src/renderer/src/components/agent/preview/VideoPlayer.vue
   → src/renderer/src/components/agent/preview/AudioPlayer.vue

7. 创建 MarkdownPreview
   → src/renderer/src/components/agent/preview/MarkdownPreview.vue
   → 使用 marked.js + highlight.js
```

**Day 3: Agent 集成与测试（3-4 小时）**

```
8. 创建 notify_service 工具
   → src/main/ai/tools/builtin/notify-service.ts
   → Agent 启动服务时通知前端打开预览

9. 修改 AgentEnvInjector
   → src/main/ai/AgentEnvInjector.ts
   → 添加"Local Service Preview"使用说明

10. 重构 WorkbenchPanel
    → src/renderer/src/components/agent/WorkbenchPanel.vue
    → 使用动态组件切换

11. 功能测试
    → 测试各种文件类型预览
    → 测试 Agent 启动服务后自动预览
```

##### 实施步骤

```bash
# Step 1: 创建类型和工具
mkdir -p src/renderer/src/types
mkdir -p src/renderer/src/utils
touch src/renderer/src/types/preview.ts
touch src/renderer/src/utils/previewRouter.ts

# Step 2: 创建预览组件
mkdir -p src/renderer/src/components/agent/preview
touch src/renderer/src/components/agent/preview/BrowserFrame.vue
touch src/renderer/src/components/agent/preview/PDFViewer.vue
touch src/renderer/src/components/agent/preview/ImageViewer.vue
touch src/renderer/src/components/agent/preview/VideoPlayer.vue
touch src/renderer/src/components/agent/preview/MarkdownPreview.vue

# Step 3: 实现 notify_service 工具
touch src/main/ai/tools/builtin/notify-service.ts

# Step 4: 重构 WorkbenchPanel
# （修改现有文件）

# Step 5: 测试和提交
git add src/
git commit -m "feat(workbench): implement multi-modal content preview"
```

##### 验收标准

- [ ] PDF 文件能正确预览（带翻页）
- [ ] 图片/视频能正常显示（带缩放）
- [ ] HTML 文件能正确渲染
- [ ] Markdown 文件能正确渲染（代码高亮）
- [ ] Agent 使用 `notify_service` 后，Workbench 能自动打开 iframe 预览
- [ ] 所有预览组件不崩溃

##### 预期效果

✅ Agent 生成的各种内容都能原生展示  
✅ 本地服务可在系统内预览，无需外部浏览器  
✅ 用户体验提升 100%+

---

#### 任务 1.3: 模型组与自动选择 💰

**优先级**: P1（高）  
**预估工作量**: 3-5 天  
**原始文档**: [`11-model-group-design.md`](./11-model-group-design.md)

##### 功能描述

当前 Agent 只能配置单个固定模型，导致：

- API 配额耗尽时无法自动切换
- 模型故障时无法 fallback
- 缺少成本优化和负载均衡

**解决方案**: 支持模型组、Auto 模式、智能选择策略。

##### 核心工作内容

**Day 1-2: 基础架构（6-8 小时）**

```
1. 扩展配置 Schema
   → src/main/common/config/schema.ts
   → 添加 models.groups, models.auto

2. 实现 ModelGroupResolver
   → src/main/ai/provider/ModelGroupResolver.ts
   → 支持 @group 引用和 auto 模式
   → 实现 5 种负载策略（round-robin, random, weighted, quota-aware, fallback）

3. 增强 ModelSelector
   → src/main/ai/provider/ModelSelector.ts
   → 集成 ModelGroupResolver
```

**Day 3: Agent 集成（4-6 小时）**

```
4. 更新 AgentDefinition 类型
   → src/shared/types/agent.ts
   → model 字段支持 "@group-name" 和 "auto"

5. 修改 AgentExecutor
   → src/main/ai/AgentExecutor.ts
   → 自动重试逻辑（模型失败后切换下一个）

6. 单元测试
   → src/main/ai/provider/__tests__/ModelGroupResolver.test.ts
```

**Day 4-5: 前端 UI（6-8 小时）**

```
7. 增强 ModelSelector 组件
   → src/renderer/src/components/agent/ModelSelector.vue
   → 支持单模型/模型组/Auto 三种模式

8. 创建 RuntimeMonitor 组件（可选）
   → src/renderer/src/components/agent/RuntimeMonitor.vue
   → 显示当前使用的模型和重试历史

9. 功能测试
   → 测试 @group 引用
   → 测试 auto 模式
   → 测试自动重试
```

##### 实施步骤

```bash
# Phase 1: 后端架构
touch src/main/ai/provider/ModelGroupResolver.ts
# 修改 src/main/common/config/schema.ts
# 修改 src/main/ai/provider/ModelSelector.ts

# Phase 2: Agent 集成
# 修改 src/shared/types/agent.ts
# 修改 src/main/ai/AgentExecutor.ts

# Phase 3: 前端 UI
# 修改 src/renderer/src/components/agent/ModelSelector.vue
touch src/renderer/src/components/agent/RuntimeMonitor.vue

# Phase 4: 测试
mkdir -p src/main/ai/provider/__tests__
touch src/main/ai/provider/__tests__/ModelGroupResolver.test.ts
pnpm test -- src/main/ai/provider/__tests__/

# 提交
git add src/
git commit -m "feat(models): implement model groups and auto-selection"
```

##### 验收标准

- [ ] 配置 `models.groups` 生效
- [ ] Agent 使用 `@group-name` 能正确解析
- [ ] Agent 使用 `auto` 能自动选择最佳模型
- [ ] round-robin 策略正确轮询
- [ ] quota-aware 策略优先使用配额充足的模型
- [ ] 模型失败后自动重试下一个候选
- [ ] 前端 UI 能显示当前使用的模型
- [ ] 单元测试通过

##### 预期效果

✅ API 配额利用率提升 30%+  
✅ 模型故障时自动切换，系统稳定性提升  
✅ 成本优化（优先使用便宜模型）

---

### 阶段 2: 核心功能（第 6-20 天）🔧

**目标**: 实现中等复杂度的重要功能，显著提升系统能力。

---

#### 任务 2.1: 系统可观测性 UI 👀

**优先级**: P1（高）  
**预估工作量**: 3-5 天  
**原始文档**:

- [`01-system-observability.md`](./01-system-observability.md)
- [`02-system-improvement-plan.md`](./02-system-improvement-plan.md)
- [`03-compression-monitoring-design.md`](./03-compression-monitoring-design.md)

##### 功能描述

当前系统缺少可观测性：

- Memory 工具是否被使用？不清楚
- 对话压缩何时触发？不可见
- Token 使用情况？无统计
- 系统健康状况？无监控

**解决方案**: 创建可观测性仪表盘，实时展示系统状态。

##### 核心工作内容

**Day 1-2: 后端数据采集（6-8 小时）**

```
1. 创建 CompressionMonitor
   → src/main/ai/monitoring/CompressionMonitor.ts
   → 监听压缩事件，记录前后数据

2. 创建 MemoryTracker
   → src/main/ai/monitoring/MemoryTracker.ts
   → 统计 memory 工具调用次数和内容

3. 创建 TokenUsageCollector
   → src/main/ai/monitoring/TokenUsageCollector.ts
   → 统计每个 Agent 的 Token 消耗

4. 添加 HTTP API
   → src/main/gateway/http/monitoring.ts
   → GET /monitoring/compression
   → GET /monitoring/memory
   → GET /monitoring/tokens
```

**Day 3-4: 前端 UI（6-8 小时）**

```
5. 创建 ObservabilityView
   → src/renderer/src/views/ObservabilityView.vue
   → Tab 1: 压缩监控
   → Tab 2: Memory 统计
   → Tab 3: Token 使用
   → Tab 4: 系统健康

6. 创建图表组件
   → src/renderer/src/components/observability/TokenChart.vue
   → src/renderer/src/components/observability/CompressionTimeline.vue
   → src/renderer/src/components/observability/MemoryStats.vue

7. 添加路由
   → src/renderer/src/router/index.ts
   → /observability
```

**Day 5: 测试与优化（3-4 小时）**

```
8. 功能测试
   → 验证数据采集正确
   → 验证 UI 显示正常

9. 性能优化
   → 数据定期清理（保留 7 天）
   → 大数据集分页加载
```

##### 实施步骤

```bash
# Phase 1: 后端监控
mkdir -p src/main/ai/monitoring
touch src/main/ai/monitoring/CompressionMonitor.ts
touch src/main/ai/monitoring/MemoryTracker.ts
touch src/main/ai/monitoring/TokenUsageCollector.ts

mkdir -p src/main/gateway/http
touch src/main/gateway/http/monitoring.ts

# Phase 2: 前端 UI
mkdir -p src/renderer/src/views
mkdir -p src/renderer/src/components/observability
touch src/renderer/src/views/ObservabilityView.vue
touch src/renderer/src/components/observability/TokenChart.vue
touch src/renderer/src/components/observability/CompressionTimeline.vue
touch src/renderer/src/components/observability/MemoryStats.vue

# Phase 3: 集成和测试
# 修改 src/main/ai/runtime/openai/SessionCompressor.ts（添加事件发送）
# 修改 src/main/ai/tools/builtin/memory.ts（添加统计）
# 修改 src/renderer/src/router/index.ts（添加路由）

# 提交
git add src/
git commit -m "feat(observability): implement monitoring dashboard"
```

##### 验收标准

- [ ] 压缩事件能正确记录（时间、压缩前后 Token 数、耗时）
- [ ] Memory 工具调用统计正确（次数、类型、内容预览）
- [ ] Token 使用统计正确（按 Agent、按 Session）
- [ ] 前端 UI 能实时显示数据
- [ ] 图表美观且易读
- [ ] 数据定期清理，不占用过多存储

##### 预期效果

✅ 系统运行状况一目了然  
✅ Memory 和 Compression 使用情况可量化  
✅ Token 消耗可追踪，成本可控

---

#### 任务 1.3: 定时任务调度器集成 ⏰

**优先级**: P1（高）  
**预估工作量**: 1-2 天  
**原始文档**: 本次会话已实现 UI 和存储，缺少调度器

##### 功能描述

当前定时任务模块已实现：

- ✅ UI 界面（创建、配置、删除）
- ✅ 数据存储（文件系统）
- ✅ HTTP API（CRUD）
- ❌ **缺少调度器**（任务不会自动执行）

**解决方案**: 集成 `node-cron` 调度器，实现定时自动触发。

##### 核心工作内容

**Day 1: 调度器实现（4-6 小时）**

```
1. 创建 CronScheduler
   → src/main/scheduler/CronScheduler.ts
   → 使用 node-cron 管理定时任务
   → 支持启动、停止、更新 cron 表达式

2. 创建 CronJobExecutor
   → src/main/scheduler/CronJobExecutor.ts
   → 触发时调用 AgentExecutor 执行任务
   → 记录执行历史和结果

3. 集成到 Gateway
   → src/main/gateway/Gateway.ts
   → 启动时加载所有 active 任务
   → 自动注册到调度器
```

**Day 2: 测试与优化（3-4 小时）**

```
4. 单元测试
   → src/main/scheduler/__tests__/CronScheduler.test.ts

5. 集成测试
   → 创建测试任务，验证定时触发

6. 前端状态更新
   → src/renderer/src/views/CronView.vue
   → 显示下次执行时间（nextRunAt）
   → 显示最近执行结果（lastRunResult）
```

##### 实施步骤

```bash
# Step 1: 创建调度器
mkdir -p src/main/scheduler
touch src/main/scheduler/CronScheduler.ts
touch src/main/scheduler/CronJobExecutor.ts

# Step 2: 集成到 Gateway
# 修改 src/main/gateway/Gateway.ts

# Step 3: 测试
mkdir -p src/main/scheduler/__tests__
touch src/main/scheduler/__tests__/CronScheduler.test.ts
pnpm test -- src/main/scheduler/__tests__/

# Step 4: 前端更新
# 修改 src/renderer/src/views/CronView.vue

# 提交
git add src/
git commit -m "feat(cron): integrate node-cron scheduler for automatic execution"
```

##### 验收标准

- [ ] CronScheduler 能正确解析 cron 表达式
- [ ] 定时任务到期后自动触发执行
- [ ] 执行结果正确记录到 lastRunResult
- [ ] nextRunAt 计算准确
- [ ] 任务暂停/恢复功能正常
- [ ] 应用重启后任务能自动加载并继续调度
- [ ] 单元测试通过

##### 预期效果

✅ 定时任务真正"定时"执行  
✅ 支持复杂 cron 表达式（分/时/天/周/月）  
✅ 执行历史可追溯

---

#### 任务 1.4: Brain Skill 使用情况监控 🧠

**优先级**: P1（高）  
**预估工作量**: 1 天  
**原始文档**: [`04-brain-skill-auto-integration.md`](./04-brain-skill-auto-integration.md)

##### 功能描述

Brain Skill 已自动集成到所有 Agent，但：

- 不知道 Agent 是否真的在使用
- 不知道搜索/发布的频率
- 无法评估智库的实际价值

**解决方案**: 添加 Brain Skill 使用统计和监控。

##### 核心工作内容

**Day 1: 统计与 UI（6-8 小时）**

```
1. 修改 brain/scripts/search.py
   → 记录搜索事件到日志
   → 包含：sessionId, agentId, query, resultCount, timestamp

2. 修改 brain/scripts/publish.py
   → 记录发布事件到日志
   → 包含：sessionId, agentId, type, summary, timestamp

3. 创建 BrainStatsCollector
   → src/main/services/BrainStatsCollector.ts
   → 读取并解析 brain 日志

4. 添加到可观测性 UI
   → src/renderer/src/views/ObservabilityView.vue
   → 新增 Tab 5: Brain 智库使用统计
   → 显示：搜索次数、发布次数、活跃 Agent、热门查询
```

##### 实施步骤

```bash
# Step 1: 修改 brain scripts
# 修改 skills/brain/scripts/search.py
# 修改 skills/brain/scripts/publish.py

# Step 2: 创建统计收集器
touch src/main/services/BrainStatsCollector.ts

# Step 3: 集成到可观测性 UI
# 修改 src/renderer/src/views/ObservabilityView.vue

# 提交
git add skills/brain/ src/
git commit -m "feat(brain): add usage monitoring and statistics"
```

##### 验收标准

- [ ] brain/scripts 正确记录使用日志
- [ ] BrainStatsCollector 能解析日志
- [ ] 前端 UI 能显示统计数据（搜索/发布次数）
- [ ] 能查看哪些 Agent 在使用 Brain
- [ ] 能查看热门查询和发布主题

##### 预期效果

✅ 了解智库的实际使用情况  
✅ 评估知识复用效果  
✅ 发现活跃 Agent 和热门主题

---

### 阶段 3: 架构优化（第 21-40 天）🏗️

**目标**: 结构性改进，解决技术债务，提升系统可维护性。

---

#### 任务 3.1: 统一错误处理机制 ⚠️

**优先级**: P1（高）  
**预估工作量**: 2-3 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 8

##### 功能描述

当前错误处理混乱：

- 每个模块自己处理错误
- 错误信息不统一
- 缺少错误码体系
- 前端无法友好展示错误

**解决方案**: 实现统一的错误类型、错误码、错误处理中间件。

##### 核心工作内容

**Day 1: 错误类型系统（4-6 小时）**

```
1. 创建错误码枚举
   → src/shared/errors/codes.ts
   → SYSTEM_*, AGENT_*, TOOL_*, FILE_* 等分类

2. 创建 AppError 基类
   → src/shared/errors/AppError.ts
   → code, message, details, stack

3. 创建具体错误类
   → src/shared/errors/AgentError.ts
   → src/shared/errors/ToolError.ts
   → src/shared/errors/FileError.ts
```

**Day 2: 错误处理中间件（4-6 小时）**

```
4. 创建全局错误处理器
   → src/main/common/errors/ErrorHandler.ts
   → 统一捕获和格式化错误

5. 集成到 Gateway
   → src/main/gateway/middleware/errorHandler.ts
   → Koa 错误处理中间件

6. 集成到 AgentExecutor
   → src/main/ai/AgentExecutor.ts
   → 统一 try-catch 和错误转换
```

**Day 3: 前端错误展示（3-4 小时）**

```
7. 创建 ErrorDisplay 组件
   → src/renderer/src/components/common/ErrorDisplay.vue
   → 根据错误码显示友好信息

8. 更新现有组件
   → 替换所有 alert/console.error 为 ErrorDisplay

9. 测试
   → 各种错误场景测试
```

##### 实施步骤

```bash
# Phase 1: 错误类型
mkdir -p src/shared/errors
touch src/shared/errors/codes.ts
touch src/shared/errors/AppError.ts
touch src/shared/errors/AgentError.ts
touch src/shared/errors/ToolError.ts
touch src/shared/errors/FileError.ts

# Phase 2: 错误处理
mkdir -p src/main/common/errors
mkdir -p src/main/gateway/middleware
touch src/main/common/errors/ErrorHandler.ts
touch src/main/gateway/middleware/errorHandler.ts

# Phase 3: 前端组件
touch src/renderer/src/components/common/ErrorDisplay.vue

# 提交
git add src/
git commit -m "feat(errors): implement unified error handling system"
```

##### 验收标准

- [ ] 所有错误都有唯一错误码
- [ ] 错误信息格式统一
- [ ] 前端能友好展示错误
- [ ] 错误日志包含完整堆栈
- [ ] 关键错误能自动上报（可选）

##### 预期效果

✅ 错误定位速度提升 3 倍  
✅ 用户友好的错误提示  
✅ 系统可维护性提升

---

#### 任务 3.2: Gateway 通信协议统一 🔌

**优先级**: P2（中）  
**预估工作量**: 3-5 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 2

##### 功能描述

当前 Gateway 通信混乱：

- 方法注册用 `methods/`
- 事件广播用 `broadcastToSubscribers`
- HTTP 用 `http/` 路由
- 三种协议混用，难以维护

**解决方案**: 统一为 RPC 风格，类型安全，易于扩展。

##### 核心工作内容

**Day 1-2: 协议设计与实现（6-8 小时）**

```
1. 设计统一协议
   → src/main/gateway/protocol/types.ts
   → RPCRequest, RPCResponse, RPCError

2. 创建协议适配器
   → src/main/gateway/protocol/Adapter.ts
   → 适配现有 methods/events/http

3. 创建类型安全的方法注册
   → src/main/gateway/protocol/Registry.ts
   → 自动生成类型定义
```

**Day 3-4: 迁移现有代码（6-8 小时）**

```
4. 迁移 methods/
   → 逐个迁移到新协议

5. 迁移 events/
   → 统一事件格式

6. 迁移 http/
   → 可选（保持 REST 风格）
```

**Day 5: 测试与文档（3-4 小时）**

```
7. 集成测试
   → 验证所有现有功能正常

8. 编写迁移文档
   → docs/10.architecture-review/51-gateway-protocol-migration.md
```

##### 实施步骤

```bash
# Phase 1: 协议实现
mkdir -p src/main/gateway/protocol
touch src/main/gateway/protocol/types.ts
touch src/main/gateway/protocol/Adapter.ts
touch src/main/gateway/protocol/Registry.ts

# Phase 2: 渐进式迁移
# 修改 src/main/gateway/methods/*.ts
# 修改 src/main/gateway/Gateway.ts

# Phase 3: 测试
# 全量回归测试

# 提交
git add src/main/gateway/
git commit -m "refactor(gateway): unify communication protocol"
```

##### 验收标准

- [ ] 所有方法注册类型安全
- [ ] 事件格式统一
- [ ] 前端调用方式更简洁
- [ ] 现有功能无回归
- [ ] 新增方法更容易添加

##### 预期效果

✅ 通信协议统一且类型安全  
✅ 新增功能开发效率提升 50%  
✅ 代码可维护性提升

---

#### 任务 3.3: 前端状态管理重构 📦

**优先级**: P2（中）  
**预估工作量**: 5-7 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 3

##### 功能描述

当前前端状态管理碎片化：

- 10+ 个 Pinia Store，相互依赖
- 部分状态用 `provide/inject`
- 数据同步逻辑分散
- 缺少统一的数据流

**解决方案**: 重构为分层架构，清晰的数据流和依赖关系。

##### 核心工作内容

**Day 1-2: Domain Store 抽象（6-8 小时）**

```
1. 创建 Domain Store 基类
   → src/renderer/src/stores/base/DomainStore.ts
   → 统一数据加载、错误处理、缓存策略

2. 创建核心 Domain Stores
   → src/renderer/src/stores/domain/AgentStore.ts
   → src/renderer/src/stores/domain/ThreadStore.ts
   → src/renderer/src/stores/domain/SkillStore.ts
```

**Day 3-4: UI Store 抽象（6-8 小时）**

```
3. 创建 UI Store
   → src/renderer/src/stores/ui/LayoutStore.ts
   → src/renderer/src/stores/ui/ModalStore.ts
   → src/renderer/src/stores/ui/ToastStore.ts

4. 统一事件订阅
   → src/renderer/src/stores/base/EventStore.ts
   → 统一 Gateway 事件订阅和分发
```

**Day 5-7: 迁移与测试（8-10 小时）**

```
5. 迁移现有 stores
   → useThreads → AgentStore
   → useAgents → ThreadStore
   → ...

6. 更新组件引用
   → 所有 Vue 组件更新 store 引用

7. 回归测试
   → 验证所有功能正常
```

##### 实施步骤

```bash
# Phase 1: 基础架构
mkdir -p src/renderer/src/stores/base
mkdir -p src/renderer/src/stores/domain
mkdir -p src/renderer/src/stores/ui
touch src/renderer/src/stores/base/DomainStore.ts
touch src/renderer/src/stores/base/EventStore.ts

# Phase 2: Domain Stores
touch src/renderer/src/stores/domain/AgentStore.ts
touch src/renderer/src/stores/domain/ThreadStore.ts
touch src/renderer/src/stores/domain/SkillStore.ts

# Phase 3: UI Stores
touch src/renderer/src/stores/ui/LayoutStore.ts
touch src/renderer/src/stores/ui/ModalStore.ts
touch src/renderer/src/stores/ui/ToastStore.ts

# Phase 4: 渐进式迁移
# 修改现有 stores
# 修改 Vue 组件

# 提交
git add src/renderer/src/stores/
git commit -m "refactor(stores): implement layered state management"
```

##### 验收标准

- [ ] Domain Store 和 UI Store 职责清晰
- [ ] Store 之间依赖关系简化
- [ ] 数据流清晰可追踪
- [ ] 所有功能无回归
- [ ] 新增 Store 更容易添加

##### 预期效果

✅ 前端代码可维护性提升  
✅ 状态管理清晰且可预测  
✅ 新功能开发效率提升 30%

---

#### 任务 3.4: Runtime 层职责拆分 🔧

**优先级**: P2（中）  
**预估工作量**: 5-7 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 1

##### 功能描述

当前 Runtime 层职责过重：

- `OpenAIAgentRuntime` 承担 6 大职责
- 代码超过 3000 行，难以维护
- 违反单一职责原则

**解决方案**: 拆分为独立服务（LLMService, SessionService, ToolAdapterService, StreamService, CompressionService）。

##### 核心工作内容

**Day 1-3: 服务拆分（8-12 小时）**

```
1. 创建 LLMService
   → src/main/ai/services/LLMService.ts
   → 纯 LLM 调用逻辑

2. 创建 SessionService
   → src/main/ai/services/SessionService.ts
   → 会话加载/保存/管理

3. 创建 ToolAdapterService
   → src/main/ai/services/ToolAdapterService.ts
   → 工具适配和转换

4. 创建 StreamService
   → src/main/ai/services/StreamService.ts
   → 流式输出处理

5. 创建 CompressionService
   → src/main/ai/services/CompressionService.ts
   → 对话压缩逻辑
```

**Day 4-5: Runtime 重构（6-8 小时）**

```
6. 重构 OpenAIAgentRuntime
   → 改为服务编排者
   → 注入各个独立服务

7. 重构 PiMonoAgentRuntime
   → 同样模式
```

**Day 6-7: 测试与优化（6-8 小时）**

```
8. 单元测试
   → 每个 Service 独立测试

9. 集成测试
   → 验证 Runtime 功能完整

10. 性能测试
    → 确保性能无回归
```

##### 实施步骤

```bash
# Phase 1: 创建服务
mkdir -p src/main/ai/services
touch src/main/ai/services/LLMService.ts
touch src/main/ai/services/SessionService.ts
touch src/main/ai/services/ToolAdapterService.ts
touch src/main/ai/services/StreamService.ts
touch src/main/ai/services/CompressionService.ts

# Phase 2: 重构 Runtime
# 修改 src/main/ai/runtime/openai/OpenAIAgentRuntime.ts
# 修改 src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts

# Phase 3: 测试
mkdir -p src/main/ai/services/__tests__
pnpm test -- src/main/ai/services/__tests__/

# 提交
git add src/main/ai/
git commit -m "refactor(runtime): split responsibilities into independent services"
```

##### 验收标准

- [ ] 每个 Service 职责单一
- [ ] OpenAIAgentRuntime 代码减少 50%+
- [ ] 所有功能正常工作
- [ ] 单元测试覆盖率 > 80%
- [ ] 性能无回归

##### 预期效果

✅ Runtime 代码可读性提升  
✅ 单元测试更容易编写  
✅ 未来扩展更容易

---

#### 任务 3.5: 配置系统统一 ⚙️

**优先级**: P2（中）  
**预估工作量**: 2-3 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 4

##### 功能描述

当前配置分散：

- `coobee.json5`（全局配置）
- `secrets.json5`（敏感信息）
- Agent 配置（`.home/agents/*.json`）
- Worker 配置（Worker 目录下）
- 缺少统一的配置验证和热重载

**解决方案**: 实现统一的配置管理服务。

##### 核心工作内容

**Day 1-2: ConfigService 实现（6-8 小时）**

```
1. 创建 ConfigService
   → src/main/common/config/ConfigService.ts
   → 统一加载、验证、热重载
   → 支持配置监听和通知

2. 重构 ConfigStore
   → 改为 ConfigService 的代理

3. 添加配置验证
   → 启动时全量验证
   → 运行时变更验证
```

**Day 3: 热重载与测试（4-6 小时）**

```
4. 实现热重载
   → 监听配置文件变更
   → 自动重新加载并通知订阅者

5. 测试
   → 配置变更测试
   → 验证失败测试
```

##### 实施步骤

```bash
# Phase 1: ConfigService
touch src/main/common/config/ConfigService.ts

# Phase 2: 重构 ConfigStore
# 修改 src/main/common/config/ConfigStore.ts

# Phase 3: 测试
mkdir -p src/main/common/config/__tests__
touch src/main/common/config/__tests__/ConfigService.test.ts
pnpm test -- src/main/common/config/__tests__/

# 提交
git add src/main/common/config/
git commit -m "refactor(config): implement unified configuration service"
```

##### 验收标准

- [ ] 所有配置统一通过 ConfigService 访问
- [ ] 配置变更能自动热重载
- [ ] 配置验证在启动时和运行时都生效
- [ ] 配置错误能友好提示
- [ ] 单元测试通过

##### 预期效果

✅ 配置管理统一且类型安全  
✅ 热重载无需重启应用  
✅ 配置错误早发现

---

#### 任务 3.6: 事件系统类型安全 📡

**优先级**: P3（低）  
**预估工作量**: 2-3 天  
**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - 问题 6

##### 功能描述

当前事件系统缺少类型：

- `broadcastToSubscribers({ type: 'event', event: 'xxx', data: any })`
- 事件名称是字符串，容易拼错
- 数据结构不清晰

**解决方案**: 实现类型安全的事件系统。

##### 核心工作内容

**Day 1: 类型定义（3-4 小时）**

```
1. 创建事件类型枚举
   → src/shared/events/types.ts
   → EventType, EventPayload 映射

2. 创建 TypedEventEmitter
   → src/main/common/events/TypedEventEmitter.ts
   → 类型安全的 emit/on/off
```

**Day 2-3: 迁移与测试（6-8 小时）**

```
3. 重构 Gateway 事件
   → src/main/gateway/Gateway.ts
   → 使用 TypedEventEmitter

4. 更新前端订阅
   → src/renderer/src/composables/useGateway.ts
   → 类型安全的事件订阅

5. 测试
   → 验证所有事件正常工作
```

##### 实施步骤

```bash
# Phase 1: 类型系统
mkdir -p src/shared/events
mkdir -p src/main/common/events
touch src/shared/events/types.ts
touch src/main/common/events/TypedEventEmitter.ts

# Phase 2: 迁移
# 修改 src/main/gateway/Gateway.ts
# 修改 src/renderer/src/composables/useGateway.ts

# Phase 3: 测试
pnpm typecheck

# 提交
git add src/
git commit -m "refactor(events): implement type-safe event system"
```

##### 验收标准

- [ ] 所有事件有明确类型定义
- [ ] TypeScript 能检查事件名称拼写
- [ ] 事件数据结构类型安全
- [ ] 现有功能无回归

##### 预期效果

✅ 事件使用更安全  
✅ IDE 自动补全和类型检查  
✅ 重构时不易出错

---

### 阶段 4: 战略级项目（第 41 天起）🚀

**目标**: 实现全自主智能体系统，完全重塑产品形态。

---

#### 任务 4.1: 全自主智能体系统 🌟

**优先级**: P0（最高，长期）  
**预估工作量**: 7-12 周（MVP 3-5 周）  
**原始文档**: [`13-autonomous-vision-analysis.md`](./13-autonomous-vision-analysis.md) ⭐⭐⭐

##### 功能描述

**核心愿景**（用户原话）：

> "我要的不是一个聊天助手，也不是一个方案生成器，而是一个能把我模糊想法，全自动变成可上线、可运行、可交付的真实产品的自主执行智能体。"

**六大核心诉求**:

1. **极简输入** - 只需模糊想法，无需明确目标/步骤
2. **全流程自主** - 从理解到发布，无需人工干预
3. **真实产物** - 可直接使用的产品，而非中间文档
4. **自主迭代** - 自己验证、优化、修复，无需人工决策
5. **极简汇报** - 完成后一份简洁总结，不打扰用户
6. **端到端落地** - 从想法到可运行产品的完整闭环

**当前系统 vs 目标系统**:

| 维度     | 当前系统（对话驱动） | 目标系统（任务驱动）  | 差距 |
| -------- | -------------------- | --------------------- | ---- |
| 交互模式 | 多轮对话             | 一次输入，全自动执行  | 巨大 |
| 产出形态 | 聊天记录 + 文件      | 可交付产品 + 极简报告 | 巨大 |
| 自主性   | 需频繁确认           | 完全自主决策          | 巨大 |
| 验证机制 | 人工检查             | 自动验证 + 自我修复   | 巨大 |
| 外部集成 | 手动复制粘贴         | 自动发布到平台        | 巨大 |

**结论**: 当前架构**无法支持**自主执行愿景，需要**全新系统**。

##### 核心工作内容（5 个 Phase）

**Phase 1: 核心引擎（2-3 周）**

```
Week 1-2: 意图理解 + 任务规划
  1. IntentParser（意图解析器）
     → src/autonomous/intent/IntentParser.ts
     → 深度推理提取真实意图
     → 输入："做产品宣发"
     → 输出：{ objective, constraints, deliverables }

  2. TaskPlanner（任务规划器）
     → src/autonomous/planning/TaskPlanner.ts
     → 生成 DAG 执行计划
     → 输入：意图对象
     → 输出：{ steps[], dependencies, criteria }

  3. FeasibilityEvaluator（可行性评估器）
     → src/autonomous/planning/FeasibilityEvaluator.ts
     → 技术/资源/风险评估
     → 输出：{ feasible, risks[], alternatives[] }

Week 2-3: 自主执行引擎（核心）
  4. AutonomousEngine（自主执行引擎）⭐⭐⭐
     → src/autonomous/execution/AutonomousEngine.ts
     → 核心循环：while (!isGoalAchieved()) { ... }
     → 自动规划 → 执行 → 验证 → 修复

  5. AutoValidator（自动验证器）
     → src/autonomous/verification/AutoValidator.ts
     → 多层次验证（功能/性能/安全/合规）

  6. SelfOptimizer（自我优化器）
     → src/autonomous/verification/SelfOptimizer.ts
     → 问题诊断 + 策略调整
```

**Phase 2: 产物管理（1-2 周）**

```
Week 4-5: 产物存储 + 自动发布
  7. ArtifactRepository（产物仓库）
     → src/autonomous/artifacts/ArtifactRepository.ts
     → 统一存储 + 版本控制

  8. PublishManager（发布管理器）
     → src/autonomous/publish/PublishManager.ts
     → 平台适配（微博/小红书/知乎/GitHub）
     → 自动发布 + 监控

  9. PlatformAdapter（平台适配器）
     → src/autonomous/publish/adapters/
     → WeiboAdapter.ts, XiaohongshuAdapter.ts, ...
```

**Phase 3: 前端 UI（1-2 周）**

```
Week 6-7: 任务提交 + 监控面板
  10. TaskSubmitView（任务提交界面）
      → src/renderer/src/views/autonomous/TaskSubmitView.vue
      → 极简输入框 + 一键提交

  11. TaskDashboard（任务仪表盘）
      → src/renderer/src/views/autonomous/TaskDashboard.vue
      → 任务列表 + 进度监控 + 实时日志

  12. ArtifactGallery（产物画廊）
      → src/renderer/src/views/autonomous/ArtifactGallery.vue
      → 查看所有产出 + 版本历史 + 快速预览
```

**Phase 4: 高级功能（2-3 周）**

```
Week 8-10: 风险管理 + 学习优化
  13. RiskManager（风险管理器）
      → 分级风险评估（低/中/高/致命）
      → 自动决策：低风险直接执行，中风险用保守策略，高风险通知用户

  14. LearningSystem（学习系统）
      → 记录成功案例和失败教训
      → 持续优化策略

  15. TemplateLibrary（模板库）
      → 常见任务模板（产品宣发/网站开发/数据分析）
      → 快速启动
```

**Phase 5: 生态集成（1-2 周）**

```
Week 11-12: 外部平台 + 监控告警
  16. 集成更多平台
      → Twitter, LinkedIn, Medium, Shopify, ...

  17. 监控告警
      → 发布失败自动告警
      → 数据异常自动通知
```

##### 实施步骤（Phase 1 详细）

```bash
# Week 1: 意图理解 + 任务规划
mkdir -p src/autonomous/{intent,planning,execution,verification,artifacts,publish}

# Day 1-2: IntentParser
touch src/autonomous/intent/IntentParser.ts
# 实现：输入："做产品宣发" → 输出结构化意图对象

# Day 3-4: TaskPlanner
touch src/autonomous/planning/TaskPlanner.ts
# 实现：意图 → DAG 任务图

# Day 5: FeasibilityEvaluator
touch src/autonomous/planning/FeasibilityEvaluator.ts
# 实现：技术/资源/风险评估

# Week 2: 自主执行引擎（核心）
# Day 6-8: AutonomousEngine
touch src/autonomous/execution/AutonomousEngine.ts
# 实现核心循环：
while (!isGoalAchieved()) {
  step = planNextStep()
  result = executeStep()
  validation = validateResult()
  if (!validation.passed) {
    result = selfRepair(result, validation)
  }
  updateState(result)
}

# Day 9-10: AutoValidator + SelfOptimizer
touch src/autonomous/verification/AutoValidator.ts
touch src/autonomous/verification/SelfOptimizer.ts

# Week 3: 端到端测试
# 场景：输入"做产品宣发" → 输出海报+文案+发布报告

# 提交 Phase 1
git add src/autonomous/
git commit -m "feat(autonomous): implement Phase 1 - core engine"
```

##### 验收标准（Phase 1 MVP）

- [ ] IntentParser 能从模糊输入提取结构化意图
- [ ] TaskPlanner 能生成合理的 DAG 任务图
- [ ] FeasibilityEvaluator 能评估可行性
- [ ] AutonomousEngine 能自主循环执行直到目标达成
- [ ] AutoValidator 能自动验证产出质量
- [ ] SelfOptimizer 能诊断问题并调整策略
- [ ] **端到端测试通过**：输入"做产品宣发" → 产出海报+文案

##### 预期效果（MVP 后）

✅ 用户只需输入模糊想法，系统自动完成全流程  
✅ 产出可直接使用的真实产品  
✅ 无需人工干预，完全自主执行  
✅ 系统价值提升 10 倍+

---

### 补充任务（按需实施）📚

以下任务优先级较低，或已有部分设计但暂不紧急，可根据实际情况决定是否实施。

---

#### 补充 1: 系统改进建议（15 个功能点）

**原始文档**: [`05-system-improvement-recommendations.md`](./05-system-improvement-recommendations.md)

##### 主要内容

该文档提出了 15 个系统改进建议，覆盖：

- P0：API 配额管理（5 天）
- P0：Agent 行为可观测性（3 天）
- P1：Brain 浏览 UI（5 天）
- P1：Agent 自动路由（5 天）
- P2：Cron Job 可视化（3 天）
- P2：Memory 使用统计（2 天）
- P3：Agent 创建向导（5 天）
- P3：对话分支（3 天）
- P4：Skill/Extension 市场（7 天）
- P4：多 Agent 可视化（7 天）
- ... 等

##### 处理建议

**部分功能已被更高优先级任务覆盖**:

- API 配额管理 → 已被"模型组与自动选择"覆盖
- Agent 行为可观测性 → 已被"系统可观测性 UI"覆盖
- Memory 使用统计 → 已被"系统可观测性 UI"覆盖

**剩余功能可作为积压任务（Backlog）**:

- Brain 浏览 UI
- Agent 自动路由
- Cron Job 可视化
- Agent 创建向导
- 对话分支
- Skill/Extension 市场
- 多 Agent 可视化

**实施策略**: 根据用户反馈和实际需求，从 Backlog 中选择功能实施。

---

#### 补充 2: 架构 Quick Wins 清单

**原始文档**: [`09-architecture-analysis.md`](./09-architecture-analysis.md) - Sprint 1

##### 主要内容

快速优化清单（3-5 天可完成）:

```
✅ 已完成:
  - Brain Skill 自动集成

🔧 可立即实施:
  1. 统一日志格式（1 天）
  2. 添加性能监控点（1 天）
  3. 优化 Gateway 启动速度（0.5 天）
  4. 前端路由懒加载（0.5 天）
  5. 减少不必要的 re-render（1 天）
```

**处理建议**: 可在主要任务的间隙实施这些快速优化。

---

## 🗓️ 总体时间线

### 推荐实施顺序（按难度和优先级）

```
Week 1 (Day 1-7):
  ✅ 任务 1.1: 多 Agent 质量闭环（Day 1-3）
  ✅ 任务 1.2: Workbench 多模态预览（Day 4-6）
  ✅ 任务 1.3: 定时任务调度器（Day 7）

Week 2 (Day 8-14):
  ✅ 任务 1.4: Brain Skill 监控（Day 8）
  ✅ 任务 1.5: 模型组与自动选择（Day 9-13）
  ✅ 任务 2.1: 系统可观测性 UI（Day 14 开始）

Week 3 (Day 15-21):
  ✅ 任务 2.1: 系统可观测性 UI（Day 15-19 完成）
  ✅ 任务 3.1: 统一错误处理（Day 20-22）

Week 4 (Day 22-28):
  ✅ 任务 3.2: Gateway 通信协议统一（Day 23-27）
  ✅ Quick Wins 优化（Day 28）

Week 5-6 (Day 29-42):
  ✅ 任务 3.3: 前端状态管理重构（Day 29-35）
  ✅ 任务 3.4: Runtime 层职责拆分（Day 36-42）

Week 7+ (Day 43 起):
  🚀 任务 4.1: 全自主智能体系统（7-12 周，分 5 个 Phase）
```

---

## 📊 工作量与优先级矩阵

### 象限分析

```
高优先级 + 低复杂度（立即做）⚡
  ✅ 多 Agent 质量闭环（P0, 2-3 天）
  ✅ Workbench 多模态预览（P0, 2-3 天）
  ✅ 定时任务调度器（P1, 1-2 天）
  ✅ Brain Skill 监控（P1, 1 天）

高优先级 + 中复杂度（优先做）🔥
  ✅ 模型组与自动选择（P1, 3-5 天）
  ✅ 系统可观测性 UI（P1, 3-5 天）
  ✅ 统一错误处理（P1, 2-3 天）

中优先级 + 中复杂度（计划做）📅
  ✅ Gateway 通信协议统一（P2, 3-5 天）
  ✅ 前端状态管理重构（P2, 5-7 天）
  ✅ Runtime 层职责拆分（P2, 5-7 天）

高优先级 + 高复杂度（战略做）🚀
  ✅ 全自主智能体系统（P0, 7-12 周）
```

---

## 🎯 里程碑定义

### Milestone 1: 系统质量提升（2 周后）

**目标**: 快速提升系统质量和用户体验

**完成标志**:

- ✅ 多 Agent 输出质量提升 50%+（质量闭环）
- ✅ Workbench 支持多种文件类型预览
- ✅ 定时任务能自动执行
- ✅ 模型组功能上线，API 配额利用率提升

**用户可感知价值**:

- Agent 回答质量明显提升
- 系统更稳定（模型自动切换）
- 用户体验更好（多模态预览）

---

### Milestone 2: 系统可观测性（4 周后）

**目标**: 系统运行状况一目了然

**完成标志**:

- ✅ 可观测性仪表盘上线
- ✅ Memory/Compression 使用情况可视化
- ✅ Token 消耗可追踪
- ✅ Brain Skill 使用统计可查看

**用户可感知价值**:

- 了解系统健康状况
- Token 使用可控
- 知识复用效果可量化

---

### Milestone 3: 架构优化完成（6 周后）

**目标**: 解决主要技术债务，系统更易维护

**完成标志**:

- ✅ 统一错误处理上线
- ✅ Gateway 通信协议统一
- ✅ 前端状态管理清晰
- ✅ Runtime 层职责单一

**团队可感知价值**:

- 代码更易维护
- 新功能开发更快
- Bug 更少

---

### Milestone 4: 全自主系统 MVP（3-5 周后，从 Week 7 开始）

**目标**: 实现基本的自主执行能力

**完成标志**:

- ✅ 用户输入"做产品宣发" → 系统自动产出海报+文案
- ✅ 自动验证产出质量
- ✅ 自主修复问题（至少 2 轮迭代）
- ✅ 产物自动保存

**用户可感知价值**:

- 输入一句话，获得可用产品
- 无需任何人工干预
- 系统价值提升 10 倍+

---

## 📋 实施建议

### 1. 并行开发策略

**可以并行的任务**:

- 质量闭环（后端） + Workbench 多模态（前端）
- 模型组（后端） + 可观测性 UI（前端）
- Gateway 重构（后端） + 前端状态重构（前端）

**建议团队配置**:

- 后端开发 1 人
- 前端开发 1 人
- 全栈开发 1 人（协调）

### 2. 风险管理

**高风险任务**:

- 全自主智能体系统（全新架构，技术不确定性高）
- Runtime 层拆分（影响核心执行流程）
- 前端状态重构（影响所有组件）

**降低风险策略**:

- 全自主系统：先做 Phase 1 MVP，验证可行性再扩展
- Runtime 拆分：渐进式重构，每次拆分一个服务
- 前端重构：新旧 Store 并存，逐步迁移

### 3. 测试策略

**每个任务必须包含**:

- 单元测试（覆盖率 > 80%）
- 集成测试（关键流程）
- 回归测试（确保无破坏）

**E2E 测试场景**:

- 创建 Agent → 对话 → 查看结果
- 定时任务创建 → 自动执行 → 查看历史
- 多 Agent 协作 → 质量闭环 → 输出结果

### 4. 文档维护

**每个任务完成后**:

- 更新实施文档（标注"✅ 已完成"）
- 编写使用文档（如何使用新功能）
- 更新架构文档（如有架构变更）

---

## 🚀 立即开始（Tomorrow）

### 推荐起点

**选项 A: 质量优先** ⭐⭐⭐（推荐）

```
明天开始：任务 1.1 多 Agent 质量闭环
原因：
  ✅ 最高优先级（P0）
  ✅ 工作量适中（2-3 天）
  ✅ 立即提升系统质量
  ✅ 为后续自主系统打基础
```

**选项 B: 体验优先**

```
明天开始：任务 1.2 Workbench 多模态预览
原因：
  ✅ 最高优先级（P0）
  ✅ 用户体验提升明显
  ✅ 工作量适中（2-3 天）
```

**选项 C: 稳定性优先**

```
明天开始：任务 1.3 模型组与自动选择
原因：
  ✅ 高优先级（P1）
  ✅ 解决 API 配额问题
  ✅ 系统稳定性提升
```

---

### 第一周建议排期

```
Monday (Day 1):
  🔨 任务 1.1 - Day 1: Aggregator + Validator 实现

Tuesday (Day 2):
  🔨 任务 1.1 - Day 2: Swarm 集成

Wednesday (Day 3):
  🔨 任务 1.1 - Day 3: 测试与 UI
  ✅ 提交质量闭环

Thursday (Day 4):
  🔨 任务 1.2 - Day 1: 基础架构（PreviewRouter + BrowserFrame）

Friday (Day 5):
  🔨 任务 1.2 - Day 2: 预览组件（PDF/Image/Video）

Weekend (Day 6-7):
  🔨 任务 1.2 - Day 3: Agent 集成与测试
  ✅ 提交多模态预览

  🔨 任务 1.3: 定时任务调度器
  ✅ 提交调度器
```

---

## 📖 相关文档

### 设计文档索引

| 任务                 | 设计文档                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| 多 Agent 质量闭环    | [`06-multi-agent-quality-loop.md`](./06-multi-agent-quality-loop.md)                     |
| Workbench 多模态预览 | [`07-workbench-multimodal-preview.md`](./07-workbench-multimodal-preview.md)             |
| 模型组与自动选择     | [`11-model-group-design.md`](./11-model-group-design.md)                                 |
| 系统可观测性         | [`01-system-observability.md`](./01-system-observability.md) + `02` + `03`               |
| Brain Skill 自动集成 | [`04-brain-skill-auto-integration.md`](./04-brain-skill-auto-integration.md)             |
| 系统改进建议         | [`05-system-improvement-recommendations.md`](./05-system-improvement-recommendations.md) |
| 架构优化             | [`09-architecture-analysis.md`](./09-architecture-analysis.md)                           |
| 全自主智能体系统     | [`13-autonomous-vision-analysis.md`](./13-autonomous-vision-analysis.md) ⭐⭐⭐          |
| 改进路线图总览       | [`08-improvement-roadmap.md`](./08-improvement-roadmap.md)                               |
| 快速实施指南         | [`10-quick-start-tomorrow.md`](./10-quick-start-tomorrow.md)                             |
| 会话总结             | [`14-session-summary.md`](./14-session-summary.md)                                       |
| 历史文档分析         | [`15-archived-docs-analysis.md`](./15-archived-docs-analysis.md)                         |

---

## 📈 成功指标

### 短期指标（1-2 周）

- [ ] 多 Agent 输出质量提升 50%+
- [ ] 用户满意度提升 30%+
- [ ] API 配额利用率提升 30%+
- [ ] 系统崩溃率降低 50%+

### 中期指标（4-6 周）

- [ ] 系统可观测性覆盖率 80%+
- [ ] Token 消耗降低 20%+
- [ ] 新功能开发效率提升 30%+
- [ ] 代码可维护性评分提升到 B+

### 长期指标（3-5 月）

- [ ] 全自主系统 MVP 上线
- [ ] 用户从"输入想法"到"获得产品"的时间 < 3 小时
- [ ] 产出质量达标率 > 90%
- [ ] 系统价值提升 10 倍+

---

## ⚠️ 注意事项

### 关键原则

1. **测试先行**: 每个任务都必须有单元测试和集成测试
2. **渐进式重构**: 大的重构任务要分阶段进行，避免一次改动过大
3. **向后兼容**: 新功能要保持与现有系统的兼容性
4. **文档同步**: 代码变更后及时更新文档

### 常见陷阱

⚠️ **避免过度设计**: 先实现 MVP，验证后再扩展  
⚠️ **避免大爆炸重构**: 渐进式修改，每次小步快跑  
⚠️ **避免忽略测试**: 短期省时间，长期埋隐患  
⚠️ **避免脱离用户**: 定期验证功能是否符合用户需求

---

## 🎉 总结

### 核心产出

本开发计划基于 **16 份设计文档**，提取了 **11 个主要任务**，涵盖：

- 🟢 Quick Wins（4 个任务，5-8 天）
- 🟡 核心功能（4 个任务，10-15 天）
- 🟠 架构优化（3 个任务，15-20 天）
- 🔴 战略级项目（1 个任务，7-12 周）

### 关键特点

✅ **从简单到复杂**: 先做 Quick Wins，快速见效  
✅ **优先级明确**: P0 > P1 > P2 > P3  
✅ **可执行性强**: 每个任务都有详细步骤和验收标准  
✅ **引用原始文档**: 每个任务都链接到设计文档  
✅ **时间线清晰**: 建议实施顺序和里程碑定义  
✅ **风险可控**: 渐进式实施，避免大爆炸重构

### 立即行动

**明天就可以开始**:

1. 阅读 [`06-multi-agent-quality-loop.md`](./06-multi-agent-quality-loop.md)
2. 创建 `src/main/ai/quality-loop/` 目录
3. 实现 Aggregator 类
4. 开始第一个 P0 任务！🚀

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-24  
**维护者**: Coobee AI 开发团队
