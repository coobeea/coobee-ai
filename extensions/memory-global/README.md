# memory-global — 全局长期记忆扩展

> 基于 LanceDB 向量数据库的全局长期记忆系统，提供自动捕获和语义检索能力。

---

## 功能特性

### 🎯 核心能力

1. **自动捕获（Auto-Capture）**
   - 通过 `agent_end` 生命周期钩子自动识别有价值的信息
   - 基于触发词和信号模式过滤（偏好、决策、经验教训等）
   - 自动生成 embedding 向量并存储到 LanceDB

2. **语义检索（Semantic Retrieval）**
   - 通过 `before_agent_start` 生命周期钩子自动召回相关记忆
   - 向量相似度搜索，精准匹配用户意图
   - 自动注入到 Agent 上下文，无需手动调用

3. **智能分类**
   - preference（偏好）
   - decision（决策）
   - entity（实体/联系人）
   - fact（事实）
   - lesson（经验教训）
   - knowledge（知识）
   - other（其他）

### ✨ 技术亮点

- **向量数据库**: 使用 LanceDB 原生向量存储，高性能相似度搜索
- **完全解耦**: 不依赖主进程核心模块，通过 `ExtensionApi.services` 访问系统能力
- **安全防护**: 防止提示词注入、死循环、恶意记忆污染
- **智能过滤**: 自动过滤系统输出、代码、过短/过长内容

---

## 架构设计

### 目录结构

```
extensions/memory-global/
├── index.ts                    # 扩展入口，注册生命周期钩子
├── extension.json              # 扩展元数据
├── package.json                # 独立依赖（LanceDB）
├── types/
│   ├── models.ts              # 数据模型定义
│   └── config.ts              # 配置类型
├── storage/
│   └── lancedb.ts             # LanceDB 存储层
├── pipeline/
│   ├── capture.ts             # 记忆捕获和分类逻辑
│   └── retrieve.ts            # 记忆检索和格式化
└── __tests__/
    ├── capture.test.ts        # 捕获逻辑测试
    └── storage.test.ts        # 存储层测试
```

### 数据流

```
┌─────────────────────────────────────────────────┐
│  agent_end Hook                                 │
│  ↓                                              │
│  Agent 输出 → shouldCapture 过滤                │
│           → detectCategory 分类                 │
│           → ExtensionApi.services.llm.embed()   │
│           → LanceDB.add()                       │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  before_agent_start Hook                        │
│  ↓                                              │
│  用户输入 → ExtensionApi.services.llm.embed()   │
│          → LanceDB.search()                     │
│          → formatRecallContext()                │
│          → 注入到 Agent 上下文                   │
└─────────────────────────────────────────────────┘
```

---

## 使用说明

### 安装依赖

扩展首次加载时会自动安装 `@lancedb/lancedb` 依赖。

也可以手动安装：

```bash
cd extensions/memory-global
pnpm install
```

### 配置

扩展默认启用，配置项在 `types/config.ts` 中：

```typescript
{
  autoCapture: true,        // 是否自动捕获
  autoRecall: true,         // 是否自动召回
  captureMaxChars: 500,     // 捕获最大字符数
  captureMinChars: 10,      // 捕获最小字符数
  recallTopK: 5,            // 召回结果数量
  recallMinScore: 0.7,      // 召回最低分数
  embeddingModel: 'text-embedding-3-small'  // embedding 模型
}
```

### 数据存储位置

```
~/.coobee-ai/extensions/memory-global/data/lancedb/
```

---

## 与其他记忆系统的关系

coobee-ai 现在有**三层记忆体系**：

### 1. 会话级记忆（memory-auto）

- **路径**: `workspace/memory/{date}.md`
- **作用域**: 单个会话
- **生命周期**: 临时（随 workspace 清理）
- **管理者**: memory-auto 扩展

### 2. Agent 级记忆（memory-auto + memory tool）

- **路径**: `homes/{agentId}/MEMORY.md` + `memory/*.md`
- **作用域**: 特定 Agent 跨会话
- **生命周期**: 永久（Markdown 文件）
- **管理者**: memory-auto 扩展 + memory tool

### 3. 全局长期记忆（memory-global）← **本扩展**

- **路径**: `~/.coobee-ai/extensions/memory-global/data/lancedb/`
- **作用域**: 跨会话、跨 Agent 共享
- **生命周期**: 永久（向量数据库）
- **管理者**: memory-global 扩展

---

## 开发和测试

### 运行测试

```bash
# 从项目根目录运行
npx vitest run extensions/memory-global/__tests__/
```

### 测试覆盖

- ✅ 记忆捕获过滤逻辑（20 个测试）
- ✅ LanceDB 存储 CRUD 操作（5 个测试）
- ✅ 分类检测
- ✅ 重要度计算
- ✅ 向量检索

---

## 设计原则

### 🔒 扩展独立性

- **不依赖主进程**: 通过 `ExtensionApi.services` 访问系统能力
- **独立依赖管理**: 有自己的 `package.json`
- **可插拔**: 可以单独禁用、升级、替换

### 🛡️ 安全防护

- **防止死循环**: 过滤已注入的记忆上下文
- **防止提示词注入**: 检测恶意指令并拒绝存储
- **可信度标注**: 召回的记忆标记为 "untrusted historical data"

### 📊 性能优化

- **向量索引**: LanceDB 原生支持高效相似度搜索
- **访问统计**: 记录访问次数和时间，支持未来的热度排序
- **批量操作**: 支持批量添加记忆条目

---

## 参考资料

- [LanceDB 官方文档](https://lancedb.github.io/lancedb/)
- [OpenClaw memory-lancedb 实现](../../../openclaw/docs/analysis/46-memory-lancedb-storage-mechanism.md)
