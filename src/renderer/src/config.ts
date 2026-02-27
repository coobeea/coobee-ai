/**
 * 配置管理类
 *
 * 统一管理前端运行时配置。
 * HTTP API 和 WebSocket 共享同一端口（VITE_SERVER_PORT，默认 8765）。
 *
 * 局域网 Web 访问支持：
 *   当通过外部浏览器访问时，host 自动使用 location.hostname（而非 127.0.0.1），
 *   确保 HTTP 和 WebSocket 连接指向正确的服务器地址。
 */
class ConfigManager {
  /** 统一服务端口 */
  private port: string;
  private timeout: number;

  constructor() {
    this.port = import.meta.env.VITE_SERVER_PORT || '8765';
    this.timeout = parseInt(import.meta.env.VITE_REQUEST_TIMEOUT || '5000', 10);
  }

  /**
   * 获取当前连接的服务器主机地址
   * - Electron 窗口内：127.0.0.1
   * - 外部浏览器通过局域网 IP 访问：自动使用 location.hostname
   */
  public getHost(): string {
    if (typeof window !== 'undefined' && window.location) {
      const h = window.location.hostname;
      if (h && h !== '' && h !== 'localhost') return h;
    }
    return '127.0.0.1';
  }

  /**
   * 获取 HTTP API 基础 URL
   */
  public getBaseUrl(): string {
    const customBaseURL = import.meta.env.VITE_API_BASE_URL;
    if (customBaseURL) return customBaseURL;
    return `http://${this.getHost()}:${this.port}`;
  }

  /**
   * 获取 WebSocket 连接地址（旧协议，即将弃用）
   * @deprecated 请使用 getGatewayWsUrl()
   */
  public getWsUrl(): string {
    return `ws://${this.getHost()}:${this.port}`;
  }

  /**
   * 获取 Gateway WebSocket 连接地址
   */
  public getGatewayWsUrl(): string {
    return `ws://${this.getHost()}:${this.port}/gateway/ws`;
  }

  /**
   * 获取统一服务端口
   */
  public getPort(): string {
    return this.port;
  }

  /**
   * 获取请求超时时间（毫秒）
   */
  public getTimeout(): number {
    return this.timeout;
  }

  /**
   * 判断是否是 Electron 环境
   */
  public isElectronEnvironment(): boolean {
    return !!window.electron?.ipcRenderer?.invoke;
  }
}

const configManager = new ConfigManager();
export default configManager;
