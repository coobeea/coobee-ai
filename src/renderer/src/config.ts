/**
 * 配置管理类
 *
 * 统一管理前端运行时配置，所有地址 / 端口均通过 VITE_* 环境变量注入，
 * 并提供合理的默认值。
 */
class ConfigManager {
  private baseUrl: string
  private wsUrl: string
  private timeout: number

  constructor() {
    // ---- HTTP API ----
    const customBaseURL = import.meta.env.VITE_API_BASE_URL
    const httpPort = import.meta.env.VITE_HTTP_PORT || '3100'
    this.baseUrl = customBaseURL || `http://127.0.0.1:${httpPort}`

    // ---- WebSocket ----
    const wsPort = import.meta.env.VITE_WS_PORT || '8765'
    this.wsUrl = `ws://localhost:${wsPort}`

    // ---- 通用 ----
    this.timeout = parseInt(import.meta.env.VITE_REQUEST_TIMEOUT || '5000', 10)
  }

  /**
   * 获取 HTTP API 基础 URL
   * @example "http://127.0.0.1:3300"
   */
  public getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * 获取 WebSocket 连接地址
   * @example "ws://localhost:8765"
   */
  public getWsUrl(): string {
    return this.wsUrl
  }

  /**
   * 获取请求超时时间（毫秒）
   */
  public getTimeout(): number {
    return this.timeout
  }

  /**
   * 判断是否是 Electron 环境
   */
  public isElectronEnvironment(): boolean {
    return !!window.electron?.ipcRenderer?.invoke
  }
}

const configManager = new ConfigManager()
export default configManager
