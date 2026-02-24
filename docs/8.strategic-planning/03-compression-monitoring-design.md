# 对话压缩监控设计方案

## 一、数据流设计

### 1. 压缩事件传递链

```
SessionCompressor.compress()
  ↓ 压缩完成
emit CompressionEvent
  ↓ EventBus
Gateway.broadcast('compression:done')
  ↓ WebSocket
Frontend receives event
  ↓ Vue Store
UI updates
```

### 2. 事件定义

```typescript
// src/shared/stream-protocol.ts

export interface CompressionEvent {
  type: 'compression:start' | 'compression:done' | 'compression:error';
  sessionId: string;
  timestamp: string;
  data: {
    // compression:start
    totalTokens?: number;
    threshold?: number;

    // compression:done
    originalCount?: number;
    summarizedCount?: number;
    keptCount?: number;
    originalTokens?: number;
    summaryTokens?: number;
    compressionRatio?: number;
    duration?: number;
    summaryPreview?: string; // 总结的前 200 字符

    // compression:error
    error?: string;
  };
}
```

---

## 二、后端改造

### 1. 在 SessionCompressor 中发送事件

```typescript
// src/main/ai/runtime/openai/SessionCompressor.ts

import eventBus from '@main/common/eventBus';

async compressIfNeeded(session: FileSession, model: string): Promise<CompressionResult> {
  if (!this.options.enabled) {
    return { compressed: false };
  }

  // ... 检查逻辑 ...

  // 发送压缩开始事件
  eventBus.emit('compression:start', {
    sessionId: session.getSessionId(),
    totalTokens,
    threshold
  });

  try {
    const result = await this.compress(session, unsummarized, lastSummary, model, totalTokens, threshold);

    // 发送压缩完成事件
    if (result.compressed) {
      eventBus.emit('compression:done', {
        sessionId: session.getSessionId(),
        ...result,
        summaryPreview: lastSummary?.meta?.summaryText?.slice(0, 200)
      });
    }

    return result;
  } catch (error) {
    // 发送压缩失败事件
    eventBus.emit('compression:error', {
      sessionId: session.getSessionId(),
      error: error instanceof Error ? error.message : String(error)
    });

    return { compressed: false };
  }
}
```

### 2. 在 Gateway 中转发事件

```typescript
// src/main/gateway/events/compressionEvents.ts

export function initCompressionEventBridge(gateway: GatewayApi): () => void {
  const handler = (data: any) => {
    gateway.broadcastToSubscribers(
      {
        type: 'event',
        event: 'compression:done',
        data: {
          sessionId: data.sessionId,
          originalTokens: data.originalTokens,
          summaryTokens: data.summaryTokens,
          compressionRatio: data.compressionRatio,
          duration: data.duration,
          summaryPreview: data.summaryPreview
        }
      },
      data.sessionId
    );
  };

  eventBus.on('compression:done', handler);

  return () => {
    eventBus.off('compression:done', handler);
  };
}
```

---

## 三、前端改造

### 1. 创建 Compression Store

```typescript
// src/renderer/src/stores/compression.ts

import { defineStore } from 'pinia';

export interface CompressionRecord {
  timestamp: string;
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
  duration: number;
  summaryPreview: string;
}

export const useCompressionStore = defineStore('compression', {
  state: () => ({
    currentTokens: 0,
    threshold: 89600,
    history: [] as CompressionRecord[]
  }),

  getters: {
    usagePercentage: (state) => ((state.currentTokens / state.threshold) * 100).toFixed(1),

    totalSavedTokens: (state) => state.history.reduce((sum, r) => sum + (r.originalTokens - r.summaryTokens), 0)
  },

  actions: {
    updateCurrentTokens(tokens: number) {
      this.currentTokens = tokens;
    },

    addCompressionRecord(record: CompressionRecord) {
      this.history.unshift(record);
      // 只保留最近 10 条
      if (this.history.length > 10) {
        this.history = this.history.slice(0, 10);
      }
    }
  }
});
```

### 2. 在 ChatPanel 监听压缩事件

```typescript
// src/renderer/src/components/agent/ChatPanel.vue

import { useCompressionStore } from '@/stores/compression';

const compressionStore = useCompressionStore();

// 监听 WebSocket 消息
gateway.on('compression:done', (data) => {
  compressionStore.addCompressionRecord({
    timestamp: new Date().toISOString(),
    originalTokens: data.originalTokens,
    summaryTokens: data.summaryTokens,
    compressionRatio: data.compressionRatio,
    duration: data.duration,
    summaryPreview: data.summaryPreview
  });

  // 显示 Toast 通知
  toast.success(`对话已压缩，节省 ${(data.originalTokens - data.summaryTokens) / 1000}K tokens`);
});
```

### 3. 在状态栏显示 Token 使用

```vue
<!-- src/renderer/src/components/StatusBar.vue -->

<template>
  <div class="status-bar">
    <!-- ... 现有内容 ... -->

    <!-- Token 使用情况 -->
    <div class="status-section">
      <div class="status-item" title="当前对话 Token 使用">
        <span class="i-carbon-data-1 status-icon" />
        <span class="status-label">Token</span>
        <span class="status-value" :class="getTokenColorClass(compressionStore.usagePercentage)">
          {{ formatTokens(compressionStore.currentTokens) }} / {{ formatTokens(compressionStore.threshold) }}
        </span>
        <span class="status-percentage">{{ compressionStore.usagePercentage }}%</span>
      </div>

      <!-- 压缩次数（如果有） -->
      <div v-if="compressionStore.history.length > 0" class="status-item">
        <span class="i-carbon-compress status-icon" />
        <span class="status-label">已压缩</span>
        <span class="status-value">{{ compressionStore.history.length }} 次</span>
      </div>
    </div>

    <!-- ... 其他内容 ... -->
  </div>
</template>

<script setup lang="ts">
import { useCompressionStore } from '@/stores/compression';

const compressionStore = useCompressionStore();

function formatTokens(num: number): string {
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function getTokenColorClass(percentage: string): string {
  const p = parseFloat(percentage);
  if (p >= 90) return 'text-red-600';
  if (p >= 70) return 'text-amber-600';
  return 'text-emerald-600';
}
</script>
```

---

## 四、Memory 使用统计

### 1. Memory 事件定义

```typescript
export interface MemoryEvent {
  type: 'memory:write' | 'memory:search';
  sessionId: string;
  timestamp: string;
  data: {
    action: 'write' | 'search' | 'get';
    scope: 'user' | 'agent';
    file?: string;
    query?: string;
    resultCount?: number;
  };
}
```

### 2. Memory 统计面板

```vue
<!-- MemoryPanel.vue -->

<template>
  <div class="memory-panel">
    <div class="panel-header">
      <h3>📝 记忆管理</h3>
    </div>

    <div class="panel-body">
      <!-- 记忆文件列表 -->
      <div class="memory-files">
        <div class="section-title">记忆文件</div>
        <div v-for="file in memoryFiles" :key="file.path" class="file-item">
          <span :class="file.icon" />
          <span class="file-name">{{ file.name }}</span>
          <span class="file-size">{{ file.size }}</span>
          <button @click="viewFile(file)">查看</button>
        </div>
      </div>

      <!-- 使用统计 -->
      <div class="memory-stats">
        <div class="stat-item">
          <span class="stat-label">写入次数</span>
          <span class="stat-value">{{ memoryStore.writeCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">搜索次数</span>
          <span class="stat-value">{{ memoryStore.searchCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">总大小</span>
          <span class="stat-value">{{ formatSize(memoryStore.totalSize) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## 五、快速启动指南

### 立即启用压缩（5 分钟）

```bash
# 1. 运行脚本
tsx scripts/enable-compression.ts

# 2. 重启应用
pnpm dev

# 3. 观察日志
tail -f .home/logs/*.log | grep Compressor
```

### 运行测试（10 分钟）

```bash
# 1. 运行验证脚本
bash scripts/test-memory-and-compression.sh

# 2. 手动测试
# - 创建新任务
# - 输入：请记住我是测试用户
# - 继续对话 20+ 轮
# - 观察日志中的压缩事件
```

---

## 六、实现优先级

### 立即可做（今天）

1. ✅ 运行 `enable-compression.ts` 启用压缩
2. ✅ 运行测试脚本验证功能
3. ✅ 观察日志确认工作正常

### 本周完成

1. ⏸ 创建 CompressionStore 和事件监听
2. ⏸ 状态栏显示 Token 使用情况
3. ⏸ 压缩事件 Toast 通知
4. ⏸ 压缩历史记录保存到文件

### 下周完成

1. ⏸ Memory 使用统计面板
2. ⏸ 压缩详情查看界面
3. ⏸ 全局监控仪表盘

---

## 附录：测试检查清单

### Memory 功能

- [ ] Memory 工具已注册（✅ 已确认）
- [ ] Agent 配置包含 memory 工具（✅ 已确认）
- [ ] 任务中调用 memory 并成功写入
- [ ] MEMORY.md 文件正确创建
- [ ] memory search 能正确检索

### 压缩功能

- [ ] SessionCompressor 已实现（✅ 已确认）
- [ ] Agent 配置启用 compression（❌ 需执行脚本）
- [ ] 长对话触发自动压缩
- [ ] Session 文件包含 summary 条目
- [ ] 日志显示压缩统计信息

### 可观测性

- [ ] 日志文件可访问
- [ ] 事件能正常记录
- [ ] UI 能展示实时状态

---

## 总结

**核心发现**：

- ✅ Memory 和 Compression 功能都**已完整实现**
- ❌ Compression **未启用**（Agent 配置缺少 runtime.compression）
- ⚠️ Memory **可能使用率低**（Agent instructions 提示不够明确）
- ❌ **缺少可视化**（用户看不到这些功能在工作）

**推荐行动**：

1. **立即执行** `tsx scripts/enable-compression.ts`
2. **运行测试** `bash scripts/test-memory-and-compression.sh`
3. **观察日志** 验证功能正常工作
4. **明天讨论** UI 监控面板的设计和优先级
