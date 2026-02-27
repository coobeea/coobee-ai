# memU 记忆写入流程分析（Memorize Pipeline）

> 本文档深度分析 memU 的记忆写入管线，覆盖从原始资源输入到结构化记忆持久化的完整 7 步流程。

---

## 1. 管线总览

```
输入: resource_url + modality
  │
  ▼
┌─────────────────┐
│ ingest_resource  │  获取原始资源（文件/URL）
└────────┬────────┘
         ▼
┌─────────────────────────┐
│ preprocess_multimodal   │  按模态预处理（对话分段/文档切块/图片描述）
└────────┬────────────────┘
         ▼
┌─────────────────┐
│ extract_items   │  LLM 按类型提取记忆条目（6 种 prompt）
└────────┬────────┘
         ▼
┌─────────────────┐
│ dedupe_merge    │  去重合并（content_hash + reinforcement）
└────────┬────────┘
         ▼
┌──────────────────┐
│ categorize_items │  持久化 resource + items + embeddings + 分类关系
└────────┬─────────┘
         ▼
┌─────────────────┐
│ persist_index   │  LLM 更新分类摘要（增量合并已有摘要 + 新记忆）
└────────┬────────┘
         ▼
┌─────────────────┐
│ build_response  │  组装返回结果
└─────────────────┘

输出: { items: [...], categories: [...], resource: {...} }
```

---

## 2. 各步骤详解

### 2.1 ingest_resource

**职责**：获取原始资源内容

```python
WorkflowStep(
    step_id="ingest_resource",
    role="ingest",
    requires={"resource_url", "modality"},
    produces={"resource_content", "resource_record"},
)
```

- 通过 `LocalFS.fetch(url)` 读取文件内容
- 支持的 modality：`conversation`（JSON 对话）、`document`（文本文件）、`image`、`video`
- 创建 `Resource` 记录（包含 url、modality、local_path）

### 2.2 preprocess_multimodal

**职责**：按模态分发预处理

```python
WorkflowStep(
    step_id="preprocess_multimodal",
    role="preprocess",
    requires={"resource_content", "modality"},
    produces={"segments"},
    capabilities={"llm", "vision"},
)
```

**按模态分发**：

| modality     | 处理方式            | 说明                                    |
| ------------ | ------------------- | --------------------------------------- |
| conversation | LLM 对话分段        | 按话题/时间间隔切段，每段至少 20 条消息 |
| document     | 文本切块            | 按段落/章节分块                         |
| image        | Vision LLM          | 生成图片描述（caption）                 |
| video        | 帧提取 + Vision LLM | 提取关键帧后逐帧描述                    |

**对话分段 Prompt**（关键）：

```
将对话按话题和时间间隔分段。
每段应：
- 包含至少 20 条消息
- 围绕一个连贯的话题
- 在自然话题转换点切分
```

### 2.3 extract_items

**职责**：LLM 从每个 segment 中按类型提取记忆条目

```python
WorkflowStep(
    step_id="extract_items",
    role="extract",
    requires={"segments"},
    produces={"raw_items"},
    capabilities={"llm"},
)
```

**核心逻辑**：

```python
for memory_type in enabled_types:  # profile, event, knowledge, behavior, skill, tool
    prompt = MEMORY_TYPE_PROMPTS[memory_type]
    for segment in segments:
        formatted_prompt = prompt.format(
            resource=segment,
            categories_str=category_prompt_str,
        )
        response = await llm_client.chat(formatted_prompt)
        items = parse_xml_response(response)  # 解析 XML 格式输出
        raw_items.extend(items)
```

**每种类型独立 Prompt 的设计**（以 profile 为例）：

```xml
# Task Objective
你是一个专业的用户记忆提取器。核心任务是提取关于用户的独立记忆条目。

# Rules
- 使用 "user" 指代用户
- 每条记忆必须完整独立，单条 < 30 词
- 仅提取用户直接陈述或确认的事实
- 禁止提取临时/一次性信息
- 禁止提取助手的建议或推测

# Output Format (XML)
<item>
    <memory>
        <content>记忆内容</content>
        <categories>
            <category>分类名</category>
        </categories>
    </memory>
</item>
```

**六种类型 Prompt 的差异**：

| 类型      | 提取目标           | 长度限制 | 特殊规则                  |
| --------- | ------------------ | -------- | ------------------------- |
| profile   | 长期稳定的个人信息 | < 30 词  | 禁止事件类信息            |
| event     | 具体时间发生的事件 | < 50 词  | 需包含时间/地点/人物      |
| knowledge | 客观事实和知识     | < 50 词  | 禁止主观观点              |
| behavior  | 行为模式和习惯     | < 30 词  | 需多次出现的模式          |
| skill     | 技能和能力         | < 30 词  | 需明确的能力指标          |
| tool      | 工具调用记录       | 不限     | 包含工具名/输入/输出/耗时 |

### 2.4 dedupe_merge

**职责**：去重和合并

```python
WorkflowStep(
    step_id="dedupe_merge",
    role="dedupe",
    requires={"raw_items"},
    produces={"deduplicated_items"},
)
```

**去重算法**：

```python
content_hash = compute_content_hash(summary, memory_type)
# = hashlib.sha256(f"{type}:{normalized_summary}".encode()).hexdigest()[:16]

existing = find_by_content_hash(content_hash)
if existing:
    existing.reinforcement_count += 1
    existing.last_reinforced_at = now()
else:
    new_item.extra["content_hash"] = content_hash
    new_item.extra["reinforcement_count"] = 1
    new_item.extra["last_reinforced_at"] = now().isoformat()
```

**规范化**：对 summary 做 lowercase + strip + collapse whitespace，确保 "I love coffee" 和 "i love coffee" 被视为同一条记忆。

> **当前状态**：dedupe_merge 步骤在代码中标记为"占位阶段"（当前直通），完整去重逻辑在 categorize_items 步骤中实现。

### 2.5 categorize_items

**职责**：持久化 resource、memory items、embeddings、item-category 关系

```python
WorkflowStep(
    step_id="categorize_items",
    role="persist",
    requires={"deduplicated_items", "resource_record"},
    produces={"persisted_items", "category_items"},
    capabilities={"db", "vector"},
)
```

**执行流程**：

1. 持久化 Resource 记录
2. 为每个 MemoryItem 生成 embedding（调用 LLM embedding API）
3. 持久化 MemoryItem 记录
4. 根据提取时的 categories 标签，创建 CategoryItem 关系
5. 返回持久化后的 items 和关系

### 2.6 persist_index

**职责**：使用 LLM 更新分类摘要

```python
WorkflowStep(
    step_id="persist_index",
    role="index",
    requires={"persisted_items", "category_items"},
    produces={"updated_categories"},
    capabilities={"llm", "db"},
)
```

**分类摘要更新逻辑**（增量合并）：

```python
for category in affected_categories:
    existing_summary = category.summary or ""
    new_items = get_items_for_category(category.id)

    prompt = CATEGORY_SUMMARY_PROMPT.format(
        category_name=category.name,
        existing_summary=existing_summary,
        new_items=format_items(new_items),
    )

    updated_summary = await llm_client.chat(prompt)
    category.summary = updated_summary
    category.embedding = await llm_client.embed(updated_summary)
```

**设计意图**：分类摘要是一个"活的"概览，随着新记忆的加入不断更新，在检索阶段可以先匹配分类摘要再深入条目，实现分层检索。

### 2.7 build_response

**职责**：组装最终返回结果

```python
WorkflowStep(
    step_id="build_response",
    role="output",
    requires={"persisted_items", "updated_categories", "resource_record"},
    produces={"result"},
)
```

返回结构：

```python
{
    "items": [MemoryItem, ...],        # 新增/更新的记忆条目
    "categories": [MemoryCategory, ...],  # 受影响的分类（含更新后的摘要）
    "resource": Resource,               # 资源记录
}
```

---

## 3. Prompt 工程设计

### 3.1 分块结构

每种类型的 prompt 都采用统一的模块化结构：

```python
PROMPT = "\n\n".join([
    PROMPT_BLOCK_OBJECTIVE,   # 任务目标
    PROMPT_BLOCK_WORKFLOW,    # 工作流程
    PROMPT_BLOCK_RULES,       # 规则约束
    PROMPT_BLOCK_CATEGORY,    # 记忆分类列表
    PROMPT_BLOCK_OUTPUT,      # 输出格式
    PROMPT_BLOCK_EXAMPLES,    # 示例
    PROMPT_BLOCK_INPUT,       # 输入资源
])
```

**可定制性**：每个 block 可以单独替换（通过 `CustomPrompt` 配置），实现 prompt 级别的精细调优。

### 3.2 输出格式选择

memU 使用 **XML 格式** 输出（而非 JSON）：

```xml
<item>
    <memory>
        <content>用户是一名产品经理</content>
        <categories>
            <category>Basic Information</category>
        </categories>
    </memory>
</item>
```

**XML 的优势**：

- LLM 生成 XML 时不容易产生格式错误（相比 JSON 的引号/逗号问题）
- 使用 `defusedxml.ElementTree` 安全解析
- 支持流式解析（不需要完整文档）

### 3.3 Profile vs Event 提取对比

同一段对话中，不同类型的 prompt 提取的内容完全不同：

**输入**：

> "我 30 岁，在互联网公司做产品经理。下周末打算去旅行。"

**profile 提取**：

- "用户是 30 岁的产品经理"
- "用户在互联网公司工作"

**event 提取**：

- "用户下周末计划去旅行"

---

## 4. 管线扩展机制

### 4.1 自定义步骤注入

```python
custom_step = WorkflowStep(
    step_id="my_filter",
    role="filter",
    handler=my_filter_handler,
    requires={"raw_items"},
    produces={"filtered_items"},
)

service._pipelines.insert_after("memorize", "extract_items", custom_step)
```

### 4.2 步骤配置

```python
service._pipelines.config_step("memorize", "extract_items", {
    "enabled_types": ["profile", "event"],  # 只提取 profile 和 event
    "max_items_per_segment": 20,
})
```

### 4.3 LLM Profile 切换

不同步骤可使用不同的 LLM profile：

```python
service = MemoryService(
    llm_profiles={
        "default": {"chat_model": "gpt-4o-mini"},
        "extraction": {"chat_model": "gpt-4o"},       # 提取用更强的模型
        "embedding": {"chat_model": "text-embedding-3-small"},
    }
)
```

---

## 5. 调用入口

```python
service = MemoryService(llm_profiles={"default": {"api_key": "...", "chat_model": "gpt-4o-mini"}})

result = await service.memorize(
    resource_url="conversations/conv1.json",
    modality="conversation",
)
# result = { items: [...], categories: [...], resource: {...} }
```

---

## 6. 关键设计决策

| 决策     | 选择                         | 理由                                  |
| -------- | ---------------------------- | ------------------------------------- |
| 提取粒度 | 每种类型独立 prompt          | 精度 > 效率；不同类型的提取规则差异大 |
| 输出格式 | XML                          | 比 JSON 更不容易被 LLM 生成错误       |
| 去重策略 | content_hash + reinforcement | 内容级去重，重复出现增强权重          |
| 分类摘要 | LLM 增量更新                 | 分层检索的基础；避免全量重算          |
| 预处理   | 按模态分发                   | 对话/文档/图片/视频的处理逻辑差异极大 |
