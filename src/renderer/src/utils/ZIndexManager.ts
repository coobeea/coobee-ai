/**
 * 统一的 Z-Index 管理器
 * 用于管理所有容器组件的层级，避免 z-index 冲突
 */

export class ZIndexManager {
  private static instance: ZIndexManager;
  private baseZIndex = 10000;
  private currentZIndex = 10000;

  /**
   * 获取单例实例
   */
  public static getInstance(): ZIndexManager {
    if (!ZIndexManager.instance) {
      ZIndexManager.instance = new ZIndexManager();
    }
    return ZIndexManager.instance;
  }

  /**
   * 获取下一个更高的 z-index（用于置顶）
   */
  public bringToFront(): number {
    return ++this.currentZIndex;
  }

  /**
   * 获取当前最大的 z-index
   */
  public getCurrentZIndex(): number {
    return this.currentZIndex;
  }

  /**
   * 重置 z-index 计数器
   */
  public reset(): void {
    this.currentZIndex = this.baseZIndex;
  }
}

// 导出单例实例
export const zIndexManager = ZIndexManager.getInstance();

// 全局类型声明
declare global {
  interface Window {
    __Z_INDEX_MANAGER__: ZIndexManager;
  }
}

// 在浏览器环境中挂载到全局
if (typeof window !== 'undefined') {
  window.__Z_INDEX_MANAGER__ = zIndexManager;
}
