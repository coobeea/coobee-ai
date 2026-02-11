// 事件处理函数类型
export type EventHandler<T = unknown> = (data: T) => void
export type ErrorHandler = (error: Event) => void
export type StartHandler = () => void
export type OpenHandler = () => void
export type CloseHandler = () => void

export interface SSEConnection<T> {
  // 连接控制
  open(): Promise<void>
  close(): void

  // 链式事件处理方法
  onStart(handler: StartHandler): SSEConnection<T>
  onOpen(handler: OpenHandler): SSEConnection<T>
  onMessage(handler: EventHandler<T>): SSEConnection<T>
  onError(handler: ErrorHandler): SSEConnection<T>
  onClose(handler: CloseHandler): SSEConnection<T>
}

export abstract class AbstractSSEConnection<T> implements SSEConnection<T> {
  // 事件处理器存储
  protected startHandlers: StartHandler[] = []
  protected openHandlers: OpenHandler[] = []
  protected messageHandlers: EventHandler<T>[] = []
  protected errorHandlers: ErrorHandler[] = []
  protected closeHandlers: CloseHandler[] = []

  // 抽象方法 - 子类必须实现
  abstract open(): Promise<void>
  abstract close(): void

  // 链式事件处理方法 - 基类实现
  onStart(handler: StartHandler): SSEConnection<T> {
    this.startHandlers.push(handler)
    return this
  }

  onOpen(handler: OpenHandler): SSEConnection<T> {
    this.openHandlers.push(handler)
    return this
  }

  onMessage(handler: EventHandler<T>): SSEConnection<T> {
    this.messageHandlers.push(handler)
    return this
  }

  onError(handler: ErrorHandler): SSEConnection<T> {
    this.errorHandlers.push(handler)
    return this
  }

  onClose(handler: CloseHandler): SSEConnection<T> {
    this.closeHandlers.push(handler)
    return this
  }

  // 受保护的事件触发方法 - 供子类调用

  protected triggerStart(): void {
    console.log('[SSE] triggerStart handlers')
    this.startHandlers.forEach((handler) => {
      try {
        handler()
      } catch (error) {
        console.error('Error in start handler:', error)
      }
    })
  }

  protected triggerOpen(): void {
    console.log('[SSE] triggerOpen handlers')
    this.openHandlers.forEach((handler) => {
      try {
        handler()
      } catch (error) {
        console.error('Error in open handler:', error)
      }
    })
  }

  protected triggerMessage(data: T): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(data)
      } catch (error) {
        console.error('Error in message handler:', error)
      }
    })
  }

  protected triggerError(error?: Event | Error): void {
    console.log('[SSE] triggerError handlers')
    const errorEvent = error instanceof Event ? error : new Event('error')
    this.errorHandlers.forEach((handler) => {
      try {
        handler(errorEvent)
      } catch (err) {
        console.error('Error in error handler:', err)
      }
    })
  }

  protected triggerClose(): void {
    console.log('[SSE] triggerClose handlers')
    setTimeout(() => {
      this.closeHandlers.forEach((handler) => {
        try {
          handler()
        } catch (error) {
          console.error('Error in close handler:', error)
        }
      })
    }, 0)
  }

  // 受保护的工具方法
  protected clearHandlers(): void {
    this.openHandlers = []
    this.messageHandlers = []
    this.errorHandlers = []
    this.closeHandlers = []
  }
}
