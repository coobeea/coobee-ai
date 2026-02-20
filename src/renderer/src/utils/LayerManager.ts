/**
 * 统一的弹出层管理器
 *
 * 职责：
 *   1. z-index 分配 —— 保证后打开的层级更高
 *   2. ESC 堆栈   —— 按 ESC 只关闭最顶层弹层
 *
 * 所有弹出类组件（Popup、Confirm、Popover、ToolTip、Message 等）
 * 统一通过此管理器注册 / 注销，避免各自为政的 z-index 和键盘事件。
 */

export interface LayerEntry {
  id: string;
  zIndex: number;
  onEsc?: () => void;
}

class LayerManager {
  private static instance: LayerManager;

  private baseZIndex = 10000;
  private counter = 10000;

  /** 按注册顺序维护的层栈，末尾为最顶层 */
  private stack: LayerEntry[] = [];

  private escListenerAttached = false;

  public static getInstance(): LayerManager {
    if (!LayerManager.instance) {
      LayerManager.instance = new LayerManager();
    }
    return LayerManager.instance;
  }

  /**
   * 注册一个弹出层，返回分配的 z-index。
   * @param id     唯一标识
   * @param onEsc  按 ESC 时的回调（若最顶层是自己）；不传则不响应 ESC
   */
  register(id: string, onEsc?: () => void): number {
    this.unregister(id);

    const zIndex = ++this.counter;
    this.stack.push({ id, zIndex, onEsc });

    this.ensureEscListener();
    return zIndex;
  }

  /** 注销弹出层 */
  unregister(id: string): void {
    const idx = this.stack.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  /** 仅分配一个更高的 z-index，不加入 ESC 堆栈 */
  nextZIndex(): number {
    return ++this.counter;
  }

  /** 获取当前最高 z-index */
  getCurrentZIndex(): number {
    return this.counter;
  }

  /** 重置 */
  reset(): void {
    this.counter = this.baseZIndex;
    this.stack = [];
    if (this.escListenerAttached && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.handleEsc);
      this.escListenerAttached = false;
    }
  }

  /** 获取当前堆栈快照（调试用） */
  getStack(): readonly LayerEntry[] {
    return this.stack;
  }

  // ─── 内部 ──────────────────────────────────────────────

  private ensureEscListener(): void {
    if (this.escListenerAttached) return;
    if (typeof document === 'undefined') return;

    document.addEventListener('keydown', this.handleEsc);
    this.escListenerAttached = true;
  }

  private handleEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (this.stack.length === 0) return;

    const top = this.stack[this.stack.length - 1];
    if (top.onEsc) {
      e.stopPropagation();
      top.onEsc();
    }
  };
}

export const layerManager = LayerManager.getInstance();
