# Skills Directory

This directory contains skills that guide AI assistants on project-specific patterns and best practices.

## Available Skills

### icon-usage/

Comprehensive guide for using icons in the coobee-ai project.

**Triggers**: Adding icons to Vue components, implementing icon-based UI, icon-related questions

**Contains**:
- Three icon usage methods (manual import, auto-import, Tailwind CSS)
- Decision logic for choosing the right method
- Icon naming conventions
- Styling and common patterns
- Detailed examples in `references/examples.md`
- Troubleshooting guide in `references/troubleshooting.md`

**Quick Start**: See SKILL.md for core workflow, load reference files as needed.

---

## Skill Structure

Each skill follows this standard structure:

```
skill-name/
├── SKILL.md              # Required: Core instructions
├── references/           # Optional: Detailed docs
│   ├── examples.md
│   └── troubleshooting.md
├── scripts/              # Optional: Executable code
└── assets/               # Optional: Templates, files
```

### SKILL.md Format

Every SKILL.md must include:

1. **YAML Frontmatter** (required):
   ```yaml
   ---
   name: Skill Name
   description: What the skill does and when to use it
   ---
   ```

2. **Body** (required):
   - Concise instructions using imperative form
   - Decision logic and workflows
   - References to detailed docs in `references/`

### Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) - Always loaded (~100 words)
2. **SKILL.md body** - Loaded when skill triggers (<500 lines)
3. **References** - Loaded as needed by AI (unlimited)

Keep SKILL.md concise. Move detailed examples, troubleshooting, and advanced patterns to `references/` files.

---

## Using Skills

### For AI Assistants

Skills are automatically detected and loaded when:
- User mentions skill-related tasks
- Context matches skill description
- AI determines skill would be helpful

### For Developers

Reference skills when:
- Adding new features requiring icons
- Troubleshooting icon issues
- Learning project patterns

---

## Adding New Skills

To create a new skill:

1. **Create skill directory** under `skills/`
2. **Add SKILL.md** with frontmatter and instructions
3. **Add references/** for detailed content (if needed)
4. **Test the skill** with real use cases
5. **Iterate** based on usage

Follow skill-creator patterns for best results.

---

## Skill Principles

### Concise is Key

Context window is shared. Only include information AI doesn't already know.

### Set Appropriate Freedom

- **High freedom** (text instructions): Multiple approaches valid
- **Medium freedom** (pseudocode): Preferred pattern with variation
- **Low freedom** (scripts): Fragile operations, specific sequence

### Reference External Details

Keep SKILL.md focused on workflow. Move examples, schemas, and detailed docs to `references/`.

---

## Examples

### Good Skill Structure

```
icon-usage/
├── SKILL.md              # Core: Decision logic, 3 methods, naming
└── references/
    ├── examples.md       # Detailed: 20+ code examples
    └── troubleshooting.md # Detailed: Problem solving
```

### Why This Works

- SKILL.md stays under 300 lines (quick to load)
- Detailed content only loads when needed
- Clear navigation from SKILL.md to references
- No redundancy between files

---

## Maintenance

Update skills when:
- Project patterns change
- New features added
- Common issues discovered
- User feedback received

Test changes with real usage before finalizing.

---

## Resources

- See existing skills for examples
- Follow skill-creator guidelines
- Keep skills focused and maintainable
