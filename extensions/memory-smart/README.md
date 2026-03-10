# Memory Smart Extension

LLM 驱动的智能记忆系统，使用倒排索引和文件存储实现快速召回。

## 核心特性

✅ **LLM 分类**：自动判断记忆价值和分类维度（6 类）  
✅ **倒排索引**：关键词索引，快速定位记忆  
✅ **文件存储**：纯文件系统，无数据库依赖  
✅ **按月归档**：内容按月存储，降低文件数量  
✅ **LLM 自主召回**：通过 Skill 引导，Agent 自主检索  
✅ **Agent 隔离**：每个 Agent 有独立记忆库，越用越专业

## 架构设计

### 两层存储结构（按 Agent 隔离）

```
~/.coobee-ai/memory/agent/{agentId}/
├── index/                    # 第 1 层：索引（倒排索引）
│   ├── preference.md         # 偏好索引
│   ├── decision.md           # 决策索引
│   ├── lesson.md             # 教训索引
│   ├── entity.md             # 实体索引
│   ├── knowledge.md          # 知识索引
│   └── fact.md               # 事实索引
└── entries/                  # 第 2 层：详细内容
    ├── preference/
    │   ├── 2026-03.md
    │   └── 2026-02.md
    ├── decision/
    │   └── 2026-03.md
    └── ...
```

**特点**：

- ✅ 每个 Agent 有独立的记忆库
- ✅ Agent 使用越多，记忆越丰富，越专业
- ✅ 不会与其他 Agent 的知识混淆

### 索引格式

每 4 行一条记忆，空行分隔：

```
标题（摘要）
ID 日期 重要度 关键词1 关键词2...
详细描述（1-2句话）
文件路径

```

示例：

```
用户偏好使用文件系统而非数据库
mem-1709876543210-abc123 2026-03-05 9 文件系统 数据库 存储
用户明确表示倾向使用文件系统存储而非数据库，认为文件系统更简单可控。
entries/preference/2026-03.md

```

### 内容格式

纯文本，每条记忆以 `=== mem-{id} ===` 分隔：

```
=== mem-1709876543210-abc123 ===
时间: 2026-03-05T14:22:23.210Z
摘要: 用户偏好使用文件系统而非数据库
重要度: 9
分类: preference
关键词: 文件系统 数据库 存储

Agent 输出:
好的，我们将使用文件系统存储，这样更简单可控...

记忆提取:
用户明确表示倾向使用文件系统存储而非数据库，认为文件系统更简单可控。

```

## 工作流程

### 记忆捕获（agent_end 钩子）

```
Agent 执行结束
    ↓
提取 Agent 输出
    ↓
调用 LLM 分类（6 维度）
    ↓
判断是否值得记忆
    ↓ (是)
生成记忆条目
    ↓
追加到内容文件（按月）
    ↓
追加到索引文件（按分类）
    ↓
存储到 memory/agent/{agentId}/
```

### 记忆召回（Skill 引导）

```
用户提问
    ↓
LLM 判断相关分类
    ↓
Read 索引文件 (memory/agent/{currentAgentId}/index/{category}.md)
    ↓
扫描/Grep 找到相关记忆 ID
    ↓
Read 详细内容 (memory/agent/{currentAgentId}/entries/{category}/{month}.md)
    ↓
整合记忆，回答用户
```

## 性能

- **召回速度**：~30-40ms（读取索引 + 内容）
- **捕获速度**：~500ms（LLM 分类在后台异步执行）
- **文件数量**：每个 Agent 每年约 72 个内容文件（6 分类 × 12 月）

## 分类维度（6 个明确维度）

| 维度       | 说明                   | 示例                        |
| ---------- | ---------------------- | --------------------------- |
| preference | 用户偏好、习惯、风格   | 喜欢 TypeScript、不用数据库 |
| decision   | 决策、选择、判断       | 决定使用 LanceDB            |
| lesson     | 经验教训、踩坑记录     | sed 编辑 JSON 会失败        |
| entity     | 人物、项目、工具、概念 | Vitest 是测试框架           |
| knowledge  | 知识点、原理、方法论   | Vue 3 最佳实践              |
| fact       | 事实、数据、状态       | 项目用 Electron 39          |

**注意**：已移除 `other` 分类，所有记忆必须归类到以上 6 个明确维度。

## LLM 分类

使用 `ExtensionApi.services.llm.chat()` 调用 LLM 进行分类：

**输入**：Agent 输出内容  
**输出**：JSON 格式

```json
{
  "shouldRemember": true,
  "category": "preference",
  "importance": 8,
  "summary": "用户偏好使用文件系统而非数据库",
  "keywords": ["文件系统", "数据库", "存储"],
  "memory": "用户明确表示倾向使用文件系统存储而非数据库...",
  "reason": "包含明确的技术偏好"
}
```

## 配置

```typescript
interface MemorySmartConfig {
  autoCapture: boolean; // 默认 true
  captureMinChars: number; // 默认 10
  captureMaxChars: number; // 默认 1000
}
```

## 与其他记忆系统的对比

| 特性     | memory-smart    | memory-global  | memory-auto |
| -------- | --------------- | -------------- | ----------- |
| 隔离级别 | **Agent 级**    | 用户级（全局） | Agent 级    |
| 存储方式 | 文件系统        | LanceDB (向量) | Markdown    |
| 分类方式 | LLM 判断 (6类)  | 正则匹配       | 无分类      |
| 召回速度 | 极快 (~30ms)    | 中等 (~100ms)  | 快          |
| 召回方式 | LLM 自主 + 工具 | 向量相似度     | 手动读取    |
| 适用场景 | 结构化记忆      | 语义检索       | 临时笔记    |

## API 使用

扩展内部使用以下 API：

```typescript
// 路径解析
await api.services.paths.getUserHome();

// LLM 调用
await api.services.llm.chat(messages);

// 日志
api.logger.info('[memory-smart] ...', { agentId });
```

## 维护

- 索引文件会持续增长（追加模式），定期检查大小
- 内容按月分割，自然限制单文件大小
- 每个 Agent 独立管理，互不影响
- 未来可实现年度归档脚本（手动触发）

---

**记忆系统已激活，请主动使用它来提供更好的对话体验。**
