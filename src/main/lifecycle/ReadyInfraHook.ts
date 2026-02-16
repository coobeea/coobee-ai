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

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

export const ReadyInfraHook: LifecycleHook = {
  name: 'ready-infra',
  phase: LifecyclePhase.READY,
  priority: 55,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyInfraHook] Initializing infrastructure systems...')

    try {
      // ── Step 1: ConfigStore ──────────────────────────
      const { Env } = await import('@main/common/env')
      const { ConfigLoader } = await import('@main/common/config/ConfigLoader')
      const { ConfigStore, setConfigStoreInstance } =
        await import('@main/common/config/ConfigStore')
      const { ConfigWatcher } = await import('@main/common/config/ConfigWatcher')

      const configDir = Env.paths.configDir
      const loader = new ConfigLoader(configDir)

      // 确保配置文件存在
      loader.ensureConfigFile()

      const store = new ConfigStore(loader)
      setConfigStoreInstance(store)

      const config = loader.load()
      log.info(`[ReadyInfraHook] ConfigStore initialized — path: ${loader.configPath}`)

      // 启动配置热重载
      const watcher = new ConfigWatcher(loader)
      watcher.start()
      log.info('[ReadyInfraHook] ConfigWatcher started')

      // ── Step 2: ProviderSystem ───────────────────────
      const { ProviderRegistry } = await import('@main/ai/provider/ProviderRegistry')
      const { ModelSelector } = await import('@main/ai/provider/ModelSelector')
      const { agentExecutor } = await import('@main/ai/AgentExecutor')

      const registry = new ProviderRegistry()
      registry.loadFromConfig(config)

      const selector = new ModelSelector(config)
      agentExecutor.setProviderSystem({ registry, selector })

      const enabledCount = registry.getEnabled().length
      log.info(`[ReadyInfraHook] ProviderSystem initialized — ${enabledCount} providers enabled`)

      // 热重载时更新 Provider 和 Selector
      watcher.onReload((_plan) => {
        try {
          const freshConfig = loader.load()
          registry.clear()
          registry.loadFromConfig(freshConfig)
          selector.updateConfig(freshConfig)
          log.info('[ReadyInfraHook] Provider/Selector hot-reloaded')
        } catch (err) {
          log.error('[ReadyInfraHook] Provider hot-reload failed:', err)
        }
      })

      // ── Step 3: MessagePipeline ──────────────────────
      const queueConfig = config.messages?.queue
      const pipelineSettings = queueConfig
        ? {
            mode: queueConfig.mode as 'followup' | 'steer' | 'collect' | 'interrupt',
            cap: queueConfig.cap,
            dropPolicy: queueConfig.dropPolicy as 'old' | 'new' | 'summarize'
          }
        : undefined

      agentExecutor.initPipeline(pipelineSettings)
      log.info(
        `[ReadyInfraHook] MessagePipeline initialized — mode: ${pipelineSettings?.mode ?? 'followup'}`
      )

      log.info('[ReadyInfraHook] All infrastructure systems initialized successfully')
    } catch (error) {
      log.error('[ReadyInfraHook] Infrastructure initialization failed:', error)
    }
  }
}
