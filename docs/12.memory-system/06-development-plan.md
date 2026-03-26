# coobee-ai 记忆系统重设计 — 开发计划

> 基于 memU 架构分析和差距评估，制定 coobee-ai 记忆系统从 Markdown 文件存储到结构化 SQLite + 语义检索的完整升级计划。

---

## 总览

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
结构化模型    LLM 写入    语义检索     向后兼容     回归测试
+ SQLite     Pipeline    + 排名       + 迁移      + 修复
(2-3 天)     (2-3 天)    (2-3 天)     (1-2 天)    (1-2 天)
```

**总预估工期**：8-13 天

---

## Phase 1: 结构化记忆数据模型 + SQLite 存储（2-3 天）

### 目标

建立三层数据模型（Resource → MemoryItem → MemoryCategory），替换纯 Markdown 存储。

### 1.1 数据模型设计

**文件**: `src/main/ai/memory/models.ts`

```typescript
// 记忆类型
type MemoryType = 'profile' | 'event' | 'knowledge' | 'behavior' | 'skill' | 'tool';

// 基础记录
interface BaseRecord {
  id: string; // UUID
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

// 原始资源
interface MemoryResource extends BaseRecord {
  url: string; // 资源路径/URL
  modality: string; // conversation | document | text
  content: string; // 原始内容（或摘要）
}

// 原子记忆条目
interface MemoryItem extends BaseRecord {
  resourceId: string | null; // 来源资源 ID
  memoryType: MemoryType; // 记忆类型
  summary: string; // 记忆摘要（核心内容）
  embedding: number[] | null; // 语义向量
  happenedAt: string | null; // 事件时间
  contentHash: string; // SHA256[:16] 去重哈希
  reinforcementCount: number; // 强化计数
  lastReinforcedAt: string | null; // 最后强化时间
  extra: Record<string, unknown>; // 扩展字段（JSON）
}

// 记忆分类
interface MemoryCategory extends BaseRecord {
  name: string; // 分类名称
  description: string; // 分类描述
  summary: string | null; // 分类摘要（LLM 生成）
  embedding: number[] | null; // 分类摘要向量
}

// 分类-条目关系
interface CategoryItem extends BaseRecord {
  itemId: string; // MemoryItem ID
  categoryId: string; // MemoryCategory ID
}
```

### 1.2 SQLite 存储实现

**文件**: `src/main/ai/memory/storage/sqlite.ts`

使用 `better-sqlite3`（Electron 生态中最成熟的 SQLite 绑定）。

**表结构**：

```sql
CREATE TABLE IF NOT EXISTS memory_resources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  modality TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  resource_id TEXT,
  memory_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding TEXT,           -- JSON 编码的 float[]
  happened_at TEXT,
  content_hash TEXT NOT NULL,
  reinforcement_count INTEGER DEFAULT 1,
  last_reinforced_at TEXT,
  extra TEXT DEFAULT '{}',  -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES memory_resources(id)
);

CREATE TABLE IF NOT EXISTS memory_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  summary TEXT,
  embedding TEXT,           -- JSON 编码的 float[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES memory_items(id),
  FOREIGN KEY (category_id) REFERENCES memory_categories(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_items_type ON memory_items(memory_type);
CREATE INDEX IF NOT EXISTS idx_items_hash ON memory_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_items_resource ON memory_items(resource_id);
CREATE INDEX IF NOT EXISTS idx_catitems_item ON category_items(item_id);
CREATE INDEX IF NOT EXISTS idx_catitems_category ON category_items(category_id);
```

### 1.3 Repository 实现

**目录**: `src/main/ai/memory/repositories/`

| 文件                    | 接口               | 关键方法                                              |
| ----------------------- | ------------------ | ----------------------------------------------------- |
| `memoryItemRepo.ts`     | MemoryItemRepo     | create, get, list, update, delete, findByHash, search |
| `memoryCategoryRepo.ts` | MemoryCategoryRepo | create, get, getByName, list, update, delete          |
| `resourceRepo.ts`       | ResourceRepo       | create, get, list, delete                             |
| `categoryItemRepo.ts`   | CategoryItemRepo   | create, list, listByCategory, listByItem, delete      |

### 1.4 测试

**文件**: `src/main/ai/memory/__tests__/storage.test.ts`

测试用例：

- [x] 创建/读取/更新/删除 MemoryItem
- [x] 创建/读取/更新/删除 MemoryCategory
- [x] 创建/读取 MemoryResource
- [x] CategoryItem 关系 CRUD
- [x] 按 memory_type 过滤
- [x] 按 content_hash 查重
- [x] 列表查询（含分页）
- [x] SQLite 文件创建和关闭

### 1.5 交付物

- `src/main/ai/memory/models.ts`
- `src/main/ai/memory/storage/sqlite.ts`
- `src/main/ai/memory/repositories/*.ts`
- `src/main/ai/memory/__tests__/storage.test.ts`

---

## Phase 2: 记忆写入 Pipeline（2-3 天）

### 目标

用 LLM 主动提取替换 regex 信号词，实现类型化记忆捕获。

### 2.1 Pipeline 实现

**文件**: `src/main/ai/memory/pipeline/memorize.ts`

```
对话输入 → LLM 提取（按类型） → 去重（content_hash） → 持久化 → 分类更新
```

**核心函数**：

```typescript
async function memorize(input: {
  content: string;
  modality: 'conversation' | 'text';
  sessionId: string;
}): Promise<MemorizeResult> {
  // 1. 创建 Resource 记录
  // 2. 对每种启用的 memory_type，调用 LLM 提取
  // 3. 解析 XML/JSON 输出为 MemoryItem[]
  // 4. content_hash 去重：已有 → reinforcement_count++；新 → create
  // 5. 生成 embedding（如果配置了 embedding provider）
  // 6. 持久化到 SQLite
  // 7. 更新分类摘要
  return { items, categories, resource };
}
```

### 2.2 Prompt 设计

**目录**: `src/main/ai/memory/prompts/`

| 文件                  | 用途         | 参考              |
| --------------------- | ------------ | ----------------- |
| `extractProfile.ts`   | 提取用户信息 | memU profile.py   |
| `extractEvent.ts`     | 提取事件经历 | memU event.py     |
| `extractKnowledge.ts` | 提取知识概念 | memU knowledge.py |
| `categorySummary.ts`  | 更新分类摘要 | memU category.py  |

**Prompt 结构**（模块化）：

```typescript
const PROMPT = [
  OBJECTIVE, // 任务目标
  WORKFLOW, // 工作流程
  RULES, // 规则约束
  CATEGORIES, // 分类列表（动态注入）
  OUTPUT_FORMAT, // 输出格式（XML）
  EXAMPLES, // 示例
  INPUT // 输入内容（动态注入）
].join('\n\n');
```

### 2.3 去重机制

```typescript
function computeContentHash(summary: string, memoryType: string): string {
  const normalized = summary.toLowerCase().trim().replace(/\s+/g, ' ');
  const content = `${memoryType}:${normalized}`;
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
```

### 2.4 集成到 agent_end hook

改造 `extensions/memory-thread/index.ts`：

```typescript
api.on('agent_end', async (event) => {
  // 原有 regex 逻辑作为 fallback
  // 新增：调用 memorize pipeline
  const result = await memorizePipeline.memorize({
    content: event.output,
    modality: 'conversation',
    sessionId: event.sessionId
  });
  api.logger.info(`Captured ${result.items.length} memories`);
});
```

### 2.5 测试

**文件**: `src/main/ai/memory/__tests__/memorize.test.ts`

测试用例：

- [x] 对话输入 → 正确提取 profile 类型记忆
- [x] 对话输入 → 正确提取 event 类型记忆
- [x] 对话输入 → 正确提取 knowledge 类型记忆
- [x] 重复内容 → reinforcement_count 递增
- [x] 空/短输入 → 不提取记忆
- [x] 中文对话 → 正确提取
- [x] XML 解析错误 → 优雅降级
- [x] 分类摘要更新

---

## Phase 3: 语义检索 + Salience 排名（2-3 天）

### 目标

embedding 语义搜索替换关键词匹配，Salience 评分综合排名。

### 3.1 Embedding 生成

**文件**: `src/main/ai/memory/embedding.ts`

```typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

// 实现 1: OpenAI text-embedding-3-small
class OpenAIEmbedding implements EmbeddingProvider { ... }

// 实现 2: 本地模型（预留）
class LocalEmbedding implements EmbeddingProvider { ... }
```

### 3.2 向量搜索

**文件**: `src/main/ai/memory/vector.ts`

```typescript
function cosineSimilarity(a: number[], b: number[]): number;

function cosineTopK(
  queryVec: number[],
  corpus: Array<{ id: string; embedding: number[] }>,
  k: number
): Array<{ id: string; score: number }>;

function salienceScore(
  similarity: number,
  reinforcementCount: number,
  lastReinforcedAt: Date | null,
  recencyDecayDays: number
): number;

function cosineTopKSalience(
  queryVec: number[],
  corpus: Array<{
    id: string;
    embedding: number[];
    reinforcementCount: number;
    lastReinforcedAt: Date | null;
  }>,
  k: number,
  recencyDecayDays?: number
): Array<{ id: string; score: number }>;
```

### 3.3 检索 Pipeline

**文件**: `src/main/ai/memory/pipeline/retrieve.ts`

```typescript
async function retrieve(input: {
  query: string;
  topK?: number;
  ranking?: 'similarity' | 'salience';
  memoryTypes?: MemoryType[];
}): Promise<RetrieveResult> {
  // 1. 生成 query embedding
  // 2. 向量搜索（cosineTopK 或 cosineTopKSalience）
  // 3. 可选：按 memoryType 过滤
  // 4. 格式化为可注入文本
  return { items, context };
}
```

### 3.4 注入改造

改造 `memory-thread` 的 `before_agent_start` hook：

```typescript
api.on('before_agent_start', async (event) => {
  // 从最近对话中提取 query
  const query = extractRecentQuery(event);

  // 语义检索（替换原有关键词匹配）
  const result = await retrievePipeline.retrieve({
    query,
    topK: 10,
    ranking: 'salience'
  });

  // 注入到 instructions
  event.instructions += `\n\n<memory_context>\n${result.context}\n</memory_context>`;
});
```

### 3.5 测试

**文件**: `src/main/ai/memory/__tests__/retrieve.test.ts`

测试用例：

- [x] 语义相似查询 → 返回相关记忆
- [x] 不相关查询 → 不返回
- [x] Salience 排名：高频强化记忆排名更高
- [x] Salience 排名：近期记忆排名更高
- [x] 按 memoryType 过滤
- [x] top_k 限制
- [x] 空 embedding → 跳过
- [x] 向量计算正确性

---

## Phase 4: 向后兼容 + 迁移（1-2 天）

### 目标

现有 Markdown 记忆无损迁移到新系统。

### 4.1 迁移工具

**文件**: `src/main/ai/memory/migration.ts`

```typescript
async function migrateFromMarkdown(workspacePath: string): Promise<MigrationResult> {
  // 1. 扫描 MEMORY.md + memory/*.md
  // 2. 逐行解析为候选 MemoryItem
  // 3. LLM 辅助分类（确定 memory_type）
  // 4. 生成 embedding
  // 5. 写入 SQLite
  // 6. 不删除原文件（只读迁移）
  return { migratedCount, skippedCount, errors };
}
```

### 4.2 memory tool 兼容

保持 `memory` tool 现有 API 不变：

- `list` → 从 SQLite 读取分类列表
- `read` → 从 SQLite 读取指定分类/条目
- `write` → 写入 SQLite（经过 LLM 提取管线）
- `search` → 语义搜索（替代关键词搜索）

### 4.3 Markdown 导出

```typescript
async function exportToMarkdown(outputDir: string): Promise<void> {
  // 将 SQLite 中的记忆按分类导出为 Markdown 文件
  // 用于人工查看和备份
}
```

### 4.4 Memory Settings UI 适配

更新 `MemorySettings.vue`：

- 显示结构化记忆统计（按类型、按分类）
- 支持查看具体记忆条目
- 支持手动删除/编辑记忆

### 4.5 测试

**文件**: `src/main/ai/memory/__tests__/migration.test.ts`

测试用例：

- [x] MEMORY.md 迁移 → 内容正确
- [x] memory/\*.md 迁移 → 分类正确
- [x] 空文件 → 跳过
- [x] 迁移后计数一致
- [x] 原文件未被修改

---

## Phase 5: 自动化回归测试 + 修复（1-2 天）

### 目标

确保所有记忆相关功能端到端可用。

### 5.1 集成测试套件

**文件**: `src/main/ai/memory/__tests__/integration.test.ts`

测试场景：

- [x] 完整对话流程：输入 → 提取 → 存储 → 检索 → 注入
- [x] 多轮对话记忆持久化
- [x] 跨 session 记忆检索
- [x] 记忆去重和 reinforcement
- [x] 记忆衰减（模拟时间推移）

### 5.2 性能基准

**文件**: `src/main/ai/memory/__tests__/benchmark.test.ts`

| 场景             | 目标                |
| ---------------- | ------------------- |
| 100 条记忆检索   | < 50ms              |
| 1000 条记忆检索  | < 100ms             |
| 10000 条记忆检索 | < 500ms             |
| 单次记忆写入     | < 200ms（不含 LLM） |
| 批量迁移 100 条  | < 5s                |

### 5.3 修复流程

```
运行全部测试 → 收集失败用例 → 分析根因 → 修复 → 重新运行 → 直到全部通过
```

---

## 技术选型决策

| 决策点    | 选择                                  | 理由                                             |
| --------- | ------------------------------------- | ------------------------------------------------ |
| 存储引擎  | better-sqlite3                        | Electron 原生支持、零配置、足够单用户场景        |
| 向量搜索  | brute-force cosine（TypeScript）      | 单用户记忆量 < 10K 条，不需要 ANN 索引           |
| Embedding | OpenAI text-embedding-3-small（在线） | 复用已有 LLM provider 配置                       |
| 记忆类型  | profile/event/knowledge（核心 3 种）  | 优先覆盖最常用类型，behavior/skill/tool 后续扩展 |
| 输出格式  | XML（LLM 提取结果）                   | 比 JSON 更不容易被 LLM 生成错误                  |
| 兼容策略  | 新旧并存，Markdown 作为 export 格式   | 平滑过渡                                         |

---

## 风险和缓解

| 风险                                             | 缓解措施                                        |
| ------------------------------------------------ | ----------------------------------------------- |
| better-sqlite3 在 Electron 中需要 native rebuild | 使用 electron-rebuild 或预编译二进制            |
| Embedding API 调用增加延迟和成本                 | 缓存 embedding、批量生成、可选关闭              |
| LLM 提取质量不稳定                               | 多种 prompt 模板 + 输出校验 + fallback 到 regex |
| 迁移过程中数据丢失                               | 只读迁移（不删除原文件）、校验计数              |
| SQLite 并发写入冲突                              | 使用 WAL 模式 + 写入队列                        |

---

## 文件结构预览

```
src/main/ai/memory/
├── models.ts                    # 数据模型定义
├── storage/
│   └── sqlite.ts                # SQLite 存储实现
├── repositories/
│   ├── memoryItemRepo.ts        # 记忆条目 Repository
│   ├── memoryCategoryRepo.ts    # 记忆分类 Repository
│   ├── resourceRepo.ts          # 资源 Repository
│   └── categoryItemRepo.ts      # 分类关系 Repository
├── pipeline/
│   ├── memorize.ts              # 写入 Pipeline
│   └── retrieve.ts              # 检索 Pipeline
├── prompts/
│   ├── extractProfile.ts        # Profile 提取 Prompt
│   ├── extractEvent.ts          # Event 提取 Prompt
│   ├── extractKnowledge.ts      # Knowledge 提取 Prompt
│   └── categorySummary.ts       # 分类摘要 Prompt
├── embedding.ts                 # Embedding 生成
├── vector.ts                    # 向量搜索
├── migration.ts                 # Markdown 迁移工具
└── __tests__/
    ├── storage.test.ts          # 存储测试
    ├── memorize.test.ts         # 写入测试
    ├── retrieve.test.ts         # 检索测试
    ├── migration.test.ts        # 迁移测试
    ├── integration.test.ts      # 集成测试
    └── benchmark.test.ts        # 性能基准
```
