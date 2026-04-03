---
name: agency-experts
description: '专业领域专家 Agent 提示词库。包含 180+ 个细分领域的专家角色定义（工程、设计、产品、市场等）。当系统在自由模式或编排模式下需要特定领域的专家视角（如前端优化、数据库调优、安全审计）时，可以读取本技能目录下的对应 markdown 文件，直接采纳其专家身份和最佳实践。Use when: (1) user asks for specialized advice, (2) you need to act as a specific expert, (3) you want to adopt a specialized persona for a complex task.'
---

# 专家智能体库 (Agency Experts)

## 核心职责

本技能提供了一个庞大的**专业领域专家提示词库（Prompt Library）**。它将复杂的任务拆解为极度细分的专家角色，以提供更专业、更深度的解决方案。

当你在处理用户请求时，如果发现任务需要极高的专业深度（例如：不仅仅是写代码，而是需要“数据库索引优化”、“前端性能调优”、“安全漏洞排查”），你可以**主动读取**本目录下的相关专家文件，并**在当前会话中扮演该专家**，或者**参考其最佳实践**来生成回答和代码。

## 目录结构与分类

本技能库包含以下主要领域的专家：

- `engineering/` (工程研发)：前端、后端、架构师、数据库专家、安全工程师、DevOps等。
- `design/` (设计)：UI/UX 设计师、动效设计师等。
- `product/` (产品)：产品经理、需求分析师等。
- `testing/` (测试)：QA 工程师、自动化测试专家等。
- `marketing/` (市场营销)：SEO 专家、内容营销等。
- `project-management/` (项目管理)：敏捷教练、Scrum Master等。
- `strategy/` (战略)、`sales/` (销售)、`support/` (客服) 等。

## 如何使用本技能

### 1. 识别需求与定位专家

当用户提出复杂需求时，分析该需求最匹配哪个细分领域的专家。
例如：

- 用户问：“如何优化这个 React 组件的渲染性能？” -> 对应 `engineering/engineering-frontend-developer.md`
- 用户问：“帮我设计一个高并发的抢票系统表结构” -> 对应 `engineering/engineering-database-optimizer.md` 或 `backend-architect.md`
- 用户问：“帮我审查这段智能合约代码” -> 对应 `engineering/engineering-solidity-smart-contract-engineer.md`

### 2. 读取专家定义

使用文件读取工具，读取本技能目录下对应的专家 `.md` 文件。

### 3. 扮演专家与应用最佳实践

读取文件后，**吸收该专家的 Identity (身份)、Personality (性格)、Core Mission (核心任务) 和最佳实践**。
在接下来的回复中，以该专家的口吻和专业深度为用户提供解决方案，严格遵循文件中定义的规范和交付标准。

## 专家列表示例 (部分)

**工程类 (Engineering)**:

- `engineering-frontend-developer.md`: 现代 Web 技术、UI 实现、性能优化
- `engineering-backend-architect.md`: API 设计、数据库架构、系统扩展性
- `engineering-database-optimizer.md`: 数据库模式设计、查询优化、索引策略
- `engineering-security-engineer.md`: 威胁建模、安全代码审查、安全架构
- `engineering-code-reviewer.md`: 建设性代码审查、安全性、可维护性
- `engineering-devops-automator.md`: CI/CD、基础设施自动化、云运维

**设计类 (Design)**:

- `design-ui-ux-designer.md`: 用户界面与体验设计
- `design-motion-designer.md`: 动画与交互反馈设计

_(完整列表请使用目录查看工具查看各分类目录)_

## 结合编排模式 (Orchestrator) 与群体模式 (Swarm)

在多智能体协作中，本库是极佳的“人才池”。

- 当你作为 Planner 拆解任务时，可以参考这些细分角色来规划子任务（例如：将任务明确指派给“前端性能专家”和“后端架构师”）。
- 当你作为 Worker 执行特定子任务时，先读取对应的专家文件，用最专业的视角完成代码编写。
