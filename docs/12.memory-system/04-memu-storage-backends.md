# memU 存储后端详细分析

> 本文档深度分析 memU 的三种存储后端实现（InMemory / SQLite / Postgres+pgvector），涵盖数据模型映射、Repository 协议、向量搜索和用户作用域。

---

## 1. 存储架构总览

```
                    ┌─────────────────────────┐
                    │    Database Protocol     │
                    │  (database/interfaces.py)│
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼─────────┐ ┌─────▼──────┐ ┌────────▼─────────┐
    │    InMemory        │ │  SQLite    │ │ Postgres+pgvector│
    │  (dict/list)       │ │ (SQLModel) │ │ (SQLAlchemy+pgv) │
    └───────────────────┘ └────────────┘ └──────────────────┘
```

---

## 2. Database Protocol（接口协议）

```python
@runtime_checkable
class Database(Protocol):
    resource_repo: ResourceRepo
    memory_category_repo: MemoryCategoryRepo
    memory_item_repo: MemoryItemRepo
    category_item_repo: CategoryItemRepo

    resources: dict[str, ResourceRecord]
    items: dict[str, MemoryItemRecord]
    categories: dict[str, MemoryCategoryRecord]
    relations: list[CategoryItemRecord]

    def close(self) -> None: ...
```

**四个 Repository 接口**：

### ResourceRepo

```python
class ResourceRepo(Protocol):
    async def create(resource: Resource) -> Resource
    async def get(id: str) -> Resource | None
    async def list(where: dict | None) -> list[Resource]
    async def update(id: str, data: dict) -> Resource
    async def delete(id: str) -> bool
```

### MemoryItemRepo

```python
class MemoryItemRepo(Protocol):
    async def create(item: MemoryItem) -> MemoryItem
    async def get(id: str) -> MemoryItem | None
    async def list(where: dict | None) -> list[MemoryItem]
    async def update(id: str, data: dict) -> MemoryItem
    async def delete(id: str) -> bool
    async def search(query_vec: list[float], k: int, where: dict | None) -> list[tuple[MemoryItem, float]]
```

### MemoryCategoryRepo

```python
class MemoryCategoryRepo(Protocol):
    async def create(category: MemoryCategory) -> MemoryCategory
    async def get(id: str) -> MemoryCategory | None
    async def get_by_name(name: str) -> MemoryCategory | None
    async def list(where: dict | None) -> list[MemoryCategory]
    async def update(id: str, data: dict) -> MemoryCategory
    async def delete(id: str) -> bool
```

### CategoryItemRepo

```python
class CategoryItemRepo(Protocol):
    async def create(relation: CategoryItem) -> CategoryItem
    async def list(where: dict | None) -> list[CategoryItem]
    async def list_by_category(category_id: str) -> list[CategoryItem]
    async def list_by_item(item_id: str) -> list[CategoryItem]
    async def delete(id: str) -> bool
```

---

## 3. InMemory 后端

### 3.1 数据结构

```python
class InMemoryDatabase:
    resources: dict[str, Resource] = {}
    items: dict[str, MemoryItem] = {}
    categories: dict[str, MemoryCategory] = {}
    relations: list[CategoryItem] = []
```

纯 Python dict/list，无持久化。适用于开发和测试。

### 3.2 向量搜索

使用 numpy 实现 brute-force 余弦相似度搜索：

```python
def cosine_topk(query_vec, corpus, k=5):
    """
    向量化余弦相似度 top-k 搜索。

    性能特点：
    - 使用 numpy 矩阵运算一次性计算所有相似度
    - argpartition 实现 O(n) topk 选择
    - 对 10K 条记忆搜索耗时 < 10ms
    """
    q = np.array(query_vec, dtype=np.float32)
    matrix = np.array(vecs, dtype=np.float32)  # shape: (n, dim)

    # 向量化: matrix @ q 一次计算所有点积
    q_norm = np.linalg.norm(q)
    vec_norms = np.linalg.norm(matrix, axis=1)
    scores = matrix @ q / (vec_norms * q_norm + 1e-9)

    # O(n) topk: argpartition 比 argsort O(n log n) 更快
    actual_k = min(k, len(scores))
    topk_indices = np.argpartition(scores, -actual_k)[-actual_k:]
    topk_indices = topk_indices[np.argsort(scores[topk_indices])[::-1]]

    return [(ids[i], float(scores[i])) for i in topk_indices]
```

### 3.3 Salience 感知搜索

```python
def cosine_topk_salience(query_vec, corpus, k=5, recency_decay_days=30.0):
    """
    综合 similarity × reinforcement × recency 的 Salience 搜索。

    corpus 元素: (id, embedding, reinforcement_count, last_reinforced_at)
    """
    for _id, vec, reinforcement_count, last_reinforced_at in corpus:
        similarity = cosine(q, v)
        score = salience_score(similarity, reinforcement_count,
                               last_reinforced_at, recency_decay_days)
        scored.append((_id, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
```

---

## 4. SQLite 后端

### 4.1 表结构

使用 SQLModel（SQLAlchemy + Pydantic 融合）：

| 表名                    | 对应模型       | 关键列                                                                           |
| ----------------------- | -------------- | -------------------------------------------------------------------------------- |
| `sqlite_resources`      | Resource       | id, url, modality, local_path, caption, embedding(JSON)                          |
| `sqlite_memory_items`   | MemoryItem     | id, resource_id, memory_type, summary, embedding(JSON), happened_at, extra(JSON) |
| `sqlite_categories`     | MemoryCategory | id, name, description, embedding(JSON), summary                                  |
| `sqlite_category_items` | CategoryItem   | id, item_id, category_id                                                         |

### 4.2 Embedding 存储

embedding 向量以 **JSON text** 格式存储在 SQLite 列中：

```python
# 写入
item.embedding = json.dumps(embedding_vector)

# 读取
embedding = json.loads(item.embedding)
```

**权衡**：SQLite 不支持原生向量类型，JSON text 存储简单但搜索时需全量加载到内存。

### 4.3 向量搜索

与 InMemory 后端相同——将所有 embedding 加载到内存后执行 brute-force 搜索。

**性能边界**：

- 1K 条记忆：搜索 < 5ms（可忽略）
- 10K 条记忆：搜索 < 50ms（可接受）
- 100K 条记忆：搜索 > 500ms（需要优化，建议切换 Postgres）

### 4.4 用户作用域

通过 `build_scoped_models()` 动态生成带作用域字段的 SQLModel 表：

```python
# 生成的表自动包含 user_id 列
class UserScopeResource(UserScope, Resource, SQLModel, table=True):
    user_id: str
    url: str
    modality: str
    # ... 其他字段
```

所有查询自动附加 `WHERE user_id = :user_id`。

---

## 5. Postgres + pgvector 后端

### 5.1 表结构

与 SQLite 类似，但 embedding 使用 pgvector 的 `VECTOR` 类型：

```sql
CREATE TABLE memory_items (
    id UUID PRIMARY KEY,
    resource_id UUID REFERENCES resources(id),
    memory_type VARCHAR NOT NULL,
    summary TEXT NOT NULL,
    embedding VECTOR(1536),  -- pgvector 原生向量类型
    happened_at TIMESTAMPTZ,
    extra JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

-- 向量索引
CREATE INDEX ON memory_items USING ivfflat (embedding vector_cosine_ops);
```

### 5.2 原生向量搜索

```sql
SELECT id, summary, embedding <=> :query_vec AS distance
FROM memory_items
WHERE user_id = :user_id
ORDER BY distance
LIMIT :k;
```

**优势**：

- 原生向量索引（IVFFlat/HNSW），大规模时性能远优于 brute-force
- 不需要将数据加载到内存
- 支持过滤条件（WHERE）+ 向量搜索的组合查询

### 5.3 Alembic 迁移

使用 Alembic 管理数据库 schema 迁移，支持版本化的 schema 变更。

---

## 6. 存储后端对比

| 维度               | InMemory            | SQLite             | Postgres+pgvector  |
| ------------------ | ------------------- | ------------------ | ------------------ |
| **持久化**         | 无（重启丢失）      | 文件级             | 服务级             |
| **向量搜索**       | brute-force (numpy) | brute-force (内存) | 原生向量索引       |
| **搜索复杂度**     | O(n)                | O(n)               | O(log n) with HNSW |
| **适用规模**       | < 1K 条             | < 10K 条           | > 10K 条           |
| **部署复杂度**     | 零                  | 零（单文件）       | 需 Postgres 服务   |
| **并发支持**       | 单进程              | 单写多读           | 多写多读           |
| **Embedding 存储** | list[float]         | JSON text          | VECTOR 类型        |
| **用途**           | 开发/测试           | 轻量级生产         | 生产级             |

---

## 7. Repository 设计模式

### 7.1 Protocol 驱动

所有 Repository 使用 Python `Protocol`（结构化类型）定义接口，而非抽象基类：

```python
@runtime_checkable
class MemoryItemRepo(Protocol):
    async def create(item: MemoryItem) -> MemoryItem: ...
    async def get(id: str) -> MemoryItem | None: ...
    async def search(query_vec: list[float], k: int) -> list[tuple[MemoryItem, float]]: ...
```

**优势**：

- 无需继承，只要实现了方法签名即可
- 支持运行时检查（`isinstance(repo, MemoryItemRepo)` 生效）
- 类型检查器友好

### 7.2 Factory 模式

```python
def build_database(config: DatabaseConfig, user_model: type[BaseModel]) -> Database:
    if config.type == "inmemory":
        return InMemoryDatabase(user_model)
    elif config.type == "sqlite":
        return SQLiteDatabase(config.url, user_model)
    elif config.type == "postgres":
        return PostgresDatabase(config.url, user_model)
```

通过配置切换后端，上层代码完全无感知。

---

## 8. 数据模型生成（Scoped Models）

memU 的独特设计——动态类生成：

```python
def merge_scope_model(user_model, core_model, *, name_suffix):
    """
    动态创建包含用户作用域的数据模型。

    使用 Python type() 进行多重继承：
    UserModel + CoreModel → ScopedModel
    """
    overlap = set(user_model.model_fields) & set(core_model.model_fields)
    if overlap:
        raise TypeError(f"Scope fields conflict: {overlap}")

    return type(
        f"{user_model.__name__}{core_model.__name__}{name_suffix}",
        (user_model, core_model),
        {"model_config": ConfigDict(extra="allow")},
    )
```

**示例**：

```python
class UserScope(BaseModel):
    user_id: str
    tenant_id: str

# 自动生成：
# UserScopeMemoryItemResource (包含 user_id + tenant_id + Resource 所有字段)
# UserScopeMemoryItemMemoryItem (包含 user_id + tenant_id + MemoryItem 所有字段)
```

这使得同一个数据库可以服务多个用户/租户，数据完全隔离。

---

## 9. coobee-ai 的选型建议

基于 coobee-ai 的场景（Electron 桌面应用、单用户为主）：

| 决策点    | 建议                        | 理由                                  |
| --------- | --------------------------- | ------------------------------------- |
| 存储引擎  | **better-sqlite3**          | Electron 原生支持、零配置、足够单用户 |
| 向量搜索  | **brute-force cosine (JS)** | 记忆量 < 10K，不需要 ANN 索引         |
| Embedding | JSON text 列                | 与 memU SQLite 方案一致               |
| 扩展路径  | 预留 Postgres 接口          | 未来多用户/云端可平滑切换             |
