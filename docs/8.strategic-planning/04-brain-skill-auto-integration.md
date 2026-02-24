# Brain Skill 自动集成机制

## 概述

所有 Agent 都会**自动关联** `brain` Skill，实现**智库自动维护**和**经验复用**。

这是系统**持续优化**的基础设施，通过集体智慧积累避免重复犯错。

---

## 实现机制

### 1. 已有 Agent 批量添加

**脚本**: `scripts/add-brain-skill.ts`

**功能**: 为 `.home/agents/` 中的所有现有 Agent 配置自动添加 `brain` skill

**使用**:

```bash
npx jiti scripts/add-brain-skill.ts
```

**效果**:

```json
{
  "id": "securities-trading-processor",
  "skills": [
    "brain", // ← 自动添加（置于开头，高优先级）
    "crs-statement-extractor" // ← 原有 skill
  ]
}
```

### 2. 新创建 Agent 自动添加

**位置**: `src/main/ai/agents/AgentStore.ts` → `create()` 方法

**逻辑**:

```typescript
// 自动添加 brain skill（让所有 Agent 能够主动维护智库）
const skills = params.skills ? [...params.skills] : [];
if (!skills.includes('brain')) {
  skills.unshift('brain'); // 添加到开头（高优先级）
}
```

**效果**: 无论通过 UI、API 还是 AI 创建的 Agent，都会自动获得 `brain` skill。

### 3. 运行时提示注入

**位置**: `src/main/ai/AgentEnvInjector.ts` → `buildExecutionProtocol()`

**注入内容**:

```
## Brain Knowledge Base Integration

**CRITICAL**: You have the **brain** Skill that allows you to maintain and utilize the shared knowledge base:

- **Before solving a problem** → Use brain Skill's search scripts to check if a solution already exists
- **After solving a problem** → Use brain Skill's publish scripts to save the solution for future reuse
- **When encountering errors** → Search by error signals (e.g., TimeoutError, ConnectionRefused)
- **When discovering patterns** → Publish patterns to help future agents avoid the same mistakes

This is **fundamental to system optimization** — building collective intelligence through experience sharing.
```

**效果**: 每个 Agent 在运行时会收到明确指导，知道何时以及如何使用智库。

---

## Brain Skill 功能

### 核心能力

| 功能     | 端点                      | 说明                          |
| -------- | ------------------------- | ----------------------------- |
| 搜索方案 | `POST /api/brain/search`  | 根据信号/类别搜索已有解决方案 |
| 发布经验 | `POST /api/brain/publish` | 将新方案发布到智库            |
| 获取详情 | `POST /api/brain/fetch`   | 获取经验包完整内容            |

### 典型工作流

```
1. 遇到问题（例如 TimeoutError）
   ↓
2. 使用 brain search 搜索已有方案
   ↓
3a. 找到方案 → 直接应用
3b. 没有方案 → 自己解决
   ↓
4. 成功解决后 → 使用 brain publish 发布到智库
   ↓
5. 下次其他 Agent 遇到同样问题时，直接复用
```

### 数据结构

- **Pattern**: 解决策略模板（方法论）
- **Practice**: 具体实践案例（代码、配置、步骤）
- **Evolution**: 演进记录（多次尝试、最终方案）

详见 `skills/brain/SKILL.md`。

---

## 好处与影响

### 1. 避免重复犯错

```
第1次: Agent A 遇到 TimeoutError → 试错 3 次 → 解决 → 发布到智库
第2次: Agent B 遇到 TimeoutError → 搜索智库 → 直接应用方案（节省时间和 tokens）
```

### 2. 知识积累

随着时间推移，智库会积累：

- HTTP 超时处理方案
- 文件编码错误修复
- API 调用重试策略
- 数据验证最佳实践
- ...

### 3. 系统自我进化

```
初期: 每个问题都需要试错
↓
中期: 常见问题有现成方案
↓
后期: 形成完整的问题-方案知识图谱
```

---

## 配置检查

### 验证 Brain Skill 已关联

```bash
# 查看任意 Agent 的配置
cat .home/agents/<agent-id>.json | grep -A 5 '"skills"'

# 应该看到：
# "skills": [
#   "brain",
#   ...
# ]
```

### 验证 Brain Worker 运行状态

1. 打开应用底部**全局状态栏**
2. 查看 "智库" Worker 状态（应为绿色 ● 表示运行中）
3. 如未运行，点击状态图标启动

---

## 使用示例

### Agent 自动搜索智库

**场景**: Agent 遇到 `ECONNREFUSED` 错误

**Agent 行为**:

1. 使用 `skill_list` 发现 `brain` Skill
2. 阅读 `skills/brain/SKILL.md`
3. 执行搜索脚本：

```bash
python skills/brain/scripts/search.py --signals "ECONNREFUSED" --limit 5
```

4. 如果找到方案 → 直接应用
5. 如果没有方案 → 自己解决

### Agent 自动发布经验

**场景**: Agent 成功解决了一个新问题

**Agent 行为**:

1. 构造经验包数据（Pattern + Practice + Evolution）
2. 调用发布脚本：

```bash
python skills/brain/scripts/publish.py --file /tmp/experience_package.json
```

3. 智库更新，下次其他 Agent 可以直接搜索到

---

## 注意事项

1. **Brain Worker 必须运行**: 智库功能依赖 Brain Worker，确保其已启动
2. **首次使用需初始化**: 可以从 EvoMap 同步通用经验包（参见 `brain-sync` Skill）
3. **质量控制**: 发布经验时应包含完整的实现细节和测试结果
4. **避免滥用**: 只发布经过验证的、可复用的方案（不是所有任务都需要发布）

---

## 相关文件

- `skills/brain/SKILL.md` - Brain Skill 完整文档
- `skills/brain-sync/SKILL.md` - EvoMap 经验包同步
- `src/main/ai/agents/AgentStore.ts` - Agent 创建逻辑
- `src/main/ai/AgentEnvInjector.ts` - 运行时提示注入
- `scripts/add-brain-skill.ts` - 批量添加脚本

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-24  
**状态**: ✅ 已实施
