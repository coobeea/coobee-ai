# AGENTS

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:

- Skills are located in `.cursor/skills/` directory
- Each skill contains SKILL.md with detailed instructions
- Skills may include reference files, scripts, and assets

Usage notes:

- Only use skills listed in <available_skills> below
- Read the skill's SKILL.md for complete instructions
- Reference additional files in skill's references/ directory as needed
  </usage>

<available_skills>

<skill>
<name>agent-creator</name>
<description>专业 Agent 设计与创建指南。当需要创建新的专业 Agent、设计 Agent 能力体系、或 LLM 自主判断需要一个专家助手时使用。覆盖意图分析、能力规划、指令设计、工具选择、模型配置和定义落地全流程。Use when: (1) user asks to create a specialized agent, (2) LLM determines a specialist is needed for a task, (3) need to design agent instructions/tools/skills/model config. Triggers on: 创建Agent, 做一个助手, 需要专家, create agent, need specialist.</description>
<location>local</location>
</skill>

<skill>
<name>skill-creator</name>
<description>指导 Agent 创建新的 Skill。当用户要求创建新技能、编写操作手册、或 Agent 需要记录可复用的工作流程时使用。Use when: creating new skills, documenting workflows, or recording reusable procedures.</description>
<location>local</location>
</skill>

<skill>
<name>model-config</name>
<description>模型配置管理指南。帮助 LLM 安全地管理模型配置（列出、添加模型）并根据任务特征选择最合适的 AI 模型及其备选方案。Use when: (1) creating/updating agents and need to select models, (2) adding new models to configuration, (3) querying available models, (4) optimizing model configuration for specific tasks, (5) designing model fallback strategies. Triggers on: 选择模型, 配置模型, 添加模型, choose model, model selection, model config, add model.</description>
<location>local</location>
</skill>

<skill>
<name>worker-creator</name>
<description>Worker 创建指南。指导如何创建新的 Worker（Python 后台服务）。当需要创建 ASR、TTS、OCR 等专用 Worker 时使用。Use when: creating new workers, designing worker services, or integrating Python backends.</description>
<location>local</location>
</skill>

<skill>
<name>extension-creator</name>
<description>指导 Agent 创建新的 Extension 扩展。当用户要求创建扩展、注册新工具、添加生命周期钩子、或需要动态增强系统能力时使用。Use when: creating extensions, registering tools, or adding lifecycle hooks.</description>
<location>local</location>
</skill>

<skill>
<name>system-config</name>
<description>应用配置体系和自我管理指南。当 Agent 需要修改系统配置（沙箱模式、模型设置、审批策略等）、了解可配置项、或进行自我优化时使用此技能。Use when: modifying system config, understanding configuration options, or self-optimization.</description>
<location>local</location>
</skill>

<skill>
<name>runtime-env</name>
<description>描述 Agent 运行时环境的目录结构、路径约定和可用资源。当 Agent 需要了解文件存放位置、工作空间结构、Skill 来源、Extension 系统或记忆存储时使用此技能。Use when: understanding directory structure, path conventions, or available resources.</description>
<location>local</location>
</skill>

<skill>
<name>dimension-architect</name>
<description>需求维度量化架构师。将用户的模糊需求系统性地转化为可量化的评估维度体系，覆盖意图分析、目标拆解、维度设计、评估标准制定和数据落地全流程。Use when: analyzing requirements, extracting real intent, breaking down goals into measurable dimensions/metrics, designing evaluation frameworks.</description>
<location>local</location>
</skill>

<skill>
<name>eval-refine-loop</name>
<description>LLM输出质量评估与自动优化闭环系统。读取dimension-architect产出的维度体系，对LLM输出进行逐维度量化评估，生成差距报告，自动诊断问题根因，生成优化指令驱动LLM自我修正，循环迭代直到输出质量达标。Use when: evaluating LLM output quality, generating gap analysis reports, driving automated LLM self-optimization loops.</description>
<location>local</location>
</skill>

<skill>
<name>execution-protocol</name>
<description>Agent 的核心执行协议（五步工作法）。定义了从接收用户请求到报告结果的标准流程。可通过同名 Skill 覆盖来定制。Use when: understanding agent execution workflow or customizing execution protocol.</description>
<location>local</location>
</skill>

<skill>
<name>self-reflection</name>
<description>自我评估与修复方法论。当需要评估任务完成质量、分析执行过程效率、或决定如何修复问题时使用此技能。配合 execution_protocol 中的自我评估和自我修复步骤使用。Use when: evaluating task quality, analyzing execution efficiency, or deciding how to fix problems.</description>
<location>local</location>
</skill>

<skill>
<name>poc-lifecycle</name>
<description>POC 生命周期管理标准流程。指导 Agent 按照 5 阶段工作法（需求分析、方案设计、反思优化、实施跟踪、验收报告）执行复杂任务，确保质量、可追溯、可复盘。Use when: (1) user requests "complete implementation", "don't be lazy", "follow standard process", (2) complex tasks with keywords like 重构/架构/设计/迁移/改造, (3) tasks involving multiple files or modules, (4) high-value tasks requiring quality assurance. Triggers on: 完整地实现, 不要偷懒, 按照标准流程, 需求分析, 方案设计, POC, complex task, refactor, architecture.</description>
<location>local</location>
</skill>

<skill>
<name>config-manager</name>
<description>应用配置管理工具集。当需要查看或修改应用配置（coobee.json5）时使用。提供 config-get、config-patch 两个脚本，支持查看完整配置、指定章节、以及深度合并修改。Use when user asks to view or modify app configuration, change settings, adjust security policies, or update model defaults.</description>
<location>local</location>
</skill>

<skill>
<name>find-skills</name>
<description>Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. Uses npx skills CLI to search skills.sh ecosystem.</description>
<location>local</location>
</skill>

<skill>
<name>icon-usage</name>
<description>Guide for using icons in coobee-ai project with three methods - manual import (for frequent use with events), auto-import (for occasional use), and Tailwind CSS classes (for dynamic icons). Use when adding icons to Vue components, implementing icon-based UI, or answering questions about icon usage. Project uses unplugin-icons + @egoist/tailwindcss-icons with offline bundling.</description>
<location>local</location>
</skill>

<skill>
<name>observability</name>
<description>系统可观测性工具集。当需要查看会话状态、对话历史、或检查 LLM 调用上下文时使用。提供 session-status、session-history、context-inspect 三个脚本。Use when user asks about session status, conversation history, or needs to inspect LLM call details.</description>
<location>local</location>
</skill>

<skill>
<name>gitea</name>
<description>Gitea 代码托管平台操作指南。通过 REST API 管理仓库、Issue 工单、Pull Request、标签、里程碑、Release 发布等。Use when: (1) creating/managing git repositories, (2) creating/updating issues or tickets, (3) managing pull requests and code review, (4) creating releases or tags, (5) managing labels and milestones. Triggers on: 创建仓库, 提交工单, 提Issue, 合并PR, 发布版本, create repo, create issue, merge PR, create release, Gitea.</description>
<location>local</location>
</skill>

<skill>
<name>experience-manager</name>
<description>通用经验管理系统（三层结构）。自动捕获和管理任何Skill运行过程中的问题和解决方案，支持一问多解、推导追溯、自动检索。设计理念：问题（第1层）→ 解决方案（第2层：具体实现）→ 推导过程（第3层：为什么）。完全自动化，大模型自主查询和沉淀，用户无感知。Use when: (1) 执行任何Skill前自动查询类似问题，(2) 执行中遇到困难自动查备选方案，(3) 执行后自动沉淀经验。Triggers: 自动触发，无需人工干预。</description>
<location>local</location>
</skill>

<skill>
<name>agency-experts</name>
<description>专业领域专家 Agent 提示词库。包含 180+ 个细分领域的专家角色定义（工程、设计、产品、市场等）。当系统在自由模式或编排模式下需要特定领域的专家视角（如前端优化、数据库调优、安全审计）时，可以读取本技能目录下的对应 markdown 文件，直接采纳其专家身份和最佳实践。Use when: (1) user asks for specialized advice, (2) you need to act as a specific expert, (3) you want to adopt a specialized persona for a complex task.</description>
<location>local</location>
</skill>

</available_skills>

<!-- SKILLS_TABLE_END -->

</skills_system>

---

## Project Context

<project_info>

### Overview

**coobee-ai** is an Electron application built with Vue 3, TypeScript, and Tailwind CSS 4.

### Tech Stack

- **Framework**: Electron 39 + Vue 3 + TypeScript
- **Build Tool**: Electron Vite + Vite 7
- **Styling**: Tailwind CSS 4 with @tailwindcss/vite
- **Icons**: unplugin-icons + @egoist/tailwindcss-icons (offline bundled)
- **State Management**: Pinia
- **Routing**: Vue Router
- **Code Editor**: Monaco Editor

### Project Structure

```
coobee-ai/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Electron preload scripts
│   ├── renderer/      # Vue 3 frontend application
│   └── shared/        # Shared types and constants
├── skills/            # AI assistant skills (symlinked to .cursor/skills)
├── docs/              # Project documentation
└── build/             # Build resources and assets
```

</project_info>

---

## Code Standards

<code_standards>

### Core Principles

- Use Vue 3 Composition API with `<script setup>` and TypeScript
- Use Tailwind CSS utility classes (avoid custom CSS)
- Provide explicit TypeScript types for all props, emits, and reactive state
- For icons: Consult icon-usage skill for method selection

### File Naming

- Components: `PascalCase.vue` (e.g., `UserProfile.vue`)
- Utilities: `camelCase.ts` (e.g., `formatDate.ts`)
- Variables: `camelCase`, Components/Types: `PascalCase`, Constants: `UPPER_SNAKE_CASE`

### Import Order

1. Vue core imports
2. Third-party libraries
3. Icons (if using manual import)
4. Local components
5. Utilities/helpers
6. Types

</code_standards>

---

## Key Configuration Files

<configuration>

- **electron.vite.config.ts** - Vite config for Electron (main, preload, renderer)
- **tailwind.css** - Tailwind CSS 4 config (uses @import and @plugin syntax)
- **tsconfig.web.json** - TypeScript config for renderer (includes unplugin-icons types)
- **package.json** - Dependencies and scripts (use `pnpm`)

**Note**: Do NOT create `tailwind.config.js` or `postcss.config.js` - Tailwind 4 uses CSS-based config.

</configuration>

---

## Development Commands

<commands>

```bash
# Setup
pnpm install

# Development
pnpm dev

# Build
pnpm build:mac     # macOS
pnpm build:win     # Windows
pnpm build:linux   # Linux

# Code Quality
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm typecheck     # TypeScript
```

</commands>

---

## Best Practices

<best_practices>

### Do ✅

- Use Composition API with `<script setup>`
- Provide explicit TypeScript types
- Use Tailwind utility classes
- Consult skills for specialized tasks
- Keep components small and focused
- Handle errors gracefully

### Don't ❌

- Use Options API
- Write custom CSS if Tailwind works
- Ignore TypeScript errors
- Mix different patterns randomly

</best_practices>
