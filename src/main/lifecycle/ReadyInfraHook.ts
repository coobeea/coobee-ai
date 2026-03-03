/**
 * Infrastructure Hook — 三大基础设施统一初始化
 *
 * 在 READY 阶段统一初始化：
 *   1. ConfigStore — 统一配置系统（coobee.json5）
 *   2. ProviderSystem — 模型 Provider 体系（Registry + Selector）
 *   3. MessagePipeline — 消息管线（排队 / 合并 / 中断）
 *
 * 执行顺序：
 *   ReadyExtensionHook (50) → ReadyInfraHook (55) → ReadyWorkerHook (80)
 *
 * 前置条件：Extension 系统已初始化（钩子依赖 ExtensionManager）
 */

import fs from 'node:fs';
import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

/** 模块级引用，供退出时停止 */
let activeWatcher: { stop(): void } | null = null;

export const ReadyInfraHook: LifecycleHook = {
  name: 'ready-infra',
  phase: LifecyclePhase.READY,
  priority: 55,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyInfraHook] Initializing infrastructure systems...');

    try {
      // ── Step 1: ConfigStore ──────────────────────────
      const { Env } = await import('@main/common/env');
      const { ConfigLoader } = await import('@main/common/config/ConfigLoader');
      const { ConfigStore, setConfigStoreInstance } = await import('@main/common/config/ConfigStore');
      const { ConfigWatcher } = await import('@main/common/config/ConfigWatcher');

      const configDir = Env.paths.configDir;
      const secretsDir = Env.paths.secretsDir;
      const loader = new ConfigLoader(configDir, secretsDir);

      // 确保配置文件存在
      loader.ensureConfigFile();

      const store = new ConfigStore(loader);
      setConfigStoreInstance(store);

      const config = loader.load();
      log.info(`[ReadyInfraHook] ConfigStore initialized — path: ${loader.configPath}`);

      // 启动配置热重载
      const watcher = new ConfigWatcher(loader);
      watcher.start();
      activeWatcher = watcher;
      log.info('[ReadyInfraHook] ConfigWatcher started');

      // ── Step 2: ProviderSystem ───────────────────────
      const { ProviderRegistry } = await import('@main/ai/provider/ProviderRegistry');
      const { ModelSelector } = await import('@main/ai/provider/ModelSelector');
      const { agentExecutor } = await import('@main/ai/AgentExecutor');

      const registry = new ProviderRegistry();
      registry.loadFromConfig(config);

      const selector = new ModelSelector(config);
      agentExecutor.setProviderSystem({ registry, selector });

      const enabledCount = registry.getEnabled().length;
      log.info(`[ReadyInfraHook] ProviderSystem initialized — ${enabledCount} providers enabled`);

      // 热重载时更新 Provider 和 Selector
      watcher.onReload((_plan) => {
        try {
          const freshConfig = loader.load();
          registry.clear();
          registry.loadFromConfig(freshConfig);
          selector.updateConfig(freshConfig);
          log.info('[ReadyInfraHook] Provider/Selector hot-reloaded');
        } catch (err) {
          log.error('[ReadyInfraHook] Provider hot-reload failed:', err);
        }
      });

      // ── Step 3: MessagePipeline ──────────────────────
      const queueConfig = config.messages?.queue;
      const pipelineSettings = queueConfig
        ? {
            mode: queueConfig.mode as 'followup' | 'steer' | 'collect' | 'interrupt',
            cap: queueConfig.cap,
            dropPolicy: queueConfig.dropPolicy as 'old' | 'new' | 'summarize'
          }
        : undefined;

      agentExecutor.initPipeline(pipelineSettings);
      log.info(`[ReadyInfraHook] MessagePipeline initialized — mode: ${pipelineSettings?.mode ?? 'followup'}`);

      // ── Step 4: AGENTS.md 协议文件 ──────────────────
      ensureGlobalAgentsMd(Env.paths.agentsMdPath, Env.app.name, Env.app.version);

      log.info('[ReadyInfraHook] All infrastructure systems initialized successfully');
    } catch (error) {
      log.error('[ReadyInfraHook] Infrastructure initialization failed:', error);
    }
  }
};

/**
 * 确保全局 AGENTS.md 协议文件存在
 *
 * 如果文件不存在，生成包含系统身份信息、全局规则和共享上下文占位的默认模板。
 * 已存在的文件不会被覆盖（用户或智能体可能已经修改过）。
 */
function ensureGlobalAgentsMd(filePath: string, appName: string, appVersion: string): void {
  if (fs.existsSync(filePath)) {
    log.info(`[ReadyInfraHook] AGENTS.md already exists: ${filePath}`);
    return;
  }

  const template = `# System Identity

- **系统名称**: ${appName}
- **版本**: ${appVersion}
- **语言偏好**: 中文

# System Rules

- 使用中文与用户交流（除非用户使用其他语言）
- 尊重用户隐私，不主动泄露敏感信息
- 优先使用已有工具和技能，避免重复造轮子
- 遇到不确定的情况，主动向用户确认而非自行假设
- 输出结果要有可验证性，避免编造信息

# Shared Context

<!-- 智能体运行中可在此区域写入共享上下文 -->
`;

  try {
    fs.writeFileSync(filePath, template, 'utf-8');
    log.info(`[ReadyInfraHook] Created default AGENTS.md: ${filePath}`);
  } catch (err) {
    log.warn(`[ReadyInfraHook] Failed to create AGENTS.md:`, err);
  }
}

/**
 * 退出时停止 ConfigWatcher
 */
export const BeforeQuitInfraHook: LifecycleHook = {
  name: 'before-quit-infra',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 40,
  critical: false,

  async execute(): Promise<void> {
    if (activeWatcher) {
      activeWatcher.stop();
      activeWatcher = null;
      log.info('[BeforeQuitInfraHook] ConfigWatcher stopped');
    }
  }
};
