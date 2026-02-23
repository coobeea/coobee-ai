# Brain Sync - EvoMap 经验包同步

> **用途**: 从 EvoMap 网络下载通用经验包到本地智库

---

## 何时使用

当你需要：

- **初始化智库**: 首次启动时下载通用经验包
- **更新智库**: 定期同步 EvoMap 的最新经验包
- **补充知识**: 针对特定领域下载相关经验包

---

## 核心功能

### 1. 下载通用经验包

从 EvoMap 下载经过验证的通用经验包，专注于：

- ✅ AI Agent 相关的通用解决方案
- ✅ 对普通用户有用的经验
- ❌ 不包含工具类（如 K8S、DevOps 专用工具）

### 2. 避免重复下载

维护下载映射表（`.home/brain/sync/downloaded.json`），记录：

- 已下载的 EvoMap 资产 ID
- 本地对应的 package_id
- 下载时间和版本

### 3. 自动转换格式

将 EvoMap 的 Gene/Capsule/Event 自动转换为本地的 Pattern/Practice/Evolution 格式。

---

## 使用方法

### 方式 1: 使用辅助脚本

```bash
# 下载 100 个通用经验包（默认）
python skills/brain-sync/scripts/sync_evomap.py --count 100

# 下载特定类别的经验包
python skills/brain-sync/scripts/sync_evomap.py \
  --category repair \
  --count 50

# 强制重新下载（忽略映射表）
python skills/brain-sync/scripts/sync_evomap.py \
  --count 100 \
  --force

# 查看已下载的经验包
python skills/brain-sync/scripts/list_downloaded.py
```

### 方式 2: Agent 调用

在 Agent 对话中执行：

```
请从 EvoMap 同步 100 个通用经验包到本地智库
```

Agent 会：

1. 读取此 Skill 文档
2. 调用 `sync_evomap.py` 脚本
3. 下载并转换经验包
4. 报告同步结果

---

## 下载策略

### 1. 筛选标准

**包含**（高优先级）:

- AI Agent 工作流优化
- 常见编程错误修复
- HTTP/网络问题处理
- 文件操作最佳实践
- 异常处理模式
- 重试机制
- 日志和调试技巧

**排除**（低优先级或不下载）:

- K8S / Docker 专用配置
- 云平台特定工具
- 硬件相关调优
- 大型框架配置（如 Spark）
- 企业级 CI/CD 流程

### 2. 质量标准

- `confidence >= 0.8`（高置信度）
- `status = "promoted"`（已推广）
- `success_streak >= 5`（连续成功 5 次以上）

### 3. 下载顺序

1. **高使用率**: usage_count 高的优先
2. **高质量**: confidence 高的优先
3. **最新**: 最近更新的优先

---

## 文件结构

```
.home/brain/sync/
├── downloaded.json       # 下载映射表
├── evomap_cache.json     # EvoMap 资产缓存
└── sync_log.txt          # 同步日志
```

### downloaded.json 格式

```json
{
  "version": "1.0.0",
  "last_sync": "2026-02-23T10:00:00Z",
  "mappings": {
    "evomap_bundle_id_1": {
      "local_package_id": "pkg_abc123def456",
      "downloaded_at": "2026-02-23T10:00:00Z",
      "evomap_gene_id": "sha256:...",
      "evomap_capsule_id": "sha256:...",
      "category": "repair",
      "name": "http-timeout-retry"
    }
  },
  "stats": {
    "total_downloaded": 100,
    "by_category": {
      "repair": 60,
      "optimize": 30,
      "innovate": 10
    }
  }
}
```

---

## 脚本详解

### sync_evomap.py

**功能**: 从 EvoMap 下载经验包

**参数**:

```bash
--count <N>         # 下载数量（默认 100）
--category <type>   # 类别筛选（repair/optimize/innovate）
--force             # 强制重新下载
--dry-run           # 模拟运行（不实际下载）
--endpoint <url>    # EvoMap API 端点（默认官方）
```

**流程**:

1. 读取 downloaded.json 获取已下载列表
2. 从 EvoMap 获取推荐经验包列表
3. 按策略筛选和排序
4. 逐个下载并转换格式
5. 发布到本地智库（调用 Brain Worker API）
6. 更新 downloaded.json

### list_downloaded.py

**功能**: 查看已下载的经验包

**参数**:

```bash
--format <format>   # 输出格式（table/json，默认 table）
--category <type>   # 按类别筛选
--sort <field>      # 排序字段（downloaded_at/name）
```

**输出示例**:

```
Downloaded Packages (100 total):

Category | Name                  | Local ID       | Downloaded At
---------|----------------------|----------------|-------------------
repair   | http-timeout-retry   | pkg_abc123def  | 2026-02-23 10:00
repair   | connection-pool-fix  | pkg_def456ghi  | 2026-02-23 10:01
optimize | cache-invalidation   | pkg_ghi789jkl  | 2026-02-23 10:02
```

---

## 格式转换规则

### Gene → Pattern

```python
evomap_gene = {
    "type": "Gene",
    "category": "repair",
    "signals_match": ["TimeoutError"],
    "summary": "Retry with exponential backoff"
}

# 转换为

local_pattern = {
    "type": "Pattern",
    "schema_version": "1.0.0",
    "name": generate_name_from_summary(gene.summary),
    "summary": gene.summary,
    "category": gene.category,
    "signals": gene.signals_match,
    "contexts": gene.reuse_contexts or [],
    "strategy": gene.summary  # 简化处理
}
```

### Capsule → Practice

```python
evomap_capsule = {
    "type": "Capsule",
    "gene": "sha256:...",
    "summary": "Fix API timeout with bounded retry",
    "content": "...",
    "confidence": 0.85,
    "outcome": {"status": "success", "score": 0.85}
}

# 转换为

local_practice = {
    "type": "Practice",
    "schema_version": "1.0.0",
    "name": generate_name_from_summary(capsule.summary),
    "summary": capsule.summary,
    "content": capsule.content,
    "triggers": extract_from_gene(capsule.gene),
    "confidence": capsule.confidence,
    "success_streak": capsule.success_streak or 1,
    "impact": capsule.blast_radius or {"files": 0, "lines": 0},
    "outcome": capsule.outcome,
    "environment": {"platform": "unknown"}
}
```

### EvolutionEvent → Evolution

```python
evomap_event = {
    "type": "EvolutionEvent",
    "intent": "repair",
    "capsule_id": "sha256:...",
    "outcome": {"status": "success", "score": 0.85}
}

# 转换为

local_evolution = {
    "type": "Evolution",
    "schema_version": "1.0.0",
    "intent": event.intent,
    "attempts": [{"approach": "Unknown", "result": "success"}],
    "outcome": {
        "status": event.outcome.status,
        "score": event.outcome.score,
        "final_choice": "From EvoMap",
        "reason": "Imported from EvoMap network"
    },
    "mutations_tried": event.mutations_tried or 1
}
```

---

## 注意事项

### 1. Brain Worker 必须运行

同步前确保 Brain Worker 已启动：

```bash
# 通过前端 Settings 页面查看并启动
```

### 2. 网络连接

- 需要连接到 EvoMap API（https://evomap.ai 或自定义端点）
- 下载大量经验包可能需要较长时间
- 建议使用 `--count 10` 先测试

### 3. 存储空间

- 每个经验包约 5-50 KB
- 100 个经验包约 5 MB
- 确保 `.home/brain/` 目录有足够空间

### 4. 重复检测

- 基于 EvoMap 的 gene_id + capsule_id 检测重复
- 相同的 Bundle 不会重复下载
- 使用 `--force` 可以覆盖此行为

---

## 最佳实践

### 1. 首次初始化

```bash
# 下载 100 个通用经验包
python skills/brain-sync/scripts/sync_evomap.py --count 100

# 验证下载结果
python skills/brain-sync/scripts/list_downloaded.py
```

### 2. 定期更新

```bash
# 每周更新一次（下载新的 50 个）
python skills/brain-sync/scripts/sync_evomap.py --count 50
```

### 3. 针对性下载

```bash
# 遇到特定问题时，下载相关类别
python skills/brain-sync/scripts/sync_evomap.py \
  --category repair \
  --count 20
```

---

## 故障排除

### 问题 1: 下载失败

```
Error: Failed to connect to EvoMap API
```

**解决方法**:

- 检查网络连接
- 检查 EvoMap API 端点是否正确
- 使用 `--dry-run` 测试

### 问题 2: 转换失败

```
Error: Failed to convert EvoMap Bundle
```

**解决方法**:

- 检查 EvoMap 数据格式是否变更
- 查看 `sync_log.txt` 获取详细错误
- 跳过失败的包，继续下载其他

### 问题 3: 重复下载

```
Warning: Package already exists
```

**解决方法**:

- 正常情况，已下载的包会自动跳过
- 如需重新下载，使用 `--force`

---

## 示例：完整工作流

```bash
# 1. 初始化智库
python skills/brain-sync/scripts/sync_evomap.py --count 100

# 输出：
# ✓ Downloaded 100 packages from EvoMap
# ✓ Successfully published 98 packages to Brain
# ✗ Failed to publish 2 packages (see sync_log.txt)

# 2. 查看下载结果
python skills/brain-sync/scripts/list_downloaded.py

# 3. 验证智库内容
python skills/brain/scripts/search.py --category repair --limit 20

# 4. Agent 使用
# "我遇到 TimeoutError，有解决方案吗？"
# → Agent 自动搜索本地智库
# → 找到从 EvoMap 下载的 http-timeout-retry 方案
# → 应用解决方案
```

---

**技能版本**: v1.0.0  
**最后更新**: 2026-02-23  
**依赖**: Brain Worker, Internet Connection
