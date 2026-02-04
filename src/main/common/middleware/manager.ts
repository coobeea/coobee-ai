import { log } from '../logger'
import { Middleware, MiddlewareContext, MiddlewareResult } from './types'

export class MiddlewareManager {
  private middlewares: Middleware[] = []

  use(middleware: Middleware): void {
    this.middlewares.push(middleware)
    this.middlewares.sort((a, b) => a.priority - b.priority)
    log.info(`[Middleware] Registered: ${middleware.name} (priority: ${middleware.priority})`)
  }

  async execute(context: MiddlewareContext, handler: () => Promise<any>): Promise<MiddlewareResult> {
    let index = 0

    const next = async (): Promise<MiddlewareResult> => {
      if (index >= this.middlewares.length) {
        try {
          const data = await handler()
          return { success: true, data }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          }
        }
      }

      const middleware = this.middlewares[index++]
      return await middleware.execute(context, next)
    }

    return await next()
  }

  getMiddlewares(): Middleware[] {
    return [...this.middlewares]
  }

  clear(): void {
    this.middlewares = []
  }
}

export const middlewareManager = new MiddlewareManager()
