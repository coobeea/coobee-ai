# Worker 配置驱动管理方案

## 📋 当前实现分析

### 现有机制

**启动流程**:

```
应用启动 → ReadyWorkerHook 执行
  ↓
扫描 workers/ 目录
  ↓
读取每个 worker.json
  ↓
enable=false → 跳过
enable=true + autoStart=true → 自动启动
enable=true + autoStart=false → 注册但不启动
```

**配置文件示例** (`workers/tavern-poller/worker.json`):

```json
{
  "name": "tavern-poller",
  "label": "Tavern Poller",
  "type": "python",
  "entry": "server.py",
  "port": 9010,
  "enable": true, // ← 控制是否注册
  "autoStart": false, // ← 控制是否自动启动
  "autoRestart": true,
  "maxRestarts": 5,
  "healthCheckPath": "/health"
}
```

### 关键发现

✅ **已有的**:

- 配置文件驱动（worker.json）
- enable 字段控制启用/禁用
- autoStart 字段控制自动启动
- 启动时自动扫描和注册

❌ **缺少的**:

- **配置文件变化监控**（改了配置需要重启应用）
- **热重载机制**（无法动态生效）

---

## 🎯 优化方案：配置驱动 + 热重载

### 核心思想

> **Agent 只需要修改配置文件，系统自动检测并应用变更**

```
Agent 修改 worker.json (通过 Skill)
  ↓
WorkerManager 监听到文件变化 (fs.watch)
  ↓
重新读取配置
  ↓
对比变更:
  - enable: false→true → 启动 Worker
  - enable: true→false → 停止 Worker
  - autoStart: false→true → 启动 Worker
  - autoStart: true→false → 停止 Worker
  ↓
自动应用变更
```

---

## 🏗️ 架构设计

### 1. 配置文件监控

```typescript
// src/main/common/worker/WorkerManager.ts

import fs from 'node:fs';

export class WorkerManager extends EventEmitter {
  private configWatchers = new Map<string, fs.FSWatcher>();

  /**
   * 监控 Worker 配置文件变化
   */
  private watchWorkerConfig(workerName: string): void {
    const configPath = path.join(Env.paths.workersDir, workerName, 'worker.json');

    if (!fs.existsSync(configPath)) return;

    // 使用 fs.watch 监控文件变化
    const watcher = fs.watch(configPath, async (eventType) => {
      if (eventType === 'change') {
        log.info(`[WorkerManager] 检测到配置变更: ${workerName}`);
        await this.reloadWorkerConfig(workerName);
      }
    });

    this.configWatchers.set(workerName, watcher);
  }

  /**
   * 重新加载配置并应用变更
   */
  private async reloadWorkerConfig(workerName: string): Promise<void> {
    try {
      const configPath = path.join(Env.paths.workersDir, workerName, 'worker.json');

      // 读取新配置
      const raw = fs.readFileSync(configPath, 'utf-8');
      const newConfig = JSON.parse(raw) as WorkerConfig;

      const oldConfig = this.configs.get(workerName);
      const worker = this.workers.get(workerName);

      if (!oldConfig) return;

      // 检测关键字段变化
      const enableChanged = oldConfig.enable !== newConfig.enable;
      const autoStartChanged = oldConfig.autoStart !== newConfig.autoStart;

      // 更新配置
      this.configs.set(workerName, newConfig);

      // 应用变更
      if (newConfig.enable === false) {
        // 禁用 Worker → 停止
        if (worker && worker.status === 'ready') {
          log.info(`[WorkerManager] 配置禁用，停止 Worker: ${workerName}`);
          await this.stop(workerName);
        }
      } else if (newConfig.enable === true) {
        // 启用 Worker
        if (enableChanged && oldConfig.enable === false) {
          // 从禁用变为启用
          if (newConfig.autoStart) {
            log.info(`[WorkerManager] 配置启用，启动 Worker: ${workerName}`);
            await this.start(workerName);
          }
        } else if (autoStartChanged) {
          // autoStart 状态变化
          if (newConfig.autoStart && (!worker || worker.status === 'stopped')) {
            log.info(`[WorkerManager] autoStart 启用，启动 Worker: ${workerName}`);
            await this.start(workerName);
          } else if (!newConfig.autoStart && worker && worker.status === 'ready') {
            log.info(`[WorkerManager] autoStart 禁用，停止 Worker: ${workerName}`);
            await this.stop(workerName);
          }
        }
      }

      log.info(`[WorkerManager] 配置已重载: ${workerName}`);
    } catch (err) {
      log.error(`[WorkerManager] 配置重载失败: ${workerName}`, err);
    }
  }

  /**
   * 启用配置监控（在 scanAndRegister 后调用）
   */
  public startWatching(): void {
    for (const [name] of this.configs) {
      this.watchWorkerConfig(name);
    }
    log.info('[WorkerManager] 配置文件监控已启动');
  }

  /**
   * 停止监控（应用退出时）
   */
  public stopWatching(): void {
    for (const [name, watcher] of this.configWatchers) {
      watcher.close();
      log.debug(`[WorkerManager] 停止监控: ${name}`);
    }
    this.configWatchers.clear();
  }
}
```

---

### 2. Agent Skill：修改 Worker 配置

```typescript
// extensions/worker-management/index.ts

export default {
  id: 'worker-management',
  name: 'Worker Management',

  register: (api) => {
    // 注册 Skill（供 Agent 使用）
    api.registerTool({
      name: 'configure_worker',
      description: 'Modify worker configuration to enable/disable or start/stop workers',
      parameters: {
        type: 'object',
        properties: {
          workerName: {
            type: 'string',
            description: 'Worker name (e.g., tavern-poller)',
            enum: ['tavern-poller', 'embedding-service'] // 可配置的白名单
          },
          enable: {
            type: 'boolean',
            description: 'Enable or disable the worker'
          },
          autoStart: {
            type: 'boolean',
            description: 'Enable or disable auto-start on app launch'
          }
        },
        required: ['workerName']
      },

      async execute({ workerName, enable, autoStart }) {
        const configPath = path.join(Env.paths.workersDir, workerName, 'worker.json');

        if (!fs.existsSync(configPath)) {
          return {
            success: false,
            error: `Worker "${workerName}" not found`
          };
        }

        try {
          // 读取现有配置
          const raw = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(raw);

          // 更新字段
          if (enable !== undefined) {
            config.enable = enable;
          }
          if (autoStart !== undefined) {
            config.autoStart = autoStart;
          }

          // 写回文件（触发 fs.watch）
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

          return {
            success: true,
            message: `Worker "${workerName}" configuration updated`,
            config: { enable: config.enable, autoStart: config.autoStart }
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
    });
  }
} as ExtensionModule;
```

---

### 3. 生命周期集成

```typescript
// src/main/lifecycle/ReadyWorkerHook.ts

export const ReadyWorkerHook: LifecycleHook = {
  name: 'ready-worker',
  phase: LifecyclePhase.READY,

  async execute(_context: LifecycleContext): Promise<void> {
    const manager = WorkerManager.getInstance();

    // 1. 扫描并注册 Worker
    const count = manager.scanAndRegister();

    // 2. 启动配置文件监控 ← 新增
    manager.startWatching();

    // 3. 启动 autoStart 的 Worker
    const configs = manager.getRegisteredWorkers();
    const autoStartWorkers = configs.filter((c) => c.autoStart && c.enable !== false);

    for (const config of autoStartWorkers) {
      manager.start(config.name).catch((err) => {
        log.error(`Worker "${config.name}" 启动失败:`, err);
      });
    }
  }
};

export const BeforeQuitWorkerHook: LifecycleHook = {
  name: 'before-quit-worker',
  phase: LifecyclePhase.BEFORE_QUIT,

  async execute(_context: LifecycleContext): Promise<void> {
    const manager = WorkerManager.getInstance();

    // 1. 停止配置监控 ← 新增
    manager.stopWatching();

    // 2. 停止所有 Worker
    await manager.stopAll();
  }
};
```

---

## 📝 使用示例

### 示例 1: Agent 启动 Worker

**用户**: "帮我启动 Tavern 任务扫描服务"

**Agent 推理**:

```
1. 理解用户意图：启动 tavern-poller Worker
2. 调用工具：configure_worker
   参数：{ workerName: 'tavern-poller', enable: true, autoStart: true }
3. 系统自动检测配置变化并启动 Worker
4. 回复用户：Tavern 任务扫描服务已启动
```

**实际流程**:

```
Agent → configure_worker → 修改 worker.json
  ↓
WorkerManager 监听到变化
  ↓
检测到 enable=true, autoStart=true
  ↓
自动启动 Worker
  ↓
Worker 开始运行
```

---

### 示例 2: Agent 停止 Worker

**用户**: "暂停 Tavern 扫描，节省资源"

**Agent 推理**:

```
1. 理解用户意图：停止 tavern-poller Worker
2. 调用工具：configure_worker
   参数：{ workerName: 'tavern-poller', enable: false }
3. 系统自动检测配置变化并停止 Worker
4. 回复用户：Tavern 扫描已暂停
```

---

### 示例 3: 手动修改配置（开发者）

开发者直接编辑 `workers/tavern-poller/worker.json`:

```json
{
  "name": "tavern-poller",
  "enable": true, // false → true
  "autoStart": true // false → true
}
```

**系统自动响应**:

```
fs.watch 检测到变化
  ↓
WorkerManager.reloadWorkerConfig()
  ↓
发现 enable 和 autoStart 都变为 true
  ↓
自动启动 Worker
  ↓
发送事件通知前端
```

---

## 🔒 安全性考虑

### 1. 白名单机制

```typescript
const CONFIGURABLE_WORKERS = [
  'tavern-poller',
  'embedding-service'
  // 'system-core' ← 禁止配置
];

if (!CONFIGURABLE_WORKERS.includes(workerName)) {
  throw new Error('This worker cannot be configured by agents');
}
```

### 2. 配置验证

```typescript
// 防止写入非法配置
function validateConfig(config: WorkerConfig): boolean {
  if (typeof config.enable !== 'boolean') return false;
  if (typeof config.autoStart !== 'boolean') return false;
  // ... 其他验证
  return true;
}
```

### 3. 防抖处理

```typescript
// 防止短时间内频繁修改配置
const reloadDebounce = new Map<string, NodeJS.Timeout>();

function debouncedReload(workerName: string): void {
  const existing = reloadDebounce.get(workerName);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    reloadWorkerConfig(workerName);
    reloadDebounce.delete(workerName);
  }, 500); // 500ms 防抖

  reloadDebounce.set(workerName, timer);
}
```

---

## 📊 方案对比

| 维度           | 多工具方案               | 配置驱动方案（推荐）    |
| -------------- | ------------------------ | ----------------------- |
| **工具数量**   | 3个（start/stop/status） | 1个（configure_worker） |
| **系统复杂度** | ⭐⭐⭐☆☆                 | ⭐⭐☆☆☆                 |
| **资源消耗**   | 高（需维护多个工具）     | 低（单一 Skill）        |
| **配置持久化** | ❌ 重启失效              | ✅ 配置文件持久化       |
| **热重载**     | ❌ 需手动调用            | ✅ 自动检测应用         |
| **开发友好**   | ⭐⭐⭐☆☆                 | ⭐⭐⭐⭐⭐              |
| **可维护性**   | ⭐⭐⭐☆☆                 | ⭐⭐⭐⭐⭐              |
| **符合架构**   | ⭐⭐⭐☆☆                 | ⭐⭐⭐⭐⭐              |

**结论**: 配置驱动方案更优

---

## 🚀 实施计划

### Phase 1: 配置监控（核心）

- [ ] 在 WorkerManager 中添加 `watchWorkerConfig()`
- [ ] 实现 `reloadWorkerConfig()` 逻辑
- [ ] 在 ReadyWorkerHook 中启用监控
- [ ] 添加防抖和错误处理

**工作量**: 1-2 小时

### Phase 2: Agent Skill

- [ ] 创建 `worker-management` Extension
- [ ] 实现 `configure_worker` Skill
- [ ] 添加白名单和验证
- [ ] 编写单元测试

**工作量**: 1 小时

### Phase 3: 测试和文档

- [ ] 端到端测试
- [ ] 更新 Agent 指令文档
- [ ] 编写使用示例

**工作量**: 1 小时

**总工作量**: 3-4 小时

---

## ✅ 优势总结

1. **✅ 资源高效**: 只需一个 Skill，不需要多个工具
2. **✅ 配置持久化**: 写入文件，重启后配置保留
3. **✅ 热重载**: 无需重启应用，配置立即生效
4. **✅ 开发友好**: 开发者可以直接编辑配置文件
5. **✅ 符合架构**: 配置驱动，符合系统设计理念
6. **✅ 集成到 Skill**: 作为一个 Skill，更轻量级

---

## 💡 下一步

**建议立即实施**，因为：

1. 实现简单（3-4小时）
2. 价值明显（资源高效 + 配置持久化）
3. 不影响现有功能
4. 为后续扩展打好基础

**您的反馈**:

1. 是否同意这个方案？
2. 是否现在开始实施？
3. 是否有其他考虑因素？

---

**讨论时间**: 2026-02-22  
**方案提出**: 用户建议 + AI 设计  
**状态**: 待确认实施
