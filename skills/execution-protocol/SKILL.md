---
name: execution-protocol
description: Agent 的核心执行协议（五步工作法）。定义了从接收用户请求到报告结果的标准流程。可通过同名 Skill 覆盖来定制。
---

When you receive a user request, follow this protocol:

1. **Intent & Goal Extraction**
   - Identify the user's core intent and underlying need
   - Extract concrete goals from the request
   - For each goal, define verifiable criteria:
     · Quantifiable goals → specific metrics (numbers, pass/fail, existence checks)
     · Fuzzy/creative goals → acceptance checklist (qualities, properties to verify)
   - Keep the criteria lightweight — 2-5 items per goal is sufficient

   ### Persist the Goal (GOAL.md)

   **For any non-trivial task**, write a `GOAL.md` file to the workspace root:

   ```markdown
   # Goal

   ## Original Request

   > (user's original request, verbatim or paraphrased)

   ## Objectives

   1. (concrete objective 1)
   2. (concrete objective 2)

   ## Verifiable Criteria

   - [ ] (criterion 1)
   - [ ] (criterion 2)
   - [ ] (criterion 3)

   ## Status

   - **Phase**: Planning | Executing | Evaluating | Complete
   - **Progress**: (brief note)
   ```

   **Why**: In long-running tasks with many conversation turns, the LLM context window
   may truncate earlier messages. GOAL.md is re-injected into every request as `<current_goal>`,
   ensuring you never lose sight of what you're trying to achieve.

   **Rules**:
   - If `<current_goal>` is present in system prompt → the file already exists; review it and update if intent changed
   - If `<current_goal>` is absent → this is a new session or goal hasn't been written yet
   - Update the Status section as you progress through the task
   - When task is fully complete, update all criteria to `[x]` and set Phase to `Complete`

2. **Plan & Execute**
   - Create a brief plan to achieve the goals
   - **For exploratory tasks** (e.g., "what can I do", "show project structure"):
     · **Document-first strategy**: Read README.md, AGENTS.md, SKILL.md first to understand the landscape
     · Then perform targeted queries based on what you learned
     · Avoid blind directory traversal (ls-ing everything without context)
     · When user asks "我有哪些技能/Agent/工具", check:
     1. `skills/` directory (for skills)
     2. `.home/agents/` directory (for agents)
     3. AGENTS.md (for documentation)
   - Execute step by step, using available tools
   - Track progress against your verifiable criteria (reference GOAL.md)

3. **Self-Evaluation** (after task completion)
   - **Quality**: Compare your output against the verifiable criteria from GOAL.md
   - **Process**: Briefly reflect on execution efficiency — any unnecessary steps, errors, or waste?
   - For detailed evaluation, load the `self-reflection` Skill (via `skill_list` → `read`)
   - Use `session_history` / `context_inspect` tools for objective process data when needed

4. **Self-Repair** (if evaluation reveals issues, max 3 rounds)
   - Fix priority (try in order):
     a. Fix execution strategy — try a different approach to achieve the goal
     b. Fix goal understanding — re-analyze user intent if criteria seem wrong
     c. Report remaining issues to user with clear explanation
   - **Stop condition**: all criteria pass, OR score doesn't improve after 2 consecutive rounds

5. **Report & Memorize**
   - Summarize what was accomplished vs. original goals
   - Note any unresolved issues or caveats
   - Update GOAL.md: mark all completed criteria as `[x]`, set Phase to `Complete`
   - **Save valuable knowledge to memory** (only if durable and reusable):
     · User preferences discovered → `memory(write, scope='agent', file='memory/preferences.md')`
     · Lessons learned from errors → `memory(write, scope='agent', file='memory/lessons.md')`
     · Core project knowledge → `memory(write, scope='agent', file='MEMORY.md')`
     · Use `append=true` to add to existing memory files
   - Do NOT save session-specific details — only knowledge that helps in future sessions

NOTE: For simple/trivial requests (greetings, quick facts, single-step tasks), skip steps 1 and 3-5 — just answer directly.

---

## Tool Usage Best Practices

### Batch Execution Principle

**When you need to run multiple related commands, combine them with `&&` or `;` into a single `exec` call:**

❌ **Inefficient** (multiple LLM requests):

```
exec("ls -la dir1/")
→ wait for result → decide next step
exec("ls -la dir2/")
→ wait for result → decide next step
```

✅ **Efficient** (one LLM request):

```
exec("ls -la dir1/ && ls -la dir2/ && ls -la dir3/")
→ get all results at once → analyze and summarize
```

### Common Batch Scenarios

**1. Directory structure queries**

```bash
exec("ls -la .home/ && ls -la agents/ && ls -la skills/")
```

**2. Statistics aggregation**

```bash
exec("echo '=== File Stats ===' && \
      echo 'Contexts:' $(ls contexts/*.json 2>/dev/null | wc -l) && \
      echo 'Events:' $(grep -c 'llm:done' events/events.jsonl) && \
      echo 'Sessions:' $(ls sessions/*/ | wc -l)")
```

**3. Log analysis**

```bash
exec("tail -20 logs/ai.log && echo '---' && tail -20 logs/main.log")
```

### Error Handling in Batch Commands

```bash
# Use || for fallback
exec("ls -la dir1/ || echo 'dir1 not found'; ls -la dir2/")

# Use ; to continue despite errors
exec("cd dir1 && ls -la; cd ../dir2 && ls -la")
```

---

## Tool Selection Guidelines

### Prefer glob over exec for file discovery

**Scenario 1: Find specific file types**

```typescript
// ❌ Not optimal
exec("find . -name '*.log'");

// ✅ Better
glob({ pattern: '**/*.log' });
```

**Scenario 2: Count files**

```typescript
// ❌ Not optimal
exec('ls contexts/*.json | wc -l');

// ✅ Better
const files = glob({ pattern: 'contexts/*.json' });
// files is an array, .length gives count
```

**Scenario 3: Find files in multiple directories**

```typescript
// ❌ Not optimal
exec('ls -la dir1/*.ts && ls -la dir2/*.ts');

// ✅ Better
glob({ pattern: '{dir1,dir2}/*.ts' });
```

### When to use exec vs glob

- **Use `glob`**: File discovery, pattern matching, counting files
- **Use `exec`**: File metadata (size, permissions, timestamps), complex shell operations, text processing (grep, sed, awk)
