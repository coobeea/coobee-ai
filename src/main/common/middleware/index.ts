import { log } from '../logger'
import { loggingMiddleware } from './logging'
import { maintenanceMiddleware } from './maintenance'
import { middlewareManager } from './manager'
import { securityMiddleware } from './security'

export function initializeMiddlewares(): void {
  log.info('[Middleware] Initializing...')

  middlewareManager.use(loggingMiddleware)
  middlewareManager.use(securityMiddleware)
  middlewareManager.use(maintenanceMiddleware)

  log.info('[Middleware] Initialized')
  log.info(
    `[Middleware] Registered:`,
    middlewareManager.getMiddlewares().map((m) => `${m.name}(${m.priority})`)
  )
}

export { middlewareManager } from './manager'
export { Middleware, MiddlewareContext, MiddlewareResult } from '../types'
