/**
 * 配置管理类
 */
class ConfigManager {
  private baseUrl: string
  // private apiUrl: string;
  private timeout: number

  constructor() {
    const customBaseURL = import.meta.env.VITE_API_BASE_URL
    const port = import.meta.env.VITE_HTTP_PORT || '3100'
    this.baseUrl = customBaseURL || `http://127.0.0.1:${port}`
    // this.apiUrl = import.meta.env.VITE_API_URL || '/api';
    this.timeout = parseInt(import.meta.env.VITE_REQUEST_TIMEOUT || '5000', 10)
  }

  /**
   * 获取基础URL
   */
  public getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * 获取请求超时时间
   */
  public getTimeout(): number {
    return this.timeout
  }

  /**
   * 判断是否是Electron环境
   */
  public isElectronEnvironment(): boolean {
    return !!window.electron?.ipcRenderer?.invoke
  }
}

const configManager = new ConfigManager()
export default configManager
