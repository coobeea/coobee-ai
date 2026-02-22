# Worker 子进程管理

## 概述

Worker 是独立的子进程（Python/Node.js），提供后台服务能力。每个 Worker 通过 `worker.json` 配置文件控制启停。

**存储位置**: `{userHome}/workers/`  
**管理方式**: 修改配置文件，系统自动检测并应用变更（热重载）

---

## Worker 目录结构

```
{userHome}/workers/
├── tavern-poller/              # Tavern 任务扫描 Worker
│   ├── worker.json             # 配置文件 ← 修改这个文件控制启停
│   ├── server.py               # Worker 入口脚本
│   └── requirements.txt        # Python 依赖
└── embedding-service/          # 嵌入向量服务 Worker
    ├── worker.json
    └── server.py
```

---

## worker.json 配置格式

```json5
{
  name: 'tavern-poller', // Worker 名称
  label: 'Tavern Poller', // 显示名称
  type: 'python', // 类型: python | native
  entry: 'server.py', // 入口脚本
  port: 9010, // 监听端口
  enable: true, // ← 控制是否启用
  autoStart: false, // ← 控制是否应用启动时自动运行
  autoRestart: true, // 崩溃后自动重启
  maxRestarts: 5, // 最大重启次数
  healthCheckPath: '/health', // 健康检查路径
  healthCheckTimeout: 5000, // 健康检查超时（毫秒）
  env: {} // 环境变量
}
```

---

## 关键字段说明

### `enable` - 控制是否启用

| 值      | 说明                    |
| ------- | ----------------------- |
| `true`  | Worker 可以被启动       |
| `false` | Worker 被禁用，停止运行 |

### `autoStart` - 控制自动启动

| 值      | 说明                        |
| ------- | --------------------------- |
| `true`  | 应用启动时自动运行此 Worker |
| `false` | 需要手动或按需启动          |

---

## 控制 Worker 启停（配置驱动）

### 方法: 修改 worker.json，系统自动应用

#### 启动 Worker

```typescript
// 1. 读取配置
const configPath = `${paths.userHome}/workers/tavern-poller/worker.json`;
const config = JSON.parse(await read(configPath));

// 2. 修改配置
config.enable = true;
config.autoStart = true;

// 3. 写回配置文件（触发热重载）
await write(configPath, JSON.stringify(config, null, 2));

// 系统会自动检测配置变化并启动 Worker ✅
```

#### 停止 Worker

```typescript
// 1. 读取配置
const config = JSON.parse(await read(configPath));

// 2. 修改配置
config.enable = false;
// 或者
config.autoStart = false;

// 3. 写回配置文件
await write(configPath, JSON.stringify(config, null, 2));

// 系统会自动检测配置变化并停止 Worker ✅
```

---

## 配置热重载机制

**WorkerManager 会监控所有 worker.json 文件的变化：**

| 配置变化                           | 系统响应              |
| ---------------------------------- | --------------------- |
| `enable: false`                    | 自动停止 Worker       |
| `enable: true` + `autoStart: true` | 自动启动 Worker       |
| `autoStart: true → false`          | 停止正在运行的 Worker |
| `autoStart: false → true`          | 启动 Worker           |

**无需重启应用，配置修改立即生效。**

---

## 使用场景

### 场景 1：按需启动服务

```
用户: "帮我启动 Tavern 任务扫描服务"

你的操作:
1. read('~/.coobee-ai/workers/tavern-poller/worker.json')
2. 修改 enable: true, autoStart: true
3. write 写回配置文件
4. 告诉用户"Tavern 扫描服务已启动"
```

### 场景 2：节省资源

```
用户: "暂停 Tavern 扫描，节省资源"

你的操作:
1. read('~/.coobee-ai/workers/tavern-poller/worker.json')
2. 修改 enable: false
3. write 写回配置文件
4. 告诉用户"Tavern 扫描已暂停"
```

### 场景 3：调整自动启动

```
用户: "我希望 Tavern 服务开机自动运行"

你的操作:
1. read('~/.coobee-ai/workers/tavern-poller/worker.json')
2. 修改 autoStart: true
3. write 写回配置文件
4. 告诉用户"已设置为开机自动启动"
```

---

## 注意事项

1. **只修改 enable 和 autoStart 字段** - 其他字段（port、entry 等）不应随意修改
2. **先读后改** - 保留其他配置项，只修改需要的字段
3. **配置立即生效** - 修改后自动检测并应用，无需手动操作
4. **健康检查** - Worker 启动后会自动进行健康检查
5. **崩溃重启** - `autoRestart: true` 的 Worker 崩溃后会自动重启

---

## 开发者友好

开发者也可以直接编辑配置文件：

```bash
# 直接编辑
vim ~/.coobee-ai/workers/tavern-poller/worker.json

# 修改后系统自动检测并应用
# 无需重启应用 ✅
```
