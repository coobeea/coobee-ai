import { is } from '@electron-toolkit/utils'
import { app } from 'electron'
import fs from 'fs'
import { mkdirp } from 'mkdirp'
import path from 'path'

export const Env = {
  isDev: is.dev,
  isProd: !is.dev,
  isTest: process.env.NODE_ENV === 'test',
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isPackaged: app.isPackaged,

  // 主进程环境变量
  main: {
    bundleId: process.env.VITE_MAIN_BUNDLE_ID,
    logLevel: process.env.VITE_LOG_LEVEL,
    logMaxSize: process.env.VITE_LOG_MAX_SIZE,
    debug: process.env.VITE_DEBUG,
    openDevTools: process.env.VITE_OPEN_DEVTOOLS,
    enableHttpServer: process.env.VITE_ENABLE_HTTP_SERVER,
    httpPort: process.env.VITE_HTTP_PORT
  },

  app: {
    name: app.getName(),
    version: app.getVersion(),
    locale: app.getLocale()
  },

  paths: {
    root: app.getAppPath(),
    home: app.getPath('home'),
    userData: app.getPath('userData'),
    appData: app.getPath('appData'),
    temp: app.getPath('temp'),
    downloads: app.getPath('downloads'),
    documents: app.getPath('documents'),
    desktop: app.getPath('desktop'),
    logPath: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    installDir: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    workspace: is.dev
      ? path.join(app.getAppPath(), '.workspace')
      : path.join(app.getPath('home'), '.' + app.getName())
  },

  isRendererProcess(): boolean {
    return typeof process === 'undefined' || !process || process.type === 'renderer'
  },

  isMainProcess(): boolean {
    return typeof process !== 'undefined' && process.type === 'browser'
  },

  isForkedChildProcess(): boolean {
    return Number(process.env.ELECTRON_RUN_AS_NODE) === 1
  },

  getResourcePath(relativePath: string): string {
    return path.join(this.isDev ? process.cwd() : process.resourcesPath, relativePath)
  },

  async getInstallDir(): Promise<string> {
    const installDir = this.paths.installDir
    if (!fs.existsSync(installDir)) {
      await mkdirp(installDir)
    }
    return installDir
  },

  async getUpgradeDir(): Promise<string> {
    const installDir = await this.getInstallDir()
    const upgradeDir = path.join(installDir, 'upgrade')
    if (!fs.existsSync(upgradeDir)) {
      await mkdirp(upgradeDir)
    }
    return upgradeDir
  },

  /**
   * 获取工作区运行时目录（workspace/.runtime）
   * 用于存储工作区相关的运行时数据
   */
  async getWorkspaceRuntimeDir(): Promise<string> {
    const workspacePath = await this.getWorkspacePath()
    const runtimeDir = path.join(workspacePath, '.runtime')
    if (!fs.existsSync(runtimeDir)) {
      await mkdirp(runtimeDir)
    }
    return runtimeDir
  },

  /**
   * 获取应用运行时目录（runtime/）
   * 用于存储跨平台的二进制文件
   *
   * @returns 运行时目录路径
   * @example
   * - 开发模式: /path/to/coobee-ai/runtime
   * - 生产模式: /Applications/coobee-ai.app/Contents/Resources/runtime
   */
  getAppRuntimeDir(): string {
    // 支持环境变量覆盖（用于测试）
    if (process.env.APP_RUNTIME_DIR) {
      return process.env.APP_RUNTIME_DIR
    }

    if (this.isDev) {
      // 开发模式：项目根目录/runtime
      return path.join(process.cwd(), 'runtime')
    }

    // 生产模式：resourcesPath/runtime
    return path.join(process.resourcesPath, 'runtime')
  },

  /**
   * 获取当前平台的运行时目录
   *
   * @returns 平台特定的运行时目录路径
   * @example
   * - macOS: /path/to/runtime/macos
   * - Windows: /path/to/runtime/win
   * - Linux: /path/to/runtime/linux
   */
  getPlatformRuntimeDir(): string {
    const runtimeDir = this.getAppRuntimeDir()
    const platformDir = this.isWindows ? 'win' : this.isMac ? 'macos' : 'linux'

    return path.join(runtimeDir, platformDir)
  },

  /**
   * 获取工作区路径
   */
  async getWorkspacePath(): Promise<string> {
    const workspacePath = this.paths.workspace
    if (!fs.existsSync(workspacePath)) {
      await mkdirp(workspacePath)
    }
    return workspacePath
  }
}

export default Env
