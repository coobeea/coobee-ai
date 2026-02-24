# 系统改进路线图总览

## 📚 改进方案文档索引

本次会话产出了 **5 份核心设计文档**，涵盖系统各个层面的改进方向：

| 文档                                        | 主题                      | 优先级   | 预估工作量 |
| ------------------------------------------- | ------------------------- | -------- | ---------- |
| `system-improvement-recommendations.md`     | 15 个系统改进建议（全局） | 混合     | 10-20 天   |
| `multi-agent-quality-loop.md`               | 多 Agent 质量保证闭环     | P0       | 2-3 天     |
| `workbench-multimodal-preview.md`           | Workbench 多模态预览      | P0       | 2-3 天     |
| `brain-skill-auto-integration.md`           | Brain Skill 自动集成机制  | ✅ 完成  | -          |
| `system-observability.md` (已存在)          | Memory & Compression 分析 | ✅ 完成  | -          |
| `system-improvement-plan.md` (已存在)       | 可观测性改进方案          | 部分完成 | 3-5 天     |
| `compression-monitoring-design.md` (已存在) | 压缩监控详细设计          | 待实施   | 2-3 天     |

---

## 🎯 核心问题与解决方案

### 问题 1：多 Agent 协作缺少质量保证（最紧迫）

**现状**：

- Swarm/Orchestrator 直接返回最后一个 Agent 的输出
- 没有汇总、校验、修复机制
- "一轮就给结果"，质量无法保证

**解决方案**：`multi-agent-quality-loop.md`

**核心设计**：

```
用户请求 → 任务分解 → 多 Agent 执行 → Aggregator 汇总
                                         ↓
                                    Validator 校验
                                         ↓
                          (如果不达标) Repairer 修复 → 循环
                                         ↓
                          (如果达标) 输出结果
```

**关键组件**：

- `Aggregator`: 汇总多个子 Agent 输出
- `Validator`: 对照验收标准评估质量
- `Repairer`: 根据评估结果生成修复计划

**优先级理由**：这直接影响多 Agent 协作的输出质量，是系统可信赖性的基础。

---

### 问题 2：Workbench 只能显示代码（用户体验差）

**现状**：

- 所有文件都用 Monaco Editor 显示
- PDF/图片/视频无法原生预览
- Agent 启动的服务无法在系统内查看
- 缺少终端 UI

**解决方案**：`workbench-multimodal-preview.md`

**核心设计**：

```
WorkbenchPanel (动态路由)
  ├─ CodeEditor (Monaco) → .ts/.js/.vue
  ├─ PDFViewer (PDF.js) → .pdf
  ├─ ImageViewer → .png/.jpg
  ├─ VideoPlayer → .mp4
  ├─ HTMLPreview → .html
  ├─ MarkdownPreview → .md
  ├─ BrowserFrame (iframe) → http://localhost:*
  └─ TerminalViewer → exec 输出
```

**关键功能**：

- `PreviewRouter`: 文件类型识别
- `notify_service` 工具: Agent 启动服务时通知前端
- `BrowserFrame`: iframe 内嵌本地服务
- `TerminalPanel`: 显示命令行输出

**优先级理由**：这让 Agent 生成的各种内容都能原生展示，特别是 HTML/服务预览，极大提升交互体验。

---

### 问题 3：API 配额管理缺失（资源浪费）

**现状**：

- 有 6000 次/5 小时的配额限制
- 没有调度机制
- 容易浪费或不够用
- 无法优先保证重要任务

**解决方案**：`system-improvement-recommendations.md` → P0.1 API 配额管理

**核心设计**：

```
QuotaManager (配额调度器)
  ├─ 配额追踪: getRemainingQuota()
  ├─ 任务队列: enqueue(task, priority)
  ├─ 成本预估: estimateCost(task)
  └─ 智能调度: schedule()
```

**UI 设计**：

```
全局状态栏右侧:
[配额: 4520/6000 (75%)] ← 点击展开详情面板

详情面板:
━━━━━━━━━━━━━━━━━━━━━━
剩余: 4520 / 6000
重置: 2h 22m

待执行队列:
🔴 紧急 (3): 证券分析 | 50次
🟡 普通 (5): 日报生成 | 120次
🟢 低优先级 (2): 智库同步 | 200次
```

**优先级理由**：这是你当前最痛的问题，配额不够会直接影响使用。

---

### 问题 4：Agent 行为不透明（信任问题）

**现状**：

- Agent 在后台执行，用户看不到过程
- 不知道它调用了哪些工具
- 不知道它在思考什么

**解决方案**：`system-improvement-recommendations.md` → P0.2 Agent 行为观测

**核心设计**：

```
ChatPanel 右侧增加"执行追踪"面板：

🧠 Thinking... (2.3s)
   → 正在分析用户需求

🔍 search
   ↳ pattern: "*.csv"
   ✅ 找到 3 个文件 (0.5s)

📖 read
   ↳ data/transactions.csv
   ✅ 2048 lines (0.8s)

💾 memory:write
   ✅ 保存分析结果 (0.3s)
```

**优先级理由**：可观测性是建立信任的基础，特别是自主 Agent。

---

### 问题 5：智库无法浏览（资产未释放）

**现状**：

- Brain Skill 已实现
- 所有 Agent 已关联（✅ 本次完成）
- 但用户无法直接浏览智库内容

**解决方案**：`system-improvement-recommendations.md` → P0.3 智库浏览 UI

**UI 设计**：

```
智库页面 (BrainView 增强)
━━━━━━━━━━━━━━━━━━━━━━
[🔍 搜索框]

📊 最近发布:
┌─────────────────────────────────┐
│ HTTP 超时重试                    │
│ 🏷️ repair • ⭐ 0.85 • 12 次成功  │
│ 触发信号: TimeoutError, ETIMEDOUT│
│ [查看详情] [应用方案]           │
└─────────────────────────────────┘
```

**优先级理由**：智库是系统自我优化的核心，需要让用户看到并管理这些经验。

---

## 📊 优先级总览（跨文档汇总）

### 🔥 P0（立即实施，1 周内）

| 功能                 | 影响力     | 复杂度 | 工作量 | 文档                                    |
| -------------------- | ---------- | ------ | ------ | --------------------------------------- |
| 多 Agent 质量闭环    | ⭐⭐⭐⭐⭐ | 🔧🔧🔧 | 2-3 天 | `multi-agent-quality-loop.md`           |
| Workbench 多模态预览 | ⭐⭐⭐⭐⭐ | 🔧🔧🔧 | 2-3 天 | `workbench-multimodal-preview.md`       |
| API 配额管理         | ⭐⭐⭐⭐⭐ | 🔧🔧🔧 | 2-3 天 | `system-improvement-recommendations.md` |
| Agent 执行追踪       | ⭐⭐⭐⭐⭐ | 🔧🔧   | 1-2 天 | `system-improvement-recommendations.md` |
| 智库浏览 UI          | ⭐⭐⭐⭐   | 🔧🔧   | 1-2 天 | `system-improvement-recommendations.md` |

**总计**: 8-13 天

### ⚡ P1（重要但不紧急，2 周内）

| 功能               | 影响力   | 复杂度   | 工作量  | 文档                                    |
| ------------------ | -------- | -------- | ------- | --------------------------------------- |
| 定时任务执行可视化 | ⭐⭐⭐   | 🔧       | 0.5-1天 | `system-improvement-recommendations.md` |
| Memory 统计 UI     | ⭐⭐⭐   | 🔧       | 0.5天   | `system-improvement-plan.md`            |
| 压缩监控面板       | ⭐⭐⭐   | 🔧🔧     | 1-2天   | `compression-monitoring-design.md`      |
| Agent 创建向导     | ⭐⭐⭐   | 🔧🔧     | 1-2天   | `system-improvement-recommendations.md` |
| Agent 自动路由     | ⭐⭐⭐⭐ | 🔧🔧🔧🔧 | 3-5天   | `system-improvement-recommendations.md` |

**总计**: 6-11 天

### 🚀 P2-P4（长期优化，按需实施）

- 对话分支管理（3-4天）
- Skill/Extension 市场（2-3天）
- 全局命令面板（1-2天）
- 主题与个性化（0.5-1天）
- 知识图谱可视化（2-3天）
- Agent 性能分析器（2-3天）
- 自动化测试框架（3-5天）

---

## 🏗️ 建议实施顺序

### Sprint 1: 核心体验修复（5-7 天）

**目标**: 解决最痛的问题，建立信任

```
第 1-2 天: 多 Agent 质量闭环（Aggregator + Validator）
  ✅ 汇总子 Agent 输出
  ✅ 基础质量评估
  ✅ UI 展示汇总/校验状态

第 3-4 天: Workbench 多模态预览（Phase 1）
  ✅ PreviewRouter 实现
  ✅ BrowserFrame（iframe）
  ✅ notify_service 工具
  ✅ 基础终端 UI

第 5-6 天: API 配额管理（Phase 1）
  ✅ 配额追踪后端
  ✅ 状态栏显示
  ✅ 基础队列管理

第 7 天: Agent 执行追踪面板（Phase 1）
  ✅ 工具调用链显示
  ✅ 实时状态更新
```

### Sprint 2: 可观测性增强（3-5 天）

**目标**: 让用户"看得见"系统在做什么

```
第 1 天: 智库浏览 UI
  ✅ 经验包列表
  ✅ 搜索功能
  ✅ 详情展示

第 2 天: Memory 统计 UI
  ✅ 统计面板
  ✅ 文件列表
  ✅ 使用趋势

第 3-4 天: 压缩监控面板
  ✅ Token 使用可视化
  ✅ 压缩历史
  ✅ 效果对比

第 5 天: 定时任务执行可视化
  ✅ 执行历史
  ✅ 日志查看
  ✅ 状态追踪
```

### Sprint 3: 智能化提升（3-5 天）

**目标**: 降低使用门槛，提升效率

```
第 1-2 天: Agent 创建向导
  ✅ 分步骤引导
  ✅ AI 辅助配置
  ✅ 模板选择

第 3-5 天: Agent 自动路由
  ✅ 语义匹配
  ✅ Agent 推荐
  ✅ 历史学习
```

### Sprint 4+: 高级特性（按需）

- 对话分支管理
- Skill 市场
- 全局命令面板
- 知识图谱可视化
- ...

---

## 🎪 快速决策矩阵

### 如果你最关心：**质量和可信赖性**

```
1️⃣ 多 Agent 质量闭环 (2-3天)
2️⃣ Agent 执行追踪 (1-2天)
3️⃣ 智库浏览 UI (1-2天)
```

### 如果你最关心：**用户体验和易用性**

```
1️⃣ Workbench 多模态预览 (2-3天)
2️⃣ Agent 创建向导 (1-2天)
3️⃣ 全局命令面板 (1-2天)
```

### 如果你最关心：**资源利用和成本控制**

```
1️⃣ API 配额管理 (2-3天)
2️⃣ 压缩监控面板 (1-2天)
3️⃣ Agent 性能分析器 (2-3天)
```

### 如果你最关心：**系统透明度和可控性**

```
1️⃣ Agent 执行追踪 (1-2天)
2️⃣ Memory 统计 UI (0.5天)
3️⃣ 定时任务可视化 (0.5-1天)
```

---

## 📝 每个方案的价值主张

### 1. 多 Agent 质量闭环

**价值**：

- ✅ 输出质量从"看运气"变为"有保障"
- ✅ 遵循 Agent 五步循环原则
- ✅ 自动发现和修复问题
- ✅ 建立系统可信赖性

**适用场景**：

- 证券分析（需要准确性）
- 合同审查（需要完整性）
- 代码生成（需要可运行性）

**效果预期**：

- 错误率降低 60%
- 用户满意度提升 40%
- 减少人工返工 80%

---

### 2. Workbench 多模态预览

**价值**：

- ✅ 一站式体验，无需跳出系统
- ✅ Agent 生成的内容原生展示
- ✅ 支持本地服务预览（iframe）
- ✅ 终端输出实时显示

**适用场景**：

- Agent 生成 HTML 报告（直接预览）
- Agent 启动前端服务（iframe 查看）
- Agent 生成 PDF 文档（原生阅读）
- Agent 生成图表/图片（原生查看）

**效果预期**：

- 减少窗口切换 90%
- 内容查看效率提升 3x
- 用户流畅度提升 50%

---

### 3. API 配额管理

**价值**：

- ✅ 智能调度，避免浪费
- ✅ 优先保证重要任务
- ✅ 可视化配额使用
- ✅ 成本预测和告警

**适用场景**：

- 定时任务批量执行
- 长时间运行的分析任务
- 并发多个对话
- 配额快用完时的智能降级

**效果预期**：

- 配额利用率提升 40%
- 任务完成率提升 30%
- 避免配额耗尽导致的服务中断

---

### 4. Agent 执行追踪

**价值**：

- ✅ 实时查看 Agent 在做什么
- ✅ 理解决策过程
- ✅ 发现性能瓶颈
- ✅ 调试和优化

**适用场景**：

- Agent 执行缓慢时诊断
- 理解 Agent 为什么这么做
- 优化 Agent 的工具使用
- 教学演示（展示 AI 思考过程）

**效果预期**：

- 用户信任度提升 50%
- 调试效率提升 3x
- Agent 优化有数据支撑

---

### 5. 智库浏览 UI

**价值**：

- ✅ 直接查看已有经验
- ✅ 手动搜索解决方案
- ✅ 管理智库内容
- ✅ 导入/导出经验包

**适用场景**：

- 遇到问题时快速查找方案
- 审查 Agent 发布的经验
- 手动编辑/删除经验包
- 从 EvoMap 导入通用经验

**效果预期**：

- 问题解决速度提升 2x
- 智库利用率提升 80%
- 经验复用率提升 60%

---

## 🔄 迭代策略

### 敏捷原则

1. **快速验证**: 每个功能 1-3 天完成
2. **增量交付**: 先做 MVP，再优化细节
3. **用户反馈**: 每个 Sprint 后验证效果
4. **灵活调整**: 根据反馈调整优先级

### MVP 定义

每个功能的 MVP（最小可用版本）：

```
多 Agent 质量闭环 MVP:
  ✅ Aggregator（汇总）
  ✅ 简单校验（通过/不通过）
  ⏸ Repairer（后续迭代）

Workbench 预览 MVP:
  ✅ BrowserFrame（iframe）
  ✅ notify_service 工具
  ✅ ImageViewer
  ⏸ PDF/Video（后续迭代）

API 配额管理 MVP:
  ✅ 配额追踪
  ✅ 状态栏显示
  ⏸ 智能调度（后续迭代）

执行追踪 MVP:
  ✅ 工具调用链
  ⏸ Thinking 展示（后续迭代）

智库浏览 MVP:
  ✅ 列表展示
  ✅ 搜索功能
  ⏸ 编辑/导入导出（后续迭代）
```

---

## 💡 我的建议

### 立即启动（本周）

**方案 A（质量优先）**:

1. 多 Agent 质量闭环（2-3 天）
2. Agent 执行追踪（1-2 天）

**方案 B（体验优先）**:

1. Workbench 多模态预览（2-3 天）
2. 智库浏览 UI（1-2 天）

**方案 C（均衡）**:

1. 多 Agent 质量闭环（2-3 天，先做 Aggregator + Validator）
2. Workbench 多模态预览（2-3 天，先做 BrowserFrame + 基础预览）

### 我的倾向

**推荐方案 C（均衡）**，理由：

1. **多 Agent 质量闭环**是根本性问题，必须优先解决
2. **Workbench 多模态预览**提升日常使用体验，用户能立即感受到
3. 两者都是"核心痛点"，并行推进效率最高

---

## 🤝 下一步行动

### 你的决策

请告诉我：

1. **优先级选择**:
   - 方案 A（质量优先）
   - 方案 B（体验优先）
   - 方案 C（均衡）
   - 或者自定义顺序

2. **启动哪个功能**:
   - 立即开始实施（我马上写代码）
   - 还是继续讨论细节

### 我的角色

- ✅ 已完成：需求分析 + 方案设计 + 文档输出
- 🔄 等待你的决策：选择实施顺序
- 🚀 准备就绪：你一声令下，立即开工

---

## 📖 文档导航

### 已完成的实施

- ✅ `brain-skill-auto-integration.md` - Brain Skill 自动关联（已实施并测试）
- ✅ `system-observability.md` - Memory & Compression 分析（已完成）

### 设计方案（待实施）

- 📋 `multi-agent-quality-loop.md` - 多 Agent 质量闭环（强烈推荐优先）
- 📋 `workbench-multimodal-preview.md` - Workbench 多模态预览（强烈推荐优先）
- 📋 `system-improvement-recommendations.md` - 15 个改进建议（全局路线图）
- 📋 `compression-monitoring-design.md` - 压缩监控详细设计（P1）
- 📋 `system-improvement-plan.md` - 可观测性改进方案（P1）

### 辅助工具

- ✅ `scripts/add-brain-skill.ts` - 批量添加 brain skill（已执行）
- ✅ `scripts/enable-compression.ts` - 启用对话压缩（已执行）
- ✅ `scripts/verify-brain-integration.sh` - 验证 brain 集成（已通过）
- ✅ `scripts/test-memory-and-compression.sh` - 验证 memory/compression（已通过）

---

## 🎯 成功指标

每个功能实施后，应该达到的指标：

### 多 Agent 质量闭环

- 输出质量评分平均 > 0.8
- 自动修复成功率 > 70%
- 用户返工率降低 > 60%

### Workbench 多模态预览

- 预览成功率 > 95%
- 页面切换时间 < 200ms
- iframe 加载时间 < 3s

### API 配额管理

- 配额利用率 > 85%
- 任务完成率 > 90%
- 配额浪费 < 10%

### Agent 执行追踪

- 追踪延迟 < 100ms
- 追踪完整性 > 95%
- 用户满意度 > 4.5/5

### 智库浏览 UI

- 搜索响应 < 500ms
- 智库访问量提升 > 3x
- 经验复用率 > 40%

---

**总览版本**: v1.0.0  
**创建时间**: 2026-02-24  
**状态**: 📋 等待决策

**你决定从哪个开始，我立即着手实施！** 🚀
