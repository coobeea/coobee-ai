# Cursor Configuration

This directory contains Cursor-specific configurations and skills.

## Directory Structure

```
.cursor/
├── README.md         # This file
└── skills/           # Symlink → ../skills/
```

## Skills Setup

### Symbolic Link

The `skills/` directory is a **symbolic link** pointing to the project's main `skills/` directory:

```bash
.cursor/skills → ../skills/
```

**Why use a symlink?**
- ✅ Cursor automatically detects skills in `.cursor/skills/`
- ✅ Keep skills organized in project root `skills/`
- ✅ No duplication - single source of truth
- ✅ Easy to manage and version control

### Available Skills

- **icon-usage/** - Comprehensive guide for using icons in the project
  - Three methods: manual import, auto-import, Tailwind CSS
  - Decision logic for choosing the right method
  - Detailed examples and troubleshooting

## AGENTS.md

The project root contains an `AGENTS.md` file that provides high-level guidance for AI assistants working on this project. It covers:

- Project overview and tech stack
- Code standards and conventions
- File organization patterns
- Common workflows
- Best practices

Both `AGENTS.md` and skills in `.cursor/skills/` are automatically detected by Cursor.

## How Cursor Uses These

1. **AGENTS.md** - Loaded as context for general project guidance
2. **.cursor/skills/** - Individual skills loaded when relevant tasks detected
3. **Progressive loading** - Only relevant content loaded to save context

## Maintaining Skills

To add or update skills:

1. Edit files in `skills/` directory (project root)
2. Changes automatically available via `.cursor/skills/` symlink
3. No need to duplicate or copy files

## Git Tracking

- ✅ `skills/` directory and its contents are tracked
- ✅ `AGENTS.md` is tracked
- ✅ `.cursor/skills` symlink is tracked
- ❌ `.cursor/` directory itself may be in `.gitignore`

---

For more information, see:
- `../skills/README.md` - Skills directory overview
- `../AGENTS.md` - Project-level AI assistant guidelines
