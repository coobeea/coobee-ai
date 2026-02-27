# memU 记忆检索流程分析（Retrieve Pipeline）

> 本文档深度分析 memU 的记忆检索管线，涵盖两种检索模式、分层检索流程、Salience 评分算法和注入机制。

---

## 1. 检索管线总览

```
输入: queries (list of {role, content})
  │
  ▼
┌──────────────────────┐
│  route_intention     │  LLM 判断是否需要检索 + 可选 query rewrite
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│  category_recall     │  分类级检索：向量搜索匹配最相关的分类
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│  sufficiency_check   │  LLM 判断分类级信息是否足够
└─────────┬────────────┘
          ▼ (不足够时继续)
┌──────────────────────┐
│  item_recall         │  条目级检索：在匹配的分类下搜索具体记忆
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│  sufficiency_check   │  LLM 判断条目级信息是否足够
└─────────┬────────────┘
          ▼ (不足够时继续)
┌──────────────────────┐
│  resource_recall     │  资源级检索：回溯原始资源
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│  build_context       │  组装检索结果为可注入格式
└──────────────────────┘

输出: { items: [...], categories: [...], context: "..." }
```

---

## 2. 两种检索模式

### 2.1 RAG 模式（向量检索）

基于 embedding 向量的语义相似度检索，可选 Salience 评分增强。

**流程**：

1. 将 query 生成 embedding
2. 计算 query embedding 与所有 category/item embedding 的余弦相似度
3. 按相似度（或 Salience 评分）排序
4. 返回 top-k 结果

### 2.2 LLM 模式（LLM 排名）

使用 LLM 对格式化的 category/item/resource 上下文做重排序。

**流程**：

1. 将候选记忆格式化为文本
2. 调用 LLM 进行相关性排名
3. 按 LLM 评分排序返回

---

## 3. 各步骤详解

### 3.1 route_intention（意图路由）

**职责**：判断当前 query 是否需要从记忆中检索信息

**Prompt 设计**：

```
# Task Objective
判断当前查询是否需要从记忆中检索信息。
如果需要检索，重写查询以包含相关上下文。

# Rules
- NO_RETRIEVE: 问候/闲聊/通用知识/当前对话上下文问题
- RETRIEVE: 过去的事件/用户偏好/特定历史信息

# Output
<decision>RETRIEVE 或 NO_RETRIEVE</decision>
<rewritten_query>重写后的查询</rewritten_query>
```

**输入**：

```
Query Context: {conversation_history}
Current Query: {query}
Retrieved Content: {retrieved_content}
```

**Query Rewrite**（查询重写）：

```
# Task Objective
通过解析代词和隐式引用，将查询重写为完整独立的形式。

例: "他怎么样了?" + 上文 "我爸爸最近身体不好"
  → "用户父亲的身体状况如何？"
```

### 3.2 category_recall（分类级检索）

**职责**：从分类级别进行粗粒度匹配

**逻辑**：

```python
query_embedding = await embed(rewritten_query)

# 在所有分类的 embedding 中搜索
top_categories = cosine_topk(
    query_vec=query_embedding,
    corpus=[(cat.id, cat.embedding) for cat in all_categories],
    k=top_k_categories,
)
```

返回最相关的 N 个分类及其摘要。

### 3.3 sufficiency_check（充分性检查）

**职责**：LLM 判断当前检索到的信息是否足以回答 query

```python
prompt = f"""
已检索到的信息：{retrieved_so_far}
原始查询：{query}

请判断：这些信息是否足以回答查询？
回答 SUFFICIENT 或 INSUFFICIENT。
"""
```

**作用**：避免不必要的深层检索，节省 LLM 调用和延迟。如果分类摘要已经足够，就无需检索具体条目。

### 3.4 item_recall（条目级检索）

**职责**：在匹配的分类范围内搜索具体记忆条目

**两种排名策略**：

#### 策略 1: Similarity（纯相似度）

```python
results = cosine_topk(
    query_vec=query_embedding,
    corpus=[(item.id, item.embedding) for item in category_items],
    k=top_k_items,
)
```

#### 策略 2: Salience（显著性评分）

```python
results = cosine_topk_salience(
    query_vec=query_embedding,
    corpus=[
        (item.id, item.embedding,
         item.extra.get("reinforcement_count", 0),
         item.extra.get("last_reinforced_at"))
        for item in category_items
    ],
    k=top_k_items,
    recency_decay_days=30.0,
)
```

### 3.5 resource_recall（资源级检索）

**职责**：当条目级信息仍不够时，回溯到原始资源

通过 `item.resource_id` 关联回原始 Resource，获取完整上下文。这是最细粒度的检索层。

### 3.6 build_context（构建上下文）

**职责**：将检索结果格式化为可注入 LLM 的文本

```python
context = "<memu_context>\n"
context += "Relevant context about the user:\n"
for item in retrieved_items:
    context += f"- {item.summary}\n"
context += "</memu_context>"
```

---

## 4. Salience 评分算法

这是 memU 检索系统的核心创新点——综合考虑语义相似度、强化频率和时间衰减。

### 4.1 公式

```
salience = similarity × reinforcement_factor × recency_factor
```

### 4.2 各因子计算

#### Similarity（语义相似度）

```python
def cosine(a, b):
    return dot(a, b) / (norm(a) * norm(b) + 1e-9)
```

范围：`[0, 1]`

#### Reinforcement Factor（强化因子）

```python
reinforcement_factor = log(reinforcement_count + 1)
```

- `count=0` → factor=0（未被强化的记忆权重为 0）
- `count=1` → factor=0.69
- `count=5` → factor=1.79
- `count=100` → factor=4.62

**对数缩放**的意义：防止高频重复记忆过度主导排名。

#### Recency Factor（时间衰减因子）

```python
if last_reinforced_at is None:
    recency_factor = 0.5  # 未知时间给中性分
else:
    days_ago = (now - last_reinforced_at).total_seconds() / 86400
    recency_factor = exp(-0.693 * days_ago / recency_decay_days)
```

- `days_ago=0` → factor=1.0（刚刚强化）
- `days_ago=30` → factor=0.5（半衰期）
- `days_ago=60` → factor=0.25
- `days_ago=90` → factor=0.125

**半衰期模型**：`recency_decay_days`（默认 30 天）为半衰期，0.693 = ln(2) 确保精确的半衰期衰减。

### 4.3 评分示例

| 记忆               | similarity | reinforcement | last_reinforced | salience                  |
| ------------------ | ---------- | ------------- | --------------- | ------------------------- |
| "用户喜欢喝咖啡"   | 0.85       | 5次           | 2天前           | 0.85 × 1.79 × 0.96 = 1.46 |
| "用户上周去了公园" | 0.90       | 1次           | 10天前          | 0.90 × 0.69 × 0.79 = 0.49 |
| "用户是产品经理"   | 0.70       | 20次          | 30天前          | 0.70 × 3.04 × 0.50 = 1.06 |

**效果**：高频强化的稳定信息（如偏好）即使衰减后仍有较高权重；一次性事件快速衰减。

---

## 5. 向量搜索实现

### 5.1 InMemory 实现（brute-force）

```python
def cosine_topk(query_vec, corpus, k=5):
    q = np.array(query_vec, dtype=np.float32)
    matrix = np.array(vecs, dtype=np.float32)  # shape: (n, dim)

    # 向量化余弦计算
    scores = matrix @ q / (vec_norms * q_norm + 1e-9)

    # O(n) topk 选择（argpartition 而非 O(n log n) sort）
    topk_indices = np.argpartition(scores, -k)[-k:]
    topk_indices = topk_indices[np.argsort(scores[topk_indices])[::-1]]

    return [(ids[i], float(scores[i])) for i in topk_indices]
```

**性能优化**：

- numpy 向量化矩阵乘法（而非逐一计算）
- `argpartition` 实现 O(n) topk（而非 O(n log n) 排序）
- 对 10K 条记忆，实测搜索耗时 < 10ms

### 5.2 SQLite 实现

embedding 存储为 JSON text，检索时加载到内存做 brute-force 搜索。

### 5.3 Postgres 实现

使用 pgvector 扩展的原生向量搜索：

```sql
SELECT id, summary, embedding <=> :query_vec AS distance
FROM memory_items
ORDER BY distance
LIMIT :k
```

---

## 6. 注入机制

### 6.1 手动注入

```python
result = await service.retrieve(
    queries=[{"role": "user", "content": "我最喜欢什么饮料？"}],
    where={"user_id": "user123"},
)

# 手动将 result.items 注入到 LLM 消息中
```

### 6.2 自动注入（MemuOpenAIWrapper）

```python
wrapped = MemuOpenAIWrapper(client, service, user_data={"user_id": "user123"})

# 自动检索 + 注入，对调用者透明
response = wrapped.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "What's my favorite drink?"}]
)
```

**注入格式**：

```
[原始 system message]

<memu_context>
Relevant context about the user (use only if relevant to the query):
- 用户喜欢喝咖啡，尤其是拿铁
- 用户不喜欢碳酸饮料
</memu_context>
```

---

## 7. 关键设计决策

| 决策       | 选择                       | 理由                                 |
| ---------- | -------------------------- | ------------------------------------ |
| 分层检索   | Category → Item → Resource | 渐进式精细化，避免全量搜索           |
| 充分性检查 | LLM 判断                   | 动态决策是否需要更深层检索，节省成本 |
| 排名策略   | Salience（默认）           | 综合考虑相似度、频率和时效性         |
| 衰减模型   | 指数半衰期                 | 物理直觉明确，参数可调               |
| 注入位置   | system message 末尾        | 不干扰原始 prompt 结构               |
| 查询重写   | LLM 解析代词/隐式引用      | 提高检索准确率                       |
