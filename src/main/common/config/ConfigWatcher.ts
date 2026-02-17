/**
 * 配置文件监听器
 *
 * 使用 chokidar 监听配置文件变更，自动 diff 并触发回调。
 */
import { watch, type FSWatcher } from 'chokidar'

import { log } from '@main/common/logger'
import { SkillManager } from '@main/ai/skills/SkillManager'
import { ConfigLoader } from './ConfigLoader'
import { buildReloadPlan, diffConfigPaths } from './ConfigDiff'
import type { ReloadPlan } from './types'

/** 默认去抖时间 */
const DEFAULT_DEBOUNCE_MS = 300

export class ConfigWatcher {
  private watcher: FSWatcher | null = null
  private handlers: Array<(plan: ReloadPlan) => void> = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number
  private lastHash: string | null = null
  private lastConfig: unknown = null

  constructor(
    private loader: ConfigLoader,
    opts?: { debounceMs?: number }
  ) {
    this.debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  /**
   * 启动监听
   */
  start(): void {
    if (this.watcher) return

    // 记录当前状态
    const snap = this.loader.snapshot()
    this.lastHash = snap.hash
    this.lastConfig = snap.config

    // 同时监听 coobee.json5、secrets.json5 和 skills.json5
    const watchPaths = [
      this.loader.configPath,
      this.loader.secretsFilePath,
      this.loader.skillConfigFilePath
    ]
    this.watcher = watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    })

    this.watcher.on('change', () => this.onFileChange())
    this.watcher.on('add', () => this.onFileChange())
    this.watcher.on('unlink', (filePath: string) => this.onFileDeleted(filePath))
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * 注册变更回调
   */
  onReload(handler: (plan: ReloadPlan) => void): void {
    this.handlers.push(handler)
  }

  /**
   * 移除变更回调
   */
  offReload(handler: (plan: ReloadPlan) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler)
  }

  /** 是否正在监听 */
  get isWatching(): boolean {
    return this.watcher !== null
  }

  // ─── 私有方法 ─────────────────────────────────────

  private onFileDeleted(filePath: string): void {
    log.warn(`[ConfigWatcher] 配置文件被删除: ${filePath}，尝试自动重建`)
    try {
      this.loader.ensureConfigFile()
      log.info('[ConfigWatcher] 配置文件已自动重建为默认配置')
    } catch (err) {
      log.error('[ConfigWatcher] 自动重建配置文件失败:', err)
    }
    // 重建后触发一次正常的变更处理流程
    this.onFileChange()
  }

  private onFileChange(): void {
    // 去抖
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.processChange()
    }, this.debounceMs)
  }

  private processChange(): void {
    this.debounceTimer = null

    // 保存旧配置
    const prevConfig = this.lastConfig

    // 清除缓存，重新读取
    this.loader.clearCache()
    SkillManager.invalidateCache() // skills.json5 变更时重新加载配置状态
    const nextSnap = this.loader.snapshot()

    // 如果 hash 没变，跳过
    if (nextSnap.hash === this.lastHash) return

    // 如果新配置无效，只更新 hash（避免重复处理），不更新 lastConfig
    if (!nextSnap.valid) {
      this.lastHash = nextSnap.hash
      log.warn('[ConfigWatcher] 配置校验失败，保留上次有效配置', nextSnap.issues)
      return
    }

    this.lastHash = nextSnap.hash
    this.lastConfig = nextSnap.config

    // Diff
    const changedPaths = diffConfigPaths(prevConfig, nextSnap.config)
    if (changedPaths.length === 0) return

    // 生成重载计划
    const plan = buildReloadPlan(changedPaths)

    // 触发回调
    log.info(`[ConfigWatcher] 配置变更，触发重载: ${changedPaths.join(', ')}`)

    for (const handler of this.handlers) {
      try {
        handler(plan)
      } catch (err) {
        log.warn('[ConfigWatcher] Reload handler error:', err)
      }
    }
  }
}
