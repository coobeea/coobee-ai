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
<name>icon-usage</name>
<description>Guide for using icons in coobee-ai project with three methods - manual import (for frequent use with events), auto-import (for occasional use), and Tailwind CSS classes (for dynamic icons). Use when adding icons to Vue components, implementing icon-based UI, or answering questions about icon usage. Project uses unplugin-icons + @egoist/tailwindcss-icons with offline bundling.</description>
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
