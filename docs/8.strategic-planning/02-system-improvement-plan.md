# 系统改进方案：可观测性与智能管理

## 核心问题

1. **长期记忆功能存在但使用率低**
2. **对话压缩功能未启用**
3. **缺乏可视化监控**
4. **无法量化系统运行效果**

---

## 问题 1：长期记忆使用率低

### 根因分析

✅ **功能已实现**：

- Memory 工具已注册（`src/main/ai/tools/builtin/memory.ts`）
- Execution Protocol 中有提示使用
- 证券交易处理专家的 tools 列表包含 `memory`

❌ **未充分使用的原因**：

1. **Agent Instructions 中缺少明确指导**
   - 现有 instructions 未提示何时/如何使用 memory
   - 只在通用的 execution-protocol Skill 中提到
2. **缺少使用激励**
   - Agent 不知道记忆能带来什么好处
   - 没有"记忆检索"的主动机制

3. **无可视化反馈**
   - 用户看不到 Agent 记住了什么
   - 无法验证记忆是否有效

### 解决方案

#### 方案 A：增强 Agent Instructions（立即可做）

在每个 Agent 的 instructions 末尾添加：

````markdown
## 记忆管理策略

**使用 memory 工具主动管理长期知识：**

1. **任务开始时**：
   - 调用 `memory(action='list')` 查看已有记忆
   - 调用 `memory(action='search', query='相关关键字')` 检索历史经验

2. **任务过程中**：
   - 发现用户偏好 → `memory(write, file='memory/preferences.md', append=true)`
   - 遇到问题并解决 → `memory(write, file='memory/lessons.md', append=true)`
   - 重要项目信息 → `memory(write, file='MEMORY.md', append=true)`

3. **任务结束时**：
   - 总结本次任务的关键信息
   - 写入 MEMORY.md（下次任务可以回顾）

**记忆格式建议（Markdown）**：

```markdown
# 用户偏好

- 编码风格：使用 TypeScript strict 模式
- 命名习惯：camelCase

# 经验教训

- 2026-02-23：处理 CSV 时需要检查编码（可能是 GBK）
- 2026-02-22：Excel 文件需要使用 read(binary=true)

# 项目信息

- 项目名：证券交易系统
- 主要文件：data/transactions.csv
- 数据格式：日期,股票代码,价格,数量
```
````

```

#### 方案 B：创建 Memory 面板（2-3 小时）

**位置**：任务详情页（ThreadView）→ 右侧新增"记忆"标签

```

┌───────┬──────────┬──────────┬──────────┐
│ 文件树 │ 工作台 │ 对话 │ 📝 记忆 │
│ │ │ │ │
│ │ │ │ MEMORY.md│
│ │ │ │ ────────│
│ │ │ │ # 用户 │
│ │ │ │ - 姓名...│
│ │ │ │ │
│ │ │ │ [编辑] │

```

**功能**：
- 实时显示 MEMORY.md 内容
- 列出 memory/ 目录下的文件
- 支持手动编辑和搜索
- 显示最近更新时间

#### 方案 C：Memory 使用提示（1 小时）

在对话界面，当 Agent 写入记忆时，显示 Toast 通知：

```

💾 已保存到记忆
Agent 记录了用户偏好到 preferences.md
[查看详情]

````

---

## 问题 2：对话压缩未启用

### 根因分析

✅ **功能已完整实现**：
- SessionCompressor 类（完整的压缩逻辑）
- 集成到 OpenAIAgentRuntime
- 支持增量总结、token 估算、压缩比统计

❌ **未启用的原因**：
- Agent 配置中缺少 `runtime.compression` 字段
- 默认 `enabled: false`

### 解决方案

#### 方案 A：全局启用压缩（立即可做）

**方法 1：修改默认配置**

在 `coobee.json5` 中添加全局默认值：

```json5
{
  agents: {
    defaults: {
      runtime: {
        compression: {
          enabled: true,
          debug: true,
          contextWindowSize: 128000,
          thresholdRatio: 0.7,
          keepRatio: 0.3,
          minMessageCount: 10
        }
      }
    }
  }
}
````

**方法 2：为每个 Agent 添加配置**

```bash
# 批量更新所有 Agent
for agent in .home/agents/*.json; do
  # 使用 jq 添加 runtime.compression 配置
  jq '.runtime.compression = {enabled: true, debug: true}' "$agent" > tmp && mv tmp "$agent"
done
```

#### 方案 B：压缩监控面板（2-3 小时）

**位置**：ThreadView 顶部或状态栏

```
┌─────────────────────────────────────────┐
│ 📊 对话状态                              │
│                                         │
│ Token 使用: ████████░░ 45K / 89K (51%) │
│                                         │
│ 压缩历史:                                │
│ • 10:30 压缩 17 条 → 8.5K (13% 压缩比)  │
│ • 09:15 压缩 12 条 → 6.2K (11% 压缩比)  │
│                                         │
│ [查看总结] [强制压缩]                    │
└─────────────────────────────────────────┘
```

#### 方案 C：压缩报告生成（1 小时）

每次压缩后自动生成报告：

**文件位置**：`{workspace}/compression-reports/2026-02-23T10-30-00.md`

**内容格式**：

```markdown
# 对话压缩报告

**时间**：2026-02-23 10:30:00
**Session ID**：284357389073063936

## 压缩统计

- 压缩消息数：17 条
- 保留消息数：8 条
- 原始 Tokens：45,000
- 压缩后 Tokens：5,850
- 压缩比：13.0%
- 节省 Tokens：39,150
- 耗时：3.2 秒

## 对话总结

### 用户信息

- 姓名：张三
- 职业：软件工程师
- 工作地点：上海

### 任务内容

用户要求分析证券交易数据...

### 关键决策

- 采用 CSV 格式存储
- 使用 Python pandas 处理
  ...
```

---

## 问题 3：系统可观测性不足

### 当前缺失的可观测性指标

1. **Token 使用统计**
   - 每轮对话的 token 消耗
   - 累计 token 使用
   - 配额剩余估算

2. **工具调用追踪**
   - 哪些工具被调用了？
   - 每个工具的成功率？
   - 耗时分布？

3. **Memory 使用追踪**
   - 记忆文件的增长趋势
   - 搜索命中率
   - 记忆检索频率

4. **压缩效果监控**
   - 压缩触发频率
   - 平均压缩比
   - Token 节省量

### 解决方案：可观测性仪表盘

#### 设计 1：任务详情页 - 统计标签

```
┌─────────────────────────────────────────┐
│ 任务详情 | 统计 | 工具 | 记忆             │
│                                         │
│ 📊 本次任务统计                          │
│                                         │
│ Token 使用:                              │
│ ├─ 用户输入:     2,500                  │
│ ├─ Agent 输出:   15,800                 │
│ ├─ 工具调用:     1,200                  │
│ └─ 总计:         19,500                 │
│                                         │
│ 压缩效果:                                │
│ ├─ 触发次数:     2 次                   │
│ ├─ 节省 Tokens:  82,000                 │
│ └─ 平均压缩比:   12.5%                  │
│                                         │
│ 工具调用 (Top 5):                        │
│ ├─ read:         12 次 (100% 成功)      │
│ ├─ write:        8 次 (100% 成功)       │
│ ├─ exec:         5 次 (100% 成功)       │
│ ├─ memory:       3 次 (100% 成功)       │
│ └─ search:       2 次 (100% 成功)       │
│                                         │
│ 记忆管理:                                │
│ ├─ 文件数:       3 个                   │
│ ├─ 总大小:       5.2 KB                 │
│ └─ 最近更新:     2分钟前                │
│                                         │
│ [导出统计报告] [清空统计]                │
└─────────────────────────────────────────┘
```

#### 设计 2：全局仪表盘页面

在侧边栏添加"📊 监控"菜单项：

```
┌─────────────────────────────────────────┐
│ 系统监控面板                             │
│                                         │
│ 本周统计 (2/17 - 2/23)                  │
│                                         │
│ Token 使用趋势:                          │
│ │                                       │
│ │     ▄▆█▆▅▄▃                          │
│ │ 周一 周二 周三 周四 周五 周六 周日      │
│ │ 12K 15K 18K 16K 14K 11K 8K          │
│                                         │
│ 任务分布:                                │
│ ├─ 对话任务:   35 个 (70K tokens)       │
│ ├─ 定时任务:   12 个 (25K tokens)       │
│ └─ 自动化:      8 个 (15K tokens)       │
│                                         │
│ 压缩效果:                                │
│ ├─ 触发 18 次                           │
│ ├─ 节省 1.2M tokens                     │
│ └─ 平均压缩比: 11.8%                    │
│                                         │
│ [查看详细] [导出报告]                    │
└─────────────────────────────────────────┘
```

---

## 立即行动方案

### 第一步：启用压缩功能（5 分钟）

创建一个 Agent 配置补丁工具：

```typescript
// scripts/enable-compression.ts
import fs from 'fs';
import path from 'path';

const AGENTS_DIR = '.home/agents';

const compressionConfig = {
  enabled: true,
  debug: true,
  minMessageCount: 10,
  thresholdRatio: 0.7
};

// 遍历所有 Agent 配置
const files = fs.readdirSync(AGENTS_DIR);
for (const file of files) {
  if (!file.endsWith('.json')) continue;

  const filePath = path.join(AGENTS_DIR, file);
  const agent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // 添加 compression 配置
  if (!agent.runtime) agent.runtime = {};
  agent.runtime.compression = compressionConfig;

  fs.writeFileSync(filePath, JSON.stringify(agent, null, 2));
  console.log(`✓ Updated: ${file}`);
}
```

### 第二步：增强 Memory 提示（10 分钟）

修改 `AgentEnvInjector.ts`，在注入环境时强调 memory：

```typescript
**重要提示**：

1. **主动使用 memory 工具**：
   - 任务开始时检索历史记忆
   - 发现用户偏好时立即记录
   - 任务结束时保存经验教训

2. **记忆的价值**：
   - 避免重复询问用户
   - 保持跨会话的上下文连续性
   - 积累可复用的知识和经验
```

### 第三步：创建压缩事件记录器（2 小时）

```typescript
// src/main/ai/runtime/openai/CompressionLogger.ts

export class CompressionLogger {
  private logPath: string;

  constructor(workspaceRoot: string) {
    this.logPath = path.join(workspaceRoot, 'compression-history.jsonl');
  }

  async log(event: CompressionEvent): Promise<void> {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event
    });

    await fs.promises.appendFile(this.logPath, line + '\n');
  }

  async getHistory(): Promise<CompressionEvent[]> {
    // 读取并解析历史记录
  }

  async generateReport(): Promise<string> {
    // 生成 Markdown 报告
  }
}
```

### 第四步：UI 展示（3-4 小时）

#### 4.1 在状态栏显示实时 Token 使用

```vue
<!-- StatusBar.vue -->
<div class="status-item">
  <span class="i-carbon-data-1 status-icon" />
  <span class="status-label">Token</span>
  <span class="status-value">45K / 89K</span>
</div>
```

#### 4.2 在任务界面显示压缩历史

```vue
<!-- ThreadView.vue 顶部 -->
<div v-if="compressionHistory.length > 0" class="compression-banner">
  <span class="i-carbon-compress inline-block h-4 w-4" />
  <span>已压缩 {{ compressionHistory.length }} 次，节省 {{ totalSaved }}K tokens</span>
  <button @click="showCompressionDetails">查看详情</button>
</div>
```

---

## 测试验证流程

### 测试 1：Memory 功能（预计 10 分钟）

```bash
# 1. 运行测试脚本
bash scripts/test-memory-and-compression.sh

# 2. 启动应用，创建新任务

# 3. 测试对话
用户：请记住我的信息：姓名王五，职业数据分析师

# 4. 检查文件
ls -la {workspace}/MEMORY.md
cat {workspace}/MEMORY.md

# 5. 验证检索
用户：我的职业是什么？
期望：Agent 正确回答"数据分析师"

# 6. 查看日志
grep "\[memory\]" .home/logs/*.log
```

### 测试 2：压缩功能（预计 15 分钟）

```bash
# 1. 启用压缩（运行 enable-compression.ts）
tsx scripts/enable-compression.ts

# 2. 重启应用

# 3. 创建长对话（20+ 轮）
用户：介绍一下你自己
用户：你能做什么？
用户：帮我分析这个数据文件 {上传文件}
（继续对话...）

# 4. 监控日志
tail -f .home/logs/*.log | grep Compressor

# 期望输出：
[SessionCompressor] Token 检查: 65000 / 89600 (72.5%)
[SessionCompressor] 分段: 未压缩 25 条，总结 17 条，保留 8 条
[SessionCompressor] 压缩完成: tokens: 65000 → 8500, 压缩比: 13.1%

# 5. 查看 Session 文件
grep '"type":"summary"' {session-file}.jsonl
```

---

## 优先级建议

### 高优先级（本周完成）

1. ✅ 启用压缩功能（5 分钟）
2. ✅ 创建压缩事件记录器（2 小时）
3. ✅ 增强 Memory 使用提示（10 分钟）
4. ✅ 状态栏显示 Token 使用（1 小时）

### 中优先级（下周完成）

1. ⏸ Memory 面板（3 小时）
2. ⏸ 压缩监控面板（3 小时）
3. ⏸ 工具调用统计（2 小时）

### 低优先级（未来迭代）

1. ⏸ 全局监控仪表盘
2. ⏸ 自动化报告生成
3. ⏸ 成本优化建议

---

## 总结

**好消息**：

- ✅ Memory 和 Compression 功能都已完整实现
- ✅ 代码质量高，设计合理
- ✅ 只需要配置和 UI 展示

**改进方向**：

1. **配置层面**：启用压缩，强化 memory 提示
2. **可视化层面**：让用户看到这些功能在工作
3. **激励层面**：让 Agent 知道使用这些功能的好处

**明天讨论重点**：

1. 是否立即启用压缩？
2. UI 展示的优先级？
3. 测试方案是否合适？
