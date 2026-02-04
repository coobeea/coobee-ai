export interface MiddlewareContext {
  method: string
  args: any[]
  metadata?: Record<string, any>
}

export interface MiddlewareResult {
  success: boolean
  data?: any
  error?: Error
}

export interface Middleware {
  name: string
  priority: number
  execute: (
    context: MiddlewareContext,
    next: () => Promise<MiddlewareResult>
  ) => Promise<MiddlewareResult>
}
