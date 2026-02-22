# 记忆系统 (Memory)

## 概述

Memory 系统允许你在会话结束后仍然保留知识、经验和用户偏好，供未来会话使用。

**存储位置**: `{userHome}/memory/`  
**管理方式**: `memory` 工具

---

## 记忆层级

### 用户级记忆（User Scope）

所有 Agent 共享，记录用户的全局偏好和知识。

**路径**: `{userHome}/memory/user/`

#### 示例

```typescript
memory({
  action: 'write',
  scope: 'user',
  file: 'preferences.md',
  content: `
# 用户偏好

- 编程语言偏好: TypeScript > Python > Go
- 代码风格: 函数式优先，避免 class
- 测试框架: 喜欢使用 Vitest
`
});
```

### Agent 级记忆（Agent Scope）

当前 Agent 专属，记录与当前 Agent 相关的知识。

**路径**: `{userHome}/memory/agent/{agentId}/`

#### 示例

```typescript
memory({
  action: 'write',
  scope: 'agent',
  file: 'MEMORY.md',
  content: `
# Tavern 任务系统知识

- 任务文件位置: /data/tavern/tasks.jsonl
- 扫描间隔: 3 秒
- 任务格式: JSONL（每行一个 JSON）
`
});
```

---

## 记忆文件操作

### 写入记忆

```typescript
memory({
  action: 'write',
  scope: 'user', // 或 'agent'
  file: 'lessons.md', // 文件名
  content: '...' // 内容
});
```

### 读取记忆

```typescript
memory({
  action: 'read',
  scope: 'user',
  file: 'lessons.md'
});
```

### 追加记忆

```typescript
memory({
  action: 'append',
  scope: 'agent',
  file: 'MEMORY.md',
  content: '\n\n## 新学到的知识...'
});
```

### 删除记忆

```typescript
memory({
  action: 'delete',
  scope: 'agent',
  file: 'old-knowledge.md'
});
```

### 列出记忆文件

```typescript
memory({
  action: 'list',
  scope: 'user'
});
```

---

## 使用场景

### 场景 1: 记录用户偏好

```typescript
// 用户说："我更喜欢用 TypeScript 而不是 JavaScript"
memory({
  action: 'write',
  scope: 'user',
  file: 'preferences.md',
  content: '# 编程偏好\n- 语言: TypeScript > JavaScript'
});
```

### 场景 2: 积累项目知识

```typescript
// 发现项目结构规律后记录
memory({
  action: 'append',
  scope: 'agent',
  file: 'MEMORY.md',
  content: '\n## 项目结构\n- 所有工具放在 `src/tools/` 目录\n- 测试文件使用 `*.test.ts` 后缀'
});
```

### 场景 3: 记录失败教训

```typescript
// 某个方法多次尝试失败后
memory({
  action: 'write',
  scope: 'agent',
  file: 'lessons.md',
  content: `
# 教训总结

## 不要用 sed 编辑 JSON
尝试用 sed 修改 JSON 文件总是失败，应该用 read + parse + modify + write 的流程。
`
});
```

---

## 记忆文件推荐结构

### user/preferences.md

```markdown
# 用户偏好

## 编程风格

- ...

## 工具偏好

- ...

## 交互风格

- ...
```

### agent/{agentId}/MEMORY.md

```markdown
# Agent 记忆

## 项目结构知识

- ...

## 常用工作流程

- ...

## 特殊注意事项

- ...
```

### agent/{agentId}/lessons.md

```markdown
# 教训与经验

## 成功案例

- ...

## 失败教训

- ...

## 最佳实践

- ...
```

---

## 注意事项

1. **合理分类** - 用户偏好用 user scope，项目知识用 agent scope
2. **文件命名** - 使用清晰的文件名，如 `preferences.md`, `lessons.md`
3. **内容结构化** - 使用 Markdown 格式，便于后续阅读
4. **及时记录** - 发现重要信息后立即写入记忆
5. **定期整理** - 避免记忆文件过大，定期清理过时信息
