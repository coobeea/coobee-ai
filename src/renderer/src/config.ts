/**
 * 配置管理类
 *
 * 统一管理前端运行时配置。
 * HTTP API 和 WebSocket 共享同一端口（VITE_SERVER_PORT，默认 8765）。
 */
class ConfigManager {
  /** 统一服务端口 */
  private port: string
  private baseUrl: string
  private wsUrl: string
  private timeout: number

  constructor() {
    // 统一端口（HTTP + WebSocket 共享）
    this.port = import.meta.env.VITE_SERVER_PORT || '8765'
    const customBaseURL = import.meta.env.VITE_API_BASE_URL
    this.baseUrl = customBaseURL || `http://127.0.0.1:${this.port}`
    this.wsUrl = `ws://localhost:${this.port}`
    this.timeout = parseInt(import.meta.env.VITE_REQUEST_TIMEOUT || '5000', 10)
  }

  /**
   * 获取 HTTP API 基础 URL
   * @example "http://127.0.0.1:8765"
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
   * 获取统一服务端口
   */
  public getPort(): string {
    return this.port
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
