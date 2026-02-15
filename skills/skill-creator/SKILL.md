---
name: skill-creator
description: 指导 Agent 创建新的 Skill。当用户要求创建新技能、编写操作手册、或 Agent 需要记录可复用的工作流程时使用。
---

# Skill Creator

## 什么是 Skill

Skill 是一段场景化的操作手册（Markdown 文件），告诉 Agent 遇到特定场景时应该如何行动。

- Skill **不是代码**，是自然语言指导
- Skill 通过 `read` 工具读取后遵循，不需要注册或编译
- Skill 适合描述多步骤流程、领域知识、工具组合方式

## 何时创建 Skill

- 用户明确要求："帮我做一个能 xxx 的技能"
- 发现自己反复执行相同的操作流程
- 需要记录特定平台/工具的使用方法
- 需要为特定项目定制操作规范

## 创建步骤

### 1. 确定存放位置

| 场景                    | 路径                                       |
| ----------------------- | ------------------------------------------ |
| 仅当前会话可用          | `{workspace}/skills/{skill-name}/SKILL.md` |
| 所有会话可用（用户级）  | `{userSkillsDir}/{skill-name}/SKILL.md`    |
| 作为 Extension 的一部分 | 在 Extension 的 `skills/` 子目录中         |

优先使用工作空间级（`{workspace}/skills/`），除非用户明确要求全局可用。

### 2. 创建目录结构

```
{target}/my-skill/
├── SKILL.md              # 必须 — 主文件
├── references/           # 可选 — 参考资料、示例文件
└── scripts/              # 可选 — 辅助脚本
```

### 3. 编写 SKILL.md

使用以下模板：

````markdown
---
name: Skill 名称
description: 一句话描述，清楚说明何时使用。系统根据这段描述匹配场景。
---

# Skill 标题

## 使用场景

描述何时应该使用这个 Skill：

- 场景 1...
- 场景 2...

## 前提条件

使用此 Skill 前需要满足的条件：

- 条件 1（如：需要安装 xxx）
- 条件 2（如：需要配置 xxx）

## 操作步骤

### 步骤 1：xxx

详细描述操作...

```bash
# 如果涉及命令，给出具体命令
具体命令
```
````

### 步骤 2：xxx

详细描述操作...

## 注意事项

- 重要警告或常见陷阱
- 平台差异说明（如 macOS vs Linux）
- 安全注意事项

## 示例

给出一个完整的使用示例，展示从头到尾的操作过程。

````

## 编写原则

### description 要精准

`description` 是系统匹配 Skill 的关键。要：
- 明确说明**触发场景**，而不是泛泛描述功能
- 包含关键词，便于匹配

好的 description：
- "操作 GitHub Issue 和 Pull Request。当用户要求创建 PR、管理 Issue、查看 CI 状态时使用。"
- "使用 ffmpeg 处理视频文件。当用户要求视频转码、剪切、合并或提取音频时使用。"

差的 description：
- "GitHub 相关操作"（太模糊）
- "视频工具"（无法判断何时使用）

### 步骤要具体

- 给出**具体的命令**，而不是"执行相关命令"
- 包含**参数说明**和**返回值解释**
- 考虑**错误处理**：如果某步失败该怎么办

### 善用条件判断

```markdown
## 步骤 3：安装依赖

根据平台选择安装方式：

**macOS (darwin)**:
```bash
brew install xxx
````

**Linux**:

```bash
apt-get install xxx
```

```

### 保持独立性

每个 Skill 应该是自包含的，读者不需要查阅其他文档就能完成操作。

## 验证

Skill 创建后：
1. 确认 SKILL.md 文件存在且格式正确
2. 确认 frontmatter 中 `name` 和 `description` 字段完整
3. 告知用户 Skill 已创建，并说明存放位置和使用方式
```
