# 工具与 Agent 系统优化建议汇总

> 创建时间：2026-02-23  
> 分析依据：代码审查 + Agent 配置分析 + 用户反馈

---

## 核心问题（用户明确指出）

### 🔴 问题 1：Skill 查询能力缺失

**现象**：

创建 Agent 时配置了 `skills`，但工具列表中没有 `skill_list`，导致 Agent 无法发现和使用 Skill。

**实际案例**：

```json
// securities-trading-processor.json
{
  "tools": ["read", "write", "search", "glob", "exec", "memory"],
  "skills": ["crs-statement-extractor"] // 配置了 Skill
}
// ❌ 缺少 skill_list，Agent 根本不知道自己有 Skill 能力
```

**影响**：

- Agent 无法通过 `skill_list` → `read` SKILL.md 的标准流程使用 Skill
- Skill 配置形同虚设
- 当前受影响：**1 个 Agent**（`securities-trading-processor`）

---

### 🔴 问题 2：根据意图自动选择工具

**用户原话**：

> "根据意图选择工具应该是一个基础功能，一定要有"

**现状**：

- 完全依赖 Agent 配置文件中的静态 `tools` 列表
- 没有运行时的智能工具推荐或提示机制
- Agent 不清楚自己有哪些工具可用（除非记住配置）

**需求澄清**：

这个需求可以有两种理解，需要用户确认：

**理解 A：静态工具推荐（Agent 创建时）**

- AI 创建 Agent 时，根据任务描述自动推荐合适的工具
- 例如："代码审查 Agent" → 自动推荐 read, search, glob, write

**理解 B：动态工具推荐（Agent 运行时）**

- Agent 执行任务时，系统分析用户意图，动态提示可用工具
- 例如：用户说"帮我找一下配置文件" → 系统提示 Agent 可以用 glob 或 search

**当前实现**：

- AgentCreatorService 有基础的静态推荐（通过 LLM 的系统提示词）
- 没有运行时动态推荐

**建议方向**：

1. **短期（静态推荐优化）**：
   - 改进 AI 创建时的提示词，强化工具选择规则
   - 添加工具选择验证（如配置 skills 必须有 skill_list）

2. **长期（动态推荐）**：
   - 在系统提示词中注入 `<tool_discovery>` 块（列出所有可用工具 + 使用建议）
   - Agent 清楚知道自己有什么工具可用，按需使用

---

### 🟡 问题 3：执行效率低

**用户反馈**：

> "执行的还是特别别扭，特别的不高效的感觉"

**需要分析的具体点**：

1. **什么操作感觉慢/别扭？**
   - Agent 初始化时间长？
   - 工具调用响应慢？
   - 审批弹窗频繁打断？
   - 执行步骤冗余（如反复读同一个文件）？

2. **典型慢路径**：
   - Builder.build() → Runtime.initialize()（工具转换、Skill 加载、SDK 初始化）
   - executeToolPipeline()（审批等待、工具执行、结果序列化）
   - Skill 文件系统扫描（每次 Agent 创建都扫描）

**分析方法**：

- 添加性能埋点（`[Perf]` 日志）
- 分析实际执行日志，找出耗时最长的环节
- 生成性能报告

---

## 优化方案

### 方案 A：立即修复（P0）

这些是明确的 bug，应该立即修复。

#### A1. 自动补充 `skill_list` 工具 ⭐⭐⭐

**目标**：

确保所有配置了 `skills` 的 Agent 自动获得 `skill_list` 工具。

**修改位置**：

1. **`chat.ts` — `createBuilderFromDefinition()`**

```typescript
// 在第 101-116 行的工具过滤逻辑后添加：

// 自动补充必要的基础工具
if (def.skills && def.skills.length > 0) {
  // 配置了 skills 必须有 skill_list
  const hasSkillList = candidateTools.some((t) => t.name === 'skill_list');
  if (!hasSkillList) {
    const skillListTool = toolMap.get('skill_list');
    if (skillListTool) {
      candidateTools.push(skillListTool);
      log.info(`[createBuilderFromDefinition] Auto-added skill_list for agent ${def.id}`);
    }
  }
}
```

2. **`delegate-to-agent.ts` — `runSubAgent()`**

```typescript
// 在第 322-331 行的工具选择逻辑后添加相同的自动补充逻辑
```

3. **`AgentCreatorService.ts` — `buildSystemPrompt()`**

```typescript
// 在系统提示词中添加强制规则：
## ⚠️ 工具选择强制规则

1. 如果你选择了任何 Skill（skills 不为空），**必须**在 tools 中包含 `skill_list`
2. 否则 Agent 将无法发现和使用 Skill

验证你的输出：
- skills.length > 0 → tools 必须包含 "skill_list"
```

**测试**：

- 创建新 Agent，配置 skills，验证自动包含 skill_list
- 测试 delegate_to_agent 调用已有 Agent
- 测试 AI 创建 Agent（aiCreateAgent）

---

#### A2. 修复现有 Agent 配置 ⭐⭐

**问题 Agent**：

- `securities-trading-processor.json`（缺 skill_list）

**修复方法**：

```bash
# 方法 1：手动编辑
# 打开 .home/agents/securities-trading-processor.json
# 在 tools 数组中添加 "skill_list"

# 方法 2：脚本批量修复（可选）
```

**修复后配置**：

```json
{
  "tools": ["read", "write", "search", "glob", "exec", "memory", "skill_list"],
  "skills": ["crs-statement-extractor"]
}
```

---

#### A3. AI 创建验证增强 ⭐

**位置**：`src/main/ai/services/AgentCreatorService.ts`

**目标**：

在 LLM 返回结果后，后端自动验证和修复工具配置。

```typescript
// 在第 247-280 行的 JSON 解析后添加：

// 自动修复：skills 不为空但缺 skill_list
if (parsed.skills && parsed.skills.length > 0) {
  if (!parsed.tools || !parsed.tools.includes('skill_list')) {
    if (!parsed.tools) parsed.tools = [];
    parsed.tools.push('skill_list');
    log.info('[AgentCreatorService] Auto-fixed: added skill_list for skills');
  }
}

// 自动修复：文件操作工具但缺搜索工具
if (parsed.tools) {
  const hasFileOps = parsed.tools.some((t) => ['read', 'write', 'edit'].includes(t));
  const hasSearch = parsed.tools.includes('search');
  const hasGlob = parsed.tools.includes('glob');

  if (hasFileOps && !hasSearch) {
    parsed.tools.push('search');
    log.info('[AgentCreatorService] Auto-fixed: added search for file ops');
  }
  if (hasFileOps && !hasGlob) {
    parsed.tools.push('glob');
    log.info('[AgentCreatorService] Auto-fixed: added glob for file ops');
  }
}
```

---

### 方案 B：运行时工具发现（P1）

#### B1. 注入 `<tool_discovery>` 提示块 ⭐⭐⭐

**目标**：

让 Agent 清楚知道自己有哪些工具可用，如何使用。

**实施位置**：

`src/main/ai/AgentEnvInjector.ts` — `injectEnv()` 函数

**新增函数**：

```typescript
/**
 * 构建工具发现提示块
 *
 * 类似 skillDiscoveryHint，列出所有可用工具 + 使用建议。
 */
function buildToolDiscoveryHint(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  // 按分类分组
  const byCategory: Record<string, ToolDefinition[]> = {};
  for (const tool of tools) {
    const cat = tool.category || ToolCategory.Extension;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(tool);
  }

  const sections: string[] = [];

  for (const [category, tools] of Object.entries(byCategory)) {
    const categoryName = getCategoryDisplayName(category);
    const toolList = tools.map((t) => `- ${t.name} — ${t.description || 'No description'}`).join('\n');
    sections.push(`**${categoryName}** (${tools.length}):\n${toolList}`);
  }

  return `<tool_discovery>
You have ${tools.length} tools available:

${sections.join('\n\n')}

**Tool Usage Tips**:
- For code search, prefer \`search\` over \`exec grep\`
- For file discovery, use \`glob\` instead of \`exec find\`
- If you have Skills, use \`skill_list\` → \`read\` to discover them
- Use \`memory\` to save valuable knowledge for future sessions
- Use \`todo_write\` to track complex multi-step tasks
</tool_discovery>`;
}
```

**注入位置**：

```typescript
// 在 injectEnv() 的第 82-87 行附近：
const toolDiscoveryHint = buildToolDiscoveryHint(builder.getTools?.()); // 需要 Builder 暴露 getTools()
builder.appendInstructions(
  executionProtocol,
  runtimePathsBlock,
  ...(toolDiscoveryHint ? [toolDiscoveryHint] : []),
  ...(skillDiscoveryHint ? [skillDiscoveryHint] : []),
  ...(agentDiscoveryHint ? [agentDiscoveryHint] : [])
);
```

**效果**：

- Agent 每次启动时都能看到自己有哪些工具
- 工具按功能分类，便于快速定位
- 使用建议帮助 Agent 选择最优工具

---

### 方案 C：架构增强（P2）

#### C1. 工具预设（Tool Preset）系统 ⭐⭐

参见 `optimization-plan-tools-and-agent.md` 的详细设计。

**核心价值**：

- 简化 Agent 配置（不用手动列举 10+ 个工具）
- 确保基础工具不会被遗漏
- 支持增量修改（`+exec`, `-edit`）

**实施复杂度**：中等

**优先级**：中（可以先做 A 和 B 方案）

---

#### C2. 执行效率性能分析 📊

**步骤**：

1. 添加性能埋点（`[Perf]` 日志）
2. 分析典型执行场景的耗时分布
3. 生成性能报告
4. 针对性优化慢路径

**埋点位置**：

- `AgentExecutor.execute()` — 总耗时
- `Builder.build()` — 构建耗时
- `Runtime.initialize()` — 初始化耗时
  - `convertTools()` — 工具转换
  - `SkillManager.scanSkills()` — Skill 扫描
  - SDK 初始化（PiMono / OpenAI）
- `executeToolPipeline()` — 工具执行
  - `before_tool_call` Hook — 审批检查
  - Tool.execute() — 实际执行
  - 结果序列化

**输出格式**：

```
[Perf] AgentExecutor.execute | sessionId=xxx | total=1234ms
[Perf] ├─ Builder.build | 123ms
[Perf] ├─ Runtime.initialize | 456ms
[Perf] │  ├─ convertTools (12 tools) | 100ms
[Perf] │  ├─ scanSkills (5 skills) | 50ms
[Perf] │  └─ SDK init | 306ms
[Perf] └─ Runtime.execute | 655ms
[Perf]    ├─ Tool: read (3x) | avg=20ms, total=60ms
[Perf]    ├─ Tool: search (1x) | 180ms
[Perf]    └─ Tool: exec (1x) | 415ms (includes approval wait)
```

**优先级**：高（了解"别扭"的具体原因）

---

### 方案 D：前端配置优化 ⚙️

#### D1. Agent 工具配置界面

**现状**：

- Agent 配置只能通过 JSON 文件编辑
- 容易遗漏必要工具

**优化方向**：

1. **工具选择器**：
   - 多选框，显示所有可用工具
   - 自动验证（配置 skills 必须选 skill_list）
   - 显示工具描述和分类

2. **智能建议**：
   - 根据 Agent 的 description 推荐工具
   - 显示警告（如"配置了 skills 但未选 skill_list"）

**优先级**：低（可以先用命令行工具或手动编辑）

---

## 实施建议

### 阶段 1：紧急修复（立即）

- [ ] **A1. 代码修复**：自动补充 skill_list（3 个文件，预计 1 小时）
- [ ] **A2. 数据修复**：修复 `securities-trading-processor.json`（1 分钟）
- [ ] **A3. AI 创建增强**：添加后端验证逻辑（30 分钟）
- [ ] **测试**：创建测试用例，确保问题不再出现（30 分钟）

**预计总时间**：2 小时

---

### 阶段 2：工具发现优化（重要）

- [ ] **B1. 实现 `<tool_discovery>` 块**（1 小时）
  - 添加 `buildToolDiscoveryHint()` 函数
  - 在 `injectEnv()` 中注入提示块
  - 测试 Agent 是否能感知工具
- [ ] **优化 AI 创建提示词**（30 分钟）
  - 强化工具选择规则
  - 添加使用建议和最佳实践

**预计总时间**：1.5 小时

---

### 阶段 3：性能分析（关键）

- [ ] **C2. 添加性能埋点**（1-2 小时）
  - 在关键路径添加计时日志
  - 实现性能数据收集
- [ ] **分析实际数据**（1 小时）
  - 运行典型场景，收集日志
  - 生成性能报告
  - 识别瓶颈
- [ ] **针对性优化**（待定）
  - 根据分析结果确定具体优化措施

**预计总时间**：2-3 小时 + 后续优化

---

### 阶段 4：架构增强（可选）

- [ ] **C1. 工具预设系统**（4-6 小时）
  - 设计 preset 结构
  - 修改类型定义和解析逻辑
  - 迁移现有 Agent 配置
- [ ] **D1. Agent 配置编辑器**（6-8 小时）
  - 设计前端界面
  - 实现工具选择器
  - 添加智能验证和建议

**预计总时间**：10-14 小时

---

## 用户确认清单

在开始实施前，请确认：

### 1. 优先级确认

- [ ] **阶段 1（紧急修复）**：立即开始？
- [ ] **阶段 2（工具发现）**：重要吗？
- [ ] **阶段 3（性能分析）**：是否优先处理"执行别扭"的问题？
- [ ] **阶段 4（架构增强）**：可以后续规划

### 2. 需求澄清

**关于"根据意图选择工具"**：

你期望的是：

- [ ] **A. 静态推荐**：Agent 创建时 AI 自动推荐合适的工具
- [ ] **B. 动态推荐**：Agent 运行时系统提示可用工具和使用建议
- [ ] **C. 两者都要**：创建时推荐 + 运行时提示

**关于"执行别扭"**：

具体是哪个环节感觉慢/不流畅：

- [ ] Agent 启动很慢（初始化时间长）
- [ ] 工具调用响应慢（等待时间长）
- [ ] 审批弹窗频繁打断（需要调整审批策略）
- [ ] Agent 执行步骤冗余（如反复读同一个文件）
- [ ] 其他：\***\*\_\_\_\*\***

---

## 分析数据

**工具使用频率统计**（11 个 Agent）：

| 工具           | 使用次数 | 占比      | 说明               |
| -------------- | -------- | --------- | ------------------ |
| read           | 10       | 90.9%     | 最常用             |
| search         | 9        | 81.8%     | 几乎必备           |
| write          | 8        | 72.7%     | 常用               |
| memory         | 6        | 54.5%     | 半数以上需要       |
| glob           | 5        | 45.5%     | 不到一半使用       |
| exec           | 3        | 27.3%     | 少数需要           |
| **skill_list** | **2**    | **18.2%** | ⚠️ 使用率低        |
| config_get     | 1        | 9.1%      | 仅 app-copilot     |
| config_patch   | 1        | 9.1%      | 仅 app-copilot     |
| edit           | 1        | 9.1%      | 很少使用           |
| **todo_write** | **0**    | **0%**    | ⚠️ 没有 Agent 使用 |
| **task_plan**  | **0**    | **0%**    | ⚠️ 没有 Agent 使用 |

**观察**：

- `read`, `search`, `write` 是最常用的三件套
- `skill_list` 使用率很低（18.2%），与 Skill 配置率（27.3%）不匹配 → 证实问题存在
- `todo_write`, `task_plan` 零使用 → 可能这些工具不够实用，或 Agent 不知道它们的价值

---

## 附录：详细优化计划

完整的优化方案和技术细节，请查看：

- **`docs/optimization-plan-tools-and-agent.md`** — 完整技术方案
- **`scripts/analyze-agent-tools.js`** — Agent 配置分析脚本
