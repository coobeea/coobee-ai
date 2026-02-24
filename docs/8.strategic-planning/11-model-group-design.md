# 模型组与自动选择设计方案

## 一、需求分析

### 当前问题

- Agent 只能配置**单个固定模型**（如 `openai/gpt-4o`）
- 缺乏灵活性，无法应对：
  - ❌ API 配额耗尽（无法自动切换备用模型）
  - ❌ 模型故障（无法 fallback）
  - ❌ 成本优化（无法优先使用便宜模型）
  - ❌ 负载均衡（无法分散请求到多个模型）

### 用户期望

1. **模型分组**：定义模型组（如"高性能组"、"经济组"）
2. **Agent 选择组**：Agent 配置时选择模型组而非单个模型
3. **自动选择**：Agent 配置 `auto` 时系统自动选择最佳模型
4. **负载策略**：
   - 顺序选择（Round-robin）
   - 随机选择（Random）
   - 智能选择（基于配额、成本、延迟）
   - 故障转移（Fallback）

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                 配置层（coobee.json5）                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │ models.groups (模型组定义)                         │ │
│  │  - high-performance: [...models]                   │ │
│  │  - economic: [...models]                           │ │
│  │  - auto: 自动选择规则                              │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                Agent 定义（.home/agents/*.json）         │
│  {                                                       │
│    "model": "@high-performance"  // 引用模型组          │
│    "model": "auto"                // 自动选择            │
│    "model": "openai/gpt-4o"       // 单个模型（兼容）    │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              ModelGroupResolver（新增）                  │
│  - 解析 @group 引用                                     │
│  - 执行负载均衡策略                                     │
│  - 配额感知选择                                         │
│  - 故障转移                                             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                ModelSelector（增强）                     │
│  - 集成 ModelGroupResolver                              │
│  - 保持原有 4 级优先级逻辑                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                  AgentExecutor                           │
│  - 使用增强后的 ModelSelector                           │
│  - 自动重试（如果模型失败）                             │
└─────────────────────────────────────────────────────────┘
```

---

## 三、详细设计

### 3.1 配置 Schema 扩展

#### 新增：模型组定义

```typescript
// src/main/common/config/schema.ts

// 负载均衡策略
export const LoadBalanceStrategySchema = z.enum([
  'round-robin', // 轮询（轮流使用组内模型）
  'random', // 随机选择
  'weighted', // 加权选择（基于成本/速度）
  'quota-aware', // 配额感知（优先用配额充足的）
  'fallback' // 顺序尝试（第一个失败后尝试第二个）
]);

// 模型组定义
export const ModelGroupSchema = z.object({
  name: z.string(), // 组名
  description: z.string().optional(), // 描述
  models: z.array(z.string()).min(1), // 模型列表（provider/model 格式）
  strategy: LoadBalanceStrategySchema.default('round-robin'), // 负载策略
  weights: z.record(z.string(), z.number()).optional(), // 权重（用于 weighted 策略）
  enabled: z.boolean().default(true) // 是否启用
});

// Auto 模式配置
export const AutoModelConfigSchema = z.object({
  enabled: z.boolean().default(true), // 是否启用 auto 模式
  strategy: LoadBalanceStrategySchema.default('quota-aware'), // 默认策略
  candidates: z.array(z.string()).optional(), // 候选模型列表（为空则使用所有可用模型）
  filters: z
    .object({
      // 过滤条件
      maxCost: z.number().optional(), // 最大成本（$/1M tokens）
      minContextWindow: z.number().optional(), // 最小上下文窗口
      requireFunctionCalling: z.boolean().optional(), // 是否需要 function calling
      requireVision: z.boolean().optional() // 是否需要 vision
    })
    .optional()
});

// 更新主 Schema
export const CoobeeConfigSchema = z.object({
  models: z
    .object({
      providers: z.record(z.string(), ProviderConfigSchema).optional(),

      // 新增：模型组配置
      groups: z.record(z.string(), ModelGroupSchema).optional(),

      // 新增：Auto 模式配置
      auto: AutoModelConfigSchema.optional(),

      defaults: z
        .object({
          model: ModelSelectionSchema.optional(),
          thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional()
        })
        .optional()
    })
    .optional()

  // ... 其他配置
});
```

#### 配置文件示例

```json5
// .home/config/coobee.json5
{
  models: {
    providers: {
      // ... 现有 provider 配置
    },

    // 模型组定义
    groups: {
      'high-performance': {
        name: '高性能组',
        description: '适用于复杂推理任务',
        models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-thinking-exp'],
        strategy: 'quota-aware', // 优先使用配额充足的
        enabled: true
      },

      economic: {
        name: '经济组',
        description: '适用于简单任务，成本优化',
        models: ['openai/gpt-4o-mini', 'anthropic/claude-3-5-haiku-20241022', 'google/gemini-2.0-flash-exp'],
        strategy: 'round-robin', // 轮询使用
        enabled: true
      },

      'vision-capable': {
        name: '视觉模型组',
        description: '支持图像理解',
        models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-exp'],
        strategy: 'weighted',
        weights: {
          'openai/gpt-4o': 0.5, // 50% 概率
          'anthropic/claude-3-5-sonnet-20241022': 0.3, // 30% 概率
          'google/gemini-2.0-flash-exp': 0.2 // 20% 概率
        },
        enabled: true
      },

      'fallback-chain': {
        name: '故障转移链',
        description: '按顺序尝试，失败后自动切换',
        models: [
          'openai/gpt-4o', // 首选
          'anthropic/claude-3-5-sonnet-20241022', // 备选 1
          'google/gemini-2.0-flash-exp' // 备选 2
        ],
        strategy: 'fallback', // 顺序尝试
        enabled: true
      }
    },

    // Auto 模式配置
    auto: {
      enabled: true,
      strategy: 'quota-aware',
      candidates: [
        // 为空则使用所有可用模型
      ],
      filters: {
        maxCost: 15, // 最大成本 $15/1M tokens
        minContextWindow: 100000, // 至少 100K 上下文
        requireFunctionCalling: true // 必须支持 function calling
      }
    },

    defaults: {
      model: {
        primary: 'openai/gpt-4o',
        fallbacks: ['anthropic/claude-3-5-sonnet-20241022']
      }
    }
  }
}
```

---

### 3.2 Agent 定义扩展

#### Agent 模型字段支持三种格式

```typescript
// src/shared/types/agent.ts

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;

  /**
   * 模型配置（支持三种格式）:
   *
   * 1. 单个模型（现有格式，兼容）
   *    "openai/gpt-4o"
   *
   * 2. 模型组引用（新增）
   *    "@high-performance"  → 引用配置中的 models.groups.high-performance
   *
   * 3. Auto 模式（新增）
   *    "auto"  → 系统自动选择最佳模型
   */
  model?: string;

  // ... 其他字段
}
```

#### 示例

```json
// .home/agents/code-reviewer.json
{
  "id": "code-reviewer",
  "name": "代码审查助手",
  "model": "@high-performance",  // 引用高性能组
  "instructions": "..."
}

// .home/agents/chat-bot.json
{
  "id": "chat-bot",
  "name": "聊天助手",
  "model": "@economic",  // 引用经济组
  "instructions": "..."
}

// .home/agents/smart-assistant.json
{
  "id": "smart-assistant",
  "name": "智能助手",
  "model": "auto",  // 自动选择
  "instructions": "..."
}

// .home/agents/legacy-agent.json
{
  "id": "legacy-agent",
  "name": "传统助手",
  "model": "openai/gpt-4o",  // 单个模型（兼容旧格式）
  "instructions": "..."
}
```

---

### 3.3 核心组件实现

#### 3.3.1 ModelGroupResolver

```typescript
// src/main/ai/provider/ModelGroupResolver.ts

import type { CoobeeConfig } from '@main/common/config/schema';
import type { ModelGroup, LoadBalanceStrategy } from './types';
import { QuotaManager } from '@main/services/QuotaManager'; // 假设有配额管理器

export interface ModelSelectionContext {
  sessionId: string;
  agentId: string;
  requireVision?: boolean;
  requireFunctionCalling?: boolean;
  previousFailures?: string[]; // 之前失败的模型（用于重试）
}

export class ModelGroupResolver {
  /** 轮询计数器（per group） */
  private roundRobinCounters = new Map<string, number>();

  constructor(
    private config: CoobeeConfig,
    private quotaManager?: QuotaManager
  ) {}

  /**
   * 解析模型引用
   *
   * @param modelRef 可以是：
   *   - "@group-name"  → 模型组
   *   - "auto"         → 自动选择
   *   - "provider/model" → 单个模型
   *
   * @returns 解析后的模型引用（provider/model 格式）
   */
  resolve(modelRef: string, context: ModelSelectionContext): string {
    // Case 1: 模型组引用
    if (modelRef.startsWith('@')) {
      const groupName = modelRef.slice(1);
      return this.resolveGroup(groupName, context);
    }

    // Case 2: Auto 模式
    if (modelRef === 'auto') {
      return this.resolveAuto(context);
    }

    // Case 3: 单个模型（兼容现有格式）
    return modelRef;
  }

  /**
   * 解析模型组
   */
  private resolveGroup(groupName: string, context: ModelSelectionContext): string {
    const group = this.config.models?.groups?.[groupName];

    if (!group) {
      throw new Error(`Model group "${groupName}" not found in config`);
    }

    if (!group.enabled) {
      throw new Error(`Model group "${groupName}" is disabled`);
    }

    // 过滤掉之前失败的模型
    let candidates = group.models.filter((m) => !context.previousFailures?.includes(m));

    if (candidates.length === 0) {
      throw new Error(`No available models in group "${groupName}" (all failed)`);
    }

    // 根据策略选择模型
    return this.selectByStrategy(group.strategy, candidates, groupName, context);
  }

  /**
   * 根据策略选择模型
   */
  private selectByStrategy(
    strategy: LoadBalanceStrategy,
    candidates: string[],
    groupName: string,
    context: ModelSelectionContext
  ): string {
    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(candidates, groupName);

      case 'random':
        return this.selectRandom(candidates);

      case 'weighted':
        return this.selectWeighted(candidates, groupName);

      case 'quota-aware':
        return this.selectQuotaAware(candidates, context);

      case 'fallback':
        return candidates[0]; // 总是返回第一个（失败后会自动尝试下一个）

      default:
        return candidates[0];
    }
  }

  /**
   * 轮询选择
   */
  private selectRoundRobin(candidates: string[], groupName: string): string {
    const counter = this.roundRobinCounters.get(groupName) ?? 0;
    const selected = candidates[counter % candidates.length];

    this.roundRobinCounters.set(groupName, counter + 1);

    return selected;
  }

  /**
   * 随机选择
   */
  private selectRandom(candidates: string[]): string {
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  /**
   * 加权选择
   */
  private selectWeighted(candidates: string[], groupName: string): string {
    const group = this.config.models?.groups?.[groupName];
    const weights = group?.weights ?? {};

    // 计算总权重
    const totalWeight = candidates.reduce((sum, model) => {
      return sum + (weights[model] ?? 1);
    }, 0);

    // 随机选择
    let random = Math.random() * totalWeight;

    for (const model of candidates) {
      const weight = weights[model] ?? 1;
      random -= weight;
      if (random <= 0) {
        return model;
      }
    }

    return candidates[0];
  }

  /**
   * 配额感知选择（优先使用配额充足的模型）
   */
  private selectQuotaAware(candidates: string[], context: ModelSelectionContext): string {
    if (!this.quotaManager) {
      // 无配额管理器，fallback 到随机选择
      return this.selectRandom(candidates);
    }

    // 按配额剩余量排序
    const sorted = candidates
      .map((model) => ({
        model,
        remaining: this.quotaManager!.getRemaining(model) ?? Infinity
      }))
      .sort((a, b) => b.remaining - a.remaining);

    // 选择配额最多的
    return sorted[0].model;
  }

  /**
   * Auto 模式：自动选择最佳模型
   */
  private resolveAuto(context: ModelSelectionContext): string {
    const autoConfig = this.config.models?.auto;

    if (!autoConfig?.enabled) {
      throw new Error('Auto model selection is disabled in config');
    }

    // 获取候选模型
    let candidates = autoConfig.candidates ?? this.getAllAvailableModels();

    // 应用过滤条件
    candidates = this.applyFilters(candidates, autoConfig.filters ?? {}, context);

    if (candidates.length === 0) {
      throw new Error('No models match the auto selection filters');
    }

    // 使用配置的策略选择
    return this.selectByStrategy(autoConfig.strategy ?? 'quota-aware', candidates, 'auto', context);
  }

  /**
   * 获取所有可用模型
   */
  private getAllAvailableModels(): string[] {
    const providers = this.config.models?.providers ?? {};
    const models: string[] = [];

    for (const [providerId, provider] of Object.entries(providers)) {
      if (provider.enabled !== false) {
        for (const model of provider.models) {
          models.push(`${providerId}/${model.id}`);
        }
      }
    }

    return models;
  }

  /**
   * 应用过滤条件
   */
  private applyFilters(
    candidates: string[],
    filters: {
      maxCost?: number;
      minContextWindow?: number;
      requireFunctionCalling?: boolean;
      requireVision?: boolean;
    },
    context: ModelSelectionContext
  ): string[] {
    const providers = this.config.models?.providers ?? {};

    return candidates.filter((modelRef) => {
      const [providerId, modelId] = modelRef.split('/');
      const provider = providers[providerId];
      const model = provider?.models.find((m) => m.id === modelId);

      if (!model) return false;

      // 成本过滤
      if (filters.maxCost !== undefined && model.cost) {
        const avgCost = (model.cost.input + model.cost.output) / 2;
        if (avgCost > filters.maxCost) return false;
      }

      // 上下文窗口过滤
      if (filters.minContextWindow !== undefined && model.contextWindow) {
        if (model.contextWindow < filters.minContextWindow) return false;
      }

      // Function calling 要求
      if (filters.requireFunctionCalling && !model.functionCalling) {
        return false;
      }

      // Vision 要求
      if (filters.requireVision && !model.vision) {
        return false;
      }

      // Context 中的要求
      if (context.requireVision && !model.vision) {
        return false;
      }

      if (context.requireFunctionCalling && !model.functionCalling) {
        return false;
      }

      return true;
    });
  }

  /**
   * 获取组的所有候选模型（用于故障转移）
   */
  getGroupCandidates(groupName: string): string[] {
    const group = this.config.models?.groups?.[groupName];
    return group?.models ?? [];
  }

  /**
   * 更新配置（热重载）
   */
  updateConfig(config: CoobeeConfig): void {
    this.config = config;
  }
}
```

---

#### 3.3.2 增强 ModelSelector

```typescript
// src/main/ai/provider/ModelSelector.ts（修改）

import { ModelGroupResolver } from './ModelGroupResolver';
import type { ModelSelectionContext } from './ModelGroupResolver';

export class ModelSelector {
  private sessionOverrides = new Map<string, string>();
  private agentOverrides = new Map<string, string>();
  private fallbackDefault = 'openai/gpt-4o';

  /** 模型组解析器 */
  private groupResolver: ModelGroupResolver;

  constructor(
    private config: CoobeeConfig,
    quotaManager?: QuotaManager
  ) {
    this.groupResolver = new ModelGroupResolver(config, quotaManager);
  }

  updateConfig(config: CoobeeConfig): void {
    this.config = config;
    this.groupResolver.updateConfig(config);
  }

  /**
   * 解析模型（增强版）
   *
   * 支持：
   * - 单个模型（现有）
   * - 模型组引用（新增）
   * - Auto 模式（新增）
   */
  resolve(
    opts: {
      sessionId?: string;
      agentId?: string;
      agentModelRef?: string; // 从 Agent 定义中读取的 model 字段
      context?: Partial<ModelSelectionContext>;
    } = {}
  ): ModelRef {
    let modelRefStr: string | undefined;
    let source = 'builtin';

    // Level 1: 会话覆盖
    if (opts.sessionId) {
      modelRefStr = this.sessionOverrides.get(opts.sessionId);
      if (modelRefStr) {
        source = 'session';
      }
    }

    // Level 2: Agent 运行时覆盖
    if (!modelRefStr && opts.agentId) {
      modelRefStr = this.agentOverrides.get(opts.agentId);
      if (modelRefStr) {
        source = 'agent-runtime';
      }
    }

    // Level 3: Agent 定义中的 model 字段
    if (!modelRefStr && opts.agentModelRef) {
      modelRefStr = opts.agentModelRef;
      source = 'agent-definition';
    }

    // Level 4: 全局默认
    if (!modelRefStr) {
      modelRefStr = this.config.models?.defaults?.model?.primary;
      if (modelRefStr) {
        source = 'global';
      }
    }

    // Level 5: 内置默认
    if (!modelRefStr) {
      modelRefStr = this.fallbackDefault;
      source = 'builtin';
    }

    // 解析模型引用（支持 @group 和 auto）
    const resolvedModelRef = this.groupResolver.resolve(modelRefStr, {
      sessionId: opts.sessionId ?? '',
      agentId: opts.agentId ?? '',
      ...opts.context
    });

    const ref = parseModelRef(resolvedModelRef);
    this.fireModelResolved(opts.sessionId ?? '', ref, source);

    return ref;
  }

  /**
   * 获取模型组的所有候选模型（用于故障转移）
   */
  getGroupCandidates(modelRef: string): string[] | null {
    if (!modelRef.startsWith('@')) {
      return null;
    }

    const groupName = modelRef.slice(1);
    return this.groupResolver.getGroupCandidates(groupName);
  }

  // ... 其他方法保持不变
}
```

---

#### 3.3.3 AgentExecutor 集成（自动重试）

```typescript
// src/main/ai/AgentExecutor.ts（修改 execute 方法）

async execute(req: ExecuteRequest): Promise<ExecutionResult> {
  const { sessionId, message, builder, runtime } = req;

  // ... 现有逻辑

  // 解析模型（支持模型组）
  const agentModelRef = agentDef.model;  // 可能是 "@group" 或 "auto"
  const modelRef = this.providerSystem!.selector.resolve({
    sessionId,
    agentId: agentDef.id,
    agentModelRef
  });

  // 如果是模型组，获取所有候选模型（用于重试）
  const candidates = agentModelRef
    ? this.providerSystem!.selector.getGroupCandidates(agentModelRef)
    : null;

  // 执行 Agent（带重试逻辑）
  let lastError: Error | null = null;
  const triedModels: string[] = [];

  // 如果有候选模型，尝试所有候选
  const modelsToTry = candidates ?? [modelRef];

  for (const tryModelRef of modelsToTry) {
    try {
      // 重新创建 runtime（使用当前模型）
      const currentModelRef = parseModelRef(tryModelRef);
      const tryRuntime = /* 创建 runtime，使用 currentModelRef */;

      // 执行
      const result = await tryRuntime.run(message, context);

      // 成功 → 返回结果
      log.info(`[AgentExecutor] Model ${tryModelRef} succeeded`);
      return result;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      triedModels.push(tryModelRef);

      log.warn(`[AgentExecutor] Model ${tryModelRef} failed: ${lastError.message}`);

      // 如果是配额错误 / 超时 / API 故障，尝试下一个
      if (this.shouldRetryWithNextModel(lastError) && triedModels.length < modelsToTry.length) {
        log.info(`[AgentExecutor] Retrying with next model in group...`);
        continue;
      }

      // 其他错误 → 立即失败
      throw lastError;
    }
  }

  // 所有模型都失败了
  throw new Error(
    `All models in group failed. Tried: ${triedModels.join(', ')}. Last error: ${lastError?.message}`
  );
}

/**
 * 判断是否应该重试下一个模型
 */
private shouldRetryWithNextModel(error: Error): boolean {
  const message = error.message.toLowerCase();

  // 配额错误
  if (message.includes('quota') || message.includes('rate limit')) {
    return true;
  }

  // 超时
  if (message.includes('timeout')) {
    return true;
  }

  // API 故障
  if (message.includes('503') || message.includes('502')) {
    return true;
  }

  // 其他错误（如 400 参数错误）→ 不重试
  return false;
}
```

---

## 四、前端 UI 设计

### 4.1 Agent 创建/编辑界面

#### 模型选择器增强

```vue
<!-- src/renderer/src/components/agent/ModelSelector.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAgentsStore } from '@/stores/agents';

const agentsStore = useAgentsStore();

const modelMode = ref<'single' | 'group' | 'auto'>('single');
const selectedModel = ref<string>('');
const selectedGroup = ref<string>('');

// 获取可用的模型组
const modelGroups = computed(() => {
  // 从后端配置读取
  return agentsStore.modelGroups ?? [];
});

// 获取可用的单个模型
const availableModels = computed(() => {
  return agentsStore.availableModels ?? [];
});

function handleModeChange(mode: 'single' | 'group' | 'auto') {
  modelMode.value = mode;

  if (mode === 'auto') {
    emit('update:model', 'auto');
  }
}

function handleModelSelect(model: string) {
  selectedModel.value = model;
  emit('update:model', model);
}

function handleGroupSelect(group: string) {
  selectedGroup.value = group;
  emit('update:model', `@${group}`);
}

const emit = defineEmits<{
  'update:model': [value: string];
}>();
</script>

<template>
  <div class="model-selector">
    <div class="mode-tabs">
      <button :class="{ active: modelMode === 'single' }" @click="handleModeChange('single')"> 单个模型 </button>
      <button :class="{ active: modelMode === 'group' }" @click="handleModeChange('group')"> 模型组 </button>
      <button :class="{ active: modelMode === 'auto' }" @click="handleModeChange('auto')"> 自动选择 </button>
    </div>

    <!-- 单个模型选择 -->
    <div v-if="modelMode === 'single'" class="model-list">
      <div
        v-for="model in availableModels"
        :key="model.id"
        :class="{ selected: selectedModel === model.id }"
        class="model-item"
        @click="handleModelSelect(model.id)">
        <span class="model-name">{{ model.name }}</span>
        <span class="model-cost">${{ model.cost }}/1M tokens</span>
      </div>
    </div>

    <!-- 模型组选择 -->
    <div v-if="modelMode === 'group'" class="group-list">
      <div
        v-for="group in modelGroups"
        :key="group.name"
        :class="{ selected: selectedGroup === group.name }"
        class="group-item"
        @click="handleGroupSelect(group.name)">
        <div class="group-header">
          <span class="group-name">{{ group.displayName }}</span>
          <span class="group-strategy">{{ group.strategy }}</span>
        </div>
        <div class="group-models">
          <span v-for="model in group.models" :key="model" class="model-tag">
            {{ model }}
          </span>
        </div>
      </div>
    </div>

    <!-- Auto 模式说明 -->
    <div v-if="modelMode === 'auto'" class="auto-mode-info">
      <p>系统将根据以下条件自动选择最佳模型：</p>
      <ul>
        <li>✅ API 配额充足</li>
        <li>✅ 满足任务要求（Function Calling / Vision）</li>
        <li>✅ 成本优化</li>
        <li>✅ 响应速度快</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.model-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.mode-tabs {
  display: flex;
  gap: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.mode-tabs button {
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-tabs button.active {
  border-bottom: 2px solid #3b82f6;
  color: #3b82f6;
}

.model-item,
.group-item {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.model-item:hover,
.group-item:hover {
  border-color: #3b82f6;
  background: #f0f9ff;
}

.model-item.selected,
.group-item.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.group-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.group-models {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.model-tag {
  padding: 0.25rem 0.5rem;
  background: #e5e7eb;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}

.auto-mode-info {
  padding: 1rem;
  background: #f0f9ff;
  border-radius: 0.5rem;
}

.auto-mode-info ul {
  margin-top: 0.5rem;
  padding-left: 1.5rem;
}
</style>
```

---

### 4.2 运行时监控界面

#### 显示当前使用的模型

```vue
<!-- src/renderer/src/components/agent/RuntimeMonitor.vue -->
<template>
  <div class="runtime-monitor">
    <div class="model-info">
      <span class="label">当前模型:</span>
      <span class="model-name">{{ currentModel }}</span>

      <span v-if="isGroupMode" class="group-badge"> 组: {{ groupName }} </span>

      <span v-if="retryCount > 0" class="retry-badge"> 重试 {{ retryCount }} 次 </span>
    </div>

    <!-- 模型切换历史 -->
    <div v-if="modelHistory.length > 1" class="model-history">
      <details>
        <summary>模型切换历史</summary>
        <ul>
          <li v-for="(item, idx) in modelHistory" :key="idx">
            <span class="timestamp">{{ item.timestamp }}</span>
            <span class="model">{{ item.model }}</span>
            <span v-if="item.failed" class="failed-badge">失败</span>
            <span v-else class="success-badge">成功</span>
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  currentModel: string;
  groupName?: string;
  modelHistory: Array<{
    timestamp: string;
    model: string;
    failed: boolean;
  }>;
}>();

const isGroupMode = computed(() => !!props.groupName);
const retryCount = computed(() => props.modelHistory.filter((h) => h.failed).length);
</script>

<style scoped>
/* ... styles ... */
</style>
```

---

## 五、实施计划

### Phase 1: 基础架构（2-3 天）

- [ ] 扩展配置 Schema（models.groups, models.auto）
- [ ] 实现 ModelGroupResolver
- [ ] 增强 ModelSelector（集成 ModelGroupResolver）
- [ ] 单元测试

### Phase 2: Agent 集成（1-2 天）

- [ ] Agent 定义支持 @group 和 auto 格式
- [ ] AgentExecutor 集成（自动重试逻辑）
- [ ] 集成测试

### Phase 3: 前端 UI（1-2 天）

- [ ] ModelSelector 组件（支持三种模式）
- [ ] RuntimeMonitor 组件（显示当前模型）
- [ ] 配置管理 UI（models.groups 管理）

### Phase 4: 配额集成（可选，1 天）

- [ ] 与 QuotaManager 集成
- [ ] quota-aware 策略实现
- [ ] 配额监控 UI

---

## 六、测试用例

### 6.1 模型组解析测试

```typescript
describe('ModelGroupResolver', () => {
  it('should resolve round-robin correctly', () => {
    const resolver = new ModelGroupResolver(config);

    const model1 = resolver.resolve('@high-performance', context);
    const model2 = resolver.resolve('@high-performance', context);
    const model3 = resolver.resolve('@high-performance', context);

    expect(model1).not.toBe(model2);
    expect(model2).not.toBe(model3);
    expect(model3).toBe(model1); // 轮回到第一个
  });

  it('should fallback to next model on failure', () => {
    const context = {
      sessionId: 'test',
      agentId: 'test',
      previousFailures: ['openai/gpt-4o']
    };

    const model = resolver.resolve('@fallback-chain', context);

    expect(model).toBe('anthropic/claude-3-5-sonnet-20241022'); // 跳过失败的
  });

  it('should respect auto mode filters', () => {
    const context = {
      sessionId: 'test',
      agentId: 'test',
      requireVision: true
    };

    const model = resolver.resolve('auto', context);

    // 应该返回支持 vision 的模型
    expect(model).toMatch(/gpt-4o|claude-3-5-sonnet|gemini/);
  });
});
```

---

## 七、兼容性与迁移

### 7.1 向后兼容

- ✅ 现有 Agent 定义保持不变（`model: "openai/gpt-4o"` 仍然有效）
- ✅ 现有 ModelSelector API 保持不变
- ✅ 新功能为可选（不配置 models.groups 时，行为与之前一致）

### 7.2 迁移路径

1. **配置迁移**：添加 `models.groups` 和 `models.auto` 配置
2. **Agent 迁移**：逐步将 Agent 的 `model` 字段改为 `@group` 或 `auto`
3. **测试验证**：确保新旧格式都能正常工作

---

## 八、总结

### 优势

- ✅ **灵活性**：支持单模型、模型组、自动选择三种模式
- ✅ **容错性**：自动故障转移，提高系统稳定性
- ✅ **成本优化**：优先使用经济模型，配额不足时切换
- ✅ **负载均衡**：分散请求到多个模型，避免单点配额耗尽
- ✅ **向后兼容**：不影响现有 Agent 配置

### 风险

- ⚠️ **复杂度增加**：增加了配置复杂度
- ⚠️ **调试困难**：模型自动切换可能导致行为不一致
- ⚠️ **成本难预测**：auto 模式可能选择昂贵模型

### 建议

- 🔧 **先实现基础功能**（模型组 + round-robin）
- 🔧 **逐步添加高级功能**（quota-aware + auto 模式）
- 🔧 **提供详细日志**（记录模型选择过程，方便调试）
- 🔧 **UI 可视化**（显示当前使用的模型，增加透明度）

---

**下一步**：明天开始实施 Phase 1（基础架构）？ 🚀
