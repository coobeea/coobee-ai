# 系统可观测性与功能验证报告

## 一、长期记忆（Memory）功能分析

### ✅ 功能状态：已实现且可用

#### 1. 工具注册情况

- **位置**：`src/main/ai/tools/builtin/memory.ts`
- **功能**：完整的记忆管理系统
- **存储路径**：
  - Agent 级：`{workspace}/MEMORY.md` + `{workspace}/memory/*.md`
  - User 级：`{userHome}/memory/MEMORY.md` + `{userHome}/memory/*.md`

#### 2. 支持的操作

```typescript
{
  list: "列出记忆文件",
  get: "读取记忆文件",
  write: "写入/更新记忆文件（支持追加）",
  search: "多关键字搜索记忆"
}
```

#### 3. 核心特性

- ✅ 文件持久化（Markdown 格式）
- ✅ 索引系统（快速检索）
- ✅ 增量写入（append 模式）
- ✅ 多关键字搜索（评分排序）
- ✅ Section 感知（识别 Markdown 章节）

#### 4. 验证方法

**方法 1：通过对话测试**

```
用户：请用 memory 工具记录以下信息：我叫张三，职业是软件工程师
Agent：会调用 memory 工具 write MEMORY.md
```

**方法 2：检查文件系统**

```bash
# Agent 级记忆
ls -la {workspace}/MEMORY.md
ls -la {workspace}/memory/

# User 级记忆
ls -la ~/.coobee-ai/memory/MEMORY.md
```

**方法 3：查看日志**

```bash
# 日志文件
tail -f {logPath}/coobee-ai.log | grep memory
```

---

## 二、对话压缩（Compression）功能分析

### ✅ 功能状态：已实现且功能完整

#### 1. 实现位置

- **核心类**：`SessionCompressor`（`src/main/ai/runtime/openai/SessionCompressor.ts`）
- **集成点**：`OpenAIAgentRuntime.compressSessionWithChunks()`

#### 2. 压缩策略

```typescript
{
  contextWindowSize: 128000,     // 上下文窗口大小
  thresholdRatio: 0.7,           // 触发阈值（70%）
  keepRatio: 0.3,                // 保留比例（30% 最近消息）
  minMessageCount: 10,           // 最小消息数
  summaryModel: "",              // 总结模型（默认用当前模型）
  debug: false                   // 调试日志开关
}
```

#### 3. 压缩流程

```
1. 检查未压缩消息的 token 数
   ↓
2. 超过阈值（contextWindowSize * 0.7）时触发
   ↓
3. 分段：前 70% 待总结，后 30% 保留
   ↓
4. 调用 LLM 生成结构化总结
   ↓
5. 追加 summary 到 Session 文件（不删除原始消息）
   ↓
6. 记录压缩统计（tokens、ratio、duration）
```

#### 4. 总结格式

```markdown
## 用户信息

- 姓名：XXX
- 年龄：XXX
- 职业：XXX

## 项目信息

- 项目名：XXX
- 技术栈：XXX

## 对话要点

- 要点 1
- 要点 2

## 用户偏好与决策

- 偏好 1

## 待办/下一步

- 事项 1
```

#### 5. 当前问题：未启用

**检查配置**：

```bash
# 查看 Agent 配置
cat .home/agents/{agent-id}.json

# 应该包含 compression 配置
{
  "runtime": {
    "compression": {
      "enabled": true,
      "debug": true
    }
  }
}
```

**❌ 当前状态：大部分 Agent 未配置 compression**

---

## 三、可观测性增强方案

### 方案 1：压缩事件日志系统

#### 实现目标

1. ✅ 可视化压缩触发时机
2. ✅ 记录压缩前后的 token 对比
3. ✅ 显示压缩比和耗时
4. ✅ 保存压缩报告供分析

#### 数据记录格式

```json
{
  "timestamp": "2026-02-23T10:30:00Z",
  "sessionId": "284357389073063936",
  "agentId": "证券交易处理器",
  "compression": {
    "triggered": true,
    "beforeTokens": 89600,
    "afterTokens": 12800,
    "compressionRatio": 0.143,
    "savedTokens": 76800,
    "duration": 3500,
    "messagesCompressed": 45,
    "messagesKept": 15
  },
  "summaryPreview": "## 用户信息\n- 姓名：张三..."
}
```

### 方案 2：Memory 使用追踪

#### 记录内容

- Memory 工具调用次数
- 写入的记忆文件列表
- 搜索查询及结果数
- 文件大小变化

#### UI 展示

```
任务详情 → Memory 标签：
┌─────────────────────────────────────────┐
│ 📝 记忆使用情况                          │
│                                         │
│ 写入文件：                               │
│ • MEMORY.md (2.3KB, 更新 3 次)          │
│ • memory/lessons.md (1.5KB, 创建)       │
│                                         │
│ 搜索查询：                               │
│ • "数据处理流程" → 5 个结果              │
│ • "用户偏好" → 2 个结果                  │
│                                         │
│ [查看完整记忆] [导出记忆]                │
└─────────────────────────────────────────┘
```

### 方案 3：实时压缩监控面板

#### 位置

状态栏或任务详情页

#### 展示内容

```
压缩状态：
┌─────────────────────────────────────────┐
│ 📊 Token 使用: 45K / 89K (51%)          │
│ ⚠️  距离压缩还有 44K tokens              │
│                                         │
│ 压缩历史:                                │
│ • 10:30 - 压缩 45 条消息 (86% 压缩率)    │
│ • 09:15 - 压缩 38 条消息 (88% 压缩率)    │
│                                         │
│ [查看总结] [强制压缩]                    │
└─────────────────────────────────────────┘
```

---

## 四、测试验证方案

### 测试 1：长期记忆功能验证

#### 准备工作

1. 启动一个新任务
2. 确保 Agent 有 memory 工具权限

#### 测试步骤

```
Step 1：写入记忆
用户：请记住我的信息：姓名李四，职业产品经理，工作地点上海

期望：Agent 调用 memory write MEMORY.md

Step 2：读取记忆
用户：我的职业是什么？

期望：Agent 调用 memory get MEMORY.md，正确回答"产品经理"

Step 3：搜索记忆
用户：搜索一下记忆中关于"上海"的内容

期望：Agent 调用 memory search，返回相关片段

Step 4：追加记忆
用户：补充一下，我的技能栈是 Python 和 React

期望：Agent 调用 memory write（append=true）
```

#### 验证方法

```bash
# 查看记忆文件
cat {workspace}/MEMORY.md

# 应该包含：
---
updated: 2026-02-23T10:30:00.000Z
---

## 用户信息
- 姓名：李四
- 职业：产品经理
- 工作地点：上海
- 技能栈：Python、React
```

### 测试 2：对话压缩功能验证

#### 准备工作

1. 修改 Agent 配置，启用压缩并打开 debug

```json
{
  "runtime": {
    "compression": {
      "enabled": true,
      "debug": true,
      "minMessageCount": 5,
      "thresholdRatio": 0.6
    }
  }
}
```

2. 重启应用

#### 测试步骤

```
Step 1：生成足够多的对话
用户：请介绍一下你自己
用户：你能做什么？
用户：帮我分析这个文件 {上传文件}
用户：继续分析...
（持续对话，生成 20+ 条消息）

Step 2：观察日志
tail -f {logPath}/coobee-ai.log | grep Compressor

期望输出：
[SessionCompressor] Token 检查: 65000 / 76800 (84.6%)
[SessionCompressor] 分段: 未压缩 25 条，总结 17 条，保留 8 条
[SessionCompressor] 压缩完成: 17 条已总结, 8 条保留, tokens: 65000 → 8500, 压缩比: 13.1%, 耗时: 3200ms

Step 3：查看 Session 文件
cat .home/workspaces/{workspaceId}/sessions/{sessionId}/{timestamp}.jsonl

期望：文件末尾有 summary 条目
{"type":"summary","meta":{"summaryText":"## 用户信息\n...",""endSeq":17,...}}
```

### 测试 3：压缩效果对比

#### 创建测试脚本

```bash
#!/bin/bash
# test-compression.sh

SESSION_FILE=".home/workspaces/{id}/sessions/{id}/{file}.jsonl"

echo "=== 压缩前 ==="
wc -l $SESSION_FILE
grep '"type":"message"' $SESSION_FILE | wc -l
echo ""

echo "=== 触发压缩（发送大量消息）==="
# 通过 API 发送 30 条消息
for i in {1..30}; do
  echo "发送消息 $i..."
  # curl 调用 /gateway/chat 接口
done

sleep 5

echo "=== 压缩后 ==="
wc -l $SESSION_FILE
grep '"type":"summary"' $SESSION_FILE | wc -l
echo ""

echo "=== 提取总结 ==="
grep '"type":"summary"' $SESSION_FILE | tail -1 | jq '.meta.summaryText'
```

---

## 五、立即可做的改进

### 1. 启用压缩功能（5分钟）

```bash
# 编辑默认配置
vim .home/config/coobee.json5

# 添加 runtime.compression 配置
runtime: {
  compression: {
    enabled: true,
    debug: true,
    minMessageCount: 10
  }
}
```

### 2. 添加压缩监控面板（2-3小时）

- 在 ThreadView 右侧添加"压缩状态"面板
- 显示当前 token 使用情况
- 显示压缩历史记录

### 3. 添加 Memory 使用统计（1-2小时）

- 在任务详情显示 memory 工具调用记录
- 列出已创建的记忆文件
- 提供"查看记忆"快捷入口

### 4. 创建压缩报告（1小时）

- 每次压缩后生成 Markdown 报告
- 保存到 `{workspace}/compression-reports/`
- 包含：时间、压缩比、总结摘要

---

## 六、明天讨论重点

1. **Memory 工具未被充分使用的原因**
   - Agent 指令中是否提示使用 memory？
   - Skill 中是否有记忆管理相关指导？

2. **压缩功能的可见性**
   - 需要 UI 展示压缩状态吗？
   - 要不要提供"查看总结"功能？

3. **测试方案**
   - 我准备了详细的测试步骤
   - 是否需要自动化测试脚本？

---

## 附录：快速检查清单

### 长期记忆

- [ ] 检查 memory 工具是否注册：`grep memory src/main/ai/tools/builtin/index.ts`
- [ ] 检查记忆目录：`ls -la .home/memory/`
- [ ] 查看日志：`grep "\[memory\]" {logPath}/coobee-ai.log`

### 对话压缩

- [ ] 检查配置：`grep compression .home/agents/*.json`
- [ ] 查看日志：`grep Compressor {logPath}/coobee-ai.log`
- [ ] 检查 Session 文件：`grep summary .home/workspaces/*/sessions/*/*.jsonl`

### 系统可观测性

- [ ] 日志级别：`grep LOG_LEVEL .home/config/coobee.json5`
- [ ] Token 统计：是否记录每轮请求的 token 使用？
- [ ] 性能监控：响应时间、工具调用耗时是否有记录？
