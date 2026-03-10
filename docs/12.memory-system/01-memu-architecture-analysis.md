# memU 架构全面分析

> 本文档基于 [memU](https://github.com/memU) 项目源码的深度阅读，对其核心架构、数据模型、工作流引擎和扩展机制进行全面剖析。

---

## 1. 整体架构概览

memU 是一个面向 LLM 应用的**结构化长期记忆系统**，核心设计理念是将非结构化对话内容转化为结构化、可检索、可衰减的记忆条目。

```
┌─────────────────────────────────────────────────────────────┐
│                     MemoryService (入口)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ MemorizeMixin│  │ RetrieveMixin│  │    CRUDMixin     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐  │
│  │              Workflow Pipeline Engine                  │  │
│  │  PipelineManager → WorkflowRunner → WorkflowStep[]    │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                   │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │                  Database Layer                        │  │
│  │  InMemory │ SQLite │ Postgres+pgvector                │  │
│  │  ─────────────────────────────────────                │  │
│  │  ResourceRepo │ MemoryItemRepo │ MemoryCategoryRepo   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────┐  ┌────────────────────────────┐  │
│  │   LLMClientWrapper    │  │     Blob Storage (FS)      │  │
│  │   (HTTP/OpenAI)       │  │     LocalFS                │  │
│  └───────────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Client Wrappers (可选)                      │
│  MemuOpenAIWrapper — 自动注入记忆到 chat.completions        │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

| 组件                | 职责                                       | 关键文件                                                         |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| **MemoryService**   | 统一入口，组合 Memorize/Retrieve/CRUD 能力 | `app/service.py`                                                 |
| **Workflow Engine** | Pipeline 编排、步骤执行、拦截器            | `workflow/step.py`, `workflow/pipeline.py`, `workflow/runner.py` |
| **Database**        | 三层数据持久化（Resource/Item/Category）   | `database/models.py`, `database/interfaces.py`                   |
| **LLM Client**      | 封装 LLM 调用（嵌入生成、记忆提取、排名）  | `llm/wrapper.py`, `llm/http_client.py`                           |
| **Prompts**         | 按记忆类型组织的 prompt 模板               | `prompts/memory_type/`, `prompts/retrieve/`                      |
| **OpenAI Wrapper**  | 透明代理，自动检索+注入记忆                | `client/openai_wrapper.py`                                       |

---

## 2. 三层数据模型

memU 的数据模型分为三个层次，从原始资源到原子记忆到分类聚合：

### 2.1 Resource（原始资源）

```python
class Resource(BaseRecord):
    url: str            # 资源 URL 或文件路径
    modality: str       # 模态: conversation, document, image, video
    local_path: str     # 本地缓存路径
    caption: str | None # 资源描述（vision LLM 生成）
    embedding: list[float] | None  # 资源级 embedding
```

**设计意图**：保留原始数据的引用，支持多模态（文本/图片/音频/视频），为溯源和再处理提供基础。

### 2.2 MemoryItem（原子记忆）

```python
class MemoryItem(BaseRecord):
    resource_id: str | None      # 来源 Resource 的 ID
    memory_type: str             # 记忆类型（6 种之一）
    summary: str                 # 记忆内容摘要（核心字段）
    embedding: list[float] | None  # 语义向量
    happened_at: datetime | None   # 事件发生时间
    extra: dict[str, Any] = {}     # 扩展字段
```

**extra 字段设计**（灵活扩展而非硬编码列）：

| 字段                  | 用途                                           |
| --------------------- | ---------------------------------------------- |
| `content_hash`        | 基于 summary+type 的 SHA256 前 16 位，用于去重 |
| `reinforcement_count` | 相同记忆被反复提及的次数（强化计数）           |
| `last_reinforced_at`  | 最后一次强化的时间（用于衰减计算）             |
| `ref_id`              | 引用其他记忆的 ID（记忆间关联）                |
| `when_to_use`         | 何时应该被检索的提示文本                       |
| `tool_calls`          | 工具调用历史（序列化的 ToolCallResult 列表）   |

### 2.3 MemoryCategory（分类聚合）

```python
class MemoryCategory(BaseRecord):
    name: str                      # 分类名称（如 personal_info）
    description: str               # 分类描述
    embedding: list[float] | None  # 分类级 embedding（基于摘要生成）
    summary: str | None            # 该分类下所有记忆的 LLM 聚合摘要
```

### 2.4 CategoryItem（关系边）

```python
class CategoryItem(BaseRecord):
    item_id: str       # 记忆条目 ID
    category_id: str   # 分类 ID
```

多对多关系：一个 MemoryItem 可以属于多个 Category。

### 2.5 关系图

```
Resource 1:N MemoryItem N:M MemoryCategory
    │               │              │
    │               │              │
    ▼               ▼              ▼
  原始对话      原子记忆条目    分类+聚合摘要
  原始文档      (带 embedding)  (带 embedding)
  原始图片
```

---

## 3. 六种记忆类型（MemoryType）

```python
MemoryType = Literal["profile", "event", "knowledge", "behavior", "skill", "tool"]
```

| 类型          | 含义                         | 示例                                            |
| ------------- | ---------------------------- | ----------------------------------------------- |
| **profile**   | 用户基本信息、偏好、长期特征 | "用户是 30 岁的产品经理"                        |
| **event**     | 具体事件、经历、活动         | "用户上周末和家人去公园野餐"                    |
| **knowledge** | 事实知识、概念、定义         | "Python 装饰器是一个接受函数返回函数的高阶函数" |
| **behavior**  | 行为模式、习惯               | "用户总是在晚上 10 点后回复消息"                |
| **skill**     | 技能、能力                   | "用户擅长数据分析和 SQL"                        |
| **tool**      | 工具调用记录                 | "使用 search_web 工具搜索天气信息，耗时 2.3s"   |

每种类型有独立的 LLM 提取 prompt（位于 `prompts/memory_type/` 下），确保提取精度。

---

## 4. 十个默认记忆分类

```python
DEFAULT_CATEGORIES = [
    "personal_info",    # 基本信息（姓名、年龄、职业等）
    "preferences",      # 偏好（喜好、厌恶）
    "relationships",    # 人际关系
    "activities",       # 活动和爱好
    "goals",            # 目标和计划
    "experiences",      # 经历和回忆
    "knowledge",        # 知识和技能
    "opinions",         # 观点和看法
    "habits",           # 习惯和行为模式
    "work_life",        # 工作和职业
]
```

分类是可配置的（通过 `MemorizeConfig.memory_categories`），支持自定义分类名称、描述和分类级别的 prompt。

---

## 5. Workflow Pipeline 引擎

这是 memU 的执行骨架，所有记忆写入和检索操作都通过 Pipeline 编排。

### 5.1 WorkflowStep（步骤）

```python
@dataclass
class WorkflowStep:
    step_id: str                    # 步骤标识
    role: str                       # 角色（如 "ingest", "extract", "persist"）
    handler: WorkflowHandler        # 异步处理函数
    description: str = ""           # 步骤描述
    requires: set[str] = set()      # 依赖的 state key
    produces: set[str] = set()      # 产出的 state key
    capabilities: set[str] = set()  # 所需能力（llm, vector, db, io, vision）
    config: dict[str, Any] = {}     # 步骤配置
```

**关键特性**：

- **requires/produces**：声明式依赖管理，运行前自动校验 state 中是否存在所需 key
- **capabilities**：能力声明，PipelineManager 可据此进行能力匹配和步骤裁剪
- **handler**：支持同步/异步处理函数

### 5.2 PipelineManager（管线管理）

```python
class PipelineManager:
    def register(name, steps, initial_state_keys)   # 注册管线
    def build(name) -> list[WorkflowStep]            # 构建可执行步骤列表
    def config_step(name, step_id, configs)          # 配置特定步骤
    def insert_after(name, target, new_step)         # 在指定步骤后插入
    def insert_before(name, target, new_step)        # 在指定步骤前插入
    def replace_step(name, step_id, new_step)        # 替换步骤
    def remove_step(name, step_id)                   # 移除步骤
```

**设计亮点**：

- **版本化**：每次修改创建新的 `PipelineRevision`，支持回溯
- **可扩展**：通过 `insert_before/after/replace/remove` 动态修改管线
- **能力校验**：注册时验证步骤所需能力是否可用

### 5.3 WorkflowRunner（步骤执行器）

实际执行 `WorkflowStep` 列表，支持：

- 串行执行（默认）
- 拦截器（before/after/on_error）

### 5.4 Interceptor（拦截器）

```python
class WorkflowInterceptorRegistry:
    def add_before(handler)     # 步骤执行前
    def add_after(handler)      # 步骤执行后
    def add_on_error(handler)   # 步骤异常时
```

用于日志、监控、调试、异常处理等横切关注点。

---

## 6. 用户作用域模型（User Scoping）

memU 通过 `UserConfig.model` 实现多用户/多 Agent 数据隔离：

```python
class UserConfig(BaseModel):
    model: type[BaseModel] = BaseModel  # 用户作用域模型
```

使用 `build_scoped_models(user_model)` 动态生成带作用域字段的数据模型：

```python
# 示例：定义包含 user_id 的作用域模型
class MyScope(BaseModel):
    user_id: str

# 生成的模型自动继承 MyScope + Resource/MemoryItem/MemoryCategory/CategoryItem
scoped_resource, scoped_category, scoped_item, scoped_relation = build_scoped_models(MyScope)
```

**实现机制**：通过 Python 动态类创建（`type()` + 多重继承），将作用域字段合并到每个数据表，所有查询自动过滤到对应作用域。

---

## 7. LLM 集成

### 7.1 LLMClientWrapper

封装不同 LLM 后端（OpenAI API、HTTP 直连等），提供统一接口：

- `chat(messages)` — 文本补全
- `embed(texts)` — 向量生成
- 拦截器支持（`LLMInterceptorRegistry`）

### 7.2 MemuOpenAIWrapper（客户端代理）

```python
wrapped = MemuOpenAIWrapper(client, service, user_data={"user_id": "user123"})

# 使用方式与原生 OpenAI 完全一致
response = wrapped.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "What's my favorite drink?"}]
)
```

**工作原理**：

1. 拦截 `chat.completions.create()` 调用
2. 提取最新 user message 作为 query
3. 调用 `service.retrieve()` 获取相关记忆
4. 将记忆注入到 system message 末尾（`<memu_context>...</memu_context>`）
5. 转发给原始 OpenAI client

---

## 8. 去重机制

```python
def compute_content_hash(summary: str, memory_type: str) -> str:
    normalized = " ".join(summary.lower().split())
    content = f"{memory_type}:{normalized}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]
```

- 对 summary 做小写+空白规范化后与 memory_type 拼接
- SHA256 取前 16 位作为 content_hash
- 检测到重复时，累加 `reinforcement_count` 而非创建新条目
- `last_reinforced_at` 记录最后强化时间

---

## 9. ToolCallResult（工具调用记忆）

```python
class ToolCallResult(BaseModel):
    tool_name: str          # 工具名
    input: dict | str       # 输入参数
    output: str             # 输出结果
    success: bool           # 是否成功
    time_cost: float        # 耗时（秒）
    token_cost: int         # Token 消耗
    score: float            # 质量评分（0-1）
    call_hash: str          # 输入+输出的 MD5（去重用）
```

用于 `tool` 类型的记忆，记录 Agent 的工具使用历史，支持后续的工具选择优化。

---

## 10. 配置体系

```python
class MemoryService:
    def __init__(
        self,
        llm_profiles,       # LLM 配置（多 profile 支持）
        blob_config,         # Blob 存储配置
        database_config,     # 数据库配置（type: inmemory/sqlite/postgres）
        memorize_config,     # 写入配置（类型、分类等）
        retrieve_config,     # 检索配置（排名策略、top_k 等）
        workflow_runner,     # 工作流执行器
        user_config,         # 用户作用域配置
    )
```

所有配置均为 Pydantic BaseModel，支持 dict 和对象两种传入方式，内部自动验证和转换。

---

## 11. 总结

memU 的架构设计体现了以下工程原则：

1. **关注点分离**：数据模型 / Pipeline / 存储 / LLM 调用各自独立
2. **可插拔**：存储后端、LLM 客户端、Pipeline 步骤均可替换
3. **声明式编排**：通过 requires/produces 声明步骤依赖，而非硬编码顺序
4. **渐进式复杂度**：从 InMemory 到 SQLite 到 Postgres，按需升级
5. **多用户安全**：通过动态模型合并实现作用域隔离
6. **LLM 原生**：提取和检索都依赖 LLM，而非规则匹配
