/**
 * 路径守卫全面测试
 *
 * 覆盖：
 *   - 基础路径解析（相对/绝对）
 *   - 路径穿越攻击防护
 *   - 符号链接穿越检查
 *   - sandboxRoot vs workspaceRoot 优先级
 *   - 边界情况（空路径、特殊字符、深层嵌套）
 *   - pathGuardErrorToToolResult 转换
 *   - resolveWorkingDirectory 各模式
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { resolve, join } from 'node:path'
import {
  resolveSandboxPath,
  resolveWorkingDirectory,
  pathGuardErrorToToolResult
} from '../path-guard'
import { createPathOnlyContext } from '../context'

// ========== resolveSandboxPath ==========

describe('resolveSandboxPath', () => {
  const ctx = { workspaceRoot: '/home/user/project' }

  // --- 基础解析 ---

  describe('基础路径解析', () => {
    it('相对路径基于 workspaceRoot 解析', () => {
      const result = resolveSandboxPath('src/index.ts', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'src/index.ts'))
    })

    it('绝对路径在 workspaceRoot 内允许', () => {
      const result = resolveSandboxPath('/home/user/project/src/index.ts', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe('/home/user/project/src/index.ts')
    })

    it('当前目录 . 等于 workspaceRoot', () => {
      const result = resolveSandboxPath('.', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project'))
    })

    it('./file.txt 在 workspaceRoot 内', () => {
      const result = resolveSandboxPath('./file.txt', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'file.txt'))
    })

    it('深层嵌套路径正常解析', () => {
      const result = resolveSandboxPath('a/b/c/d/e/f/g/h.txt', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'a/b/c/d/e/f/g/h.txt'))
    })

    it('workspaceRoot 自身是合法路径', () => {
      const result = resolveSandboxPath('/home/user/project', ctx)
      expect(result.error).toBeUndefined()
    })

    it('workspaceRoot 下的子目录是合法路径', () => {
      const result = resolveSandboxPath('/home/user/project/src', ctx)
      expect(result.error).toBeUndefined()
    })
  })

  // --- 路径穿越攻击 ---

  describe('路径穿越防护', () => {
    it('单层 ../ 穿越被拒绝', () => {
      const result = resolveSandboxPath('../secret.txt', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('多层 ../../../ 穿越被拒绝', () => {
      const result = resolveSandboxPath('../../../etc/passwd', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('绝对路径 /etc/passwd 被拒绝', () => {
      const result = resolveSandboxPath('/etc/passwd', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('绝对路径 /tmp/hack.sh 被拒绝', () => {
      const result = resolveSandboxPath('/tmp/hack.sh', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('根路径 / 被拒绝', () => {
      const result = resolveSandboxPath('/', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('中间包含 ../ 的复合穿越被拒绝', () => {
      const result = resolveSandboxPath('src/../../etc/shadow', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('合法路径中包含 .. 但不越界允许通过', () => {
      // src/../lib/index.ts → /home/user/project/lib/index.ts （仍在 workspace 内）
      const result = resolveSandboxPath('src/../lib/index.ts', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'lib/index.ts'))
    })

    it('错误信息包含文件路径和边界信息', () => {
      const result = resolveSandboxPath('/etc/passwd', ctx)
      expect(result.error).toBeDefined()
      expect(result.error!.message).toContain('/etc/passwd')
      expect(result.error!.details.filePath).toBe('/etc/passwd')
      expect(result.error!.details.boundary).toBe('/home/user/project')
    })
  })

  // --- sandboxRoot vs workspaceRoot ---

  describe('sandboxRoot 优先级', () => {
    it('sandboxRoot 设置时作为路径边界', () => {
      const result = resolveSandboxPath('index.ts', {
        workspaceRoot: '/home/user/project',
        sandboxRoot: '/home/user/project/src'
      })
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project/src', 'index.ts'))
    })

    it('sandboxRoot 外但在 workspaceRoot 内的路径被拒绝', () => {
      const result = resolveSandboxPath('../package.json', {
        workspaceRoot: '/home/user/project',
        sandboxRoot: '/home/user/project/src'
      })
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    })

    it('无 sandboxRoot 时以 workspaceRoot 为边界', () => {
      const result = resolveSandboxPath('package.json', {
        workspaceRoot: '/home/user/project'
      })
      expect(result.error).toBeUndefined()
    })
  })

  // --- 边界情况 ---

  describe('边界情况', () => {
    it('没有 context 时降级为 process.cwd()', () => {
      const result = resolveSandboxPath('test.txt')
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve(process.cwd(), 'test.txt'))
    })

    it('使用完整的 SandboxContext 对象', () => {
      const fullCtx = createPathOnlyContext('/home/user/project')
      const result = resolveSandboxPath('src/main.ts', fullCtx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'src/main.ts'))
    })

    it('路径中包含空格', () => {
      const result = resolveSandboxPath('my folder/my file.txt', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'my folder/my file.txt'))
    })

    it('路径中包含中文', () => {
      const result = resolveSandboxPath('文档/笔记.md', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', '文档/笔记.md'))
    })

    it('路径中包含特殊字符', () => {
      const result = resolveSandboxPath('file@2x.png', ctx)
      expect(result.error).toBeUndefined()
    })

    it('只有文件名的相对路径', () => {
      const result = resolveSandboxPath('README.md', ctx)
      expect(result.error).toBeUndefined()
      expect(result.path).toBe(resolve('/home/user/project', 'README.md'))
    })
  })
})

// ========== pathGuardErrorToToolResult ==========

describe('pathGuardErrorToToolResult', () => {
  it('将 PathGuardError 转换为 ToolResult 格式', () => {
    const error = {
      code: 'SANDBOX_VIOLATION' as const,
      message: 'Path is outside workspace',
      details: {
        filePath: '/etc/passwd',
        absolutePath: '/etc/passwd',
        boundary: '/home/user/project'
      }
    }
    const result = pathGuardErrorToToolResult(error)

    expect(result.success).toBe(false)
    expect(result.llmContent).toContain('Path is outside workspace')
    expect(result.error.code).toBe('SANDBOX_VIOLATION')
    expect(result.error.message).toBe('Path is outside workspace')
    expect(result.error.details).toEqual(error.details)
  })
})

// ========== resolveWorkingDirectory ==========

describe('resolveWorkingDirectory', () => {
  it('path-only 模式返回 workspaceRoot', () => {
    const ctx = createPathOnlyContext('/home/user/project')
    expect(resolveWorkingDirectory(ctx)).toBe('/home/user/project')
  })

  it('无 context 时返回 process.cwd()', () => {
    expect(resolveWorkingDirectory()).toBe(process.cwd())
  })

  it('简单对象也可以使用', () => {
    expect(resolveWorkingDirectory({ workspaceRoot: '/my/path' })).toBe('/my/path')
  })

  it('Docker 运行中时返回容器工作目录', () => {
    const ctx = {
      mode: 'docker' as const,
      workspaceRoot: '/home/user/project',
      toolPolicy: { allow: [], deny: [] },
      docker: { containerName: 'test', workdir: '/workspace', running: true }
    }
    expect(resolveWorkingDirectory(ctx)).toBe('/workspace')
  })

  it('Docker 未运行时返回 workspaceRoot', () => {
    const ctx = {
      mode: 'docker' as const,
      workspaceRoot: '/home/user/project',
      toolPolicy: { allow: [], deny: [] },
      docker: { containerName: 'test', workdir: '/workspace', running: false }
    }
    expect(resolveWorkingDirectory(ctx)).toBe('/home/user/project')
  })

  it('Docker 模式但无 docker 字段时返回 workspaceRoot', () => {
    const ctx = {
      mode: 'docker' as const,
      workspaceRoot: '/home/user/project',
      toolPolicy: { allow: [], deny: [] }
    }
    expect(resolveWorkingDirectory(ctx)).toBe('/home/user/project')
  })
})

// ========== 符号链接穿越检查 ==========

describe('resolveSandboxPath — 符号链接穿越检查', () => {
  let tmpDir: string
  let workspaceRoot: string

  /**
   * 每个测试自行创建 tmpDir，
   * afterEach 统一清理
   */
  function setupDirs(): void {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'pathguard-'))
    workspaceRoot = join(tmpDir, 'workspace')
    fs.mkdirSync(workspaceRoot, { recursive: true })
    fs.mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('workspace 内指向外部文件的符号链接被拒绝', () => {
    setupDirs()
    // 在 workspace 外创建一个 secret 文件
    const externalFile = join(tmpDir, 'secret.txt')
    fs.writeFileSync(externalFile, 'secret data')

    // 在 workspace 内创建指向外部文件的 symlink
    const symlinkPath = join(workspaceRoot, 'src', 'link-to-secret.txt')
    fs.symlinkSync(externalFile, symlinkPath)

    const result = resolveSandboxPath('src/link-to-secret.txt', { workspaceRoot })
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('SANDBOX_VIOLATION')
    expect(result.error!.message).toContain('symlink')
  })

  it('workspace 内指向外部目录的符号链接被拒绝', () => {
    setupDirs()
    // 在 workspace 外创建一个目录
    const externalDir = join(tmpDir, 'external-data')
    fs.mkdirSync(externalDir)
    fs.writeFileSync(join(externalDir, 'data.json'), '{}')

    // 在 workspace 内创建指向外部目录的 symlink
    const symlinkPath = join(workspaceRoot, 'external')
    fs.symlinkSync(externalDir, symlinkPath)

    const result = resolveSandboxPath('external/data.json', { workspaceRoot })
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('SANDBOX_VIOLATION')
  })

  it('workspace 内指向 workspace 内部的符号链接允许通过', () => {
    setupDirs()
    // 在 workspace 内创建目标文件
    const targetFile = join(workspaceRoot, 'src', 'original.ts')
    fs.writeFileSync(targetFile, 'content')

    // 在 workspace 内创建指向 workspace 内部的 symlink
    const symlinkPath = join(workspaceRoot, 'link-to-src.ts')
    fs.symlinkSync(targetFile, symlinkPath)

    const result = resolveSandboxPath('link-to-src.ts', { workspaceRoot })
    expect(result.error).toBeUndefined()
    expect(result.path).toBeDefined()
  })

  it('目标不存在但父目录 symlink 指向外部 — 被拒绝', () => {
    setupDirs()
    // 在 workspace 外创建一个目录
    const externalDir = join(tmpDir, 'outside')
    fs.mkdirSync(externalDir)

    // 在 workspace 内创建指向外部的 symlink 目录
    const symlinkDir = join(workspaceRoot, 'fake-dir')
    fs.symlinkSync(externalDir, symlinkDir)

    // 尝试在 symlink 目录下写入新文件（目标不存在）
    const result = resolveSandboxPath('fake-dir/new-file.txt', { workspaceRoot })
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('SANDBOX_VIOLATION')
  })

  it('目标不存在且父目录正常 — 允许通过', () => {
    setupDirs()
    // src 目录存在且不是 symlink
    const result = resolveSandboxPath('src/new-file.ts', { workspaceRoot })
    expect(result.error).toBeUndefined()
    expect(result.path).toBeDefined()
  })

  it('普通文件（非 symlink）正常通过', () => {
    setupDirs()
    const normalFile = join(workspaceRoot, 'normal.txt')
    fs.writeFileSync(normalFile, 'hello')

    const result = resolveSandboxPath('normal.txt', { workspaceRoot })
    expect(result.error).toBeUndefined()
    expect(result.path).toBe(normalFile)
  })
})
