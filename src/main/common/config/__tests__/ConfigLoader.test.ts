import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConfigLoader } from '../ConfigLoader'

describe('ConfigLoader', () => {
  let tmpDir: string
  let loader: ConfigLoader

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-config-test-'))
    loader = new ConfigLoader(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── 文件不存在 ──────────────────────────────────

  it('should return default config when file does not exist', () => {
    const config = loader.load()
    expect(config).toBeDefined()
    expect(config.ui?.theme).toBe('auto')
    expect(config.logging?.level).toBe('info')
  })

  it('should return snapshot with exists=false when file missing', () => {
    const snap = loader.snapshot()
    expect(snap.exists).toBe(false)
    expect(snap.valid).toBe(true)
    expect(snap.raw).toBeNull()
  })

  // ─── 正常加载 ────────────────────────────────────

  it('should load valid JSON5 config', () => {
    writeConfig({
      ui: { theme: 'dark', language: 'en-US', soundEffects: false },
      logging: { level: 'debug', file: false }
    })

    const config = loader.load()
    expect(config.ui?.theme).toBe('dark')
    expect(config.ui?.language).toBe('en-US')
    expect(config.logging?.level).toBe('debug')
  })

  it('should parse JSON5 comments and trailing commas', () => {
    const json5Content = `{
  // This is a comment
  ui: {
    theme: "light",
    language: "zh-CN",
    soundEffects: true,  // trailing comma
  },
}`
    fs.writeFileSync(path.join(tmpDir, 'coobee.json5'), json5Content)

    const config = loader.load()
    expect(config.ui?.theme).toBe('light')
  })

  // ─── 环境变量替换 ────────────────────────────────

  it('should resolve ${VAR} templates from env', () => {
    const oldEnv = process.env.TEST_API_KEY
    process.env.TEST_API_KEY = 'sk-secret-123'

    try {
      writeConfig({
        models: {
          providers: {
            test: {
              baseUrl: 'https://api.test.com/v1',
              apiKey: '${TEST_API_KEY}',
              api: 'openai-compatible',
              models: [{ id: 'model-1', name: 'Test Model' }]
            }
          }
        }
      })

      const config = loader.load()
      expect(config.models?.providers?.test?.apiKey).toBe('sk-secret-123')
    } finally {
      if (oldEnv === undefined) {
        delete process.env.TEST_API_KEY
      } else {
        process.env.TEST_API_KEY = oldEnv
      }
    }
  })

  it('should keep ${VAR} template when env var is not set', () => {
    writeConfig({
      models: {
        providers: {
          test: {
            baseUrl: 'https://api.test.com/v1',
            apiKey: '${NONEXISTENT_VAR_12345}',
            api: 'openai-compatible',
            models: [{ id: 'model-1', name: 'Test Model' }]
          }
        }
      }
    })

    const config = loader.load()
    expect(config.models?.providers?.test?.apiKey).toBe('${NONEXISTENT_VAR_12345}')
  })

  // ─── 缓存 ───────────────────────────────────────

  it('should cache config after first load', () => {
    writeConfig({ ui: { theme: 'dark' } })
    const config1 = loader.load()

    // 直接修改文件（不调用 clearCache）
    const content = JSON.stringify({ ui: { theme: 'light' } }, null, 2)
    fs.writeFileSync(path.join(tmpDir, 'coobee.json5'), content)
    const config2 = loader.load()

    // 应返回缓存的旧值
    expect(config1.ui?.theme).toBe('dark')
    expect(config2.ui?.theme).toBe('dark')
  })

  it('should reload after clearCache', () => {
    writeConfig({ ui: { theme: 'dark' } })
    loader.load()

    writeConfig({ ui: { theme: 'light' } })
    loader.clearCache()
    const config = loader.load()

    expect(config.ui?.theme).toBe('light')
  })

  // ─── 错误处理 ────────────────────────────────────

  it('should return invalid snapshot for malformed JSON5', () => {
    fs.writeFileSync(path.join(tmpDir, 'coobee.json5'), '{ invalid json5 {{{{')

    const snap = loader.snapshot()
    expect(snap.valid).toBe(false)
    expect(snap.issues.length).toBeGreaterThan(0)
    expect(snap.issues[0].message).toContain('JSON5 parse error')
  })

  it('should return invalid snapshot for schema violations', () => {
    writeConfig({ ui: { theme: 'neon' } })

    const snap = loader.snapshot()
    expect(snap.valid).toBe(false)
    expect(snap.issues.length).toBeGreaterThan(0)
  })

  it('should fall back to defaults when schema validation fails', () => {
    writeConfig({ ui: { theme: 'neon' } })

    const snap = loader.snapshot()
    expect(snap.config.ui?.theme).toBe('auto') // default
  })

  // ─── 快照 hash ──────────────────────────────────

  it('should include hash in snapshot', () => {
    writeConfig({ ui: { theme: 'dark' } })
    const snap = loader.snapshot()
    expect(snap.hash).toBeTruthy()
    expect(typeof snap.hash).toBe('string')
  })

  it('should have different hashes for different content', () => {
    writeConfig({ ui: { theme: 'dark' } })
    const snap1 = loader.snapshot()

    writeConfig({ ui: { theme: 'light' } })
    const snap2 = loader.snapshot()

    expect(snap1.hash).not.toBe(snap2.hash)
  })

  // ─── ensureConfigFile ────────────────────────────

  it('should create config file when not exists', () => {
    const newDir = path.join(tmpDir, 'subdir')
    const newLoader = new ConfigLoader(newDir)

    expect(fs.existsSync(path.join(newDir, 'coobee.json5'))).toBe(false)
    newLoader.ensureConfigFile()
    expect(fs.existsSync(path.join(newDir, 'coobee.json5'))).toBe(true)

    // Created file should be loadable
    const config = newLoader.load()
    expect(config.ui?.theme).toBe('auto')
  })

  // ─── 辅助函数 ────────────────────────────────────

  /** 写入任意 JSON 作为配置（测试用，可为部分对象） */
  function writeConfig(config: Record<string, unknown>): void {
    const content = JSON.stringify(config, null, 2)
    fs.writeFileSync(path.join(tmpDir, 'coobee.json5'), content)
    loader.clearCache()
  }
})
