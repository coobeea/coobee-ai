/**
 * Extension 加载器
 *
 * 职责：
 *   - 扫描多级目录，发现并加载所有 Extension
 *   - 使用 jiti 运行时编译 .ts / .js 模块
 *   - fs.watch 监听目录变化，实现热插拔（300ms 防抖）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
import { ExtensionRegistry } from './ExtensionRegistry'
import { createExtensionApi } from './ExtensionApi'
import type { ExtensionManifest, ExtensionModule, ExtensionOrigin } from './types'

const jiti = createJiti(import.meta.url)

/** 防抖延迟（ms） */
const DEBOUNCE_MS = 300

export class ExtensionLoader {
  /** extensionId → 已加载的 Extension 目录路径 */
  private loadedExtensions = new Map<string, string>()
  /** fs.watch 返回的 watcher 列表 */
  private watchers: fs.FSWatcher[] = []
  /** 防抖定时器 */
  private debounceTimers = new Map<string, NodeJS.Timeout>()

  constructor(private registry: ExtensionRegistry) {}

  /**
   * 扫描多级目录，加载所有 Extension
   * 搜索路径优先级从低到高，同 ID 高优先级覆盖低优先级
   */
  async loadAll(searchPaths: string[]): Promise<void> {
    const origins: ExtensionOrigin[] = ['builtin', 'user', 'workspace']

    for (let i = 0; i < searchPaths.length; i++) {
      const searchPath = searchPaths[i]
      const origin = origins[i] ?? 'workspace'

      if (!fs.existsSync(searchPath)) continue

      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(searchPath, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const extDir = path.join(searchPath, entry.name)
        await this.load(extDir, origin)
      }
    }
  }

  /**
   * 加载单个 Extension
   */
  async load(dir: string, origin: ExtensionOrigin): Promise<void> {
    const manifestPath = path.join(dir, 'extension.json')

    // 读取清单
    if (!fs.existsSync(manifestPath)) {
      console.warn(`[ExtensionLoader] Skipping "${dir}": no extension.json`)
      return
    }

    let manifest: ExtensionManifest
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8')
      manifest = JSON.parse(raw) as ExtensionManifest
    } catch (err) {
      console.error(`[ExtensionLoader] Failed to parse extension.json in "${dir}":`, err)
      return
    }

    // Manifest 校验
    const validationError = validateManifest(manifest)
    if (validationError) {
      console.error(`[ExtensionLoader] Invalid manifest in "${dir}": ${validationError}`)
      return
    }

    // 信任模型校验：非 builtin Extension 记录警告
    if (origin !== 'builtin') {
      console.warn(
        `[ExtensionLoader] Loading non-builtin extension "${manifest.id}" (${origin}). ` +
          `Extension code runs in the main process without sandboxing.`
      )
    }

    // 同 ID 覆盖：先卸载旧版
    if (this.loadedExtensions.has(manifest.id)) {
      this.unload(manifest.id)
    }

    // 注册扩展贡献的 Skill 目录（声明式，无需代码入口）
    if (manifest.skills) {
      const skillDir = path.resolve(dir, manifest.skills)
      if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
        this.registry.registerSkillDir(manifest.id, skillDir)
        console.log(`[ExtensionLoader] Registered skill dir for "${manifest.id}": ${skillDir}`)
      } else {
        console.warn(
          `[ExtensionLoader] Skill dir declared but not found for "${manifest.id}": ${skillDir}`
        )
      }
    }

    // 查找入口文件（纯 Skill 扩展可以没有代码入口）
    const entryPath = resolveEntryPath(dir)
    if (entryPath) {
      // jiti 加载模块
      let mod: ExtensionModule
      try {
        const imported = await jiti.import(entryPath)
        mod = ((imported as Record<string, unknown>).default || imported) as ExtensionModule
      } catch (err) {
        console.error(`[ExtensionLoader] Failed to load "${manifest.id}" from "${entryPath}":`, err)
        return
      }

      // 调用 register
      const api = createExtensionApi(manifest.id, manifest.name, origin, this.registry)
      try {
        mod.register(api)
      } catch (err) {
        console.error(`[ExtensionLoader] register() failed for "${manifest.id}":`, err)
        // 注册失败，清理已注册的内容
        this.registry.unregisterAll(manifest.id)
        return
      }
    } else if (!manifest.skills) {
      // 既没有代码入口，也没有 Skill 声明 → 无效扩展
      console.warn(`[ExtensionLoader] No entry file or skills declaration in "${dir}", skipping`)
      return
    }

    this.loadedExtensions.set(manifest.id, dir)
    console.log(`[ExtensionLoader] Loaded "${manifest.id}" (${origin}) from ${dir}`)
  }

  /**
   * 卸载单个 Extension
   */
  unload(extensionId: string): void {
    this.registry.unregisterAll(extensionId)
    this.loadedExtensions.delete(extensionId)
    console.log(`[ExtensionLoader] Unloaded "${extensionId}"`)
  }

  /**
   * 启动 fs.watch 监听所有搜索路径
   * 只监听一层目录（子目录增删）
   */
  watch(searchPaths: string[]): void {
    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) continue

      try {
        const watcher = fs.watch(searchPath, { persistent: false }, (_eventType, filename) => {
          if (!filename) return
          this.handleWatchEvent(searchPath, filename)
        })
        this.watchers.push(watcher)
      } catch (err) {
        console.error(`[ExtensionLoader] Failed to watch "${searchPath}":`, err)
      }
    }
  }

  /**
   * 停止监听
   */
  stopWatch(): void {
    for (const w of this.watchers) {
      w.close()
    }
    this.watchers = []
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  /**
   * 获取已加载的 Extension ID 列表
   */
  getLoadedIds(): string[] {
    return [...this.loadedExtensions.keys()]
  }

  // ---- 内部方法 ----

  private handleWatchEvent(searchPath: string, filename: string): void {
    const key = `${searchPath}/${filename}`

    // 防抖
    const existing = this.debounceTimers.get(key)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(
      key,
      setTimeout(async () => {
        this.debounceTimers.delete(key)
        const extDir = path.join(searchPath, filename)

        if (fs.existsSync(extDir) && fs.statSync(extDir).isDirectory()) {
          // 新增或修改 → unload + load
          const existingId = this.findExtensionIdByDir(extDir)
          if (existingId) {
            this.unload(existingId)
          }
          // 推断 origin
          const origin = this.inferOrigin(searchPath)
          await this.load(extDir, origin)
        } else {
          // 删除 → unload
          const existingId = this.findExtensionIdByDir(extDir)
          if (existingId) {
            this.unload(existingId)
          }
        }
      }, DEBOUNCE_MS)
    )
  }

  private findExtensionIdByDir(dir: string): string | undefined {
    for (const [id, loadedDir] of this.loadedExtensions) {
      if (loadedDir === dir) return id
    }
    return undefined
  }

  private inferOrigin(_searchPath: string): ExtensionOrigin {
    // 简化：默认 workspace，ReadyExtensionHook 会传入正确的搜索路径顺序
    return 'workspace'
  }
}

/**
 * 查找 Extension 入口文件
 */
function resolveEntryPath(dir: string): string | undefined {
  for (const name of ['index.ts', 'index.js']) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return undefined
}

/**
 * 校验 Extension manifest 的必填字段和格式
 *
 * @returns 校验错误消息，null 表示通过
 */
function validateManifest(manifest: ExtensionManifest): string | null {
  if (!manifest.id || typeof manifest.id !== 'string') {
    return 'Missing or invalid "id" field'
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
    return `Invalid "id" format: "${manifest.id}" (only alphanumeric, - and _ allowed)`
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    return 'Missing or invalid "name" field'
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    return 'Missing or invalid "version" field'
  }
  if (manifest.skills !== undefined && typeof manifest.skills !== 'string') {
    return '"skills" field must be a string (directory path)'
  }
  return null
}
