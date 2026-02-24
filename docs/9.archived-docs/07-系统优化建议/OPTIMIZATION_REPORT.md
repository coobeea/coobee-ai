# 工具与 Agent 系统优化报告

> 创建时间：2026-02-23  
> 分析范围：11 个 Agent + 核心代码路径  
> **状态：待确认方向，尚未修改代码**

---

## 🔍 发现的问题

### 问题 1：Skill 查询能力缺失 ⚠️ 【严重】

**你提到的核心问题：**

> "创建智能体的时候没有把 Skill 历史给它放到工具清单里面，这个会导致说这个智能体，它就没有这个能力，它不知道我可以去查询它。"

**实际情况**：

找到 **1 个 Agent** 存在此问题：

- **证券交易数据处理专家** (`securities-trading-processor`)
  - 配置了 `skills: ["crs-statement-extractor"]`
  - 但工具列表是 `["read", "write", "search", "glob", "exec", "memory"]`
  - ❌ **缺少 `skill_list`**，导致 Agent 完全无法发现和使用 Skill

**根本原因**：

代码中三个地方在加载 Agent 的工具时，都是**精确匹配**配置文件中的 tools 列表，没有自动补充必要的基础工具：

1. `src/main/gateway/methods/chat.ts` 第 103-116 行 — 主 Agent
2. `src/main/ai/tools/builtin/delegate-to-agent.ts` 第 322-331 行 — 子 Agent
3. `src/main/ai/services/AgentCreatorService.ts` — AI 创建时的提示词也没有强制规则

---

### 问题 2：根据意图选择工具 🎯 【你强调的基础功能】

**你的要求：**

> "根据意图选择工具应该是一个基础功能，一定要有。"

**当前状态**：

- ❌ **没有运行时的工具推荐机制**
- Agent 完全依赖配置文件中的静态 tools 列表
- Agent 不知道自己有哪些工具可用（除非记住配置）

**对比：Skill 发现机制**（已有）

```xml
<skill_discovery>
You have 5 Skills available. Use the `skill_list` tool to discover them.

**IMPORTANT**: Before using any Skill, you MUST:
1. Use the `read` tool to read its SKILL.md file
2. Follow the instructions within
</skill_discovery>
```

**缺失：工具发现机制**（没有）

应该有类似的 `<tool_discovery>` 块，让 Agent 知道：

- 我有哪些工具
- 每个工具是干什么的
- 什么场景用什么工具

---

### 问题 3：执行效率低 🐌

**你的反馈：**

> "执行的还是特别别扭，特别的不高效的感觉"

**需要你补充**：

具体是哪个环节感觉慢/别扭？

- Agent 启动很慢？
- 工具调用响应慢？
- 审批弹窗频繁打断？
- Agent 反复做无用功（如重复读同一个文件）？

**分析计划**：

添加性能埋点，测量每个环节的耗时：

- Builder 构建时间
- Runtime 初始化时间（工具转换、Skill 加载、SDK 初始化）
- 工具执行时间（含审批等待）
- 事件分发开销

---

## 📊 数据分析

### Agent 配置统计（11 个）

| 问题类型                      | 数量 | Agent 列表                                                                                  |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| 配置了 skills 但缺 skill_list | 1    | securities-trading-processor                                                                |
| 缺 search/glob（有文件操作）  | 5    | business-analyst, decision-advisor, implementation-planner, prompt-optimizer, risk-assessor |
| 没有任何 Skill 配置           | 8    | 大部分 Agent                                                                                |

### 工具使用频率 Top 5

| 工具   | 使用率 | 说明                  |
| ------ | ------ | --------------------- |
| read   | 90.9%  | 几乎所有 Agent 都需要 |
| search | 81.8%  | 内容搜索，非常常用    |
| write  | 72.7%  | 输出报告/文件         |
| memory | 54.5%  | 半数 Agent 需要记忆   |
| glob   | 45.5%  | 文件名搜索            |

### ⚠️ 零使用的内置工具

- `todo_write` — 0 次使用
- `task_plan` — 0 次使用

**说明**：这两个工具可能不够实用，或 Agent 不知道它们的价值。

---

## 🎯 优化方案

### 方案 A：紧急修复（P0）— 建议立即实施

#### A1. 自动补充 `skill_list` 工具

**目标**：确保所有配置了 `skills` 的 Agent 自动获得 `skill_list` 工具

**修改文件**：

1. `src/main/gateway/methods/chat.ts` — `createBuilderFromDefinition()`
2. `src/main/ai/tools/builtin/delegate-to-agent.ts` — `runSubAgent()`
3. `src/main/ai/services/AgentCreatorService.ts` — `buildSystemPrompt()`

**核心逻辑**：

```typescript
// 自动补充必要工具
if (agentDef.skills && agentDef.skills.length > 0) {
  const hasSkillList = candidateTools.some((t) => t.name === 'skill_list');
  if (!hasSkillList) {
    candidateTools.push(toolMap.get('skill_list'));
    log.info(`Auto-added skill_list for agent ${agentDef.id}`);
  }
}
```

**预计工作量**：1 小时（代码 + 测试）

---

#### A2. 修复现有 Agent 配置

**目标**：修复 `securities-trading-processor.json` 的配置

**方法 1：自动修复脚本**

```bash
# Dry-run（只查看，不修改）
node scripts/fix-agent-tools.js --dry-run

# 应用修复
node scripts/fix-agent-tools.js
```

**方法 2：手动修复**

```json
// .home/agents/securities-trading-processor.json
{
  "tools": [
    "read",
    "write",
    "search",
    "glob",
    "exec",
    "memory",
    "skill_list" // ← 添加这个
  ]
}
```

**预计工作量**：5 分钟

---

### 方案 B：工具发现机制（P1）— 满足"根据意图选择工具"需求

#### B1. 实现 `<tool_discovery>` 提示块

**目标**：

让 Agent 清楚知道自己有哪些工具可用，如何使用。

**效果示例**：

```xml
<tool_discovery>
You have 12 tools available:

**File Operations** (5):
- read — Read file contents (any file type)
- write — Create or overwrite file
- edit — Modify existing file with strategic replacements
- search — Search file content by regex pattern
- glob — Find files by name pattern

**Discovery** (1):
- skill_list — List available Skills (read SKILL.md to use them)

**Tool Usage Tips**:
- For code search, prefer `search` over `exec grep`
- If you have Skills, use `skill_list` → `read` to discover them
</tool_discovery>
```

**修改位置**：`src/main/ai/AgentEnvInjector.ts` — `injectEnv()`

**预计工作量**：1.5 小时（实现 + 测试）

---

#### B2. 增强 AI 创建提示词

**目标**：

AI 创建 Agent 时提供更明确的工具选择指导。

**修改位置**：`src/main/ai/services/AgentCreatorService.ts` — `buildSystemPrompt()`

**新增规则**：

```markdown
## ⚠️ 工具选择强制规则

1. 如果选择了任何 Skill，**必须**包含 `skill_list`
2. 如果选择了文件操作（read/write/edit），**建议**包含 `search` 和 `glob`
3. 对于复杂任务的 Agent，**建议**包含 `todo_write` 和 `task_plan`

验证清单：

- [ ] skills.length > 0 → tools 包含 "skill_list"
- [ ] tools 包含 read/write/edit → tools 包含 "search" 和 "glob"
```

**预计工作量**：30 分钟

---

### 方案 C：性能分析（P1）— 定位"执行别扭"的原因

#### C1. 添加性能埋点

**目标**：

通过数据找出性能瓶颈。

**埋点位置**：

```typescript
// src/main/ai/AgentExecutor.ts
log.info(`[Perf] AgentExecutor.execute | total=${totalMs}ms`);

// src/main/ai/runtime/.../initialize()
log.info(`[Perf] Runtime.initialize | tools=${toolsMs}ms, skills=${skillsMs}ms, sdk=${sdkMs}ms`);

// src/main/ai/runtime/shared/ToolExecutionPipeline.ts
log.info(`[Perf] Tool: ${toolName} | exec=${execMs}ms, approval=${approvalMs}ms`);

// src/main/ai/skills/SkillManager.ts
log.info(`[Perf] SkillManager.scanSkills | files=${fileCount}, time=${ms}ms`);
```

**分析流程**：

1. 添加埋点 → 运行典型场景 → 收集日志
2. 生成性能报告（找出慢路径）
3. 针对性优化

**预计工作量**：2-3 小时（埋点 + 分析）

---

### 方案 D：架构增强（P2）— 可选

#### D1. 工具预设（Tool Preset）系统

**概念**：

```json5
{
  toolPreset: 'standard', // 预设：minimal/basic/standard/advanced/full
  tools: ['+exec', '-edit'] // 在预设基础上调整
}
```

**预设定义**：

- `basic`: `[read, write, search, glob, skill_list]`
- `standard`: `basic + [edit, memory, todo_write, task_plan]`
- `advanced`: `standard + [exec, process]`

**价值**：

- 简化配置（不用手动列举 10+ 个工具）
- 确保基础工具不会被遗漏
- 支持增量修改

**预计工作量**：4-6 小时（设计 + 实现 + 迁移）

---

## 🚀 实施建议

### 立即行动（建议）

**第一步：修复严重 bug（5 分钟）**

```bash
# 自动修复 Agent 配置
node scripts/fix-agent-tools.js

# 或手动编辑 securities-trading-processor.json，添加 skill_list
```

**第二步：代码防护（1 小时）**

修改以下 3 个文件，添加自动补充逻辑：

- `chat.ts`
- `delegate-to-agent.ts`
- `AgentCreatorService.ts`

创建测试用例，确保问题不再出现。

**第三步：工具发现（1.5 小时）**

实现 `<tool_discovery>` 提示块，让 Agent 知道自己有哪些工具。

**预计总耗时：2.5-3 小时**

---

### 后续优化（建议）

**第四步：性能分析（2-3 小时）**

添加性能埋点，分析"执行别扭"的具体原因。

需要你提供更多信息：

- 具体哪个环节感觉慢？
- 是否有审批弹窗频繁打断？
- Agent 是否反复做无用功？

**第五步：架构增强（可选）**

根据实际需求决定是否实施：

- 工具预设系统（简化配置）
- Agent 配置编辑器（前端界面）
- Skill 热加载（开发体验）

---

## 📋 待确认事项

### 1. 优先级确认

请告诉我应该先做哪些：

- [ ] **A. 紧急修复**（修复 skill_list 问题，1-2 小时）
- [ ] **B. 工具发现**（实现工具提示机制，1.5 小时）
- [ ] **C. 性能分析**（找出"执行别扭"的原因，2-3 小时）
- [ ] **D. 架构增强**（工具预设系统，4-6 小时）

### 2. 需求澄清

**关于"根据意图选择工具"**：

你期望的是：

- [ ] **静态推荐**：Agent 创建时 AI 自动推荐合适的工具
- [ ] **动态提示**：Agent 运行时在系统提示词中看到可用工具清单和使用建议
- [ ] **智能选择**：Agent 分析用户消息后，系统自动加载相关工具（更复杂）

**关于"执行别扭"**：

具体是什么环节不流畅：

- [ ] Agent 启动很慢（初始化时间长）
- [ ] 工具调用响应慢（等待时间长）
- [ ] 审批弹窗频繁（需要调整审批策略）
- [ ] Agent 执行步骤冗余（反复读同一个文件）
- [ ] 其他：\***\*\_\_\_\*\***

---

## 📂 生成的文件

1. **`docs/optimization-plan-tools-and-agent.md`**  
   完整的技术方案和实施细节

2. **`docs/optimization-summary.md`**  
   优化建议汇总，包含用户确认清单

3. **`scripts/analyze-agent-tools.js`**  
   Agent 配置分析脚本，生成问题报告

4. **`scripts/fix-agent-tools.js`**  
   Agent 配置自动修复脚本（已测试 dry-run）

5. **`docs/OPTIMIZATION_REPORT.md`**（本文件）  
   给用户的汇总报告

---

## 🎬 下一步

**请你确认**：

1. **立即修复**：是否现在就修复 `securities-trading-processor` 的配置？（5 分钟）
2. **代码防护**：是否实施方案 A（自动补充 skill_list），防止未来再出现此问题？（1 小时）
3. **工具发现**：是否实施方案 B（`<tool_discovery>` 提示块），满足"根据意图选择工具"需求？（1.5 小时）
4. **性能分析**：是否需要先分析性能瓶颈，再决定如何优化？（2-3 小时）

**确认后我会立即开始实施，不会再等待。**

---

## 附录：快速命令

```bash
# 查看 Agent 配置问题
node scripts/analyze-agent-tools.js

# 自动修复 Agent 配置（dry-run）
node scripts/fix-agent-tools.js --dry-run

# 应用修复
node scripts/fix-agent-tools.js

# 查看详细优化计划
cat docs/optimization-plan-tools-and-agent.md

# 查看优化建议汇总
cat docs/optimization-summary.md
```
