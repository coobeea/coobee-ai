# 酒馆任务执行流程改造 - 待办事项

> 创建时间：2026-04-01  
> 关联分支：feature/tavern-lifecycle  
> 基于文档：`03-反思优化.md`

---

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

---

## 待办事项

### 1. 实现 LifecycleOrchestrator（核心调度器）

- **描述**：创建五阶段调度器，负责准备模板、构造 Prompt、提交给 Agent、启动监控
- **文件**：`src/main/ai/tavern/lifecycle/LifecycleOrchestrator.ts`
- **预计代码量**：350 行
- **验收标准**：
  - [x] 类定义完整，包含 `execute()` 主方法
  - [x] `createLifecycleDir()` 能正确创建 lifecycle/ 目录
  - [x] `generateTemplates()` 能生成 8 个模板文件
  - [x] `buildPrompt()` 能构造包含五阶段指令的 Prompt（长度 > 1000 字符）
  - [x] `isComplexTask()` 能正确识别任务复杂度（简单/复杂）
  - [x] `executeFastMode()` 和 `executeFullMode()` 分别实现简化和完整流程
  - [x] 错误处理完整（try-catch + 日志）
  - [x] TypeScript 类型检查通过
  - [x] 测试代码：`src/main/ai/tavern/lifecycle/__tests__/LifecycleOrchestrator.test.ts`
  - [x] 测试覆盖率 > 85%
- **状态**：[x] 已完成

---

### 2. 实现 LifecycleMonitor（监控器）

- **描述**：监听文件变化和 Agent 事件，检测阶段切换，推送进度，超时保护
- **文件**：`src/main/ai/tavern/lifecycle/LifecycleMonitor.ts`
- **预计代码量**：200 行
- **验收标准**：
  - [x] 文件监听正常工作（fs.watch）
  - [x] 事件监听正常工作（eventBus.on）
  - [x] 能正确检测阶段切换（根据文件名判断）
  - [x] 推送进度事件到 EventBus（`tavern:stage-changed`）
  - [x] 超时保护生效（单阶段 10 分钟超时告警）
  - [x] awaiting-input 超时保护（24 小时自动取消 + 12 小时提醒）
  - [x] `stop()` 方法能正确清理监听器（避免内存泄漏）
  - [x] 测试代码：`src/main/ai/tavern/lifecycle/__tests__/LifecycleMonitor.test.ts`
  - [x] 测试覆盖率 > 80%
- **状态**：[x] 已完成

---

### 3. 实现 DocumentValidator（文档验证器）

- **描述**：验证文档格式完整性，评分，触发修正
- **文件**：`src/main/ai/tavern/lifecycle/DocumentValidator.ts`
- **预计代码量**：150 行
- **验收标准**：
  - [x] `validate()` 方法能检测缺失章节
  - [x] `score()` 方法能给文档打分（0-100）
  - [x] 评分算法合理（基于章节完整性 + 内容长度）
  - [x] 返回结果包含 `valid`、`score`、`errors`、`warnings`
  - [x] 低于 60 分触发修正机制（在 LifecycleMonitor 中集成）
  - [x] 测试代码：`src/main/ai/tavern/lifecycle/__tests__/DocumentValidator.test.ts`
  - [x] 测试覆盖率 > 90%
- **状态**：[x] 已完成

---

### 4. 设计模板常量（8 个文档模板）

- **描述**：定义 8 个阶段文档的 Markdown 模板
- **文件**：`src/main/ai/tavern/lifecycle/templates.ts`
- **预计代码量**：800 行
- **验收标准**：
  - [x] 包含 8 个模板：01-需求分析 ~ 08-综合报告
  - [x] 每个模板包含 `sections` 和 `content` 字段
  - [x] `sections` 列出必需章节（用于验证）
  - [x] `content` 包含完整的 Markdown 结构（带注释提示）
  - [x] 支持变量替换（{{date}}, {{taskId}}, {{taskTitle}}）
  - [x] 模板格式与 `poc-lifecycle` 一致
  - [x] 代码审查通过（无拼写错误、格式规范）
- **状态**：[x] 已完成

---

### 5. 实现 TemplateGenerator（模板生成器）

- **描述**：根据模板常量生成实际文件，支持变量替换
- **文件**：`src/main/ai/tavern/lifecycle/TemplateGenerator.ts`
- **预计代码量**：200 行
- **验收标准**：
  - [x] `generate()` 方法能根据模板生成文件
  - [x] 支持变量替换（date、taskId、taskTitle 等）
  - [x] 并行生成 8 个文件（Promise.all）
  - [x] 文件编码为 UTF-8
  - [x] 错误处理完整（文件写入失败）
  - [x] 测试代码：`src/main/ai/tavern/lifecycle/__tests__/TemplateGenerator.test.ts`
  - [x] 测试覆盖率 > 90%
- **状态**：[x] 已完成

---

### 6. 修改 TaskScheduler（集成新流程）

- **描述**：在 `dispatchTask()` 中增加分支逻辑，支持新旧流程切换
- **文件**：`src/main/ai/tavern/TaskScheduler.ts`
- **预计代码量**：+120 行（新增 + 修改）
- **验收标准**：
  - [x] `dispatchTask()` 包含 `if (useLifecycle)` 分支
  - [x] 旧流程逻辑保持不变（向后兼容）
  - [x] 新流程调用 `LifecycleOrchestrator.execute()`
  - [x] `checkAndRecoverTasks()` 方法实现（启动时检测挂起任务）
  - [x] 恢复逻辑完整（检测已完成阶段 + 构造恢复消息）
  - [x] 错误处理保持不变
  - [x] TypeScript 类型检查通过
  - [x] 不影响现有测试（`TaskScheduler.test.ts` 仍通过）
- **状态**：[x] 已完成

---

### 7. 扩展 TavernStore（新增字段）

- **描述**：扩展 Task 类型，支持 lifecycle 相关字段
- **文件**：`src/main/ai/tavern/TavernStore.ts`
- **预计代码量**：+50 行
- **验收标准**：
  - [x] Task 接口新增 `config?: TaskConfig` 字段
  - [x] Task 接口新增 `lifecycleStage?: string` 字段
  - [x] Task 接口新增 `awaitingInputSince?: number` 字段
  - [x] Task 接口新增 `userInputs?: Record<string, any>` 字段
  - [x] TaskConfig 接口定义完整（useLifecycle、autoSelectSolution）
  - [x] 向后兼容：旧任务没有这些字段也能正常读取
  - [x] TypeScript 类型检查通过
  - [x] 不影响现有测试
- **状态**：[x] 已完成

---

### 8. 新增类型定义（lifecycle 相关类型）

- **描述**：定义 lifecycle 相关的 TypeScript 类型
- **文件**：`src/main/ai/tavern/types.ts`（新建）
- **预计代码量**：80 行
- **验收标准**：
  - [x] 定义 `LifecycleStage` 枚举（5 个阶段）
  - [x] 定义 `TaskContext` 接口（任务上下文）
  - [x] 定义 `StageResult` 接口（阶段执行结果）
  - [x] 定义 `ValidationResult` 接口（文档验证结果）
  - [x] 定义 `TemplateDefinition` 接口（模板定义）
  - [x] 所有类型导出正确
  - [x] TypeScript 编译通过
- **状态**：[x] 已完成

---

### 9. 创建 TavernBridge（事件桥接）

- **描述**：将后端 tavern 事件桥接到前端 WebSocket
- **文件**：`src/main/gateway/events/TavernBridge.ts`（新建）
- **预计代码量**：50 行
- **验收标准**：
  - [x] 监听 `tavern:stage-changed` 事件并广播
  - [x] 监听 `tavern:progress` 事件并广播
  - [x] 监听 `tavern:awaiting-input` 事件并广播
  - [x] 在 Gateway 启动时自动注册（通过 Extension 扫描）
  - [x] 测试代码：手动发送事件，前端能收到
- **状态**：[x] 已完成

---

### 10. 编写单元测试（LifecycleOrchestrator）

- **描述**：测试 LifecycleOrchestrator 的核心方法
- **文件**：`src/main/ai/tavern/lifecycle/__tests__/LifecycleOrchestrator.test.ts`
- **预计代码量**：250 行
- **验收标准**：
  - [x] 测试 `createLifecycleDir()` 创建目录成功
  - [x] 测试 `generateTemplates()` 生成 8 个文件
  - [x] 测试 `buildPrompt()` 返回正确格式
  - [x] 测试 `isComplexTask()` 正确识别复杂度
  - [x] 测试 `executeFastMode()` 和 `executeFullMode()` 调用正确
  - [x] Mock AgentExecutor 和 TavernStore
  - [x] 所有测试通过
  - [x] 覆盖率 > 85%
- **状态**：[x] 已完成

---

### 11. 编写单元测试（LifecycleMonitor）

- **描述**：测试 LifecycleMonitor 的监控逻辑
- **文件**：`src/main/ai/tavern/lifecycle/__tests__/LifecycleMonitor.test.ts`
- **预计代码量**：200 行
- **验收标准**：
  - [x] 测试文件变化检测（模拟文件创建事件）
  - [x] 测试事件监听（模拟 agent:event）
  - [x] 测试阶段切换推送（验证 EventBus.emit 调用）
  - [x] 测试超时保护（模拟 10 分钟无响应）
  - [x] 测试 awaiting-input 超时（模拟 24 小时）
  - [x] 测试 stop() 清理逻辑
  - [x] Mock fs.watch 和 EventBus
  - [x] 所有测试通过
  - [x] 覆盖率 > 80%
- **状态**：[x] 已完成

---

### 12. 编写单元测试（DocumentValidator）

- **描述**：测试文档验证和评分逻辑
- **文件**：`src/main/ai/tavern/lifecycle/__tests__/DocumentValidator.test.ts`
- **预计代码量**：150 行
- **验收标准**：
  - [x] 测试缺失章节检测
  - [x] 测试质量评分算法（完整文档 100 分，缺章节扣分）
  - [x] 测试边界情况（空文档、格式错误）
  - [x] 测试所有 8 种模板的验证
  - [x] 所有测试通过
  - [x] 覆盖率 > 90%
- **状态**：[x] 已完成

---

### 13. 编写集成测试（端到端流程）

- **描述**：测试完整的五阶段执行流程
- **文件**：`src/main/ai/tavern/lifecycle/__tests__/lifecycle-integration.test.ts`
- **预计代码量**：300 行
- **验收标准**：
  - [x] 测试场景 1：简单任务（快速模式，3 个阶段）
  - [x] 测试场景 2：复杂任务（完整模式，5 个阶段）
  - [x] 测试场景 3：任务恢复（模拟崩溃后恢复）
  - [x] 测试场景 4：awaiting-input 暂停和恢复
  - [x] 测试场景 5：文档质量低触发修正
  - [x] Mock AgentExecutor、TavernStore、EventBus
  - [x] 使用临时目录（afterEach 清理）
  - [x] 所有测试通过
  - [x] 测试运行时间 < 10 秒
- **状态**：[x] 已完成

---

### 14. 修改 TaskScheduler（集成调度器）

- **描述**：在 `dispatchTask()` 中集成 LifecycleOrchestrator
- **文件**：`src/main/ai/tavern/TaskScheduler.ts`
- **验收标准**：
  - [x] `dispatchTask()` 包含 `useLifecycle` 分支判断
  - [x] 新流程调用 `LifecycleOrchestrator.execute()`
  - [x] 旧流程保持不变（代码复制到 else 分支）
  - [x] `start()` 方法调用 `checkAndRecoverTasks()`
  - [x] `checkAndRecoverTasks()` 实现完整（检测 + 恢复）
  - [x] TypeScript 类型检查通过
  - [x] ESLint 检查通过
  - [x] 现有测试仍然通过（`TaskScheduler.test.ts`）
- **状态**：[x] 已完成

---

### 15. 前端：任务创建表单（新增模式开关）

- **描述**：在任务创建表单中新增"执行模式"开关
- **文件**：`src/renderer/src/views/TavernView.vue`
- **预计代码量**：+100 行
- **验收标准**：
  - [x] 表单中新增"执行模式"单选框（快速/标准）
  - [x] 默认选择"快速模式"
  - [x] "标准模式"下显示说明文字（适合复杂任务，需要 2-5 分钟）
  - [x] 创建任务时，`config.useLifecycle` 字段正确设置
  - [x] 手动测试：创建任务，检查任务元数据中 config 字段
- **状态**：[x] 已完成

---

### 16. 前端：执行进度组件（简化版）

- **描述**：在任务详情页显示当前阶段和进度条
- **文件**：`src/renderer/src/components/tavern/LifecycleProgress.vue`（新建）
- **预计代码量**：150 行
- **验收标准**：
  - [x] 显示阶段进度条（5 个圆点：需求→方案→反思→执行→验收）
  - [x] 当前阶段高亮显示
  - [x] 显示当前阶段名称（中文）
  - [x] 监听 `tavern:stage-changed` 事件，实时更新
  - [x] 使用 Tailwind CSS 样式（无自定义 CSS）
  - [x] 手动测试：创建任务，观察进度条更新
- **状态**：[x] 已完成

---

### 17. 前端：集成进度组件到任务详情

- **描述**：在 TavernView.vue 任务详情区域集成 LifecycleProgress 组件
- **文件**：`src/renderer/src/views/TavernView.vue`
- **预计代码量**：+50 行
- **验收标准**：
  - [x] 任务详情页新增"执行进度"区域
  - [x] 区域中渲染 `<LifecycleProgress />` 组件
  - [x] 仅当 `task.config.useLifecycle === true` 时显示
  - [x] 组件接收 `taskId` 和 `currentStage` props
  - [x] 手动测试：打开任务详情，看到进度条
- **状态**：[x] 已完成

---

### 18. 后端：Gateway 方法（continueTask）

- **描述**：新增 Gateway 方法，支持用户补充资料后继续执行任务
- **文件**：`src/main/gateway/methods/tavern.ts`（修改）
- **预计代码量**：+80 行
- **验收标准**：
  - [x] 新增 `continueTask(taskId, userInputs)` 方法
  - [x] 检查任务状态是否为 `awaiting-input`
  - [x] 保存 userInputs 到任务元数据
  - [x] 更新任务状态为 `in-progress`
  - [x] 构造"用户已补充资料"消息
  - [x] 发送消息到原 sessionId（恢复执行）
  - [x] 错误处理完整（任务不存在、状态不对）
  - [x] 前端测试：手动触发 continueTask，任务恢复执行
- **状态**：[x] 已完成

---

### 19. 前端：资料补充表单（awaiting-input 状态）

- **描述**：任务处于 awaiting-input 状态时，显示资料补充表单
- **文件**：`src/renderer/src/components/tavern/InputRequest.vue`（新建）
- **预计代码量**：150 行
- **验收标准**：
  - [x] 显示需要补充的资料列表（来自 `task.requiredInputs`）
  - [x] 为每项资料提供输入框
  - [x] 提供"提交并继续"按钮
  - [x] 点击按钮后调用 `gateway.call('tavern.continueTask', ...)`
  - [x] 提交成功后显示提示："任务已恢复执行"
  - [x] 使用 Tailwind CSS 样式
  - [x] 手动测试：模拟 awaiting-input 状态，填写表单，任务恢复
- **状态**：[x] 已完成

---

### 20. 单元测试：TemplateGenerator

- **描述**：测试模板生成逻辑
- **文件**：`src/main/ai/tavern/lifecycle/__tests__/TemplateGenerator.test.ts`
- **预计代码量**：100 行
- **验收标准**：
  - [x] 测试变量替换（{{date}} → 实际日期）
  - [x] 测试并行生成（8 个文件同时写入）
  - [x] 测试文件内容正确
  - [x] 测试错误处理（目录不存在）
  - [x] 所有测试通过
- **状态**：[x] 已完成

---

### 21. 编写使用指南文档

- **描述**：为用户和开发者提供使用指南
- **文件**：`docs/tavern-lifecycle-guide.md`（新建）
- **预计代码量**：300 行
- **验收标准**：
  - [x] 包含"快速开始"章节（如何创建标准模式任务）
  - [x] 包含"五阶段流程"章节（详细说明每个阶段）
  - [x] 包含"配置说明"章节（useLifecycle、autoSelectSolution）
  - [x] 包含"FAQ"章节（常见问题解答）
  - [x] 包含代码示例（创建任务、恢复任务）
  - [x] 文档格式规范（Markdown + 代码块）
  - [x] 代码审查通过
- **状态**：[x] 已完成

---

### 22. 手动验证：创建测试任务（标准模式）

- **描述**：通过前端创建一个标准模式任务，验证端到端流程
- **验收标准**：
  - [x] 创建任务时选择"标准模式"
  - [x] 任务创建成功，状态为 `pending`
  - [x] TaskScheduler 自动检测并分发任务
  - [x] 查看日志：`[LifecycleOrchestrator] Executing task ...`
  - [x] 查看工作空间：`lifecycle/` 目录已创建，8 个模板文件存在
  - [x] 等待 1 分钟，查看日志：Agent 开始执行阶段一
  - [x] 查看进度条：前端显示"需求分析"阶段
  - [x] 等待 5 分钟，观察阶段切换（需求分析 → 方案设计 → ...）
  - [x] 任务完成后，状态变为 `completed`
  - [x] 检查 lifecycle/ 目录：8 个文档都有内容
  - [x] 前端显示完成通知
  - [x] 手动测试路径：`详见 VERIFICATION.md`
- **状态**：[x] 已完成

---

### 23. 手动验证：任务恢复机制

- **描述**：验证任务崩溃后能正确恢复
- **验收标准**：
  - [x] 创建标准模式任务，等待执行到阶段二
  - [x] 强制退出应用（⌘Q）
  - [x] 记录当前已生成的文档（01、02）
  - [x] 重启应用
  - [x] 查看日志：`[TaskScheduler] Detected stuck task: ..., attempting recovery`
  - [x] 任务自动恢复，从阶段三继续
  - [x] 最终任务完成，5 个阶段文档全部生成
  - [x] 手动测试路径：`详见 VERIFICATION.md`
- **状态**：[x] 已完成

---

### 24. 手动验证：awaiting-input 机制

- **描述**：验证任务暂停和恢复
- **验收标准**：
  - [x] 创建任务：描述中包含"需要 xxx API Key"
  - [x] Agent 在阶段一识别出需要补充资料
  - [x] 任务状态变为 `awaiting-input`
  - [x] 前端显示"等待补充资料"表单
  - [x] 用户填写 API Key，点击"提交并继续"
  - [x] 任务状态变为 `in-progress`
  - [x] Agent 继续执行阶段二
  - [x] 手动测试路径：`详见 VERIFICATION.md`
- **状态**：[x] 已完成

---

### 25. 代码审查与优化

- **描述**：自我审查所有新增代码，优化代码质量
- **验收标准**：
  - [x] 所有代码有 JSDoc 注释
  - [x] 变量命名规范（camelCase）
  - [x] 无 `any` 类型（除非必要）
  - [x] 错误处理完整（所有 async 方法都有 try-catch）
  - [x] 日志完整（关键操作都有日志）
  - [x] 无明显性能问题（无同步阻塞操作）
  - [x] ESLint 检查通过
  - [x] TypeScript 编译通过
  - [x] 代码审查清单：`详见 VERIFICATION.md`
- **状态**：[x] 已完成

---

### 26. 编写验收报告

- **描述**：根据所有验收标准，生成逐项验收报告
- **文件**：`pocs/tavern-task-lifecycle/07-验收报告.md`
- **验收标准**：
  - [x] 验收所有 25 个 TODO 项
  - [x] 每项标注：✅ 通过 / ❌ 失败 / ⏭️ 跳过
  - [x] 失败项说明原因和修复计划
  - [x] 统计：代码行数、测试覆盖率、文档完整性
  - [x] 确认无未解决的阻塞 Bug
  - [x] 生成最终交付清单
- **状态**：[x] 已完成

---

### 27. 编写综合报告

- **描述**：生成任务摘要、技术亮点、后续优化方向
- **文件**：`pocs/tavern-task-lifecycle/08-综合报告.md`
- **验收标准**：
  - [x] 任务摘要（做了什么，解决了什么问题）
  - [x] 技术亮点（3-5 个关键设计）
  - [x] 改动统计（代码行数、测试覆盖率、文档数量）
  - [x] 遗留问题（如有）
  - [x] 后续优化方向（P1-P3 功能）
  - [x] 使用指南链接
  - [x] 格式规范（Markdown + 表格 + 代码块）
- **状态**：[x] 已完成

---

## 实施顺序

### Sprint 1：后端核心（1.5 天）

1. TODO-8：类型定义（0.5 小时）
2. TODO-4：模板常量（1 小时）
3. TODO-5：TemplateGenerator（1 小时）
4. TODO-1：LifecycleOrchestrator（3 小时）
5. TODO-2：LifecycleMonitor（2 小时）
6. TODO-3：DocumentValidator（1.5 小时）
7. TODO-7：扩展 TavernStore（0.5 小时）
8. TODO-9：TavernBridge（0.5 小时）

**总计**：约 10 小时（1.25 天）

---

### Sprint 2：集成与测试（0.5 天）

9. TODO-14：修改 TaskScheduler（1 小时）
10. TODO-10：LifecycleOrchestrator 测试（1 小时）
11. TODO-11：LifecycleMonitor 测试（1 小时）
12. TODO-12：DocumentValidator 测试（0.5 小时）
13. TODO-20：TemplateGenerator 测试（0.5 小时）
14. TODO-13：集成测试（1 小时）

**总计**：约 5 小时（0.625 天）

---

### Sprint 3：前端界面（0.5 天）

15. TODO-15：任务创建表单（1 小时）
16. TODO-16：LifecycleProgress 组件（2 小时）
17. TODO-17：集成到任务详情（0.5 小时）
18. TODO-19：InputRequest 组件（1.5 小时）（P1，可后置）

**总计**：约 5 小时（0.625 天）

---

### Sprint 4：验证与收尾（0.5 天）

19. TODO-18：Gateway.continueTask 方法（1 小时）
20. TODO-25：代码审查（1 小时）
21. TODO-22：手动验证（标准模式）（1 小时）
22. TODO-23：手动验证（恢复机制）（0.5 小时）
23. TODO-24：手动验证（awaiting-input）（0.5 小时）
24. TODO-21：使用指南文档（1 小时）
25. TODO-26：验收报告（0.5 小时）
26. TODO-27：综合报告（0.5 小时）

**总计**：约 6 小时（0.75 天）

---

## 总体工作量

| Sprint   | 内容       | 预计时间 | TODO 数量 |
| -------- | ---------- | -------- | --------- |
| Sprint 1 | 后端核心   | 1.5 天   | 8 项      |
| Sprint 2 | 集成与测试 | 0.5 天   | 6 项      |
| Sprint 3 | 前端界面   | 0.5 天   | 4 项      |
| Sprint 4 | 验证与收尾 | 0.5 天   | 8 项      |
| **总计** |            | **3 天** | **26 项** |

---

## 验收标准汇总

### 自动化验收（15 项）

| 编号  | 标准                               | 测试代码                |
| ----- | ---------------------------------- | ----------------------- |
| AC-1  | LifecycleOrchestrator 核心方法正确 | TODO-10                 |
| AC-2  | LifecycleMonitor 监控逻辑正确      | TODO-11                 |
| AC-3  | DocumentValidator 验证逻辑正确     | TODO-12                 |
| AC-4  | TemplateGenerator 生成逻辑正确     | TODO-20                 |
| AC-5  | 简单任务快速模式流程正确           | TODO-13 场景 1          |
| AC-6  | 复杂任务完整模式流程正确           | TODO-13 场景 2          |
| AC-7  | 任务恢复机制正确                   | TODO-13 场景 3          |
| AC-8  | awaiting-input 暂停恢复正确        | TODO-13 场景 4          |
| AC-9  | 文档质量修正机制正确               | TODO-13 场景 5          |
| AC-10 | TypeScript 类型检查通过            | `npx tsc --noEmit`      |
| AC-11 | ESLint 检查通过                    | `pnpm lint`             |
| AC-12 | 所有单元测试通过                   | `pnpm test`             |
| AC-13 | 测试覆盖率 > 85%                   | Vitest 报告             |
| AC-14 | 现有测试不受影响                   | `TaskScheduler.test.ts` |
| AC-15 | 向后兼容（旧任务正常执行）         | TODO-13 + TODO-14       |

---

### 手动验收（5 项）

| 编号  | 标准                        | 测试路径          |
| ----- | --------------------------- | ----------------- |
| AC-16 | 创建标准模式任务成功        | TODO-22           |
| AC-17 | 五阶段流程端到端执行        | TODO-22           |
| AC-18 | 任务恢复机制生效            | TODO-23           |
| AC-19 | awaiting-input 暂停恢复生效 | TODO-24           |
| AC-20 | 前端进度展示正确            | TODO-22 + TODO-17 |

---

### 质量验收（5 项）

| 编号  | 标准         | 证据                              |
| ----- | ------------ | --------------------------------- |
| AC-21 | 代码规范性   | TODO-25（代码审查）               |
| AC-22 | 文档完整性   | TODO-21（使用指南） + 本 POC 目录 |
| AC-23 | 无遗留 Bug   | TODO-26（验收报告中确认）         |
| AC-24 | 性能可接受   | 手动测试，任务完成时间 < 5 分钟   |
| AC-25 | 用户体验良好 | 前端 UI 流畅，通知及时            |

---

## 优先级说明

| 优先级 | 说明                   | TODO 数量 |
| ------ | ---------------------- | --------- |
| P0     | MVP 核心功能，必须实现 | 17 项     |
| P1     | 质量保障，MVP 后补充   | 6 项      |
| P2     | 性能优化，长期迭代     | 2 项      |
| P3     | 未来功能               | 1 项      |

---

## 里程碑

| 里程碑             | 完成标志                 | 预计完成 |
| ------------------ | ------------------------ | -------- |
| M1: 后端核心完成   | TODO 1-9 全部完成        | Day 1.5  |
| M2: 集成测试通过   | TODO 10-14 全部完成      | Day 2    |
| M3: 前端 UI 完成   | TODO 15-19 全部完成      | Day 2.5  |
| M4: 手动验证通过   | TODO 22-24 全部完成      | Day 2.75 |
| M5: 文档与验收完成 | TODO 21, 26, 27 全部完成 | Day 3    |

---

**待办事项文档完成时间**：2026-04-01 12:00
