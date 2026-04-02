# 工作空间命名标准

## 问题背景

之前的工作空间命名混乱，存在多种非标准格式：

### 问题示例

```
❌ creation-creation-20260327-e1e397-req    # 重复前缀
❌ cron-KUDAgJCOfKUVezBUTWssl-1772919000066  # 过长、包含 job ID
❌ cron-declarative:knowledge-archive-...   # 使用了冒号
❌ insight-analysis-1774541295049           # 直接用时间戳
```

## 根本原因

多个模块使用了自定义的 sessionId 生成逻辑：

### 1. Creation Pipeline

```typescript
// src/main/creation/CreationStore.ts (旧代码)
function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `creation-${date}-${rand}`;  // ❌ 自定义格式
}

// src/main/creation/CreationPipeline.ts (旧代码)
sessionId: `creation-${sessionId}-req`,  // ❌ 重复拼接
```

**问题**：

- 生成 `creation-20260327-e1e397`
- 然后又拼接成 `creation-creation-20260327-e1e397-req`

### 2. Cron Job Executor

```typescript
// src/main/ai/cron/CronJobExecutor.ts (旧代码)
const sessionId = `cron-${job.id}-${Date.now()}`; // ❌ 拼接 job.id
```

**问题**：

- 当 `job.id` 很长时（如 `KUDAgJCOfKUVezBUTWssl`）
- 生成超长ID：`cron-KUDAgJCOfKUVezBUTWssl-1772919000066`

### 3. Insight Analyzer

```typescript
// src/main/insight/InsightAnalyzer.ts (旧代码)
sessionId: `insight-analysis-${Date.now()}`,  // ❌ 直接用时间戳
```

**问题**：

- 无唯一性保证（同一毫秒内可能重复）
- 格式不统一

## 解决方案

### 统一使用 Snowflake ID

系统已有 `SnowflakeIdGenerator`，保证全局唯一性：

```typescript
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const sessionId = generateSnowflakeId(); // ✅ 标准格式
```

### Snowflake ID 特点

- **全局唯一**：64位分布式ID生成器
- **有序**：按时间单调递增，可排序
- **高性能**：本地生成，无需网络通信
- **固定长度**：18-19位数字字符串

示例：`297980619897774080`

### 修复后的代码

#### Creation Store

```typescript
// src/main/creation/CreationStore.ts (新代码)
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

function generateSessionId(): string {
  return generateSnowflakeId(); // ✅ 统一标准
}
```

#### Creation Pipeline

```typescript
// src/main/creation/CreationPipeline.ts (新代码)
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

// 子 Agent 使用独立 Snowflake ID
const result = await runtime.executeAgent({
  agentId,
  sessionId: generateSnowflakeId(), // ✅ 不再拼接
  message: agentMessage,
  context: { channel: 'creation', sessionId, phase: 'requirements' }
});
```

#### Cron Job Executor

```typescript
// src/main/ai/cron/CronJobExecutor.ts (新代码)
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const sessionId = generateSnowflakeId(); // ✅ 统一标准
```

#### Insight Analyzer

```typescript
// src/main/insight/InsightAnalyzer.ts (新代码)
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const result = await this.runtime.executeAgent({
  agentId: 'insight-analyst',
  sessionId: generateSnowflakeId(), // ✅ 统一标准
  message: prompt
  // ...
});
```

## 命名规范

### ✅ 推荐做法

**主 Thread/Session**：直接使用 Snowflake ID

```typescript
const threadId = generateSnowflakeId();
// 结果: 297980619897774080
```

**嵌套 Worker/Sub-Agent**：使用独立 Snowflake ID

```typescript
// 正确：每个 Worker 独立 ID
const workerSessionId = generateSnowflakeId();

// 正确：使用冒号分隔父子关系（仅用于逻辑关联）
const workerSessionId = `${parentSessionId}:worker:${subTask.id}`;
```

### ❌ 避免做法

**不要拼接类型前缀**

```typescript
// ❌ 错误
sessionId: `creation-${Date.now()}`;
sessionId: `cron-${job.id}-${Date.now()}`;
sessionId: `insight-analysis-${Date.now()}`;
```

**不要重复拼接**

```typescript
// ❌ 错误：导致 creation-creation-...
sessionId: `creation-${sessionId}-req`;
```

**不要使用冒号作为分隔符（除非表示父子关系）**

```typescript
// ❌ 错误：用冒号分隔无关信息
sessionId: `cron-declarative:knowledge-archive-${Date.now()}`;

// ✅ 正确：表示父子关系
sessionId: `${parentSessionId}:planner`;
```

## 工作空间目录示例

### 修复前

```
.home/workspaces/
├── creation-creation-20260327-e1e397-req/     ❌ 重复
├── creation-creation-20260330-a2p3dr-req/     ❌ 重复
├── cron-declarative:knowledge-archive-1773165600043/  ❌ 冒号
├── cron-KUDAgJCOfKUVezBUTWssl-1772919000066/  ❌ 过长
├── insight-analysis-1774541295049/            ❌ 时间戳
└── ...
```

### 修复后

```
.home/workspaces/
├── 297980619897774080/     ✅ 标准 Snowflake ID
├── 297980619897774081/     ✅ 标准 Snowflake ID
├── 297980619897774082/     ✅ 标准 Snowflake ID
├── 297980619897774083/     ✅ 标准 Snowflake ID
└── ...
```

## 影响范围

### 已修复的模块

- ✅ **Creation Pipeline** (创建流程)
- ✅ **Cron Job Executor** (定时任务)
- ✅ **Insight Analyzer** (洞察分析)

### 未修复但符合标准的模块

- ✅ **ThreadStore** (已使用 Snowflake ID)
- ✅ **Orchestrator** (嵌套 Worker 使用 `${parentId}:worker:${subTaskId}` 格式，符合标准)
- ✅ **Quality Loop** (测试代码，可忽略)

## 测试验证

### 1. 检查新创建的工作空间

```bash
ls -lt .home/workspaces/ | head -5
```

应该看到：

```
297980619897774085
297980619897774084
297980619897774083
```

### 2. 确认无非标准命名

```bash
ls .home/workspaces/ | grep -E "(creation-creation|:|\-\-)"
```

应该**无输出**（表示没有匹配到异常命名）

### 3. 验证 Snowflake ID 格式

```typescript
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const id = generateSnowflakeId();
console.log(id); // 297980619897774080（18-19位数字）
```

## 迁移指南

如果需要在其他模块中生成 sessionId：

### 步骤1：导入生成器

```typescript
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
```

### 步骤2：生成 ID

```typescript
// ❌ 旧方式
const sessionId = `module-${Date.now()}`;

// ✅ 新方式
const sessionId = generateSnowflakeId();
```

### 步骤3：嵌套关系（可选）

如果需要表示父子关系：

```typescript
const sessionId = `${parentSessionId}:${type}:${subId}`;
// 例如: 297980619897774080:worker:subtask-1
```

## 相关文件

- `src/main/utils/SnowflakeIdGenerator.ts` - Snowflake ID 生成器
- `src/main/creation/CreationStore.ts` - 创建流程 sessionId 生成
- `src/main/creation/CreationPipeline.ts` - 创建流程 Agent 调用
- `src/main/ai/cron/CronJobExecutor.ts` - 定时任务执行
- `src/main/insight/InsightAnalyzer.ts` - 洞察分析
- `src/main/ai/threads/ThreadStore.ts` - Thread 管理（参考实现）

## 参考

- [Snowflake ID 算法](https://github.com/twitter-archive/snowflake)
- [Thread 管理架构](./thread-management.md)
- [工作空间结构](../features/workspace-structure.md)
