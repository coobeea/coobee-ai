# 工具与 Agent 系统优化清单

> 创建时间：2026-02-23  
> 状态：待确认（**请先确认优化方向，不要立即改代码**）

---

## 问题分析

### 1. Skill 查询能力缺失 ⚠️ 【高优先级】

**现象**：

- Agent 配置了 `skills`，但工具列表中没有 `skill_list` 工具
- 导致 Agent 无法发现自己可以查询和使用 Skill
- 例如：`securities-trading-processor.json` 配置了 `skills: ["crs-statement-extractor"]`，但工具列表是 `["read", "write", "search", "glob", "exec", "memory"]` — 缺少 `skill_list`

**影响**：

- Agent 根本不知道自己有 Skill 能力
- 无法通过 `skill_list` → `read` SKILL.md 的标准流程使用 Skill
- Skill 配置形同虚设

**根因**：

- `chat.ts` 第 103-116 行：从 agent.tools 精确加载工具，没有自动补充 `skill_list`
- `delegate-to-agent.ts` 第 322-331 行：子 Agent 同样的问题
- `AgentCreatorService.ts`：AI 创建 Agent 时没有自动添加必要的基础工具

---

### 2. 根据意图自动选择工具 ⚠️ 【高优先级】

**用户需求**：

> "根据意图选择工具应该是一个基础功能，一定要有"

**现状**：

- 完全依赖用户或 AI 创建时手动指定工具列表
- 没有运行时的智能工具推荐机制
- Agent 定义的 `tools` 字段是静态的

**优化方向**：

1. **静态智能选择**（Agent 创建时）
   - AI 创建时根据 instructions 和 description 自动推荐工具
   - 基于规则的工具推荐（如包含"文件"→ 推荐 read/write/edit）

2. **动态智能推荐**（运行时）
   - Agent 执行时分析用户意图，推荐可能需要的工具
   - 通过系统提示词注入：`<available_tools>` 块（类似现在的 `<skill_discovery>`）
   - 工具分类标签化（已有 `ToolCategory`），方便按意图匹配

---

### 3. 基础工具自动补充 🔧 【中优先级】

**问题**：

- 很多 Agent 缺少应该默认拥有的基础工具
- 导致 Agent 功能受限，无法自我管理

**基础工具清单**：

| 工具         | 用途       | 应该默认给谁                 |
| ------------ | ---------- | ---------------------------- |
| `skill_list` | 发现 Skill | 所有配置了 `skills` 的 Agent |
| `memory`     | 记忆管理   | 所有需要长期记忆的 Agent     |
| `todo_write` | 任务管理   | Agent 模式（非 chat）        |
| `task_plan`  | 任务规划   | Agent 模式（非 chat）        |
| `search`     | 内容搜索   | 几乎所有需要文件操作的 Agent |
| `glob`       | 文件名搜索 | 几乎所有需要文件操作的 Agent |
| `read`       | 读取文件   | 几乎所有 Agent（除纯对话型） |

**优化建议**：

```typescript
// 在 chat.ts 的 createBuilderFromDefinition 中：
function autoAddEssentialTools(configuredTools: string[] | undefined, agentDef: AgentDefinition): string[] {
  const tools = new Set(configuredTools || []);

  // 1. 如果配置了 skills，自动添加 skill_list
  if (agentDef.skills && agentDef.skills.length > 0) {
    tools.add('skill_list');
  }

  // 2. Agent 模式默认添加任务管理工具
  if (agentMode === 'agent') {
    tools.add('todo_write');
    tools.add('task_plan');
  }

  // 3. 如果有文件操作工具，自动补充搜索工具
  if (tools.has('read') || tools.has('write') || tools.has('edit')) {
    tools.add('search');
    tools.add('glob');
  }

  return Array.from(tools);
}
```

---

### 4. 工具集（Tool Preset）概念 💡 【中优先级】

**问题**：

- 每个 Agent 都要手动配置完整的工具列表
- 配置冗余，容易遗漏关键工具

**优化方向**：

引入预设工具集，简化配置：

```json5
{
  id: 'my-agent',
  name: '我的 Agent',
  toolPreset: 'basic', // 新增字段
  tools: ['+exec', '+memory'], // 在 preset 基础上增加工具
  // 或
  tools: ['-edit'] // 在 preset 基础上移除工具
}
```

**预设工具集定义**：

- **minimal**：`[]` — 纯对话，无工具
- **basic**：`[read, write, search, glob, skill_list]` — 基础文件操作
- **standard**：`basic + [edit, memory, todo_write, task_plan]` — 标准 Agent
- **advanced**：`standard + [exec, process]` — 完整能力
- **full**：所有可用工具（默认行为，向后兼容）

**Schema 变更**：

```typescript
// agents/types.ts
export interface AgentDefinition {
  // ... 现有字段 ...

  /** 工具预设（可选，默认 full） */
  toolPreset?: 'minimal' | 'basic' | 'standard' | 'advanced' | 'full';

  /**
   * 工具列表（可选）
   * - 未定义 = 使用 toolPreset 定义的工具集
   * - 字符串数组 = 精确工具列表（覆盖 preset）
   * - 前缀 '+' = 在 preset 基础上添加（如 "+exec"）
   * - 前缀 '-' = 在 preset 基础上移除（如 "-exec"）
   */
  tools?: string[];
}
```

---

### 5. AI 创建 Agent 时的工具选择优化 🤖 【中优先级】

**问题**：

`AgentCreatorService.ts` 生成的 Agent 工具列表可能不完善：

- 没有自动添加 `skill_list`（即使选择了 skills）
- 没有根据意图智能推荐基础工具

**优化建议**：

修改 `buildSystemPrompt` 中的提示词：

```typescript
#### 工具选择原则（重要！）

1. **基础工具**（几乎所有 Agent 都需要）：
   - `read` — 读取文件（分析、审查、处理都需要）
   - `search` + `glob` — 发现和查找文件

2. **Skill 相关**：
   - 如果选择了任何 Skill，**必须**包含 `skill_list` 工具
   - 否则 Agent 无法发现和使用 Skill

3. **任务管理**（Agent 模式推荐）：
   - `todo_write` — 管理任务清单
   - `task_plan` — 任务规划

4. **记忆管理**：
   - `memory` — 如果 Agent 需要记住经验、偏好等

5. **写操作**：
   - `write` — 需要输出报告/文件
   - `edit` — 需要修改已有文件

6. **执行能力**：
   - `exec` — 需要运行脚本、测试、编译等
   - `process` — 需要后台进程管理

7. **特殊能力**：
   - `delegate_to_agent` — 元 Agent（可创建/调用其他 Agent）

**验证规则**：
- 如果 skills 不为空，tools 中必须包含 skill_list
- 如果 tools 包含文件操作（read/write/edit），建议包含 search 和 glob
```

---

### 6. 运行时工具推荐提示 💬 【低优先级】

**概念**：

在系统提示词中注入可用工具的结构化清单，类似现在的 `<skill_discovery>`：

```xml
<tool_discovery>
You have the following tools available (12 total):

**File Operations**:
- read — Read file contents
- write — Create or overwrite file
- edit — Modify existing file
- search — Search file content by pattern
- glob — Find files by name pattern

**Execution**:
- exec — Execute shell commands
- process — Manage background processes

**Discovery & Planning**:
- skill_list — List available Skills
- todo_write — Manage task checklist
- task_plan — Plan task execution

**Memory**:
- memory — Store and retrieve long-term knowledge

**Agent Management**:
- delegate_to_agent — Delegate tasks to specialist agents

Use tools when needed to accomplish tasks. For file operations, prefer search+read over exec+cat.
</tool_discovery>
```

**效果**：

- Agent 清楚知道自己有哪些工具可用
- 工具按功能分组，便于快速定位
- 提供使用建议（如优先用 search 而不是 exec grep）

---

### 7. Extension 工具的可发现性 🔌 【低优先级】

**问题**：

- Extension 贡献的工具（如 `config_get`, `config_patch`）没有在系统提示词中体现
- Agent 不知道这些工具的存在

**优化方向**：

1. 在 `<tool_discovery>` 块中区分 builtin 和 extension 工具
2. Extension 工具自带分类和描述
3. 动态注入到系统提示词

---

### 8. 执行效率优化 🚀 【需进一步分析】

**用户反馈**：

> "执行的还是特别别扭，特别的不高效的感觉"

**需要分析的点**：

1. **工具转换性能**：
   - `convertTools` 在每个 Agent 初始化时执行
   - 检查是否有重复转换或不必要的开销

2. **Skill 加载性能**：
   - `SkillManager.scanSkills()` 扫描文件系统
   - 是否可以缓存结果？

3. **审批流程延迟**：
   - `tool-approval` Extension 的 `before_tool_call` Hook
   - 审批弹窗的响应时间

4. **Runtime 初始化开销**：
   - 每次消息都创建新 Runtime（无状态设计）
   - PiMono SDK 的初始化时间（model registry, session manager 等）

5. **事件系统开销**：
   - EventBus、StreamEmitter、AgentEventWriter 的链路
   - 是否有不必要的序列化/反序列化

**分析方法**：

- 添加性能埋点（`performance.now()` 计时）
- 在关键路径上记录耗时：
  - Builder.build() → Runtime.initialize() → execute()
  - 工具转换、Skill 加载、审批等待
- 生成性能报告

---

## 优化方案汇总

### A. 立即可做（修复明确问题）

#### A1. 自动补充 `skill_list` 工具 ⭐⭐⭐

**位置**：

- `src/main/gateway/methods/chat.ts` — `createBuilderFromDefinition()`
- `src/main/ai/tools/builtin/delegate-to-agent.ts` — `runSubAgent()`
- `src/main/ai/services/AgentCreatorService.ts` — `buildSystemPrompt()`

**修改逻辑**：

```typescript
// 在 createBuilderFromDefinition 和 runSubAgent 中：
if (agentDef.skills && agentDef.skills.length > 0) {
  // 如果配置了 skills，自动添加 skill_list
  if (agentDef.tools && !agentDef.tools.includes('skill_list')) {
    candidateTools.push(toolMap.get('skill_list'));
  }
}
```

**测试点**：

- 创建一个配置了 skills 但没有 skill_list 的 Agent
- 验证 Agent 能调用 skill_list 工具
- 验证 Agent 能读取并使用 Skill

---

#### A2. 批量修复现有 Agent 配置 ⭐⭐

**问题 Agent 列表**：

扫描 `.home/agents/*.json` 和 `agents/*.json`，找出所有 `skills` 不为空但 `tools` 中缺少 `skill_list` 的 Agent：

```bash
# 需要修复的 Agent（初步分析）
.home/agents/securities-trading-processor.json  # 有 skills，缺 skill_list
# ... 其他类似的 ...
```

**修复方法**：

- 手动或脚本批量添加 `skill_list` 到这些 Agent 的 tools 列表
- 同时添加其他基础工具（memory, search, glob）

---

#### A3. AI 创建提示词优化 ⭐⭐⭐

**位置**：`src/main/ai/services/AgentCreatorService.ts` — `buildSystemPrompt()`

**修改**：

在工具选择原则中添加强制规则：

```markdown
#### 工具选择原则（重要！）

【新增】**自动规则**（LLM 必须遵守）：

1. 如果你选择了任何 Skill（skills 不为空），**必须**在 tools 中包含 `skill_list`
2. 如果你选择了文件操作工具（read/write/edit），**建议**包含 `search` 和 `glob`
3. 对于 Agent 模式（非纯对话），**建议**包含 `todo_write` 和 `task_plan`

【保留】从可用工具中选择 Agent 真正需要的工具...
```

---

### B. 架构优化（需设计和测试）

#### B1. 工具预设（Tool Preset）系统 ⭐⭐

**目标**：

- 简化 Agent 配置
- 减少工具列表冗余
- 确保基础工具不会被遗漏

**设计**：

参见上文"工具集（Tool Preset）概念"章节。

**实施步骤**：

1. 定义预设常量（`src/main/ai/tools/presets.ts`）
2. 修改 `AgentDefinition` 类型，添加 `toolPreset` 字段
3. 修改 `createBuilderFromDefinition`，支持 preset 解析
4. 更新 `AgentCreatorService` 提示词，引导 LLM 使用 preset
5. 迁移现有 Agent 配置（可选，向后兼容）

**优先级**：中（需要设计讨论）

---

#### B2. 工具智能推荐（运行时） ⭐⭐⭐

**概念**：

在系统提示词中动态生成 `<tool_discovery>` 块（类似 `<skill_discovery>`）：

```xml
<tool_discovery>
You have 12 tools available:

**File Operations** (5):
- read — Read file contents (any file type)
- write — Create or overwrite file
- edit — Modify existing file with strategic replacements
- search — Search file content by regex pattern
- glob — Find files by name pattern

**Execution** (2):
- exec — Execute shell commands (requires approval for unsafe commands)
- process — Manage long-running background processes

**Discovery** (1):
- skill_list — List all available Skills (read SKILL.md to use them)

**Planning** (2):
- todo_write — Manage session-level task checklist
- task_plan — Plan and track task execution

**Memory** (1):
- memory — Store/retrieve long-term knowledge across sessions

**Agent Management** (1):
- delegate_to_agent — Delegate sub-tasks to specialist agents

**Tool Usage Tips**:
- For code search, prefer `search` over `exec grep`
- For file discovery, use `glob` instead of `exec find`
- If you have Skills, use `skill_list` → `read` to discover them
- Use `memory` to save valuable knowledge for future sessions
</tool_discovery>
```

**实施位置**：

`src/main/ai/AgentEnvInjector.ts` — `injectEnv()` 函数，在 `skillDiscoveryHint` 后添加 `toolDiscoveryHint`

**优先级**：高（用户明确要求）

---

#### B3. 执行效率性能分析 📊 【需数据】

**目标**：

找出执行过程中的性能瓶颈。

**分析方法**：

1. **添加性能埋点**：
   - `AgentExecutor.execute()` — 总耗时
   - `Builder.build()` — 构建耗时
   - `Runtime.initialize()` — 初始化耗时（工具转换、Skill 加载）
   - `SkillManager.scanSkills()` — Skill 扫描耗时
   - `executeToolPipeline()` — 工具执行耗时（含审批等待）
   - `before_tool_call` Hook — 审批检查耗时

2. **日志格式**：

   ```
   [Perf] AgentExecutor.execute | total=1234ms
   [Perf] ├─ Builder.build | 123ms
   [Perf] ├─ Runtime.initialize | 456ms
   [Perf] │  ├─ convertTools | 100ms
   [Perf] │  ├─ scanSkills | 50ms
   [Perf] │  └─ SDK init | 306ms
   [Perf] └─ Runtime.execute | 655ms
   ```

3. **创建性能报告 Skill**：
   - 分析 events.jsonl 中的时间戳
   - 生成可视化的性能火焰图
   - 识别慢路径

**实施优先级**：

- 先添加基础埋点（立即可做）
- 再分析数据，定位瓶颈
- 最后针对性优化

---

#### B4. Skill 加载缓存 💾 【低优先级】

**问题**：

- 每次创建 Agent 都扫描文件系统加载 Skill
- 对于大量 Skill 可能有性能影响

**优化方向**：

1. 全局 Skill 缓存（进程级）
2. 监听文件变化，invalidate 缓存
3. 按需加载（只加载 Agent 配置的 skills）

**注意**：

- 需要权衡缓存收益 vs 复杂度
- 先做性能分析（B3），确认是瓶颈再优化

---

#### B5. 工具执行管线优化 🔄 【低优先级】

**潜在优化点**：

1. **并行工具调用**：
   - 某些工具调用可以并行（如多个 read）
   - 需要 SDK 支持或手动实现

2. **工具结果缓存**：
   - 同一个会话中重复的 read 操作可以缓存
   - 需要 invalidation 策略（如文件被 write 后）

3. **审批流程优化**：
   - 预判可能需要审批的工具，提前发起请求
   - 批量审批（一次确认多个工具调用）

---

### C. 配置工具优化 ⚙️ 【低优先级】

#### C1. 前端配置界面增强

**现状**：

- 基本配置页面已有"命令执行审批"设置
- 缺少其他高频配置项的快捷入口

**优化方向**：

1. **沙箱模式设置**：
   - `security.sandbox.mode`：off / path-only / docker
   - 前端添加单选框

2. **审批超时设置**：
   - `security.approvals.timeoutMs`：默认 300000ms（5分钟）
   - 前端添加滑块或输入框

3. **日志级别设置**：
   - `logging.level`：debug / info / warn / error
   - 前端添加下拉框

4. **思维链级别设置**：
   - `models.defaults.thinkingLevel`：minimal / low / medium / high / xhigh
   - 前端添加滑块

---

#### C2. Agent 配置编辑器增强

**现状**：

- Agent 配置只能通过 JSON 文件手动编辑

**优化方向**：

1. **前端 Agent 编辑界面**：
   - 工具选择：多选框（自动补充基础工具）
   - Skill 选择：多选框（从 skill_list 加载）
   - 模型选择：下拉框（从 Provider 加载）

2. **配置验证**：
   - 前端实时校验（如 tools 引用的工具是否存在）
   - 显示警告（如配置了 skills 但缺 skill_list）

---

### D. Skill 系统优化 📚 【低优先级】

#### D1. Skill 热加载

**问题**：

- 修改 Skill 后需要重启 Agent 或应用

**优化方向**：

- 监听 Skill 文件变化，自动 invalidate SkillManager 缓存
- 下次 Agent 执行时自动加载最新版本

---

#### D2. Skill 依赖管理

**问题**：

- Skill 之间可能有依赖关系
- 缺少依赖声明和自动加载机制

**优化方向**：

```yaml
# SKILL.md frontmatter
---
name: eval-refine-loop
dependencies:
  - dimension-architect # 依赖的其他 Skill
---
```

---

## 优先级总结

### 🔴 立即修复（P0）

1. **A1. 自动补充 `skill_list` 工具** — 修复核心功能缺失
2. **A2. 批量修复现有 Agent 配置** — 让现有 Agent 恢复 Skill 能力
3. **A3. AI 创建提示词优化** — 避免未来创建的 Agent 重蹈覆辙

### 🟡 重要优化（P1）

4. **B2. 工具智能推荐（运行时）** — 满足用户明确需求"根据意图选择工具"
5. **B3. 执行效率性能分析** — 定位"执行别扭"的具体原因

### 🟢 架构增强（P2）

6. **B1. 工具预设系统** — 简化配置，减少出错
7. **A2. 基础工具自动补充** — 提升 Agent 能力完整性
8. **B5. 运行时工具推荐提示** — 改善 Agent 的工具使用体验

### 🔵 长期改进（P3）

9. C1. 前端配置界面增强
10. C2. Agent 配置编辑器增强
11. D1. Skill 热加载
12. D2. Skill 依赖管理

---

## 下一步

1. **请确认优先处理的优化项**（建议从 P0 开始）
2. **确认后再开始修改代码**
3. 每个优化项独立实现、测试、提交

---

## 附录：受影响的 Agent 列表

需要检查的 Agent（可能需要修复 tools 配置）：

```bash
# 在 .home/agents/ 和 agents/ 目录下
- securities-trading-processor.json  # 有 skills: ["crs-statement-extractor"]，缺 skill_list
- deep-learning-assistant.json       # tools 可能不完整
- decision-advisor.json
- implementation-planner.json
- risk-assessor.json
- business-analyst.json
- performance-analyzer.json
- prompt-optimizer.json
```

需要逐个检查：

1. 是否配置了 skills 但缺 skill_list
2. 是否缺少基础工具（memory, search, glob 等）
3. 是否需要调整 toolPreset（如果实施 B1 方案）
