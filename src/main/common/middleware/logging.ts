import { log } from '../logger'
import { Middleware } from '../types'

export const loggingMiddleware: Middleware = {
  name: 'logging',
  priority: 1,
  async execute(context, next) {
    const startTime = Date.now()
    log.debug(`[Middleware] ${context.method} started`)

    const result = await next()

    const duration = Date.now() - startTime
    log.debug(`[Middleware] ${context.method} completed in ${duration}ms`)

    return result
  }
}
