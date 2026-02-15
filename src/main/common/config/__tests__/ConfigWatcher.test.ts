import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigLoader } from '../ConfigLoader'
import { ConfigWatcher } from '../ConfigWatcher'
import type { ReloadPlan } from '../types'

describe('ConfigWatcher', () => {
  let tmpDir: string
  let loader: ConfigLoader
  let watcher: ConfigWatcher

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-watcher-test-'))
    loader = new ConfigLoader(tmpDir)
    // 创建初始配置文件
    loader.ensureConfigFile()
    watcher = new ConfigWatcher(loader, { debounceMs: 50 })
  })

  afterEach(() => {
    watcher.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should start and stop watching', () => {
    expect(watcher.isWatching).toBe(false)
    watcher.start()
    expect(watcher.isWatching).toBe(true)
    watcher.stop()
    expect(watcher.isWatching).toBe(false)
  })

  it('should not start twice', () => {
    watcher.start()
    watcher.start() // no-op
    expect(watcher.isWatching).toBe(true)
    watcher.stop()
  })

  it('should detect file changes and trigger callback', async () => {
    const plans: ReloadPlan[] = []
    watcher.onReload((plan) => plans.push(plan))
    watcher.start()

    // 等 chokidar 初始化
    await sleep(200)

    // 修改文件
    const newConfig = JSON.stringify(
      { ui: { theme: 'dark', language: 'zh-CN', soundEffects: true } },
      null,
      2
    )
    fs.writeFileSync(path.join(tmpDir, 'coobee.json5'), newConfig)

    // 等待 debounce + 处理
    await sleep(500)

    expect(plans.length).toBeGreaterThanOrEqual(1)
    const plan = plans[0]
    expect(plan.changedPaths.length).toBeGreaterThan(0)
  })

  it('should register and unregister handlers', () => {
    const handler = vi.fn()
    watcher.onReload(handler)
    watcher.offReload(handler)
    // 不应再调用
    expect(handler).not.toHaveBeenCalled()
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
