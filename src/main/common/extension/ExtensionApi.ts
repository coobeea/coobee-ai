/**
 * ExtensionApi 工厂
 *
 * 为每个 Extension 构建独立的 api 对象，供 register() 调用。
 * 包含 services 属性提供解耦的系统服务访问。
 */

import { ExtensionRegistry } from './ExtensionRegistry';
import { ChannelManager } from '../../channels/ChannelManager';
import type { ChannelPlugin } from '../../channels/types';
import type {
  ExtensionApi,
  ExtensionOrigin,
  ExtensionLogger,
  ExtensionServices,
  ExtensionEventBus,
  ExtensionHookName,
  ExtensionHookHandler,
  CronJobConfig
} from './types';

/**
 * 创建 Extension 专属日志器
 */
function createExtensionLogger(extensionId: string): ExtensionLogger {
  const prefix = `[Extension:${extensionId}]`;
  // 使用 console.log 输出，这些日志会出现在 stdout 中
  // 如果需要写入日志文件，需要在应用层面捕获 console 输出
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args)
  };
}

/**
 * 验证 ChannelPlugin
 */
function validateChannelPlugin(plugin: ChannelPlugin): void {
  // 1. 检查必填字段
  if (!plugin.id || typeof plugin.id !== 'string') {
    throw new Error('ChannelPlugin.id is required and must be a string');
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error('ChannelPlugin.name is required and must be a string');
  }

  // 2. 检查 lifecycle
  if (!plugin.lifecycle) {
    throw new Error(`ChannelPlugin "${plugin.id}" must have lifecycle hooks`);
  }

  if (typeof plugin.lifecycle.start !== 'function') {
    throw new Error(`ChannelPlugin "${plugin.id}" must implement lifecycle.start()`);
  }

  if (typeof plugin.lifecycle.stop !== 'function') {
    throw new Error(`ChannelPlugin "${plugin.id}" must implement lifecycle.stop()`);
  }

  // 3. 检查 ID 格式
  if (!/^[a-z0-9-]+$/.test(plugin.id)) {
    throw new Error(`ChannelPlugin ID "${plugin.id}" is invalid. Use lowercase letters, numbers, and hyphens only.`);
  }
}

/**
 * 为单个 Extension 构建 ExtensionApi
 */
export function createExtensionApi(
  extensionId: string,
  name: string,
  origin: ExtensionOrigin,
  registry: ExtensionRegistry,
  bus?: ExtensionEventBus
): ExtensionApi {
  return {
    id: extensionId,
    name,
    origin,
    logger: createExtensionLogger(extensionId),
    services: createExtensionServices(),
    eventBus: bus || createEventBusWrapper(null),
    registerTool(tool) {
      registry.registerTool(extensionId, tool);
    },
    on<K extends ExtensionHookName>(hookName: K, handler: ExtensionHookHandler<K>, opts?: { priority?: number }) {
      registry.registerHook<K>({
        extensionId,
        hookName,
        handler,
        priority: opts?.priority ?? 0
      });
    },
    registerGatewayMethod(method, handler) {
      registry.registerGatewayMethod(extensionId, method, handler);
    },
    registerChannel(config) {
      registry.registerChannel(extensionId, config);
    },
    async registerChannelPlugin(plugin) {
      // 1. 验证 Plugin
      validateChannelPlugin(plugin);

      // 2. 注册到 ExtensionRegistry
      registry.registerChannelPlugin(extensionId, plugin);

      // 3. 注册到 ChannelManager
      try {
        const channelManager = ChannelManager.getInstance();
        channelManager.registerChannelPlugin(plugin);
      } catch (err) {
        console.error(`[ExtensionApi] Failed to register ChannelPlugin "${plugin.id}":`, err);
        throw err;
      }
    },
    registerHttpRoute(config) {
      registry.registerHttpRoute(extensionId, config);
    },
    registerService(service) {
      registry.registerService(extensionId, service);
    },
    registerCronJob(config: CronJobConfig) {
      registry.registerCronJob(extensionId, config);
    }
  };
}

/**
 * 创建 Extension EventBus 包装器
 *
 * 将系统 EventBus 包装为 ExtensionEventBus 接口。
 * 由 ReadyExtensionHook 在 app 就绪后导入并传递。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEventBusWrapper(bus: any): ExtensionEventBus {
  if (!bus) {
    // Fallback：如果未提供 eventBus，返回 no-op 实现
    return {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      emit() {}
    };
  }

  return {
    on(event, handler) {
      bus.on(event, handler);
    },
    off(event, handler) {
      bus.off(event, handler);
    },
    emit(event, data) {
      bus.emit(event, data);
    }
  };
}

/**
 * 创建 Extension 服务集合
 *
 * 通过懒加载（dynamic import）访问核心模块，
 * 避免在 Extension 系统初始化时产生循环依赖。
 *
 * **设计原则**：
 * - ExtensionApi 在主进程代码中定义，所有动态导入在主进程上下文中执行
 * - Extension 禁止直接 import src/main/ 模块，统一通过 api.services.xxx() 获取
 * - 彻底解决 jiti 嵌套导入导致的 app 对象 undefined 问题
 */
function createExtensionServices(): ExtensionServices {
  return {
    hitl: {
      async waitForSingleDecision(approvalId, timeoutMs) {
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager');
        return hitlApprovalManager.waitForSingleDecision(approvalId, timeoutMs);
      },
      submitSingleDecision(approvalId, decision) {
        // 同步版本 — 需要 top-level await 或者调用方已确保模块加载
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { hitlApprovalManager } = require('../../ai/hitl/HitlApprovalManager');
        return hitlApprovalManager.submitSingleDecision(approvalId, decision);
      },
      async cleanupSession(sessionId) {
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager');
        hitlApprovalManager.cleanupSession(sessionId);
      }
    },
    events: {
      emit(sessionId, chunk) {
        // 统一分发：写文件 + 推前端（通过 AgentEventWriter.dispatch）
        // 不再需要手动同时调用 StreamEmitter 和 EventWriter
        import('../../ai/AgentEventWriter')
          .then(({ AgentEventWriter }) => {
            AgentEventWriter.dispatchForSession(sessionId, chunk as never);
          })
          .catch(() => {
            // 分发失败不阻断
          });
      }
    },
    paths: {
      async getWorkspace(sessionId) {
        const { Env } = await import('../../common/env');
        return Env.getAgentWorkspaceDir(sessionId);
      },
      async getAgentHome(agentId) {
        const { Env } = await import('../../common/env');
        return Env.getAgentHomeDir(agentId);
      },
      async getUserHome() {
        const { Env } = await import('../../common/env');
        return Env.paths.userHome;
      },
      async getDataDir(extensionId) {
        const { Env } = await import('../../common/env');
        const path = await import('node:path');
        // 扩展数据目录：~/.coobee-ai/extensions/{extensionId}/data/
        const dataDir = path.default.join(Env.paths.userHome, 'extensions', extensionId, 'data');
        const fs = await import('node:fs');
        if (!fs.default.existsSync(dataDir)) {
          fs.default.mkdirSync(dataDir, { recursive: true });
        }
        return dataDir;
      },
      async getConfigDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.configDir;
      },
      async getSecretsDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.secretsDir;
      },
      async getWorkspacesDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.workspacesDir;
      }
    },
    llm: {
      async chat(messages) {
        const { agentExecutor } = await import('../../ai/AgentExecutor');
        const llmChatMod = await import('../../ai/quality-loop/llm-chat');
        const llmChat = llmChatMod.createLLMChat(
          agentExecutor as unknown as Parameters<typeof llmChatMod.createLLMChat>[0]
        );
        return llmChat({ messages });
      },
      async runAgent(agentId, message) {
        const { agentExecutor } = await import('../../ai/AgentExecutor');
        const { AgentStore } = await import('../../ai/agents/AgentStore');
        const { generateSnowflakeId } = await import('../../utils/SnowflakeIdGenerator');

        const store = await AgentStore.getInstance();
        const agentDef = await store.get(agentId);
        if (!agentDef) {
          throw new Error(`Agent "${agentId}" not found`);
        }

        const sessionId = `ext-agent-${agentId}-${generateSnowflakeId()}`;
        const builder = agentExecutor
          .piMono()
          .lightweight(true)
          .mode('chat')
          .name(agentId)
          .sessionMode('memory')
          .maxTurns(1);

        if (agentDef.instructions) {
          builder.instructions(agentDef.instructions);
        }

        let output = '';
        const gen = agentExecutor.stream({ sessionId, message, builder });
        for await (const chunk of gen) {
          if (chunk.type === 'text:delta' && chunk.content) {
            output += chunk.content;
          }
        }
        return output;
      },
      async embed(texts, options) {
        const { configStoreInstance } = await import('../config/ConfigStore');

        // 从配置中获取 embedding 配置
        const config = configStoreInstance?.getAll?.() || {};
        const embeddingConfig = resolveEmbeddingConfigForApi(config, options?.model);

        if (!embeddingConfig) {
          throw new Error(
            'No embedding model configured. Please set models.defaults.embedding.primary in coobee.json5'
          );
        }

        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({
          apiKey: embeddingConfig.apiKey,
          baseURL: embeddingConfig.baseURL
        });

        const response = await client.embeddings.create({
          model: embeddingConfig.model,
          input: texts
        });

        return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }
    },
    // 🆕 Agent 相关服务
    agent: {
      async getExecutor() {
        const { agentExecutor } = await import('../../ai/AgentExecutor');
        return agentExecutor;
      },
      async getStore() {
        const { AgentStore } = await import('../../ai/agents/AgentStore');
        return AgentStore.getInstance();
      },
      async getBuiltinTools() {
        const { builtinTools } = await import('../../ai/tools');
        return builtinTools;
      },
      async getToolRegistry() {
        const { ToolRegistry } = await import('../../ai/tools/registry');
        return ToolRegistry.getInstance();
      },
      async getSkillManager() {
        const { SkillManager } = await import('../../ai/skills');
        return new SkillManager();
      }
    },
    // 🆕 Thread 相关服务
    thread: {
      async getStore() {
        const { ThreadStore } = await import('../../ai/threads/ThreadStore');
        return ThreadStore.getInstance();
      }
    },
    // 🆕 Channel 相关服务
    channel: {
      async getRuntime() {
        const { ChannelRuntime } = await import('../../channels/ChannelRuntime');
        return ChannelRuntime.getInstance();
      }
    },
    // 🆕 Discussion 相关服务
    discussion: {
      async getStore() {
        const { DiscussionStore } = await import('../../ai/discussion/DiscussionStore');
        return DiscussionStore.getInstance();
      },
      async createConsensusDetector() {
        const { ConsensusDetector } = await import('../../ai/discussion/ConsensusDetector');
        return new ConsensusDetector();
      }
    },
    // 🆕 类型定义服务
    types: {
      async getStreamEventType() {
        const { StreamEventType } = await import('../../ai/streaming/types');
        return StreamEventType;
      }
    }
  };
}

/**
 * 从配置中解析可用于 embedding 的 provider（供 ExtensionApi 使用）
 *
 * @param config 完整配置对象
 * @param modelOverride 可选的模型覆盖（如 'dashscope/text-embedding-v3'）
 */
function resolveEmbeddingConfigForApi(
  config: Record<string, unknown>,
  modelOverride?: string
): { apiKey: string; baseURL?: string; model: string } | undefined {
  const models = config.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
  const defaults = models?.defaults as Record<string, unknown> | undefined;

  if (!providers) return undefined;

  // 1. 确定目标模型引用（优先使用 override，否则用配置的默认值）
  let modelRef: string | undefined = modelOverride;

  if (!modelRef) {
    const embeddingDefaults = defaults?.embedding as Record<string, unknown> | undefined;
    modelRef = embeddingDefaults?.primary as string | undefined;
  }

  if (!modelRef || typeof modelRef !== 'string') {
    return undefined;
  }

  // 2. 解析 provider/model 引用（格式：'provider/model' 或 'model'）
  const parts = modelRef.split('/');
  let providerId: string;
  let modelId: string;

  if (parts.length === 2) {
    [providerId, modelId] = parts;
  } else {
    // 只有 modelId，尝试从所有 provider 中查找
    modelId = modelRef;
    const found = Object.entries(providers).find(([_, p]) => {
      const providerModels = (p as Record<string, unknown>).models as Array<Record<string, unknown>> | undefined;
      return providerModels?.some((m) => m.id === modelId && m.supportsEmbedding === true);
    });

    if (!found) return undefined;
    providerId = found[0];
  }

  // 3. 获取 provider 信息
  const provider = providers[providerId] as Record<string, unknown> | undefined;
  if (!provider || provider.enabled === false) {
    return undefined;
  }

  const apiKey = provider.apiKey as string | undefined;
  const baseURL = provider.baseUrl as string | undefined;

  if (!apiKey || apiKey.length === 0 || apiKey.startsWith('${')) {
    return undefined;
  }

  // 4. 验证模型支持 embedding
  const providerModels = provider.models as Array<Record<string, unknown>> | undefined;
  const model = providerModels?.find((m) => m.id === modelId);

  if (!model || model.supportsEmbedding !== true) {
    return undefined;
  }

  return {
    apiKey,
    baseURL,
    model: modelId
  };
}
