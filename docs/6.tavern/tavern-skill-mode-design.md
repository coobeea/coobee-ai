# 酒馆系统改造方案：从 Poller 模式到 Skill 主动模式

## 1. 当前架构问题

### 现状

```
tavern-poller (Python Worker, 端口 9010)
    ↓ 轮询扫描 tasks.jsonl（每 5 秒）
    ↓ 发现 pending 任务
    ↓ 推送事件到主进程 /internal/tavern/events
    ↓
EventBus
    ↓
Agent 被动接收通知
```

### 问题

1. **复杂性**：需要 poller + EventBus + 事件转发
2. **被动性**：Agent 只能等待推送，无法主动决策
3. **不一致**：与 Brain Worker 的 Skill 主动模式不一致
4. **依赖性**：必须保持 poller 运行，否则任务不可见

---

## 2. 目标架构（对齐 Brain 模式）

### 新架构

```
Tavern Worker (Python Flask/FastAPI, 端口 9010)
    ↕ 提供 HTTP API
    ↕
Agent 通过 Skill 主动调用
    ↕ 查询任务：GET /api/tavern/tasks?status=pending
    ↕ 接取任务：POST /api/tavern/tasks/{id}/accept
    ↕ 提交结果：POST /api/tavern/tasks/{id}/result
```

### 优势

1. **简化**：去掉 poller 轮询机制和事件推送
2. **主动**：Agent 决定何时查看酒馆、接什么任务
3. **一致**：与 Brain Worker 保持相同的 Skill + HTTP API 模式
4. **灵活**：Agent 可以在空闲时主动接任务，或者按需查询

---

## 3. 改造方案

### 3.1 Tavern Worker 升级

**现有**：`workers/tavern-poller/server.py`（轮询 + 推送）

**改造为**：`workers/tavern/server.py`（完整 HTTP API 服务）

**API 设计**：

| 端点                            | 方法   | 用途                             | 调用方          |
| ------------------------------- | ------ | -------------------------------- | --------------- |
| `/health`                       | GET    | 健康检查                         | WorkerManager   |
| `/api/tavern/tasks`             | GET    | 查询任务列表（支持 status 筛选） | Agent + Gateway |
| `/api/tavern/tasks/{id}`        | GET    | 获取任务详情                     | Agent + Gateway |
| `/api/tavern/tasks`             | POST   | 发布新任务                       | Gateway（前端） |
| `/api/tavern/tasks/{id}/accept` | POST   | 接取任务                         | Agent           |
| `/api/tavern/tasks/{id}/result` | POST   | 提交任务结果                     | Agent           |
| `/api/tavern/tasks/{id}/status` | PATCH  | 更新任务状态                     | Agent + Gateway |
| `/api/tavern/tasks/{id}`        | DELETE | 删除任务                         | Gateway（前端） |
| `/api/tavern/stats`             | GET    | 统计信息                         | Gateway（前端） |

**迁移计划**：

1. 将现有 `src/main/gateway/http/tavern.ts` 的存储逻辑移到 Python Worker
2. 复用 `FileSystemStore` 模式（参考 Brain Worker）
3. 保持相同的数据结构和目录（`.home/tavern/`）

### 3.2 创建 Tavern Skill

**位置**：`skills/tavern/SKILL.md`

**内容**：指导 Agent 如何：

1. **查询任务**：定期或按需查询 pending 任务
2. **分析任务**：判断是否符合自己的能力
3. **接取任务**：调用 accept 接口
4. **执行任务**：创建 Thread 执行
5. **提交结果**：调用 result 接口提交

**示例脚本**：

- `skills/tavern/scripts/query_tasks.py`：查询任务
- `skills/tavern/scripts/accept_task.py`：接取任务
- `skills/tavern/scripts/submit_result.py`：提交结果

### 3.3 Gateway 代理层（可选）

**位置**：`src/main/gateway/methods/tavern.ts`（重构现有）

**改造**：从直接操作文件系统改为代理到 Tavern Worker

```typescript
export const tavernMethods: MethodGroup = {
  namespace: 'tavern',
  methods: {
    // 给前端用的管理接口
    list: async (params) => forwardToTavernWorker('/api/tavern/tasks', { method: 'GET', params }),
    get: async (params) => forwardToTavernWorker(`/api/tavern/tasks/${params.id}`, { method: 'GET' }),
    create: async (params) => forwardToTavernWorker('/api/tavern/tasks', { method: 'POST', body: params }),
    delete: async (params) => forwardToTavernWorker(`/api/tavern/tasks/${params.id}`, { method: 'DELETE' }),
    stats: async () => forwardToTavernWorker('/api/tavern/stats', { method: 'GET' })
  }
};
```

### 3.4 Agent 工作流（Skill 驱动）

**场景 1：定期巡查**

Agent 可以在空闲时主动查看酒馆：

```python
# Agent 执行：每小时查看一次 pending 任务
import subprocess
import json

result = subprocess.run([
    'curl', '-X', 'GET',
    'http://localhost:9010/api/tavern/tasks?status=pending',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

tasks = json.loads(result.stdout)
# 分析任务，决定是否接取
```

**场景 2：按需查询**

用户询问"有什么任务可以做"时，Agent 主动查询：

```python
# Agent 根据用户问题主动查询
tasks = query_tavern_tasks(status='pending', limit=5)
# 向用户展示任务列表
```

**场景 3：接取并执行**

```python
# 1. 接取任务
accept_task(task_id='task_123')

# 2. 执行任务（创建 Thread，完成工作）
# ...

# 3. 提交结果
submit_result(
    task_id='task_123',
    text_result='任务完成，生成了 5 个文件...',
    file_results=['output/report.pdf', 'output/data.csv']
)
```

---

## 4. 迁移步骤

### Step 1: 创建 Tavern Worker

```bash
# 1. 重命名目录
mv workers/tavern-poller workers/tavern

# 2. 重构 server.py
# - 移除轮询逻辑
# - 添加完整 HTTP API（参考 Brain Worker）
# - 复用现有的文件系统存储

# 3. 更新 worker.json
{
  "name": "tavern",
  "label": "酒馆服务",
  "type": "python",
  "entry": "server.py",
  "port": 9010,
  ...
}
```

### Step 2: 重构 Gateway HTTP 路由

```bash
# 将 src/main/gateway/http/tavern.ts 改为代理模式
# - 不直接操作文件系统
# - 转发请求到 Tavern Worker
```

### Step 3: 创建 Tavern Skill

```bash
# 创建 skills/tavern/
skills/tavern/
├── SKILL.md                    # Agent 使用指南
└── scripts/
    ├── query_tasks.py          # 查询任务
    ├── accept_task.py          # 接取任务
    └── submit_result.py        # 提交结果
```

### Step 4: 测试验证

```bash
# 1. 单元测试
python workers/tavern/tests/test_*.py

# 2. 集成测试
curl http://localhost:9010/api/tavern/tasks

# 3. Skill 测试
python skills/tavern/scripts/query_tasks.py
```

---

## 5. 对比分析

### 旧架构（Poller + 事件推送）

```
✅ 实时性好（事件即时推送）
❌ 复杂（poller + EventBus + 事件转发）
❌ Agent 被动（只能等待推送）
❌ 依赖性强（poller 必须运行）
```

### 新架构（Skill + HTTP API）

```
✅ 简单（纯 HTTP API）
✅ Agent 主动（自主决策何时查询）
✅ 一致性（与 Brain Worker 模式相同）
✅ 灵活性（可轮询、可按需、可定时）
⚠️ 实时性略低（需主动查询）
```

**推荐**：新架构更符合系统设计理念，且对于酒馆场景（任务不是秒级高频），主动查询模式完全够用。

---

## 6. 实施优先级

### P0（立即执行）

- [ ] 创建 Tavern Worker HTTP API
- [ ] 创建 Tavern Skill 文档
- [ ] Gateway 路由改为代理模式

### P1（后续优化）

- [ ] 添加任务统计 API（类似 Brain stats）
- [ ] 前端 UI 优化（展示更多信息）
- [ ] Skill 辅助脚本完善

### P2（未来考虑）

- [ ] 混合模式：重要任务推送 + 一般任务查询
- [ ] 任务推荐算法（根据 Agent 能力匹配）
- [ ] 任务优先级队列

---

## 7. 兼容性说明

### 数据兼容

- ✅ 复用现有 `.home/tavern/` 目录结构
- ✅ 保持 `tasks.jsonl` 索引格式
- ✅ 保持任务元数据 `meta.json` 格式
- ✅ 无需迁移历史数据

### 前端兼容

- ✅ 前端调用方式不变（仍是 Gateway API）
- ✅ Gateway 内部从直接操作改为代理转发
- ✅ 用户体验无感知

### 平滑迁移

1. 先创建 Tavern Worker 和 API
2. Gateway 路由逐步切换到代理模式
3. 测试验证后停用 tavern-poller
4. 删除旧的 poller 代码

---

## 8. 总结

将酒馆从 **Poller 被动推送模式** 改造为 **Skill 主动查询模式**，是一次架构简化和统一化的重要升级。

核心变化：

| 维度           | 旧模式                  | 新模式                 |
| -------------- | ----------------------- | ---------------------- |
| **Worker**     | tavern-poller（轮询器） | tavern（完整服务）     |
| **Agent 交互** | 被动接收事件            | 主动 HTTP 查询         |
| **协议**       | EventBus 事件           | HTTP API（纯标准协议） |
| **文档**       | 无                      | Skill 文档 + 示例脚本  |
| **架构对齐**   | 独特设计                | 与 Brain 一致          |

**建议**：立即实施，预计 1-2 天完成。
