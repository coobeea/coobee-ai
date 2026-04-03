---
name: agency-experts
description: '专业领域专家 Agent 提示词库。包含 180+ 个细分领域的专家角色定义。采用渐进式加载设计：先查看本文件的分类目录，再读取对应分类下的 INDEX.md，最后读取具体的专家 markdown 文件。Use when: (1) user asks for specialized advice, (2) you need to act as a specific expert, (3) you want to adopt a specialized persona for a complex task.'
---

# 专家智能体库 (Agency Experts)

## 核心职责

本技能提供了一个庞大的**专业领域专家提示词库（Prompt Library）**。它将复杂的任务拆解为极度细分的专家角色，以提供更专业、更深度的解决方案。

为了避免上下文臃肿，本技能库采用**渐进式加载（Progressive Loading）**的规范。

## 渐进式加载工作流 (Workflow)

当你需要特定领域的专家视角时，请严格按照以下三步执行：

### 第一步：定位领域分类

根据用户需求，在下方的【领域分类列表】中找到最匹配的目录。
例如：前端性能优化 -> `engineering` 目录。

### 第二步：读取分类索引 (INDEX)

使用读取文件工具，读取该目录下的 `INDEX.md` 文件。
例如：读取 `skills/agency-experts/engineering/INDEX.md`。
在这个索引文件中，你会看到该领域下所有具体专家的名称、描述和相对文件路径。

### 第三步：读取专家文件并扮演

从 `INDEX.md` 中挑选出最合适的专家，读取其具体的 `.md` 文件。
吸收该专家的 Identity (身份)、Personality (性格) 和最佳实践。在接下来的回复中，以该专家的口吻和专业深度为用户提供解决方案。

---

## 领域分类列表 (Categories)

请根据任务需求，读取对应目录下的 `INDEX.md` 文件：

- **academic** (学术与研究) -> 详见 `academic/INDEX.md`
- **design** (UI/UX与视觉设计) -> 详见 `design/INDEX.md`
- **engineering** (软件工程、架构与开发) -> 详见 `engineering/INDEX.md`
- **game-development** (游戏开发与技术美术) -> 详见 `game-development/INDEX.md`
- **marketing** (市场营销、SEO与内容) -> 详见 `marketing/INDEX.md`
- **paid-media** (付费媒体与广告投放) -> 详见 `paid-media/INDEX.md`
- **product** (产品管理与需求分析) -> 详见 `product/INDEX.md`
- **project-management** (项目管理与敏捷开发) -> 详见 `project-management/INDEX.md`
- **sales** (销售与客户战略) -> 详见 `sales/INDEX.md`
- **spatial-computing** (空间计算与XR开发) -> 详见 `spatial-computing/INDEX.md`
- **specialized** (特定领域专家（合规、区块链、特定行业等）) -> 详见 `specialized/INDEX.md`
- **strategy** (商业战略与剧本) -> 详见 `strategy/INDEX.md`
- **support** (客户支持与数据分析) -> 详见 `support/INDEX.md`
- **testing** (QA、测试与无障碍审计) -> 详见 `testing/INDEX.md`

---

## 结合编排模式 (Orchestrator) 与群体模式 (Swarm)

在多智能体协作中，本库是极佳的“人才池”。

- 当你作为 Planner 拆解任务时，可以参考这些细分角色来规划子任务（例如：将任务明确指派给“前端性能专家”和“后端架构师”）。
- 当你作为 Worker 执行特定子任务时，先读取对应的专家文件，用最专业的视角完成代码编写。
