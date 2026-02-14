import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ExtensionRegistry } from '../ExtensionRegistry'
import { ExtensionLoader } from '../ExtensionLoader'

/** 创建临时目录 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ext-test-'))
}

/** 创建一个有效的 Extension 目录 */
function createValidExtension(baseDir: string, id: string, opts?: { registerFn?: string }): string {
  const extDir = path.join(baseDir, id)
  fs.mkdirSync(extDir, { recursive: true })

  // extension.json
  fs.writeFileSync(
    path.join(extDir, 'extension.json'),
    JSON.stringify({ id, name: `Test ${id}`, version: '1.0.0' })
  )

  // index.ts
  const registerFn =
    opts?.registerFn ??
    `
    module.exports = {
      id: '${id}',
      name: 'Test ${id}',
      register(api) {
        api.on('session_start', async () => {});
      }
    };
  `
  fs.writeFileSync(path.join(extDir, 'index.js'), registerFn)

  return extDir
}

describe('ExtensionLoader', () => {
  let tmpDir: string
  let registry: ExtensionRegistry
  let loader: ExtensionLoader

  beforeEach(() => {
    tmpDir = makeTmpDir()
    registry = new ExtensionRegistry()
    loader = new ExtensionLoader(registry)
  })

  afterEach(() => {
    loader.stopWatch()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadAll 空目录 — 正常返回，无注册', async () => {
    await loader.loadAll([tmpDir])
    expect(registry.getExtensionIds()).toHaveLength(0)
    expect(loader.getLoadedIds()).toHaveLength(0)
  })

  it('loadAll 单个 Extension — 正确加载', async () => {
    createValidExtension(tmpDir, 'ext-hello')

    await loader.loadAll([tmpDir])

    expect(loader.getLoadedIds()).toContain('ext-hello')
    expect(registry.getHooks('session_start')).toHaveLength(1)
  })

  it('loadAll 多目录合并 — 同 ID 高优先级覆盖', async () => {
    const dir1 = path.join(tmpDir, 'builtin')
    const dir2 = path.join(tmpDir, 'user')
    fs.mkdirSync(dir1, { recursive: true })
    fs.mkdirSync(dir2, { recursive: true })

    // builtin 版本注册一个 session_start hook
    createValidExtension(dir1, 'ext-dup')

    // user 版本注册一个 agent_end hook（覆盖 builtin）
    createValidExtension(dir2, 'ext-dup', {
      registerFn: `
        module.exports = {
          id: 'ext-dup',
          name: 'Test ext-dup',
          register(api) {
            api.on('agent_end', async () => {});
          }
        };
      `
    })

    await loader.loadAll([dir1, dir2])

    expect(loader.getLoadedIds()).toContain('ext-dup')
    // builtin 的 session_start 应该被卸载，只剩 user 的 agent_end
    expect(registry.getHooks('session_start')).toHaveLength(0)
    expect(registry.getHooks('agent_end')).toHaveLength(1)
  })

  it('load 无 extension.json — 跳过并 warn', async () => {
    const extDir = path.join(tmpDir, 'no-manifest')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(path.join(extDir, 'index.js'), 'module.exports = {}')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no extension.json'))
    warnSpy.mockRestore()
  })

  it('load register 抛错 — 该 Extension 跳过，清理已注册内容', async () => {
    const extDir = createValidExtension(tmpDir, 'ext-bad', {
      registerFn: `
        module.exports = {
          id: 'ext-bad',
          name: 'Bad',
          register(api) {
            throw new Error('register failed');
          }
        };
      `
    })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).not.toContain('ext-bad')
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('register() failed'),
      expect.any(Error)
    )
    errSpy.mockRestore()
  })

  it('unload — 移除该 extensionId 的所有注册', async () => {
    createValidExtension(tmpDir, 'ext-rm')
    await loader.loadAll([tmpDir])
    expect(loader.getLoadedIds()).toContain('ext-rm')

    loader.unload('ext-rm')
    expect(loader.getLoadedIds()).not.toContain('ext-rm')
    expect(registry.getHooks('session_start')).toHaveLength(0)
  })

  it('loadAll 不存在的目录 — 正常跳过', async () => {
    await loader.loadAll(['/nonexistent/path/abc123'])
    expect(loader.getLoadedIds()).toHaveLength(0)
  })

  // ---- fs.watch 测试 ----

  it('watch — 新增子目录触发 load', async () => {
    // 先启动 watch
    loader.watch([tmpDir])

    // 创建新 Extension
    await new Promise((resolve) => setTimeout(resolve, 200))
    createValidExtension(tmpDir, 'ext-new')

    // 等待防抖 + 加载（增加等待时间，避免全量测试中的 timing 问题）
    await new Promise((resolve) => setTimeout(resolve, 800))

    expect(loader.getLoadedIds()).toContain('ext-new')
  })

  it('watch — 删除子目录触发 unload', async () => {
    createValidExtension(tmpDir, 'ext-del')
    await loader.loadAll([tmpDir])
    expect(loader.getLoadedIds()).toContain('ext-del')

    loader.watch([tmpDir])
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 删除目录
    fs.rmSync(path.join(tmpDir, 'ext-del'), { recursive: true, force: true })

    // 等待防抖
    await new Promise((resolve) => setTimeout(resolve, 800))

    expect(loader.getLoadedIds()).not.toContain('ext-del')
  })

  it('watch — stopWatch 后不再响应', async () => {
    loader.watch([tmpDir])
    loader.stopWatch()

    createValidExtension(tmpDir, 'ext-after-stop')
    await new Promise((resolve) => setTimeout(resolve, 800))

    expect(loader.getLoadedIds()).not.toContain('ext-after-stop')
  })

  // ---- 补充维度 ----

  it('load 无入口文件且无 skills — 只有 extension.json，跳过', async () => {
    const extDir = path.join(tmpDir, 'no-entry')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({ id: 'no-entry', name: 'No Entry', version: '1.0.0' })
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).not.toContain('no-entry')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No entry file or skills declaration')
    )
    warnSpy.mockRestore()
  })

  it('load 非法 JSON — extension.json 格式错误', async () => {
    const extDir = path.join(tmpDir, 'bad-json')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(path.join(extDir, 'extension.json'), '{invalid json!!!')
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `module.exports = { id: 'bad-json', name: 'Bad JSON', register() {} }`
    )

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).not.toContain('bad-json')
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse extension.json'),
      expect.anything()
    )
    errSpy.mockRestore()
  })

  it('loadAll 跳过非目录条目（如文件）', async () => {
    // 创建一个文件（非目录）在搜索路径下
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir.txt'), 'hello')
    // 再创建一个有效 Extension
    createValidExtension(tmpDir, 'ext-valid')

    await loader.loadAll([tmpDir])
    expect(loader.getLoadedIds()).toHaveLength(1)
    expect(loader.getLoadedIds()).toContain('ext-valid')
  })

  it('load Extension 注册 hook 和多个 hook — hook 在 registry 中可见', async () => {
    const extDir = path.join(tmpDir, 'ext-hooks')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({ id: 'ext-hooks', name: 'Hooks Extension', version: '1.0.0' })
    )
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `
      module.exports = {
        id: 'ext-hooks',
        name: 'Hooks Extension',
        register(api) {
          api.on('session_start', async () => {});
          api.on('session_end', async () => {});
          api.on('message_received', async () => {});
        }
      };
    `
    )

    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).toContain('ext-hooks')
    expect(registry.getHooks('session_start')).toHaveLength(1)
    expect(registry.getHooks('session_end')).toHaveLength(1)
    expect(registry.getHooks('message_received')).toHaveLength(1)
  })

  it('load Extension 注册 Gateway 方法 — 方法在 registry 中可见', async () => {
    const extDir = path.join(tmpDir, 'ext-gw')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({ id: 'ext-gw', name: 'GW Extension', version: '1.0.0' })
    )
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `
      module.exports = {
        id: 'ext-gw',
        name: 'GW Extension',
        register(api) {
          api.registerGatewayMethod('ext.hello', async () => ({ world: true }));
        }
      };
    `
    )

    await loader.load(extDir, 'user')

    const methods = registry.getGatewayMethods()
    expect(methods).toHaveLength(1)
    expect(methods[0].method).toBe('ext.hello')
    expect(methods[0].extensionId).toBe('ext-gw')
  })

  it('同一 Extension 热重载 — 重新 load 先卸载旧版注册', async () => {
    createValidExtension(tmpDir, 'ext-reload')
    await loader.loadAll([tmpDir])
    expect(registry.getHooks('session_start')).toHaveLength(1)
    expect(loader.getLoadedIds()).toContain('ext-reload')

    // 手动 unload 再 load 新版（模拟 watch 触发的热重载流程）
    loader.unload('ext-reload')
    expect(registry.getHooks('session_start')).toHaveLength(0)
    expect(loader.getLoadedIds()).not.toContain('ext-reload')

    // 用不同 hook 创建新版
    const extDir2 = path.join(tmpDir, 'ext-reload-v2')
    fs.mkdirSync(extDir2, { recursive: true })
    fs.writeFileSync(
      path.join(extDir2, 'extension.json'),
      JSON.stringify({ id: 'ext-reload', name: 'Reloaded', version: '2.0.0' })
    )
    fs.writeFileSync(
      path.join(extDir2, 'index.js'),
      `
      module.exports = {
        id: 'ext-reload',
        name: 'Reloaded',
        register(api) {
          api.on('agent_end', async () => {});
        }
      };
    `
    )
    await loader.load(extDir2, 'workspace')

    // 新 hook 存在
    expect(registry.getHooks('agent_end')).toHaveLength(1)
    expect(loader.getLoadedIds()).toContain('ext-reload')
  })

  it('loadAll 多个 Extension — 全部加载', async () => {
    createValidExtension(tmpDir, 'ext-1')
    createValidExtension(tmpDir, 'ext-2')
    createValidExtension(tmpDir, 'ext-3')

    await loader.loadAll([tmpDir])

    const ids = loader.getLoadedIds()
    expect(ids).toHaveLength(3)
    expect(ids).toContain('ext-1')
    expect(ids).toContain('ext-2')
    expect(ids).toContain('ext-3')
  })

  it('unload 不存在的 extensionId — 安全无副作用', () => {
    expect(() => loader.unload('nonexistent')).not.toThrow()
    expect(loader.getLoadedIds()).toHaveLength(0)
  })

  it('watch 不存在的目录 — 安全跳过', () => {
    expect(() => loader.watch(['/nonexistent/abc123'])).not.toThrow()
  })

  it('stopWatch 多次调用 — 安全幂等', () => {
    loader.watch([tmpDir])
    expect(() => {
      loader.stopWatch()
      loader.stopWatch()
    }).not.toThrow()
  })

  // ---- Skill 目录贡献 ----

  it('load Extension 声明 skills — Skill 目录注册到 registry', async () => {
    const extDir = path.join(tmpDir, 'ext-with-skills')
    fs.mkdirSync(extDir, { recursive: true })
    // 创建 skills 子目录及示例 Skill
    const skillsDir = path.join(extDir, 'skills')
    fs.mkdirSync(path.join(skillsDir, 'my-skill'), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, 'my-skill', 'SKILL.md'), '# My Skill')

    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({
        id: 'ext-with-skills',
        name: 'Skills Extension',
        version: '1.0.0',
        skills: 'skills'
      })
    )
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `module.exports = { id: 'ext-with-skills', name: 'Skills Extension', register(api) {} };`
    )

    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).toContain('ext-with-skills')
    const dirs = registry.getSkillDirs()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].extensionId).toBe('ext-with-skills')
    expect(dirs[0].dir).toBe(skillsDir)
  })

  it('纯 Skill 扩展（无 index.ts）— 只有 manifest+skills，正常加载', async () => {
    const extDir = path.join(tmpDir, 'skill-only')
    fs.mkdirSync(extDir, { recursive: true })
    const skillsDir = path.join(extDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({
        id: 'skill-only',
        name: 'Skill Only Extension',
        version: '1.0.0',
        skills: 'skills'
      })
    )
    // 注意：没有 index.ts / index.js

    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).toContain('skill-only')
    const dirs = registry.getSkillDirs()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].extensionId).toBe('skill-only')
  })

  it('skills 目录不存在 — 警告但不阻止加载', async () => {
    const extDir = path.join(tmpDir, 'ext-bad-skill')
    fs.mkdirSync(extDir, { recursive: true })

    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({
        id: 'ext-bad-skill',
        name: 'Bad Skill Path',
        version: '1.0.0',
        skills: 'nonexistent-dir'
      })
    )
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `module.exports = { id: 'ext-bad-skill', name: 'Bad Skill', register(api) {} };`
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).toContain('ext-bad-skill')
    expect(registry.getSkillDirs()).toHaveLength(0) // Skill 目录不存在，不注册
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skill dir declared but not found')
    )
    warnSpy.mockRestore()
  })

  it('unload — 同时移除扩展贡献的 Skill 目录', async () => {
    const extDir = path.join(tmpDir, 'ext-skill-rm')
    fs.mkdirSync(extDir, { recursive: true })
    const skillsDir = path.join(extDir, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({
        id: 'ext-skill-rm',
        name: 'Removable Skill Extension',
        version: '1.0.0',
        skills: 'skills'
      })
    )
    fs.writeFileSync(
      path.join(extDir, 'index.js'),
      `module.exports = { id: 'ext-skill-rm', name: 'Removable', register(api) { api.on('session_start', async () => {}); } };`
    )

    await loader.load(extDir, 'user')
    expect(registry.getSkillDirs()).toHaveLength(1)
    expect(registry.getHooks('session_start')).toHaveLength(1)

    loader.unload('ext-skill-rm')
    expect(registry.getSkillDirs()).toHaveLength(0)
    expect(registry.getHooks('session_start')).toHaveLength(0)
  })

  it('无入口无 skills — 跳过并警告', async () => {
    const extDir = path.join(tmpDir, 'ext-empty')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(
      path.join(extDir, 'extension.json'),
      JSON.stringify({ id: 'ext-empty', name: 'Empty', version: '1.0.0' })
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loader.load(extDir, 'user')

    expect(loader.getLoadedIds()).not.toContain('ext-empty')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No entry file or skills declaration')
    )
    warnSpy.mockRestore()
  })
})
