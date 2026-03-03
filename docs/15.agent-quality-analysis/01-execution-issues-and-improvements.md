# 智能体执行问题分析与改进方案

> 创建时间：2026-03-03
> 状态：分析文档，未做代码改动

---

## 一、问题记录

### 问题 1：初始执行过程中频繁碰到 Bug，修修补补

#### 问题描述

在实现新功能（Extension 加载、Channel 同步、CronJob 注册、SharedDrive、TaskRouter 等）的过程中，多次出现以下模式：

1. **功能实现 → 测试发现 Bug → 修复 → 再测试 → 再发现新问题 → 再修复**

具体案例包括：

| 序号 | 问题场景                                                                                 | 根因                                                                                         | 修复方式                         |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| 1    | `tavern-integration` Extension 加载失败：`Cannot find module '@main/common/logger'`      | Extension 在 jiti 动态加载环境中无法使用 `@main/` 路径别名，但代码中没有文档明确说明这一约束 | 改用 `api.logger`                |
| 2    | `WorkspaceFileWatcher` Extension 反复报错 `workspacesDir not available`                  | Extension 中通过 `import('@main/common/env')` 获取 Env 在 jiti 上下文中不稳定，缺乏约束文档  | 添加错误去重 + 通过 API 传递路径 |
| 3    | `ReadyExtensionHook` 中 Extension 注册的 Channel 没有被 `ChannelManager.startAll()` 启动 | 缺少 Registry → ChannelManager 的同步步骤，这一步在文档和 Hook 注释中都没有明确提及          | 手动补充同步逻辑                 |
| 4    | `CronScheduler` 中 `node-cron` 回调闭包捕获了 stale 的 `job` 对象                        | JavaScript 闭包陷阱，但 `CronScheduler` 的设计文档没有提及回调中需要重新获取最新状态         | 在回调中重新从 Store 获取        |
| 5    | `CronJobStore.save()` 方法为 `private`，但 `CronScheduler` 需要调用它保存声明式 Job      | API 可见性设计不清晰，类之间的协作关系缺乏文档                                               | 改为 `public`                    |
| 6    | `DeclarativeJob.test.ts` 中 `vi.mock` 工厂函数引用外部变量导致 `ReferenceError`          | Vitest 的 `vi.mock` hoisting 行为没有文档提醒                                                | 使用 `vi.hoisted()`              |
| 7    | JSDoc 中的 cron 表达式 `*/6` 被解析为注释结束符 `*/`                                     | 代码注释中嵌入特殊字符的风险无人知晓                                                         | 注释掉示例                       |
| 8    | `ExtensionLoader.unload()` 中清理 CronJob 的步骤与 Registry 清理的顺序不当               | 新增扩展机制时对 unload 流程的完整性缺乏 checklist                                           | 调整步骤顺序                     |

#### 根本原因分析

**这些问题不是个别的偶发 Bug，而是系统性地反映出以下不足：**

1. **缺乏 Extension 开发者规范文档**
   - 没有明确说明 Extension 中哪些模块可以直接导入、哪些不能
   - 没有说明 jiti 动态加载环境的限制
   - 没有提供 Extension 开发的最佳实践和常见陷阱

2. **缺乏模块间协作契约文档**
   - `CronScheduler` ↔ `CronJobStore` ↔ `CronJobExecutor` 三者之间的协作关系只存在于代码中
   - `ExtensionLoader` ↔ `ExtensionRegistry` ↔ `ChannelManager` / `CronScheduler` 的同步流程没有 checklist
   - 新增扩展点时容易遗漏某个组件的同步步骤

3. **缺乏变更 Impact Analysis 模板**
   - 每次添加新的 Extension 能力（如 `registerCronJob`），需要改动哪些文件、遵循什么流程，没有 checklist
   - 导致遗漏（如忘记在 `unload` 中清理、忘记在 `ReadyExtensionHook` 中同步）

---

### 问题 2：智能体引导方式过于被动，要求用户自行判断

#### 问题描述

智能体（如 `securities-trading-processor` 证券交易数据处理专家）在与用户对话时，输出了类似以下的引导语：

> "你可以把文件路径直接念，然后告诉我材料类型，我会引导你完成提取。"

这段话的问题：

| 要素                 | 问题                     | 应该怎样                                                   |
| -------------------- | ------------------------ | ---------------------------------------------------------- |
| "然后告诉我材料类型" | 要求用户自行判断数据类型 | 智能体应该自动识别文件类型（通过扩展名、文件头、内容特征） |
| "我会引导你完成提取" | 暗示还需要多轮交互       | 用户只需要提供材料，智能体应该一步到位自动完成             |
| 整体风格             | 被动等待用户指令         | 应该是主动推断、自动执行、只在必要时确认                   |

#### 根本原因分析

1. **Skill 文档（SKILL.md）设计不充分**
   - `crs-statement-extractor` Skill 可能没有明确指导智能体"不需要用户告诉你材料类型，你应该自己判断"
   - Skill 文档中缺乏"自主判断策略"（auto-detection strategy）章节

2. **执行协议（execution-protocol）缺少主动性原则**
   - 当前执行协议强调的是"分步执行、质量验证"，但没有强调"最小化用户交互"
   - 没有明确告诉智能体：能自动判断的绝不问用户，能一步完成的绝不分两步

3. **系统提示词缺少"最少交互原则"**
   - `AgentEnvInjector` 注入的提示词覆盖了 Skill 发现、执行协议、质量验证等
   - 但没有包含一条核心原则：**"尽量减少对用户的反问和引导，能自动完成的直接完成"**

4. **Agent 配置不完善**
   - `securities-trading-processor` 配置了 `skills: ["crs-statement-extractor"]` 但工具列表缺少 `skill_list`
   - 导致智能体无法正确发现和使用 Skill，被迫退回到基础引导模式

---

## 二、改进方案

### 上册：紧急修复（Low-Hanging Fruit）

> 投入小、效果明显、可立即落地

#### 1. 在执行协议中注入"最少交互原则"

**位置**：`src/main/ai/AgentEnvInjector.ts` → `buildExecutionProtocol()`

**新增内容**（追加到 `<execution_protocol>` 尾部）：

```markdown
## Proactive Execution Principle — NEVER ask when you can infer

- **Auto-detect file types** by extension, content headers, or structural patterns — NEVER ask the user "what type is this?"
- **Auto-infer parameters** from context — if you can reasonably determine a value, use it; only confirm with the user when ambiguity would lead to data loss or irreversible actions
- **Minimize round-trips** — prefer completing the entire task in one pass over asking clarifying questions
- **Show, don't ask** — if unsure, try the most likely interpretation first, show the result, and let the user correct if needed
- **Exception**: When actions are destructive (delete, overwrite, send to external services), always confirm first
```

**预计效果**：所有智能体（包括子智能体）都会在系统提示词中看到这条原则，引导 LLM 减少被动提问。

**工作量**：~30 分钟

#### 2. 修复 Agent 配置缺失 `skill_list` 工具的防护

**位置**：`src/main/gateway/methods/chat.ts`、`src/main/ai/tools/builtin/delegate-to-agent.ts`

**逻辑**：当 Agent 配置了 `skills` 但工具列表中没有 `skill_list` 时，自动补充。

```typescript
if (agentDef.skills?.length > 0 && !toolNames.includes('skill_list')) {
  toolNames.push('skill_list');
}
```

**预计效果**：杜绝因配置遗漏导致 Skill 不可用的问题。

**工作量**：~30 分钟

#### 3. 为 SKILL.md 模板增加"自主判断策略"标准章节

**位置**：`skills/skill-creator/SKILL.md`（Skill 创建模板）

**新增章节**：

```markdown
## Auto-Detection Strategy (Required)

Every Skill MUST include a section describing how the Agent should automatically
detect and classify inputs WITHOUT asking the user. Examples:

- File type: infer from extension (.csv, .xlsx, .pdf, .json), content headers, or MIME type
- Language: infer from file encoding, content patterns, or directory conventions
- Data format: parse first few lines to detect structure (tabular, JSON, XML, log, etc.)
- Task scope: infer from file size, content complexity, and user's history

NEVER rely on the user to tell you what type of input they have.
```

**预计效果**：未来新创建的 Skill 都会包含自动检测策略，减少被动引导。

**工作量**：~20 分钟

---

### 中册：系统性改善（Structural Improvements）

> 需要一定开发量，但能从根本上减少问题复发

#### 4. 编写 Extension 开发者规范文档

**输出文件**：`docs/extension-developer-guide.md` 或 `skills/extension-creator/references/developer-guide.md`

**内容要点**：

| 章节       | 内容                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 环境约束   | jiti 动态加载环境的限制：不能使用 `@main/` 别名、不能依赖 Vite transform             |
| 可用 API   | 通过 `api.logger`、`api.eventBus`、`api.registerXxx()` 等 Extension API 获取系统能力 |
| 模块导入   | 安全导入方式：dynamic `import()` + 具体模块路径，或通过 Extension API                |
| 生命周期   | `register()` 中做注册，`unregister()` 中做清理；热重载时 unload→load 的完整流程      |
| 常见陷阱   | 闭包 stale 引用、vi.mock hoisting、JSDoc 中的特殊字符                                |
| 扩展点清单 | 注册 Channel / CronJob / HttpRoute / Skill / Service / Hook 各自的注意事项           |
| 测试规范   | `vi.hoisted` 的使用、`mockEnvPaths` 的模式、`afterEach` 清理                         |

**预计效果**：新增 Extension 能力时不再依赖"试错—修复"循环，开发者可以查阅文档避免常见问题。

**工作量**：~3 小时

#### 5. 为每个扩展点建立"变更 Checklist"

**形式**：在 Extension 开发者规范中，为每个扩展点提供一个 checklist。

**示例（新增 `api.registerCronJob()` 的 checklist）**：

```markdown
## 新增 Extension 扩展点 Checklist

- [ ] **types.ts** — 在 `ExtensionApi` 接口中添加新方法
- [ ] **types.ts** — 定义配置接口（如 `CronJobConfig`）和注册记录接口（如 `RegisteredCronJob`）
- [ ] **ExtensionRegistry.ts** — 添加存储数组、注册/注销/查询方法
- [ ] **ExtensionRegistry.ts** — 在 `unregisterAll()` 中包含新扩展点的清理
- [ ] **ExtensionRegistry.ts** — 在 `getExtensionIds()` 中包含新扩展点的 extensionId
- [ ] **ExtensionRegistry.ts** — 在 `clear()` 中重置新扩展点的存储
- [ ] **ExtensionApi.ts** — 实现 `api.registerXxx()` 方法，委托给 Registry
- [ ] **ExtensionLoader.ts load()** — 加载后将 Registry 数据同步到目标管理器
- [ ] **ExtensionLoader.ts unload()** — 卸载时从目标管理器中清理
- [ ] **ReadyExtensionHook.ts** — 确保在 Hook 中完成 Registry → Manager 的首次同步
- [ ] **测试** — 注册/反注册/冲突检测/clear/hot-reload 场景覆盖
- [ ] **更新 Extension 开发者文档**
```

**预计效果**：每次新增扩展能力时按照 checklist 执行，不会再遗漏步骤。

**工作量**：~1 小时

#### 6. 增强 Skill 的引导质量评审机制

在 Skill 创建流程（`SkillCreatorService`）中增加一个后处理步骤：

**检查规则**：

1. SKILL.md 是否包含"Auto-Detection Strategy"或等价内容
2. SKILL.md 中是否有"请告诉我XXX"、"你需要XXX"等被动引导语句 → 标记为警告
3. SKILL.md 中操作步骤是否以"用户提供输入 → Agent 自动完成"为主线

**实现思路**：可以通过简单的关键词检查 + LLM 评审实现。

**预计效果**：从 Skill 源头控制引导质量。

**工作量**：~2-3 小时

---

### 下册：长期架构演进（Architecture Evolution）

> 需要较大投入，但能从架构层面根本解决问题

#### 7. 引入 Extension 能力契约系统（Capability Contract）

**思路**：

当前 Extension 的注册方式是命令式的（`api.registerCronJob(config)`），没有声明式的能力描述。

引入能力契约系统后，Extension 通过 `extension.json` 声明自己需要注册的扩展点：

```json
{
  "id": "task-router",
  "name": "Task Router",
  "capabilities": {
    "channels": ["task-router-channel"],
    "cronJobs": [
      {
        "name": "route-check",
        "cronExpression": "*/5 * * * *",
        "task": "检查路由规则变更"
      }
    ],
    "hooks": ["after-agent-done"]
  }
}
```

**好处**：

- `ExtensionLoader` 可以在加载前验证声明的完整性（缺少某个必要字段时报错，而不是运行时崩溃）
- 系统可以在应用启动时生成完整的"Extension 能力地图"，方便排查
- 卸载时可以基于声明自动清理，不需要手动在 `unload()` 中逐一处理

**工作量**：~1-2 周

#### 8. 引入 Agent 行为评测框架（Agent Behavior Eval）

**思路**：

建立一套自动化评测体系，定期（或在 CI 中）测试智能体的交互质量：

| 评测维度   | 指标                           | 方法                               |
| ---------- | ------------------------------ | ---------------------------------- |
| 主动性     | 被动提问次数 / 总对话轮次      | 分析对话日志中的反问语句           |
| 任务完成度 | 一次完成率 vs 多轮修复率       | 统计 self-evaluation 分数分布      |
| 引导质量   | 不必要引导语句数               | 正则检测"请告诉我"、"你需要"等模式 |
| 工具利用率 | Skill 发现 → 使用的转化率      | 分析 tool_call 日志                |
| 错误恢复   | 错误后自动修复率 vs 人工介入率 | 统计 self-repair 循环次数          |

**好处**：

- 量化智能体行为质量，不依赖主观感受
- 在 Skill 修改后可以跑回归测试
- 可以发现"隐性退化"（如某次更新后智能体变得更加被动）

**工作量**：~2-3 周

#### 9. 构建"问题—修复—预防"知识库闭环

**思路**：

将每次开发过程中遇到的问题，按照以下模板沉淀到知识库（Brain / SharedDrive）：

```markdown
## 问题卡片

**问题**：Extension 中使用 `@main/` 路径别名导致加载失败
**根因**：jiti 动态加载不经过 Vite 的路径别名解析
**修复**：改用 Extension API 或 dynamic import
**预防措施**：

- 在 Extension 开发者文档中明确说明
- 在 ExtensionLoader 加载失败时，检测错误信息中是否包含 `@main/`，给出精确提示
  **相关文件**：ExtensionLoader.ts, extension-developer-guide.md
  **标签**：#extension #jiti #import #path-alias
```

**好处**：

- 同类问题不再重复踩坑
- 智能体在创建 Extension 时可以搜索知识库，提前规避已知陷阱
- 形成"问题→修复→预防→验证"的完整闭环

**工作量**：流程定义 ~1 天，持续维护为日常习惯

---

## 三、优先级建议

| 优先级 | 方案                                  | 预计工作量  | 预计效果                         |
| ------ | ------------------------------------- | ----------- | -------------------------------- |
| **P0** | 上册-1：注入"最少交互原则"            | 30 分钟     | 立即改善所有智能体的引导被动问题 |
| **P0** | 上册-2：自动补充 `skill_list` 工具    | 30 分钟     | 杜绝因配置遗漏导致 Skill 不可用  |
| **P1** | 上册-3：SKILL.md 模板增加自主判断章节 | 20 分钟     | 新 Skill 的引导质量从源头提升    |
| **P1** | 中册-4：Extension 开发者规范文档      | 3 小时      | 减少 Extension 开发中的试错循环  |
| **P1** | 中册-5：扩展点变更 Checklist          | 1 小时      | 新增扩展能力时不遗漏步骤         |
| **P2** | 中册-6：Skill 引导质量评审            | 2-3 小时    | 自动检测 Skill 中的被动引导      |
| **P3** | 下册-7：Extension 能力契约系统        | 1-2 周      | 架构级别避免注册/清理遗漏        |
| **P3** | 下册-8：Agent 行为评测框架            | 2-3 周      | 量化智能体交互质量               |
| **P3** | 下册-9：问题知识库闭环                | 1 天 + 持续 | 防止同类问题重复出现             |

---

## 四、总结

### 两个核心问题的本质

1. **执行碰到 Bug** → 本质是**缺乏开发规范文档和变更 checklist**。系统架构越来越复杂（Extension、CronJob、Channel、SharedDrive、TaskRouter 等），但配套的约束文档没有跟上，导致每次扩展都在"试错—修复"中消耗时间。

2. **引导方式被动** → 本质是**系统提示词和 Skill 规范中缺少"主动执行原则"**。LLM 默认行为是保守的（宁可多问也不要做错），需要在提示词层面明确告诉它：能推断的不要问，能一步完成的不要分两步。

### 改进策略

- **短期**（上册）：通过提示词和配置修复直接改善用户体验
- **中期**（中册）：通过文档和流程规范减少开发过程中的返工
- **长期**（下册）：通过架构演进和自动化评测实现系统性质量保障
