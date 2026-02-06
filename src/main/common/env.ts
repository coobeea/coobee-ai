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
    // === 应用路径（Application Paths）===
    /** 应用根目录 (如: /Applications/coobee-ai.app/Contents/Resources/app.asar) */
    root: app.getAppPath(),
    /** 应用数据目录 - 存储数据库、配置等 (如: ~/Library/Application Support/coobee-ai) */
    userData: app.getPath('userData'),
    /** 应用数据目录(系统级) (如: ~/Library/Application Support) */
    appData: app.getPath('appData'),
    /** 日志目录 (如: /path/to/app) */
    logPath: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    /** 安装目录 (如: /Applications/coobee-ai.app/Contents/MacOS) */
    installDir: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    /** 用户主目录 (开发: <项目>/.home | 生产: ~/coobee-ai) */
    userHome: is.dev
      ? path.join(app.getAppPath(), '.home')
      : path.join(app.getPath('home'), '.' + app.getName()),

    // === 系统路径（System Paths）===
    /** 系统用户目录 (如: /Users/username) */
    home: app.getPath('home'),
    /** 系统临时目录 (如: /var/folders/xxx) */
    temp: app.getPath('temp'),
    /** 系统下载目录 (如: ~/Downloads) */
    downloads: app.getPath('downloads'),
    /** 系统文档目录 (如: ~/Documents) */
    documents: app.getPath('documents'),
    /** 系统桌面目录 (如: ~/Desktop) */
    desktop: app.getPath('desktop')
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
  }
}

export default Env
