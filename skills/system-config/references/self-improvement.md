# 自我进化指南

你不仅是一个任务执行者，还是一个可以自我改进的系统。以下是你的扩展点：

---

## 1. 添加知识 → 创建 Skill

当你发现某个领域需要重复使用的专业知识或工作流程时，创建一个 Skill：

```typescript
write({
  path: '{workspace}/skills/my-skill/SKILL.md',
  content: '---\nname: my-skill\ndescription: ...\n---\n...'
});
```

**参考**: 使用 `skill-creator` Skill 了解详细创建方法。

---

## 2. 添加能力 → 创建 Extension

当你需要新的工具或生命周期钩子时，创建一个 Extension：

```
{workspace}/extensions/my-ext/
├── extension.json
└── index.ts
```

**Extension 可以**:

- `registerTool` — 注册新工具
- `on(hookName)` — 注册生命周期钩子
- `registerGatewayMethod` — 注册 Gateway RPC 方法
- 声明 `skills` — 贡献额外的 Skill

**参考**: 使用 `extension-creator` Skill 了解详细创建方法。

---

## 3. 调整行为 → 修改配置

通过 `config_patch` 工具修改系统行为：

- 调整安全级别（沙箱模式、审批策略）
- 切换默认模型
- 调整推理深度
- 修改 UI 设置

**参考**: 查看其他 references/ 下的配置文档。

---

## 4. 积累经验 → 使用 Memory

将有价值的知识写入记忆系统，供后续会话使用：

- 用户偏好 → `memory(write, scope='user', file='preferences.md')`
- 项目知识 → `memory(write, scope='agent', file='MEMORY.md')`
- 教训总结 → `memory(write, scope='agent', file='lessons.md')`

---

## 5. 修改协议 → 覆盖 execution-protocol

在 `{workspace}/skills/execution-protocol/SKILL.md` 创建同名 Skill，覆盖默认执行协议。

---

## 自我改进工作流

```
发现问题/需求
    ↓
分析：是知识缺失？能力缺失？配置不当？经验不足？
    ↓
选择行动：
  知识 → 创建/更新 Skill
  能力 → 创建/更新 Extension
  配置 → config_patch 修改
  经验 → memory 写入
    ↓
执行改进
    ↓
验证效果（self-reflection）
    ↓
记录到 memory（供未来会话复用）
```

---

## 实践建议

### 何时创建 Skill

- 需要重复使用的工作流程
- 特定领域的专业知识
- 复杂的多步骤操作指南

### 何时创建 Extension

- 需要新的工具能力
- 需要监听生命周期事件
- 需要集成外部服务

### 何时修改配置

- 当前配置不符合任务需求
- 需要临时调整系统行为
- 优化性能或安全级别

### 何时写入记忆

- 用户明确表达的偏好
- 项目特定的知识和规则
- 从失败中学到的教训
