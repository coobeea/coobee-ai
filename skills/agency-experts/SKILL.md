---
name: agency-experts
description: '专业领域专家 Agent 提示词库。包含 220+ 个细分领域的专家角色定义。当需要特定领域的专家视角时，请务必先读取该技能目录下的 SKILL.md 文件获取分类导航，然后按照渐进式加载的指引找到并读取具体的专家文件。Use when: (1) user asks for specialized advice, (2) you need to act as a specific expert, (3) you want to adopt a specialized persona for a complex task.'
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

- **academic** (学术与研究)：包含人类学家、历史学家、心理学家等。适用于需要深度学术研究、理论支持、社会科学分析、人类行为动机挖掘的任务。 -> 详见 `academic/INDEX.md`
- **design** (UI/UX与视觉设计)：包含UI设计师、UX架构师、视觉故事讲述者、品牌专家等。适用于界面设计、用户体验优化、品牌视觉规范、动效设计等任务。 -> 详见 `design/INDEX.md`
- **engineering** (软件工程、架构与开发)：包含前端、后端、移动端、数据库优化、安全工程师、DevOps、架构师等。适用于各种软件开发、代码审查、系统架构设计、性能调优任务。 -> 详见 `engineering/INDEX.md`
- **game-development** (游戏开发与技术美术)：包含Unity/Unreal/Godot/Roblox专家、关卡设计师、技术美术、音频工程师等。适用于游戏逻辑编写、Shader开发、多人游戏架构等。 -> 详见 `game-development/INDEX.md`
- **marketing** (市场营销、SEO与内容)：包含SEO专家、内容创作者、各平台（抖音、小红书、B站、Twitter等）营销策略师、增长黑客等。适用于产品推广、内容运营、社交媒体增长。 -> 详见 `marketing/INDEX.md`
- **paid-media** (付费媒体与广告投放)：包含PPC策略师、程序化买手、广告审计师等。适用于广告投放策略、ROI优化、搜索词分析、媒介购买规划。 -> 详见 `paid-media/INDEX.md`
- **product** (产品管理与需求分析)：包含产品经理、用户行为研究员、敏捷冲刺规划师等。适用于需求拆解、产品路线图规划、用户反馈综合分析、行为助推设计。 -> 详见 `product/INDEX.md`
- **project-management** (项目管理与敏捷开发)：包含项目经理、Scrum Master、Jira工作流专家等。适用于项目进度追踪、团队协作流程优化、资源调度、实验追踪。 -> 详见 `project-management/INDEX.md`
- **sales** (销售与客户战略)：包含销售工程师、客户战略师、提案专家等。适用于B2B销售策略、客户发现、销售管道分析、商业提案撰写。 -> 详见 `sales/INDEX.md`
- **spatial-computing** (空间计算与XR开发)：包含VisionOS工程师、XR沉浸式开发者、空间交互专家等。适用于AR/VR/MR应用开发、3D空间界面设计、Metal渲染优化。 -> 详见 `spatial-computing/INDEX.md`
- **specialized** (特定领域专家)：包含区块链审计、合规审查、医疗营销合规、供应链战略、特定语言市场顾问等。适用于需要极其细分行业知识的特殊任务。 -> 详见 `specialized/INDEX.md`
- **strategy** (商业战略与剧本)：包含商业战略顾问、剧本/SOP规划师等。适用于企业顶层设计、商业模式分析、标准化操作流程(Runbooks/Playbooks)制定。 -> 详见 `strategy/INDEX.md`
- **support** (客户支持与数据分析)：包含数据分析师、财务追踪、基础设施维护、法律合规检查等。适用于售后支持、运营数据报表、企业合规审计、执行摘要生成。 -> 详见 `support/INDEX.md`
- **testing** (QA、测试与无障碍审计)：包含API测试、性能基准测试、无障碍(A11y)审计、测试结果分析等。适用于代码质量保证、自动化测试脚本编写、系统健壮性验证。 -> 详见 `testing/INDEX.md`

---

## 结合编排模式 (Orchestrator) 与群体模式 (Swarm)

在多智能体协作中，本库是极佳的“人才池”。

- 当你作为 Planner 拆解任务时，可以参考这些细分角色来规划子任务（例如：将任务明确指派给“前端性能专家”和“后端架构师”）。
- 当你作为 Worker 执行特定子任务时，先读取对应的专家文件，用最专业的视角完成代码编写。
