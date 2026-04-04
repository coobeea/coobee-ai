# Agent 级别的 Skills（Agent-Level Skills）

## 概述

每个 Agent 现在可以拥有自己专属的 Skill 目录，用于存放该 Agent 领域特定的技能。这使得不同的 Agent 可以拥有各自独立的技能集，互不干扰。

## 目录结构

```
.home/
├── homes/
│   └── {agentId}/          # 每个 Agent 的 Home 目录
│       ├── SOUL.md
│       ├── IDENTITY.md
│       ├── USER.md
│       ├── AGENTS.md
│       ├── memory/         # Agent 级记忆
│       └── skills/         # 🆕 Agent 级专属技能（新增）
│           └── {skill-name}/
│               ├── SKILL.md
│               ├── scripts/
│               └── references/
```

## Skill 加载优先级

Skill 加载按以下优先级顺序（后者覆盖前者）：

1. **内置 Skills**（`skills/`）— 最低优先级，系统内置
2. **用户级 Skills**（`.home/skills/`）— 用户自定义，覆盖内置
3. **Agent 级 Skills**（`.home/homes/{agentId}/skills/`）— Agent 专属，覆盖用户级
4. **工作空间级 Skills**（`.home/workspaces/{sessionId}/skills/`）— 最高优先级，会话临时定制

## 使用场景

### 场景 1：创建专业领域 Agent

假设你想创建一个"增值税助手" Agent，它需要专门的税务相关技能：

```bash
# 1. 创建 Agent（通过 HTTP API 或 AI Creator）
POST /gateway/agents
{
  "id": "tax-assistant",
  "name": "增值税助手",
  "description": "专业的增值税咨询和计算助手"
}

# 2. 在 Agent Home 下创建专属 Skill
.home/homes/tax-assistant/skills/
├── tax-calculator/
│   ├── SKILL.md
│   └── scripts/
│       ├── calculate-vat.py
│       └── validate-invoice.py
└── tax-regulations/
    ├── SKILL.md
    └── references/
        └── vat-regulations-2026.md
```

### 场景 2：不同 Agent 使用不同版本的 Skill

假设你有两个 Agent：

- **Agent A**（保守型）：使用旧版本的某个 Skill
- **Agent B**（激进型）：使用最新实验版本的同名 Skill

```
.home/homes/agent-a/skills/
└── data-processor/
    └── SKILL.md  # 旧版本，稳定但功能少

.home/homes/agent-b/skills/
└── data-processor/
    └── SKILL.md  # 新版本，功能多但可能有 bug
```

两个 Agent 可以使用同名但不同实现的 Skill，互不干扰。

## 创建 Agent 级 Skill

### 方法 1：手动创建

```bash
# 假设 Agent ID 为 "my-agent"
cd .home/homes/my-agent/skills/
mkdir my-custom-skill
cd my-custom-skill
cat > SKILL.md <<'EOF'
---
name: my-custom-skill
description: My custom skill for this agent
---

# My Custom Skill

This skill is only available to "my-agent".

## Usage
...
EOF
```

### 方法 2：让 Agent 自己创建

向 Agent 发送请求：

```
User: 请在你的 skills 目录下创建一个新的 Skill，名为 "domain-expert"

Agent: [调用 write 工具]
write({
  path: "$agentHome/skills/domain-expert/SKILL.md",
  content: "..."
})
```

Agent 可以通过 `$agentHome` 环境变量（或从 `formatRuntimePaths` 获取）找到自己的 Home 目录。

## 验证 Agent 级 Skill 加载

启动 Agent 后，调用 `skill_list` 工具，检查输出中是否包含 Agent 专属的 Skill：

```javascript
// Agent 运行时日志示例
[SkillManager] 扫描加载 15 个 Skill:
  - execution-protocol (builtin)
  - self-reflection (builtin)
  - tax-calculator (agent-level)  // ✅ Agent 专属
  - tax-regulations (agent-level) // ✅ Agent 专属
  - my-workspace-skill (workspace)
```

## 实现细节

### 核心修改

1. **AgentHomeManager**：在 `initHome()` 时创建 `skills/` 子目录
2. **Env.getSkillSearchPaths()**：新增 `agentHome` 参数，扫描 `{agentHome}/skills/`
3. **AgentEnvInjector**：在构建环境时，如果有 `agentId`，将 Agent Home skills 路径传入
4. **buildAgentEnv()**：接受 `agentHome` 参数，并传递给 `getSkillSearchPaths()`

### 兼容性

- **向后兼容**：如果 Agent 没有 `agentId`（如临时 Agent、匿名 Agent），不会加载 Agent 级 Skills
- **性能优化**：Skill 扫描仍使用缓存机制（30 秒 TTL）
- **测试用例**：现有测试不受影响（因为 `agentHome` 参数是可选的）

## 最佳实践

### ✅ 推荐

- **领域专属技能**：将税务、医疗、法律等领域的专业 Skill 放在对应 Agent 的 Home 下
- **Agent 个性化**：不同 Agent 可以有自己偏好的工具版本（如不同的代码风格检查器）
- **敏感数据隔离**：涉及敏感数据的 Skill 可以专属于某个 Agent，避免全局暴露

### ❌ 避免

- **通用工具**：通用的、所有 Agent 都可能用到的 Skill（如 `git`、`npm`）应放在内置或用户级，不要在每个 Agent Home 下重复
- **过度定制**：不要为每个 Agent 都创建大量专属 Skill，除非确实有必要

## FAQ

### Q: Agent 级 Skills 和工作空间级 Skills 有什么区别？

**Agent 级 Skills**：

- 位置：`.home/homes/{agentId}/skills/`
- 生命周期：跨会话持久化，只要 Agent 存在就一直可用
- 作用域：只对特定 Agent 可见
- 用途：Agent 的核心能力、领域专业技能

**工作空间级 Skills**：

- 位置：`.home/workspaces/{sessionId}/skills/`
- 生命周期：会话级，会话结束后可能被清理
- 作用域：只对当前会话可见
- 用途：临时实验、一次性任务的定制 Skill

### Q: 如何让多个 Agent 共享同一个 Skill？

如果多个 Agent 都需要某个 Skill，应该将其放在**用户级 Skills**（`.home/skills/`）或**内置 Skills**（`skills/`）中，而不是在每个 Agent Home 下重复创建。

### Q: Agent 级 Skills 会被 Extension 系统识别吗？

不会。Extension 系统只扫描全局 Extension 目录（`extensions/`、`.home/extensions/`）。Agent 级 Skills 只是 Skill 系统的一部分，不涉及 Extension 生命周期管理。

### Q: 如何调试 Agent 级 Skill 加载问题？

启动应用时，查看日志中的 Skill 扫描信息：

```
[SkillManager] 扫描加载 X 个 Skill: skill1, skill2, ...
```

如果 Agent 级 Skill 没有出现，检查：

1. `{agentHome}/skills/{skill-name}/SKILL.md` 文件是否存在
2. SKILL.md 的 frontmatter 格式是否正确
3. Agent 是否有 `agentId`（临时 Agent 不会加载 Agent 级 Skills）

## 示例代码

### Python Skill 示例（Agent 专属）

`.home/homes/data-analyst/skills/data-cleaner/SKILL.md`：

````markdown
---
name: data-cleaner
description: 专为数据分析师 Agent 定制的数据清洗工具
---

# Data Cleaner Skill

此 Skill 只对 "data-analyst" Agent 可见。

## Scripts

- `scripts/clean-csv.py` - 清洗 CSV 文件
- `scripts/deduplicate.py` - 去重

## Usage

\```bash
python scripts/clean-csv.py input.csv output.csv
\```
````

### JavaScript Skill 示例（Agent 专属）

`.home/homes/frontend-dev/skills/component-generator/SKILL.md`：

````markdown
---
name: component-generator
description: 为前端开发 Agent 定制的 React 组件生成器
---

# Component Generator

为 "frontend-dev" Agent 专属的 React 组件生成工具。

## Scripts

- `scripts/generate-component.js` - 生成 React 组件骨架

## Usage

\```bash
node scripts/generate-component.js MyComponent
\```
````

---

**总结**：Agent 级 Skills 机制让每个 Agent 可以拥有自己的专属技能库，提升了系统的灵活性和可定制性。适合创建领域专家 Agent、实现多版本 Skill 共存、以及敏感数据隔离等场景。
