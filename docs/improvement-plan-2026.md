# coobee-ai 系统改进方案实施计划

**版本**：v1.0  
**创建时间**：2026-02-23  
**依据**：architecture-analysis-2026.md

---

## 一、改进优先级总览

### 关键指标

- **识别问题数**：12 个
- **高优先级**：4 个（立即修复）
- **中优先级**：5 个（2-4 周完成）
- **低优先级**：3 个（长期优化）

### 分类统计

| 类别           | 问题数 | 预计工时 | 影响范围                     |
| -------------- | ------ | -------- | ---------------------------- |
| **数据一致性** | 3      | 10h      | Gateway、Worker、ThreadStore |
| **资源管理**   | 3      | 8h       | Worker、EventBus、文件系统   |
| **错误处理**   | 2      | 5h       | Gateway、Extension           |
| **监控日志**   | 2      | 11h      | 全局可观测性                 |
| **前端规范**   | 2      | 4h       | Pinia Stores                 |

---

## 二、Q1 阶段（2026-Q1）：稳定性修复

**目标**：修复 4 个高优先级缺陷，确保系统稳定运行

**周期**：1-2 周

### 任务 1.1：修复 tavern-integration API 错误 ⭐⭐⭐

**问题**：使用 `api.events` 错误，应为 `api.eventBus`

**文件**：`extensions/tavern-integration/index.ts`

**实施步骤**：

```typescript
// Step 1: 修改事件发送
-api.events?.emit('external.tavern.task.created', body.task);
+api.eventBus.emit('external.tavern.task.created', body.task);

// Step 2: 修改事件监听并保存清理函数
let cleanupListeners: Array<() => void> = [];

const offTaskCreated = api.eventBus.on('external.tavern.task.created', async (task: unknown) => {
  // 现有逻辑
});
cleanupListeners.push(offTaskCreated);

// Step 3: 实现 unregister
unregister: () => {
  logger?.info?.('[TavernIntegration] Cleaning up listeners...');
  cleanupListeners.forEach((fn) => fn());
  cleanupListeners = [];
};
```

**验证清单**：

- [ ] Extension 启动后能收到 `external.tavern.task.created` 事件
- [ ] 创建任务后 TaskDispatcher 能自动派单
- [ ] Extension unload 后 EventBus 无残留监听器
- [ ] 运行 `pnpm test extensions/tavern-integration/__tests__/`

**预计工时**：2 小时  
**负责人**：待定  
**截止日期**：2026-02-24

---

### 任务 1.2：WorkerBridge 增加 cleanup ⭐⭐⭐

**问题**：Gateway 关闭时未清理 `worker:status` 监听

**文件**：`src/main/gateway/events/WorkerBridge.ts`, `src/main/gateway/Gateway.ts`

**实施步骤**：

```typescript
// Step 1: WorkerBridge 返回清理函数
export function createWorkerBridge(gateway: Gateway): EventBridgeCleanup {
  const offListener = eventBus.on('worker:status', (data: WorkerStatus) => {
    gateway.broadcastEventIf('worker.status', data);
  });

  return () => {
    offListener();
  };
}

// Step 2: Gateway 保存并调用清理函数
class Gateway {
  private cleanups: Array<() => void> = [];

  async start() {
    // 现有逻辑...
    this.cleanups.push(createWorkerBridge(this));
    this.cleanups.push(createStreamBridge(this));
    this.cleanups.push(createThreadBridge(this));
    this.cleanups.push(createWorkspaceBridge(this));
  }

  async close() {
    log.info('[Gateway] Cleaning up event bridges...');
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    // 现有关闭逻辑...
  }
}
```

**验证清单**：

- [ ] Gateway 启动 → WorkerBridge 注册监听
- [ ] Worker 状态变化 → 前端收到 `worker.status` 事件
- [ ] Gateway 关闭 → EventBus 上无残留监听器
- [ ] 运行 `pnpm test src/main/gateway/__tests__/EventBridge.cleanup.test.ts`

**预计工时**：1 小时  
**负责人**：待定  
**截止日期**：2026-02-24

---

### 任务 1.3：统一 Brain 数据访问路径 ⭐⭐⭐

**问题**：Gateway 读文件，Worker 写文件，索引不一致

**文件**：`src/main/gateway/methods/brain.ts`

**实施步骤**：

```typescript
// Step 1: 实现 HTTP 代理函数
async function forwardToBrainWorker<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const workerManager = WorkerManager.getInstance();
  const worker = workerManager.get('brain');

  if (!worker || worker.status !== 'ready') {
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Brain Worker not ready. Please start it first.');
  }

  const url = `http://127.0.0.1:${worker.config.port}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, errorText);
  }

  return res.json();
}

// Step 2: 重写所有方法
export const brainMethods: MethodGroup = {
  namespace: 'brain',
  methods: {
    stats: async () => {
      return forwardToBrainWorker('/api/brain/stats');
    },

    list: async (params) => {
      const query = new URLSearchParams();
      if (params.category) query.set('category', params.category as string);
      if (params.status) query.set('status', params.status as string);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.offset) query.set('offset', String(params.offset));

      return forwardToBrainWorker(`/api/brain/packages?${query}`);
    },

    get: async (params) => {
      if (!params.packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'packageId is required');
      }
      return forwardToBrainWorker(`/api/brain/packages/${params.packageId}`);
    },

    delete: async (params) => {
      if (!params.packageId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'packageId is required');
      }
      return forwardToBrainWorker(`/api/brain/packages/${params.packageId}`, {
        method: 'DELETE'
      });
    }
  }
};

// Step 3: 删除原有的文件系统读取逻辑
// 移除 loadPackage, listPackages, deletePackage, getBrainDir 等函数
```

**配置调整**：

```json
// workers/brain/worker.json
{
  "enable": true,
  "autoStart": true // 改为 true，确保启动时自动启动
}
```

**验证清单**：

- [ ] Brain Worker 未启动 → Gateway 返回错误提示
- [ ] Brain Worker 启动 → Gateway 能正常读取经验包
- [ ] Worker 发布新包 → Gateway 立即能 list 到
- [ ] 删除包 → Gateway 和 Worker 数据一致
- [ ] 运行 `pnpm test src/main/gateway/__tests__/brain-methods.test.ts`（需调整测试）
- [ ] 运行 `cd workers/brain && python tests/test_integration.py`

**预计工时**：4 小时  
**负责人**：待定  
**截止日期**：2026-02-25

---

### 任务 1.4：ThreadStore 并发写锁 ⭐⭐⭐

**问题**：多请求并发写同一 thread 可能数据损坏

**文件**：`src/main/ai/threads/ThreadStore.ts`

**实施步骤**：

```bash
# Step 1: 安装依赖
pnpm add proper-lockfile
```

```typescript
// Step 2: 引入锁
import lockfile from 'proper-lockfile';

class ThreadStore {
  // Step 3: 原子写入 + 文件锁
  async update(id: string, updates: Partial<Thread>): Promise<void> {
    const filePath = path.join(this.threadsDir, `${id}.json`);

    // 文件不存在则跳过
    if (!fs.existsSync(filePath)) {
      throw new Error(`Thread ${id} not found`);
    }

    // 获取锁（最多重试 10 次，每次 100ms）
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(filePath, {
        retries: { retries: 10, minTimeout: 100, maxTimeout: 500 }
      });

      // 读取现有数据
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Thread;

      // 合并更新
      const updated: Thread = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      // 原子写入（先写 tmp 再 rename）
      const tmpPath = `${filePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);

      // 更新内存索引
      const indexEntry = this.index.get(id);
      if (indexEntry) {
        Object.assign(indexEntry, {
          title: updated.title,
          status: updated.status,
          agentId: updated.agentId,
          updatedAt: updated.updatedAt
        });
      }

      log.debug(`[ThreadStore] Updated thread ${id}`);
    } finally {
      // 释放锁
      if (release) {
        await release();
      }
    }
  }

  // Step 4: create 也使用锁（防止重复创建）
  async create(thread: Thread): Promise<void> {
    const filePath = path.join(this.threadsDir, `${thread.id}.json`);

    let release: (() => Promise<void>) | null = null;
    try {
      // 文件不存在才创建
      if (fs.existsSync(filePath)) {
        throw new Error(`Thread ${thread.id} already exists`);
      }

      // 锁定父目录（无法锁定不存在的文件）
      release = await lockfile.lock(this.threadsDir, {
        retries: { retries: 10, minTimeout: 100, maxTimeout: 500 }
      });

      // 原子写入
      const tmpPath = `${filePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(thread, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);

      // 更新索引
      this.index.set(thread.id, {
        id: thread.id,
        title: thread.title,
        status: thread.status,
        agentId: thread.agentId,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt
      });

      log.info(`[ThreadStore] Created thread ${thread.id}`);
    } finally {
      if (release) {
        await release();
      }
    }
  }
}
```

**同理应用到 CheckpointManager**：

```typescript
// src/main/ai/threads/CheckpointManager.ts

async write(checkpoint: ThreadCheckpoint): Promise<void> {
  const filePath = this.getCheckpointPath(checkpoint.threadId);

  let release: (() => Promise<void>) | null = null;
  try {
    // 确保目录存在
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // 获取锁
    release = await lockfile.lock(filePath, {
      retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
      realpath: false  // 文件可能不存在
    });

    // 原子写入
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);

  } finally {
    if (release) {
      await release();
    }
  }
}
```

**验证清单**：

- [ ] 并发 10 个 `thread.update` 请求 → 数据完整无损坏
- [ ] 写入中断（kill -9） → 重启后读取到完整或旧数据
- [ ] 锁超时 → 抛出明确错误而非静默失败
- [ ] 运行压力测试脚本

**预计工时**：6 小时  
**负责人**：待定  
**截止日期**：2026-02-26

---

## 三、Q2 阶段（2026-Q2）：性能优化

**目标**：优化 5 个中优先级问题，提升用户体验

**周期**：2-4 周

### 任务 2.1：统一 stream 错误处理 ⭐⭐

**问题**：`stream.*` 方法返回 `{ok: false}`，与其他方法组不一致

**文件**：`src/main/gateway/methods/stream.ts`

**实施步骤**：

```typescript
// 将所有 return { ok: false, error } 改为抛出 GatewayMethodError

methods: {
  subscribe: async (params, ctx) => {
    if (!params.sessionId) {
      throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
    }

    const sessionId = params.sessionId as string;
    ctx.meta.subscribedSessions.add(sessionId);

    return { ok: true, sessionId };
  },

  unsubscribe: async (params, ctx) => {
    if (!params.sessionId) {
      throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
    }

    const sessionId = params.sessionId as string;
    ctx.meta.subscribedSessions.delete(sessionId);

    return { ok: true, sessionId };
  }

  // resend, latestSeq 同理
}
```

**预计工时**：1.5 小时  
**截止日期**：2026-03-03

---

### 任务 2.2：Extension Gateway 方法生效 ⭐⭐

**问题**：Extension 注册的 Gateway 方法未被加载

**文件**：`src/main/gateway/Gateway.ts`, `src/main/common/extension/ExtensionLoader.ts`

**实施步骤**：

详见"改进方案 9.5"

**预计工时**：3 小时  
**截止日期**：2026-03-05

---

### 任务 2.3：Worker 依赖缓存检测 ⭐⭐

**问题**：每次启动都 `uv pip install`，未做变更检测

**文件**：`src/main/common/worker/WorkerManager.ts`

**实施步骤**：

详见"改进方案 9.6"

**预计工时**：3 小时  
**截止日期**：2026-03-07

---

### 任务 2.4：Worker 运行期健康检查 ⭐⭐

**问题**：仅启动时检查，运行期假死无法发现

**文件**：`src/main/common/worker/WorkerManager.ts`

**实施步骤**：

详见"改进方案 9.7"

**预计工时**：4 小时  
**截止日期**：2026-03-10

---

### 任务 2.5：文件轮转归档 ⭐⭐

**问题**：`events.jsonl`、`tasks.jsonl` 无限增长

**文件**：

- `src/main/ai/runtime/shared/AgentEventWriter.ts`
- `workers/tavern/tavern/storage.py`

**实施步骤**：

详见"改进方案 9.8"

**预计工时**：4 小时  
**截止日期**：2026-03-12

---

## 四、Q3 阶段（2026-Q3）：可观测性增强

**目标**：提升监控、日志和测试覆盖

**周期**：4-6 周

### 任务 3.1：统一监控聚合 ⭐

**实施步骤**：

详见"改进方案 9.9"

**预计工时**：6 小时  
**截止日期**：2026-04-15

---

### 任务 3.2：日志结构化 ⭐

**实施步骤**：

详见"改进方案 9.10"

**预计工时**：5 小时  
**截止日期**：2026-04-20

---

### 任务 3.3：前端数据流规范化 ⭐

**问题**：直接改 `chatStore.sessionId`，绕过 action

**文件**：

- `src/renderer/src/stores/chat.ts`
- `src/renderer/src/views/ThreadView.vue`
- `src/renderer/src/components/ChatPanel.vue`

**实施步骤**：

```typescript
// Step 1: 在 chatStore 增加 action
export const useChatStore = defineStore('chat', () => {
  const sessionId = ref<string>('');
  const messages = ref<Message[]>([]);

  // 新增 action
  function setSessionId(id: string) {
    sessionId.value = id;
  }

  function addUserDecisionMessage(decision: HITLDecision) {
    messages.value.push({
      id: generateId(),
      role: 'user',
      type: 'decision',
      content: decision.approved ? '✅ 已批准' : '❌ 已拒绝',
      decision,
      timestamp: Date.now()
    });
  }

  return {
    sessionId,
    messages,
    setSessionId,
    addUserDecisionMessage,
    // 其他 actions...
  };
});

// Step 2: 修改调用方
// ThreadView.vue
- chatStore.sessionId = id;
+ chatStore.setSessionId(id);

// ChatPanel.vue
- chatStore.messages.push(...);
+ chatStore.addUserDecisionMessage(decision);
```

**预计工时**：2 小时  
**截止日期**：2026-04-25

---

### 任务 3.4：补充测试覆盖

**目标**：

- [ ] ThreadStore 并发写测试
- [ ] CheckpointManager 故障恢复测试
- [ ] Extension 集成测试（Gateway 方法、HTTP 路由）
- [ ] Gateway + Worker 端到端测试

**预计工时**：8 小时  
**截止日期**：2026-05-10

---

## 五、执行保障

### 5.1 代码审查规范

所有改进实施需通过以下审查：

1. **功能审查**：
   - [ ] 实现符合需求
   - [ ] 无新增 bug
   - [ ] 向后兼容

2. **代码质量**：
   - [ ] TypeScript 类型完整
   - [ ] ESLint 无错误
   - [ ] 符合项目代码风格

3. **测试**：
   - [ ] 单元测试通过
   - [ ] 集成测试通过
   - [ ] 手工验证通过

4. **文档**：
   - [ ] 代码注释清晰
   - [ ] 更新相关文档
   - [ ] 更新 CHANGELOG

### 5.2 测试策略

| 测试类型       | 覆盖范围       | 执行时机   |
| -------------- | -------------- | ---------- |
| **单元测试**   | 函数、类、模块 | 每次提交前 |
| **集成测试**   | 模块间交互     | 每次 PR 前 |
| **端到端测试** | 完整用户流程   | 每周一次   |
| **回归测试**   | 全量测试       | 发版前     |

### 5.3 发版策略

```
修复分支 → PR 审查 → 合并到 main → CI 测试 → 发布 alpha → 测试验证 → 发布 stable
```

**版本号规则**：

- 高优先级修复：patch 版本（1.0.x）
- 中优先级优化：minor 版本（1.x.0）
- 重大重构：major 版本（x.0.0）

### 5.4 回滚计划

每个改进实施前：

1. 备份当前版本代码（git tag）
2. 备份用户数据（.home/ 目录）
3. 记录回滚步骤
4. 实施变更
5. 如出现问题 → 立即回滚 → 分析原因 → 重新实施

---

## 六、风险评估与缓解

### 6.1 高风险项

| 任务               | 风险                          | 概率 | 影响 | 缓解措施               |
| ------------------ | ----------------------------- | ---- | ---- | ---------------------- |
| 1.3 Brain 路径统一 | Worker 启动失败导致功能不可用 | 中   | 高   | 保留旧代码作为降级方案 |
| 1.4 并发写锁       | 锁死导致系统hang              | 低   | 高   | 设置锁超时、异常回滚   |
| 2.4 健康检查       | 频繁重启影响稳定性            | 中   | 中   | 可配置检查间隔和阈值   |

### 6.2 依赖风险

- **proper-lockfile**：成熟库，风险低
- **Worker 代理**：依赖 Worker 启动，需确保 autoStart
- **文件轮转**：需测试大文件场景

### 6.3 用户影响

- **Q1 修复**：用户无感知，后台修复
- **Q2 优化**：启动速度提升，用户体验改善
- **Q3 增强**：新增监控面板，可选功能

---

## 七、成功指标

### 7.1 质量指标

- [ ] 测试覆盖率：从 75% 提升到 85%
- [ ] P0 bug 数：降低到 0
- [ ] P1 bug 数：降低 50%
- [ ] 代码审查通过率：100%

### 7.2 性能指标

- [ ] Worker 启动时间：从 10 秒降低到 < 2 秒
- [ ] ThreadStore 并发写：100 并发无数据损坏
- [ ] 内存泄漏：24 小时运行内存增长 < 100MB

### 7.3 可观测性指标

- [ ] 监控端点：提供 /metrics API
- [ ] 日志结构化率：核心模块 100%
- [ ] 告警覆盖：关键路径 100%

---

## 八、附录

### A. 快速参考

**高优先级问题速查**：

1. tavern-integration API 错误 → `api.eventBus`
2. WorkerBridge 泄漏 → 返回 cleanup
3. Brain 双写路径 → Gateway 代理到 Worker
4. 并发写锁 → proper-lockfile + 原子写

**中优先级问题速查**：5. stream 错误 → 抛 GatewayMethodError 6. Extension Gateway 方法 → 从 Registry 加载 7. Worker 依赖 → hash 缓存检测 8. Worker 健康 → 周期性探测 9. 文件轮转 → 10MB 归档

**低优先级问题速查**：10. 监控聚合 → /metrics 端点 11. 日志结构化 → JSON + traceId 12. 前端数据流 → action 统一入口

### B. 联系方式

**技术负责人**：待定  
**项目经理**：待定  
**问题反馈**：GitHub Issues  
**文档更新**：docs/ 目录

---

**文档版本**：v1.0  
**最后更新**：2026-02-23  
**下次审查**：2026-03-01
