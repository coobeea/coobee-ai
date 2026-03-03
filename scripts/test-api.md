# Coobee AI API 可用性测试指南

## 📋 API 端点概览

本项目的 HTTP API 服务器运行在 `http://localhost:8765`，所有网关 API 路径前缀为 `/gateway`。

### 完整 API 列表

| 类别           | 路径                                 | 方法   | 描述                |
| -------------- | ------------------------------------ | ------ | ------------------- |
| **健康检查**   | `/gateway/health`                    | GET    | 服务健康状态        |
| **Agents**     | `/gateway/agents`                    | GET    | 列出所有智能体      |
|                | `/gateway/agents/tools`              | GET    | 获取可用工具列表    |
|                | `/gateway/agents/:id`                | GET    | 获取智能体详情      |
|                | `/gateway/agents`                    | POST   | 创建智能体          |
|                | `/gateway/agents/:id`                | DELETE | 删除智能体          |
|                | `/gateway/agents/:id/skills`         | GET    | 获取智能体技能      |
|                | `/gateway/agents/:id/quick-chat`     | POST   | 快速对话 (SSE)      |
|                | `/gateway/agents/ai-create`          | POST   | AI 创建智能体 (SSE) |
| **Skills**     | `/gateway/skills`                    | GET    | 列出所有技能        |
|                | `/gateway/skills/import`             | POST   | 导入技能            |
|                | `/gateway/skills/ai-create`          | POST   | AI 创建技能 (SSE)   |
|                | `/gateway/skills/:name`              | DELETE | 删除技能            |
| **Threads**    | `/gateway/threads`                   | GET    | 列出所有线程        |
|                | `/gateway/threads`                   | POST   | 创建线程            |
|                | `/gateway/threads/:id`               | GET    | 获取线程详情        |
|                | `/gateway/threads/:id`               | PATCH  | 更新线程            |
|                | `/gateway/threads/:id`               | DELETE | 删除线程            |
|                | `/gateway/threads/:id/history`       | GET    | 获取线程历史        |
| **Files**      | `/gateway/files/tree`                | GET    | 获取目录树          |
|                | `/gateway/files/content`             | GET    | 读取文件内容        |
|                | `/gateway/files/serve`               | GET    | 预览二进制文件      |
|                | `/gateway/files/upload`              | POST   | 上传文件            |
|                | `/gateway/files/copy`                | POST   | 复制文件            |
|                | `/gateway/files/delete`              | POST   | 删除文件            |
| **Cron Jobs**  | `/gateway/cron-jobs`                 | GET    | 列出定时任务        |
|                | `/gateway/cron-jobs/:id`             | GET    | 获取任务详情        |
|                | `/gateway/cron-jobs`                 | POST   | 创建定时任务        |
|                | `/gateway/cron-jobs/:id`             | PATCH  | 更新定时任务        |
|                | `/gateway/cron-jobs/:id`             | DELETE | 删除定时任务        |
|                | `/gateway/cron-jobs/:id/trigger`     | POST   | 手动触发任务        |
|                | `/gateway/cron-jobs/:id/executions`  | GET    | 获取执行历史        |
| **Terminals**  | `/gateway/terminals`                 | GET    | 列出终端            |
|                | `/gateway/terminals`                 | POST   | 创建终端            |
|                | `/gateway/terminals/:id/input`       | POST   | 写入输入            |
|                | `/gateway/terminals/:id/resize`      | POST   | 调整大小            |
|                | `/gateway/terminals/:id`             | DELETE | 销毁终端            |
| **Processes**  | `/gateway/processes`                 | GET    | 列出进程            |
|                | `/gateway/processes/:id/output`      | GET    | 读取输出            |
| **Monitoring** | `/gateway/monitoring/system`         | GET    | 系统健康状态        |
|                | `/gateway/monitoring/tokens`         | GET    | Token 使用统计      |
|                | `/gateway/monitoring/memory`         | GET    | Memory 工具统计     |
|                | `/gateway/monitoring/compression`    | GET    | 压缩记录            |
|                | `/gateway/monitoring/memory-files`   | GET    | 列出记忆文件        |
|                | `/gateway/monitoring/memory-content` | GET    | 读取记忆内容        |
| **Tavern**     | `/gateway/tavern/tasks`              | GET    | 任务列表            |
|                | `/gateway/tavern/tasks/:id`          | GET    | 任务详情            |
|                | `/gateway/tavern/tasks`              | POST   | 发布任务            |
|                | `/gateway/tavern/tasks/:id`          | PATCH  | 更新任务            |
|                | `/gateway/tavern/tasks/:id`          | DELETE | 删除任务            |
|                | `/gateway/tavern/scheduler/status`   | GET    | 调度器状态          |
|                | `/gateway/tavern/scheduler/start`    | POST   | 启动调度器          |
|                | `/gateway/tavern/scheduler/stop`     | POST   | 停止调度器          |
| **Employee**   | `/gateway/employee/list`             | GET    | 员工列表            |
|                | `/gateway/employee/:id`              | GET    | 员工详情            |
|                | `/gateway/employee`                  | POST   | 创建员工            |
|                | `/gateway/employee/:id`              | PATCH  | 更新员工            |
|                | `/gateway/employee/:id`              | DELETE | 删除员工            |

## 🚀 如何启动测试

### 1. 启动应用

```bash
# 安装依赖（如果还没安装）
pnpm install

# 启动开发模式
pnpm dev
```

应用启动后，HTTP 服务器会运行在 `http://localhost:8765`

### 2. 运行 API 测试脚本

在另一个终端窗口运行：

```bash
# 使用 npx 运行测试脚本
npx tsx scripts/test-api.ts
```

或者使用环境变量自定义 Base URL：

```bash
API_BASE_URL=http://127.0.0.1:8765/gateway npx tsx scripts/test-api.ts
```

## 🧪 手动测试示例

### 健康检查

```bash
curl http://localhost:8765/gateway/health
```

期望响应：

```json
{
  "status": "ok",
  "uptime": 123,
  "clients": 0
}
```

### 获取智能体列表

```bash
curl http://localhost:8765/gateway/agents
```

### 获取技能列表

```bash
curl http://localhost:8765/gateway/skills
```

### 创建智能体

```bash
curl -X POST http://localhost:8765/gateway/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-agent-1",
    "name": "测试智能体",
    "description": "用于测试的智能体",
    "instructions": "你是一个用于测试的智能体，请保持简洁回应。"
  }'
```

### 获取系统监控信息

```bash
curl http://localhost:8765/gateway/monitoring/system
```

## 📊 测试结果说明

测试脚本会输出：

- ✓ 绿色：测试通过
- ✗ 红色：测试失败
- ○ 黄色：测试跳过

最后会显示：

- 总测试数
- 通过/失败/跳过数量
- 通过率
- 总耗时
- 失败详情（如有）

## ⚠️ 注意事项

1. **Electron 应用**：这是一个 Electron 应用，需要图形环境才能完全启动。在无头环境下可能需要配置 `xvfb` 或类似工具。

2. **端口占用**：默认使用 8765 端口，如果被占用，请修改 `.env` 中的 `VITE_SERVER_PORT` 配置。

3. **工作空间目录**：文件 API 操作限制在 `workspaces` 目录内，这是出于安全考虑。

4. **SSE 端点**：部分 API（如 AI 创建、快速对话）使用 Server-Sent Events (SSE) 流式响应，测试脚本仅做基本连通性测试。

## 🔧 故障排查

如果测试失败：

1. **服务不可用**：确保 `pnpm dev` 已启动且没有报错
2. **端口被占用**：检查是否有其他进程使用 8765 端口 `lsof -i :8765`
3. **权限问题**：确保有读写工作空间目录的权限
4. **查看日志**：应用日志会输出详细的错误信息
